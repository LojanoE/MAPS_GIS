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
Al subir versión, sincronizar **3 lugares**:
- `sw.js:11` — `APP_VERSION`
- `app.js:23` — `APP_VERSION`
- `index.html:40` — texto de `#app-version-badge`

`CACHE_NAME` y los caches en `sw.js` se derivan de `APP_VERSION`; no editar a mano.

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
  - Logo `assets/logo_lab_chino_PNG.png` en margen derecho (25 px alto, 10 px del borde).
  - Texto en margen izquierdo (10 px del borde), de abajo hacia arriba: fecha `YYYY-MM-DD`, subestructura, nombre del marcador.
  - Fuente del sistema, blanco con contorno negro (`shadow`).
- Se conserva el `originalBlob` en IndexedDB.
- La foto estampada re-inyecta la metadata EXIF/GPS original vía **piexif.js**.
- La exportación ZIP usa la foto estampada.

## Almacenamiento local
| Datos | Tecnología | Clave |
|-------|-----------|-------|
| Marcadores | LocalStorage | `maps_gis_markers_v3` |
| Config LSM | LocalStorage | `maps_gis_config_v2` |
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
5. `supabase_schema_v2.sql`
6. `uploadLSM` en `sync-manager.js`
7. Exportación ZIP en `app.js`
8. Tabla / detalle / edición en `admin-manager.js`
9. `autoLearnLSMConfig()` en `app.js` si aplica

## Ignorar
- `IGNORAR/` (excluido por `.gitignore`; **no** incluir assets de producción aquí)
- `js/app.js.backup.v161`
