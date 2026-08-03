# MAPS GIS — Notas para Agentes

## Resumen del proyecto

MAPS GIS es una **Progressive Web App (PWA) offline-first** en español para visualizar mapas GIS (GeoTIFF y PDF georreferenciados), recolectar marcadores de campo y registrar recorridos GPS. Está construida con **HTML, CSS y JavaScript puro**, sin build step, bundler ni gestor de paquetes. No existe `package.json`, `pyproject.toml`, `Cargo.toml` ni ningún archivo de configuración de build; el proyecto se sirve directamente como archivos estáticos.

La aplicación está orientada a dos perfiles de marcador:

- **QC (Control de Calidad):** marcadores simples con nombre, descripción, color, fotos y altura GPS.
- **LSM (Laboratorio de Suelos y Materiales):** marcadores con 6 campos de laboratorio (semana laboratorio, tipo de material, nombre de muestra, localización, fuente, ensayos) más color y fotos.

Además, la app incluye **recorridos GPS** (tracks), **herramientas de medición** de distancia y área, y un **panel de administración remoto** que lee los datos sincronizados en Supabase.

## Arquitectura y organización del código

```
C:\Users\LojanoE\Documents\GitHub\MAPS_GIS
├── index.html              # UI única, carga todos los scripts y CSS (~1075 líneas)
├── sw.js                   # Service Worker con cache-first y versionado (~244 líneas)
├── manifest.json           # Manifest PWA
├── config.json             # Listas por defecto para selects LSM
├── css/styles.css          # Estilos mobile-first, tema oscuro por defecto (~2502 líneas)
├── js/
│   ├── storage.js          # IndexedDB (mapas, fotos, recorridos)
│   ├── pdf-processor.js    # Procesamiento y georreferenciación de PDFs
│   ├── app.js              # Lógica principal de la app, UI, mapa, marcadores (~3344 líneas)
│   ├── sync-manager.js     # Sincronización unidireccional a Supabase
│   └── admin-manager.js    # Panel de administración remoto (Supabase)
├── assets/
│   └── logo_lab_chino_PNG.png   # Logo usado en el estampado de fotos LSM
├── js/app.js.backup.v161   # Backup antiguo, no usado en producción
└── LICENSE                 # Apache License 2.0
```

### Módulos principales

- **`index.html`**: contiene toda la estructura de pantallas (`home-screen`, `map-screen`), modales y la carga de scripts. **El orden de carga de scripts es crítico** y no debe cambiarse.
- **`sw.js`**: implementa estrategia cache-first para assets locales y CDN, stale-while-revalidate para tiles de mapa, y network-only para Supabase. Limpia caches antiguos al activarse. El versionado se controla centralmente mediante `APP_VERSION`.
- **`js/storage.js`**: abstracción sobre IndexedDB (`MapsGISDB` v4) con stores `maps`, `photos` y `tracks`. Soporta guardar/recuperar mapas TIFF/PDF, fotos originales/procesadas y recorridos GPS.
- **`js/pdf-processor.js`**: extrae metadatos geoespaciales de GeoPDFs (ISO 32000-2, OGC GeoPDF, viewport bounds, anotaciones PDF.js) y crea overlays georreferenciados sobre Leaflet. Soporta páginas con `/Rotate` 90/180/270 mediante `applyPageRotation()` (permuta esquinas del espacio sin rotar al de display y decide la rotación de render con verificación "norte-arriba"), y planos con contenido rotado geográficamente (marco a 45°, etc.) mediante `rectifyCanvasToNorthUp()` (warp afín del canvas a norte-arriba usando las esquinas GPTS).
- **`js/app.js`**: módulo monolítico principal. Inicializa el mapa (Leaflet), gestiona marcadores QC/LSM, fotos, estampado LSM, exportación ZIP/Excel, configuración local, calibración de mapas, recorridos GPS, medición de distancia/área y coordinación de UI.
- **`js/sync-manager.js`**: sincroniza marcadores pendientes (`pendingUpload: true`) hacia Supabase vía REST. Es unidireccional: dispositivo → Supabase.
- **`js/admin-manager.js`**: panel de administración que lee los datos sincronizados en Supabase, con filtros, tabla, mapa, edición, soft-delete y exportación Excel.

