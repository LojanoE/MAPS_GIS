# MAPS GIS — Notas para Agentes de Código

## Visión General del Proyecto

MAPS GIS es una PWA (Progressive Web App) offline-first para visualización de mapas GIS (GeoTIFF/PDF) y recolección de marcadores de campo. Toda la interfaz y los comentarios del código están en español. **No hay sistema de build, ni bundler, ni gestor de paquetes** — es HTML/CSS/JS puro servido estáticamente.

El proyecto está diseñado para funcionar completamente offline después de la primera carga, sincronizando datos hacia Supabase cuando hay conectividad (sync unidireccional: dispositivo → Supabase).

## Arquitectura y Estructura de Archivos

```
index.html          — Aplicación de página única (SPA). Todas las pantallas son divs
                      que se muestran/ocultan con la clase .hidden
js/
  app.js            — Lógica principal: MarkerManager, DeviceManager, ConfigManager,
                      LSMUserManager, inicialización del mapa Leaflet, manejo de UI,
                      exportación ZIP/Excel, calibración de mapas
  storage.js        — Wrapper de IndexedDB (almacena mapas y fotos)
  pdf-processor.js  — Extracción de GeoPDF (ISO 32000-2, OGC GeoPDF, viewport bounds)
  sync-manager.js   — Sincronización unidireccional dispositivo → Supabase vía REST API
  admin-manager.js  — Panel de administración remoto (lee datos de Supabase, exporta Excel)
sw.js               — Service Worker (cache-first para assets, network-first para tiles)
manifest.json       — Manifiesto PWA
supabase_schema_v2.sql    — Esquema autoritativo de las tablas qc_markers y lsm_markers
supabase_fix_permissions.sql — Script para desactivar RLS y permitir acceso anónimo
css/styles.css      — CSS mobile-first, modo oscuro por defecto, responsive
```

## Stack Tecnológico

| Propósito | Librería | CDN / Origen |
|-----------|----------|--------------|
| Mapas | Leaflet 1.9.4 | unpkg |
| Proyecciones CRS | Proj4js 2.9.2 | unpkg |
| Lectura GeoTIFF | geotiff 2.1.3 | jsDelivr |
| Raster georreferenciado | georaster 1.6.0 + georaster-layer-for-leaflet 3.11.0 | jsDelivr |
| Renderizado PDF | PDF.js 3.11.174 | unpkg |
| Exportación Excel | SheetJS (xlsx) 0.20.1 | cdn.sheetjs.com |
| Compresión ZIP | JSZip 3.10.1 | cdnjs |
| Descargas | FileSaver.js 2.0.5 | cdnjs |
| Backend | Supabase | REST API directo |

Todas las dependencias se cargan vía CDN con `defer`. No hay `package.json` ni `node_modules`.

## Orden de Carga de Scripts (CRÍTICO)

En `index.html` el orden de los `<script>` es estricto y debe mantenerse:

1. Leaflet JS
2. Proj4js
3. GeoTIFF.js
4. GeoRaster
5. GeoRaster Layer for Leaflet
6. PDF.js
7. SheetJS
8. JSZip
9. FileSaver
10. **storage.js**
11. **pdf-processor.js**
12. **app.js**
13. **sync-manager.js**
14. **admin-manager.js**

Cambiar este orden rompe la aplicación.

## Sistemas de Coordenadas

- **CRS primario:** PSAD56 UTM 17S (EPSG:24877)
- **CRS secundario:** WGS84 (EPSG:4326)
- Las definiciones proj4 están en `app.js` líneas 6–10:
  - `EPSG:24877` = PSAD56 UTM 17S
  - `PSAD56GEO` = PSAD56 geográfico (lat/lon con datum International 1924)

El panel de coordenadas en pantalla muestra simultáneamente PSAD56 UTM 17S (Norte/Este) y WGS84 (Lat/Lon).

## Tipos de Marcadores

La aplicación maneja dos tipos de marcadores con formularios completamente diferentes:

| Tipo | Nombre | Descripción | Tabla Supabase |
|------|--------|-------------|----------------|
| `qc` | Quality Control | Marcadores simples: nombre, descripción, categoría de color, fotos | `qc_markers` |
| `lsm` | Laboratorio de Suelos y Materiales | Muestras de laboratorio con ~15 campos específicos (proyecto, solicitante, estructura, tipo de material, ensayos, etc.) | `lsm_markers` |

Cada marcador puede tener hasta **2 fotos** asociadas.

## Almacenamiento Local

| Datos | Tecnología | Clave / Nombre |
|-------|-----------|----------------|
| Marcadores | LocalStorage | `maps_gis_markers_v3` |
| Configuración LSM | LocalStorage | `maps_gis_config_v2` |
| Nombre del dispositivo | LocalStorage | `maps_gis_device_name` |
| ID del dispositivo | LocalStorage | `maps_gis_device_id` |
| Usuario LSM logueado | LocalStorage | `maps_gis_lsm_user` |
| Último formulario LSM | LocalStorage | `maps_gis_last_lsm_form` |
| Preferencia de tema | LocalStorage | `maps_gis_theme` |
| Modo de marcador actual | LocalStorage | `maps_gis_marker_mode` |
| Archivos de mapa (GeoTIFF/PDF) | IndexedDB | `MapsGISDB` v3, store `maps` |
| Fotos comprimidas | IndexedDB | `MapsGISDB` v3, store `photos` |
| Offset de calibración por mapa | LocalStorage | `maps_gis_offset_<mapId>` |

El `MarkerManager` mantiene un `_cache` en memoria para evitar parsear JSON constantemente.

