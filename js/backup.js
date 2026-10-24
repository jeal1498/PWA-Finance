// Respaldo automático en una hoja de Google Sheets del usuario (vía Apps Script, gratis).
// La hoja tiene una pestaña legible por tipo de dato y una pestaña oculta "_respaldo"
// con la copia exacta (JSON) que se usa para restaurar.
import * as db from './db.js';

const FUEL = { gasolina: 'Gasolina', lp: 'Gas LP' };
const abonosTxt = (v) => (v || []).map((p) => `${p.fecha || 'sin fecha'}: ${p.monto}`).join(' · ');

// [pestaña, store, [[campo, encabezado, formato?]]]
const TABLES = [
  ['Cargas', 'fuel', [['date', 'Fecha'], ['fuelType', 'Combustible', (v) => FUEL[v || 'gasolina']], ['odometer', 'Odómetro'], ['liters', 'Litros'], ['pricePerLiter', 'Precio por litro'], ['total', 'Total'], ['full', 'Tanque lleno', (v) => (v ? 'Sí' : 'No')], ['station', 'Gasolinera'], ['notes', 'Notas']]],
  ['Servicio', 'maintenance', [['date', 'Fecha'], ['type', 'Tipo'], ['odometer', 'Odómetro'], ['cost', 'Costo'], ['shop', 'Taller'], ['notes', 'Notas']]],
  ['Gastos vehículo', 'expenses', [['date', 'Fecha'], ['category', 'Categoría'], ['amount', 'Monto'], ['notes', 'Notas']]],
  ['Avisos', 'reminders', [['title', 'Qué'], ['everyKm', 'Cada (km)'], ['everyMonths', 'Cada (meses)'], ['lastKm', 'Última vez (km)'], ['lastDate', 'Última vez (fecha)'], ['notes', 'Notas']]],
  ['Notas', 'notes', [['title', 'Título'], ['body', 'Nota'], ['tags', 'Etiquetas'], ['pinned', 'Fijada', (v) => (v ? 'Sí' : '')]]],
  ['Pendientes', 'tasks', [['due', 'Para cuándo'], ['title', 'Qué'], ['done', 'Hecho', (v) => (v ? 'Sí' : 'No')], ['doneAt', 'Hecho el'], ['notes', 'Notas']]],
  ['Hábitos', 'habits', [['name', 'Hábito'], ['emoji', 'Emoji'], ['done', 'Días cumplidos', (v) => (v || []).length], ['done', 'Último', (v) => (v || []).slice(-1)[0] || '']]],
  ['Proyectos', 'projects', [['name', 'Proyecto'], ['emoji', 'Emoji'], ['status', 'Estado'], ['description', 'De qué trata'], ['links', 'Accesos'], ['tags', 'Etiquetas'], ['notes', 'Notas'], ['pinned', 'Fijado', (v) => (v ? 'Sí' : '')]]],
  ['Diario', 'journal', [['date', 'Fecha'], ['mood', 'Ánimo'], ['text', 'Texto']]],
];

// Un texto que empieza con "=" Sheets lo tomaría como fórmula.
const cell = (v) => (v == null ? '' : typeof v === 'string' && /^[=+@-]/.test(v) ? "'" + v : v);

function tables(data) {
  const out = TABLES.map(([name, store, cols]) => ({
    name,
    headers: cols.map((c) => c[1]),
    rows: [...(data[store] || [])]
      .sort((a, b) => String(a.date || a.fecha || '').localeCompare(String(b.date || b.fecha || '')))
      .map((x) => cols.map(([k, , f]) => cell(f ? f(x[k]) : x[k]))),
  }));
  const settings = [
    ...Object.entries(data.vehicle || {}).map(([k, v]) => ['Vehículo', k, cell(v)]),
    ...Object.entries(data.finance || {}).filter(([k]) => k !== 'savings').map(([k, v]) => ['Finanzas', k, cell(v)]),
  ];
  out.push({ name: 'Ajustes', headers: ['Módulo', 'Dato', 'Valor'], rows: settings });
  return out;
}

export const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function getConfig() {
  return (await db.getSetting('backup')) || {};
}
export async function setConfig(patch) {
  const cfg = { ...(await getConfig()), ...patch };
  await db.setSetting('backup', cfg);
  return cfg;
}

