/**
 * app.js - MAPS GIS Main Application
 *
 * Avenza-like GIS viewer with advanced marker management.
 * Supports GeoTIFF and PDF maps with georeferencing.
 */

// ============================================
// COORDINATE SYSTEM DEFINITIONS
// ============================================

const PSAD56_UTM_17S = '+proj=utm +zone=17 +south +ellps=intl +towgs84=289,164,-377,0,0,0,0 +units=m +no_defs';
const WGS84 = 'EPSG:4326';

proj4.defs('EPSG:24877', PSAD56_UTM_17S);

// ============================================
// MARKER COLORS CONFIG
// ============================================

const MARKER_COLORS = {
  red:    { hex: '#f85149', label: 'Rojo' },
  blue:   { hex: '#58a6ff', label: 'Azul' },
  green:  { hex: '#3fb950', label: 'Verde' },
  yellow: { hex: '#d29922', label: 'Amarillo' },
  orange: { hex: '#db6d28', label: 'Naranja' },
  purple: { hex: '#a371f7', label: 'Morado' }
};

// ============================================
// APP STATE
// ============================================

const AppState = {
  map: null,
  mapOverlay: null,
  markersLayer: null,
  userLocationLayer: null,
  isAddMarkerMode: false,
  pendingMarkerLatLng: null,
  currentMapId: null,
  currentMapType: 'tiff',
  mapTitle: '',
  editingMarkerId: null,
  selectedCategory: 'red',
  darkTiles: null,
  lightTiles: null,
  pendingPDF: null
};

// ============================================
// MARKER MANAGER (LocalStorage)
// ============================================

const MarkerManager = {
  STORAGE_KEY: 'maps_gis_markers_v2',

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

  create(name, description, lat, lng, color) {
    const markers = this.getAll();
    const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
    const marker = {
      id: 'm_' + Date.now(),
      name: name.trim(),
      description: description.trim(),
      lat: lat,
      lng: lng,
      norte: north.toFixed(3),
      este: east.toFixed(3),
      color: color || 'red',
      createdAt: new Date().toISOString()
    };
    markers.push(marker);
    this.saveAll(markers);
    return marker;
  },

  update(id, updates) {
    const markers = this.getAll();
    const idx = markers.findIndex(m => m.id === id);
    if (idx === -1) return null;
    markers[idx] = { ...markers[idx], ...updates };
    this.saveAll(markers);
    return markers[idx];
  },

  remove(id) {
    const markers = this.getAll().filter(m => m.id !== id);
    this.saveAll(markers);
  },

  getById(id) {
    return this.getAll().find(m => m.id === id) || null;
  },

  getCount() {
    return this.getAll().length;
  }
};

// ============================================
// UI HELPERS
// ============================================

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  requestAnimationFrame(() => toast.classList.remove('hidden'));
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('es-EC', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

  AppState.map = L.map('map', {
    center: [-0.1807, -78.4678],
    zoom: 13,
    zoomControl: false
  });

  L.control.zoom({ position: 'topleft' }).addTo(AppState.map);

  AppState.darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  });

  AppState.lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  });

  AppState.darkTiles.addTo(AppState.map);
  AppState.markersLayer = L.layerGroup().addTo(AppState.map);

  AppState.map.on('click', (e) => {
    if (AppState.isAddMarkerMode) {
      openMarkerModal(e.latlng);
    }
  });

  AppState.map.on('mousemove', (e) => updateCoordsDisplay(e.latlng));
}

function updateCoordsDisplay(latlng) {
  if (!latlng) return;
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  document.getElementById('coord-norte').textContent = 'N: ' + north.toFixed(2);
  document.getElementById('coord-este').textContent = 'E: ' + east.toFixed(2);
  document.getElementById('coord-lat').textContent = 'Lat: ' + latlng.lat.toFixed(6);
  document.getElementById('coord-lng').textContent = 'Lon: ' + latlng.lng.toFixed(6);
}

// ============================================
// GEO TIFF LOADING
// ============================================

