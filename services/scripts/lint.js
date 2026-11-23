// Lint mínimo sin dependencias: verifica la sintaxis de todos los .js (node --check).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['shared', 'station-reservation-service', 'billing-wallet-service', 'energy-dispatch-service', 'graphql-gateway', 'scripts', 'test'];
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  if (f === 'node_modules') return;
  if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
});
roots.forEach(walk);
let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.error(`✗ ${f}\n${e.stderr}`); }
}
console.log(`lint: ${files.length - failed}/${files.length} archivos OK`);
process.exit(failed ? 1 : 0);
