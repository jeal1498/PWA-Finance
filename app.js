import * as db from './js/db.js';
import * as sync from './sync.js';
import { migrateFinance } from './js/migrar-finanzas.js';
import { parseImport, exportJSON, exportCSV, templateCSV } from './datos.js';

/* =========================================================
   Utilidades
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (arr, k) => arr.reduce((t, m) => t + (m[k] || 0), 0);

const MS_DAY = 86400000;
const hoyLocal = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
let HOY = hoyLocal();
/* «Hoy» se recalcula en cada pantalla, al volver a la app y a medianoche (si no, un día abierto la app queda con las fechas corridas). */
function refrescarHoy() {
  const h = hoyLocal();
  if (toISO(h) === toISO(HOY)) return false;
  const eraActual = isCurrentMonth();
  HOY = h;
  if (eraActual) state.month = { year: h.getFullYear(), month: h.getMonth() };
  return true;
}
const parseDate = s => new Date(s + 'T00:00:00');
const daysFromToday = d => Math.round((d - HOY) / MS_DAY);
const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const fmtMoney = n => {
  const v = Number(n) || 0;
  const frac = Number.isInteger(v) ? 0 : 2;
  return '$' + v.toLocaleString('es-MX', { minimumFractionDigits: frac, maximumFractionDigits: frac });
};
const fmtDate = s => { const d = parseDate(s); return `${d.getDate()} ${MESES_CORTO[d.getMonth()]}`; };
const fmtDateFull = s => { const d = parseDate(s); return `${d.getDate()} ${MESES_CORTO[d.getMonth()]} ${d.getFullYear()}`; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const svg = (d, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>')
};

/* =========================================================
   Categorías (el texto guardado es "emoji Nombre", igual que antes)
   ========================================================= */
const CATS = [
  { id: 'Finanzas',  emoji: '🏛️', icon: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>' },
  { id: 'Vehículo',  emoji: '🚗', icon: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>' },
  { id: 'Yo',        emoji: '👤', mono: 'Y' },
  { id: 'Karen',     emoji: '👩', mono: 'K' },
  { id: 'Julieta',   emoji: '👧', mono: 'J' },
  { id: 'Servicios', emoji: '💡', icon: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>' },
  { id: 'Familia',   emoji: '👨‍👩‍👧‍👦', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' }
];
const TAG_ICON = '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>';
/* El texto guardado sigue siendo "emoji Nombre"; en pantalla se dibuja el icono SVG. */
const catIcon = c => c.mono ? `<span class="mono" aria-hidden="true">${c.mono}</span>` : svg(c.icon || TAG_ICON);
const catString = c => `${c.emoji} ${c.id}`;
const catLabelOf = str => { const s = String(str); const i = s.indexOf(' '); return i >= 0 ? s.slice(i + 1) : s; };
/* Conceptos con el mismo nombre se relacionan (sin importar mayúsculas, acentos ni espacios dobles). */
const llave = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/* Clave de relación: mismo nombre Y misma categoría (un «Gym» de Yo y uno de Karen no se mezclan). */
const llaveC = x => llave(x.conc) + '|' + llave(catLabelOf(x.cat));
const catOf = str => CATS.find(c => c.id === catLabelOf(str)) || { id: catLabelOf(str), emoji: '•' };

/* =========================================================
   Persistencia: IndexedDB de SecondBrain (stores "movimientos" y "metas").
   Lo que solo es de esta pantalla (tema, agrupación) queda en localStorage.
   ========================================================= */
const KEYS = { theme: 'finanzas_theme', group: 'finanzas_grouping', hint: 'finanzas_hint_swipe', view: 'finanzas_vista', cat: 'finanzas_ultima_cat' };
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

const byFecha = (a, b) => String(a.fecha).localeCompare(String(b.fecha));
let movimientos = [], metas = [], dbOk = true;
try { await migrateFinance(); } catch (e) { console.error('Migración de finanzas', e); }
try {
  movimientos = (await db.all('movimientos')).sort(byFecha);
  metas = (await db.all('metas')).sort(byFecha);
} catch (e) { dbOk = false; }

/* Pagos que se repiten: cada serie crea sola la copia pendiente de cada mes, hasta el mes siguiente
   o hasta su fecha de fin (`fin`). */
function generarRepetidos(hasta) {
  generarSeries(movimientos, 'movimientos', hasta);
  generarSeries(metas, 'metas', hasta);
}

/* Frecuencias: por días (semanal, quincenal) o por meses (mensual, bimestral, anual). `repite: true` + `freq` (sin `freq` = mensual). */
const FREQS = {
  semanal:   { label: 'Semanal',   dias: 7 },
  quincenal: { label: 'Quincenal', dias: 15 },
  mensual:   { label: 'Mensual',   meses: 1 },
  bimestral: { label: 'Bimestral', meses: 2 },
  anual:     { label: 'Anual',     meses: 12 }
};
const freqOf = m => FREQS[m.freq] ? m.freq : 'mensual';
const REP_PATH = '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>';
const repIcon = m => m.repite && m.serie ? `<svg class="rep-ic" viewBox="0 0 24 24" role="img" aria-label="Se repite: ${FREQS[freqOf(m)].label.toLowerCase()}"><title>Se repite: ${FREQS[freqOf(m)].label.toLowerCase()}</title>${REP_PATH}</svg>` : '';

/* `soloSerie`: al guardar un pago que se repite, rellena también los meses que falten entre el primero y `hasta`
   (p. ej. una copia que se eliminó mientras ya existían meses posteriores). `hasta` = mes (año*12+mes) hasta el que se crean copias. */
function generarSeries(lista, store, hasta, soloSerie) {
  const series = new Map();
  lista.forEach(m => { if (m.serie) (series.get(m.serie) || series.set(m.serie, []).get(m.serie)).push(m); });
  const nuevos = [];
  const limite = toISO(new Date(Math.floor(hasta / 12), hasta % 12 + 1, 0));
  /* No se crean copias de más de 3 meses atrás (una fecha vieja no llena la lista de vencidos). */
  const limitePasado = toISO(new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate() - 92));
  const crear = (serie, ult, f, id) => {
    const now = Date.now();
    nuevos.push({ id, fecha: f, cat: ult.cat, conc: ult.conc, imp: ult.imp, abo: 0, pagos: [], serie, repite: true, ...(ult.freq ? { freq: ult.freq } : {}), ...(ult.fin ? { fin: ult.fin } : {}), createdAt: now, updatedAt: now });
  };
  series.forEach((items, serie) => {
    if (soloSerie && serie !== soloSerie) return;
    items.sort(byFecha);
    const ult = items[items.length - 1];
    if (!ult.repite) return;
    const fr = FREQS[freqOf(ult)];
    const omit = new Set(items.flatMap(m => m.omitidos || []));
    if (fr.dias) {
      /* Por días: desde el último pago, cada N días, solo fechas de hoy en adelante. */
      const hoy = toISO(HOY);
      let d = parseDate(ult.fecha);
      for (let k = 0; k < 400; k++) {
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + fr.dias);
        const f = toISO(d);
        if (f > limite || (ult.fin && f > ult.fin)) break;
        if (f < hoy || omit.has(f) || items.some(m => m.fecha === f)) continue;
        crear(serie, ult, f, `${serie}-${f.replace(/-/g, '')}`);
      }
      return;
    }
    /* Por meses: el mismo día del primero, cada N meses. */
    const base = parseDate(items[0].fecha), dia = base.getDate(), ocupado = new Set(items.map(m => m.fecha.slice(0, 7)));
    const ultIdx = parseDate(ult.fecha).getFullYear() * 12 + parseDate(ult.fecha).getMonth();
    for (let k = 1; k < 600; k++) {
      const idx = base.getFullYear() * 12 + base.getMonth() + k * fr.meses;
      if (idx > hasta) break;
      if (!soloSerie && idx <= ultIdx) continue;
      const y = Math.floor(idx / 12), mo = idx % 12;
      const f = toISO(new Date(y, mo, Math.min(dia, new Date(y, mo + 1, 0).getDate())));
      if (ult.fin && f > ult.fin) break;
      if (f < limitePasado || omit.has(f)) continue;
      const id = `${serie}-${y}${String(mo + 1).padStart(2, '0')}`;
      if (items.some(m => m.id === id) || (soloSerie && ocupado.has(f.slice(0, 7)))) continue;
      crear(serie, ult, f, id);
    }
  });
  if (!nuevos.length) return;
  lista.push(...nuevos);
  lista.sort(byFecha);
  dbBatch({ [store]: { put: nuevos } }).then(autoSync, e => console.error('Pagos repetidos', e));
}

const storeOf = kind => kind === 'meta' ? 'metas' : 'movimientos';
/* Guarda un registro (o lo borra). Con la hoja conectada y «auto», se envía sola unos segundos después. */
let autoTimer;
function autoSync() {
  const cfg = sync.getCfg();
  if (!cfg.auto || !sync.connection()) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    try { await sync.push(movimientos, metas, { dbOk }); }
    catch (e) { sync.setCfg({ error: e.message || 'No se pudo sincronizar' }); }
  }, 4000);
}
/* Varias pestañas: cada cambio avisa a las demás para que vuelvan a leer la base (si no, la que quedó vieja pisaría los abonos). */
const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel('finanzas-datos') : null;
const avisar = () => { try { canal && canal.postMessage(1); } catch (e) { /* sin canal */ } };
let recargaPendiente = false;
async function recargarDatos() {
  if (!sheet.el.hidden) { recargaPendiente = true; return; }
  try {
    const [mov, met] = await Promise.all([db.all('movimientos'), db.all('metas')]);
    movimientos = mov.sort(byFecha); metas = met.sort(byFecha);
    recargaPendiente = false;
    render();
  } catch (e) { /* se queda con lo que hay */ }
}
if (canal) canal.onmessage = () => recargarDatos();
const dbBatch = async ops => { await db.batch(ops); avisar(); };

async function persist(kind, item) {
  try {
    item.updatedAt = Date.now();
    if (!item.createdAt) item.createdAt = item.updatedAt;
    await db.put(storeOf(kind), item);
    avisar();
    autoSync();
    return true;
  } catch (e) { return false; }
}
async function unpersist(kind, id) {
  try {
    await db.remove(storeOf(kind), id);
    avisar();
    autoSync();
    return true;
  } catch (e) { return false; }
}

/* Historial de abonos: cada movimiento guarda pagos [{fecha, monto}]; abo es la suma. */
const r2 = n => Math.round(n * 100) / 100;
const syncAbo = m => { m.abo = r2((m.pagos || []).reduce((t, p) => t + p.monto, 0)); };
/* Lo que ya tenía abonado y no tiene historial pasa a un solo abono sin fecha. */
[movimientos, metas].forEach(list => list.forEach(m => { if (!Array.isArray(m.pagos)) m.pagos = m.abo > 0 ? [{ fecha: null, monto: m.abo }] : []; }));

const VISTAS = ['gastos', 'metas', 'apartar', 'perfil'];
const vista0 = VISTAS.includes(lsGet(KEYS.view)) ? lsGet(KEYS.view) : 'gastos';
const state = {
  view: vista0,
  filter: vista0 === 'metas' ? 'todas' : 'todos',
  grouping: lsGet(KEYS.group) === 'urgencia' ? 'urgencia' : 'categoria',
  month: { year: HOY.getFullYear(), month: HOY.getMonth() },
  open: {},
  search: '',
  sort: { col: 'fecha', asc: true },
  sortMetas: { col: 'fecha', asc: true },
  apartar: 'dia'
};
const isCurrentMonth = () => state.month.year === HOY.getFullYear() && state.month.month === HOY.getMonth();

/* =========================================================
   Modelo: estados y textos
   ========================================================= */
function procesar(m) {
  const date = parseDate(m.fecha);
  const saldo = m.imp - m.abo;
  let estado = 'Pendiente';
  let pendiente = saldo;
  if (saldo <= 0) { estado = 'Pagado'; pendiente = 0; }
  else if (date < HOY) estado = 'Vencido';
  return { ...m, date, estado, pendiente };
}

function gastoInfo(m) {
  const done = m.estado === 'Pagado';
  const d = daysFromToday(m.date);
  let tone, text;
  if (done) { tone = 'ok'; text = 'Pagado'; }
  else if (m.estado === 'Vencido') { tone = 'danger'; text = d === -1 ? 'Venció ayer' : `Venció hace ${-d} días`; }
  else if (d === 0) { tone = 'warn'; text = 'Vence hoy'; }
  else if (d === 1) { tone = 'warn'; text = 'Vence mañana'; }
  else { tone = d <= 7 ? 'warn' : 'muted'; text = `Vence en ${d} días`; }
  const pct = m.imp > 0 ? Math.min(100, Math.round(m.abo / m.imp * 100)) : 0;
  return { done, tone, text, pct, pend: m.pendiente, partial: m.abo > 0 && !done, plan: '' };
}

function procesarMeta(m) {
  return { ...m, date: parseDate(m.fecha) };
}

function metaInfo(m) {
  const d = daysFromToday(parseDate(m.fecha));
  const sinMonto = m.imp === 0;
  const done = m.imp > 0 && m.abo >= m.imp;
  const pend = Math.max(0, m.imp - m.abo);
  const pct = m.imp > 0 ? Math.min(100, Math.round(m.abo / m.imp * 100)) : 0;
  let tone = 'muted', text = '', plan = '';
  if (sinMonto) { text = 'Monto por definir'; }
  else if (done) { tone = 'ok'; text = 'Alcanzada'; }
  else if (d < 0) { tone = 'danger'; text = d === -1 ? 'Se atrasó 1 día' : `Atrasada ${-d} días`; }
  else if (d === 0) { tone = 'warn'; text = 'Vence hoy'; }
  else {
    tone = d <= 30 ? 'warn' : 'muted';
    if (d === 1) text = 'Falta 1 día';
    else if (d < 60) text = `Faltan ${d} días`;
    else if (d < 730) text = `Faltan ${Math.round(d / 30.44)} meses`;
    else text = `Faltan ${(d / 365.25).toFixed(1).replace(/\.0$/, '')} años`;
    plan = d <= 45 ? `${fmtMoney(Math.ceil(pend / d))} al día` : `${fmtMoney(Math.ceil(pend / (d / 30.44)))} al mes`;
  }
  return { done, sinMonto, tone, text, plan, pct, pend, partial: m.abo > 0 && !done, d };
}

/* Orden de las listas: por fecha y, dentro de un mismo día, del monto menor al mayor. */
const montoVisible = m => m.estado === undefined ? Math.max(0, m.imp - m.abo) : (m.estado === 'Pagado' ? m.imp : m.pendiente);
const porFechaYMonto = (a, c) => (a.date - c.date) || (montoVisible(a) - montoVisible(c)) || a.conc.localeCompare(c.conc, 'es');

function urgenciaKey(m) {
  if (m.estado === 'Pagado') return 'pagado';
  const d = daysFromToday(m.date);
  if (d < 0) return 'vencido';
  if (d === 0) return 'hoy';
  if (d <= 7) return 'semana';
  if (d <= 14) return 'quincena';
  if (d <= 31) return 'mes';
  return 'despues';
}
const URGENCIA = {
  vencido:  { label: 'Vencidos',           hint: 'Fecha pasada',  color: 'var(--danger)' },
  hoy:      { label: 'Hoy',                hint: 'Vencen hoy',        color: 'var(--warn)' },
  semana:   { label: 'Esta semana',        hint: 'Hasta 7 días',   color: 'var(--warn)' },
  quincena: { label: 'Próximas 2 semanas', hint: '8 a 14 días',       color: 'var(--muted)' },
  mes:      { label: 'Este mes',           hint: '15 a 31 días',      color: 'var(--muted)' },
  despues:  { label: 'Más adelante',       hint: 'Más de 31 días',    color: 'var(--muted)' },
  pagado:   { label: 'Pagados',            hint: 'Liquidados',        color: 'var(--ok)' }
};
const URGENCIA_ORDER = ['vencido', 'hoy', 'semana', 'quincena', 'mes', 'despues', 'pagado'];

function plazoKey(m) {
  if (m.imp > 0 && m.abo >= m.imp) return 'alcanzada';
  if (m.imp === 0) return 'proxima';
  const d = daysFromToday(parseDate(m.fecha));
  if (d < 0) return 'vencida';
  if (d <= 180) return 'proxima';
  return 'largo';
}

/* =========================================================
   Construcción de datos por vista
   ========================================================= */
/* Pagos del mes: los movimientos con fecha en el mes y los «Planes» (metas con monto) que caen en él. */
const enMes = d => d.getFullYear() === state.month.year && d.getMonth() === state.month.month;
function monthItems() {
  /* Solo pagos (los planes viven en Planear y en Apartar), del mes que se ve; en el mes actual también salen los atrasados de meses anteriores (siguen sin pagarse). */
  const inicio = new Date(state.month.year, state.month.month, 1);
  const pagos = movimientos.map(procesar).filter(m => enMes(m.date) || (isCurrentMonth() && m.estado === 'Vencido' && m.date < inicio));
  return pagos;
}

/* Mosaicos de Pagar: «Pagado» = con algún abono; «Pagar ya» = pendiente que venció o vence hoy; «Por vencer» = pendiente de mañana en adelante. */
function pasaFiltro(m, f) {
  const d = daysFromToday(m.date);
  if (f === 'pagado') return m.abo > 0;
  if (f === 'vencido') return m.pendiente > 0 && d <= 0;
  if (f === 'pendiente') return m.pendiente > 0 && d > 0;
  return m.estado.toLowerCase() === f;
}

function buildGastos() {
  const all = movimientos.map(procesar);
  const isUrg = state.grouping === 'urgencia';
  const base = monthItems();
  const q = state.search.trim().toLowerCase();
  const items = base.filter(m =>
    (state.filter === 'todos' || pasaFiltro(m, state.filter)) &&
    (!q || `${m.conc} ${m.cat}`.toLowerCase().includes(q))
  );
  return { all, base, items, isUrg, q };
}

function buildMetas() {
  const base = metas.map(procesarMeta);
  const q = state.search.trim().toLowerCase();
  const items = base.filter(m =>
    (state.filter === 'todas' || (state.filter === 'porlograr' ? ['proxima', 'largo'].includes(plazoKey(m)) : plazoKey(m) === state.filter)) &&
    (!q || `${m.conc} ${m.cat}`.toLowerCase().includes(q))
  );
  return { base, items, q };
}

/* =========================================================
   Render: resumen
   ========================================================= */
function renderHeroGastos(b) {
  $('#kpi-dash').innerHTML = kpiDashboard(b.base);
  $('#kpi-dash').hidden = false;
}

function renderHeroMetas(b) {
  const base = b.base;
  const totalObj = sum(base, 'imp'), totalAbo = sum(base, 'abo');
  const pend = base.reduce((t, m) => t + (m.imp > 0 ? Math.max(0, m.imp - m.abo) : 0), 0);
  const faltante = m => m.imp > 0 ? Math.max(0, m.imp - m.abo) : 0;
  /* Meta diaria de los planes: lo que hay que ahorrar hoy para llegar a la fecha de cada plan con saldo (redondeado hacia arriba por plan). */
  const metaDiaPlanes = base.filter(m => faltante(m) > 0 && daysFromToday(m.date) > 0).reduce((t, m) => t + Math.ceil(faltante(m) / daysFromToday(m.date)), 0);
  const alcanzadas = base.filter(m => plazoKey(m) === 'alcanzada');
  const vencidas = base.filter(m => plazoKey(m) === 'vencida');
  const enCurso = base.filter(m => ['proxima', 'largo'].includes(plazoKey(m)));
  const atrasado = vencidas.reduce((t, m) => t + faltante(m), 0);
  const porLograr = enCurso.reduce((t, m) => t + faltante(m), 0);
  const pct = totalObj > 0 ? Math.round(totalAbo / totalObj * 100) : 0;

  const tiles = [
    { k: 'a', filter: 'alcanzada', label: 'Ahorrado', v: totalAbo, sub: `${pct}% del total` },
    { k: 'm', filter: 'porlograr', label: 'Por lograr', v: porLograr, sub: plural(enCurso.length, 'plan', 'planes') },
    { k: 'b', filter: 'vencida', label: 'Atrasada', v: atrasado, sub: plural(vencidas.length, 'plan', 'planes') }
  ].map(t => {
    const on = state.filter === t.filter;
    return `<button type="button" class="kpi-lg lg-${t.k}" data-action="filter" data-filter="${on ? 'todas' : t.filter}" aria-pressed="${on}"><span class="kpi-lg-t">${t.label}</span><span><span class="kpi-lg-m">${fmtMoney(t.v)}</span><span class="kpi-s">${t.sub}</span></span></button>`;
  }).join('');

  $('#kpi-dash').innerHTML = `
    <div class="kpi-split">
      <div class="kpi-half"><span class="kpi-sec">META DIARIA</span><span class="kpi-pv">${fmtMoney(metaDiaPlanes)}</span><span class="kpi-s">por día</span></div>
      <span class="kpi-div" aria-hidden="true"></span>
      <button type="button" class="kpi-half" data-action="filter" data-filter="todas" aria-pressed="${state.filter === 'todas'}"><span class="kpi-sec">META TOTAL</span><span class="kpi-pv">${fmtMoney(totalObj)}</span><span class="kpi-s">${plural(alcanzadas.length, 'alcanzada', 'alcanzadas')}</span></button>
    </div>
    <div class="kpi-legend">${tiles}</div>`;
  $('#kpi-dash').hidden = false;
}

/* =========================================================
   Render: filtros
   ========================================================= */

function renderMonthControls() {
  const urg = state.grouping === 'urgencia';
  $('#month-text').textContent = `${MESES[state.month.month]} ${state.month.year}`;
  $('#g-cat').setAttribute('aria-pressed', String(!urg));
  $('#g-urg').setAttribute('aria-pressed', String(urg));
}

/* =========================================================
   Render: filas y grupos
   ========================================================= */
function tileHTML(tone, big, small) {
  return `<span class="tile ${tone === 'muted' ? '' : tone}"><b>${big}</b><i>${small}</i></span>`;
}

function gastoRow(m, showCat) {
  const i = gastoInfo(m);
  const c = catOf(m.cat);
  return `<button type="button" class="row" data-action="open" data-kind="gasto" data-id="${esc(m.id)}">
    ${tileHTML(i.tone, m.date.getDate(), MESES_CORTO[m.date.getMonth()])}
    <span class="row-main">
      <span class="row-title">${showCat ? `<span class="row-emoji" aria-hidden="true">${catIcon(c)}</span>` : ''}${esc(m.conc)}</span>
      <span class="row-status t-${i.tone}">${i.done ? ICON.check : ''}${i.text}</span>
      ${i.partial ? `<span class="mini"><span style="width:${i.pct}%"></span></span>` : ''}
    </span>
    <span class="row-amount">
      <span class="amt${i.done ? ' muted' : ''}">${fmtMoney(i.done ? m.imp : i.pend)}</span>
      ${i.partial ? `<span class="amt-sub">de ${fmtMoney(m.imp)}</span>` : ''}
    </span>
  </button>`;
}

function openState(key, fallback) {
  if (state.search.trim()) return true;
  return key in state.open ? state.open[key] : fallback;
}

let groupSeq = 0;
function groupHTML(g) {
  const bid = 'gb' + (++groupSeq);
  return `<section class="group${g.open ? ' open' : ''}" style="--g:${g.color}">
    <h2 class="group-h"><button type="button" class="group-head" data-action="toggle-group" data-gkey="${esc(g.key)}" aria-expanded="${g.open}" aria-controls="${bid}">
      <span class="group-icon">${g.icon}</span>
      <span class="group-meta"><span class="group-name">${esc(g.name)}</span><span class="group-sub">${esc(g.sub)}</span></span>
      <span class="group-total"><span class="group-amount${g.muted ? ' muted' : ''}">${g.amount}</span><span class="group-amount-sub">${g.amountLabel}</span></span>
      ${ICON.chev}
    </button></h2>
    <div class="group-body" id="${bid}">${g.rows}</div>
  </section>`;
}

function groupsGastos(b) {
  const out = [];
  if (b.isUrg) {
    const buckets = {};
    b.items.forEach(m => { const k = urgenciaKey(m); (buckets[k] = buckets[k] || []).push(m); });
    URGENCIA_ORDER.forEach(k => {
      const arr = buckets[k];
      if (!arr) return;
      arr.sort(porFechaYMonto);
      const cfg = URGENCIA[k];
      const pend = sum(arr, 'pendiente'), imp = sum(arr, 'imp');
      const key = `u|${k}`;
      out.push({
        key, name: cfg.label, color: cfg.color, icon: '<span class="dot"></span>',
        sub: `${cfg.hint}, ${plural(arr.length, 'pago', 'pagos')}`,
        amount: fmtMoney(pend > 0 ? pend : imp), amountLabel: pend > 0 ? 'por pagar' : 'pagado', muted: pend <= 0,
        open: openState(key, ['vencido', 'hoy', 'semana'].includes(k)),
        rows: arr.map(m => gastoRow(m, true)).join('')
      });
    });
  } else {
    const map = new Map();
    b.items.forEach(m => {
      const c = catOf(m.cat);
      if (!map.has(c.id)) map.set(c.id, { c, items: [] });
      map.get(c.id).items.push(m);
    });
    const order = { Vencido: 0, Pendiente: 1, Pagado: 2 };
    const groups = Array.from(map.values()).map(g => {
      g.pend = sum(g.items, 'pendiente'); g.imp = sum(g.items, 'imp'); g.abo = sum(g.items, 'abo');
      g.venc = g.items.filter(m => m.estado === 'Vencido').length;
      return g;
    }).sort((a, c) => (c.venc > 0) - (a.venc > 0) || c.pend - a.pend || a.c.id.localeCompare(c.c.id));
    groups.forEach(g => {
      g.items.sort((a, c) => order[a.estado] - order[c.estado] || porFechaYMonto(a, c));
      const pct = g.imp > 0 ? Math.round(g.abo / g.imp * 100) : 0;
      const key = `c|${g.c.id}`;
      out.push({
        key, name: g.c.id, color: 'var(--ink)', icon: catIcon(g.c),
        sub: `${plural(g.items.length, 'gasto', 'gastos')}, ${g.venc ? plural(g.venc, 'vencido', 'vencidos') : `${pct}% pagado`}`,
        amount: fmtMoney(g.pend > 0 ? g.pend : g.imp), amountLabel: g.pend > 0 ? 'por pagar' : 'pagado', muted: g.pend <= 0,
        open: openState(key, g.venc > 0),
        rows: g.items.map(m => gastoRow(m, false)).join('')
      });
    });
  }
  return out;
}

/* Pagos como tabla: columnas ordenables (un toque asc., otro desc.), vencidos teñidos y días debajo de cada pago. */
const ESTADO_ORD = { Vencido: 0, Pendiente: 1, Pagado: 2 };
const SORTS = {
  fecha:   (a, c) => a.date - c.date,
  estatus: (a, c) => ESTADO_ORD[a.estado] - ESTADO_ORD[c.estado],
  cat:     (a, c) => catOf(a.cat).id.localeCompare(catOf(c.cat).id, 'es'),
  conc:    (a, c) => a.conc.localeCompare(c.conc, 'es'),
  monto:   (a, c) => a.imp - c.imp
};
const COLS = [['fecha', 'Fecha'], ['estatus', 'Estatus', 'Est.'], ['cat', 'Categoría', 'Cat.'], ['conc', 'Concepto'], ['monto', 'Monto']];
const BADGE_ICON = {
  Vencido: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  Pendiente: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  Pagado: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
};
const BADGE_TONE = { Vencido: 'danger', Pendiente: 'warn', Pagado: 'ok' };

function diasTexto(m, i) {
  if (m.estado === 'Pagado') return '';
  if (m.estado === 'Vencido') return plural(-daysFromToday(m.date), 'día atrasado', 'días atrasados');
  return i.text;
}

/* Los atrasados de un pago mensual se juntan en un solo renglón: «$1,500 de $750 · 2 meses». */
function juntarSeries(items) {
  const grupos = new Map();
  items.forEach(m => { if (m.serie && !m.esProximo && m.estado === 'Vencido') (grupos.get(m.serie) || grupos.set(m.serie, []).get(m.serie)).push(m); });
  const fuera = new Set();
  const juntos = [];
  grupos.forEach(g => {
    if (g.length < 2) return;
    g.sort((a, c) => a.date - c.date);
    g.forEach(m => fuera.add(m));
    juntos.push({ ...g[0], imp: g.reduce((t, m) => t + m.imp, 0), abo: 0, pendiente: g.reduce((t, m) => t + m.pendiente, 0), cuota: g[g.length - 1].imp, meses: g.length });
  });
  return fuera.size ? [...items.filter(m => !fuera.has(m)), ...juntos] : items;
}

function pagoRow(m) {
  const i = gastoInfo(m), c = catOf(m.cat), t = BADGE_TONE[m.estado], dias = m.meses ? `${m.meses} ${freqOf(m) === 'mensual' ? 'meses' : 'pagos'} · ${plural(-daysFromToday(m.date), 'día', 'días')}` : diasTexto(m, i);
  return `<button type="button" class="pt-cols pt-row${m.estado === 'Vencido' ? ' v' : ''}" data-cat="${esc(c.id)}" data-action="open" data-kind="${m.esProximo ? 'meta' : 'gasto'}" data-id="${esc(m.id)}" aria-label="${esc(`${m.date.getDate()} ${MESES_CORTO[m.date.getMonth()]}, ${m.conc}, ${c.id}, ${m.estado}${dias ? ', ' + dias : ''}, ${fmtMoney(i.done ? m.imp : i.pend)}`)}">
    <span class="pt-fecha"><b>${m.date.getDate()}</b><small>${MESES_CORTO[m.date.getMonth()]}</small></span>
    <span class="pt-est ${t}" role="img" aria-label="${m.estado}${i.partial ? `, abonado ${i.pct}%` : ''}" title="${m.estado}${i.partial ? `, abonado ${i.pct}%` : ''}">${i.partial ? `<svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="tr" cx="12" cy="12" r="9" pathLength="100"/><circle class="pr" cx="12" cy="12" r="9" pathLength="100" style="--p:${i.pct}"/></svg>` : svg(BADGE_ICON[m.estado])}</span>
    <span class="pt-cat" role="img" aria-label="${esc(c.id)}" title="${esc(c.id)}">${catIcon(c)}</span>
    <span class="pt-cc"><span class="pt-conc"><span class="pt-name">${esc(m.conc)}</span>${repIcon(m)}${!m.esProximo && enMes(m.date) && (chipMes.get(llaveC(m)) || 0) > 1 ? `<em class="pt-tag" title="${chipMes.get(llaveC(m))} pagos con este nombre este mes">×${chipMes.get(llaveC(m))}</em>` : ''}${m.esProximo ? '<em class="pt-tag">Plan</em>' : ''}</span>${dias ? `<span class="pt-nota ${t}">${dias}</span>` : ''}</span>
    <span class="pt-amt${i.done ? ' done' : ''}"><b>${fmtMoney(i.done ? m.imp : i.pend)}</b>${i.done ? '' : (daysFromToday(m.date) <= 0 ? '<small class="pt-ap ya">pagar ya</small>' : `<small class="pt-ap">${fmtMoney(m.abo)}/${fmtMoney(m.imp)}</small>`)}</span>
  </button>`;
}

/* El mes va dentro de la tabla de Pagos: se toca para elegir mes o se desliza para cambiarlo. */
const mesBar = () => `<button type="button" class="pt-mes" data-action="month-picker" aria-haspopup="dialog">${MESES[state.month.month]} ${state.month.year}</button>`;

/* «×N»: cuántos pagos con ese nombre hay en el mes que se ve (no cuenta los 30 días siguientes ni los atrasados de otros meses). */
let chipMes = new Map();
function calcularChips() {
  chipMes = new Map();
  for (const x of movimientos) if (enMes(parseDate(x.fecha))) { const k = llaveC(x); chipMes.set(k, (chipMes.get(k) || 0) + 1); }
}

function pagosTable(b) {
  calcularChips();
  const { col, asc } = state.sort;
  const items = juntarSeries(b.items).sort((a, c) => (SORTS[col](a, c) || porFechaYMonto(a, c)) * (asc ? 1 : -1));
  const head = COLS.map(([k, l, sh]) => {
    const on = col === k;
    return `<span class="pt-h${k === 'monto' ? ' r' : ''}"><button type="button" class="pt-sort${on ? ' on' : ''}${on && !asc ? ' desc' : ''}" data-action="sort" data-col="${k}" aria-label="Ordenar por ${l.toLowerCase()}${on ? (asc ? ', de menor a mayor' : ', de mayor a menor') : ''}">${sh || l}</button></span>`;
  }).join('');
  const pend = sum(items, 'pendiente');
  const cats = [...new Map(items.map(m => [catOf(m.cat).id, catOf(m.cat)])).values()].sort((a, c) => a.id.localeCompare(c.id, 'es'));
  return `<div class="pt">${mesBar()}<div class="pt-cols pt-th">${head}</div>${items.map(pagoRow).join('')}<div class="pt-foot"><span>${plural(b.items.length, 'pago', 'pagos')} · por pagar</span><b>${fmtMoney(pend)}</b></div></div>
    <div class="pt-key" aria-label="Categorías">${cats.map(c => `<span data-cat="${esc(c.id)}">${catIcon(c)}${esc(c.id)}</span>`).join('')}</div>`;
}

/* Metas con el mismo estilo de tabla: fecha objetivo, estatus (anillo si hay ahorro), categoría, meta y monto que falta. */
const META_RANK = { vencida: 0, proxima: 1, largo: 1, alcanzada: 2 };
const META_SORTS = {
  fecha:   (a, c) => a.date - c.date,
  estatus: (a, c) => META_RANK[plazoKey(a)] - META_RANK[plazoKey(c)],
  cat:     SORTS.cat,
  conc:    SORTS.conc,
  monto:   (a, c) => a.imp - c.imp
};
const META_COLS = [['fecha', 'Fecha'], ['estatus', 'Estatus', 'Est.'], ['cat', 'Categoría', 'Cat.'], ['conc', 'Meta'], ['monto', 'Monto']];
const META_BADGE = { vencida: ['Atrasada', 'danger', BADGE_ICON.Vencido], alcanzada: ['Alcanzada', 'ok', BADGE_ICON.Pagado] };

function metaPagoRow(m) {
  const i = metaInfo(m), c = catOf(m.cat), k = plazoKey(m);
  const [label, tone, icon] = META_BADGE[k] || [i.sinMonto ? 'Monto por definir' : 'En curso', i.tone === 'warn' ? 'warn' : 'muted', BADGE_ICON.Pendiente];
  const yr = m.date.getFullYear() !== HOY.getFullYear() ? ` ’${String(m.date.getFullYear()).slice(-2)}` : '';
  const aria = `${label}${i.partial ? `, ahorrado ${i.pct}%` : ''}`;
  const amount = i.sinMonto ? '—' : fmtMoney(i.done ? m.imp : i.pend);
  return `<button type="button" class="pt-cols pt-row${k === 'vencida' ? ' v' : ''}" data-cat="${esc(c.id)}" data-action="open" data-kind="meta" data-id="${esc(m.id)}" aria-label="${esc(`${m.date.getDate()} ${MESES_CORTO[m.date.getMonth()]}, ${m.conc}, ${c.id}, ${label}${i.done ? '' : ', ' + i.text}, ${amount}`)}">
    <span class="pt-fecha"><b>${m.date.getDate()}</b><small>${MESES_CORTO[m.date.getMonth()]}${yr}</small></span>
    <span class="pt-est ${tone}" role="img" aria-label="${aria}" title="${aria}">${i.partial ? `<svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="tr" cx="12" cy="12" r="9" pathLength="100"/><circle class="pr" cx="12" cy="12" r="9" pathLength="100" style="--p:${i.pct}"/></svg>` : svg(icon)}</span>
    <span class="pt-cat" role="img" aria-label="${esc(c.id)}" title="${esc(c.id)}">${catIcon(c)}</span>
    <span class="pt-cc"><span class="pt-conc"><span class="pt-name">${esc(m.conc)}</span>${repIcon(m)}</span>${i.done ? '' : `<span class="pt-nota ${i.tone}">${i.text}</span>`}</span>
    <span class="pt-amt${i.done || i.sinMonto ? ' done' : ''}"><b>${amount}</b>${i.partial ? `<small>de ${fmtMoney(m.imp)}</small>` : ''}</span>
  </button>`;
}

function metasTable(b) {
  const { col, asc } = state.sortMetas;
  const items = [...b.items].sort((a, c) => (META_SORTS[col](a, c) || porFechaYMonto(a, c)) * (asc ? 1 : -1));
  const head = META_COLS.map(([k, l, sh]) => {
    const on = col === k;
    return `<span class="pt-h${k === 'monto' ? ' r' : ''}"><button type="button" class="pt-sort${on ? ' on' : ''}${on && !asc ? ' desc' : ''}" data-action="sort" data-col="${k}" aria-label="Ordenar por ${l.toLowerCase()}${on ? (asc ? ', de menor a mayor' : ', de mayor a menor') : ''}">${sh || l}</button></span>`;
  }).join('');
  const falta = items.reduce((t, m) => t + (m.imp > 0 ? Math.max(0, m.imp - m.abo) : 0), 0);
  const cats = [...new Map(items.map(m => [catOf(m.cat).id, catOf(m.cat)])).values()].sort((a, c) => a.id.localeCompare(c.id, 'es'));
  return `<div class="pt"><div class="pt-cols pt-th">${head}</div>${items.map(metaPagoRow).join('')}<div class="pt-foot"><span>${plural(items.length, 'plan', 'planes')} · por ahorrar</span><b>${fmtMoney(falta)}</b></div></div>
    <div class="pt-key" aria-label="Categorías">${cats.map(c => `<span data-cat="${esc(c.id)}">${catIcon(c)}${esc(c.id)}</span>`).join('')}</div>`;
}

function renderMetasList(b) {
  $('#list-caption').textContent = 'Planes';
  $('#list-count').textContent = '';
  if (b.items.length) { $('#list').innerHTML = metasTable(b); return; }
  renderList([], '', '', 'metas', b.base.length === 0);
}

function renderPagos(b) {
  $('#list-caption').textContent = 'Movimientos';
  $('#list-count').textContent = '';
  if (b.items.length) { $('#list').innerHTML = pagosTable(b); return; }
  renderList([], '', '', 'gastos', b.base.length === 0);
  $('#list').insertAdjacentHTML('afterbegin', `<div class="pt">${mesBar()}</div>`);
}

function renderList(groups, caption, countText, emptyKind, baseEmpty) {
  $('#list-caption').textContent = caption;
  $('#list-count').textContent = countText;
  if (groups.length) { $('#list').innerHTML = groups.map(groupHTML).join(''); return; }
  const isMeta = state.view === 'metas';
  $('#list').innerHTML = baseEmpty
    ? `<div class="empty"><strong>${isMeta ? 'Aún no hay planes' : `Nada en ${MESES[state.month.month].toLowerCase()}`}</strong>${isMeta ? 'Agrega el primero: frenos, mantenimiento…' : 'Agrega el primer pago de este mes.'}<button type="button" class="btn btn-primary" data-action="add" data-mode="new">${isMeta ? 'Nuevo plan' : 'Nuevo pago'}</button></div>`
    : `<div class="empty"><strong>Sin resultados</strong>Prueba con otro filtro.</div>`;
}

/* =========================================================
   Render maestro
   ========================================================= */
function render() {
  refrescarHoy();
  marcaSync();
  const hoyIdx = HOY.getFullYear() * 12 + HOY.getMonth();
  generarRepetidos(hoyIdx + 1);
  const isG = state.view === 'gastos', isP = state.view === 'perfil', isA = state.view === 'apartar';
  document.body.dataset.view = state.view;
  ['.hero', '.list-head', '#list'].forEach(sel => { $(sel).hidden = isP; });
  $('#perfil').hidden = !isP;
  $$('#view-switch .nav-btn').forEach(b => { if (b.dataset.view === state.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#month-label').disabled = !isG;
  $('.controls').hidden = true;
  $('#seg').hidden = true;
  const addBtn = $('.nav-add'), addLabel = isG || isA ? 'Agregar pago o abono' : 'Agregar meta o ahorro';
  addBtn.setAttribute('aria-label', addLabel); addBtn.title = addLabel;

  if (isP) {
    $('#search-bar').hidden = true;
    $('#month-text').textContent = 'Ajustes';
    renderPerfil();
  } else if (isA) {
    $('#search-bar').hidden = true;
    $('#month-text').textContent = 'Apartar';
    renderApartar();
  } else if (isG) {
    const b = buildGastos();
    renderHeroGastos(b);
    renderMonthControls();
    renderPagos(b);
  } else {
    const b = buildMetas();
    renderHeroMetas(b);
    $('#month-text').textContent = `${HOY.getDate()} ${MESES[HOY.getMonth()]} ${HOY.getFullYear()}`;
    renderMetasList(b);
  }
}

/* =========================================================
   Hojas (bottom sheets)
   ========================================================= */
const sheet = { el: $('#sheet'), panel: $('#sheet-panel'), body: $('#sheet-body'), title: $('#sheet-title'), ctx: null, last: null };

/* Con la hoja abierta, el resto de la página queda inerte: el foco no se escapa del diálogo. */
const setInert = on => $$('.app, .bottom-nav').forEach(el => { el.inert = on; });

function openSheet(title, html) {
  /* Un aviso a medias (p. ej. Deshacer) no debe quedar tapando o interceptando toques de la hoja. */
  clearTimeout(toastTimer); $('#toast').classList.remove('show');
  if (sheet.el.hidden) sheet.last = document.activeElement;
  sheet.title.textContent = title;
  sheet.body.innerHTML = html;
  sheet.body.scrollTop = 0;
  sheet.el.hidden = false;
  setInert(true);
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  if (sheet.el.hidden) return;
  sheet.el.hidden = true;
  sheet.ctx = null;
  document.body.style.overflow = '';
  setInert(false);
  if (sheet.last && document.contains(sheet.last)) { try { sheet.last.focus({ preventScroll: true }); } catch (e) {} }
  if (state.view === 'perfil') renderPerfil();
  if (state.view === 'apartar') renderApartar();
  if (recargaPendiente) recargarDatos();
}

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-btn'; b.textContent = action.label;
    b.addEventListener('click', () => { clearTimeout(toastTimer); t.classList.remove('show'); action.run(); });
    t.append(b);
  }
  t.classList.toggle('has-action', !!action);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2200);
}

/* Error de formulario: texto en la alerta, campo marcado y con el foco */
function formError(errId, fieldId, msg) {
  $$('[aria-invalid]', sheet.body).forEach(el => el.removeAttribute('aria-invalid'));
  $('#' + errId).textContent = msg;
  const el = $('#' + fieldId);
  el.setAttribute('aria-invalid', 'true');
  el.setAttribute('aria-describedby', errId);
  el.focus();
}

const listOf = kind => kind === 'meta' ? metas : movimientos;

/* ----- Detalle ----- */
function summaryHTML(m, i, isMeta) {
  const c = catOf(m.cat);
  const labels = isMeta ? ['Falta', 'Ahorrado', 'Meta'] : ['Pendiente', 'Abonado', 'Total'];
  return `
    <div class="detail-top">
      <span class="pill">${catIcon(c)}${esc(c.id)}</span>
      <span>${fmtDateFull(m.fecha)}</span>
      ${m.repite && m.serie ? `<span class="pill"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${REP_PATH}</svg>${FREQS[freqOf(m)].label}</span>` : ''}
      <span class="detail-st t-${i.tone}">${i.text}</span>
    </div>
    <div class="figbox">
      <div><span>${labels[0]}</span><b>${fmtMoney(i.pend)}</b></div>
      <div><span>${labels[1]}</span><b>${fmtMoney(m.abo)}</b></div>
      <div><span>${labels[2]}</span><b>${m.imp > 0 ? fmtMoney(m.imp) : '—'}</b></div>
    </div>
    ${i.plan ? `<p class="plan">Para llegar a tiempo: ${i.plan}.</p>` : ''}`;
}

function abonoFormHTML(isMeta, pend) {
  return `<form id="abono-form" novalidate>
      <div class="two-col">
        <div>
          <label for="abono">${isMeta ? 'Monto a ahorrar' : 'Monto del abono'}</label>
          <input id="abono" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0">
        </div>
        <div>
          <label for="abono-fecha">${isMeta ? 'Fecha del ahorro' : 'Fecha del pago'}</label>
          <input id="abono-fecha" type="date" value="${toISO(HOY)}">
        </div>
      </div>
      <p class="hint">Máximo: ${fmtMoney(pend)}</p>
      <button type="button" class="btn btn-soft" data-action="abono-all">${isMeta ? 'Completar' : 'Pagar todo'} · ${fmtMoney(pend)}</button>
      <p class="form-error" id="abono-error" role="alert"></p>
      <button type="submit" class="btn btn-primary">${isMeta ? 'Registrar ahorro' : 'Registrar abono'}</button>
    </form>`;
}

function historialHTML(m, isMeta) {
  const ps = (m.pagos || []).map((x, i) => ({ ...x, i })).sort((x, y) => (y.fecha ? parseDate(y.fecha) : 0) - (x.fecha ? parseDate(x.fecha) : 0));
  if (!ps.length) return '';
  const lapiz = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  return `<div class="hist">
    <div class="hist-head"><h3>${isMeta ? 'Historial de ahorro' : 'Historial de abonos'}</h3><span>${isMeta ? plural(ps.length, 'registro', 'registros') : plural(ps.length, 'abono', 'abonos')}</span></div>
    ${ps.map(x => `<button type="button" class="hist-row" data-action="abono-edit" data-idx="${x.i}" aria-label="Editar ${isMeta ? 'ahorro' : 'abono'} de ${fmtMoney(x.monto)}"><span>${x.fecha ? fmtDateFull(x.fecha) : 'Sin fecha'}</span><b>${fmtMoney(x.monto)}${lapiz}</b></button>`).join('')}
  </div>`;
}

/* Editar o eliminar un abono del historial; el pendiente y el estatus se recalculan solos. */
function openAbonoEdit(kind, id, idx) {
  const isMeta = kind === 'meta';
  const m = listOf(kind).find(x => x.id === id), p = m && (m.pagos || [])[idx];
  if (!p) return;
  const max = r2(m.imp - (m.abo - p.monto));
  sheet.ctx = { type: 'abono-edit', kind, id, idx };
  openSheet(isMeta ? 'Editar ahorro' : 'Editar abono', `
    <form id="abono-edit-form" novalidate>
      <div class="two-col">
        <div><label for="ae-monto">Monto</label><input id="ae-monto" type="number" inputmode="decimal" min="0" step="0.01" value="${p.monto}"></div>
        <div><label for="ae-fecha">Fecha</label><input id="ae-fecha" type="date" value="${p.fecha || ''}"></div>
      </div>
      <p class="hint">Máximo: ${fmtMoney(max)}</p>
      <p class="form-error" id="ae-error" role="alert"></p>
      <div class="fbtns edit">
        <button type="button" class="btn btn-soft" data-action="abono-back">Cancelar</button>
        <button type="button" class="btn btn-danger" data-action="abono-del">Eliminar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  sheet.panel.focus({ preventScroll: true });
}

function submitAbonoEdit() {
  const { kind, id, idx } = sheet.ctx;
  const m = listOf(kind).find(x => x.id === id), p = m && (m.pagos || [])[idx];
  if (!p) return;
  const monto = r2(parseFloat($('#ae-monto').value));
  const fecha = $('#ae-fecha').value;
  const max = r2(m.imp - (m.abo - p.monto));
  const err = !(monto > 0) ? 'Escribe un monto mayor a 0.'
    : monto > max ? `Máximo ${fmtMoney(max)}, que es lo que permite el total.`
    : !fecha && p.fecha ? 'Selecciona la fecha.' : '';
  if (err) { formError('ae-error', monto > 0 && monto <= max ? 'ae-fecha' : 'ae-monto', err); return; }
  p.monto = monto; p.fecha = fecha || null;
  syncAbo(m);
  finish(kind, m, kind === 'meta' ? 'Ahorro actualizado' : 'Abono actualizado');
}

function conceptoHTML(m) {
  const k = llaveC(m), anio = m.fecha.slice(0, 4);
  const grupo = movimientos.filter(x => llaveC(x) === k && x.fecha.slice(0, 4) === anio).sort(byFecha);
  if (grupo.length < 2) return '';
  const total = sum(grupo, 'imp');
  const ult = grupo.filter(x => x.id !== m.id && x.abo >= x.imp).pop();
  const sig = grupo.find(x => x.id !== m.id && x.fecha > m.fecha && x.abo < x.imp);
  const fila = (t, v) => `<div class="hist-row"><span>${t}</span><b>${v}</b></div>`;
  return `<div class="hist concepto">
    <div class="hist-head"><h3>Historial de «${esc(m.conc)}» · ${esc(catLabelOf(m.cat))} · ${anio}</h3><span>${plural(grupo.length, 'pago', 'pagos')}</span></div>
    ${fila('Total del año', fmtMoney(total))}${fila('Promedio por pago', fmtMoney(Math.round(total / grupo.length * 100) / 100))}
    ${ult ? fila('Último pagado', `${fmtDate(ult.fecha)} · ${fmtMoney(ult.imp)}`) : ''}${sig ? fila('Siguiente', `${fmtDate(sig.fecha)} · ${fmtMoney(sig.imp)}`) : ''}
  </div>`;
}

function openDetail(kind, id) {
  const isMeta = kind === 'meta';
  const raw = listOf(kind).find(m => m.id === id);
  if (!raw) return;
  const m = isMeta ? procesarMeta(raw) : procesar(raw);
  const i = isMeta ? metaInfo(m) : gastoInfo(m);

  let action;
  if (isMeta && i.sinMonto) {
    action = '<p class="note">Este plan todavía no tiene monto. Defínelo para empezar a ahorrar.</p>';
  } else if (i.done) {
    action = isMeta ? '<p class="note">Ya lo tienes completo.</p>' : '<button type="button" class="btn btn-soft" data-action="reopen">Deshacer último abono</button>';
  } else {
    action = abonoFormHTML(isMeta, i.pend);
  }

  sheet.ctx = { type: 'detail', kind, id };
  openSheet(m.conc, `${summaryHTML(m, i, isMeta)}
    ${isMeta ? '' : conceptoHTML(m)}
    ${action}
    ${historialHTML(m, isMeta)}
    <div class="btn-row">
      <button type="button" class="btn btn-soft" data-action="edit">Editar</button>
      <button type="button" class="btn btn-danger" data-action="delete">Eliminar</button>
    </div>`);
  sheet.panel.focus({ preventScroll: true });
}

/* Deja visible lo recién guardado: limpia filtro/búsqueda que lo esconderían y abre su grupo. */
function reveal(kind, raw) {
  const isMeta = kind === 'meta';
  if (!isMeta) { const d = parseDate(raw.fecha); state.month = { year: d.getFullYear(), month: d.getMonth() }; }
  const okFilter = isMeta ? (state.filter === 'todas' || plazoKey(raw) === state.filter) : (state.filter === 'todos' || procesar(raw).estado.toLowerCase() === state.filter);
  if (!okFilter) state.filter = isMeta ? 'todas' : 'todos';
  const q = state.search.trim().toLowerCase();
  if (q && !`${raw.conc} ${raw.cat}`.toLowerCase().includes(q)) {
    state.search = ''; $('#search').value = ''; $('#search-bar').hidden = true;
  }
  state.open[isMeta ? `p|${plazoKey(raw)}` : (state.grouping === 'urgencia' ? `u|${urgenciaKey(procesar(raw))}` : `c|${catOf(raw.cat).id}`)] = true;
}

async function finish(kind, raw, msg) {
  const ok = await persist(kind, raw);
  reveal(kind, raw);
  closeSheet();
  render();
  const row = $$('.row, .pt-row').find(r => r.dataset.id === raw.id);
  if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('flash'); }
  toast(ok ? msg : 'No se pudo guardar en este dispositivo');
}

function submitAbono() {
  const { kind, id } = sheet.ctx;
  const isMeta = kind === 'meta';
  const m = listOf(kind).find(x => x.id === id);
  if (!m) return;
  const monto = r2(parseFloat($('#abono').value));
  const fecha = $('#abono-fecha').value;
  const falta = r2(m.imp - m.abo);
  const err = !(monto > 0) ? 'Escribe un monto mayor a 0.'
    : monto > falta ? `Máximo ${fmtMoney(falta)}, que es lo que falta.`
    : !fecha ? 'Selecciona la fecha del pago.' : '';
  if (err) { formError('abono-error', monto > 0 && monto <= falta ? 'abono-fecha' : 'abono', err); return; }
  (m.pagos = m.pagos || []).push({ fecha, monto });
  syncAbo(m);
  finish(kind, m, m.abo >= m.imp ? (isMeta ? 'Listo, ya lo tienes' : 'Pagado por completo') : `${isMeta ? 'Ahorro registrado' : 'Abono registrado'}: ${fmtMoney(monto)}`);
}

/* ----- Agregar movimiento: (+) ----- */
const hasPending = kind => listOf(kind).some(m => m.imp > 0 && m.abo < m.imp);
const isDirty = () => { const c = sheet.ctx; return !!(c && c.type === 'form' && !c.id && ($('#f-conc').value.trim() || $('#f-imp').value)); };
function dismissDiscard() { const b = $('#discard'); if (b) b.remove(); const f = $('#f-conc'); if (f) f.focus(); }
function askDiscard(onYes) {
  if ($('#discard')) { dismissDiscard(); return; }
  if (!isDirty()) { onYes(); return; }
  const box = document.createElement('div');
  box.id = 'discard'; box.className = 'discard';
  box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-labelledby', 'discard-t');
  box.innerHTML = `<p id="discard-t">¿Descartar lo que escribiste?</p><div class="btn-row"><button type="button" class="btn btn-soft" data-action="discard-no">Seguir editando</button><button type="button" class="btn btn-danger" data-action="discard-yes">Descartar</button></div>`;
  sheet.discard = onYes;
  sheet.body.prepend(box);
  sheet.body.scrollTop = 0;
  $('[data-action=discard-no]', box).focus();
}
function requestClose() { askDiscard(closeSheet); }

function addTabs(kind, mode) {
  const isMeta = kind === 'meta';
  return `<div class="mode" role="group" aria-label="Tipo de movimiento">
    <button type="button" data-action="add-mode" data-mode="new" aria-pressed="${mode === 'new'}">${isMeta ? 'Nuevo plan' : 'Nuevo pago'}</button>
    <button type="button" data-action="add-mode" data-mode="pay" aria-pressed="${mode === 'pay'}">${isMeta ? 'Registrar ahorro' : 'Abonar o pagar'}</button>
  </div>`;
}

function openAdd(kind, mode) { if (mode === 'pay') openPay(kind); else openForm(kind, null); }

function payListHTML(kind, q, f = 'todos') {
  const isMeta = kind === 'meta';
  q = q.trim().toLowerCase();
  const arr = (isMeta ? metas.map(procesarMeta) : movimientos.map(procesar))
    .filter(m => m.imp > 0 && m.abo < m.imp && (!q || `${m.conc} ${m.cat}`.toLowerCase().includes(q)))
    .filter(m => f === 'todos' || ((isMeta ? metaInfo(m) : gastoInfo(m)).tone === 'danger') === (f === 'atrasado'))
    .sort(porFechaYMonto);
  if (!arr.length) return `<p class="note">${q ? 'Sin resultados.' : (isMeta ? 'No hay planes por completar.' : 'No hay pagos pendientes.')}</p>`;
  return arr.map(m => {
    const i = isMeta ? metaInfo(m) : gastoInfo(m);
    const extra = m.abo > 0 ? ` · ${isMeta ? 'ahorrado' : 'abonado'} ${fmtMoney(m.abo)}` : '';
    return `<button type="button" class="pay-row tone-${i.tone}" data-action="pay-pick" data-id="${esc(m.id)}">
      <span class="pay-ic" aria-hidden="true">${catIcon(catOf(m.cat))}</span>
      <span class="pay-main"><b>${esc(m.conc)}</b><small>${i.text}${extra}</small></span>
      <span class="pay-amt"><b>${fmtMoney(i.pend)}</b></span>
    </button>`;
  }).join('');
}

function openPay(kind) {
  const isMeta = kind === 'meta';
  sheet.ctx = { type: 'add', kind };
  openSheet(isMeta ? 'Nuevo plan' : 'Nuevo pago', `${addTabs(kind, 'pay')}
    <div class="pay-chips" id="pay-chips">
      ${[['todos', 'Todos'], ['atrasado', isMeta ? 'Atrasadas' : 'Atrasados'], ['porvencer', isMeta ? 'En curso' : 'Por vencer']].map(([k, l]) => `<button type="button" class="pchip${k === 'todos' ? ' on' : ''}" data-action="pay-filter" data-f="${k}" aria-pressed="${k === 'todos'}">${l}</button>`).join('')}
      <button type="button" class="pchip pchip-ic" data-action="pay-search-toggle" aria-label="Buscar concepto o categoría" aria-expanded="false"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
    </div>
    <div class="pay-search" id="pay-search-wrap" hidden>
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="pay-search" type="search" autocomplete="off" aria-label="Buscar concepto o categoría" placeholder="Buscar concepto o categoría">
    </div>
    <div id="pay-list">${payListHTML(kind, '')}</div>`);
  sheet.ctx.payF = 'todos';
  sheet.panel.focus({ preventScroll: true });
}

function openPayDetail(kind, id) {
  const isMeta = kind === 'meta';
  const raw = listOf(kind).find(m => m.id === id);
  if (!raw) return;
  const m = isMeta ? procesarMeta(raw) : procesar(raw);
  const i = isMeta ? metaInfo(m) : gastoInfo(m);
  sheet.ctx = { type: 'detail', kind, id };
  openSheet(isMeta ? 'Nuevo plan' : 'Nuevo pago', `${addTabs(kind, 'pay')}
    <button type="button" class="back" data-action="pay-back"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Cambiar concepto</button>
    <h3 class="pay-name">${esc(m.conc)}</h3>
    ${summaryHTML(m, i, isMeta)}
    ${abonoFormHTML(isMeta, i.pend)}
    ${historialHTML(m, isMeta)}`);
  sheet.panel.focus({ preventScroll: true });
}

/* ----- Formulario ----- */
function defaultDate(isMeta) {
  if (isMeta) return '';
  if (isCurrentMonth()) return toISO(HOY);
  return toISO(new Date(state.month.year, state.month.month, 1));
}

/* Conceptos que ya existen (por nombre): categoría y importe más usados para sugerirlos al escribir. */
function sugerencias(texto, kind) {
  const q = llave(texto);
  if (!q) return [];
  const g = new Map();
  for (const x of listOf(kind).slice().sort(byFecha)) {
    if (!llave(x.conc).includes(q)) continue;
    const k = llaveC(x);
    const e = g.get(k) || { nombre: x.conc, cat: x.cat, n: 0, imps: new Map() };
    e.nombre = x.conc; e.cat = x.cat; e.n++;
    e.imps.set(x.imp, { n: ((e.imps.get(x.imp) || {}).n || 0) + 1, ult: e.n });
    g.set(k, e);
  }
  return [...g.values()].map(e => ({ ...e, imp: [...e.imps.entries()].sort((a, b) => b[1].n - a[1].n || b[1].ult - a[1].ult)[0][0] })).sort((a, b) => b.n - a.n).slice(0, 4);
}
function pintarSugerencias() {
  const box = $('#f-sug'), inp = $('#f-conc');
  if (!box || !inp || !sheet.ctx || sheet.ctx.id) return;
  const lista = sugerencias(inp.value, sheet.ctx.kind);
  sheet.sug = lista;
  box.hidden = !lista.length;
  box.innerHTML = lista.map((s, i) => `<button type="button" class="sug-i" data-action="sug-pick" data-i="${i}"><span class="dot" data-cat="${esc(catLabelOf(s.cat))}"></span><span class="sug-t"><b>${esc(s.nombre)}</b><small>${esc(catLabelOf(s.cat))} · ${plural(s.n, 'pago', 'pagos')} · suele ser ${fmtMoney(s.imp)}</small></span><i>USAR</i></button>`).join('');
}

function openForm(kind, id) {
  const isMeta = kind === 'meta';
  const editing = id ? listOf(kind).find(m => m.id === id) : null;
  if (id && !editing) return;
  const last = lsGet(KEYS.cat);
  const catStr = editing ? editing.cat : (CATS.some(c => catString(c) === last) ? last : catString(CATS[0]));
  const selected = catLabelOf(catStr);

  sheet.ctx = { type: 'form', kind, id: id || null, cat: catStr };
  openSheet(editing ? (isMeta ? 'Editar plan' : 'Editar pago') : (isMeta ? 'Nuevo plan' : 'Nuevo pago'), `
    ${editing ? '' : addTabs(kind, 'new')}
    <form id="form" class="fform" novalidate>
      <label class="fld" for="f-conc"><span>Concepto</span><input id="f-conc" type="text" autocomplete="off" placeholder="${isMeta ? 'Ej. Llantas' : 'Ej. Combustible'}" value="${editing ? esc(editing.conc) : ''}"></label>
      ${editing ? '' : '<div class="sug" id="f-sug" hidden></div>'}
      <div class="two-col">
        <label class="fld" for="f-imp"><span>${isMeta ? 'Monto' : 'Importe'}</span><input id="f-imp" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="${editing ? editing.imp : ''}"></label>
        <label class="fld" for="f-fecha"><span>${isMeta ? 'Hasta' : 'Vence'}</span><input id="f-fecha" type="date" value="${editing ? editing.fecha : defaultDate(isMeta)}"></label>
      </div>
      <div class="cat-grid" role="radiogroup" aria-label="Categoría">
        ${CATS.map(c => `<label class="cat-opt"><input type="radio" name="f-cat" value="${c.id}"${c.id === selected ? ' checked' : ''}><span class="cat-in">${catIcon(c)}${esc(c.id)}</span></label>`).join('')}
      </div>
      ${`<div class="rep-card">
        <label class="switch-row" for="f-rep"><span>Se repite</span><input type="checkbox" class="switch" id="f-rep" role="switch"${editing && editing.repite ? ' checked' : ''}></label>
        <div id="f-fin-wrap"${editing && editing.repite ? '' : ' hidden'}>
          <div class="freq-row" role="radiogroup" aria-label="Frecuencia">${Object.entries(FREQS).map(([k, v]) => `<label class="freq-opt"><input type="radio" name="f-freq" value="${k}"${k === (editing ? freqOf(editing) : 'mensual') ? ' checked' : ''}><span>${v.label}</span></label>`).join('')}</div>
          <label class="fin-row" for="f-fin"><span>Termina</span><input id="f-fin" type="date" value="${editing && editing.fin ? editing.fin : ''}"></label>
          <p class="note" id="f-fin-hint"></p>
        </div>
      </div>`}
      ${editing ? '' : `<label class="switch-row" for="f-paid"><span>${isMeta ? 'Ya tengo el dinero ahorrado' : 'Ya está pagado'}</span><input type="checkbox" class="switch" id="f-paid" role="switch"></label>`}
      <p class="form-error" id="f-error" role="alert"></p>
      <div class="fbtns${editing ? ' edit' : ''}">
        <button type="button" class="btn btn-soft" data-action="close-sheet">Cancelar</button>
        ${editing ? '<button type="button" class="btn btn-danger" data-action="delete">Eliminar</button>' : ''}
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  if (!isMeta) actualizarFin();
  if (editing) sheet.panel.focus({ preventScroll: true }); else $('#f-conc').focus({ preventScroll: true });
}

/* Frecuencia y «Termina»: solo con «Se repite»; el texto dice cuántos pagos serán. */
function actualizarFin() {
  const wrap = $('#f-fin-wrap');
  if (!wrap) return;
  wrap.hidden = !$('#f-rep').checked;
  const fecha = $('#f-fecha').value, fin = $('#f-fin').value, hint = $('#f-fin-hint');
  if (!fin || !fecha) { hint.textContent = 'Se repite hasta que lo detengas.'; return; }
  /* Calendario completo de la serie desde su primer pago; los ya pagados no cuentan como pendientes. */
  const lista = listOf(sheet.ctx.kind), id = sheet.ctx.id, prev = id ? lista.find(m => m.id === id) : null;
  const otros = prev && prev.serie ? lista.filter(m => m.serie === prev.serie && m.id !== id).sort(byFecha) : [];
  const inicio = otros.length && otros[0].fecha < fecha ? otros[0].fecha : fecha;
  const d = parseDate(inicio);
  const pagado = new Map(otros.map(m => [m.fecha, m.abo >= m.imp]));
  pagado.set(fecha, prev ? prev.abo >= (parseFloat($('#f-imp').value) || prev.imp) : !!($('#f-paid') && $('#f-paid').checked));
  let n = 0, q = 0;
  const fr = FREQS[$('input[name=f-freq]:checked') ? $('input[name=f-freq]:checked').value : 'mensual'];
  for (let k = 0; k < 2000; k++) {
    const f = fr.dias
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + k * fr.dias)
      : new Date(d.getFullYear(), d.getMonth() + k * fr.meses, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + k * fr.meses + 1, 0).getDate()));
    if (toISO(f) > fin) break;
    n++;
    if (!pagado.get(toISO(f))) q++;
  }
  hint.textContent = !n ? 'La fecha de fin es anterior al vencimiento.' : q === 0 ? (n === 1 ? "Ya está pagado." : `Los ${n} pagos ya están pagados.`) : `${q === 1 ? 'Queda 1 pago' : `Quedan ${q} pagos`} de ${n}`;
}

