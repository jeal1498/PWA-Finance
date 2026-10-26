/* Respaldo de Finanzas en esta hoja de Google (Extensiones → Apps Script).
   1) Cambia CLAVE por una palabra larga que solo tú sepas (la misma va en la app).
   2) Implementar → Nueva implementación → Aplicación web:
      Ejecutar como: Yo · Quién tiene acceso: Cualquier persona. Copia la URL que termina en /exec. */
const CLAVE = 'CAMBIA-ESTA-CLAVE';
const PEDAZO = 40000; // una celda admite ~50 000 caracteres
const COPIAS = ['_respaldo_anterior', '_respaldo_anterior2', '_respaldo_anterior3']; // las 3 copias previas, de la más nueva a la más vieja

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

/* El respaldo completo vive en una pestaña oculta, en pedazos de una columna (así no se corta por el límite de la celda). */
function leer(sh) {
  return sh && sh.getLastRow() ? sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => r[0]).join('') : '';
}
function guardar(ss, nombre, texto) {
  const sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  sh.clear();
  const partes = [];
  for (let i = 0; i < texto.length; i += PEDAZO) partes.push([texto.slice(i, i + PEDAZO)]);
  if (partes.length) sh.getRange(1, 1, partes.length, 1).setValues(partes);
  sh.hideSheet();
}
const cuantos = o => ((o && o.movimientos) || []).length + ((o && o.metas) || []).length;

function doPost(e) {
  /* Un solo envío a la vez: dos teléfonos o pestañas no se pisan a medias. */
  const candado = LockService.getScriptLock();
  try {
    candado.waitLock(20000);
    if (CLAVE === 'CAMBIA-ESTA-CLAVE') return salida({ ok: false, error: 'Cambia CLAVE en el script antes de usarlo' });
    const b = JSON.parse(e.postData.contents);
    if (b.token !== CLAVE) return salida({ ok: false, error: 'Clave incorrecta' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const raw = b.raw || '';
    const datos = JSON.parse(raw || '{}');
    if (!Array.isArray(datos.movimientos || []) || !Array.isArray(datos.metas || [])) return salida({ ok: false, error: 'Formato no válido' });
    /* Seguros: un envío vacío no pisa una copia con datos, ni uno con menos de la mitad de registros (salvo que la app lo confirme con `force`). */
    const antes = leer(ss.getSheetByName('_respaldo'));
    let previo = null;
    try { previo = antes ? JSON.parse(antes) : null; } catch (x) { previo = null; }
    const nuevos = cuantos(datos), viejos = cuantos(previo);
    if (!nuevos && viejos) return salida({ ok: false, error: 'Envío vacío rechazado: la hoja ya tiene datos' });
    if (!b.force && viejos >= 10 && nuevos < viejos * 0.5) return salida({ ok: false, error: 'Envío rechazado: trae menos de la mitad de registros que la copia de la hoja (' + nuevos + ' contra ' + viejos + ')' });
    /* Rotación: la copia actual pasa a «anterior», la anterior a «anterior2», y así hasta 3. */
    if (antes) {
      for (let i = COPIAS.length - 1; i >= 1; i--) {
        const t = leer(ss.getSheetByName(COPIAS[i - 1]));
        if (t) guardar(ss, COPIAS[i], t);
      }
      guardar(ss, COPIAS[0], antes);
    }
    (b.tables || []).forEach(t => escribir(ss, t));
    guardar(ss, '_respaldo', raw);
    return salida({ ok: true });
  } catch (err) {
    return salida({ ok: false, error: String(err) });
  } finally {
    try { candado.releaseLock(); } catch (x) { /* no tenía el candado */ }
  }
}

/* La app lo usa para «Traer de la hoja» y para probar la conexión. Con &copia=1, 2 o 3 devuelve una copia anterior (para recuperar a mano). */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (CLAVE === 'CAMBIA-ESTA-CLAVE') return salida({ ok: false, error: 'Cambia CLAVE en el script antes de usarlo' });
  if (p.token !== CLAVE) return salida({ ok: false, error: 'Clave incorrecta' });
  const n = parseInt(p.copia, 10);
  const nombre = n >= 1 && n <= COPIAS.length ? COPIAS[n - 1] : '_respaldo';
  const raw = leer(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre));
  return salida({ ok: true, data: raw ? JSON.parse(raw) : null });
}
