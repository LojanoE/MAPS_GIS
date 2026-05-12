# MAPS GIS — Agent Notes

## Project Overview

Offline-first PWA for GIS map viewing (GeoTIFF/PDF) and field marker collection. All Spanish UI. No build system, no bundler, no package manager — pure static HTML/CSS/JS served directly.

## Architecture

```
index.html          — Single page, all screens are divs toggled via .hidden
css/styles.css      — Dark-mode-first CSS, mobile-responsive
js/
  app.js            — Main app logic, MarkerManager, DeviceManager, UI wiring
  storage.js        — IndexedDB wrapper (maps + photos stores)
  pdf-processor.js  — GeoPDF extraction (ISO 32000-2, OGC GeoPDF, viewport bounds)
  sync-manager.js   — One-way sync device → Supabase (REST API)
  admin-manager.js  — Remote admin panel (read Supabase data, export Excel)
sw.js               — Service worker (cache-first for assets, network-first for tiles)
manifest.json       — PWA manifest
```

## Key Conventions

- **Script load order in `index.html` is critical.** Leaflet → proj4 → geotiff → georaster → georaster-layer-for-leaflet → pdf.js → SheetJS → JSZip → FileSaver → storage.js → pdf-processor.js → app.js → sync-manager.js → admin-manager.js. Changing order breaks the app.
- **Coordinate system:** PSAD56 UTM 17S (EPSG:24877) is the primary CRS. WGS84 (EPSG:4326) is secondary. Proj4 defs are set in `app.js` lines 6-10.
- **Marker types:** `qc` (Quality Control) and `lsm` (Soil/Materials Lab). Each has different form fields and sync tables.
- **Storage split:** Markers → LocalStorage (`maps_gis_markers_v3`). Map files/photos → IndexedDB (`MapsGISDB` v3). App config → LocalStorage (`maps_gis_config_v2`).

## Version Gotchas

- Version is duplicated in **3 places**; they must stay in sync:
  - `sw.js` line 11: `APP_VERSION`
  - `app.js` line 23: `APP_VERSION`
  - `index.html` line 40: `#app-version-badge` text
- When bumping version, update **all 3 locations** AND the `CACHE_NAME` prefix in `sw.js` to force cache refresh.
- **CDN dependency versions** in `sw.js` `CDN_ASSETS` must exactly match the `<script src=...>` URLs in `index.html`. Mismatches cause offline failures.

## Development

- **No build/lint/typecheck commands.** Open `index.html` directly in a browser or serve with any static server (e.g. `python -m http.server`).
- **No tests.**
- The `IGNORAR/` directory is excluded via `.gitignore` — scratch/testing folder.
- `js/app.js.backup.v161` is an old backup; do not edit.

## Supabase

- Two Supabase tables: `qc_markers` and `lsm_markers`. Authoritative schema is in `supabase_schema_v2.sql`; `supabase_schema.sql` is an older LSM-only draft.
- RLS is disabled; anonymous key has full access (see `supabase_fix_permissions.sql`).
- Supabase URL and anon key are hardcoded in `sync-manager.js` and `admin-manager.js`.
- Admin password is hardcoded in `admin-manager.js`: `ADMIN_PASS = 'LSMQC$'`.
- LSM login password is hardcoded in `app.js` (`LSM_PASS = '354'`) and in `index.html` as the input default value `354`.
- Sync is **one-way only** (device → Supabase). No pull/downstream sync.

## Style Notes

- All UI text and code comments are in Spanish.
- Dark mode is the default theme; light theme is toggled per-session via `#btn-theme`.
- CSS uses custom properties (variables) defined in `:root` at top of `styles.css`.