async function loadGeoTiff(mapId) {
  try {
    const arrayBuffer = await MapStorage.getMapData(mapId);
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const raster = await image.readRasters();
    const bbox = image.getBoundingBox();
    const width = image.getWidth();
    const height = image.getHeight();

    const geoOptions = {
      values: raster.length >= 3 ? [raster[0], raster[1], raster[2]] : [raster[0]],
      width: width,
      height: height,
      numberOfBands: raster.length >= 3 ? 3 : 1,
      pixelWidth: (bbox[2] - bbox[0]) / width,
      pixelHeight: (bbox[3] - bbox[1]) / height,
      xmin: bbox[0],
      ymin: bbox[1],
      xmax: bbox[2],
      ymax: bbox[3]
    };

    const geoRaster = new GeoRaster(geoOptions);

    if (AppState.mapOverlay) {
      AppState.map.removeLayer(AppState.mapOverlay);
    }

    AppState.mapOverlay = new GeoRasterLayer({
      georaster: geoRaster,
      opacity: 0.85,
      resolution: 256
    });

    AppState.mapOverlay.addTo(AppState.map);
    AppState.map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);

    showToast('Mapa cargado correctamente', 'success');
  } catch (error) {
    console.error('Error loading GeoTIFF:', error);
    showToast('Error al cargar el mapa', 'error');
  }
}

// ============================================
// PDF MAP LOADING
// ============================================

async function loadPDFMap(mapId) {
  try {
    const record = await MapStorage.getMapRecord(mapId);
    const georef = record.georef;

    if (!georef || !georef.corners) {
      showToast('El PDF no tiene georreferenciacion', 'error');
      return;
    }

    const pdf = await PDFProcessor.loadPDF(record.data);
    const { canvas } = await PDFProcessor.renderPage(pdf, 2);

    if (AppState.mapOverlay) {
      AppState.map.removeLayer(AppState.mapOverlay);
    }

    AppState.mapOverlay = PDFProcessor.createGeoOverlay(canvas, georef.corners, georef.crs);
    AppState.mapOverlay.addTo(AppState.map);

    const bounds = AppState.mapOverlay.getBounds();
    AppState.map.fitBounds(bounds);

    showToast('PDF cargado correctamente', 'success');
  } catch (error) {
    console.error('Error loading PDF:', error);
    showToast('Error al cargar el PDF', 'error');
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

      if (AppState.userLocationLayer) {
        AppState.map.removeLayer(AppState.userLocationLayer);
      }

      const pulseIcon = L.divIcon({
        className: 'user-location-pulse',
        html: '<div class="user-location-pulse"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      AppState.userLocationLayer = L.layerGroup([
        L.circle([lat, lng], {
          radius: accuracy,
          color: '#58a6ff',
          fillColor: '#58a6ff',
          fillOpacity: 0.1,
          weight: 1
        }),
        L.marker([lat, lng], { icon: pulseIcon })
      ]);

      AppState.userLocationLayer.addTo(AppState.map);
      AppState.map.setView([lat, lng], 16);
      updateCoordsDisplay({ lat, lng });

      const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
      showToast('Ubicacion obtenida', 'success');
    },
    (error) => {
      const msgs = { 1: 'Permiso denegado', 2: 'No disponible', 3: 'Tiempo agotado' };
      showToast('Error: ' + (msgs[error.code] || 'Desconocido'), 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ============================================
// MARKER SVG ICON GENERATOR
// ============================================

function createMarkerSVG(color, initial) {
  const hex = MARKER_COLORS[color]?.hex || MARKER_COLORS.red.hex;
  return '<div class="custom-marker-pin">' +
    '<svg viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="' + hex + '"/>' +
      '<circle cx="16" cy="15" r="10" fill="rgba(0,0,0,0.15)"/>' +
      '<text x="16" y="19" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold" font-family="sans-serif">' + initial + '</text>' +
    '</svg>' +
  '</div>';
}

function createMarkerIcon(marker) {
  const initial = marker.name.charAt(0).toUpperCase();
  const color = marker.color || 'red';
  return L.divIcon({
    className: '',
    html: createMarkerSVG(color, initial),
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40]
  });
}

// ============================================
// MARKER MODAL (Create/Edit)
// ============================================

function openMarkerModal(latlng, editId) {
  AppState.pendingMarkerLatLng = latlng;
  AppState.editingMarkerId = editId || null;

  if (editId) {
    const marker = MarkerManager.getById(editId);
    if (!marker) return;

    document.getElementById('marker-modal-title').textContent = 'Editar Marcador';
    document.getElementById('marker-name').value = marker.name;
    document.getElementById('marker-description').value = marker.description || '';
    AppState.selectedCategory = marker.color || 'red';

    const [east, north] = proj4(WGS84, 'EPSG:24877', [marker.lng, marker.lat]);
    document.getElementById('marker-coords-display').textContent =
      'N: ' + north.toFixed(3) + ' | E: ' + east.toFixed(3);
  } else {
    document.getElementById('marker-modal-title').textContent = 'Nuevo Marcador';
    document.getElementById('marker-name').value = '';
    document.getElementById('marker-description').value = '';
    AppState.selectedCategory = 'red';

    const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
    document.getElementById('marker-coords-display').textContent =
      'N: ' + north.toFixed(3) + ' | E: ' + east.toFixed(3);
  }

  updateCategorySelector();
  document.getElementById('marker-modal').classList.remove('hidden');

  setTimeout(() => document.getElementById('marker-name').focus(), 100);
}

function closeMarkerModal() {
  document.getElementById('marker-modal').classList.add('hidden');
  AppState.pendingMarkerLatLng = null;
  AppState.editingMarkerId = null;
  AppState.isAddMarkerMode = false;
  document.getElementById('btn-add-marker').classList.remove('active');
}

function saveMarker() {
  const name = document.getElementById('marker-name').value.trim();
  const description = document.getElementById('marker-description').value.trim();

  if (!name) {
    showToast('Ingresa un nombre', 'error');
    return;
  }

  if (AppState.editingMarkerId) {
    MarkerManager.update(AppState.editingMarkerId, {
      name: name,
      description: description,
      color: AppState.selectedCategory
    });
    showToast('Marcador actualizado', 'success');
  } else if (AppState.pendingMarkerLatLng) {
    const { lat, lng } = AppState.pendingMarkerLatLng;
    MarkerManager.create(name, description, lat, lng, AppState.selectedCategory);
    showToast('Marcador "' + name + '" guardado', 'success');
  }

  refreshMarkersOnMap();
  updateMarkerCountBadge();
  closeMarkerModal();
}

function updateCategorySelector() {
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === AppState.selectedCategory);
  });
}

