# MAPS GIS — Notas para Agentes

## Resumen del proyecto

MAPS GIS es una **Progressive Web App (PWA) offline-first** en español para visualizar mapas GIS (GeoTIFF y PDF georreferenciados), recolectar marcadores de campo y registrar recorridos GPS. Está construida con **HTML, CSS y JavaScript puro**, sin build step, bundler ni gestor de paquetes. No existe `package.json`, `pyproject.toml`, `Cargo.toml` ni ningún archivo de configuración de build; el proyecto se sirve directamente como archivos estáticos.

La aplicación está orientada a dos perfiles de marcador:

- **QC (Control de Calidad):** marcadores simples con nombre, descripción, color, fotos y altura GPS.
- **LSM (Laboratorio de Suelos y Materiales):** marcadores con ~15 campos de laboratorio (proyecto, solicitante, estructura, subestructuras, categoría, semana laboratorio, tipo de material, nombre de muestra, proveniencia, localización, fuente, ensayos, etc.).

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
- **`js/pdf-processor.js`**: extrae metadatos geoespaciales de GeoPDFs (ISO 32000-2, OGC GeoPDF, viewport bounds, anotaciones PDF.js) y crea overlays georreferenciados sobre Leaflet.
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
- **Versionado:** la versión actual es `2.6.0` y debe sincronizarse en todos estos lugares al subir cambios funcionales:
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
- La exportación ZIP usa la foto estampada.

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
- **Service Worker nunca cachea Supabase:** `supabase.co` está en `NETWORK_ONLY_DOMAINS`.

## Licencia

Este proyecto se distribuye bajo la **Apache License, Version 2.0**. Ver el archivo `LICENSE` en la raíz del repositorio.

## Directorios y archivos a ignorar

- `IGNORAR/` — excluido por `.gitignore`; no incluir assets de producción aquí.
- `js/app.js.backup.v161` — backup antiguo, no se usa en producción.
- `.playwright-mcp/` — logs temporales de automatización.
- Capturas temporales (`*.png` fuera de `assets/`).
