# MAPS GIS — Notas para Agentes

## Resumen del proyecto

MAPS GIS es una **Progressive Web App (PWA) offline-first** en español para visualizar mapas GIS (GeoTIFF y PDF georreferenciados) y recolectar marcadores de campo. Está construida con **HTML, CSS y JavaScript puro**, sin build step, bundler ni gestor de paquetes. No existe `package.json`, `pyproject.toml` ni ningún archivo de configuración de build; el proyecto se sirve directamente como archivos estáticos.

La aplicación está orientada a dos perfiles de marcador:

- **QC (Control de Calidad):** marcadores simples con nombre, descripción, color y fotos.
- **LSM (Laboratorio de Suelos y Materiales):** marcadores con ~15 campos de laboratorio (proyecto, solicitante, estructura, subestructuras, categoría, semana laboratorio, tipo de material, proveniencia, localización, fuente, ensayos, etc.).

## Arquitectura y organización del código

```
C:\Users\LojanoE\Documents\GitHub\MAPS_GIS
├── index.html              # UI única, carga todos los scripts y CSS
├── sw.js                   # Service Worker con cache-first y versionado
├── manifest.json           # Manifest PWA
├── config.json             # Listas por defecto para selects LSM
├── css/styles.css          # Estilos mobile-first, tema oscuro por defecto
├── js/
│   ├── storage.js          # IndexedDB (mapas y fotos)
│   ├── pdf-processor.js    # Procesamiento y georreferenciación de PDFs
│   ├── app.js              # Lógica principal de la app, UI, mapa, marcadores
│   ├── sync-manager.js     # Sincronización unidireccional a Supabase
│   └── admin-manager.js    # Panel de administración remoto (Supabase)
├── assets/
│   └── logo_lab_chino_PNG.png   # Logo usado en el estampado de fotos LSM
└── LICENSE                 # Apache License 2.0
```

### Módulos principales

- **`index.html`**: contiene toda la estructura de pantallas (`home-screen`, `map-screen`), modales y la carga de scripts. **El orden de carga de scripts es crítico** y no debe cambiarse.
- **`sw.js`**: implementa estrategia cache-first para assets locales y CDN; limpia caches antiguos al activarse. El versionado de la app se controla centralmente mediante `APP_VERSION`.
- **`js/storage.js`**: abstracción sobre IndexedDB (`MapsGISDB` v3) con stores `maps` y `photos`. Soporta guardar/recuperar mapas TIFF/PDF, fotos y blobs originales.
- **`js/pdf-processor.js`**: extrae metadatos geoespaciales de GeoPDFs (ISO 32000-2, OGC GeoPDF, viewport bounds) y crea overlays georreferenciados sobre Leaflet.
- **`js/app.js`**: módulo más grande (~2670 líneas). Inicializa el mapa (Leaflet), gestiona marcadores QC/LSM, fotos, exportación ZIP/Excel, configuración local, calibración de mapas y coordinación de UI.
- **`js/sync-manager.js`**: sincroniza marcadores pendientes (`pendingUpload: true`) hacia Supabase vía REST. Es unidireccional: dispositivo → Supabase.
- **`js/admin-manager.js`**: panel de administración que lee los datos sincronizados en Supabase, con filtros, tabla, mapa y exportación Excel.

## Stack tecnológico

Todas las dependencias se cargan por CDN en `index.html` (y deben coincidir exactamente con `CDN_ASSETS` en `sw.js`):

| Librería | Uso |
|----------|-----|
| Leaflet 1.9.4 | Mapa interactivo base |
| Proj4js 2.9.2 | Transformación de coordenadas |
| GeoTIFF 2.1.3 | Lectura de archivos GeoTIFF |
| GeoRaster 1.6.0 + GeoRaster Layer for Leaflet 3.10.0 | Renderizado de GeoTIFF geográficos |
| PDF.js 3.11.174 | Renderizado y parseo de PDFs |
| SheetJS (xlsx) 0.20.1 | Exportación a Excel |
| JSZip 3.10.1 | Generación de ZIPs de exportación |
| FileSaver.js 2.0.5 | Descarga de archivos |
| Piexif.js 1.0.6 | Lectura/escritura de metadatos EXIF/GPS en fotos |

Almacenamiento:

- **IndexedDB** (`MapsGISDB` v3): mapas (`maps`) y fotos (`photos`).
- **LocalStorage**: marcadores QC/LSM, configuración LSM, offsets de calibración por mapa, nombre/id del dispositivo, usuario LSM y preferencias de tema.
- **Supabase**: backend para sincronización y panel admin (conexión directa vía REST, credenciales hardcodeadas).

## Cómo ejecutar el proyecto

No hay comando de build. Solo se requiere servir los archivos estáticamente:

```bash
# Opción 1: Python
python -m http.server 8000

# Opción 2: npx serve
npx serve .

# Opción 3: cualquier servidor estático
```

Luego abrir `http://localhost:8000` en un navegador. Para probar funcionalidades de PWA (service worker, cámara, geolocalización, IndexedDB) se recomienda usar **localhost con HTTPS o un dispositivo real**; algunas APIs no funcionan en `file://`.

### No hay tests automatizados

El proyecto no tiene tests unitarios ni de integración. Las validaciones se hacen manualmente en el navegador. Flujos recomendados para probar:

