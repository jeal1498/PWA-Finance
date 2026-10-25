# CLAUDE.md — Finanzas (PWA-Finance)

PWA de uso propio para llevar **pagos con abonos y metas de ahorro**. Antes vivía en `finanzas/` del repo `jeal1498/JEAL` (SecondBrain); se movió aquí el 24-oct-2026.

## Usuario
- Habla español (México). Respuestas **cortas y concisas**. Moneda MXN.
- Maqueta en artifact antes de cualquier cambio visual grande; el usuario aprueba y luego se implementa.

## Reglas
- **Identidad familia Checa** (igual que Garaje y Clientela): solo oscuro, asfalto `#0C0C10` / tablero `#16161C` / hueso `#F4F4EF`; títulos y cifras grandes en Bricolage 800, texto DM Sans, cifras de tabla JetBrains Mono. El color solo significa estado (verde pagado `#22C55E`, amarillo por vencer `#FACC15`, rojo atrasado `#EF4444`). «Atención inmediata» es tarjeta amarilla llena. Ya no hay modo claro ni interruptor de tema.
- **Sin build ni dependencias**: HTML + CSS + JS (ES modules) puros. Se sirve tal cual en GitHub Pages desde `main`: https://jeal1498.github.io/PWA-Finance/
- **Sube `CACHE` en `sw.js` en cada cambio** (`finanzas-vN`) o el teléfono no se actualiza; `ASSETS` debe listar todos los archivos.
- **El repo es público: no van pagos, nombres reales ni datos personales en el código** (la app arranca vacía). Los datos se entregan por chat como archivo para ⋯ Importar.
- Probar: `python3 -m http.server 8765` en la raíz y Playwright (Chromium en `/opt/pw-browsers/chromium`) a 358–390 px. Para sembrar datos: `import('./js/db.js')` y `db.batch({movimientos:{clear:true,put:[...]}})`, luego `reload()`.

## Flujo de trabajo
- El usuario autorizó que, **después de cada cambio**, se abra el PR y se haga merge a `main` sin preguntar. Si el PR anterior ya está fusionado, la rama se reinicia desde `main`.

## Datos compartidos con SecondBrain
- Vive en el **mismo origen** (`jeal1498.github.io`) que SecondBrain (`/JEAL/`), así que usa la **misma IndexedDB `secondbrain`** (`js/db.js`, `VERSION` 7): stores `movimientos` y `metas`, más `settings` (`finance`, `backup`). No se perdieron datos al mover la app.
- `js/db.js`, `js/backup.js`, `js/migrar-finanzas.js` y `js/finance.js` son **copias** de las de `jeal1498/JEAL`. Si cambia el esquema de la DB (subir `VERSION`), hay que cambiarlo **en los dos repos a la vez** o una app dejará de abrir la base.
- Respaldo en Google Sheets: Perfil → «Sincronizar» (`sync.js`) usa la hoja y el script que se conectan en SecondBrain → Respaldo (enlace desde la app).

## Modelo
`movimientos` {id, fecha 'YYYY-MM-DD', cat 'emoji Nombre', conc, imp, abo, pagos [{fecha|null, monto}]} y `metas` (misma forma). `abo` = suma de `pagos`. Los pagos pueden traer `repite: true` y `serie` (id del primero): `generarRepetidos()` (al abrir) crea sola la copia pendiente de cada mes (id `<serie>-AAAAMM`, mismo día del primero) hasta el mes siguiente o el mes que se esté viendo; eliminar el último de la serie la detiene. 7 categorías en el formulario (Finanzas, Vehículo, Yo, Karen, Julieta, Servicios, Familia); las viejas se muestran pero ya no se eligen.

## Archivos
- `index.html`, `styles.css`, `app.js` (módulo principal), `datos.js` (importar/exportar JSON y CSV, puro sin DOM), `sync.js` (Sheets), `sw.js`, `manifest.webmanifest`, `favicon.svg`, `fonts/` (Bricolage, DM Sans, JetBrains Mono).

## Pantallas
- **Barra inferior**: Pagos | + | Próximos | Perfil. Arriba solo el mes (swipe de mes **solo sobre la fila del mes**; toque abre el selector).
- **Pagos**: tarjetas de resumen (atención inmediata, meta diaria = pendiente hasta fin de mes ÷ días que quedan, mosaicos Pagado / Por vencer / Atrasado que filtran, «Todo el mes» = todos ordenados por fecha, del inicio al fin del mes (es también el orden al abrir la app)) y **tabla** `.pt-*` del mismo ancho que las tarjetas: Fecha (día grande + mes), Estatus (ícono: palomita/reloj/triángulo; abono parcial = **anillo** de avance), Categoría (ícono; Yo/Karen/Julieta con inicial), Concepto (días atrasados/por vencer debajo; los pagados sin texto) y Monto. Todas las columnas **ordenables** (un toque asc., otro desc.; `state.sort`). Vencidos teñidos, leyenda de categorías al final. **En el mes actual también salen los atrasados de meses anteriores** (`monthItems()`); los atrasados de una misma serie se juntan en un renglón «2 meses · 58 días» con «$1,500 de $750» (`juntarSeries()`; abre el más antiguo).
- **Próximos** (antes «Metas»; los datos siguen en el store `metas`): misma tabla `.pt-*` que Pagos (Fecha, Estatus con anillo de avance, Categoría, Próximo con «Faltan…/Atrasada…», Monto), ordenable (`state.sortMetas`); atrasadas teñidas. **Cada próximo con monto también sale en los Pagos de su mes** (`monthItems()`, etiqueta «Próximo», cuenta en los totales; abre su detalle de próximo).
- **Perfil**: compartir mes (imágenes PNG de 800 px de alto × escala 2, cortadas entre renglones para que WhatsApp no las pixele; `monthImages()`) y sincronizar con Google Sheets.
- Hojas: detalle, «Abonar o pagar», nuevo/editar; Eliminar → toast «Deshacer». Enlaces profundos: `#gasto-<id>` / `#meta-<id>`.
- **Importar** (`datos.js`): JSON `{app:'secondbrain', movimientos, metas}` o CSV (Tipo, Fecha, Concepto, Categoría, Importe, Abonado, Id; acepta `,` `;` tab, fechas `AAAA-MM-DD` o `DD/MM/AAAA`; renglones «Ingreso» se omiten). Modo **Agregar** (por id; sin id, hash de tipo+fecha+concepto+importe+categoría) o **Reemplazar todo**, en una transacción con toast Deshacer.

## Ideas pendientes
- Ícono propio para la categoría «Casa» (hoy sale la etiqueta genérica).