## Convenciones de Desarrollo

### Versionado
La versión de la app está duplicada en **3 lugares** que deben mantenerse sincronizados:
- `sw.js` línea 11: `APP_VERSION`
- `app.js` línea 23: `APP_VERSION`
- `index.html` línea 40: texto del badge `#app-version-badge`

Al subir la versión, actualizar los **3 lugares**. `CACHE_NAME` y los caches estático/dinámico en `sw.js` se derivan de `APP_VERSION` (string interpolation), así que bump solo `APP_VERSION`; **no** edites `CACHE_NAME` a mano. El cambio de versión fuerza la actualización de cache en todos los dispositivos.

### Dependencias CDN en Service Worker
Las versiones en `sw.js` (`CDN_ASSETS`) deben coincidir **exactamente** con las URLs `<script src=...>` en `index.html`. Cualquier discrepancia causa fallos offline.

### Estilo de Código
- Todo el código y comentarios están en español
- Modo oscuro es el tema por defecto; el tema claro se alterna por sesión vía `#btn-theme`
- Las variables CSS están definidas en `:root` al inicio de `styles.css`
- No hay linter ni formateador configurado

### Límite de Mapas
La aplicación impone un límite de **3 mapas** simultáneos en IndexedDB. Al alcanzar el límite se muestra una advertencia al usuario.

## Proceso de Build y Desarrollo

- **No hay comandos de build, test, lint ni typecheck.**
- Abrir `index.html` directamente en un navegador o servir con cualquier servidor estático (ej: `python -m http.server`).
- **No hay tests unitarios ni de integración.**

## Backend y Sincronización (Supabase)

### Tablas
- `qc_markers` — marcadores de control de calidad
- `lsm_markers` — muestras de laboratorio

El esquema autoritativo está en `supabase_schema_v2.sql`. El archivo `supabase_schema.sql` es un borrador antiguo (solo LSM) y no debe usarse.

### Seguridad
No hay backend propio: credenciales y API keys viven en el frontend en texto plano. RLS **desactivado** → cualquiera con la anon key puede leer/escribir todas las tablas.
- Contraseña de admin (en `admin-manager.js`): `ADMIN_PASS = 'LSMQC$'`
- Contraseña de acceso LSM (en `app.js`): `LSM_PASS = '354'`
- URL + anon key de Supabase hardcodeadas en `sync-manager.js` y `admin-manager.js`
- LocalStorage e IndexedDB no están encriptados

### Sync
- **Unidireccional únicamente:** dispositivo → Supabase. No hay pull ni downstream sync.
- Los marcadores tienen un flag `pendingUpload` que indica si necesitan sincronizarse.
- El sync se dispara manualmente con el botón de sync o automáticamente cuando detecta WiFi/4G.
- Se usa `PATCH` para actualizar registros existentes (identificados por `local_marker_id` + `device_id`) y `POST` para crear nuevos.

## Funcionalidades Clave para Entender el Código

### Carga de GeoTIFF
- CRS proyectados (ej. EPSG:24877): overlay manual con `L.imageOverlay` después de transformar las esquinas con proj4 a WGS84.
- CRS geográficos (EPSG:4326): se usa `GeoRasterLayer` directamente.
- El CRS se detecta automáticamente desde los geoKeys del TIFF.

### Carga de PDF
- Se renderiza la primera página a canvas con PDF.js (scale=2).
- Coordenadas se intentan extraer automáticamente con 4 estrategias: ISO 32000-2 (GPTS/LPTS), OGC GeoPDF (CTM), Viewport Bounds, y anotaciones PDF.js.
- Si no se detectan, el usuario ingresa las 4 esquinas manualmente en el modal de georreferenciación.

### Calibración de Mapa
- Cada mapa puede tener un offset manual de calibración (Este/Norte en metros), almacenado en LocalStorage bajo `maps_gis_offset_<mapId>`.
- El panel de calibración se genera dinámicamente en el DOM.

### Exportación
- **Local (ZIP):** marcadores QC y LSM en un ZIP con Excel (`marcadores.xlsx`) + carpeta `fotos/`. Filtrable por "solo hoy" o rango de fechas.
- **Admin (Excel):** desde el panel de admin, datos de Supabase a Excel, con hojas separadas para QC y LSM.

### Auto-aprendizaje de Configuración LSM
- `autoLearnLSMConfig()` añade automáticamente los valores usados en los campos LSM a las listas de configuración local, para que aparezcan en futuros dropdowns.

## Directorios y Archivos a Ignorar

- `IGNORAR/` — directorio de pruebas/scratch, excluido por `.gitignore`
- `js/app.js.backup.v161` — backup antiguo, no editar

## Notas para Mantenimiento

- Al agregar un nuevo campo a los marcadores LSM, actualizar:
  1. El modelo en `MarkerManager.createLSM()` en `app.js`
  2. El modal HTML en `index.html` (`#lsm-marker-modal`)
  3. La función `saveLSMMarker()` en `app.js`
  4. El esquema de Supabase en `supabase_schema_v2.sql`
  5. Las funciones de upload en `sync-manager.js` (`uploadLSM`)
  6. Las funciones de exportación ZIP en `app.js`
  7. Las funciones de admin en `admin-manager.js` (tabla, detalle, edición)
  8. El auto-learn en `autoLearnLSMConfig()` si aplica

- Al agregar una nueva dependencia CDN:
  1. Agregar el `<script>` en `index.html` en el orden correcto
  2. Agregar la URL en `sw.js` en `CDN_ASSETS`
  3. Asegurar que las versiones coincidan exactamente