function submitForm() {
  const { kind, id, cat } = sheet.ctx;
  const isMeta = kind === 'meta';
  const fecha = $('#f-fecha').value;
  const imp = parseFloat($('#f-imp').value) || 0;
  const conc = $('#f-conc').value.trim() || (isMeta ? 'Meta' : 'Gasto');
  const list = listOf(kind);
  const prev = id ? list.find(m => m.id === id) : null;
  if (id && !prev) return;
  const fin = !$('#f-rep').checked ? '' : $('#f-fin').value;
  const freq = $('#f-rep').checked && $('input[name=f-freq]:checked') ? $('input[name=f-freq]:checked').value : 'mensual';
  const err = !fecha ? (isMeta ? 'Selecciona la fecha límite.' : 'Selecciona una fecha.')
    : (+fecha.slice(0, 4) < 2000 || +fecha.slice(0, 4) > 2100) ? 'Revisa el año de la fecha.'
    : fin && fin < fecha ? 'La fecha de fin no puede ser anterior al vencimiento.'
    : imp < 0 ? 'El monto no puede ser negativo.'
    : (!isMeta && imp <= 0) ? 'El importe debe ser mayor a 0.'
    : (prev && imp < prev.abo) ? `El importe no puede ser menor a lo ya abonado (${fmtMoney(prev.abo)}).` : '';
  if (err) { formError('f-error', !fecha ? 'f-fecha' : (fin && fin < fecha) ? 'f-fin' : 'f-imp', err); return; }

  let item;
  if (prev) {
    item = Object.assign(prev, { fecha, cat, conc, imp });
    {
      if ($('#f-rep').checked) { item.repite = true; if (!item.serie) item.serie = item.id; } else delete item.repite;
      if (fin) item.fin = fin; else delete item.fin;
      if (item.serie && fin) {
        const sobran = list.filter(m => m.serie === item.serie && m.fecha > fin && !(m.abo > 0));
        for (const m of sobran) { list.splice(list.indexOf(m), 1); unpersist(kind, m.id); }
      }
      if (item.repite && freq !== 'mensual') item.freq = freq; else delete item.freq;
      /* Repetir, frecuencia y fin valen para toda la serie. */
      if (item.serie) list.filter(m => m.serie === item.serie && m !== item).forEach(m => {
        if (item.repite) m.repite = true; else delete m.repite;
        if (item.fin) m.fin = item.fin; else delete m.fin;
        if (item.freq) m.freq = item.freq; else delete m.freq;
        persist(kind, m);
      });
    }
  } else {
    item = { id: (isMeta ? 'm' : '') + Date.now().toString(), fecha, cat, conc, imp, abo: 0, pagos: [] };
    if ($('#f-rep').checked) { item.repite = true; item.serie = item.id; if (fin) item.fin = fin; if (freq !== 'mensual') item.freq = freq; }
    if ($('#f-paid').checked && imp > 0) { item.pagos.push({ fecha: toISO(HOY), monto: imp }); syncAbo(item); }
    list.push(item);
    lsSet(KEYS.cat, cat);
  }
  list.sort(byFecha);
  if (item.serie && item.repite) generarSeries(list, storeOf(kind), HOY.getFullYear() * 12 + HOY.getMonth() + 1, item.serie);
  finish(kind, item, id ? 'Cambios guardados' : (isMeta ? 'Plan creado' : 'Pago guardado'));
}

