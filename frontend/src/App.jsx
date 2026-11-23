import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gql, DASHBOARD_QUERY, START_MUTATION, STOP_MUTATION, SET_FLAG_MUTATION, TELEMETRY_QUERY, QUOTE_QUERY } from './api.js';

const POLL_MS = 2000; // "tiempo real": refresco cada 2 s
const money = (n, c = 'COP') => (n == null ? '—' : `${Number(n).toLocaleString('es-CO')} ${c}`);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO') : '—');

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastSaga, setLastSaga] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setData(await gql(DASHBOARD_QUERY));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) return <div className="loading">{error ? `No se pudo conectar al GraphQL: ${error}` : 'Conectando con AegisVolt…'}</div>;

  const env = data.environment.name;
  const flags = Object.fromEntries(data.featureFlags.map((f) => [f.name, f.enabled]));

  return (
    <div className={`app env-${env}`}>
      <header>
        <div className="brand">⚡ AegisVolt <span>Gestión de carga para flotas EV</span></div>
        <div className="env-badge">Ambiente: {env.toUpperCase()}</div>
        <div className="meta">versión {data.environment.version} · {data.environment.track}</div>
      </header>
      {error && <div className="banner error">Error de conexión: {error}</div>}
      {flags.SIMULATE_CHARGER_HARDWARE_FAULT && (
        <div className="banner warn">⚠ SIMULATE_CHARGER_HARDWARE_FAULT activa: toda activación de carga fallará y la SAGA hará rollback.</div>
      )}

      <div className="grid">
        <section className="card span2">
          <h2>a. Estado de electrolineras (tiempo real)</h2>
          <Stations stations={data.stations} />
        </section>

        <section className="card">
          <h2>b. Reservar y activar carga (SAGA)</h2>
          <ReserveForm data={data} flags={flags} onDone={(s) => { setLastSaga(s); refresh(); }} />
          {lastSaga && <SagaDetail saga={lastSaga} title="Resultado de la última SAGA" />}
        </section>

        <section className="card">
          <h2>c. Feature Flags · {env}</h2>
          <Flags flags={data.featureFlags} onChange={refresh} />
          <h3>Billeteras de flota</h3>
          <ul className="wallets">
            {data.wallets.map((w) => <li key={w.fleetId}><b>{w.fleetName}</b><span>{money(w.balance, w.currency)}</span></li>)}
          </ul>
          <h3>Salud de microservicios</h3>
          <ul className="health">
            {data.health.map((h) => <li key={h.service} className={h.status === 'UP' ? 'up' : 'down'}>{h.service}: {h.status} {h.version ? `(${h.version}/${h.track})` : ''}</li>)}
          </ul>
        </section>

        <section className="card span2">
          <h2>d. Historial de transacciones y compensaciones</h2>
          <Transactions txs={data.transactions} onStop={refresh} />
        </section>
      </div>
    </div>
  );
}

