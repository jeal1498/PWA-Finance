// Importar y exportar de Finanzas. Funciones puras (sin pantalla ni base de datos) para poder probarlas.
//
// Formatos:
// - JSON  {app:'secondbrain', movimientos:[…], metas:[…]}: el que baja "Exportar JSON" (sirve también en Respaldo → Agregar).
// - CSV   columnas Tipo, Fecha, Concepto, Categoría, Importe, Abonado (+ Id al exportar). Acepta coma, punto y coma o tabulador,
//         renglones de resumen antes de los encabezados y columnas de más (así sirve guardar una hoja de Excel como CSV).
//         Las fechas pueden ser 2026-10-05 o 05/10/2026 (día/mes/año). Los renglones "Ingreso" se omiten: Finanzas no registra ingresos.

const pad2 = (n) => String(n).padStart(2, '0');
const r2 = (n) => Math.round(n * 100) / 100;
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const labelOf = (c) => String(c ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

// "🚗 Vehículo", "VEHÍCULO" o "vehiculo" → texto guardado de la categoría conocida; una desconocida se conserva.
export function catFrom(text, cats) {
  const raw = String(text ?? '').trim();
  const l = labelOf(raw);
  if (!l) return '📦 Otro';
  const c = cats.find((x) => fold(x.id) === fold(l));
  if (c) return `${c.emoji} ${c.id}`;
  return /^[^\p{L}\p{N}\s]+\s+\S/u.test(raw) ? raw : `📦 ${l}`;
}

export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

// "$1,200.50", "1200", "1.200,50" (con punto y coma) → número; vacío o inválido → null.
export function parseAmount(v, decimalComma = false) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/mxn/i, '').replace(/[$\s]/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (decimalComma || /^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

// Texto estable de un renglón sin id: importarlo otra vez lo reemplaza en vez de duplicarlo.
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function makeId(kind, fecha, conc, imp, cat, seen) {
  const base = [kind, fecha, fold(conc), imp, fold(labelOf(cat))].join('|');
  let n = 0, id;
  do { id = `imp-${fnv(`${base}#${n}`)}`; n++; } while (seen.has(id));
  seen.add(id);
  return id;
}

const item = ({ id, fecha, cat, conc, imp, pagos, createdAt }) => {
  const out = { id, fecha, cat, conc, imp: r2(imp), abo: r2(pagos.reduce((t, p) => t + p.monto, 0)), pagos };
  if (typeof createdAt === 'number') out.createdAt = createdAt;
  return out;
};

// ---------- JSON ----------
function fromJSON(text, cats) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (!data || typeof data !== 'object' || (!Array.isArray(data.movimientos) && !Array.isArray(data.metas))) {
    throw new Error('El archivo no trae pagos ni metas de esta versión (campos "movimientos" y "metas").');
  }
  const out = { format: 'json', movimientos: [], metas: [], ingresos: 0, skipped: [] };
  const seen = new Set();
  const run = (list, kind, target) => (list || []).forEach((x, i) => {
    const where = `${kind === 'meta' ? 'Meta' : 'Pago'} ${i + 1}`;
    if (!x || typeof x !== 'object') return out.skipped.push({ where, reason: 'No es un registro' });
    const conc = String(x.conc ?? '').trim();
    const fecha = parseDate(x.fecha);
    const imp = parseAmount(x.imp);
    if (!conc) return out.skipped.push({ where, reason: 'Sin concepto' });
    if (!fecha) return out.skipped.push({ where: `${where} (${conc})`, reason: 'Fecha no válida' });
    if (imp == null || imp < 0 || (kind === 'pago' && imp === 0)) return out.skipped.push({ where: `${where} (${conc})`, reason: 'Importe no válido' });
    let pagos;
    if (Array.isArray(x.pagos)) {
      pagos = x.pagos.map((p) => ({ fecha: p && p.fecha ? parseDate(p.fecha) : null, monto: r2(parseAmount(p && p.monto) || 0) })).filter((p) => p.monto > 0);
    } else {
      const abo = parseAmount(x.abo) || 0;
      pagos = abo > 0 ? [{ fecha: null, monto: r2(abo) }] : [];
    }
    const cat = catFrom(x.cat, cats);
    let id = typeof x.id === 'string' && x.id.trim() ? x.id.trim() : null;
    if (id && seen.has(id)) return out.skipped.push({ where: `${where} (${conc})`, reason: 'Id repetido en el archivo' });
    if (id) seen.add(id); else id = makeId(kind, fecha, conc, imp, cat, seen);
    target.push(item({ id, fecha, cat, conc, imp, pagos, createdAt: x.createdAt }));
  });
  run(data.movimientos, 'pago', out.movimientos);
  run(data.metas, 'meta', out.metas);
  return out;
}

// ---------- CSV ----------
function splitCSV(text, delim) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADERS = {
  tipo: ['tipo'],
  fecha: ['fecha', 'fecha limite', 'para cuando', 'vence'],
  conc: ['concepto', 'descripcion', 'nombre'],
  cat: ['categoria'],
  imp: ['importe', 'monto', 'total'],
  abo: ['abonado', 'abono', 'ahorrado'],
  id: ['id'],
};

function fromCSV(text, cats) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => fold(l).includes('fecha') && fold(l).includes('concepto'));
  if (at < 0) throw new Error('No encuentro los encabezados. Debe haber una fila con Fecha, Concepto e Importe.');
  const head = lines[at];
  const delim = [',', ';', '\t'].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = splitCSV(lines.slice(at).join('\n'), delim);
  const names = rows[0].map(fold);
  const col = {};
  for (const [k, aliases] of Object.entries(HEADERS)) col[k] = names.findIndex((n) => aliases.includes(n));
  if (col.fecha < 0 || col.conc < 0 || col.imp < 0) throw new Error('Faltan columnas: se necesitan Fecha, Concepto e Importe.');
  const out = { format: 'csv', movimientos: [], metas: [], ingresos: 0, skipped: [] };
  const seen = new Set();
  const get = (r, k) => (col[k] >= 0 && r[col[k]] != null ? String(r[col[k]]).trim() : '');
  const decimalComma = delim === ';';
  rows.slice(1).forEach((r, i) => {
    const conc = get(r, 'conc').replace(/^'(?=[=+@-])/, '');
    const fechaRaw = get(r, 'fecha');
    const impRaw = get(r, 'imp');
    if (!conc && !fechaRaw && !parseAmount(impRaw, decimalComma)) return; // renglón vacío (o solo con ceros, como los de relleno de la hoja)
    const line = at + i + 2;
    const tipo = fold(get(r, 'tipo'));
    const kind = tipo === 'meta' || tipo === 'ahorro' ? 'meta' : 'pago';
    if (fold(conc) === 'ingreso' && kind === 'pago') { out.ingresos++; return; }
    const where = `Fila ${line}${conc ? ` (${conc})` : ''}`;
    if (!conc) return out.skipped.push({ where, reason: 'Sin concepto' });
    const fecha = parseDate(fechaRaw);
    if (!fecha) return out.skipped.push({ where, reason: 'Fecha no válida' });
    let imp = parseAmount(impRaw, decimalComma);
    if (imp == null && kind === 'meta') imp = 0;
    if (imp == null || imp < 0 || (kind === 'pago' && imp === 0)) return out.skipped.push({ where, reason: 'Importe no válido' });
    let abo = parseAmount(get(r, 'abo'), decimalComma) || 0;
    if (abo < 0) abo = 0;
    if (imp > 0 && abo > imp) abo = imp;
    const cat = catFrom(get(r, 'cat').replace(/^'(?=[=+@-])/, ''), cats);
    let id = get(r, 'id').replace(/^'(?=[=+@-])/, '');
    if (id && seen.has(id)) return out.skipped.push({ where, reason: 'Id repetido en el archivo' });
    if (id) seen.add(id); else id = makeId(kind, fecha, conc, imp, cat, seen);
    (kind === 'meta' ? out.metas : out.movimientos).push(item({ id, fecha, cat, conc, imp, pagos: abo > 0 ? [{ fecha: null, monto: abo }] : [] }));
  });
  return out;
}

// JSON o CSV según el contenido.
export function parseImport(text, cats) {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  if (!t) throw new Error('El archivo está vacío.');
  return t[0] === '{' || t[0] === '[' ? fromJSON(t, cats) : fromCSV(t, cats);
}

// ---------- Exportar ----------
export function exportJSON(movimientos, metas, now = new Date()) {
  return JSON.stringify({ app: 'secondbrain', formato: 'finanzas', version: 1, exportedAt: now.toISOString(), movimientos, metas }, null, 2);
}

// Un texto que empieza con "=" Excel lo tomaría como fórmula.
const safe = (v) => (/^[=+@-]/.test(v) ? "'" + v : v);
const q = (v) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const CSV_HEADER = ['Tipo', 'Fecha', 'Concepto', 'Categoría', 'Importe', 'Abonado', 'Id'];
export function exportCSV(movimientos, metas) {
  const sorted = (list) => [...list].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.conc).localeCompare(String(b.conc), 'es'));
  const row = (tipo, x) => [tipo, x.fecha, safe(String(x.conc)), safe(String(x.cat)), x.imp, x.abo || 0, safe(String(x.id))].map((v) => q(String(v))).join(',');
  return [CSV_HEADER.join(','), ...sorted(movimientos).map((x) => row('Pago', x)), ...sorted(metas).map((x) => row('Meta', x))].join('\r\n') + '\r\n';
}

export const templateCSV = () => [CSV_HEADER.slice(0, 6).join(','), 'Pago,2026-11-05,Luz,Servicios,800,0', 'Pago,2026-11-10,Internet,Servicios,600,200', 'Meta,2027-01-15,Vacaciones,Familia,20000,0'].join('\r\n') + '\r\n';
