/**
 * app.js - Main Application Logic
 *
 * Handles: Leaflet map initialization, Proj4js coordinate transformation
 * (WGS84 -> PSAD56 UTM 17S), GPS tracking, marker management, CSV export,
 * GeoTIFF loading and rendering, UI navigation, and theme toggling.
 */

// ============================================
// COORDINATE SYSTEM DEFINITIONS
// ============================================

// PSAD56 / UTM zone 17S (EPSG:24877) - Ecuador
// towgs84 parameters for PSAD56 datum transformation
const PSAD56_UTM_17S = '+proj=utm +zone=17 +south +ellps=intl +towgs84=289,164,-377,0,0,0,0 +units=m +no_defs';

// WGS84 (EPSG:4326) - GPS default
const WGS84 = 'EPSG:4326';

// Register the projection with proj4
proj4.defs('EPSG:24877', PSAD56_UTM_17S);

// ============================================
// APP STATE
// ============================================

const AppState = {
  map: null,
  geoTiffLayer: null,
  markersLayer: null,
  userMarker: null,
  watchId: null,
  isAddMarkerMode: false,
  pendingMarkerLatLng: null,
  currentMapId: null,
  mapTitle: ''
};

// ============================================
// MARKER MANAGEMENT (LocalStorage)
// ============================================

const MarkerManager = {
  STORAGE_KEY: 'maps_gis_markers',

  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  },

  saveAll(markers) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(markers));
  },

  add(name, lat, lng) {
    const markers = this.getAll();
    const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
    const marker = {
      id: 'm_' + Date.now(),
      name: name,
      lat: lat,
      lng: lng,
      norte: north.toFixed(3),
      este: east.toFixed(3),
      createdAt: new Date().toISOString()
    };
    markers.push(marker);
    this.saveAll(markers);
    return marker;
  },

  remove(id) {
    const markers = this.getAll().filter(m => m.id !== id);
    this.saveAll(markers);
  }
};

// ============================================
// UI HELPERS
// ============================================

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;

  requestAnimationFrame(() => {
    toast.classList.remove('hidden');
  });

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

// ============================================
// SCREEN NAVIGATION
// ============================================

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ============================================
// MAP INITIALIZATION
// ============================================

function initMap() {
  if (AppState.map) {
    AppState.map.invalidateSize();
    return;
  }

  // Default center: Ecuador (Quito area)
  AppState.map = L.map('map', {
    center: [-0.1807, -78.4678],
    zoom: 13,
    zoomControl: false
  });

  // Add zoom control to top-left
  L.control.zoom({ position: 'topleft' }).addTo(AppState.map);

  // Base tile layer (dark)
  const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  });

  const lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  });

  // Store tile layers for theme switching
  AppState.darkTiles = darkTiles;
  AppState.lightTiles = lightTiles;
  AppState.currentTiles = darkTiles;
  darkTiles.addTo(AppState.map);

  // Markers layer group
  AppState.markersLayer = L.layerGroup().addTo(AppState.map);

  // Map click handler for adding markers
  AppState.map.on('click', (e) => {
    if (AppState.isAddMarkerMode) {
      openMarkerModal(e.latlng);
    }
  });

  // Mouse/touch move handler for coordinates display
  AppState.map.on('mousemove', (e) => {
    updateCoordsDisplay(e.latlng);
  });

  AppState.map.on('touchmove', (e) => {
    if (e.latlng) updateCoordsDisplay(e.latlng);
  });
}

function updateCoordsDisplay(latlng) {
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  document.getElementById('coord-norte').textContent = 'N: ' + north.toFixed(2) + ' m';
  document.getElementById('coord-este').textContent = 'E: ' + east.toFixed(2) + ' m';
}

// ============================================
// GEO TIFF LOADING
// ============================================

async function loadGeoTiff(mapId) {
  try {
    const arrayBuffer = await MapStorage.getMapData(mapId);

    // Parse GeoTIFF
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();

    // Read raster data
    const raster = await image.readRasters();

    // Get metadata
    const bbox = image.getBoundingBox();
    const width = image.getWidth();
    const height = image.getHeight();

    // Create GeoRaster
    const geoOptions = {
      values: [raster[0]],
      width: width,
      height: height,
      numberOfBands: raster.length >= 3 ? Math.min(raster.length, 4) : 1,
      pixelWidth: (bbox[2] - bbox[0]) / width,
      pixelHeight: (bbox[3] - bbox[1]) / height,
      xmin: bbox[0],
      ymin: bbox[1],
      xmax: bbox[2],
      ymax: bbox[3]
    };

    // Handle multi-band images
    if (raster.length >= 3) {
      geoOptions.values = [raster[0], raster[1], raster[2]];
      geoOptions.numberOfBands = 3;
    }

    const geoRaster = new GeoRaster(geoOptions);

    // Remove existing layer if any
    if (AppState.geoTiffLayer) {
      AppState.map.removeLayer(AppState.geoTiffLayer);
    }

    // Create GeoRasterLayer
    AppState.geoTiffLayer = new GeoRasterLayer({
      georaster: geoRaster,
      opacity: 0.85,
      resolution: 256
    });

    AppState.geoTiffLayer.addTo(AppState.map);

    // Fit map to the raster extent
    AppState.map.fitBounds([
      [bbox[1], bbox[0]],
      [bbox[3], bbox[2]]
    ]);

    showToast('Mapa cargado correctamente', 'success');
  } catch (error) {
    console.error('Error loading GeoTIFF:', error);
    showToast('Error al cargar el mapa: ' + error.message, 'error');
  }
}

