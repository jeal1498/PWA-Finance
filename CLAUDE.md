# CLAUDE.md — Finanzas (PWA-Finance)

PWA de uso propio para llevar **pagos con abonos y metas de ahorro**. Antes vivía en `finanzas/` del repo `jeal1498/JEAL` (SecondBrain); se movió aquí el 24-oct-2026.

## Usuario
- Habla español (México). Respuestas **cortas y concisas**. Moneda MXN.
- Maqueta en artifact antes de cualquier cambio visual grande; el usuario aprueba y luego se implementa.

## Reglas
- **Identidad familia Checa** (igual que Garaje y Clientela): solo oscuro, asfalto `#0C0C10` / tablero `#16161C` / hueso `#F4F4EF`; títulos y cifras grandes en Bricolage 800, texto DM Sans, cifras de tabla JetBrains Mono. El color solo significa estado (verde pagado `#22C55E`, amarillo por vencer `#FACC15`, rojo atrasado `#EF4444`). Rojo, amarillo y verde solo van en íconos y textos de estatus; **cada fila de la tabla se pinta con el tono de su categoría** (`[data-cat]` en `styles.css`, tonos vivos: Finanzas `#60A5FA`, Vehículo `#22D3EE`, Yo `#A78BFA`, Karen `#F472B6`, Julieta `#E879F9`, Servicios `#94A3B8`, Familia `#2DD4BF`, tinte 20–22 %); las categorías viejas (p. ej. Casa) quedan sin tinte; los atrasados llevan borde rojo (sin tinte rojo) y el mes de su fecha va en gris. «Atención inmediata» es tarjeta amarilla llena. Ya no hay modo claro ni interruptor de tema.
- **Densidad compacta** en toda la app (bloque final de `styles.css`): campos de 38 px con fondo y borde hueso tenue, botones de 44 px, interruptor de 44×26, hojas con 16 px de margen. No volver a alturas de 50–52 px. Pantallas principales (Pagos y Próximos) compactas y con las mismas medidas: mosaicos y tarjetas de 78 px, fila de tabla ~44 px, barra inferior de 56 px.
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
`movimientos` {id, fecha 'YYYY-MM-DD', cat 'emoji Nombre', conc, imp, abo, pagos [{fecha|null, monto}]} y `metas` (misma forma). `abo` = suma de `pagos`. Los pagos pueden traer `repite: true`, `serie` (id del primero) y `freq` (`semanal` 7 días, `quincenal` 15 días, `mensual` —por defecto, sin campo—, `bimestral`, `anual`): `generarRepetidos()` (al abrir) crea solas las copias pendientes (id `<serie>-AAAAMM` si es por meses, mismo día del primero; `<serie>-AAAAMMDD` si es por días, solo desde hoy) hasta el fin del mes siguiente; al guardar un pago que se repite también rellena los meses que falten. Se marca con el ícono ↻ junto al concepto (o hasta `fin` 'YYYY-MM-DD', opcional, campo «Termina» del formulario; vale para toda la serie); eliminar el último de la serie la detiene. 7 categorías en el formulario (Finanzas, Vehículo, Yo, Karen, Julieta, Servicios, Familia); las viejas se muestran pero ya no se eligen.

## Archivos
- `index.html`, `styles.css`, `app.js` (módulo principal), `datos.js` (importar/exportar JSON y CSV, puro sin DOM), `sync.js` (Sheets), `sw.js`, `manifest.webmanifest`, `favicon.svg`, `fonts/` (Bricolage, DM Sans, JetBrains Mono).

## Pantallas
- **Barra inferior**: Apartar | Pagos | Próximos | Perfil, y el «+» es una burbuja flotante (abajo a la derecha). Recuerda la última pantalla al recargar (`finanzas_vista`). Desde 768 px (tablet) Pagos, Próximos y Apartar van en dos columnas: resumen a la izquierda, tabla a la derecha. Arriba solo el mes (swipe de mes **solo sobre la fila del mes**; toque abre el selector).
- **Pagos**: tarjetas de resumen (atención inmediata, meta diaria = lo que hay que separar hoy para llegar a cada fecha (`apartarDia()`, igual que «Por día» de Apartar) (al tocarla genera un fondo de pantalla 9:16 con `shareFondo()`), «Falta 30 días» = pendiente de esa misma lista, mosaicos Pagado / Por vencer / Atrasado que filtran, «Todo el mes» = todos ordenados por fecha, del inicio al fin del mes (es también el orden al abrir la app)) y **tabla** `.pt-*` del mismo ancho que las tarjetas: Fecha (día grande + mes), Estatus (ícono: palomita/reloj/triángulo; abono parcial = **anillo** de avance), Categoría (ícono; Yo/Karen/Julieta con inicial), Concepto (días atrasados/por vencer debajo; los pagados sin texto) y Monto. Todas las columnas **ordenables** (un toque asc., otro desc.; `state.sort`). Vencidos teñidos, leyenda de categorías al final. **En el mes actual también salen los atrasados de meses anteriores y todo lo que vence en los próximos 30 días desde hoy, aunque sea del mes siguiente** (`monthItems()`); los atrasados de una misma serie se juntan en un renglón «2 meses · 58 días» con «$1,500 de $750» (`juntarSeries()`; abre el más antiguo).
- **Próximos** (antes «Metas»; los datos siguen en el store `metas`; también pueden repetirse cada mes con fecha de fin, igual que los pagos): misma tabla `.pt-*` que Pagos (Fecha, Estatus con anillo de avance, Categoría, Próximo con «Faltan…/Atrasada…», Monto), ordenable (`state.sortMetas`); atrasadas teñidas. **Cada próximo con monto también sale en los Pagos de su mes** (`monthItems()`, etiqueta «Próximo», cuenta en los totales; abre su detalle de próximo).
- **Apartar** (`renderApartar()`, misma distribución que Pagos): cuánto separar por día/semana/quincena/mes para llegar a la fecha de cada pendiente (pagos y próximos con monto, solo los próximos 30 días) = monto ÷ periodos completos que faltan; atrasados y de hoy van en la tarjeta amarilla «Pagar ya».
- **Perfil**: compartir mes (imágenes PNG de 800 px de alto × escala 2, cortadas entre renglones para que WhatsApp no las pixele; `monthImages()`) y sincronizar con Google Sheets.
- Hojas: detalle (estatus en la línea de categoría y fecha; Pendiente/Abonado/Total centrados en una caja, sin barra de progreso), «Abonar o pagar» (chips Todos/Atrasados/Por vencer + lupa que abre el buscador; filas con franja de color y solo nombre, estatus y monto), nuevo/editar (formulario compacto: campos hueso con etiqueta a la izquierda, categorías en cuadrícula de 4 sin scroll, tarjeta «Se repite cada mes» + «Termina», botones Cancelar · Eliminar · Guardar); Eliminar → toast «Deshacer». Enlaces profundos: `#gasto-<id>` / `#meta-<id>`.
- **Importar** (`datos.js`): JSON `{app:'secondbrain', movimientos, metas}` o CSV (Tipo, Fecha, Concepto, Categoría, Importe, Abonado, Id; acepta `,` `;` tab, fechas `AAAA-MM-DD` o `DD/MM/AAAA`; renglones «Ingreso» se omiten). Modo **Agregar** (por id; sin id, hash de tipo+fecha+concepto+importe+categoría) o **Reemplazar todo**, en una transacción con toast Deshacer.

## Ideas pendientes
- Ícono propio para la categoría «Casa» (hoy sale la etiqueta genérica).