// "Failed to fetch" con Apps Script casi siempre es la implementación (acceso, URL o error del script):
// Google responde una página de login/error sin permiso CORS y el navegador solo dice eso.
const NET_HELP = 'Google no respondió a la app. Revisa: 1) en la implementación, "Quién tiene acceso" = Cualquier persona (no "con cuenta de Google"); 2) la URL termina en /exec; 3) si cambiaste el código, haz Implementar → Gestionar implementaciones → editar → Nueva versión. Toca "Probar en el navegador" para ver qué contesta Google.';
async function call(url, opts) {
  let res;
  try { res = await fetch(url, opts); } catch { throw new Error(navigator.onLine === false ? 'Sin conexión a internet' : NET_HELP); }
  try { return await res.json(); } catch { throw new Error(NET_HELP); }
}

// Envía todo a la hoja. Body como text/plain para que el navegador no haga preflight (Apps Script no lo soporta).
export async function backupNow() {
  const cfg = await getConfig();
  if (!cfg.url) throw new Error('Respaldo no configurado');
  const started = Date.now();
  const data = await db.exportAll();
  try {
    const out = await call(cfg.url, { method: 'POST', body: JSON.stringify({ token: cfg.token, tables: tables(data), raw: JSON.stringify(data) }) });
    if (!out.ok) throw new Error(out.error || 'Error en la hoja');
    // Si algo cambió mientras se enviaba, sigue pendiente.
    const now = await getConfig();
    return await setConfig({ last: Date.now(), error: '', dirty: now.dirty > started ? now.dirty : 0 });
  } catch (err) {
    await setConfig({ error: err.message || 'Sin conexión', failedAt: Date.now() });
    throw err;
  }
}

export const testUrl = (cfg) => `${cfg.url}?token=${encodeURIComponent(cfg.token)}`;

export async function fetchBackup() {
  const cfg = await getConfig();
  const out = await call(testUrl(cfg));
  if (!out.ok) throw new Error(out.error || 'Error en la hoja');
  return out.data;
}

// Respaldo automático: tras cada cambio (agrupando varios seguidos) y al abrir la app si pasó más de un día.
let timer;
export async function scheduleBackup(changed, onDone) {
  let cfg = await getConfig();
  if (!cfg.url) return;
  // Se anota el cambio: si la pantalla se cierra antes de que corra el temporizador, el respaldo sale al abrir la app.
  if (changed) cfg = await setConfig({ dirty: Date.now() });
  const stale = !cfg.last || Date.now() - cfg.last > 864e5 || cfg.error || cfg.dirty;
  if (!changed && !stale) return;
  clearTimeout(timer);
  timer = setTimeout(() => backupNow().then(onDone, onDone), changed ? 4000 : 1500);
}

export function scriptFor(token) {
  return `// SecondBrain · respaldo en Google Sheets
const TOKEN = '${token}';

function doPost(e) {
  const req = JSON.parse(e.postData.contents);
  if (req.token !== TOKEN) return out({ ok: false, error: 'Clave incorrecta' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  req.tables.forEach(function (t) {
    const sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
    sh.clearContents();
    const rows = [t.headers].concat(t.rows);
    sh.getRange(1, 1, rows.length, t.headers.length).setValues(rows);
    sh.getRange(1, 1, 1, t.headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  // Copia exacta para restaurar (en trozos: una celda admite 50 mil caracteres).
  const raw = ss.getSheetByName('_respaldo') || ss.insertSheet('_respaldo');
  raw.clearContents();
  const parts = [];
  for (let i = 0; i < req.raw.length; i += 40000) parts.push([req.raw.slice(i, i + 40000)]);
  const range = raw.getRange(1, 1, parts.length, 1);
  range.setNumberFormat('@');
  range.setValues(parts);
  raw.hideSheet();
  ['Hoja 1', 'Sheet1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  return out({ ok: true });
}

function doGet(e) {
  if (e.parameter.token !== TOKEN) return out({ ok: false, error: 'Clave incorrecta' });
  const raw = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('_respaldo');
  if (!raw || raw.getLastRow() === 0) return out({ ok: false, error: 'Aún no hay respaldo' });
  const text = raw.getRange(1, 1, raw.getLastRow(), 1).getValues().map(function (r) { return r[0]; }).join('');
  return out({ ok: true, data: JSON.parse(text) });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
