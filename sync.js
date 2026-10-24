/* Sincronización manual de Finanzas con la hoja de Google que ya usa SecondBrain (mismo script y mismo archivo).
   Escribe solo en sus propias pestañas («Finanzas · Pagos» y «Finanzas · Metas») y solo cuando tú lo pides.
   Reusa la conexión del respaldo (URL y clave) y manda además la copia exacta completa para no dañar la hoja oculta
   «_respaldo» que usa SecondBrain para restaurar. */
import * as db from './js/db.js';
import * as backup from './js/backup.js';

const KEY = 'finanzas_sync';

export function getCfg() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
export function setCfg(patch) {
  const cfg = { ...getCfg(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ }
  return cfg;
}

const abonosTxt = v => (v || []).map(p => `${p.fecha || 'sin fecha'}: ${p.monto}`).join(' · ');
/* Un texto que empieza con "=" Google lo tomaría como fórmula. */
const cell = v => (v == null ? '' : typeof v === 'string' && /^[=+@-]/.test(v) ? "'" + v : v);

function table(name, headers, items, cols) {
  return {
    name,
    headers,
    rows: [...items].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map(x => cols.map(([k, f]) => cell(f ? f(x[k]) : x[k])))
  };
}

export function tables(movimientos, metas) {
  return [
    table('Finanzas · Pagos', ['Fecha límite', 'Concepto', 'Importe', 'Abonado', 'Categoría', 'Abonos'], movimientos,
      [['fecha'], ['conc'], ['imp'], ['abo'], ['cat'], ['pagos', abonosTxt]]),
    table('Finanzas · Metas', ['Para cuándo', 'Concepto', 'Monto', 'Ahorrado', 'Categoría', 'Abonos'], metas,
      [['fecha'], ['conc'], ['imp'], ['abo'], ['cat'], ['pagos', abonosTxt]])
  ];
}

const NET_HELP = 'Google no respondió. Revisa en SecondBrain → Respaldo que la hoja siga conectada y haz una prueba allá.';
async function call(url, opts) {
  let res;
  try { res = await fetch(url, opts); } catch (e) { throw new Error(navigator.onLine === false ? 'Sin conexión a internet' : NET_HELP); }
  try { return await res.json(); } catch (e) { throw new Error(NET_HELP); }
}

/* La conexión es la del respaldo de SecondBrain; si no existe, no hay a dónde sincronizar. */
export async function connection() {
  const cfg = await backup.getConfig();
  return cfg && cfg.url ? cfg : null;
}

/* Envía los pagos y metas a sus pestañas. Body como text/plain para que el navegador no haga preflight. */
export async function push(movimientos, metas) {
  const cfg = await connection();
  if (!cfg) throw new Error('Primero conecta la hoja en SecondBrain → Respaldo');
  const data = await db.exportAll();
  const out = await call(cfg.url, { method: 'POST', body: JSON.stringify({ token: cfg.token, tables: tables(movimientos, metas), raw: JSON.stringify(data) }) });
  if (!out.ok) throw new Error(out.error || 'Error en la hoja');
  setCfg({ last: Date.now(), error: '' });
}

/* Trae de la hoja la última copia exacta: { movimientos, metas }. */
export async function pull() {
  const cfg = await connection();
  if (!cfg) throw new Error('Primero conecta la hoja en SecondBrain → Respaldo');
  const out = await call(backup.testUrl(cfg));
  if (!out.ok) throw new Error(out.error || 'Error en la hoja');
  return out.data;
}