1. Cargar un GeoTIFF y un PDF georreferenciado.
2. Crear/editar marcadores QC y LSM.
3. Tomar fotos (QC y LSM) y verificar el modal de vista previa.
4. Exportar ZIP con Excel + fotos.
5. Sincronizar con Supabase (requiere conexión).
6. Probar el panel Admin con la contraseña correspondiente.
7. Verificar que la app funcione offline tras la primera carga.

## Convenciones de código

- **Idioma:** código y UI en **español**. Los comentarios principales también están en español.
- **Tema:** oscuro por defecto. El modo claro solo aplica por sesión (`#btn-theme`, clase `light-mode` en `body`).
- **Estilo:** no hay linter, formatter ni TypeScript. Se escribe JavaScript ES6+ con funciones declaradas y módulos IIFE.
- **Coordenadas:** primarias en **PSAD56 UTM 17S (EPSG:24877)**; secundarias en **WGS84 (EPSG:4326)**. El panel muestra ambas.
- **Versionado:** la versión actual es `2.4.4` y debe sincronizarse en todos estos lugares al subir cambios funcionales:
  - `sw.js:11` — `APP_VERSION`
  - `app.js:23` — `APP_VERSION`
  - `index.html:41` — texto de `#app-version-badge`
  - `index.html` — query strings `?v=X.Y.Z` en `<link>` y `<script>` locales
  - `sw.js` — query strings `?v=X.Y.Z` en `CORE_ASSETS`
- **Carga de scripts (NO CAMBIAR ORDEN):**
  Leaflet → Proj4 → GeoTIFF → GeoRaster → GeoRaster Layer → PDF.js → SheetJS → JSZip → FileSaver → Piexif → `storage.js` → `pdf-processor.js` → `app.js` → `sync-manager.js` → `admin-manager.js`.

## Almacenamiento local (referencia rápida)

| Datos | Tecnología | Clave |
|-------|-----------|-------|
| Marcadores QC/LSM | LocalStorage | `maps_gis_markers_v3` |
| Config LSM | LocalStorage | `maps_gis_config_v2` |
| Tamaño logo estampado | LocalStorage | `maps_gis_logo_size` (default 25 px) |
| Tamaño fuente estampado | LocalStorage | `maps_gis_stamp_font_size` (default 30 px) |
| Mapas / fotos | IndexedDB | `MapsGISDB` v3 (`maps`, `photos`) |
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
- PDFs: extracción de coordenadas por ISO 32000-2, OGC GeoPDF o ingreso manual; se guardan las esquinas en UTM PSAD56.
- **Calibración de mapa:** offset en metros (este/norte) por mapa, editable en pantalla (`maps_gis_offset_<mapId>`).

### Marcadores

- Dos tipos: `qc` y `lsm`, cada uno con su propio formulario y modal.
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
- La exportación ZIP usa la foto estampada.

### Sincronización y administración

- Sincronización **unidireccional dispositivo → Supabase**.
- Tablas en Supabase: `qc_markers` y `lsm_markers`.
- Identificación de registros por combinación `local_marker_id` + `device_id`.
- `POST` para crear, `PATCH` para actualizar.
- Panel Admin con contraseña hardcodeada (`LSMQC$` en `admin-manager.js`).
- El panel admin lee directamente de Supabase; no afecta datos locales.

### Exportación

- Exportación local a **ZIP** que contiene:
  - `marcadores.xlsx` con hojas separadas para QC y LSM.
  - Carpeta `fotos/` con las fotos estampadas (máximo 2 por marcador).
- El panel Admin puede exportar Excel de los registros seleccionados.

## Consideraciones de seguridad

> **Importante:** este proyecto tiene decisiones de seguridad deliberadas pero sensibles. Conócelas antes de tocar cualquier cosa relacionada.

- **Credenciales hardcodeadas:** las contraseñas de Admin (`LSMQC$`) y LSM (`354`) están directamente en el código fuente (`admin-manager.js` y `app.js`).
- **Claves de Supabase expuestas:** tanto la URL como la `anon key` de Supabase están en texto plano en `sync-manager.js` y `admin-manager.js`.
- **RLS desactivado:** el backend se asume con Row Level Security desactivado; cualquier cliente con la key puede leer/escribir.
- **No hay autenticación real:** el "login" LSM y Admin se basan únicamente en contraseñas locales.
- **Service Worker cachea todo:** los assets locales, CDN y tiles se almacenan en el cliente. No se deben colocar secretos en archivos estáticos.
- **Datos sensibles en LocalStorage/IndexedDB:** los marcadores, fotos y configuración viven en el navegador del usuario.

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

### Gotchas técnicos

- **PDF.js consume el ArrayBuffer:** no reutilizar el mismo entre llamadas a `pdfjsLib.getDocument()`. Usar copia fresca (`freshUint8()` en `pdf-processor.js`).
- **Detectar CRS solo dentro del diccionario geoespacial** (`VP`/`Measure`/`LGIDict`); escanear todo el texto del PDF produce falsos positivos.
- GeoTIFF proyectados: overlay manual con `L.imageOverlay` tras transformar esquinas con proj4. GeoTIFF geográficos: `GeoRasterLayer`.

## Licencia

Este proyecto se distribuye bajo la **Apache License, Version 2.0**. Ver el archivo `LICENSE` en la raíz del repositorio.

## Directorios y archivos a ignorar

- `IGNORAR/` — excluido por `.gitignore`; no incluir assets de producción aquí.
- `js/app.js.backup.v161` — backup antiguo, no se usa en producción.
- `.playwright-mcp/` — logs temporales de automatización.
- Capturas temporales (`*.png` fuera de `assets/`).