/* ----- Selector de mes ----- */
function openMonthPicker() {
  const set = new Set([`${HOY.getFullYear()}-${HOY.getMonth()}`, `${state.month.year}-${state.month.month}`]);
  [...movimientos, ...metas.filter(m => m.imp > 0)].forEach(m => { const d = parseDate(m.fecha); set.add(`${d.getFullYear()}-${d.getMonth()}`); });
  const list = Array.from(set).map(k => { const [y, mo] = k.split('-').map(Number); return { y, mo }; }).sort((a, b) => (a.y * 12 + a.mo) - (b.y * 12 + b.mo));
  const count = (y, mo) => [...movimientos, ...metas.filter(m => m.imp > 0)].filter(m => { const d = parseDate(m.fecha); return d.getFullYear() === y && d.getMonth() === mo; }).length;
  sheet.ctx = { type: 'months' };
  openSheet('Ir a otro mes', `
    <button type="button" class="month-opt today" data-action="pick-today">Ir a hoy<small>${MESES[HOY.getMonth()]} ${HOY.getFullYear()}</small></button>
    ${list.map(x => `<button type="button" class="month-opt" data-action="pick-month" data-year="${x.y}" data-month="${x.mo}" aria-current="${x.y === state.month.year && x.mo === state.month.month}">${MESES[x.mo]} ${x.y}<small>${plural(count(x.y, x.mo), 'pago', 'pagos')}</small></button>`).join('')}`);
  const cur = $('.month-opt[aria-current="true"]', sheet.body);
  if (cur) cur.scrollIntoView({ block: 'center' });
  sheet.panel.focus({ preventScroll: true });
}