### Orden de carga de scripts (NO CAMBIAR)

`index.html` carga los scripts en este orden:

1. Leaflet JS
2. Proj4js
3. GeoTIFF.js
4. GeoRaster
5. GeoRaster Layer for Leaflet
6. PDF.js
7. SheetJS (xlsx)
8. JSZip
9. FileSaver
10. Piexif
11. `js/storage.js`
12. `js/pdf-processor.js`
13. `js/app.js`
14. `js/sync-manager.js`
15. `js/admin-manager.js`

## Stack tecnológico

Todas las dependencias se cargan por CDN en `index.html` y deben coincidir exactamente con `CDN_ASSETS` en `sw.js`:

| Librería | Versión | Uso |
|----------|---------|-----|
| Leaflet | 1.9.4 | Mapa interactivo base |
| Proj4js | 2.9.2 | Transformación de coordenadas |
| GeoTIFF.js | 2.1.3 | Lectura de archivos GeoTIFF |
| GeoRaster | 1.6.0 | Procesamiento de rasters geográficos |
| GeoRaster Layer for Leaflet | 3.10.0 | Renderizado de GeoTIFF en Leaflet |
| PDF.js | 3.11.174 | Renderizado y parseo de PDFs |
| SheetJS (xlsx) | 0.20.1 | Exportación a Excel |
| JSZip | 3.10.1 | Generación de ZIPs de exportación |
| FileSaver.js | 2.0.5 | Descarga de archivos |
| Piexif.js | 1.0.6 | Lectura/escritura de metadatos EXIF/GPS en fotos |
| Inter (Google Fonts) | css2 (300–800) | Tipografía de la UI (cacheada por el SW) |

Almacenamiento:

- **IndexedDB** (`MapsGISDB` v4): mapas (`maps`), fotos (`photos`) y recorridos (`tracks`).
- **LocalStorage**: marcadores QC/LSM, configuración LSM, offsets de calibración por mapa, nombre/id del dispositivo, usuario LSM, modo de marcador y preferencias de tema.
- **Supabase**: backend para sincronización y panel admin (conexión directa vía REST, credenciales hardcodeadas).

## Comandos de build y ejecución

No hay comando de build. Solo se requiere servir los archivos estáticamente:

```bash
# Opción 1: Python
python -m http.server 8000

# Opción 2: npx serve
npx serve .

# Opción 3: cualquier servidor estático
```

Luego abrir `http://localhost:8000` en un navegador. Para probar funcionalidades de PWA (service worker, cámara, geolocalización, IndexedDB) se recomienda usar **localhost con HTTPS o un dispositivo real**; algunas APIs no funcionan en `file://`.

### Notas sobre el build

- No existe `package.json`, `pyproject.toml`, `Cargo.toml` ni archivo de configuración de build.
- No hay scripts de npm, yarn, pnpm, pip, cargo ni make.
- Las dependencias se cargan directamente desde CDN y se cachean mediante el Service Worker.

## Instrucciones de testing

**No hay tests automatizados** (ni unitarios ni de integración). Las validaciones se hacen manualmente en el navegador. Flujos recomendados para probar:

1. Cargar un GeoTIFF y un PDF georreferenciado.
2. Verificar que el mapa se posicione correctamente y se muestre el overlay.
3. Aplicar y persistir offsets de calibración (este/norte) por mapa.
4. Crear/editar marcadores QC y LSM.
5. Tomar fotos (QC y LSM) y verificar el modal de vista previa.
6. Verificar el estampado LSM en las fotos (logo, fecha, localización, nombre de muestra).
7. Comprobar que las fotos exportadas incluyen metadata EXIF GPS en WGS84.
8. Grabar un recorrido GPS y verificar que se guarda en IndexedDB.
9. Usar las herramientas de medición de distancia y área.
10. Exportar ZIP con Excel + fotos + recorridos GeoJSON.
11. Sincronizar con Supabase (requiere conexión y credenciales válidas).
12. Probar el panel Admin con la contraseña correspondiente.
13. **Capas diarias:** crear marcadores en días distintos, abrir el panel de Marcadores y verificar que se agrupen por fecha. Desactivar una capa con el switch: los marcadores de esa fecha deben desaparecer del mapa pero seguir en la lista y en la exportación ZIP/Excel. Recargar la página: la capa debe seguir desactivada.
14. **Nombre por defecto automático:** crear un marcador QC nuevo y verificar que el nombre se pre-rellene como `QC-01`, `QC-02`… reiniciando cada día. Lo mismo para LSM (`LSM-01`, `LSM-02`…). Verificar que el campo siga siendo editable.
15. Verificar que la app funcione offline tras la primera carga.