// ============================================
// MARKER DETAIL MODAL
// ============================================

function openMarkerDetail(id) {
  const marker = MarkerManager.getById(id);
  if (!marker) return;

  const color = MARKER_COLORS[marker.color]?.hex || MARKER_COLORS.red.hex;
  const initial = marker.name.charAt(0).toUpperCase();

  document.getElementById('detail-marker-icon').style.background = color;
  document.getElementById('detail-marker-icon').textContent = initial;
  document.getElementById('detail-marker-name').textContent = marker.name;
  document.getElementById('detail-marker-date').textContent = formatDateTime(marker.createdAt);
  document.getElementById('detail-marker-category').textContent = MARKER_COLORS[marker.color]?.label || 'Rojo';
  document.getElementById('detail-marker-norte').textContent = marker.norte + ' m';
  document.getElementById('detail-marker-este').textContent = marker.este + ' m';
  document.getElementById('detail-marker-lat').textContent = marker.lat.toFixed(8);
  document.getElementById('detail-marker-lng').textContent = marker.lng.toFixed(8);

  const descRow = document.getElementById('detail-description-row');
  if (marker.description) {
    descRow.classList.remove('hidden');
    document.getElementById('detail-marker-description').textContent = marker.description;
  } else {
    descRow.classList.add('hidden');
  }

  document.getElementById('marker-detail-modal').dataset.markerId = id;
  document.getElementById('marker-detail-modal').classList.remove('hidden');
}

function closeMarkerDetail() {
  document.getElementById('marker-detail-modal').classList.add('hidden');
}

function editCurrentMarker() {
  const id = document.getElementById('marker-detail-modal').dataset.markerId;
  const marker = MarkerManager.getById(id);
  if (!marker) return;

  closeMarkerDetail();
  openMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
}

function deleteCurrentMarker() {
  const id = document.getElementById('marker-detail-modal').dataset.markerId;
  MarkerManager.remove(id);
  refreshMarkersOnMap();
  updateMarkerCountBadge();
  closeMarkerDetail();
  showToast('Marcador eliminado', 'info');
}

