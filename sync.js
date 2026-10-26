/* Respaldo de Finanzas en una hoja de Google propia (Apps Script, ver apps-script/Code.gs).
   Escribe las pestañas «Finanzas · Pagos» y «Finanzas · Metas» y una copia exacta oculta para poder restaurar.
   La conexión (URL y clave) vive en este teléfono; con «auto» se envía sola después de cada cambio. */

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

const NET_HELP = 'Google no respondió. Revisa que la implementación tenga acceso «Cualquier persona», que la URL termine en /exec y que la clave sea la misma del script.';
async function call(url, opts) {
  let res;
  try { res = await fetch(url, opts); } catch (e) { throw new Error(navigator.onLine === false ? 'Sin conexión a internet' : NET_HELP); }
  try { return await res.json(); } catch (e) { throw new Error(NET_HELP); }
}

export function connection() {
  const { url, token } = getCfg();
  return url && token ? { url, token } : null;
}

/* Envía los pagos y metas. Body como text/plain para que el navegador no haga preflight.
   Seguros: nunca envía con la base caída ni vacía, y si hay mucho menos que en la última copia pide confirmar (`force`). */
export async function push(movimientos, metas, { force = false, dbOk = true } = {}) {
  const cfg = connection();
  if (!cfg) throw new Error('Primero conecta tu hoja');
  if (!dbOk) throw new Error('No se pudo abrir el almacenamiento de este teléfono; no se envía para no borrar la hoja.');
  const total = movimientos.length + metas.length;
  /* Una app vacía nunca sobrescribe la hoja (así se perdieron los datos una vez). */
  if (!total) throw new Error('La app está vacía; no se envía para no borrar la hoja. Importa tus datos o usa «Traer de la hoja».');
  const antes = getCfg().count || 0;
  if (!force && antes >= 10 && total < antes * 0.5) {
    const e = new Error(`Ahora hay ${total} registros y la última copia tenía ${antes}; no se envía para no borrar la hoja.`);
    e.code = 'drop'; e.total = total; e.antes = antes;
    throw e;
  }
  const raw = JSON.stringify({ app: 'finanzas', movimientos, metas });
  const out = await call(cfg.url, { method: 'POST', body: JSON.stringify({ token: cfg.token, tables: tables(movimientos, metas), raw, force }) });
  if (!out.ok) throw new Error(out.error || 'Error en la hoja');
  setCfg({ last: Date.now(), error: '', count: total });
}

/* Trae de la hoja la última copia exacta: { movimientos, metas } (o null si aún no hay). */
export async function pull() {
  const cfg = connection();
  if (!cfg) throw new Error('Primero conecta tu hoja');
  const out = await call(`${cfg.url}${cfg.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(cfg.token)}`);
  if (!out.ok) throw new Error(out.error || 'Error en la hoja');
  return out.data;
}