## Notas de versión

### v2.9.3 — Zoom máximo 22 y overlay PDF más nítido

- **Zoom máximo 19 → 22:** capas CartoDB con `maxZoom: 22` + `maxNativeZoom: 19` (los tiles z19 se re-escalan en 20–22) y `maxZoom: 22` en el mapa.
- **Render del PDF a escala 4** (antes 2) en `processPDF()`, `loadPDFMap()` y `reloadMapWithOffset()`: el overlay pasa de ~1.1 m/px a ~0.55 m/px — legible hasta ~zoom 20 (demarcación vial, vehículos); en 21–22 se ve suave, inherente a overlays raster.
- El tope del canvas rectificado (`rectifyCanvasToNorthUp`) se mantiene en 4096 px/lado por memoria.
- **Bumps de versión:** `2.9.2` → `2.9.3`.

### v2.9.2 — Fix: GeoPDFs con contenido rotado geográficamente (planos a 45°)

- Planos cuyo marco está rotado respecto al norte (ej. alineado al eje de un depósito, sin `/Rotate` en el PDF) se proyectaban deformados: `L.imageOverlay` solo soporta bboxes axis-aligned.
- **`js/pdf-processor.js`:**
  - Nueva función `rectifyCanvasToNorthUp(canvas, gM)`: aplica la transformación afín inversa (derivada de 3 esquinas GPTS) al canvas renderizado para dejar la **geografía norte-arriba**. El marco del plano queda como rombo sobre el bbox real y el exterior queda transparente.
  - `createGeoOverlay()` detecta la rotación midiendo el rumbo del eje `tl→tr` en metros locales; si `|ángulo| ≥ 0.5°` rectifica el canvas antes de crear el overlay. Umbrales y límites: resolución destino ≈ fuente, tope 4096 px por lado.
- No requiere cambios de persistencia: la rectificación se calcula al cargar (sirve para mapas ya guardados con esquinas correctas).
- Verificado con `DRQ_ROTADA45.pdf` (rotación ~49°): overlay idéntico en orientación y posición al DRQ sin rotar, tras recarga incluida.
- **Bumps de versión:** `2.9.1` → `2.9.2`.

### v2.9.1 — Fix: GeoPDFs con `/Rotate ≠ 0`

- Los PDFs con rotación de página (`/Rotate` 90/180/270) se cargaban girados/deformados: la extracción de esquinas etiquetaba en el **espacio de usuario sin rotar**, pero PDF.js renderiza con la rotación aplicada.
- **`js/pdf-processor.js`:**
  - Nuevas funciones `applyPageRotation(geoData, rotate)`, `permuteCorners()`, `isNorthUp()` (con margen ≥50% del span por eje, para evitar falsos positivos en mapas casi cuadrados) y `normalizeRotation()`.
  - `renderPage(pdf, scale, rotation)` acepta rotación explícita para `page.getViewport()`.
  - `processPDF()` decide el candidato correcto (permutadas+rotado → originales+sin-rotación → originales+rotado) verificando "norte-arriba" con los propios GPTS, y devuelve `renderRotation`.
- **`js/app.js`:** `georef.renderRotation` se persiste en IndexedDB (`applyGeoref`) y se usa al recargar (`loadPDFMap`, `reloadMapWithOffset`). Registros antiguos sin el campo usan el comportamiento previo.
- **PDFs rotados guardados antes del fix deben re-subirse** (sus esquinas quedaron en espacio sin rotar).
- **Bumps de versión:** `2.9.0` → `2.9.1`.

### v2.9.0 — Rediseño visual estilo FO Maps

Cambio **solo de imagen** (sin tocar funcionalidad), inspirado en FO Maps – FaenaOffline GIS:

- **Nueva paleta oscura (default):** fondos azul-noche (`#0a0f1a`, `#101828`, `#1a2540`) con acento **naranja cálido** (`#f97316`, hover `#fb923c`, active `#ea580c`).
- **Tema claro rediseñado** en coherencia (`#f6f8fb`/`#ffffff`, acento `#ea580c`).
- **Tipografía Inter** (Google Fonts, pesos 300–800) con fallback al stack del sistema; agregada a `CDN_ASSETS` en `sw.js` para funcionar offline tras la primera carga (los `.woff2` de `fonts.gstatic.com` se cachean en runtime por la estrategia cache-first).
- **Formas más amigables:** radios más generosos (`--radius-sm/md/lg` = 10/14/20 px), botones `.btn-primary`/`.btn-secondary` tipo pill (`999px`) con sombra naranja suave, FABs del mapa (`.map-btn`) circulares de 44 px, `.icon-btn` redondos, `.mode-toggle` y `.count-badge` tipo pill, dropzone de carga con tinte naranja al hover.
- **Colores de marcadores** actualizados a tonos armónicos (rojo `#ef4444`, azul `#3b82f6`, verde `#4caf50`, amarillo `#f59e0b`, naranja `#f97316`, morado `#a78bfa`).
- Se limpiaron los rgba teñidos hardcodeados (azul GitHub → naranja) y hex sueltos (`#1a1d23` → variable).
- `manifest.json` e íconos SVG actualizados a la nueva paleta; `theme-color` en `index.html` → `#0a0f1a`.
- **No se modificó ningún ID, clase usada por JS, orden de scripts ni lógica.**
- **Bumps de versión:** `2.8.0` → `2.9.0`.

### v2.8.0 — Formulario LSM simplificado

- Se redujo el formulario LSM a 6 campos esenciales:
  - Semana Laboratorio
  - Tipo de Material
  - Nombre de Muestra
  - Localización
  - Fuente
  - Ensayos
- Se eliminaron del formulario, exportación ZIP/Excel, sincronización a Supabase y panel Admin los campos:
  - Nombre del Proyecto
  - Solicitante
  - Estructura / Depósito
  - Subestructuras
  - Categoría (select de datos; se conserva el selector de color visual del marcador)
  - Proveniencia
- Se actualizó `config.json` y `ConfigManager` para reflejar solo las listas de campos vigentes.
- Los marcadores existentes conservan los datos antiguos en `LocalStorage`, pero al editarlos se reescriben solo con los campos activos.
- **Bumps de versión:** `2.7.0` → `2.8.0`.

### v2.7.0 — Foto cruda en la exportación ZIP

- La exportación ZIP ahora incluye una carpeta `fotos_crudas/` con las fotos originales sin estampar (`originalBlob` de IndexedDB), además de `fotos/` con las estampadas.
- Nombre derivado del de la foto estampada con sufijo `_cruda.jpg` (ej. `QC_Punto1_001_foto1_cruda.jpg`).
- Si el registro no tiene `originalBlob` (fotos antiguas), simplemente se omite sin error.
- El Excel (`marcadores.xlsx`) no cambia: sigue referenciando las fotos estampadas.
- **Bumps de versión:** `2.6.0` → `2.7.0`.

### v2.6.0 — Capas diarias y nombre automático por defecto

Novedades en esta versión:

- **Capas diarias en el panel de marcadores:**
  - Los marcadores se agrupan automáticamente por día de creación (`YYYY-MM-DD`), derivado de `createdAt`.
  - El panel de marcadores muestra un encabezado por día con un switch para activar/desactivar la capa en el mapa.
  - El estado de las capas desactivadas se persiste en `LocalStorage` bajo la clave `maps_gis_hidden_layers`.
  - Desactivar una capa **solo afecta la visualización en el mapa**: el panel de marcadores y la exportación ZIP/Excel siguen incluyendo todos los marcadores.
  - Funciones clave en `js/app.js`: `LayerManager`, `getMarkerDayLayer()`, `refreshMarkersOnMap()`, `renderMarkersList()`.
  - Estilos en `css/styles.css`: `.layer-group`, `.layer-group-header`, `.layer-toggle`, `.layer-disabled`.

- **Nombre por defecto automático:**
  - Al crear un marcador nuevo (QC o LSM), el campo nombre se pre-llena con un correlativo por día y tipo: `QC-01`, `QC-02`… / `LSM-01`, `LSM-02`….
  - El contador reinicia cada día y el nombre sigue siendo editable por el usuario.
  - Función clave en `js/app.js`: `getDefaultMarkerName(type)`.