// ============================================
// MARKERS ON MAP
// ============================================

function addMarkerToMap(marker) {
  const icon = createMarkerIcon(marker);
  const popupContent =
    '<div style="min-width:140px;padding:4px;">' +
    '<strong style="font-size:0.9rem;">' + escapeHtml(marker.name) + '</strong><br>' +
    '<span style="font-size:0.75rem;color:#666;">N: ' + marker.norte + ' | E: ' + marker.este + '</span>' +
    '</div>';

  L.marker([marker.lat, marker.lng], { icon: icon })
    .bindPopup(popupContent)
    .on('click', () => {
      AppState.map.setView([marker.lat, marker.lng], AppState.map.getZoom());
    })
    .addTo(AppState.markersLayer);
}

function refreshMarkersOnMap() {
  AppState.markersLayer.clearLayers();
  const markers = MarkerManager.getAll();
  markers.forEach(m => addMarkerToMap(m));
}

// ============================================
// MARKERS SIDE PANEL
// ============================================

function openMarkersPanel() {
  renderMarkersList();
  document.getElementById('markers-panel').classList.remove('hidden');
}

function closeMarkersPanel() {
  document.getElementById('markers-panel').classList.add('hidden');
}

function renderMarkersList(filter = '') {
  const container = document.getElementById('markers-list-container');
  let markers = MarkerManager.getAll();

  if (filter) {
    const q = filter.toLowerCase();
    markers = markers.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.description && m.description.toLowerCase().includes(q))
    );
  }

  if (markers.length === 0) {
    container.innerHTML = '<p class="empty-msg">' +
      (filter ? 'Sin resultados para "' + escapeHtml(filter) + '"' : 'No hay marcadores guardados') +
      '</p>';
    return;
  }

  markers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  container.innerHTML = markers.map(m => {
    const color = MARKER_COLORS[m.color]?.hex || MARKER_COLORS.red.hex;
    return '<div class="marker-item" data-id="' + m.id + '">' +
      '<span class="marker-item-dot" style="background:' + color + ';"></span>' +
      '<div class="marker-item-info">' +
        '<div class="marker-item-name">' + escapeHtml(m.name) + '</div>' +
        '<div class="marker-item-coords">N: ' + m.norte + ' | E: ' + m.este + '</div>' +
      '</div>' +
      '<div class="marker-item-actions">' +
        '<button class="marker-item-btn edit" data-id="' + m.id + '" title="Editar">' +
          '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        '</button>' +
        '<button class="marker-item-btn delete" data-id="' + m.id + '" title="Eliminar">' +
          '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.marker-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.marker-item-btn')) return;
      const id = item.dataset.id;
      const marker = MarkerManager.getById(id);
      if (marker) {
        AppState.map.setView([marker.lat, marker.lng], 17);
        closeMarkersPanel();
      }
    });
  });

  container.querySelectorAll('.marker-item-btn.edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const marker = MarkerManager.getById(id);
      if (marker) {
        closeMarkersPanel();
        openMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
      }
    });
  });

  container.querySelectorAll('.marker-item-btn.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      MarkerManager.remove(id);
      refreshMarkersOnMap();
      updateMarkerCountBadge();
      renderMarkersList(document.getElementById('marker-search').value);
      showToast('Marcador eliminado', 'info');
    });
  });
}

