# MAPS GIS — Notas para Agentes

## Qué es esto
PWA offline-first en español para visualizar mapas GIS (GeoTIFF/PDF) y recolectar marcadores de campo. HTML/CSS/JS puro, sin build, bundler ni gestor de paquetes.

## Desarrollo
- No hay `package.json`, tests, lint, typecheck ni build.
- Servir estáticamente (`python -m http.server`, `npx serve`, etc.).
- Límite de **3 mapas** simultáneos en IndexedDB.

## Convenciones
- Código y UI en español.
- Tema oscuro por defecto; claro solo por sesión (`#btn-theme`).
- No hay linter ni formateador configurado.

## Carga de scripts (NO CAMBIAR ORDEN)
En `index.html`: Leaflet → Proj4 → GeoTIFF → GeoRaster → GeoRaster Layer → PDF.js → SheetJS → JSZip → FileSaver → **Piexif** → `storage.js` → `pdf-processor.js` → `app.js` → `sync-manager.js` → `admin-manager.js`.

## Versionado
Al subir versión, sincronizar **todos** estos lugares:
- `sw.js:11` — `APP_VERSION`
- `app.js:23` — `APP_VERSION`
- `index.html:41` — texto de `#app-version-badge`
- `index.html` — query strings `?v=X.Y.Z` en `<link>` y `<script>` locales (`css/styles.css`, `js/*.js`, `assets/logo_lab_chino_PNG.png`).
- `sw.js` — query strings `?v=X.Y.Z` en `CORE_ASSETS` y `APP_ASSETS` (si aplica).

`CACHE_NAME` y los caches en `sw.js` se derivan de `APP_VERSION`; no editar a mano.

> **IMPORTANTE:** siempre actualizar la versión en el mismo PR/commit que contiene cambios funcionales. No se debe hacer push a `main` sin subir la versión, para garantizar que los dispositivos reciban el cache actualizado.

## Dependencias CDN
Las URLs en `sw.js` (`CDN_ASSETS`) deben coincidir exactamente con los `<script src>` de `index.html`. Incluir `pdf.worker.min.js` y **piexif** en `sw.js` aunque no estén explícitos en `index.html`.

## Sistemas de coordenadas
- Primario: PSAD56 UTM 17S (`EPSG:24877`) — definición proj4 en `app.js:6-10`.
- Secundario: WGS84 (`EPSG:4326`).
- El panel muestra ambos simultáneamente.

## Marcadores
Dos tipos con formularios distintos:
- `qc` → tabla `qc_markers` (nombre, descripción, color, fotos).
- `lsm` → tabla `lsm_markers` (~15 campos de laboratorio).
- Máximo **2 fotos** por marcador.

## Assets estáticos
Agregar `./assets/logo_lab_chino_PNG.png` a `CORE_ASSETS` en `sw.js` para que se cachee offline.

## Fotos LSM
- Las fotos LSM se estampan con:
  - Logo `assets/logo_lab_chino_PNG.png` en margen derecho; **tamaño configurable** en Configuración (`maps_gis_logo_size`, default 25 px).
  - Texto en margen izquierdo (10 px del borde), de abajo hacia arriba: fecha `YYYY-MM-DD`, **localización**, nombre del marcador.
  - Tamaño de fuente **configurable** (`maps_gis_stamp_font_size`, default 30 px) y proporcional al ancho de la foto.
  - Fuente del sistema, blanco con contorno negro.
- La configuración de estampado se edita en Configuración con slider + número, **preview en tiempo real** y botón **Probar con cámara** para ver el estampado sobre una foto real.
- Al tomar una foto (QC o LSM) se muestra automáticamente un **modal de vista previa** con opciones **Aceptar**, **Eliminar** y **Retomar**. Tocar cualquier thumbnail de la grilla también abre el preview.
- Se conserva el `originalBlob` en IndexedDB.
- La foto estampada re-inyecta la metadata EXIF/GPS original vía **piexif.js**.
- La exportación ZIP usa la foto estampada.
- **Georreferenciación GPS:** las fotos LSM y QC incluyen tags EXIF GPS en WGS84; ver sección dedicada más abajo.