- **Bumps de versión:** `2.5.3` → `2.6.0` en `sw.js`, `js/app.js` e `index.html` (ver convenciones de versionado más abajo).

## Convenciones de código

- **Idioma:** código y UI en **español**. Los comentarios principales también están en español.
- **Tema:** oscuro por defecto. El modo claro solo aplica por sesión (`#btn-theme`, clase `light-mode` en `body`).
- **Estilo:** no hay linter, formatter ni TypeScript. Se escribe JavaScript ES6+ con funciones declaradas y módulos IIFE.
- **Coordenadas:** primarias en **PSAD56 UTM 17S (EPSG:24877)**; secundarias en **WGS84 (EPSG:4326)**. El panel muestra ambas.
- **Versionado:** la versión actual es `2.9.3` y debe sincronizarse en todos estos lugares al subir cambios funcionales:
  - `sw.js:11` — `APP_VERSION`
  - `app.js:23` — `APP_VERSION`
  - `index.html:46` — texto de `#app-version-badge`
  - `index.html:15,20` — query strings `?v=X.Y.Z` en `<link>` y `<preload>` locales
  - `index.html:1000,1003,1006,1009,1012` — query strings `?v=X.Y.Z` en `<script>` locales
  - `sw.js:21-28` — query strings `?v=X.Y.Z` en `CORE_ASSETS`
  - `app.js:563` — URL del logo con versión

## Almacenamiento local (referencia rápida)

| Datos | Tecnología | Clave |
|-------|-----------|-------|
| Marcadores QC/LSM | LocalStorage | `maps_gis_markers_v3` |
| Capas diarias desactivadas | LocalStorage | `maps_gis_hidden_layers` (array de fechas `YYYY-MM-DD`) |
| Config LSM | LocalStorage | `maps_gis_config_v2` |
| Tamaño logo estampado | LocalStorage | `maps_gis_logo_size` (default 25 px) |
| Tamaño fuente estampado | LocalStorage | `maps_gis_stamp_font_size` (default 30 px) |
| Mapas / fotos / recorridos | IndexedDB | `MapsGISDB` v4 (`maps`, `photos`, `tracks`) |
| Offset por mapa | LocalStorage | `maps_gis_offset_<mapId>` |
| Device name / id | LocalStorage | `maps_gis_device_name` / `maps_gis_device_id` |
| Usuario LSM | LocalStorage | `maps_gis_lsm_user` |
| Último formulario LSM | LocalStorage | `maps_gis_last_lsm_form` |
| Modo marcador | LocalStorage | `maps_gis_marker_mode` (`qc` o `lsm`) |
| Tema | LocalStorage | `maps_gis_theme` (`light` o `dark`) |
| Versión config | LocalStorage | `maps_gis_config_version` |

## Funcionalidades clave a conocer

### Mapas

- Se permiten **máximo 3 mapas** simultáneos en IndexedDB.
- Soporta **GeoTIFF** y **PDF georreferenciado**.
- GeoTIFF proyectados: overlay manual con `L.imageOverlay` tras transformar esquinas con proj4.
- GeoTIFF geográficos (EPSG:4326): `GeoRasterLayer`.
- PDFs: extracción de coordenadas por ISO 32000-2, OGC GeoPDF, viewport bounds o anotaciones PDF.js; se guardan las esquinas en UTM PSAD56.
- **Calibración de mapa:** offset en metros (este/norte) por mapa, editable en pantalla (`maps_gis_offset_<mapId>`).

### Marcadores

- Dos tipos: `qc` y `lsm`, cada uno con su propio formulario y modal.
- **Capas diarias:** los marcadores se agrupan automáticamente por día de creación (capa = `YYYY-MM-DD`, derivada de `createdAt` con `getMarkerDayLayer()`). En el panel de marcadores la lista se agrupa por día con un toggle por grupo para mostrar/ocultar la capa **solo en el mapa** (`LayerManager`, clave `maps_gis_hidden_layers`; el estado se persiste entre sesiones). La lista del panel y la exportación ZIP/Excel siempre incluyen todos los marcadores.
- **Nombre por defecto automático:** al crear un marcador nuevo el nombre viene pre-llenado con un correlativo por día y tipo (`QC-01`, `QC-02`… / `LSM-01`, `LSM-02`…; `getDefaultMarkerName()`), editable por el usuario.
- Máximo **2 fotos** por marcador.
- Autocompletar nombres de marcadores basado en nombres usados previamente (máximo 5 sugerencias, case-insensitive, sin acentos).
- Login LSM con contraseña hardcodeada (`354` en `app.js`).