function updateMarkerCountBadge() {
  const count = MarkerManager.getCount();
  const badge = document.getElementById('marker-count-badge');
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
  document.getElementById('markers-count').textContent = count;
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

  let csv = '\uFEFFNombre,Categoria,Descripcion,Norte (m),Este (m),Latitud,Longitud,Fecha\n';

  markers.forEach(m => {
    csv += '"' + (m.name || '').replace(/"/g, '""') + '",' +
           '"' + (MARKER_COLORS[m.color]?.label || '') + '",' +
           '"' + (m.description || '').replace(/"/g, '""') + '",' +
           m.norte + ',' +
           m.este + ',' +
           m.lat.toFixed(8) + ',' +
           m.lng.toFixed(8) + ',' +
           '"' + formatDateTime(m.createdAt) + '"\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'marcadores_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);

  showToast(markers.length + ' marcadores exportados', 'success');
}

// ============================================
// MAPS LIST (HOME)
// ============================================

async function loadMapsList() {
  const container = document.getElementById('maps-list');

  try {
    const maps = await MapStorage.getAllMaps();
    document.getElementById('maps-count').textContent = maps.length;

    if (maps.length === 0) {
      container.innerHTML = '<p class="empty-msg">No hay mapas cargados aun</p>';
      return;
    }

    container.innerHTML = maps.map(map => {
      const typeIcon = map.type === 'pdf'
        ? '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16"/></svg>';

      const typeLabel = map.type === 'pdf' ? 'PDF' : 'TIFF';

      return '<div class="map-card" data-id="' + map.id + '">' +
        '<div class="map-card-icon">' + typeIcon + '</div>' +
        '<div class="map-card-info">' +
          '<div class="map-card-name">' + escapeHtml(map.name) + '</div>' +
          '<div class="map-card-meta">' + typeLabel + ' - ' + formatBytes(map.size) + ' - ' + formatDate(map.createdAt) + '</div>' +
        '</div>' +
        '<button class="map-card-delete" data-id="' + map.id + '" data-name="' + escapeHtml(map.name) + '" title="Eliminar">' +
          '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
        '</button>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.map-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.map-card-delete')) return;
        openMap(card.dataset.id);
      });
    });

    container.querySelectorAll('.map-card-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteMapModal(btn.dataset.id, btn.dataset.name);
      });
    });

  } catch (error) {
    container.innerHTML = '<p class="empty-msg">Error al cargar mapas</p>';
  }

  const total = await MapStorage.getTotalStorage();
  const storageInfoEl = document.getElementById('storage-info');
  if (storageInfoEl) {
    storageInfoEl.textContent = MapStorage.formatBytes(total) + ' usado';
  }
}

// ============================================
// FILE UPLOAD (TIFF + PDF)
// ============================================

function handleFileUpload(file) {
  if (!file) return;

  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (ext === '.tif' || ext === '.tiff') {
    handleTIFFUpload(file);
  } else if (ext === '.pdf') {
    handlePDFUpload(file);
  } else {
    showToast('Solo archivos .TIF, .TIFF o .PDF', 'error');
  }
}