// ============================================
// GPS / LOCATION
// ============================================

function goToMyLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocalizacion no disponible', 'error');
    return;
  }

  showToast('Obteniendo ubicacion...', 'info');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      const accuracy = position.coords.accuracy;

      // Remove old user marker
      if (AppState.userMarker) {
        AppState.map.removeLayer(AppState.userMarker);
      }

      // Create accuracy circle
      const circle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#58a6ff',
        fillColor: '#58a6ff',
        fillOpacity: 0.15,
        weight: 1
      });

      // Create user location marker
      const icon = L.divIcon({
        className: 'user-location-marker',
        html: '<div style="width:16px;height:16px;background:#58a6ff;border:3px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(88,166,255,0.6);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      AppState.userMarker = L.layerGroup([
        circle,
        L.marker([lat, lng], { icon: icon })
      ]);

      AppState.userMarker.addTo(AppState.map);

      // Center map
      AppState.map.setView([lat, lng], 16);

      // Update coordinate display
      updateCoordsDisplay({ lat, lng });

      // Show PSAD56 coordinates
      const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
      showToast('N: ' + north.toFixed(2) + ' | E: ' + east.toFixed(2), 'success');
    },
    (error) => {
      let msg = 'Error de ubicacion';
      switch (error.code) {
        case 1: msg = 'Permiso de ubicacion denegado'; break;
        case 2: msg = 'Ubicacion no disponible'; break;
        case 3: msg = 'Tiempo de espera agotado'; break;
      }
      showToast(msg, 'error');
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
}

// ============================================
// MARKER MODAL
// ============================================

function openMarkerModal(latlng) {
  AppState.pendingMarkerLatLng = latlng;

  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  document.getElementById('marker-coords-display').textContent =
    'Norte: ' + north.toFixed(3) + ' m | Este: ' + east.toFixed(3) + ' m';

  document.getElementById('marker-name').value = '';
  document.getElementById('marker-modal').classList.remove('hidden');

  setTimeout(() => {
    document.getElementById('marker-name').focus();
  }, 100);
}

function closeMarkerModal() {
  document.getElementById('marker-modal').classList.add('hidden');
  AppState.pendingMarkerLatLng = null;
  AppState.isAddMarkerMode = false;
  document.getElementById('btn-add-marker').classList.remove('active');
}

function saveMarker() {
  const name = document.getElementById('marker-name').value.trim();
  if (!name) {
    showToast('Ingresa un nombre para el marcador', 'error');
    return;
  }

  if (!AppState.pendingMarkerLatLng) return;

  const { lat, lng } = AppState.pendingMarkerLatLng;

  // Save to LocalStorage
  const marker = MarkerManager.add(name, lat, lng);

  // Add to map
  addMarkerToMap(marker);

  closeMarkerModal();
  showToast('Marcador "' + name + '" guardado', 'success');
}

function addMarkerToMap(marker) {
  const icon = L.divIcon({
    className: 'custom-marker',
    html: '<div style="width:28px;height:28px;background:#f85149;border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.4);"><span style="transform:rotate(45deg);color:#fff;font-size:12px;font-weight:bold;">' + marker.name.charAt(0).toUpperCase() + '</span></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28]
  });

  const popupContent =
    '<div style="min-width:160px;"><strong>' + marker.name + '</strong><br>' +
    '<span style="font-size:0.8rem;color:#666;">N: ' + marker.norte + ' | E: ' + marker.este + '</span></div>';

  L.marker([marker.lat, marker.lng], { icon: icon })
    .bindPopup(popupContent)
    .addTo(AppState.markersLayer);
}

function loadAllMarkersToMap() {
  AppState.markersLayer.clearLayers();
  const markers = MarkerManager.getAll();
  markers.forEach(m => addMarkerToMap(m));
}

// ============================================
// MARKERS LIST MODAL
// ============================================