### Fotos y estampado LSM

- Las fotos LSM se estampan con:
  - Logo `assets/logo_lab_chino_PNG.png` en margen derecho (tamaño configurable).
  - Texto en margen izquierdo, de abajo hacia arriba: fecha `YYYY-MM-DD`, localización, nombre de muestra.
  - Tamaño de fuente configurable y proporcional al ancho de la foto.
  - Fuente del sistema, blanco con contorno negro.
- Toda foto QC/LSM guardada incluye **metadata EXIF GPS en WGS84** lat/lon, compatible con QGIS.
- Se conserva el `originalBlob` en IndexedDB.
- La exportación ZIP incluye **ambas fotos**: la estampada/procesada en `fotos/` y la cruda (sin estampar) en `fotos_crudas/` con sufijo `_cruda.jpg`.

### Recorridos GPS

- Los recorridos se graban con la API de geolocalización del navegador.
- Se almacenan en IndexedDB (`tracks`) con puntos WGS84 y sus equivalentes UTM PSAD56.
- Configuración de filtros: `minDistance` (5 m por defecto) y `minAccuracy` (50 m por defecto).
- Los recorridos se exportan como GeoJSON dentro del ZIP, pero **no se sincronizan a Supabase**.

### Medición

- Herramientas de medición de **distancia** y **área** sobre el mapa.
- Los resultados se muestran en metros (m) y hectáreas (ha).

### Sincronización y administración

- Sincronización **unidireccional dispositivo → Supabase**.
- Tablas en Supabase: `qc_markers` y `lsm_markers`.
- Identificación de registros por combinación `local_marker_id` + `device_id`.
- `POST` para crear, `PATCH` para actualizar.
- Auto-sync solo bajo WiFi/4G y con límite de 10 marcadores por ciclo; el sync manual fuerza todos los pendientes.
- Panel Admin con contraseña hardcodeada (`LSMQC$` en `admin-manager.js`).
- El panel admin lee directamente de Supabase; no afecta datos locales. Soporta edición y soft-delete.

### Exportación

- Exportación local a **ZIP** que contiene:
  - `marcadores.xlsx` con hojas separadas para QC, LSM y Recorridos.
  - Carpeta `fotos/` con las fotos estampadas (máximo 2 por marcador).
  - Carpeta `fotos_crudas/` con las fotos originales sin estampar (sufijo `_cruda.jpg`; solo si existe `originalBlob`).
  - Carpeta `recorridos/` con archivos GeoJSON.
- El panel Admin puede exportar Excel de los registros seleccionados.

## Consideraciones de seguridad

> **Importante:** este proyecto tiene decisiones de seguridad deliberadas pero sensibles. Conócelas antes de tocar cualquier cosa relacionada.

- **Credenciales hardcodeadas:** las contraseñas de Admin (`LSMQC$`) y LSM (`354`) están directamente en el código fuente (`admin-manager.js` y `app.js`).
- **Claves de Supabase expuestas:** tanto la URL como la `anon key` de Supabase están en texto plano en `sync-manager.js` y `admin-manager.js`.
- **RLS desactivado:** el backend se asume con Row Level Security desactivado; cualquier cliente con la key puede leer/escribir.
- **No hay autenticación real:** el "login" LSM y Admin se basan únicamente en contraseñas locales.
- **Service Worker cachea todo:** los assets locales, CDN y tiles se almacenan en el cliente. No se deben colocar secretos en archivos estáticos.
- **Datos sensibles en LocalStorage/IndexedDB:** los marcadores, fotos, recorridos y configuración viven en el navegador del usuario.

## Proceso de despliegue