function handleTIFFUpload(file) {
  const progressEl = document.getElementById('upload-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressText = progressEl.querySelector('.progress-text');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '30%';
  progressText.textContent = 'Leyendo archivo...';

  const reader = new FileReader();

  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      progressFill.style.width = (Math.round((e.loaded / e.total) * 70) + 30) + '%';
    }
  };

  reader.onload = async (e) => {
    progressFill.style.width = '80%';
    progressText.textContent = 'Guardando...';

    try {
      await MapStorage.saveMap(file.name, e.target.result, file.size);
      progressFill.style.width = '100%';
      progressText.textContent = 'Completado!';
      showToast('Mapa "' + file.name + '" guardado', 'success');
      await loadMapsList();
      document.getElementById('map-input').value = '';
      setTimeout(() => {
        progressEl.classList.add('hidden');
        progressFill.style.width = '0%';
      }, 1500);
    } catch (error) {
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

async function handlePDFUpload(file) {
  const progressEl = document.getElementById('upload-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressText = progressEl.querySelector('.progress-text');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '30%';
  progressText.textContent = 'Procesando PDF...';

  try {
    const arrayBuffer = await file.arrayBuffer();
    // Pass a copy to PDFProcessor since PDF.js may detach the buffer
    const processed = await PDFProcessor.processPDF(arrayBuffer.slice(0));

    progressFill.style.width = '60%';
    progressText.textContent = 'Renderizando vista previa...';

    // Show preview in georef modal
    const previewCanvas = document.getElementById('pdf-preview-canvas');
    const ctx = previewCanvas.getContext('2d');
    previewCanvas.width = processed.canvas.width;
    previewCanvas.height = processed.canvas.height;
    ctx.drawImage(processed.canvas, 0, 0);
    previewCanvas.style.maxWidth = '100%';
    previewCanvas.style.height = 'auto';

    // Store pending PDF data
    AppState.pendingPDF = {
      name: file.name,
      arrayBuffer: arrayBuffer,
      size: file.size,
      isGeoPDF: processed.isGeoPDF,
      geoData: processed.geoData || null
    };

    progressFill.style.width = '80%';

    // Check if geo data was auto-extracted
    const geoData = processed.geoData;

    if (geoData && geoData.corners) {
      // Auto-fill the georef modal with extracted coordinates
      progressText.textContent = 'Coordenadas detectadas automaticamente!';

      const crs = geoData.crs || 'EPSG:4326';
      document.getElementById('georef-crs').value = crs;

      const c = geoData.corners;

      if (crs === 'EPSG:4326') {
        // Coordinates are [lon, lat] - display as lat/lon or convert to UTM
        // Convert all corners to PSAD56 UTM 17S for display
        const cornersUTM = {};
        for (const key of ['tl', 'tr', 'bl', 'br']) {
          const [lon, lat] = c[key];
          const [e, n] = proj4('EPSG:4326', 'EPSG:24877', [lon, lat]);
          cornersUTM[key] = { e, n };
        }

        document.getElementById('georef-tl-e').value = cornersUTM.tl.e.toFixed(2);
        document.getElementById('georef-tl-n').value = cornersUTM.tl.n.toFixed(2);
        document.getElementById('georef-tr-e').value = cornersUTM.tr.e.toFixed(2);
        document.getElementById('georef-tr-n').value = cornersUTM.tr.n.toFixed(2);
        document.getElementById('georef-bl-e').value = cornersUTM.bl.e.toFixed(2);
        document.getElementById('georef-bl-n').value = cornersUTM.bl.n.toFixed(2);
        document.getElementById('georef-br-e').value = cornersUTM.br.e.toFixed(2);
        document.getElementById('georef-br-n').value = cornersUTM.br.n.toFixed(2);

        // Set CRS to PSAD56 since we pre-converted
        document.getElementById('georef-crs').value = 'EPSG:24877';
      } else {
        // Coordinates are already in projected CRS (easting, northing)
        document.getElementById('georef-tl-e').value = c.tl[0].toFixed(2);
        document.getElementById('georef-tl-n').value = c.tl[1].toFixed(2);
        document.getElementById('georef-tr-e').value = c.tr[0].toFixed(2);
        document.getElementById('georef-tr-n').value = c.tr[1].toFixed(2);
        document.getElementById('georef-bl-e').value = c.bl[0].toFixed(2);
        document.getElementById('georef-bl-n').value = c.bl[1].toFixed(2);
        document.getElementById('georef-br-e').value = c.br[0].toFixed(2);
        document.getElementById('georef-br-n').value = c.br[1].toFixed(2);

        document.getElementById('georef-crs').value = crs;
      }

      // Update info text
      const infoEl = document.querySelector('.georef-info');
      if (infoEl) {
        infoEl.textContent = 'Coordenadas detectadas automaticamente (' + geoData.source + '). Verifica y ajusta si es necesario.';
        infoEl.style.background = 'rgba(63, 185, 80, 0.1)';
        infoEl.style.borderColor = 'rgba(63, 185, 80, 0.3)';
        infoEl.style.color = 'var(--success)';
      }

      showToast('Coordenadas del GeoPDF detectadas!', 'success');
    } else {
      progressText.textContent = 'Ingresa las coordenadas de las esquinas';

      // Reset info text
      const infoEl = document.querySelector('.georef-info');
      if (infoEl) {
        infoEl.textContent = 'Ingresa las coordenadas de las 4 esquinas del mapa en PSAD56 UTM 17S';
        infoEl.style.background = '';
        infoEl.style.borderColor = '';
        infoEl.style.color = '';
      }

      // Clear fields
      ['georef-tl-e', 'georef-tl-n', 'georef-tr-e', 'georef-tr-n',
       'georef-bl-e', 'georef-bl-n', 'georef-br-e', 'georef-br-n'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('georef-crs').value = 'EPSG:24877';

      showToast('PDF sin georreferenciacion. Ingresa coordenadas manualmente.', 'info');
    }

    // Show georef modal
    document.getElementById('georef-modal').classList.remove('hidden');

  } catch (error) {
    console.error('PDF processing error:', error);
    showToast('Error al procesar el PDF: ' + error.message, 'error');
    progressEl.classList.add('hidden');
  }
}

// ============================================
// GEOREFERENCING MODAL
// ============================================

function closeGeorefModal() {
  document.getElementById('georef-modal').classList.add('hidden');
  AppState.pendingPDF = null;
}

async function applyGeoref() {
  const crs = document.getElementById('georef-crs').value;

  // Read corner values
  const tlE = parseFloat(document.getElementById('georef-tl-e').value);
  const tlN = parseFloat(document.getElementById('georef-tl-n').value);
  const trE = parseFloat(document.getElementById('georef-tr-e').value);
  const trN = parseFloat(document.getElementById('georef-tr-n').value);
  const blE = parseFloat(document.getElementById('georef-bl-e').value);
  const blN = parseFloat(document.getElementById('georef-bl-n').value);
  const brE = parseFloat(document.getElementById('georef-br-e').value);
  const brN = parseFloat(document.getElementById('georef-br-n').value);

  // Validate
  if ([tlE, tlN, trE, trN, blE, blN, brE, brN].some(v => isNaN(v))) {
    showToast('Completa todas las coordenadas', 'error');
    return;
  }

  const pending = AppState.pendingPDF;
  if (!pending) {
    showToast('Error: no hay PDF pendiente', 'error');
    return;
  }

  // Generate thumbnail
  const previewCanvas = document.getElementById('pdf-preview-canvas');
  const thumbCanvas = document.createElement('canvas');
  const scale = 200 / previewCanvas.width;
  thumbCanvas.width = 200;
  thumbCanvas.height = previewCanvas.height * scale;
  thumbCanvas.getContext('2d').drawImage(previewCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.5);

  const georef = {
    corners: {
      tl: [tlE, tlN],
      tr: [trE, trN],
      bl: [blE, blN],
      br: [brE, brN]
    },
    crs: crs
  };

  try {
    const progressText = document.querySelector('#upload-progress .progress-text');
    progressText.textContent = 'Guardando PDF...';

    await MapStorage.savePDFMap(pending.name, pending.arrayBuffer, pending.size, georef, thumbnail);

    document.querySelector('#upload-progress .progress-fill').style.width = '100%';
    progressText.textContent = 'Completado!';
    showToast('PDF "' + pending.name + '" guardado', 'success');

    closeGeorefModal();
    await loadMapsList();
    document.getElementById('map-input').value = '';

    setTimeout(() => {
      document.getElementById('upload-progress').classList.add('hidden');
      document.querySelector('#upload-progress .progress-fill').style.width = '0%';
    }, 1500);
  } catch (error) {
    showToast('Error al guardar el PDF', 'error');
  }
}

// ============================================
// OPEN MAP VIEW
// ============================================

async function openMap(mapId) {
  AppState.currentMapId = mapId;
  const maps = await MapStorage.getAllMaps();
  const map = maps.find(m => m.id === mapId);
  AppState.currentMapType = map ? (map.type || 'tiff') : 'tiff';
  AppState.mapTitle = map ? map.name : 'Mapa';
  document.getElementById('map-title').textContent = AppState.mapTitle;

  showScreen('map-screen');
  initMap();

  setTimeout(() => AppState.map.invalidateSize(), 200);

  if (AppState.currentMapType === 'pdf') {
    await loadPDFMap(mapId);
  } else {
    await loadGeoTiff(mapId);
  }

  refreshMarkersOnMap();
  updateMarkerCountBadge();
}

// ============================================
// DELETE MAP MODAL
// ============================================

let pendingDeleteMapId = null;

function openDeleteMapModal(id, name) {
  pendingDeleteMapId = id;
  document.getElementById('delete-map-msg').textContent = 'Eliminar "' + name + '"?';
  document.getElementById('delete-map-modal').classList.remove('hidden');
}

async function confirmDeleteMap() {
  if (!pendingDeleteMapId) return;
  try {
    await MapStorage.deleteMap(pendingDeleteMapId);
    showToast('Mapa eliminado', 'info');
    await loadMapsList();
  } catch {
    showToast('Error al eliminar', 'error');
  }
  pendingDeleteMapId = null;
  document.getElementById('delete-map-modal').classList.add('hidden');
}

// ============================================
// THEME TOGGLE
// ============================================

function toggleTheme() {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');

  if (AppState.map) {
    if (isLight) {
      AppState.map.removeLayer(AppState.darkTiles);
      AppState.lightTiles.addTo(AppState.map);
    } else {
      AppState.map.removeLayer(AppState.lightTiles);
      AppState.darkTiles.addTo(AppState.map);
    }
  }

  localStorage.setItem('maps_gis_theme', isLight ? 'light' : 'dark');
}

function loadThemePreference() {
  if (localStorage.getItem('maps_gis_theme') === 'light') {
    document.body.classList.add('light-mode');
  }
}

// ============================================
// ONLINE STATUS
// ============================================

function updateOnlineStatus() {
  const badge = document.getElementById('online-status');
  if (navigator.onLine) {
    badge.textContent = 'En linea';
    badge.className = 'status-badge online';
  } else {
    badge.textContent = 'Sin conexion';
    badge.className = 'status-badge offline';
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function initEventListeners() {
  // File input (now supports TIFF + PDF)
  document.getElementById('map-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
  });

  // Back button
  document.getElementById('btn-back').addEventListener('click', () => {
    showScreen('home-screen');
    loadMapsList();
    updateMarkerCountBadge();
  });

  // Theme
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Location
  document.getElementById('btn-location').addEventListener('click', goToMyLocation);

  // Center map
  document.getElementById('btn-center').addEventListener('click', () => {
    if (AppState.mapOverlay) {
      AppState.map.fitBounds(AppState.mapOverlay.getBounds());
    }
  });

  // Add marker toggle
  document.getElementById('btn-add-marker').addEventListener('click', () => {
    AppState.isAddMarkerMode = !AppState.isAddMarkerMode;
    document.getElementById('btn-add-marker').classList.toggle('active', AppState.isAddMarkerMode);
    showToast(
      AppState.isAddMarkerMode ? 'Toca el mapa para colocar un marcador' : 'Modo marcador desactivado',
      'info'
    );
  });

  // Marker modal
  document.getElementById('btn-save-marker').addEventListener('click', saveMarker);
  document.getElementById('btn-cancel-marker').addEventListener('click', closeMarkerModal);
  document.getElementById('marker-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveMarker();
    if (e.key === 'Escape') closeMarkerModal();
  });

  // Category selector
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.selectedCategory = btn.dataset.color;
      updateCategorySelector();
    });
  });

  // Marker detail modal
  document.getElementById('btn-close-detail').addEventListener('click', closeMarkerDetail);
  document.getElementById('btn-edit-marker').addEventListener('click', editCurrentMarker);
  document.getElementById('btn-delete-marker').addEventListener('click', deleteCurrentMarker);

  // Export
  document.getElementById('btn-export').addEventListener('click', exportToCSV);

  // Markers panel
  document.getElementById('btn-markers-panel').addEventListener('click', openMarkersPanel);
  document.getElementById('btn-close-panel').addEventListener('click', closeMarkersPanel);
  document.getElementById('btn-export-panel').addEventListener('click', exportToCSV);
  document.getElementById('marker-search').addEventListener('input', (e) => {
    renderMarkersList(e.target.value);
  });

  // Delete map modal
  document.getElementById('btn-confirm-delete').addEventListener('click', confirmDeleteMap);
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    pendingDeleteMapId = null;
    document.getElementById('delete-map-modal').classList.add('hidden');
  });

  // Georef modal
  document.getElementById('btn-apply-georef').addEventListener('click', applyGeoref);
  document.getElementById('btn-cancel-georef').addEventListener('click', closeGeorefModal);

  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        if (modal.id === 'marker-modal') {
          AppState.isAddMarkerMode = false;
          document.getElementById('btn-add-marker').classList.remove('active');
        }
        if (modal.id === 'georef-modal') {
          closeGeorefModal();
        }
      }
    });
  });

  // Online status
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

// ============================================
// APP INITIALIZATION
// ============================================

async function initApp() {
  loadThemePreference();
  updateOnlineStatus();
  initEventListeners();
  await loadMapsList();
  updateMarkerCountBadge();
}

document.addEventListener('DOMContentLoaded', initApp);