function showMarkersList() {
  const container = document.getElementById('markers-list-container');
  const markers = MarkerManager.getAll();

  if (markers.length === 0) {
    container.innerHTML = '<p class="empty-msg">No hay marcadores guardados</p>';
  } else {
    container.innerHTML = markers.map(m =>
      '<div class="marker-item">' +
        '<div class="marker-item-info">' +
          '<div class="marker-item-name">' + escapeHtml(m.name) + '</div>' +
          '<div class="marker-item-coords">N: ' + m.norte + ' | E: ' + m.este + '</div>' +
        '</div>' +
        '<button class="marker-item-delete" data-id="' + m.id + '" title="Eliminar">' +
          '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
        '</button>' +
      '</div>'
    ).join('');

    // Add delete handlers
    container.querySelectorAll('.marker-item-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        MarkerManager.remove(id);
        loadAllMarkersToMap();
        showMarkersList();
        showToast('Marcador eliminado', 'info');
      });
    });
  }

  document.getElementById('markers-list-modal').classList.remove('hidden');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// CSV EXPORT
// ============================================

function exportToCSV() {
  const markers = MarkerManager.getAll();

  if (markers.length === 0) {
    showToast('No hay marcadores para exportar', 'error');
    return;
  }

  // CSV with BOM for Excel compatibility
  let csv = '\uFEFFNombre,Norte (m),Este (m),Latitud (WGS84),Longitud (WGS84)\n';

  markers.forEach(m => {
    csv += '"' + m.name.replace(/"/g, '""') + '",' +
           m.norte + ',' +
           m.este + ',' +
           m.lat.toFixed(8) + ',' +
           m.lng.toFixed(8) + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'marcadores_maps_gis_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);

  showToast(markers.length + ' marcadores exportados a CSV', 'success');
}

// ============================================
// MAPS LIST (HOME SCREEN)
// ============================================

async function loadMapsList() {
  const container = document.getElementById('maps-list');

  try {
    const maps = await MapStorage.getAllMaps();

    if (maps.length === 0) {
      container.innerHTML = '<p class="empty-msg">No hay mapas cargados aun</p>';
      return;
    }

    container.innerHTML = maps.map(map =>
      '<div class="map-card" data-id="' + map.id + '">' +
        '<div class="map-card-icon">' +
          '<svg viewBox="0 0 24 24"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16"/></svg>' +
        '</div>' +
        '<div class="map-card-info">' +
          '<div class="map-card-name">' + escapeHtml(map.name) + '</div>' +
          '<div class="map-card-meta">' + formatBytes(map.size) + ' - ' + formatDate(map.createdAt) + '</div>' +
        '</div>' +
        '<button class="map-card-delete" data-id="' + map.id + '" data-name="' + escapeHtml(map.name) + '" title="Eliminar">' +
          '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
        '</button>' +
      '</div>'
    ).join('');

    // Add click handlers for opening maps
    container.querySelectorAll('.map-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.map-card-delete')) return;
        openMap(card.getAttribute('data-id'));
      });
    });

    // Add delete handlers
    container.querySelectorAll('.map-card-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        openDeleteMapModal(id, name);
      });
    });

  } catch (error) {
    container.innerHTML = '<p class="empty-msg">Error al cargar mapas</p>';
    console.error(error);
  }

  // Update storage info
  const total = await MapStorage.getTotalStorage();
  document.getElementById('storage-info').textContent = MapStorage.formatBytes(total) + ' usado';
}

// ============================================
// FILE UPLOAD
// ============================================

function handleFileUpload(file) {
  if (!file) return;

  // Validate file type
  const validTypes = ['.tif', '.tiff'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!validTypes.includes(ext)) {
    showToast('Solo se permiten archivos .TIF o .TIFF', 'error');
    return;
  }

  // Show progress
  const progressEl = document.getElementById('upload-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressText = progressEl.querySelector('.progress-text');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '30%';
  progressText.textContent = 'Leyendo archivo...';

  const reader = new FileReader();

  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 70) + 30;
      progressFill.style.width = percent + '%';
    }
  };

  reader.onload = async (e) => {
    progressFill.style.width = '80%';
    progressText.textContent = 'Guardando...';

    try {
      const arrayBuffer = e.target.result;
      await MapStorage.saveMap(file.name, arrayBuffer, file.size);

      progressFill.style.width = '100%';
      progressText.textContent = 'Completado!';

      showToast('Mapa "' + file.name + '" guardado', 'success');

      // Reload maps list
      await loadMapsList();

      // Reset upload input
      document.getElementById('tiff-input').value = '';

      // Hide progress after delay
      setTimeout(() => {
        progressEl.classList.add('hidden');
        progressFill.style.width = '0%';
      }, 1500);
    } catch (error) {
      console.error('Error saving map:', error);
      showToast('Error al guardar el mapa', 'error');
      progressEl.classList.add('hidden');
    }
  };

  reader.onerror = () => {
    showToast('Error al leer el archivo', 'error');
    progressEl.classList.add('hidden');
  };

  reader.readAsArrayBuffer(file);
}