/* =========================================================
   Más opciones: tema, importar y exportar
   ========================================================= */
const ICO = {
  list: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>')
};

/* Resumen por concepto: cuánto suma cada nombre en el mes, el año o todo. */
function openConceptos() {
  const per = state.conceptoPer || 'mes';
  const dentro = x => per === 'todo' || (per === 'mes' ? enMes(parseDate(x.fecha)) : parseDate(x.fecha).getFullYear() === state.month.year);
  const g = new Map();
  for (const x of movimientos.slice().sort(byFecha)) {
    if (!dentro(x)) continue;
    const k = llaveC(x), e = g.get(k) || { nombre: x.conc, cat: x.cat, n: 0, total: 0 };
    e.nombre = x.conc; e.cat = x.cat; e.n++; e.total += x.imp;
    g.set(k, e);
  }
  const lista = [...g.values()].sort((a, b) => b.total - a.total);
  const max = lista.length ? lista[0].total : 1;
  const chips = [['mes', MESES[state.month.month]], ['anio', String(state.month.year)], ['todo', 'Todo']].map(([k, l]) => `<button type="button" class="pchip" data-action="conc-per" data-per="${k}" aria-pressed="${k === per}">${l}</button>`).join('');
  sheet.ctx = { type: 'conceptos' };
  const html = `<div class="cp-chips">${chips}</div>
    ${lista.length ? `<div class="cp-total">TOTAL ${fmtMoney(sum(lista, 'total'))} · ${plural(lista.length, 'concepto', 'conceptos')}</div>
    ${lista.map(e => `<div class="cp-row"><div class="cp-top"><span class="cp-n">${esc(e.nombre)}<em class="pt-tag">${esc(catLabelOf(e.cat))}</em><em class="pt-tag">×${e.n}</em></span><b>${fmtMoney(e.total)}</b></div><div class="cp-bar"><i data-cat="${esc(catLabelOf(e.cat))}" style="width:${Math.max(3, Math.round(e.total / max * 100))}%"></i></div></div>`).join('')}`
      : '<div class="empty"><strong>Sin pagos</strong>No hay pagos en este periodo.</div>'}`;
  if (sheet.el.hidden) openSheet('Por concepto', html); else { sheet.body.innerHTML = html; sheet.body.scrollTop = 0; }
}