## Almacenamiento local
| Datos | Tecnología | Clave |
|-------|-----------|-------|
| Marcadores | LocalStorage | `maps_gis_markers_v3` |
| Config LSM | LocalStorage | `maps_gis_config_v2` |
| Tamaño logo estampado | LocalStorage | `maps_gis_logo_size` |
| Tamaño fuente estampado | LocalStorage | `maps_gis_stamp_font_size` |
| Mapas / fotos | IndexedDB | `MapsGISDB` v3 (`maps`, `photos`) |
| Offset por mapa | LocalStorage | `maps_gis_offset_<mapId>` |
| Device name / id | LocalStorage | `maps_gis_device_name` / `maps_gis_device_id` |
| Usuario LSM | LocalStorage | `maps_gis_lsm_user` |

## Backend / sync
- Supabase vía REST, sync **unidireccional dispositivo → Supabase**.
- RLS desactivado; URL + anon key en `sync-manager.js` y `admin-manager.js`.
- Contraseñas hardcodeadas:
  - Admin: `LSMQC$` (`admin-manager.js`)
  - LSM: `354` (`app.js`)
- `POST` para crear, `PATCH` para actualizar (identificado por `local_marker_id` + `device_id`).
- Esquema autoritativo: `supabase_schema_v2.sql` (ignorar `supabase_schema.sql`).

## Gotchas técnicos
- **PDF.js consume el ArrayBuffer**: no reutilizar el mismo entre llamadas a `pdfjsLib.getDocument()`. Usar copia fresca (`freshUint8()` en `pdf-processor.js`).
- **Detectar CRS solo dentro del diccionario geoespacial** (`VP`/`Measure`/`LGIDict`); escanear todo el texto del PDF produce falsos positivos.
- GeoTIFF proyectados: overlay manual con `L.imageOverlay` tras transformar esquinas con proj4. GeoTIFF geográficos: `GeoRasterLayer`.

## Mantenimiento LSM
Al agregar un campo LSM, actualizar:
1. `MarkerManager.createLSM()` en `app.js`
2. Modal `#lsm-marker-modal` en `index.html`
3. `saveLSMMarker()` en `app.js`
4. `stampImage()` en `app.js` si el nuevo campo debe aparecer en la foto estampada
5. Preview en `renderStampPreview()` si el nuevo campo debe mostrarse en la previsualización
6. `supabase_schema_v2.sql`
7. `uploadLSM` en `sync-manager.js`
8. Exportación ZIP en `app.js`
9. Tabla / detalle / edición en `admin-manager.js`
10. `autoLearnLSMConfig()` en `app.js` si aplica

## Autocompletar nombres de marcadores
- Al crear/editar marcadores QC y LSM, el campo de nombre muestra sugerencias de nombres usados previamente en marcadores locales del mismo tipo.
- Máximo 5 sugerencias, case-insensitive, ignorando acentos.
- Funciones clave en `js/app.js`: `getMarkerNameSuggestions`, `setupAutocomplete`, `renderAutocompleteList`.
- Los inputs afectados son `#marker-name` (QC) y `#lsm-nombre-muestra` (LSM).

## Georreferenciación EXIF GPS en fotos
- Toda foto QC y LSM guardada incluye metadata EXIF GPS en **WGS84 lat/lon**, compatible con QGIS.
- Tags escritos: `GPSLatitudeRef`, `GPSLatitude`, `GPSLongitudeRef`, `GPSLongitude` (formato DMS racional requerido por piexif).
- Para QC: `compressImageWithGps()` comprime e inyecta GPS usando `pendingMarkerLatLng`.
- Para LSM: `stampImage()` recibe `lat`/`lng` en `markerData` y escribe GPS junto al EXIF original.
- Al guardar marcador (`saveMarker()` / `saveLSMMarker()`), si una foto nueva no tiene GPS se inyecta antes de guardar en IndexedDB.
- Las fotos exportadas en ZIP conservan el GPS y pueden importarse directamente a QGIS.
- Helpers clave en `js/app.js`: `decimalToExifDms()`, `injectGpsExif()`.

## Botón "Actualizar aplicación"
- Icono de flecha circular (↻) en el header, junto a Sincronizar y Admin.
- Fuerza el update del Service Worker (`reg.update()`), limpia caches `maps-gis-*` y recarga la página.
- No borra `localStorage` ni `IndexedDB`; los marcadores y fotos se mantienen.
- Si hay marcadores pendientes de subir, muestra advertencia pero permite actualizar de todos modos.

## Licencia
Este proyecto se distribuye bajo la **Apache License, Version 2.0**. Ver el archivo `LICENSE` en la raíz del repositorio.

## Ignorar
- `IGNORAR/` (excluido por `.gitignore`; **no** incluir assets de producción aquí)
- `js/app.js.backup.v161`
- `.playwright-mcp/` y capturas temporales (`*.png` fuera de `assets/`).
