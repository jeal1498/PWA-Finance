/* Sincronización de Finanzas con tu cuenta (Supabase, tabla `copias`; ver auth.js).
   Guarda y trae la copia completa; `combinar()` junta lo de este teléfono con lo de la nube. */

import { haySesion, accessToken, SUPABASE_URL, SUPABASE_KEY } from './auth.js';

const KEY = 'finanzas_sync';

export function getCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* vacío */ }
  return c;
}
export function setCfg(patch) {
  const cfg = { ...getCfg(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ }
  return cfg;
}

/* Borrados: { 'movimientos:<id>' | 'metas:<id>' | 'p:<t>' (abono): fecha en ms }. Viajan en la copia de la nube
   para que lo que un teléfono borra no reaparezca al combinar con el otro. Se olvidan a los 180 días. */
const BKEY = 'finanzas_borrados';
export function borrados() {
  try { return JSON.parse(localStorage.getItem(BKEY)) || {}; } catch (e) { return {}; }
}
export function guardarBorrados(b) {
  const lim = Date.now() - 180 * 864e5;
  const out = {};
  for (const [k, v] of Object.entries(b || {})) if (Number.isFinite(+v) && +v > lim) out[k] = +v;
  try { localStorage.setItem(BKEY, JSON.stringify(out)); } catch (e) { /* sin almacenamiento */ }
}
export function marcarBorrado(key) { const b = borrados(); b[key] = Date.now(); guardarBorrados(b); }
export function quitarBorrado(keys) {
  const b = borrados(); let n = 0;
  for (const k of keys) if (k in b) { delete b[k]; n++; }
  if (n) guardarBorrados(b);
}

/* Combina lo de este teléfono con la copia de la nube.
   - Cada registro: gana la versión con `updatedAt` más reciente.
   - Abonos: se juntan por su marca `t` (los abonos nuevos de los dos lados se suman); un abono borrado (`p:<t>`) no vuelve.
   - Registro borrado: se quita si se borró después de su último cambio.
   - Copias de una serie que el otro teléfono saltó (`omitidos`) y sin abonos se quitan. */
const r2 = n => Math.round(n * 100) / 100;
function unirLista(store, loc, rem, bor) {
  const out = new Map(loc.map(x => [x.id, x]));
  for (const r of rem) {
    const l = out.get(r.id);
    if (!l) { out.set(r.id, r); continue; }
    const gana = (r.updatedAt || 0) > (l.updatedAt || 0) ? r : l, otro = gana === r ? l : r;
    const ts = new Set((gana.pagos || []).map(p => p.t).filter(Boolean));
    const extra = (otro.pagos || []).filter(p => p.t && !ts.has(p.t));
    out.set(r.id, extra.length ? { ...gana, pagos: [...(gana.pagos || []), ...extra] } : gana);
  }
  const lista = [];
  for (const x of out.values()) {
    const t = bor[`${store}:${x.id}`];
    if (t && t >= (x.updatedAt || 0)) continue;
    const pagos = x.pagos || [];
    const quedan = pagos.filter(p => !(p.t && bor[`p:${p.t}`]));
    lista.push(quedan.length !== pagos.length ? { ...x, pagos: quedan, abo: r2(quedan.reduce((s, p) => s + p.monto, 0)) } : x.abo !== r2(pagos.reduce((s, p) => s + p.monto, 0)) ? { ...x, abo: r2(pagos.reduce((s, p) => s + p.monto, 0)) } : x);
  }
  const omit = new Map();
  lista.forEach(x => {
    if (!x.serie || !Array.isArray(x.omitidos)) return;
    if (!omit.has(x.serie)) omit.set(x.serie, new Set());
    x.omitidos.forEach(f => omit.get(x.serie).add(f));
  });
  return lista.filter(x => !(x.serie && !(x.abo > 0) && omit.has(x.serie) && omit.get(x.serie).has(x.fecha)));
}
export function combinar(local, remoto) {
  const bor = { ...(remoto.borrados || {}) };
  for (const [k, v] of Object.entries(local.borrados || {})) bor[k] = Math.max(bor[k] || 0, v);
  return {
    movimientos: unirLista('movimientos', local.movimientos, remoto.movimientos || [], bor),
    metas: unirLista('metas', local.metas, remoto.metas || [], bor),
    borrados: bor
  };
}

export const connection = () => (haySesion() ? { nube: true } : null);

/* Envía la copia a la nube. Seguros: nunca envía con la base caída ni vacía, y si hay mucho menos que en la última copia
   pide confirmar (`force`). */
export async function push(movimientos, metas, { force = false, dbOk = true } = {}) {
  if (!connection()) throw new Error('Inicia sesión para sincronizar');
  if (!dbOk) throw new Error('No se pudo abrir el almacenamiento de este teléfono; no se envía para no borrar tu copia.');
  const total = movimientos.length + metas.length;
  /* Una app vacía nunca sobrescribe la copia (así se perdieron los datos una vez). */
  if (!total) throw new Error('La app está vacía; no se envía para no borrar tu copia. Importa tus datos o espera a que se sincronice.');
  const antes = getCfg().count || 0;
  if (!force && antes >= 10 && total < antes * 0.5) {
    const e = new Error(`Ahora hay ${total} registros y la última copia tenía ${antes}; no se envía para no borrar tu copia.`);
    e.code = 'drop'; e.total = total; e.antes = antes;
    throw e;
  }
  await nubePush({ app: 'finanzas', movimientos, metas, borrados: borrados() });
  setCfg({ last: Date.now(), error: '', count: total });
}

/* Trae la última copia de la nube: { movimientos, metas, borrados } (o null si aún no hay). */
export async function pull() {
  if (!connection()) throw new Error('Inicia sesión para sincronizar');
  return nubePull();
}

/* ---- Supabase: una copia completa por cuenta (tabla `copias`, solo la ve su dueño por RLS) ---- */
export async function nube(ruta, opts = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Tu sesión venció. Vuelve a iniciar sesión.');
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined;
  let res;
  try {
    res = await fetch(SUPABASE_URL + ruta, { ...opts, signal, headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  } catch (e) { throw new Error(e && e.name === 'TimeoutError' ? 'La nube tardó demasiado en responder. Intenta de nuevo.' : navigator.onLine === false ? 'Sin conexión a internet' : 'No se pudo conectar con la nube.'); }
  if (!res.ok) {
    let msg = ''; try { msg = (await res.json()).message || ''; } catch (e) { /* sin cuerpo */ }
    throw new Error(res.status === 401 ? 'Tu sesión venció. Vuelve a iniciar sesión.' : msg || `La nube respondió ${res.status}`);
  }
  return res;
}
async function nubePull() {
  const rows = await (await nube('/rest/v1/copias?select=datos')).json();
  return rows.length ? rows[0].datos : null;
}
/* Crea la cuenta (hogar) de quien entra por primera vez; una vez por carga de la app. */
let hogarId = '';
async function asegurar() {
  if (hogarId) return hogarId;
  hogarId = await (await nube('/rest/v1/rpc/asegurar_hogar', { method: 'POST', body: '{}' })).json();
  return hogarId;
}
/* Al unirse o salir de una cuenta compartida el hogar cambia: se olvida el guardado. */
export const olvidarHogar = () => { hogarId = ''; };
async function nubePush(datos) {
  const enviar = async () => {
    const hogar_id = await asegurar();
    await nube('/rest/v1/copias?on_conflict=hogar_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ hogar_id, datos, updated_at: new Date().toISOString() }) });
  };
  try { await enviar(); }
  catch (e) {
    /* Si el hogar cambió desde otro teléfono (o por aceptar una invitación), se vuelve a preguntar una vez. */
    if (!/row-level security/i.test(e.message || '')) throw e;
    olvidarHogar(); await enviar();
  }
}