function renderPerfil() {
  const cfg = sync.getCfg();
  $('#perfil').innerHTML = `
    <h2 class="perfil-h">Respaldo</h2>
    <div class="menu">
      <button type="button" class="menu-row" data-action="share-month">${ICO.upload}<span><b>Compartir mes</b><small>Imagen de ${MESES[state.month.month].toLowerCase()} ${state.month.year}</small></span></button>
      <button type="button" class="menu-row" data-action="open-sync">${ICO.upload}<span><b>Sincronizar con Google Sheets</b><small>${cfg.last ? 'Última vez: ' + new Date(cfg.last).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Conecta una hoja de tu Drive'}</small></span></button>
      <button type="button" class="menu-row" data-action="open-conceptos">${ICO.list}<span><b>Resumen por concepto</b><small>Cuánto suma cada nombre</small></span></button>
      <button type="button" class="menu-row" data-action="open-import">${ICO.upload}<span><b>Importar datos</b><small>Archivo JSON o CSV</small></span></button>
      <button type="button" class="menu-row" data-action="export-json">${ICO.download}<span><b>Exportar respaldo</b><small>Descarga un archivo JSON</small></span></button>
    </div>`;
}

/* Apartar: cuánto separar por día, semana, quincena o mes para llegar a la fecha de pago de cada pendiente
   (pagos y planes con monto, solo los próximos 30 días). Monto ÷ periodos completos que faltan; atrasados y de hoy van aparte. */
