# Formatea logs JSON de AegisVolt (stdin) en una línea legible por evento
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except ValueError:
        print(line); continue
    step = e.get("saga_step") or e.get("step") or ""
    extra = e.get("error") or e.get("reason") or ""
    print(f'{e.get("timestamp")} {e.get("level",""):5} {e.get("service",""):28} {e.get("message",""):30} step={step} {extra}')