function Stations({ stations }) {
  const [telemetryFor, setTelemetryFor] = useState(null);
  return (
    <div className="stations">
      {stations.map((s) => (
        <div key={s.id} className="station">
          <div className="station-head"><b>{s.name}</b><span>{s.city} · {s.availableConnectors}/{s.connectors.length} libres</span></div>
          <div className="connectors">
            {s.connectors.map((c) => (
              <button key={c.id} className={`connector st-${c.status}`} onClick={() => setTelemetryFor(c.status === 'CHARGING' ? c.id : null)} title={c.sagaId || ''}>
                <div className="cid">{c.id}</div>
                <div>{c.type} · {c.powerKw} kW {c.ultraFast ? '⚡' : ''}</div>
                <div className="cstatus">{c.status}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {telemetryFor && <Telemetry connectorId={telemetryFor} />}
      <p className="hint">Haz clic en un conector en CHARGING para ver su telemetría.</p>
    </div>
  );
}

function Telemetry({ connectorId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => gql(TELEMETRY_QUERY, { c: connectorId }).then((d) => alive && setRows(d.telemetry)).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [connectorId]);
  return (
    <div className="telemetry">
      <b>Telemetría {connectorId}</b>
      <table><thead><tr><th>Hora</th><th>kW</th><th>kWh</th><th>V</th><th>°C</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.timestamp}><td>{time(r.timestamp)}</td><td>{r.powerKw}</td><td>{r.energyKwh}</td><td>{r.voltage}</td><td>{r.temperatureC}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function ReserveForm({ data, flags, onDone }) {
  const connectors = useMemo(() => data.stations.flatMap((s) => s.connectors.map((c) => ({ ...c, stationName: s.name }))), [data.stations]);
  const [fleetId, setFleetId] = useState(data.wallets[0]?.fleetId || '');
  const [connectorId, setConnectorId] = useState('');
  const [kwh, setKwh] = useState(20);
  const [priority, setPriority] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [quote, setQuote] = useState(null);
  const boost = flags.ENABLE_FAST_CHARGE_BOOST;
  const visible = connectors.filter((c) => boost || !c.ultraFast);

  useEffect(() => { if (!boost) setPriority(false); }, [boost]);
  useEffect(() => {
    gql(QUOTE_QUERY, { k: Number(kwh) || 1, p: priority }).then((d) => setQuote(d.quote)).catch(() => setQuote(null));
  }, [kwh, priority, flags.ENABLE_DYNAMIC_SURGE_PRICING]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const d = await gql(START_MUTATION, { i: { fleetId, connectorId, estimatedKwh: Number(kwh), priority } });
      onDone(d.reserveAndStartCharging);
    } catch (err) {
      setMsg(err.message);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="form">
      <label>Flota
        <select value={fleetId} onChange={(e) => setFleetId(e.target.value)}>
          {data.wallets.map((w) => <option key={w.fleetId} value={w.fleetId}>{w.fleetName}</option>)}
        </select>
      </label>
      <label>Conector
        <select value={connectorId} onChange={(e) => setConnectorId(e.target.value)} required>
          <option value="">-- elige --</option>
          {visible.map((c) => <option key={c.id} value={c.id} disabled={c.status !== 'AVAILABLE'}>{c.id} · {c.powerKw} kW · {c.status}{c.ultraFast ? ' · ultra' : ''}</option>)}
        </select>
      </label>
      <label>Energía estimada (kWh)
        <input type="number" min="1" max="500" value={kwh} onChange={(e) => setKwh(e.target.value)} />
      </label>
      {boost ? (
        <label className="check"><input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> Reserva prioritaria ultra-carga (+20%)</label>
      ) : (
        <p className="hint">Ultra-carga prioritaria deshabilitada en este ambiente (ENABLE_FAST_CHARGE_BOOST=false).</p>
      )}
      {quote && (
        <p className="quote">Costo estimado: <b>{money(quote.amount, quote.currency)}</b> {quote.surgeApplied && <span className="tag surge">tarifa dinámica x1.5</span>}</p>
      )}
      <button disabled={busy || !connectorId}>{busy ? 'Ejecutando SAGA…' : 'Reservar y activar carga'}</button>
      {msg && <div className="banner error">{msg}</div>}
    </form>
  );
}

function Flags({ flags, onChange }) {
  const [busy, setBusy] = useState(null);
  async function toggle(f) {
    setBusy(f.name);
    try { await gql(SET_FLAG_MUTATION, { n: f.name, e: !f.enabled }); await onChange(); } finally { setBusy(null); }
  }
  return (
    <ul className="flags">
      {flags.map((f) => (
        <li key={f.name}>
          <div>
            <code>{f.name}</code>
            <small>{f.description}</small>
            <small>actualizada {time(f.updatedAt)} por {f.updatedBy || '—'}</small>
          </div>
          <button type="button" className={`toggle ${f.enabled ? 'on' : 'off'}`} onClick={() => toggle(f)} disabled={busy === f.name}>
            {f.enabled ? 'ON' : 'OFF'}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Transactions({ txs, onStop }) {
  const [open, setOpen] = useState(null);
  if (txs.length === 0) return <p className="hint">Aún no hay transacciones.</p>;
  return (
    <table className="txs">
      <thead><tr><th>Hora</th><th>SAGA / correlation_id</th><th>Flota</th><th>Conector</th><th>Monto</th><th>Estado</th><th>Motivo</th><th></th></tr></thead>
      <tbody>
        {txs.map((t) => (
          <React.Fragment key={t.sagaId}>
            <tr onClick={() => setOpen(open === t.sagaId ? null : t.sagaId)} className="clickable">
              <td>{time(t.createdAt)}</td>
              <td><code>{t.correlationId}</code></td>
              <td>{t.fleetId}</td>
              <td>{t.connectorId}</td>
              <td>{money(t.amount)}</td>
              <td><span className={`tag s-${t.status}`}>{t.status}</span></td>
              <td className="reason">{t.failureReason || ''}</td>
              <td>{t.status === 'COMPLETED' && (
                <button type="button" className="small" onClick={async (e) => { e.stopPropagation(); await gql(STOP_MUTATION, { s: t.sagaId }); onStop(); }}>Finalizar carga</button>
              )}</td>
            </tr>
            {open === t.sagaId && <tr><td colSpan="8"><SagaDetail saga={t} /></td></tr>}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

function SagaDetail({ saga, title }) {
  return (
    <div className="saga">
      {title && <b>{title}: <span className={`tag s-${saga.status}`}>{saga.status}</span></b>}
      <ol className="steps">
        {saga.steps.map((s, i) => (
          <li key={i} className={`step ${s.status}`}>
            <b>{s.name}</b> · {s.status} <small>{time(s.at)}</small>
            {s.detail && <div className="detail">{s.detail}</div>}
          </li>
        ))}
      </ol>
      <small>correlation_id: <code>{saga.correlationId}</code></small>
    </div>
  );
}