const APARTAR = [['dia', 'Día', 1], ['semana', 'Semana', 7], ['quincena', 'Quincena', 15], ['mes', 'Mes', 30]];
function apartarItems() {
  const pagos = movimientos.map(procesar).filter(m => m.pendiente > 0).map(m => ({ ...m, kind: 'gasto', pend: m.pendiente }));
  const prox = metas.filter(m => m.imp > 0 && m.abo < m.imp).map(m => ({ ...procesarMeta(m), kind: 'meta', pend: m.imp - m.abo }));
  return [...pagos, ...prox].map(m => ({ ...m, d: daysFromToday(m.date) })).filter(m => m.d <= 30).sort((a, c) => a.date - c.date);
}
const apartarMonto = (m, len) => Math.ceil(m.pend / Math.max(1, Math.ceil(m.d / len)));

/* Misma distribución que Pagos y Planes: tarjeta amarilla, dos mosaicos, mosaicos de periodo y tabla. */
/* «12 pagos · 3 planes» (omite los planes si no hay). */
const desglose = lista => { const pl = lista.filter(m => m.kind === 'meta').length; return plural(lista.length - pl, 'pago', 'pagos') + (pl ? ` · ${plural(pl, 'plan', 'planes')}` : ''); };

function renderApartar() {
  const all = apartarItems(), ya = all.filter(m => m.d <= 0), fut = all.filter(m => m.d > 0);
  const per = APARTAR.find(p => p[0] === state.apartar) || APARTAR[0];
  const tot = len => fut.reduce((t, m) => t + apartarMonto(m, len), 0);
  const pLabel = per[0] === 'dia' ? 'DÍA' : per[1].toUpperCase();
  const vencidos = ya.filter(m => m.d < 0).length, hoy = ya.length - vencidos;
  const nota = [vencidos && plural(vencidos, 'atrasado', 'atrasados'), hoy && `${hoy} ${hoy === 1 ? 'vence' : 'vencen'} hoy`].filter(Boolean).join(' · ');
  const ini = new Date(HOY.getFullYear(), HOY.getMonth(), 1);
  const ventana = movimientos.map(procesar).filter(m => (m.date >= ini && daysFromToday(m.date) <= 30) || m.estado === 'Vencido');
  const pctVentana = sum(ventana, 'imp') > 0 ? Math.round(sum(ventana, 'abo') / sum(ventana, 'imp') * 100) : 0;
  const tiles = APARTAR.map(([k, l, len]) => `<button type="button" class="kpi-lg lg-p" data-action="apartar-per" data-per="${k}" aria-pressed="${k === per[0]}"><span class="kpi-lg-t">${len === 1 ? '1 Día' : `${len} Días`}</span><span><span class="kpi-lg-m">${fmtMoney(tot(len))}</span></span></button>`).join('');
  $('#kpi-dash').innerHTML = `
    <div class="kpi-split">
      <button type="button" class="kpi-half" data-action="fondo" data-apartar="1" data-label="META ${per[0] === 'dia' ? 'DIARIA' : per[0] === 'semana' ? 'SEMANAL' : per[0] === 'quincena' ? 'QUINCENAL' : 'MENSUAL'}" data-meta="${tot(per[2])}" data-dias="30" data-pct="${pctVentana}" data-porv="${all.filter(m => m.d >= 0).length}"><span class="kpi-sec">POR ${pLabel}</span><span class="kpi-pv">${fmtMoney(tot(per[2]))}</span><span class="kpi-s">${desglose(fut)}</span></button>
      <span class="kpi-div" aria-hidden="true"></span>
      <div class="kpi-half"><span class="kpi-sec">POR PAGAR</span><span class="kpi-pv">${fmtMoney(sum(all, 'pend'))}</span><span class="kpi-s">${desglose(all)}</span></div>
    </div>
    <div class="kpi-ya${ya.length ? '' : ' ok'}"><span class="kpi-ya-t">PAGAR YA</span><b>${ya.length ? fmtMoney(ya.reduce((t, m) => t + m.pend, 0)) : '$0'}</b><span>${ya.length ? (nota || plural(ya.length, 'pago', 'pagos')) : 'nada atrasado'}</span></div>
    <div class="kpi-legend ap4" role="group" aria-label="Periodo">${tiles}</div>`;
  $('#kpi-dash').hidden = false;
  $('#list-caption').textContent = `Por ${per[0] === 'dia' ? 'día' : per[1].toLowerCase()}`;
  $('#list-count').textContent = '';
  if (!fut.length) { $('#list').innerHTML = '<div class="empty"><strong>Nada por apartar</strong>No hay pagos pendientes con fecha futura.</div>'; return; }
  const head = [['Fecha', ''], ['Est.', ''], ['Cat.', ''], ['Concepto', ''], ['Monto', ' r']].map(([l, r]) => `<span class="pt-h${r}"><span class="pt-sort">${l}</span></span>`).join('');
  const rows = fut.map(m => {
    const c = catOf(m.cat), t = m.d <= 7 ? 'warn' : 'muted';
    return `<button type="button" class="pt-cols pt-row" data-cat="${esc(c.id)}" data-action="open" data-kind="${m.kind}" data-id="${esc(m.id)}" aria-label="${esc(`${m.date.getDate()} ${MESES_CORTO[m.date.getMonth()]}, ${m.conc}, ${c.id}, ${m.d === 1 ? 'falta 1 día' : `faltan ${m.d} días`}, apartar ${fmtMoney(apartarMonto(m, per[2]))} de ${fmtMoney(m.pend)}`)}">
    <span class="pt-fecha"><b>${m.date.getDate()}</b><small>${MESES_CORTO[m.date.getMonth()]}</small></span>
    <span class="pt-est ${t}" role="img" aria-label="Pendiente">${svg(BADGE_ICON.Pendiente)}</span>
    <span class="pt-cat" role="img" aria-label="${esc(c.id)}" title="${esc(c.id)}">${catIcon(c)}</span>
    <span class="pt-cc"><span class="pt-conc"><span class="pt-name">${esc(m.conc)}</span>${repIcon(m)}${m.kind === 'meta' ? '<em class="pt-tag">Plan</em>' : ''}</span><span class="pt-nota ${t}">${m.d === 1 ? 'Falta 1 día' : `Faltan ${m.d} días`}</span></span>
    <span class="pt-amt"><b>${fmtMoney(apartarMonto(m, per[2]))}</b><small>de ${fmtMoney(m.pend)}</small></span>
  </button>`;
  }).join('');
  const cats = [...new Map(fut.map(m => [catOf(m.cat).id, catOf(m.cat)])).values()].sort((a, c) => a.id.localeCompare(c.id, 'es'));
  $('#list').innerHTML = `<div class="pt"><div class="pt-cols pt-th">${head}</div>${rows}<div class="pt-foot"><span>${plural(fut.length, 'pago', 'pagos')} · por ${per[0] === 'dia' ? 'día' : per[1].toLowerCase()}</span><b>${fmtMoney(tot(per[2]))}</b></div></div>
    <div class="pt-key" aria-label="Categorías">${cats.map(c => `<span data-cat="${esc(c.id)}">${catIcon(c)}${esc(c.id)}</span>`).join('')}</div>`;
}

/* Imagen PNG del mes: la misma pantalla de Pagos (HTML + CSS de la app, tema actual) a 390 px de ancho
   y completa hasta el último pago. Se dibuja como SVG con foreignObject; fuentes e iconos van embebidos. */
const IMG_W = 390;
const blobDataURL = blob => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });

async function monthCSS() {
  let css = await (await fetch('styles.css')).text();
  const urls = [...new Set([...css.matchAll(/url\('?(fonts\/[^')]+)'?\)/g)].map(m => m[1]))];
  for (const u of urls) css = css.split(u).join(await blobDataURL(await (await fetch(u)).blob()));
  return css.replace(/url\('?(data:[^')]+)'?\)/g, 'url($1)') + '\nbody{min-height:0;padding:0}';
}

function monthMarkup() {
  const base = monthItems();
  const titulo = `${isCurrentMonth() ? HOY.getDate() + ' ' : ''}${MESES[state.month.month]} ${state.month.year}`;
  const list = base.length
    ? pagosTable({ items: base })
    : `<div class="empty"><strong>Nada en ${MESES[state.month.month].toLowerCase()}</strong></div>`;
  const box = document.createElement('div');
  box.innerHTML = `<div class="app"><header class="header"><div class="header-title-row"><span class="hp-label"><span>${titulo}</span></span></div></header>
    <main><section class="hero"><div id="kpi-dash">${kpiDashboard(base)}</div></section>
    <div class="list-head"><div class="list-title"><span id="list-caption">Pagos</span><span id="list-count">${plural(base.length, 'pago', 'pagos')}</span></div></div>
    <div id="list">${list}</div></main></div>`;
  box.style.cssText = `width:${IMG_W}px;padding-bottom:28px;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:15px;line-height:1.35;-webkit-font-smoothing:antialiased`;
  box.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  return new XMLSerializer().serializeToString(box);
}

/* WhatsApp reduce toda imagen a ~1600 px de largo (y la pixela si es más larga), así que el mes sale en
   páginas de 800 px de alto × escala 2 = 1600 px, cortadas entre renglones. */
const PAGE_H = 800, IMG_SC = 2;

async function monthImages() {
  const theme = 'dark';
  const css = await monthCSS(), markup = monthMarkup();
  // Mide la altura real y dónde termina cada renglón con un iframe del mismo ancho (así los media queries coinciden).
  const fr = document.createElement('iframe');
  fr.style.cssText = `position:fixed;left:-9999px;top:0;width:${IMG_W}px;height:100px;border:0`;
  fr.srcdoc = `<!DOCTYPE html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head><body>${markup}</body></html>`;
  document.body.appendChild(fr);
  let H, cuts;
  try {
    await new Promise(r => { fr.onload = r; });
    await fr.contentDocument.fonts.ready;
    const box = fr.contentDocument.body.firstElementChild, top = box.getBoundingClientRect().top;
    H = Math.ceil(box.getBoundingClientRect().height);
    cuts = [...fr.contentDocument.querySelectorAll('.pt-row')].map(r => Math.ceil(r.getBoundingClientRect().bottom - top));
  } finally { fr.remove(); }
  // Páginas: cada corte cae en el último renglón que cabe; la última página lleva el resto.
  const pages = [];
  for (let y = 0; y < H;) {
    const fit = cuts.filter(c => c > y && c - y <= PAGE_H);
    const end = H - y <= PAGE_H * 1.15 ? H : (fit.length ? fit[fit.length - 1] : Math.min(H, y + PAGE_H));
    pages.push([y, end]);
    y = end;
  }
  // El SVG se rasteriza ya a su tamaño final (ancho × escala), sin escalar un mapa de bits pequeño.
  const W = IMG_W * IMG_SC, Hs = H * IMG_SC;
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hs}" viewBox="0 0 ${IMG_W} ${H}" data-theme="${theme}"><foreignObject x="0" y="0" width="${IMG_W}" height="${H}"><style><![CDATA[${css}]]></style>${markup}</foreignObject></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fbfaf6';
  return Promise.all(pages.map(([y0, y1]) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = (y1 - y0) * IMG_SC;
    const x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, cv.width, cv.height);
    x.drawImage(img, 0, y0 * IMG_SC, W, cv.height, 0, 0, W, cv.height);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }));
}

async function shareMonth() {
  const title = `Finanzas · ${MESES[state.month.month]} ${state.month.year}`;
  try {
    const blobs = await monthImages();
    const base = `finanzas-${state.month.year}-${String(state.month.month + 1).padStart(2, '0')}`;
    const files = blobs.map((b, i) => new File([b], blobs.length > 1 ? `${base}-${i + 1}.png` : `${base}.png`, { type: 'image/png' }));
    if (navigator.canShare?.({ files })) { await navigator.share({ files, title }); return; }
    files.forEach((f, i) => setTimeout(() => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, i * 300));
    toast(files.length > 1 ? `${files.length} imágenes descargadas` : 'Imagen descargada');
  } catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir'); }
}

