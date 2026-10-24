// Almacenamiento local (IndexedDB). Todo vive en el dispositivo.
const DB_NAME = 'secondbrain';
const VERSION = 7;
// income, bills, goals y budgets son las finanzas anteriores a la v2.7: ya no tienen pantalla,
// pero se conservan (y se respaldan) y de ahí sale la migración a movimientos y metas.
export const STORES = ['fuel', 'maintenance', 'expenses', 'reminders', 'income', 'bills', 'goals', 'budgets', 'spending', 'notes', 'tasks', 'habits', 'journal', 'projects', 'movimientos', 'metas'];

let dbp;
function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => {
        const db = req.result;
        // Si otra pestaña pide subir la versión, esta suelta la conexión para no bloquearla.
        db.onversionchange = () => { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const all = (store) => tx(store, 'readonly', (t) => t.objectStore(store).getAll());
export const put = (store, obj) => tx(store, 'readwrite', (t) => t.objectStore(store).put(obj));
export const putMany = (store, items) => tx(store, 'readwrite', (t) => { const os = t.objectStore(store); for (const x of items) os.put(x); });
// Varias escrituras en una sola transacción (o se hacen todas o ninguna):
// batch({ store: { clear?: true, remove?: [ids], put?: [registros] } })
export const batch = (ops) => tx(Object.keys(ops), 'readwrite', (t) => {
  for (const [s, { clear, remove = [], put = [] }] of Object.entries(ops)) {
    const os = t.objectStore(s);
    if (clear) os.clear();
    for (const id of remove) os.delete(id);
    for (const x of put) os.put(x);
  }
});
export const remove = (store, id) => tx(store, 'readwrite', (t) => t.objectStore(store).delete(id));
export const getSetting = (key) => tx('settings', 'readonly', (t) => t.objectStore('settings').get(key));
export const setSetting = (key, val) => tx('settings', 'readwrite', (t) => t.objectStore('settings').put(val, key));

export async function exportAll() {
  const data = { app: 'secondbrain', version: VERSION, exportedAt: new Date().toISOString() };
  for (const s of STORES) data[s] = await all(s);
  data.vehicle = (await getSetting('vehicle')) || {};
  data.finance = (await getSetting('finance')) || {};
  return data;
}

export async function importAll(data) {
  if (!data || data.app !== 'secondbrain') throw new Error('Archivo no válido');
  // Solo se reemplaza lo que viene en el archivo: un archivo parcial (p. ej. solo finanzas)
  // no borra las cargas ni los datos del vehículo.
  await tx([...STORES, 'settings'], 'readwrite', (t) => {
    for (const s of STORES) {
      if (!Array.isArray(data[s])) continue;
      const os = t.objectStore(s);
      os.clear();
      for (const item of data[s]) os.put(item);
    }
    if (data.vehicle) t.objectStore('settings').put(data.vehicle, 'vehicle');
    if (data.finance) t.objectStore('settings').put(data.finance, 'finance');
  });
}

// Agrega los registros de un archivo sin borrar nada (salvo los ids que indique `delete`,
// o todo lo de los stores que indique `replace`, p. ej. para volver a cargar las finanzas).
// `deleteWhere: {store: {campo: valor}}` borra los registros que coinciden (texto sin importar mayúsculas).
export async function mergeData(data) {
  if (!data || data.app !== 'secondbrain') throw new Error('Archivo no válido');
  let n = 0;
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  for (const [s, where] of Object.entries(data.deleteWhere || {})) {
    if (!STORES.includes(s)) continue;
    const ids = (await all(s)).filter((x) => Object.entries(where).every(([k, v]) => norm(x[k]) === norm(v))).map((x) => x.id);
    if (ids.length) await tx(s, 'readwrite', (t) => ids.forEach((id) => t.objectStore(s).delete(id)));
  }
  await tx([...STORES, 'settings'], 'readwrite', (t) => {
    // Datos del vehículo: se combinan con los que ya hay.
    if (data.vehicle && typeof data.vehicle === 'object') {
      const st = t.objectStore('settings');
      const req = st.get('vehicle');
      req.onsuccess = () => st.put({ ...(req.result || {}), ...data.vehicle }, 'vehicle');
      n++;
    }
    for (const s of STORES) {
      if ((data.replace || []).includes(s)) t.objectStore(s).clear();
      for (const id of data.delete?.[s] || []) t.objectStore(s).delete(id);
      for (const item of data[s] || []) { t.objectStore(s).put(item); n++; }
    }
  });
  return n;
}

export async function clearAll() {
  await tx([...STORES, 'settings'], 'readwrite', (t) => {
    for (const s of [...STORES, 'settings']) t.objectStore(s).clear();
  });
}
