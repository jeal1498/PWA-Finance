# CLAUDE.md — Finanzas (PWA-Finance)

PWA de uso propio para llevar **pagos con abonos y metas de ahorro**. Antes vivía en `finanzas/` del repo `jeal1498/JEAL` (SecondBrain); se movió aquí el 24-oct-2026.

## Usuario
- Habla español (México). Respuestas **cortas y concisas**. Moneda MXN.
- Maqueta en artifact antes de cualquier cambio visual grande; el usuario aprueba y luego se implementa.

## Reglas
- **Sin build ni dependencias**: HTML + CSS + JS (ES modules) puros. Se sirve tal cual en GitHub Pages desde `main`: https://jeal1498.github.io/PWA-Finance/
- **Sube `CACHE` en `sw.js` en cada cambio** (`finanzas-vN`) o el teléfono no se actualiza; `ASSETS` debe listar todos los archivos.
- **El repo es público: no van pagos, nombres reales ni datos personales en el código** (la app arranca vacía). Los datos se entregan por chat como archivo para ⋯ Importar.
- Probar: `python3 -m http.server 8765` en la raíz y Playwright (Chromium en `/opt/pw-browsers/chromium`) a 358–390 px. Para sembrar datos: `import('./js/db.js')` y `db.batch({movimientos:{clear:true,put:[...]}})`, luego `reload()`.

## Datos compartidos con SecondBrain
- Vive en el **mismo origen** (`jeal1498.github.io`) que SecondBrain (`/JEAL/`), así que usa la **misma IndexedDB `secondbrain`** (`js/db.js`, `VERSION` 7): stores `movimientos` y `metas`, más `settings` (`finance`, `backup`). No se perdieron datos al mover la app.
- `js/db.js`, `js/backup.js`, `js/migrar-finanzas.js` y `js/finance.js` son **copias** de las de `jeal1498/JEAL`. Si cambia el esquema de la DB (subir `VERSION`), hay que cambiarlo **en los dos repos a la vez** o una app dejará de abrir la base.
- Respaldo en Google Sheets: Perfil → «Sincronizar» (`sync.js`) usa la hoja y el script que se conectan en SecondBrain → Respaldo (enlace desde la app).

## Modelo
`movimientos` {id, fecha 'YYYY-MM-DD', cat 'emoji Nombre', conc, imp, abo, pagos [{fecha|null, monto}]} y `metas` (misma forma). `abo` = suma de `pagos`. 7 categorías en el formulario (Finanzas, Vehículo, Yo, Karen, Julieta, Servicios, Familia); las viejas se muestran pero ya no se eligen.

## Archivos
- `index.html`, `styles.css`, `app.js` (módulo principal), `datos.js` (importar/exportar JSON y CSV, puro sin DOM), `sync.js` (Sheets), `sw.js`, `manifest.webmanifest`, `favicon.svg`, `fonts/` (Bricolage + IBM Plex).

## Pantallas
- **Barra inferior**: Pagos | + | Metas | Perfil. Arriba solo el mes (swipe de mes **solo sobre la fila del mes**; toque abre el selector).
- **Pagos**: tarjetas de resumen (atención inmediata, meta diaria = pendiente hasta fin de mes ÷ días que quedan, mosaicos Pagado / Por vencer / Atrasado que filtran, «Resumen operativo» = todos ordenados por fecha de la más reciente a la más lejana) y **tabla** `.pt-*` del mismo ancho que las tarjetas: Fecha (día grande + mes), Estatus (ícono: palomita/reloj/triángulo; abono parcial = **anillo** de avance), Categoría (ícono; Yo/Karen/Julieta con inicial), Concepto (días atrasados/por vencer debajo; los pagados sin texto) y Monto. Todas las columnas **ordenables** (un toque asc., otro desc.; `state.sort`). Vencidos teñidos, leyenda de categorías al final.
- **Metas**: por plazo (vencidas, próximas, largo plazo, alcanzadas).
- **Perfil**: tema claro/oscuro, sincronizar con Google Sheets, importar datos, exportar JSON/CSV.
- Hojas: detalle, «Abonar o pagar», nuevo/editar; Eliminar → toast «Deshacer». Enlaces profundos: `#gasto-<id>` / `#meta-<id>`.
- **Importar** (`datos.js`): JSON `{app:'secondbrain', movimientos, metas}` o CSV (Tipo, Fecha, Concepto, Categoría, Importe, Abonado, Id; acepta `,` `;` tab, fechas `AAAA-MM-DD` o `DD/MM/AAAA`; renglones «Ingreso» se omiten). Modo **Agregar** (por id; sin id, hash de tipo+fecha+concepto+importe+categoría) o **Reemplazar todo**, en una transacción con toast Deshacer.

## Ideas pendientes
- Ícono propio para la categoría «Casa» (hoy sale la etiqueta genérica).