// ============================================
// OPEN MAP VIEW
// ============================================

async function openMap(mapId) {
  AppState.currentMapId = mapId;

  // Get map name
  const maps = await MapStorage.getAllMaps();
  const map = maps.find(m => m.id === mapId);
  AppState.mapTitle = map ? map.name : 'Mapa';

  document.getElementById('map-title').textContent = AppState.mapTitle;

  // Switch to map screen
  showScreen('map-screen');

  // Initialize map
  initMap();

  // Fix map size after becoming visible
  setTimeout(() => {
    AppState.map.invalidateSize();
  }, 200);

  // Load GeoTIFF
  await loadGeoTiff(mapId);

  // Load markers
  loadAllMarkersToMap();
}

// ============================================
// DELETE MAP MODAL
// ============================================

let pendingDeleteMapId = null;

function openDeleteMapModal(id, name) {
  pendingDeleteMapId = id;
  document.getElementById('delete-map-msg').textContent =
    'Estas seguro de eliminar "' + name + '"?';
  document.getElementById('delete-map-modal').classList.remove('hidden');
}

async function confirmDeleteMap() {
  if (!pendingDeleteMapId) return;

  try {
    await MapStorage.deleteMap(pendingDeleteMapId);
    showToast('Mapa eliminado', 'info');
    await loadMapsList();
  } catch (error) {
    showToast('Error al eliminar el mapa', 'error');
  }

  pendingDeleteMapId = null;
  document.getElementById('delete-map-modal').classList.add('hidden');
}

// ============================================
// THEME TOGGLE
// ============================================

function toggleTheme() {
  const body = document.body;
  body.classList.toggle('light-mode');

  const isLight = body.classList.contains('light-mode');

  // Switch tile layers
  if (AppState.map) {
    if (isLight) {
      AppState.map.removeLayer(AppState.darkTiles);
      AppState.lightTiles.addTo(AppState.map);
      AppState.currentTiles = AppState.lightTiles;
    } else {
      AppState.map.removeLayer(AppState.lightTiles);
      AppState.darkTiles.addTo(AppState.map);
      AppState.currentTiles = AppState.darkTiles;
    }
  }

  // Save preference
  localStorage.setItem('maps_gis_theme', isLight ? 'light' : 'dark');
}

function loadThemePreference() {
  const theme = localStorage.getItem('maps_gis_theme');
  if (theme === 'light') {
    document.body.classList.add('light-mode');
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
  // File input
  document.getElementById('tiff-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Back button
  document.getElementById('btn-back').addEventListener('click', () => {
    showScreen('home-screen');
    loadMapsList();
  });

  // Theme toggle
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Location button
  document.getElementById('btn-location').addEventListener('click', goToMyLocation);

  // Add marker button - toggle mode
  document.getElementById('btn-add-marker').addEventListener('click', () => {
    AppState.isAddMarkerMode = !AppState.isAddMarkerMode;
    const btn = document.getElementById('btn-add-marker');
    btn.classList.toggle('active', AppState.isAddMarkerMode);
    showToast(
      AppState.isAddMarkerMode ? 'Toca el mapa para colocar un marcador' : 'Modo marcador desactivado',
      'info'
    );
  });

  // Marker modal buttons
  document.getElementById('btn-save-marker').addEventListener('click', saveMarker);
  document.getElementById('btn-cancel-marker').addEventListener('click', closeMarkerModal);

  // Enter key in marker name input
  document.getElementById('marker-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveMarker();
    if (e.key === 'Escape') closeMarkerModal();
  });

  // Export CSV
  document.getElementById('btn-export').addEventListener('click', exportToCSV);

  // Markers list
  document.getElementById('btn-markers-list').addEventListener('click', showMarkersList);
  document.getElementById('btn-close-markers').addEventListener('click', () => {
    document.getElementById('markers-list-modal').classList.add('hidden');
  });

  // Delete map modal
  document.getElementById('btn-confirm-delete').addEventListener('click', confirmDeleteMap);
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    pendingDeleteMapId = null;
    document.getElementById('delete-map-modal').classList.add('hidden');
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        if (modal.id === 'marker-modal') {
          AppState.isAddMarkerMode = false;
          document.getElementById('btn-add-marker').classList.remove('active');
        }
      }
    });
  });
}

// ============================================
// APP INITIALIZATION
// ============================================

async function initApp() {
  loadThemePreference();
  initEventListeners();
  await loadMapsList();
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
