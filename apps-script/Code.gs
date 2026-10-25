/* Respaldo de Finanzas en esta hoja de Google (Extensiones → Apps Script).
   1) Cambia CLAVE por una palabra larga que solo tú sepas (la misma va en la app).
   2) Implementar → Nueva implementación → Aplicación web:
      Ejecutar como: Yo · Quién tiene acceso: Cualquier persona. Copia la URL que termina en /exec. */
const CLAVE = 'CAMBIA-ESTA-CLAVE';
const PEDAZO = 40000; // una celda admite ~50 000 caracteres

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function escribir(ss, t) {
  const sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
  sh.clear();
  const filas = [t.headers].concat(t.rows || []);
  sh.getRange(1, 1, filas.length, t.headers.length).setValues(filas);
  sh.getRange(1, 1, 1, t.headers.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.token !== CLAVE) return salida({ ok: false, error: 'Clave incorrecta' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    /* Seguro: un envío vacío no pisa una copia que ya tiene datos; y siempre queda la copia anterior. */
    const datos = JSON.parse(b.raw || '{}');
    const vacio = !(datos.movimientos || []).length && !(datos.metas || []).length;
    const previo = ss.getSheetByName('_respaldo');
    const antes = previo && previo.getLastRow() ? previo.getRange(1, 1, previo.getLastRow(), 1).getValues().map(r => r[0]).join('') : '';
    if (vacio && antes) {
      const o = JSON.parse(antes);
      if ((o.movimientos || []).length || (o.metas || []).length) return salida({ ok: false, error: 'Envío vacío rechazado: la hoja ya tiene datos' });
    }
    if (antes) {
      const ant = ss.getSheetByName('_respaldo_anterior') || ss.insertSheet('_respaldo_anterior');
      ant.clear(); ant.getRange(1, 1).setValue(antes.slice(0, PEDAZO)); ant.hideSheet();
    }
    (b.tables || []).forEach(t => escribir(ss, t));
    const raw = b.raw || '';
    const sh = ss.getSheetByName('_respaldo') || ss.insertSheet('_respaldo');
    sh.clear();
    const partes = [];
    for (let i = 0; i < raw.length; i += PEDAZO) partes.push([raw.slice(i, i + PEDAZO)]);
    if (partes.length) sh.getRange(1, 1, partes.length, 1).setValues(partes);
    sh.hideSheet();
    return salida({ ok: true });
  } catch (err) {
    return salida({ ok: false, error: String(err) });
  }
}

/* La app lo usa para «Traer de la hoja» y para probar la conexión. */
function doGet(e) {
  if (((e && e.parameter) || {}).token !== CLAVE) return salida({ ok: false, error: 'Clave incorrecta' });
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('_respaldo');
  const raw = sh && sh.getLastRow() ? sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => r[0]).join('') : '';
  return salida({ ok: true, data: raw ? JSON.parse(raw) : null });
}
