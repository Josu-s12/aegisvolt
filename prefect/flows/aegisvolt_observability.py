"""
AegisVolt - Flujo de observabilidad en Prefect.

Por cada ambiente (dev, test, prod):
  1. check_service_health      -> salud de los 3 microservicios vía GraphQL (query health)
  2. check_dynamodb_tables     -> las 5 tablas del ambiente existen y están ACTIVE
  3. audit_saga_consistency    -> audita la tabla de SAGAs contra las tablas de billing y
                                  reservations: detecta transacciones HUÉRFANAS
                                  (atascadas en STARTED/COMPENSATING), COMPENSATION_FAILED
                                  e INCONSISTENTES (p. ej. COMPENSATED pero el cobro sigue CHARGED)
  4. check_cloudwatch_errors   -> cuenta logs ERROR recientes en /aegisvolt/<env>/*
  5. publish_metrics           -> PutMetricData en CloudWatch (AegisVolt/<env>/Observability)
Al final publica artefactos (tabla + markdown) en el dashboard de Prefect.

Uso:
  python flows/aegisvolt_observability.py            # una ejecución
  python flows/aegisvolt_observability.py --serve    # deployment programado cada 2 min
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import boto3
from botocore.config import Config
from prefect import flow, get_run_logger, task
from prefect.artifacts import create_markdown_artifact, create_table_artifact

ENVIRONMENTS = os.getenv("AEGISVOLT_ENVS", "dev,test,prod").split(",")
GRAPHQL_URLS = {
    "dev": os.getenv("GRAPHQL_URL_DEV", "http://localhost:8401/graphql"),
    "test": os.getenv("GRAPHQL_URL_TEST", "http://localhost:8402/graphql"),
    "prod": os.getenv("GRAPHQL_URL_PROD", "http://localhost:8403/graphql"),
}
ORPHAN_AFTER = timedelta(minutes=int(os.getenv("ORPHAN_AFTER_MINUTES", "2")))
SERVICES = ["station-reservation-service", "billing-wallet-service", "energy-dispatch-service", "graphql-gateway"]


def aws(service: str):
    return boto3.client(
        service,
        endpoint_url=os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566") or None,
        region_name=os.getenv("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
        config=Config(retries={"max_attempts": 2}, connect_timeout=3, read_timeout=10),
    )


def table(env: str, base: str) -> str:
    return f"aegisvolt-{base}-{env}"


def scan_all(ddb, table_name: str) -> list[dict]:
    items, kwargs = [], {"TableName": table_name}
    while True:
        res = ddb.scan(**kwargs)
        items += res.get("Items", [])
        if "LastEvaluatedKey" not in res:
            return items
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def s(item: dict, key: str, default=None):
    v = item.get(key)
    if not v:
        return default
    return v.get("S") or v.get("N") or v.get("BOOL", default)


@task(retries=1, retry_delay_seconds=3)
def check_service_health(env: str) -> dict:
    log = get_run_logger()
    url = GRAPHQL_URLS[env]
    body = json.dumps({"query": "{ environment { name version } health { service status version track } }"}).encode()
    try:
        req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())["data"]
        down = [h["service"] for h in data["health"] if h["status"] != "UP"]
        status = "UP" if not down else "DEGRADED"
        log.info(f"[{env}] gateway v{data['environment']['version']} -> {status} {data['health']}")
        return {"env": env, "status": status, "down": down, "version": data["environment"]["version"]}
    except Exception as e:  # noqa: BLE001
        log.error(f"[{env}] GraphQL {url} no responde: {e}")
        return {"env": env, "status": "DOWN", "down": ["graphql-gateway"], "version": None}


@task
def check_dynamodb_tables(env: str) -> dict:
    ddb = aws("dynamodb")
    result = {}
    for base in ["reservations", "billing", "dispatch", "sagas", "feature-flags"]:
        try:
            result[base] = ddb.describe_table(TableName=table(env, base))["Table"]["TableStatus"]
        except Exception:  # noqa: BLE001
            result[base] = "MISSING"
    get_run_logger().info(f"[{env}] tablas DynamoDB: {result}")
    return result


@task
def audit_saga_consistency(env: str) -> dict:
    """Cruza el log del orquestador con las tablas de cada microservicio."""
    log = get_run_logger()
    ddb = aws("dynamodb")
    sagas = scan_all(ddb, table(env, "sagas"))
    now = datetime.now(timezone.utc)
    counts: dict[str, int] = {}
    orphans, inconsistent = [], []

    for it in sagas:
        saga_id, status = s(it, "sagaId"), s(it, "status")
        counts[status] = counts.get(status, 0) + 1
        updated = datetime.fromisoformat(s(it, "updatedAt").replace("Z", "+00:00"))

        # Huérfana: el orquestador murió a mitad de camino o la compensación no terminó
        if status in ("STARTED", "COMPENSATING") and now - updated > ORPHAN_AFTER:
            orphans.append({"sagaId": saga_id, "status": status, "updatedAt": s(it, "updatedAt"), "issue": "atascada (huérfana)"})
            continue
        if status == "COMPENSATION_FAILED":
            orphans.append({"sagaId": saga_id, "status": status, "updatedAt": s(it, "updatedAt"), "issue": "compensación fallida"})
            continue

        charge = ddb.get_item(TableName=table(env, "billing"), Key={"pk": {"S": f"SAGA#{saga_id}"}, "sk": {"S": "CHARGE"}}).get("Item")
        resv = ddb.get_item(TableName=table(env, "reservations"), Key={"pk": {"S": f"SAGA#{saga_id}"}, "sk": {"S": "RESERVATION"}}).get("Item")
        charge_st = s(charge, "status") if charge else None
        resv_st = s(resv, "status") if resv else None

        problem = None
        if status == "COMPENSATED":
            if charge_st == "CHARGED":
                problem = "COMPENSATED pero el cobro sigue CHARGED (no se reembolsó)"
            elif resv_st in ("RESERVED", "CHARGING"):
                problem = f"COMPENSATED pero la reserva sigue {resv_st}"
        elif status == "COMPLETED":
            if charge_st != "CHARGED":
                problem = f"COMPLETED pero el cobro está {charge_st}"
            elif resv_st != "CHARGING":
                problem = f"COMPLETED pero la reserva está {resv_st}"
        if problem:
            inconsistent.append({"sagaId": saga_id, "status": status, "updatedAt": s(it, "updatedAt"), "issue": problem})

    for o in orphans + inconsistent:
        log.warning(f"[{env}] SAGA con problema {o['sagaId']}: {o['issue']}")
    log.info(f"[{env}] SAGAs por estado: {counts} | huérfanas={len(orphans)} inconsistentes={len(inconsistent)}")
    return {"env": env, "total": len(sagas), "by_status": counts, "orphans": orphans, "inconsistent": inconsistent}


@task
def check_cloudwatch_errors(env: str, minutes: int = 15) -> dict:
    logs = aws("logs")
    start = int((time.time() - minutes * 60) * 1000)
    errors = {}
    for svc in SERVICES:
        try:
            ev = logs.filter_log_events(logGroupName=f"/aegisvolt/{env}/{svc}", startTime=start, filterPattern='"ERROR"').get("events", [])
            errors[svc] = sum(1 for e in ev if '"level":"ERROR"' in e["message"])
        except Exception:  # noqa: BLE001
            errors[svc] = -1  # grupo inexistente
    get_run_logger().info(f"[{env}] errores en CloudWatch (últimos {minutes} min): {errors}")
    return errors


@task
def publish_metrics(env: str, health: dict, audit: dict, cw_errors: dict) -> None:
    cw = aws("cloudwatch")
    by = audit["by_status"]
    data = [
        ("ServicesDown", len(health["down"])),
        ("SagaTotal", audit["total"]),
        ("SagaCompleted", by.get("COMPLETED", 0) + by.get("FINISHED", 0)),
        ("SagaCompensated", by.get("COMPENSATED", 0)),
        ("SagaOrphans", len(audit["orphans"])),
        ("SagaInconsistent", len(audit["inconsistent"])),
        ("RecentErrorLogs", sum(v for v in cw_errors.values() if v > 0)),
    ]
    try:
        cw.put_metric_data(
            Namespace=f"AegisVolt/{env}/Observability",
            MetricData=[{"MetricName": n, "Value": float(v), "Unit": "Count"} for n, v in data],
        )
        get_run_logger().info(f"[{env}] métricas publicadas en CloudWatch: {dict(data)}")
    except Exception as e:  # noqa: BLE001
        get_run_logger().warning(f"[{env}] no se pudieron publicar métricas: {e}")


@flow(name="aegisvolt-observability", log_prints=True)
def aegisvolt_observability(envs: list[str] | None = None) -> list[dict]:
    envs = envs or ENVIRONMENTS
    rows, problems = [], []
    for env in envs:
        health = check_service_health(env)
        tables = check_dynamodb_tables(env)
        if "MISSING" in tables.values():
            rows.append({"ambiente": env, "salud": health["status"], "tablas": "FALTAN", "sagas": 0, "completadas": 0,
                         "compensadas": 0, "huérfanas": 0, "inconsistentes": 0, "errores_cw_15m": 0})
            continue
        audit = audit_saga_consistency(env)
        cw_errors = check_cloudwatch_errors(env)
        publish_metrics(env, health, audit, cw_errors)
        by = audit["by_status"]
        rows.append({
            "ambiente": env,
            "salud": health["status"],
            "tablas": "OK",
            "sagas": audit["total"],
            "completadas": by.get("COMPLETED", 0) + by.get("FINISHED", 0),
            "compensadas": by.get("COMPENSATED", 0),
            "huérfanas": len(audit["orphans"]),
            "inconsistentes": len(audit["inconsistent"]),
            "errores_cw_15m": sum(v for v in cw_errors.values() if v > 0),
        })
        problems += [{**p, "env": env} for p in audit["orphans"] + audit["inconsistent"]]

    create_table_artifact(key="aegisvolt-health", table=rows, description="Salud y consistencia SAGA por ambiente")
    md = ["# AegisVolt · reporte de observabilidad", f"_Generado: {datetime.now(timezone.utc).isoformat()}_", "",
          "| Ambiente | Salud | SAGAs | Completadas | Compensadas | Huérfanas | Inconsistentes | Errores CW (15m) |",
          "|---|---|---|---|---|---|---|---|"]
    md += [f"| {r['ambiente']} | {r['salud']} | {r['sagas']} | {r['completadas']} | {r['compensadas']} | {r['huérfanas']} | {r['inconsistentes']} | {r['errores_cw_15m']} |" for r in rows]
    md += ["", "## Transacciones que requieren atención"]
    md += [f"- **{p['env']}** `{p['sagaId']}` ({p['status']}): {p['issue']}" for p in problems] or ["- Ninguna ✅"]
    create_markdown_artifact(key="aegisvolt-report", markdown="\n".join(md), description="Reporte AegisVolt")
    print("\n".join(md))
    return rows


if __name__ == "__main__":
    if "--serve" in sys.argv:
        aegisvolt_observability.serve(name="aegisvolt-observability-cada-2-min", interval=120)
    else:
        aegisvolt_observability()