1. Realizar los cambios funcionales.
2. **Actualizar la versión** en todos los lugares indicados en la sección de convenciones.
3. Verificar que `sw.js` tenga las mismas URLs de CDN que `index.html`.
4. Servir o desplegar la carpeta raíz como contenido estático (GitHub Pages, Netlify, Vercel, servidor propio, etc.).
5. Los dispositivos recibirán la nueva versión gracias al Service Worker; el botón "Actualizar aplicación" (↻) fuerza `reg.update()`, limpia caches `maps-gis-*` y recarga la página sin borrar `localStorage` ni `IndexedDB`.

## Mantenimiento común

### Agregar un campo LSM

Si se agrega un campo al formulario LSM, actualizar:

1. `MarkerManager.createLSM()` en `app.js`.
2. Modal `#lsm-marker-modal` en `index.html`.
3. `saveLSMMarker()` en `app.js`.
4. `stampImage()` en `app.js` si el campo debe aparecer en la foto.
5. `renderStampPreview()` si debe mostrarse en la previsualización.
6. Esquema de Supabase (`supabase_schema_v2.sql`).
7. `uploadLSM` en `sync-manager.js`.
8. Exportación ZIP en `app.js`.
9. Tabla / detalle / edición en `admin-manager.js`.
10. `autoLearnLSMConfig()` en `app.js` si aplica.

### Cambiar lógica de capas diarias o nombres por defecto

Si se modifica la agrupación por días, la visibilidad de capas o el nombre automático, actualizar:

1. `LayerManager` y `getMarkerDayLayer()` en `js/app.js` para derivar la capa.
2. `refreshMarkersOnMap()` en `js/app.js` para aplicar el filtro de visibilidad.
3. `renderMarkersList()` en `js/app.js` para renderizar los encabezados y switches de capa.
4. `getDefaultMarkerName(type)` en `js/app.js` para el correlativo por día y tipo.
5. Los puntos de entrada del modal en `openMarkerModal()` (QC) y apertura del modal LSM en `js/app.js`.
6. Estilos correspondientes en `css/styles.css`.
7. `AGENTS.md` (sección "Funcionalidades clave → Marcadores" y "Notas de versión").

### Gotchas técnicos

- **PDF.js consume el ArrayBuffer:** no reutilizar el mismo entre llamadas a `pdfjsLib.getDocument()`. Usar copia fresca (`freshUint8()` en `pdf-processor.js`).
- **Detectar CRS solo dentro del diccionario geoespacial** (`VP`/`Measure`/`LGIDict`); escanear todo el texto del PDF produce falsos positivos.
- GeoTIFF proyectados: overlay manual con `L.imageOverlay` tras transformar esquinas con proj4. GeoTIFF geográficos: `GeoRasterLayer`.
- **IDs de marcador por timestamp:** actualmente `id = 'm_' + Date.now()`. Dos marcadores creados en el mismo milisegundo colisionarían. En uso manual no es un problema; si se automatiza la creación masiva, considerar agregar un sufijo aleatorio (p. ej. `+ '_' + Math.random().toString(36).slice(2,6)`).
- **Planos con marco rotado (45°, etc.):** `L.imageOverlay` no soporta rotación; `createGeoOverlay()` rectifica el canvas con `rectifyCanvasToNorthUp()` (afín inversa desde las esquinas). En el mapa, el plano rectificado se ve como rombo con esquinas transparentes: es lo esperado, la geografía interna queda norte-arriba.
- **PDFs con `/Rotate ≠ 0`:** la extracción GPTS/LPTS trabaja en el espacio de usuario **sin rotar**; PDF.js renderiza con `page.rotate` aplicado. `applyPageRotation()` en `pdf-processor.js` reconcilia ambos (permutación de esquinas + `renderRotation` persistido en `georef`). PDFs rotados guardados antes de v2.9.1 deben re-subirse.
- **Service Worker nunca cachea Supabase:** `supabase.co` está en `NETWORK_ONLY_DOMAINS`.

## Licencia

Este proyecto se distribuye bajo la **Apache License, Version 2.0**. Ver el archivo `LICENSE` en la raíz del repositorio.

## Directorios y archivos a ignorar

- `IGNORAR/` — excluido por `.gitignore`; no incluir assets de producción aquí.
- `js/app.js.backup.v161` — backup antiguo, no se usa en producción.
- `.playwright-mcp/` — logs temporales de automatización.
- Capturas temporales (`*.png` fuera de `assets/`).