/* Fondo de pantalla 9:16 con la meta diaria al centro (al tocar el mosaico «Meta diaria»). */
async function shareFondo(d) {
  if (!d.apartar && !isCurrentMonth()) { toast('Vuelve al mes actual para generar el fondo'); return; }
  const meta = +d.meta || 0, dias = +d.dias || 1, pct = Math.min(100, +d.pct || 0), porv = +d.porv || 0;
  try {
    await Promise.all(['800 40px "Bricolage Grotesque"', '500 20px "DM Sans"', '600 20px "JetBrains Mono"'].map(f => document.fonts.load(f)));
    const W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#0C0C10'; x.fillRect(0, 0, W, H);
    const g = x.createRadialGradient(540, 960, 0, 540, 960, 600);
    g.addColorStop(0, 'rgba(250,204,21,.14)'); g.addColorStop(1, 'rgba(250,204,21,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    if ('letterSpacing' in x) x.letterSpacing = '12px';
    x.fillStyle = 'rgba(244,244,239,.55)'; x.font = '600 34px "JetBrains Mono"'; x.fillText(d.label || 'META DIARIA', 546, 740);
    x.letterSpacing = '-10px';
    const num = meta.toLocaleString('es-MX'), nf = '800 250px "Bricolage Grotesque"';
    x.font = nf; const nw = x.measureText(num).width;
    x.font = '800 110px "Bricolage Grotesque"'; const sw = x.measureText('$').width + 8;
    const x0 = 540 - (nw + sw) / 2;
    x.textAlign = 'left'; x.fillStyle = '#FACC15'; x.fillText('$', x0, 905);
    x.fillStyle = '#F4F4EF'; x.font = nf; x.fillText(num, x0 + sw, 970);
    x.textAlign = 'center'; if ('letterSpacing' in x) x.letterSpacing = '0px';
    x.fillStyle = 'rgba(244,244,239,.5)'; x.font = '500 38px "DM Sans"';
    x.fillText(d.texto || `para cubrir los próximos ${plural(dias, 'día', 'días')}`, 540, 1040);
    x.fillStyle = '#16161C'; x.beginPath(); x.roundRect(260, 1110, 560, 10, 5); x.fill();
    if (pct > 0) { x.fillStyle = '#22C55E'; x.beginPath(); x.roundRect(260, 1110, Math.max(10, 560 * pct / 100), 10, 5); x.fill(); }
    const chips = [['#22C55E', `${pct}%`], ['#FACC15', `${porv} por vencer`]];
    x.font = '500 30px "JetBrains Mono"';
    const ws = chips.map(c => x.measureText(c[1]).width + 26 + 52), tot = ws.reduce((a, b) => a + b) + 18 * (chips.length - 1);
    let cx = 540 - tot / 2;
    chips.forEach((c, i) => {
      x.fillStyle = '#16161C'; x.strokeStyle = 'rgba(244,244,239,.1)'; x.lineWidth = 2;
      x.beginPath(); x.roundRect(cx, 1160, ws[i], 62, 31); x.fill(); x.stroke();
      x.fillStyle = c[0]; x.beginPath(); x.arc(cx + 26 + 7, 1191, 7, 0, 7); x.fill();
      x.fillStyle = '#F4F4EF'; x.textAlign = 'left'; x.fillText(c[1], cx + 26 + 26, 1202); cx += ws[i] + 18;
    });
    x.textAlign = 'center'; if ('letterSpacing' in x) x.letterSpacing = '9px';
    x.fillStyle = 'rgba(244,244,239,.25)'; x.font = '600 28px "JetBrains Mono"'; x.fillText('FINANZAS', 544, 1800);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = new File([blob], `fondo-meta-diaria-${toISO(HOY)}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Meta diaria' }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Fondo descargado');
  } catch (e) { if (e.name !== 'AbortError') toast('No se pudo generar la imagen'); }
}

/* Dashboard de Pagar: tarjeta partida Total | Por pagar, tres mosaicos de estado (filtran la lista)
   y resumen operativo (total cartera; vuelve a mostrar todo). */
function kpiDashboard(base) {
  const totalAbo = sum(base, 'abo'), totalImp = sum(base, 'imp'), pend = sum(base, 'pendiente');
  const conAbono = base.filter(m => m.abo > 0); /* «Pagado» = dinero abonado: el importe y el conteo son de los mismos pagos (liquidados o a medias) */
  const yaL = base.filter(m => m.pendiente > 0 && daysFromToday(m.date) <= 0);
  const porVencerL = base.filter(m => m.pendiente > 0 && daysFromToday(m.date) > 0);
  const atrasado = sum(yaL, 'pendiente');
  const porVencer = sum(porVencerL, 'pendiente');

  const tiles = [
    { k: 'a', filter: 'pagado', label: 'Pagado', v: totalAbo, n: conAbono.length },
    { k: 'c', filter: 'pendiente', label: 'Por vencer', v: porVencer, n: porVencerL.length },
    { k: 'b', filter: 'vencido', label: 'Pagar ya', v: atrasado, n: yaL.length }
  ].map(t => {
    const on = state.filter === t.filter;
    return `<button type="button" class="kpi-lg lg-${t.k}" data-action="filter" data-filter="${on ? 'todos' : t.filter}" aria-pressed="${on}"><span class="kpi-lg-t">${t.label}</span><span><span class="kpi-lg-m">${fmtMoney(t.v)}</span><span class="kpi-s">${plural(t.n, 'pago', 'pagos')}</span></span></button>`;
  }).join('');

  return `
    <div class="kpi-split">
      <div class="kpi-half" aria-label="Total del mes"><span class="kpi-sec">TOTAL</span><span class="kpi-pv">${fmtMoney(totalImp)}</span><span class="kpi-s">${totalImp > 0 ? Math.round(totalAbo / totalImp * 100) : 0}% pagado</span></div>
      <span class="kpi-div" aria-hidden="true"></span>
      <button type="button" class="kpi-half" data-action="resumen" aria-pressed="${state.filter === 'todos' && state.sort.col === 'fecha' && state.sort.asc}"><span class="kpi-sec">POR PAGAR</span><span class="kpi-pv">${fmtMoney(pend)}</span><span class="kpi-s">${totalImp > 0 ? Math.round(pend / totalImp * 100) : 0}% del mes</span></button>
    </div>
    <div class="kpi-legend">${tiles}</div>`;
}

/* Respaldo en tu hoja de Google (script en apps-script/Code.gs): conexión, envío manual y «auto». */
const SCRIPT_URL = 'https://github.com/jeal1498/PWA-Finance/blob/main/apps-script/Code.gs';
function openSync(note) {
  sheet.ctx = { type: 'sync' };
  const cfg = sync.getCfg(), conn = sync.connection();
  const when = cfg.last ? new Date(cfg.last).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'nunca';
  const msg = note ? `<p class="note" role="status">${esc(note)}</p>` : (cfg.error ? `<p class="form-error" role="alert">${esc(cfg.error)}</p>` : '');
  openSheet('Respaldo en Google Sheets', `
    ${conn ? `<p class="note">Tus pagos y planes van a las pestañas «Finanzas · Pagos» y «Finanzas · Metas» de tu hoja. Última sincronización: <b>${when}</b>.</p>` : `<p class="note">Conecta una hoja de tu Drive: crea una hoja nueva, pega ahí el <a href="${SCRIPT_URL}" target="_blank" rel="noopener">script</a> (Extensiones → Apps Script), cambia la clave, impleméntalo como aplicación web (acceso: cualquier persona) y copia aquí la URL y la clave.</p>`}${msg}
    <form id="sync-form" autocomplete="off">
      <label for="sync-url">URL de la aplicación web</label>
      <input id="sync-url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url || '')}" required>
      <label for="sync-token">Clave</label>
      <input id="sync-token" type="text" autocapitalize="off" spellcheck="false" value="${esc(cfg.token || '')}" required>
      <label class="switch-row" for="sync-auto"><span>Sincronizar sola después de cada cambio</span><input type="checkbox" class="switch" id="sync-auto" role="switch"${cfg.auto ? ' checked' : ''}></label>
      <div class="btn-row"><button type="submit" class="btn btn-primary">${conn ? 'Guardar' : 'Conectar y sincronizar'}</button></div>
    </form>
    ${conn ? `<div class="btn-row"><button type="button" class="btn btn-soft" data-action="sync-push" id="sync-push">Sincronizar ahora</button></div>
    <div class="btn-row"><button type="button" class="btn btn-soft" data-action="sync-pull">Traer de la hoja</button></div>
    <p class="hint">«Traer de la hoja» reemplaza lo que hay en este teléfono por la última copia.</p>` : ''}`);
  sheet.panel.focus({ preventScroll: true });
}

async function syncSave(form) {
  const url = $('#sync-url', form).value.trim(), token = $('#sync-token', form).value.trim();
  sync.setCfg({ url, token, auto: $('#sync-auto', form).checked, error: '' });
  await syncPush();
}

/* Botón de sincronizar (arriba del «+»): envía de una vez; sin conexión a la hoja abre la pantalla para conectarla. */
function marcaSync() {
  const b = $('#nav-sync');
  if (b) b.classList.toggle('err', !!(sync.connection() && sync.getCfg().error));
}
async function syncRapido(btn) {
  if (!sync.connection()) { openSync(); return; }
  btn.classList.add('girando'); btn.disabled = true;
  try {
    try { await sync.push(movimientos, metas, { dbOk }); }
    catch (e) {
      if (e.code !== 'drop' || !window.confirm(`${e.message}\n\n¿Enviar de todos modos?`)) throw e;
      await sync.push(movimientos, metas, { dbOk, force: true });
    }
    toast('Sincronizado con Google Sheets');
  } catch (e) {
    sync.setCfg({ error: e.message || 'No se pudo sincronizar' });
    toast(e.message || 'No se pudo sincronizar');
  } finally {
    btn.classList.remove('girando'); btn.disabled = false; marcaSync();
  }
}

async function syncPush() {
  const btn = $('#sync-push');
  if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando…'; }
  try {
    try { await sync.push(movimientos, metas, { dbOk }); }
    catch (e) {
      if (e.code !== 'drop' || !window.confirm(`${e.message}\n\n¿Enviar de todos modos?`)) throw e;
      await sync.push(movimientos, metas, { dbOk, force: true });
    }
    openSync('Listo: tus pagos y planes ya están en la hoja.');
  } catch (e) {
    sync.setCfg({ error: e.message || 'No se pudo sincronizar' });
    openSync();
  }
}

/* Deja solo registros completos (id, fecha, concepto, importe); así uno malo nunca vacía la base a medias. */
function sanear(list) {
  const ids = new Set(), ok = [];
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || ids.has(x.id)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.fecha)) || typeof x.conc !== 'string' || !Number.isFinite(+x.imp) || +x.imp < 0) continue;
    const pagos = Array.isArray(x.pagos) ? x.pagos.filter(p => p && Number.isFinite(+p.monto) && +p.monto > 0).map(p => ({ fecha: p.fecha || null, monto: +p.monto })) : [];
    ids.add(x.id);
    ok.push({ ...x, imp: +x.imp, pagos, abo: r2(pagos.reduce((t, p) => t + p.monto, 0)) });
  }
  return ok;
}

async function syncPull() {
  try {
    const data = await sync.pull();
    if (!data) return openSync('La hoja aún no tiene una copia. Sincroniza primero.');
    const recibidos = (Array.isArray(data.movimientos) ? data.movimientos.length : 0) + (Array.isArray(data.metas) ? data.metas.length : 0);
    const mov = sanear(data.movimientos), met = sanear(data.metas);
    if (!mov.length && !met.length) return openSync('La copia de la hoja no trae registros válidos; no se cambió nada.');
    const omitidos = recibidos - mov.length - met.length;
    const msg = `La hoja trae ${plural(mov.length, 'pago', 'pagos')} y ${plural(met.length, 'plan', 'planes')}${omitidos ? ` (${omitidos} no válidos se omiten)` : ''}.\nAquí hay ${plural(movimientos.length, 'pago', 'pagos')} y ${plural(metas.length, 'plan', 'planes')}.\n\n¿Reemplazar lo que hay en este teléfono por la copia de la hoja?`;
    if (!window.confirm(msg)) return;
    const snap = { mov: copyOf(movimientos), met: copyOf(metas) };
    await dbBatch({ movimientos: { clear: true, put: mov }, metas: { clear: true, put: met } });
    movimientos = (await db.all('movimientos')).sort(byFecha);
    metas = (await db.all('metas')).sort(byFecha);
    closeSheet();
    setView(state.view);
    toast('Copia traída de la hoja', { label: 'Deshacer', run: () => undoImport(snap) });
  } catch (e) {
    return openSync(e.message || 'No se pudo traer la copia');
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openImport(msg = '') {
  sheet.ctx = { type: 'import' };
  openSheet('Importar datos', `
    <p class="note">Elige un archivo <b>JSON</b> (el de Exportar) o un <b>CSV</b> con las columnas Tipo, Fecha, Concepto, Categoría, Importe y Abonado. También sirve una hoja de Excel guardada como CSV: se omiten los renglones de Ingreso.</p>
    <div class="imp-pick">
      <span class="btn btn-primary file-btn">Elegir archivo<input type="file" id="imp-file" accept=".json,.csv,.txt,application/json,text/csv" aria-label="Elegir archivo para importar"></span>
      <button type="button" class="btn btn-soft" data-action="template">Descargar plantilla CSV</button>
    </div>
    <p class="form-error" id="imp-error" role="alert">${esc(msg)}</p>`);
  sheet.panel.focus({ preventScroll: true });
}

async function readImportFile(file) {
  if (!file) return;
  try {
    if (file.size > 5e6) throw new Error('El archivo pesa más de 5 MB.');
    showImportPreview(file.name, parseImport(await file.text(), CATS));
  } catch (err) {
    $('#imp-error').textContent = err.message || 'No pude leer el archivo.';
  }
}

function showImportPreview(name, p) {
  const movIds = new Set(movimientos.map(x => x.id)), metIds = new Set(metas.map(x => x.id));
  const total = p.movimientos.length + p.metas.length;
  const existen = p.movimientos.filter(x => movIds.has(x.id)).length + p.metas.filter(x => metIds.has(x.id)).length;
  const label = `Importar ${plural(total, 'registro', 'registros')}`;
  const have = movimientos.length + metas.length > 0;
  sheet.ctx = { type: 'import', parsed: p };
  openSheet('Importar datos', `
    <p class="imp-file">${esc(name)}</p>
    <div class="figs">
      <div class="fig"><span>Pagos</span><b>${p.movimientos.length}</b></div>
      <div class="fig"><span>Planes</span><b>${p.metas.length}</b></div>
      <div class="fig"><span>Importe</span><b>${fmtMoney(sum(p.movimientos, 'imp'))}</b></div>
    </div>
    <p class="note">${total ? `${plural(total - existen, 'nuevo', 'nuevos')}${existen ? ` · ${existen} ya existen y se actualizan` : ''}` : 'No encontré pagos ni planes en el archivo.'}${p.ingresos ? ` · ${plural(p.ingresos, 'ingreso omitido', 'ingresos omitidos')} (Finanzas no registra ingresos)` : ''}</p>
    ${p.skipped.length ? `<details class="imp-skip"><summary>${plural(p.skipped.length, 'renglón omitido', 'renglones omitidos')}</summary><ul>${p.skipped.slice(0, 10).map(s => `<li>${esc(s.where)}: ${esc(s.reason)}</li>`).join('')}${p.skipped.length > 10 ? `<li>…y ${p.skipped.length - 10} más</li>` : ''}</ul></details>` : ''}
    ${total && have ? `<div role="radiogroup" aria-labelledby="imp-mode-l">
      <span class="label" id="imp-mode-l">¿Cómo lo importo?</span>
      <label class="opt"><input type="radio" name="imp-mode" value="add" checked><span>Agregar a lo que ya tengo<small>No borra nada; lo que ya existe se actualiza y conserva sus abonos.</small></span></label>
      <label class="opt"><input type="radio" name="imp-mode" value="replace"><span>Reemplazar todo<small>Borra tus ${plural(movimientos.length, 'pago', 'pagos')} y ${plural(metas.length, 'plan', 'planes')} actuales y deja solo lo del archivo.</small></span></label>
    </div>` : ''}
    <div class="btn-row">
      <button type="button" class="btn btn-soft" data-action="open-import">Otro archivo</button>
      ${total ? `<button type="button" class="btn btn-primary" id="imp-go" data-action="import-go" data-label="${label}">${label}</button>` : ''}
    </div>`);
  sheet.panel.focus({ preventScroll: true });
}

const copyOf = list => list.map(x => ({ ...x, pagos: (x.pagos || []).map(p => ({ ...p })) }));

async function applyImport() {
  const p = sheet.ctx && sheet.ctx.parsed;
  if (!p) return;
  const replace = (document.querySelector('input[name=imp-mode]:checked') || {}).value === 'replace';
  const snap = { mov: copyOf(movimientos), met: copyOf(metas) };
  const now = Date.now();
  const stamp = x => ({ ...x, createdAt: x.createdAt || now, updatedAt: now });
  try {
    /* En «Agregar», si el registro ya existe se conservan los abonos y la repetición que tenga la app. */
    const unir = (nuevos, actuales) => nuevos.map(x => {
      const ya = replace ? null : actuales.find(m => m.id === x.id);
      if (!ya) return stamp(x);
      const conservar = ya.abo >= x.abo;
      return stamp({ ...(conservar ? { ...x, pagos: ya.pagos, abo: ya.abo } : x), ...(ya.serie && !x.serie ? { serie: ya.serie, repite: ya.repite, freq: ya.freq, fin: ya.fin } : {}), createdAt: ya.createdAt });
    });
    await dbBatch({ movimientos: { clear: replace, put: unir(p.movimientos, movimientos) }, metas: { clear: replace, put: unir(p.metas, metas) } });
    movimientos = (await db.all('movimientos')).sort(byFecha);
    metas = (await db.all('metas')).sort(byFecha);
    autoSync();
  } catch (e) {
    return toast('No se pudo importar en este dispositivo');
  }
  setView(state.view);
  toast(`Importado: ${plural(p.movimientos.length, 'pago', 'pagos')} y ${plural(p.metas.length, 'plan', 'planes')}`, { label: 'Deshacer', run: () => undoImport(snap) });
}

async function undoImport(snap) {
  try {
    await dbBatch({ movimientos: { clear: true, put: snap.mov }, metas: { clear: true, put: snap.met } });
  } catch (e) {
    return toast('No se pudo deshacer');
  }
  movimientos = copyOf(snap.mov).sort(byFecha);
  metas = copyOf(snap.met).sort(byFecha);
  render();
  toast('Importación deshecha');
}

/* =========================================================
   Acciones
   ========================================================= */
function setView(v) {
  closeSheet();
  state.view = v;
  lsSet(KEYS.view, v);
  state.filter = v === 'gastos' ? 'todos' : 'todas';
  state.search = '';
  $('#search').value = '';
  $('#search-bar').hidden = true;
  window.scrollTo(0, 0);
  render();
}

function setGrouping(g) {
  state.grouping = g;
  lsSet(KEYS.group, g);
  render();
  /* Aviso de una sola vez: ya no hay flechas, el mes se cambia deslizando. */
  if (!lsGet(KEYS.hint)) {
    lsSet(KEYS.hint, '1');
    toast('Desliza sobre el mes para cambiarlo');
  }
}

function shiftMonth(delta) {
  const d = new Date(state.month.year, state.month.month + delta, 1);
  state.month = { year: d.getFullYear(), month: d.getMonth() };
  render();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ['#list', '#s-amount', '#month-text'].forEach(sel => {
      const el = $(sel);
      if (el && el.animate) el.animate(
        [{ transform: `translateX(${delta * 28}px)`, opacity: .25 }, { transform: 'none', opacity: 1 }],
        { duration: 200, easing: 'ease-out' }
      );
    });
  }
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  switch (a) {
    case 'backdrop': if (e.target === t) requestClose(); break;
    case 'close-sheet': requestClose(); break;
    case 'share-month': shareMonth(); break;
    case 'fondo': shareFondo(t.dataset); break;
    case 'open-sync': openSync(); break;
    case 'sync-push': syncPush(); break;
    case 'sync-pull': syncPull(); break;
    case 'open-import': openImport(); break;
    case 'export-json':
      download(`finanzas-${toISO(HOY)}.json`, exportJSON(movimientos, metas), 'application/json');
      closeSheet(); toast(`Descargado: ${plural(movimientos.length, 'pago', 'pagos')} y ${plural(metas.length, 'plan', 'planes')}`);
      break;
    case 'export-csv':
      download(`finanzas-${toISO(HOY)}.csv`, '\uFEFF' + exportCSV(movimientos, metas), 'text/csv');
      closeSheet(); toast(`Descargado: ${plural(movimientos.length, 'pago', 'pagos')} y ${plural(metas.length, 'plan', 'planes')}`);
      break;
    case 'template': download('plantilla-finanzas.csv', '\uFEFF' + templateCSV(), 'text/csv'); break;
    case 'import-go': await applyImport(); break;
    case 'search-toggle': {
      const bar = $('#search-bar');
      bar.hidden = !bar.hidden;
      t.setAttribute('aria-expanded', String(!bar.hidden));
      if (!bar.hidden) $('#search').focus();
      else if (state.search) { state.search = ''; $('#search').value = ''; render(); }
      break;
    }
    case 'apartar-per': state.apartar = t.dataset.per; renderApartar(); break;
    case 'view': if (t.dataset.view !== state.view) setView(t.dataset.view); break;
    case 'add': {
      const kind = state.view === 'metas' ? 'meta' : 'gasto';
      openAdd(kind, t.dataset.mode || (hasPending(kind) ? 'pay' : 'new'));
      break;
    }
    case 'add-mode': {
      if (t.getAttribute('aria-pressed') === 'true') break;
      const kind = sheet.ctx.kind, mode = t.dataset.mode;
      askDiscard(() => openAdd(kind, mode));
      break;
    }
    case 'discard-no': dismissDiscard(); break;
    case 'discard-yes': { const go = sheet.discard; $('#discard').remove(); if (go) go(); break; }
    case 'pay-pick': openPayDetail(sheet.ctx.kind, t.dataset.id); break;
    case 'pay-back': openPay(sheet.ctx.kind); break;
    case 'pay-filter': {
      sheet.ctx.payF = t.dataset.f;
      $$('#pay-chips [data-f]').forEach(c => { const on = c === t; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
      $('#pay-list').innerHTML = payListHTML(sheet.ctx.kind, $('#pay-search').value, sheet.ctx.payF);
      break;
    }
    case 'pay-search-toggle': {
      const w = $('#pay-search-wrap');
      w.hidden = !w.hidden;
      t.setAttribute('aria-expanded', String(!w.hidden));
      if (!w.hidden) $('#pay-search').focus(); else { $('#pay-search').value = ''; $('#pay-list').innerHTML = payListHTML(sheet.ctx.kind, '', sheet.ctx.payF); }
      break;
    }
    case 'group': setGrouping(t.dataset.group); break;
    case 'month-picker': openMonthPicker(); break;
    case 'pick-month': state.month = { year: +t.dataset.year, month: +t.dataset.month }; closeSheet(); render(); break;
    case 'pick-today': state.month = { year: HOY.getFullYear(), month: HOY.getMonth() }; closeSheet(); render(); break;
    case 'resumen': state.filter = 'todos'; state.sort = { col: 'fecha', asc: true }; render(); break;
    case 'sort': { const k = t.dataset.col, key = state.view === 'metas' ? 'sortMetas' : 'sort'; state[key] = { col: k, asc: state[key].col === k ? !state[key].asc : true }; render(); break; }
    case 'filter': state.filter = t.dataset.filter; render(); break;
    case 'toggle-group': {
      const sec = t.closest('.group');
      const open = !sec.classList.contains('open');
      sec.classList.toggle('open', open);
      t.setAttribute('aria-expanded', String(open));
      state.open[t.dataset.gkey] = open;
      break;
    }
    case 'open': openDetail(t.dataset.kind, t.dataset.id); break;
    case 'abono-all': {
      const { kind, id } = sheet.ctx;
      const m = listOf(kind).find(x => x.id === id);
      if (m) $('#abono').value = Math.max(0, m.imp - m.abo);
      break;
    }
    case 'sug-pick': {
      const s = (sheet.sug || [])[+t.dataset.i];
      if (!s) break;
      $('#f-conc').value = s.nombre;
      const c = CATS.find(x => x.id === catLabelOf(s.cat)), r = c && $(`input[name=f-cat][value="${c.id}"]`);
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      if (!$('#f-imp').value) $('#f-imp').value = s.imp;
      $('#f-sug').hidden = true;
      $('#f-imp').focus();
      break;
    }
    case 'open-conceptos': state.conceptoPer = state.conceptoPer || 'mes'; openConceptos(); break;
    case 'conc-per': state.conceptoPer = t.dataset.per; openConceptos(); break;
    case 'sync-quick': syncRapido(t); break;
    case 'abono-edit': openAbonoEdit(sheet.ctx.kind, sheet.ctx.id, +t.dataset.idx); break;
    case 'abono-back': openDetail(sheet.ctx.kind, sheet.ctx.id); break;
    case 'abono-del': {
      const { kind, id, idx } = sheet.ctx;
      const m = listOf(kind).find(x => x.id === id);
      if (m && m.pagos && m.pagos[idx]) { m.pagos.splice(idx, 1); syncAbo(m); finish(kind, m, kind === 'meta' ? 'Ahorro eliminado' : 'Abono eliminado'); }
      break;
    }
    case 'reopen': {
      const { kind, id } = sheet.ctx;
      const m = listOf(kind).find(x => x.id === id);
      if (m && m.pagos && m.pagos.length) { m.pagos.pop(); syncAbo(m); const ok = await persist(kind, m); closeSheet(); render(); toast(ok ? 'Último abono deshecho' : 'No se pudo guardar en este dispositivo'); }
      break;
    }
    case 'edit': openForm(sheet.ctx.kind, sheet.ctx.id); break;
    case 'delete': {
      const { kind, id } = sheet.ctx;
      const item = listOf(kind).find(m => m.id === id);
      if (!item) break;
      /* Eliminar una copia solo salta ese mes: la serie sigue (para detenerla se apaga «Se repite» al editar o se pone «Termina»). */
      const hermanos = item.serie ? listOf(kind).filter(m => m.serie === item.serie && m.id !== id) : [];
      const previo = hermanos.length && item.repite ? hermanos : null;
      if (previo) for (const h of previo) { h.omitidos = [...new Set([...(h.omitidos || []), item.fecha])]; await persist(kind, h); }
      if (kind === 'meta') metas = metas.filter(m => m.id !== id); else movimientos = movimientos.filter(m => m.id !== id);
      await unpersist(kind, id);
      closeSheet(); render();
      toast(previo ? 'Eliminado · se salta ese mes' : 'Eliminado', { label: 'Deshacer', run: async () => {
        const list = listOf(kind);
        list.push(item);
        list.sort(byFecha);
        if (previo) for (const h of previo) { h.omitidos = (h.omitidos || []).filter(f => f !== item.fecha); if (!h.omitidos.length) delete h.omitidos; await persist(kind, h); }
        await persist(kind, item); reveal(kind, item); render();
        toast('Restaurado');
      } });
      break;
    }
  }
});

document.addEventListener('input', e => { if (e.target.id === 'f-conc') pintarSugerencias(); });

document.addEventListener('change', e => {
  if (['f-rep', 'f-fecha', 'f-fin', 'f-imp', 'f-paid'].includes(e.target.id) || e.target.name === 'f-freq') actualizarFin();
  if (e.target.name === 'f-cat' && sheet.ctx) { const c = CATS.find(x => x.id === e.target.value); if (c) sheet.ctx.cat = catString(c); }
  if (e.target.id === 'imp-file') readImportFile(e.target.files[0]);
  if (e.target.name === 'imp-mode') {
    const replace = e.target.value === 'replace', go = $('#imp-go');
    go.textContent = replace ? 'Reemplazar todo' : go.dataset.label;
    go.className = `btn ${replace ? 'btn-danger' : 'btn-primary'}`;
  }
});

document.addEventListener('submit', e => {
  if (e.target.id === 'form') { e.preventDefault(); submitForm(); }
  else if (e.target.id === 'abono-form') { e.preventDefault(); submitAbono(); }
  else if (e.target.id === 'abono-edit-form') { e.preventDefault(); submitAbonoEdit(); }
  else if (e.target.id === 'sync-form') { e.preventDefault(); syncSave(e.target); }
});

$('#search').addEventListener('input', e => { state.search = e.target.value; render(); });
document.addEventListener('input', e => {
  if (e.target.id === 'pay-search') $('#pay-list').innerHTML = payListHTML(sheet.ctx.kind, e.target.value, sheet.ctx.payF);
  if (e.target.getAttribute('aria-invalid')) {
    e.target.removeAttribute('aria-invalid');
    const m = $('#' + e.target.getAttribute('aria-describedby'));
    if (m) m.textContent = '';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { requestClose(); return; }
  /* Tab da la vuelta dentro de la hoja abierta */
  if (e.key === 'Tab' && !sheet.el.hidden) {
    const f = $$('button, input, [tabindex]:not([tabindex="-1"])', sheet.panel).filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (e.shiftKey && (cur === first || cur === sheet.panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    return;
  }
  /* Alternativa con teclado al swipe: flechas sobre el nombre del mes */
  const label = $('#month-label');
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && document.activeElement === label && !label.disabled) {
    e.preventDefault();
    shiftMonth(e.key === 'ArrowRight' ? 1 : -1);
  }
});

/* Swipe horizontal para cambiar de mes (gastos agrupados por categoría) */
(() => {
  let sx = 0, sy = 0, t0 = 0, tracking = false;
  const zone = el => el && el.closest && el.closest('.header-title-row, .pt-mes');
  document.addEventListener('touchstart', e => {
    tracking = e.touches.length === 1 && !!zone(e.target);
    if (!tracking) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!tracking) return;
    tracking = false;
    if (state.view !== 'gastos' || !sheet.el.hidden) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - t0 > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    shiftMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

/* =========================================================
   Inicio
   ========================================================= */
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (refrescarHoy()) render(); recargarDatos(); } });
(function programarMedianoche() {
  const sig = new Date(); sig.setHours(24, 0, 5, 0);
  setTimeout(() => { if (refrescarHoy()) render(); programarMedianoche(); }, sig - Date.now());
})();
render();
if (!dbOk) toast('No se pudo abrir el almacenamiento de este dispositivo');

/* Enlaces desde Inicio y el buscador: finanzas/#gasto-ID o #meta-ID abren ese registro. */
const deep = location.hash.match(/^#(gasto|meta)-(.+)$/);
if (deep) {
  history.replaceState(null, '', location.pathname);
  const id = decodeURIComponent(deep[2]);
  if (listOf(deep[1]).some(m => m.id === id)) {
    if (deep[1] === 'meta') setView('metas');
    openDetail(deep[1], id);
  }
}
