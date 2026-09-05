/**
 * app.js - MAPS GIS Main Application (LOCAL ONLY v1.7.0)
 * Visor de mapas y marcadores. Todo local, sin base de datos.
 */

// Transformacion PSAD56 -> WGS84 para Ecuador: EPSG:3990 "PSAD56 to WGS 84 (14)"
// (7-param Coordinate Frame: dx=-60.31 dy=245.935 dz=31.008 rx=-12.324" ry=-3.755" rz=7.37" s=0.447ppm).
// Las rotaciones van con signo invertido porque proj4js usa la convencion Position Vector.
// Es la misma transformacion que usan Avenza Maps y QGIS/PROJ para Ecuador continental.
// Antes se usaba EPSG:1201 DMA-mean (-288,175,-376), que desfasaba el overlay
// ~7.5 m al oeste y ~8.1 m al sur en la zona de trabajo (v2.10.3).
const PSAD56_UTM_17S = '+proj=utm +zone=17 +south +ellps=intl +towgs84=-60.31,245.935,31.008,12.324,3.755,-7.37,0.447 +units=m +no_defs';
const PSAD56_GEOGRAPHIC = '+proj=longlat +ellps=intl +towgs84=-60.31,245.935,31.008,12.324,3.755,-7.37,0.447 +no_defs';
const WGS84 = 'EPSG:4326';
proj4.defs('EPSG:24877', PSAD56_UTM_17S);
proj4.defs('PSAD56GEO', PSAD56_GEOGRAPHIC);

const KNOWN_CRS_MAP = {
  24877: 'EPSG:24877',
  32717: 'EPSG:32717',
  32617: 'EPSG:32617',
  4326: 'EPSG:4326',
  3857: 'EPSG:3857',
  4248: 'EPSG:4248',
  32718: 'EPSG:32718',
  32618: 'EPSG:32618'
};

const APP_VERSION = '2.10.10';

const MARKER_COLORS = {
  red:    { hex: '#ef4444', label: 'Rojo' },
  blue:   { hex: '#3b82f6', label: 'Azul' },
  green:  { hex: '#4caf50', label: 'Verde' },
  yellow: { hex: '#f59e0b', label: 'Amarillo' },
  orange: { hex: '#f97316', label: 'Naranja' },
  purple: { hex: '#a78bfa', label: 'Morado' }
};

const AppState = {
  map: null, mapOverlay: null, markersLayer: null, userLocationLayer: null,
  tracksLayer: null, activeTrackLayer: null,
  isAddMarkerMode: false, pendingMarkerLatLng: null, currentMapId: null,
  markerPlacementMode: null,
  currentMapType: 'tiff', mapTitle: '', editingMarkerId: null,
  selectedCategory: 'red', darkTiles: null, lightTiles: null,
  pendingPDF: null, pendingPhotos: [], previewPhotoIndex: -1,
  currentMarkerMode: localStorage.getItem('maps_gis_marker_mode') || 'qc',
  lsmSelectedCategory: 'red', gotoMarkerType: 'qc', pendingMarkerType: 'qc',
  isMeasurementMode: false,
  measurementType: 'distance',
  measurementLayer: null,
  measurementLatLngs: [],
  measurementUtmPoints: [],
  measurementMarkers: [],
  measurementLine: null,
  measurementPolygon: null,
  measurementRubberLine: null,
  measurementFinished: false,
  measurementIsDragging: false,
  measurementPreviewText: '',
  // Tracking / recorridos
  isTracking: false,
  isTrackPaused: false,
  currentTrack: null,
  trackWatchId: null,
  trackLastPoint: null,
  trackConfig: { minDistance: 5, minAccuracy: 50 },
  // Altitud GPS actual (para panel N/E/Z y marcadores)
  currentAltitude: null,
  // Seguimiento continuo de ubicacion
  locationWatchId: null,
  currentLocation: null,
  smoothedLocation: null,
  locationAccuracy: null,
  isFollowingLocation: false,
  // PDF actual cacheado y capas (OCG)
  pdfDoc: null,
  pdfDocMapId: null,
  pdfGeoref: null,
  pdfLayersConfig: null,
  pdfLayerGroups: [],
  pdfLayerRenderTimer: null
};

// ============================================
// MARKER MANAGER (LocalStorage)
// ============================================
const MarkerManager = {
  STORAGE_KEY: 'maps_gis_markers_v3',
  _cache: null,
  getAll() {
    if (this._cache !== null) return this._cache;
    try {
      const data = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
      if (!Array.isArray(data)) { this._cache = []; return this._cache; }
      this._cache = data.map(m => ({ ...m, markerType: m.markerType || 'qc' }));
      return this._cache;
    } catch { this._cache = []; return this._cache; }
  },
  saveAll(markers) { this._cache = markers; localStorage.setItem(this.STORAGE_KEY, JSON.stringify(markers)); },
  createQC(name, description, lat, lng, color, photos, altura) {
    const markers = this.getAll();
    const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
    const marker = {
      id: 'm_' + Date.now(), markerType: 'qc', name: name.trim(), description: description.trim(),
      lat, lng, norte: Math.round(north), este: Math.round(east),
      color: color || 'red', photos: photos || [],
      deviceId: DeviceManager.getId(),
      userName: DeviceManager.getName(),
      pendingUpload: true,
      syncedAt: null,
      createdAt: new Date().toISOString()
    };
    if (altura !== null && altura !== undefined && !isNaN(altura)) {
      marker.altura = Math.round(altura);
    }
    markers.push(marker); this.saveAll(markers); return marker;
  },
  createLSM(lat, lng, color, photos, lsmData, altura) {
    const markers = this.getAll();
    const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
    const marker = {
      id: 'm_' + Date.now(), markerType: 'lsm', name: (lsmData.nombreMuestra || '').trim(),
      lat, lng, norte: Math.round(north), este: Math.round(east),
      color: color || 'red', photos: photos || [], lsmData: lsmData,
      deviceId: DeviceManager.getId(),
      userName: DeviceManager.getName(),
      pendingUpload: true,
      syncedAt: null,
      createdAt: new Date().toISOString()
    };
    if (altura !== null && altura !== undefined && !isNaN(altura)) {
      marker.altura = Math.round(altura);
    }
    markers.push(marker); this.saveAll(markers); return marker;
  },
  update(id, updates) {
    const markers = this.getAll();
    const idx = markers.findIndex(m => m.id === id);
    if (idx === -1) return null;
    markers[idx] = { ...markers[idx], ...updates };
    this.saveAll(markers);
    return markers[idx];
  },
  remove(id) { this.saveAll(this.getAll().filter(m => m.id !== id)); },
  getById(id) { return this.getAll().find(m => m.id === id) || null; },
  getCount() { return this.getAll().length; }
};

// ============================================
// LAYER MANAGER (Capas diarias, LocalStorage)
// ============================================
const LayerManager = {
  STORAGE_KEY: 'maps_gis_hidden_layers',
  getHidden() {
    try {
      const data = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },
  isActive(day) { return !this.getHidden().includes(day); },
  setActive(day, active) {
    let hidden = this.getHidden();
    if (active) hidden = hidden.filter(d => d !== day);
    else if (!hidden.includes(day)) hidden.push(day);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(hidden));
  },
  toggle(day) { this.setActive(day, !this.isActive(day)); }
};

// Devuelve la capa diaria (YYYY-MM-DD local) de un marcador segun su fecha de creacion
function getMarkerDayLayer(marker) {
  const d = marker.createdAt ? new Date(marker.createdAt) : new Date();
  return getLocalDateString(d);
}

// Nombre por defecto automatico: correlativo por dia y tipo (QC-01, LSM-01, ...)
function getDefaultMarkerName(type) {
  const today = getLocalDateString(new Date());
  const prefix = type === 'lsm' ? 'LSM' : 'QC';
  const count = MarkerManager.getAll().filter(m =>
    (m.markerType || 'qc') === type && getMarkerDayLayer(m) === today
  ).length;
  return prefix + '-' + String(count + 1).padStart(2, '0');
}

// ============================================
// TRACK MANAGER (IndexedDB)
// ============================================
const TrackManager = {
  async getAll() {
    try {
      return await MapStorage.getAllTracks();
    } catch (e) {
      console.error('[TrackManager] Error al obtener recorridos:', e);
      return [];
    }
  },
  async save(track) {
    try {
      return await MapStorage.saveTrack(track);
    } catch (e) {
      console.error('[TrackManager] Error al guardar recorrido:', e);
      throw e;
    }
  },
  async delete(id) {
    try {
      await MapStorage.deleteTrack(id);
    } catch (e) {
      console.error('[TrackManager] Error al eliminar recorrido:', e);
      throw e;
    }
  },
  async getById(id) {
    try {
      return await MapStorage.getTrack(id);
    } catch (e) {
      console.error('[TrackManager] Error al obtener recorrido:', e);
      return null;
    }
  }
};

// ============================================
// LSM USER MANAGER
// ============================================
const LSM_USER_KEY = 'maps_gis_lsm_user';
const LSM_PASS = '354';
const LSMUserManager = {
  get() { try { return JSON.parse(localStorage.getItem(LSM_USER_KEY)) || null; } catch { return null; } },
  set(nickname) { localStorage.setItem(LSM_USER_KEY, JSON.stringify({ nickname, loggedInAt: Date.now() })); },
  clear() { localStorage.removeItem(LSM_USER_KEY); },
  isLoggedIn() { return !!this.get(); },
  getNickname() { const u = this.get(); return u ? u.nickname : null; },
  validate(nickname, password) { return nickname && nickname.trim().length > 0 && password === LSM_PASS; }
};

// ============================================
// DEVICE MANAGER (Registro unico del dispositivo)
// ============================================
const DEVICE_NAME_KEY = 'maps_gis_device_name';
const DEVICE_ID_KEY = 'maps_gis_device_id';
const DeviceManager = {
  getName() { return localStorage.getItem(DEVICE_NAME_KEY) || ''; },
  getId() { return localStorage.getItem(DEVICE_ID_KEY) || ''; },
  isRegistered() { return !!this.getName() && !!this.getId(); },
  register(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    localStorage.setItem(DEVICE_NAME_KEY, trimmed);
    if (!this.getId()) {
      localStorage.setItem(DEVICE_ID_KEY, 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
    }
    return true;
  }
};

// ============================================
// CONFIG MANAGER (LocalStorage only)
// ============================================
const CONFIG_KEY = 'maps_gis_config_v2';
const CONFIG_KEYS = [
  'tipo_material', 'localizacion',
  'fuente', 'ensayos'
];

let DEFAULT_CONFIG = {
  tipo_material: ['-','Zona 1 - Relleno','Zona 2 - Filtro Fino','Zona 3 - Filtro Grueso','Zona 6 - Drenante','Fundacion','Zona 1 Seleccionado - Relleno','Relaves','Arcilla','Zona 1 - Zona 6'],
  localizacion: ['-','P 980-S3','P 965-S2','P 950-S2','P 925-S2','P 920-S2','P 905-S2','P 895-S1','P 890-S1','P 865-S3','P 835-S3','P 833-S3','P 805-S3','P 795-S3','Dren Basal','Dren D-8B','Dren D-11','Dren D-08','Dren Inclinado','Banco de Tajo de Mina','Dren-D-8B'],
  fuente: ['-','Tajo de Mina','Proveedores','Fundacion','Escombrera','Relavera'],
  ensayos: ['-','HUM','GEP','GTM','GFI','GHD','ELA','EDL','COM','ABF','ABG','ICP','SLF','PRA','TIS','VDC','DCP','DCA','PMF','PET','CLS','PPF','PPR','DPS','DMI','DMA','GEG','CUS','TCU','TCD','TUU','CUR','TXR','RTI','PGF','ABA','DNU','LEO','CFR','CST','GTA','CMO','COS']
};

const ConfigManager = {
  getLocal() {
    try {
      const stored = JSON.parse(localStorage.getItem(CONFIG_KEY));
      if (stored && Object.keys(stored).length > 0) return stored;
    } catch {}
    return { ...DEFAULT_CONFIG };
  },
  saveLocal(config) { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); },
  getValues(key) {
    const cfg = this.getLocal();
    return Array.isArray(cfg[key]) ? cfg[key] : (DEFAULT_CONFIG[key] || []);
  },
  addValue(key, value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return false;
    const cfg = this.getLocal();
    if (!Array.isArray(cfg[key])) cfg[key] = [];
    if (cfg[key].includes(trimmed)) return false;
    cfg[key].push(trimmed);
    this.saveLocal(cfg);
    return true;
  },
  removeValue(key, value) {
    const cfg = this.getLocal();
    if (!Array.isArray(cfg[key])) return false;
    const before = cfg[key].length;
    cfg[key] = cfg[key].filter(v => v !== value);
    if (before === cfg[key].length) return false;
    this.saveLocal(cfg);
    return true;
  }
};

// ============================================
// AUTO-LEARN LSM CONFIG
// Automatically adds used LSM field values to config lists
// so they appear in dropdowns for future entries.
// ============================================
function autoLearnLSMConfig(lsmData) {
  const fieldMap = {
    tipoMaterial: 'tipo_material',
    localizacion: 'localizacion',
    fuente: 'fuente'
  };

  // Learn text fields
  Object.entries(fieldMap).forEach(([dataKey, configKey]) => {
    const val = (lsmData[dataKey] || '').trim();
    if (val) ConfigManager.addValue(configKey, val);
  });

  // Learn ensayos (test codes)
  const ensayos = lsmData.ensayos || [];
  if (Array.isArray(ensayos)) {
    ensayos.forEach(code => {
      const val = (code || '').trim();
      if (val) ConfigManager.addValue('ensayos', val);
    });
  }
}

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
function parseLocalDate(isoString) {
  // Los strings solo-fecha "YYYY-MM-DD" se parsean como medianoche UTC por
  // defecto, lo que en zonas UTC negativas (Ecuador UTC-5) muestra el dia
  // anterior. Parsearlos siempre como fecha local.
  if (typeof isoString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoString)) {
    const p = isoString.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  return new Date(isoString);
}
function formatDate(isoString) {
  const d = parseLocalDate(isoString);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(isoString) {
  const d = parseLocalDate(isoString);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function getLocalDateString(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function forceAppUpdate() {
  const pending = MarkerManager.getAll().filter(m => m.pendingUpload).length;
  let msg = 'Actualizar aplicacion. Los marcadores guardados se mantendran.';
  if (pending > 0) msg += '\nTienes ' + pending + ' marcador' + (pending === 1 ? '' : 'es') + ' sin subir. Se mantendran locales.';
  msg += '\n\nContinuar?';
  if (!confirm(msg)) return;

  showToast('Buscando actualizacion...', 'info');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (reg) {
        try {
          await reg.update();
        } catch (e) { console.warn('[forceAppUpdate] reg.update failed:', e); }
      }
      const keys = await caches.keys();
      for (const key of keys) {
        if (key.startsWith('maps-gis-')) await caches.delete(key);
      }
      location.reload(true);
    }).catch((err) => {
      console.error('[forceAppUpdate]', err);
      location.reload(true);
    });
  } else {
    location.reload(true);
  }
}

// ============================================
// GEOREFERENCE CONVERSION HELPERS
// ============================================

/**
 * Convierte una esquina desde su CRS/datum de origen a UTM PSAD56 17S.
 * corner = [x, y] donde x=lon/e y y=lat/n segun sourceCrs.
 * sourceDatum: 'WGS84', 'PSAD56' o 'auto'.
 */
function convertCornerToUTMPSAD56(corner, sourceCrs, sourceDatum) {
  const [x, y] = corner;
  if (sourceCrs === 'EPSG:4326') {
    if (sourceDatum === 'PSAD56') {
      const [lng, lat] = proj4('PSAD56GEO', 'EPSG:4326', [x, y]);
      return proj4('EPSG:4326', 'EPSG:24877', [lng, lat]);
    }
    return proj4('EPSG:4326', 'EPSG:24877', [x, y]);
  }
  if (sourceCrs === 'PSAD56GEO') {
    const [lng, lat] = proj4('PSAD56GEO', 'EPSG:4326', [x, y]);
    return proj4('EPSG:4326', 'EPSG:24877', [lng, lat]);
  }
  if (sourceCrs === 'EPSG:24877') {
    if (Math.abs(x) < 180 && Math.abs(y) < 90) {
      if (sourceDatum === 'WGS84') {
        return proj4('EPSG:4326', 'EPSG:24877', [x, y]);
      }
      const [lng, lat] = proj4('PSAD56GEO', 'EPSG:4326', [x, y]);
      return proj4('EPSG:4326', 'EPSG:24877', [lng, lat]);
    }
    return [x, y];
  }
  return proj4(sourceCrs, 'EPSG:24877', [x, y]);
}

/**
 * Determina el datum mas probable para coordenadas geograficas de un GeoPDF.
 */
function inferSourceDatum(sourceCrs, geoData) {
  if (sourceCrs === 'PSAD56GEO' || sourceCrs === 'EPSG:24877') return 'PSAD56';
  if (sourceCrs !== 'EPSG:4326') return 'auto';
  // Para EPSG:4326, miramos si el contexto del PDF menciona PSAD56.
  const ctx = (geoData && geoData._vpContext) || '';
  if (/PSAD56/i.test(ctx)) return 'PSAD56';
  return 'WGS84';
}

// ============================================
// IMAGE COMPRESSION & PHOTO HANDLING
// ============================================
function compressImage(file, maxWidth = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error('Error')); }, 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('Error'));
    reader.onerror = () => reject(new Error('Error'));
    reader.readAsDataURL(file);
  });
}

function decimalToExifDms(value) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 6000);
  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 100]
  ];
}

function injectGpsExif(dataUrl, lat, lng) {
  if (typeof piexif === 'undefined' || lat == null || lng == null) return dataUrl;
  try {
    const exifObj = piexif.load(dataUrl);
    exifObj.GPS = exifObj.GPS || {};
    exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';
    exifObj.GPS[piexif.GPSIFD.GPSLatitude] = decimalToExifDms(lat);
    exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? 'E' : 'W';
    exifObj.GPS[piexif.GPSIFD.GPSLongitude] = decimalToExifDms(lng);
    return piexif.insert(piexif.dump(exifObj), dataUrl);
  } catch (e) {
    console.warn('[injectGpsExif] No se pudo inyectar GPS:', e);
    return dataUrl;
  }
}

async function compressImageWithGps(file, maxWidth, quality, lat, lng) {
  const compressed = await compressImage(file, maxWidth, quality);
  const dataUrl = await blobToDataURL(compressed);
  const withGps = injectGpsExif(dataUrl, lat, lng);
  return dataURLtoBlob(withGps);
}

async function stampImage(imageFile, markerData) {
  const { nombreMuestra, localizacion, fecha, lat, lng } = markerData || {};
  const MAX_WIDTH = 1600;
  const stampConfig = getStampConfig();

  let originalExifBytes = null;
  try {
    if (typeof piexif !== 'undefined') {
      const originalDataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(imageFile);
      });
      originalExifBytes = piexif.load(originalDataUrl);
    }
  } catch (e) {
    console.warn('[stampImage] No se pudo leer EXIF original:', e);
  }

  const photoDataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(imageFile);
  });

  // Cargar logo de forma resiliente: si falla (ej. offline y no cacheado), continuar sin logo
  let logo = null;
  try {
    const logoDataUrl = await loadLogoDataUrl();
    logo = await loadImage(logoDataUrl);
  } catch (e) {
    console.warn('[stampImage] Logo no disponible, continuando sin logo:', e);
  }

  const img = await loadImage(photoDataUrl);

  let width = img.width;
  let height = img.height;
  if (width > MAX_WIDTH) {
    height = Math.round((height * MAX_WIDTH) / width);
    width = MAX_WIDTH;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0, width, height);

  // Logo en margen derecho, configurable (solo si cargo)
  if (logo) {
    const logoHeight = stampConfig.logoSize;
    const logoWidth = (logo.width / logo.height) * logoHeight;
    const logoX = width - logoWidth - 10;
    const logoY = height - logoHeight - 10;
    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
  }

  // Texto en margen izquierdo, de abajo hacia arriba
  const lines = [
    fecha || '',
    localizacion || '',
    nombreMuestra || ''
  ].filter(Boolean);

  const fontSize = Math.max(12, Math.round(stampConfig.fontSize * (width / 1600)));
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';

  const lineHeight = fontSize * 1.3;
  const textX = 10;
  const bottomMargin = 10;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const y = height - bottomMargin - (i * lineHeight);

    // Contorno negro
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.max(2, fontSize * 0.15);
    ctx.strokeText(text, textX, y);

    // Relleno blanco
    ctx.fillStyle = 'white';
    ctx.fillText(text, textX, y);
  }

  const stampedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  // Re-inyectar EXIF original + GPS en la imagen estampada
  let finalDataUrl = stampedDataUrl;
  if (typeof piexif !== 'undefined') {
    try {
      const exifObj = originalExifBytes || {};
      exifObj.GPS = exifObj.GPS || {};
      exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S';
      exifObj.GPS[piexif.GPSIFD.GPSLatitude] = decimalToExifDms(lat);
      exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? 'E' : 'W';
      exifObj.GPS[piexif.GPSIFD.GPSLongitude] = decimalToExifDms(lng);
      finalDataUrl = piexif.insert(piexif.dump(exifObj), stampedDataUrl);
    } catch (e) {
      console.warn('[stampImage] No se pudo inyectar EXIF/GPS:', e);
    }
  }

  const stampedBlob = dataURLtoBlob(finalDataUrl);

  return {
    stampedBlob,
    originalBlob: imageFile
  };
}

function loadLogoDataUrl() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('No se pudo cargar el logo'));
    img.src = 'assets/logo_lab_chino_PNG.png?v=' + APP_VERSION;
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

function dataURLtoBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
async function handlePhotoCapture(file, latLng) {
  if (!file) return;
  try {
    showToast('Procesando foto...', 'info');
    const isLsm = AppState.pendingMarkerType === 'lsm';
    let compressedBlob, dataUrl, originalBlob;

    const coords = latLng || AppState.pendingMarkerLatLng;
    const lat = coords?.lat ?? null;
    const lng = coords?.lng ?? null;

    if (isLsm) {
      const markerData = {
        nombreMuestra: document.getElementById('lsm-nombre-muestra')?.value?.trim() || '',
        localizacion: document.getElementById('lsm-localizacion')?.value?.trim() || '',
        fecha: getLocalDateString(),
        lat,
        lng
      };
      const stamped = await stampImage(file, markerData);
      compressedBlob = stamped.stampedBlob;
      originalBlob = stamped.originalBlob;
    } else {
      compressedBlob = await compressImageWithGps(file, 1600, 0.90, lat, lng);
      originalBlob = file;
    }

    dataUrl = await blobToDataURL(compressedBlob);
    if (AppState.pendingPhotos.length >= 2) { showToast('Max 2 fotos', 'error'); return; }
    AppState.pendingPhotos.push({ blob: compressedBlob, dataUrl: dataUrl, originalBlob: originalBlob });
    renderPhotoGrid();
    showToast('Foto agregada', 'success');
    openPhotoPreviewByIndex(AppState.pendingPhotos.length - 1);
  } catch (error) {
    console.error('[handlePhotoCapture] Error al procesar foto:', error);
    showToast('Error al procesar foto: ' + (error?.message || 'desconocido'), 'error');
  }
}
function getPhotoGridId() { return AppState.pendingMarkerType === 'lsm' ? 'lsm-photo-grid' : 'photo-grid'; }
function getAddPhotoBtnId() { return AppState.pendingMarkerType === 'lsm' ? 'btn-lsm-add-photo' : 'btn-add-photo'; }
function getPhotoInputId() { return AppState.pendingMarkerType === 'lsm' ? 'lsm-photo-input' : 'photo-input'; }
function renderPhotoGrid() {
  const grid = document.getElementById(getPhotoGridId());
  if (!grid) return;
  grid.innerHTML = AppState.pendingPhotos.map((photo, index) => {
    return '<div class="photo-thumb" data-index="' + index + '" role="button" tabindex="0"><img src="' + photo.dataUrl + '" alt="Foto"><button class="photo-remove" data-index="' + index + '" aria-label="Eliminar foto">&times;</button></div>';
  }).join('');
  grid.querySelectorAll('.photo-remove').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); AppState.pendingPhotos.splice(parseInt(btn.dataset.index), 1); renderPhotoGrid(); });
  });
  grid.querySelectorAll('.photo-thumb').forEach(thumb => {
    thumb.addEventListener('click', () => openPhotoPreviewByIndex(parseInt(thumb.dataset.index)));
    thumb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') openPhotoPreviewByIndex(parseInt(thumb.dataset.index)); });
  });
  const btnAddPhoto = document.getElementById(getAddPhotoBtnId());
  if (btnAddPhoto) btnAddPhoto.style.display = AppState.pendingPhotos.length >= 2 ? 'none' : 'flex';
}

// ============================================
// PHOTO PREVIEW MODAL
// ============================================
function openPhotoPreviewByIndex(index) {
  const photo = AppState.pendingPhotos[index];
  if (!photo) return;
  AppState.previewPhotoIndex = index;
  const title = AppState.pendingMarkerType === 'lsm' ? 'Vista previa LSM' : 'Vista previa';
  openPhotoPreview(photo.dataUrl, title);
}

function openPhotoPreview(dataUrl, title) {
  const img = document.getElementById('photo-preview-img');
  const titleEl = document.getElementById('photo-preview-title');
  img.src = dataUrl;
  titleEl.textContent = title || 'Vista previa';
  document.getElementById('photo-preview-modal').classList.remove('hidden');
}

function closePhotoPreview() {
  document.getElementById('photo-preview-modal').classList.add('hidden');
  document.getElementById('photo-preview-img').src = '';
  AppState.previewPhotoIndex = -1;
}

function deletePendingPhotoFromPreview() {
  const index = AppState.previewPhotoIndex;
  if (index >= 0 && index < AppState.pendingPhotos.length) {
    AppState.pendingPhotos.splice(index, 1);
    renderPhotoGrid();
    closePhotoPreview();
    showToast('Foto eliminada', 'info');
  }
}

function retakePhoto() {
  const index = AppState.previewPhotoIndex;
  if (index >= 0 && index < AppState.pendingPhotos.length) {
    AppState.pendingPhotos.splice(index, 1);
    renderPhotoGrid();
  }
  closePhotoPreview();
  if (AppState.pendingPhotos.length >= 2) {
    showToast('Max 2 fotos', 'error');
    return;
  }
  const inputId = getPhotoInputId();
  const input = document.getElementById(inputId);
  if (input) input.click();
}
function clearPendingPhotos() { AppState.pendingPhotos = []; renderPhotoGrid(); }

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
  if (AppState.map) { AppState.map.invalidateSize(); return; }
  AppState.map = L.map('map', {
    center: [-0.1807, -78.4678],
    zoom: 13,
    zoomControl: false,
    maxZoom: 22,
    // Optimizaciones de fluidez para rotación + zoom en móvil
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    bounceAtZoomLimits: false,
    trackContainerMutation: false,
    rotate: true,
    touchRotate: true,
    bearing: 0,
    rotateControl: false
  });
  // El plugin leaflet-rotate añade su propio handler unificado (touchGestures).
  // Deshabilitamos touchZoom nativo de Leaflet para evitar que compita y cause snap final.
  if (AppState.map.touchZoom) AppState.map.touchZoom.disable();
  L.control.zoom({ position: 'topleft' }).addTo(AppState.map);
  AppState.darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 22, maxNativeZoom: 19 });
  AppState.lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 22, maxNativeZoom: 19 });
  AppState.darkTiles.addTo(AppState.map);
  AppState.markersLayer = L.layerGroup().addTo(AppState.map);
  AppState.tracksLayer = L.layerGroup().addTo(AppState.map);
  AppState.measurementLayer = L.layerGroup().addTo(AppState.map);
  // El usuario al interactuar (arrastrar, zoom, tap) desactiva el re-centrado
  // automatico del GPS; el punto azul sigue actualizandose en segundo plano.
  AppState.map.on('dragstart', stopFollowLocation);
  AppState.map.on('zoomstart', stopFollowLocation);
  AppState.map.on('click', stopFollowLocation);
  AppState.map.on('click', (e) => {
    if (AppState.isMeasurementMode && !AppState.measurementFinished && !AppState.measurementIsDragging) {
      addMeasurementPoint(e.latlng);
      return;
    }
    if (AppState.isAddMarkerMode) {
      placeMarkerAt(e.latlng);
    }
  });
  AppState.map.on('dblclick', (e) => {
    if (AppState.isMeasurementMode && !AppState.measurementFinished && AppState.measurementLatLngs.length >= 2) {
      finishMeasurement();
    }
  });
  AppState.map.on('mousemove', (e) => {
    updateCoordsDisplay(e.latlng, 'pointer');
    if (AppState.isMeasurementMode && !AppState.measurementFinished && AppState.measurementLatLngs.length > 0) {
      updateMeasurementRubberLine(e.latlng);
    }
  });
  AppState.map.on('move', () => {
    if (AppState.isMeasurementMode && !AppState.measurementFinished && AppState.measurementLatLngs.length > 0 && isTouchDevice()) {
      updateMeasurementRubberLine(AppState.map.getCenter());
    }
    updateCoordsFromCrosshair();
  });
  // Con la mira activa el panel de coordenadas sigue al centro del mapa en vivo.
  AppState.map.on('movestart zoomstart', markCoordsMoving);
  AppState.map.on('moveend zoomend', () => {
    updateCoordsFromCrosshair();
    scheduleCoordsMovingOff();
  });
  initMapVisualRotation();
}

// ============================================
// MAP VISUAL ROTATION (leaflet-rotate plugin)
// Rota TODO el mapa con gestos de dos dedos, Shift+scroll o arrastre del control.
// No modifica coordenadas geográficas ni la georreferenciación de los overlays.
// ============================================
function getMapVisualRotation() {
  if (!AppState.map || typeof AppState.map.getBearing !== 'function') return 0;
  return AppState.map.getBearing();
}
function setMapVisualRotation(angle) {
  if (!AppState.map || typeof AppState.map.setBearing !== 'function') return;
  AppState.map.setBearing(angle);
}
function resetMapVisualRotation() {
  setMapVisualRotation(0);
}
function updateRotationIndicator(angle) {
  const indicator = document.getElementById('rotation-indicator');
  if (indicator) {
    indicator.textContent = Math.round(angle) + '°';
    indicator.classList.toggle('hidden', Math.abs(angle) < 0.5);
  }
}
function initMapVisualRotation() {
  if (!AppState.map || typeof AppState.map.setBearing !== 'function') return;

  // Escuchar cambios de rotación para actualizar el indicador.
  // Usamos requestAnimationFrame para no forzar reflujo en cada evento rotate.
  let pendingIndicatorFrame = null;
  AppState.map.on('rotate', () => {
    if (pendingIndicatorFrame) return;
    pendingIndicatorFrame = requestAnimationFrame(() => {
      pendingIndicatorFrame = null;
      updateRotationIndicator(getMapVisualRotation());
    });
  });

  // Botón para volver al norte
  document.getElementById('btn-reset-rotation')?.addEventListener('click', resetMapVisualRotation);
}

// ============================================
// PANEL DE COORDENADAS
// Fuentes posibles: 'gps' (fix suavizado), 'pointer' (mousemove en desktop) y
// 'crosshair' (centro del mapa mientras la mira esta activa). La mira tiene
// prioridad: mientras apunta, ni el GPS ni el puntero pisan su lectura.
// ============================================

// La mira "manda" solo cuando el usuario la esta usando para apuntar:
// colocacion de marcador por crosshair siempre, y medicion en tactil (en
// desktop el mousemove ya da feedback en vivo). Mismo criterio que el rubber
// band de medicion.
function isCrosshairActive() {
  return AppState.markerPlacementMode === 'crosshair'
      || (AppState.isMeasurementMode && !AppState.measurementFinished && isTouchDevice());
}

// Escribe solo si cambio y dispara el micro-destello reiniciando la animacion.
function setCoordText(el, text) {
  if (!el || el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('tick');
  // Forzar reflujo para reiniciar la animacion aunque el cambio sea seguido.
  void el.offsetWidth;
  el.classList.add('tick');
}

function updateCoordsDisplay(latlng, source) {
  if (!latlng) return;
  source = source || 'gps';
  // La mira tiene prioridad mientras esta activa.
  if (source !== 'crosshair' && isCrosshairActive()) return;
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  setCoordText(document.getElementById('coord-norte'), 'N: ' + Math.round(north));
  setCoordText(document.getElementById('coord-este'), 'E: ' + Math.round(east));
  setCoordText(document.getElementById('coord-lat'), 'Lat: ' + latlng.lat.toFixed(6));
  setCoordText(document.getElementById('coord-lng'), 'Lon: ' + latlng.lng.toFixed(6));
  // Z y precision siguen siendo del dispositivo, no de la mira.
  setCoordText(document.getElementById('coord-altura'),
    'Z: ' + (AppState.currentAltitude != null ? Math.round(AppState.currentAltitude) + ' m' : '---'));
  setCoordText(document.getElementById('coord-accuracy'),
    'Prec: ' + (AppState.locationAccuracy != null ? '±' + Math.round(AppState.locationAccuracy) + ' m' : '---'));
  const isCrosshair = source === 'crosshair';
  const srcEl = document.getElementById('coord-source');
  if (srcEl) srcEl.textContent = isCrosshair ? 'MIRA' : 'GPS';
  document.getElementById('coords-panel')?.classList.toggle('is-live', isCrosshair);
}

// Actualizacion en vivo del centro del mapa, throttleada a un frame (mismo
// patron que el indicador de rotacion) para no recalcular proj4 por evento.
let pendingCoordsFrame = null;
function updateCoordsFromCrosshair() {
  if (!AppState.map || !isCrosshairActive()) return;
  if (pendingCoordsFrame) return;
  pendingCoordsFrame = requestAnimationFrame(() => {
    pendingCoordsFrame = null;
    if (!AppState.map || !isCrosshairActive()) return;
    updateCoordsDisplay(AppState.map.getCenter(), 'crosshair');
  });
}

// Resalte "en movimiento" del panel mientras se desplaza el mapa con la mira.
let coordsMovingTimer = null;
function markCoordsMoving() {
  if (!isCrosshairActive()) return;
  if (coordsMovingTimer) { clearTimeout(coordsMovingTimer); coordsMovingTimer = null; }
  document.getElementById('coords-panel')?.classList.add('is-moving');
}
function scheduleCoordsMovingOff() {
  if (coordsMovingTimer) clearTimeout(coordsMovingTimer);
  coordsMovingTimer = setTimeout(() => {
    coordsMovingTimer = null;
    document.getElementById('coords-panel')?.classList.remove('is-moving');
  }, 250);
}

// Devuelve el panel al modo GPS al salir de un modo de mira.
function resetCoordsToGps() {
  if (coordsMovingTimer) { clearTimeout(coordsMovingTimer); coordsMovingTimer = null; }
  const panel = document.getElementById('coords-panel');
  if (panel) panel.classList.remove('is-live', 'is-moving');
  const srcEl = document.getElementById('coord-source');
  if (srcEl) srcEl.textContent = 'GPS';
  if (AppState.smoothedLocation) updateCoordsDisplay(AppState.smoothedLocation, 'gps');
}

// ============================================
// MEASUREMENT TOOLS
// ============================================
function toggleMeasurementMode() {
  AppState.isMeasurementMode = !AppState.isMeasurementMode;
  const btn = document.getElementById('btn-measure');
  const panel = document.getElementById('measurement-panel');
  const crosshair = document.getElementById('measurement-crosshair');
  btn.classList.toggle('active', AppState.isMeasurementMode);
  panel.classList.toggle('hidden', !AppState.isMeasurementMode);
  if (crosshair) crosshair.classList.toggle('hidden', !AppState.isMeasurementMode);
  if (AppState.isMeasurementMode) updateCoordsFromCrosshair();
  else resetCoordsToGps();
  if (AppState.isMeasurementMode) {
    if (AppState.isAddMarkerMode) {
      AppState.isAddMarkerMode = false;
      document.getElementById('btn-add-marker').classList.remove('active');
      exitMarkerPlacement();
      closeMarkerPlacementModal();
    }
    AppState.map.doubleClickZoom.disable();
    showToast('Modo medicion activo', 'info');
  } else {
    stopMeasurement();
    AppState.map.doubleClickZoom.enable();
    showToast('Modo medicion desactivado', 'info');
  }
}

function stopMeasurement() {
  clearMeasurement();
  AppState.isMeasurementMode = false;
  AppState.measurementFinished = false;
  document.getElementById('btn-measure').classList.remove('active');
  document.getElementById('measurement-panel').classList.add('hidden');
  if (AppState.map) AppState.map.doubleClickZoom.enable();
}

function setMeasurementType(type) {
  if (type !== 'distance' && type !== 'area') return;
  AppState.measurementType = type;
  document.querySelectorAll('.measurement-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  clearMeasurement();
  updateMeasurementPanel();
  renderMeasurementPointsList();
}

function createMeasurementVertexIcon() {
  return L.divIcon({
    className: 'measurement-vertex',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: '<div class="measurement-vertex-dot"></div>'
  });
}

function addMeasurementPoint(latlng) {
  if (!latlng || AppState.measurementFinished) return;
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  const index = AppState.measurementLatLngs.length;
  AppState.measurementLatLngs.push(latlng);
  AppState.measurementUtmPoints.push({ east, north });
  const marker = L.marker(latlng, {
    icon: createMeasurementVertexIcon(),
    draggable: !AppState.measurementFinished,
    zIndexOffset: 1000
  }).addTo(AppState.measurementLayer);
  marker._measurementIndex = index;
  marker.on('dragstart', () => {
    AppState.measurementIsDragging = true;
    marker.getElement()?.classList.add('dragging');
  });
  marker.on('drag', (e) => {
    onMeasurementVertexDrag(marker._measurementIndex, e.latlng);
  });
  marker.on('dragend', () => {
    AppState.measurementIsDragging = false;
    marker.getElement()?.classList.remove('dragging');
    renderMeasurementPointsList();
  });
  AppState.measurementMarkers.push(marker);
  renderMeasurementGeometry();
  updateMeasurementPanel();
  renderMeasurementPointsList();
}

function onMeasurementVertexDrag(index, latlng) {
  if (index < 0 || index >= AppState.measurementLatLngs.length) return;
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  AppState.measurementLatLngs[index] = latlng;
  AppState.measurementUtmPoints[index] = { east, north };
  renderMeasurementGeometry();
  updateMeasurementPanel();
}

function removeMeasurementPoint(index) {
  if (index < 0 || index >= AppState.measurementLatLngs.length) return;
  AppState.measurementLatLngs.splice(index, 1);
  AppState.measurementUtmPoints.splice(index, 1);
  const marker = AppState.measurementMarkers.splice(index, 1)[0];
  if (marker && AppState.measurementLayer) AppState.measurementLayer.removeLayer(marker);
  AppState.measurementMarkers.forEach((m, i) => { m._measurementIndex = i; });
  AppState.measurementFinished = false;
  if (AppState.measurementLatLngs.length === 0 && AppState.measurementRubberLine && AppState.measurementLayer) {
    AppState.measurementLayer.removeLayer(AppState.measurementRubberLine);
    AppState.measurementRubberLine = null;
    AppState.measurementPreviewText = '';
  }
  renderMeasurementGeometry();
  updateMeasurementPanel();
  renderMeasurementPointsList();
}

function undoMeasurementPoint() {
  if (AppState.measurementLatLngs.length === 0) return;
  removeMeasurementPoint(AppState.measurementLatLngs.length - 1);
}

function renderMeasurementGeometry() {
  if (!AppState.measurementLayer) return;
  if (AppState.measurementLine) { AppState.measurementLayer.removeLayer(AppState.measurementLine); AppState.measurementLine = null; }
  if (AppState.measurementPolygon) { AppState.measurementLayer.removeLayer(AppState.measurementPolygon); AppState.measurementPolygon = null; }
  if (AppState.measurementLatLngs.length < 2) return;
  if (AppState.measurementType === 'distance') {
    AppState.measurementLine = L.polyline(AppState.measurementLatLngs, { className: 'measurement-line' }).addTo(AppState.measurementLayer);
  } else {
    AppState.measurementLine = L.polyline(AppState.measurementLatLngs, { className: 'measurement-line' }).addTo(AppState.measurementLayer);
    if (AppState.measurementLatLngs.length >= 3) {
      AppState.measurementPolygon = L.polygon(AppState.measurementLatLngs, { className: 'measurement-polygon' }).addTo(AppState.measurementLayer);
    }
  }
}

function updateMeasurementRubberLine(latlng) {
  if (!AppState.measurementLayer || AppState.measurementFinished || AppState.measurementLatLngs.length === 0 || !latlng) return;
  const last = AppState.measurementLatLngs[AppState.measurementLatLngs.length - 1];
  if (AppState.measurementRubberLine) {
    AppState.measurementRubberLine.setLatLngs([last, latlng]);
  } else {
    AppState.measurementRubberLine = L.polyline([last, latlng], { className: 'measurement-rubber-line' }).addTo(AppState.measurementLayer);
  }
  const [e1, n1] = proj4(WGS84, 'EPSG:24877', [last.lng, last.lat]);
  const [e2, n2] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  const dx = e2 - e1;
  const dy = n2 - n1;
  const segment = Math.sqrt(dx * dx + dy * dy);
  let preview = 'Vista previa: ' + formatDistance(segment);
  if (AppState.measurementType === 'area' && AppState.measurementLatLngs.length >= 2) {
    const previewPoints = AppState.measurementUtmPoints.concat({ east: e2, north: n2 });
    if (previewPoints.length >= 3) {
      preview += ' | Area preview: ' + formatArea(calculatePolygonArea(previewPoints));
    }
  }
  AppState.measurementPreviewText = preview;
  updateMeasurementPanel();
}

function clearMeasurement() {
  AppState.measurementLatLngs = [];
  AppState.measurementUtmPoints = [];
  AppState.measurementFinished = false;
  AppState.measurementPreviewText = '';
  if (AppState.measurementLayer) {
    AppState.measurementMarkers.forEach(m => AppState.measurementLayer.removeLayer(m));
    if (AppState.measurementLine) AppState.measurementLayer.removeLayer(AppState.measurementLine);
    if (AppState.measurementPolygon) AppState.measurementLayer.removeLayer(AppState.measurementPolygon);
    if (AppState.measurementRubberLine) AppState.measurementLayer.removeLayer(AppState.measurementRubberLine);
  }
  AppState.measurementMarkers = [];
  AppState.measurementLine = null;
  AppState.measurementPolygon = null;
  AppState.measurementRubberLine = null;
  updateMeasurementPanel();
  renderMeasurementPointsList();
}

function finishMeasurement() {
  if (AppState.measurementLatLngs.length < 2) return;
  AppState.measurementFinished = true;
  AppState.measurementMarkers.forEach(m => m.dragging && m.dragging.disable());
  if (AppState.measurementRubberLine && AppState.measurementLayer) {
    AppState.measurementLayer.removeLayer(AppState.measurementRubberLine);
    AppState.measurementRubberLine = null;
  }
  AppState.measurementPreviewText = '';
  updateMeasurementPanel(true);
  renderMeasurementPointsList();
  showToast('Medicion finalizada', 'success');
}

function calculateDistance(utmPoints) {
  let total = 0;
  for (let i = 1; i < utmPoints.length; i++) {
    const dx = utmPoints[i].east - utmPoints[i - 1].east;
    const dy = utmPoints[i].north - utmPoints[i - 1].north;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function calculatePolygonArea(utmPoints) {
  if (utmPoints.length < 3) return 0;
  let area = 0;
  const n = utmPoints.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += utmPoints[i].east * utmPoints[j].north;
    area -= utmPoints[j].east * utmPoints[i].north;
  }
  return Math.abs(area) / 2;
}

function calculatePolygonPerimeter(utmPoints) {
  if (utmPoints.length < 2) return 0;
  let total = 0;
  const n = utmPoints.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = utmPoints[j].east - utmPoints[i].east;
    const dy = utmPoints[j].north - utmPoints[i].north;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function formatDistance(meters) {
  if (meters < 1000) return meters.toFixed(1) + ' m';
  return (meters / 1000).toFixed(3) + ' km';
}

function formatArea(sqMeters) {
  if (sqMeters < 10000) return sqMeters.toFixed(1) + ' m²';
  if (sqMeters < 1000000) return (sqMeters / 10000).toFixed(3) + ' ha';
  return (sqMeters / 1000000).toFixed(4) + ' km²';
}

function updateMeasurementPanel(finished) {
  const valueEl = document.getElementById('measurement-value');
  const secondaryEl = document.getElementById('measurement-secondary');
  const finishBtn = document.getElementById('btn-measure-finish');
  const undoBtn = document.getElementById('btn-measure-undo');
  if (!valueEl) return;
  const points = AppState.measurementUtmPoints;
  if (undoBtn) undoBtn.disabled = points.length === 0 || AppState.measurementFinished;
  if (points.length === 0) {
    valueEl.textContent = AppState.measurementType === 'distance' ? '0 m' : '0 m²';
    secondaryEl.textContent = AppState.measurementPreviewText || '';
    if (finishBtn) finishBtn.disabled = true;
    return;
  }
  if (AppState.measurementType === 'distance') {
    const total = calculateDistance(points);
    valueEl.textContent = formatDistance(total);
    let sec = '';
    if (points.length >= 2) {
      const lastIdx = points.length - 1;
      const lastSegment = Math.sqrt(
        Math.pow(points[lastIdx].east - points[lastIdx - 1].east, 2) +
        Math.pow(points[lastIdx].north - points[lastIdx - 1].north, 2)
      );
      sec = 'Segmento actual: ' + formatDistance(lastSegment);
    }
    if (AppState.measurementPreviewText && !finished) {
      sec = AppState.measurementPreviewText + (sec ? ' | ' + sec : '');
    }
    secondaryEl.textContent = sec;
  } else {
    if (points.length < 3) {
      valueEl.textContent = '0 m²';
      secondaryEl.textContent = AppState.measurementPreviewText || 'Agrega al menos 3 puntos';
    } else {
      const area = calculatePolygonArea(points);
      const perimeter = calculatePolygonPerimeter(points);
      valueEl.textContent = formatArea(area);
      let sec = 'Perimetro: ' + formatDistance(perimeter);
      if (AppState.measurementPreviewText && !finished) {
        sec = AppState.measurementPreviewText + ' | ' + sec;
      }
      secondaryEl.textContent = sec;
    }
  }
  if (finishBtn) finishBtn.disabled = points.length < 2;
}

function renderMeasurementPointsList() {
  const listEl = document.getElementById('measurement-points-list');
  if (!listEl) return;
  if (AppState.measurementLatLngs.length === 0) {
    listEl.innerHTML = '';
    listEl.classList.add('hidden');
    return;
  }
  listEl.classList.remove('hidden');
  let html = '<div class="measurement-points-header">Puntos (' + AppState.measurementLatLngs.length + ')</div>';
  html += '<div class="measurement-points-items">';
  AppState.measurementLatLngs.forEach((latlng, i) => {
    const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
    html += '<div class="measurement-point-item">' +
      '<span class="measurement-point-label">P' + (i + 1) + '</span>' +
      '<span class="measurement-point-coords">E:' + Math.round(east) + ' N:' + Math.round(north) + '</span>';
    if (!AppState.measurementFinished) {
      html += '<button class="measurement-point-delete" data-index="' + i + '" title="Eliminar punto">&times;</button>';
    }
    html += '</div>';
  });
  html += '</div>';
  listEl.innerHTML = html;
  listEl.querySelectorAll('.measurement-point-delete').forEach(btn => {
    btn.addEventListener('click', () => removeMeasurementPoint(parseInt(btn.dataset.index, 10)));
  });
}

// ============================================
// GEO TIFF / PDF LOADING
// ============================================

function getGeoTiffCRS(image) {
  try {
    const metadata = image.getGDALMetadata();
    if (metadata) {
      const crsMatch = (metadata.PROJCS || metadata.GEOGCS || '').match(/EPSG[:\s]*(\d+)/i);
      if (crsMatch) return 'EPSG:' + crsMatch[1];
    }
  } catch (e) {}
  try {
    if (typeof image.geoKeys !== 'undefined') {
      const geoKeys = image.geoKeys;
      if (geoKeys.ProjectedCSTypeGeoKey) {
        const pcs = geoKeys.ProjectedCSTypeGeoKey;
        if (KNOWN_CRS_MAP[pcs]) return KNOWN_CRS_MAP[pcs];
        return 'EPSG:' + pcs;
      }
      if (geoKeys.GeographicTypeGeoKey) {
        const gcs = geoKeys.GeographicTypeGeoKey;
        if (KNOWN_CRS_MAP[gcs]) return KNOWN_CRS_MAP[gcs];
        return 'EPSG:' + gcs;
      }
    }
  } catch (e) {}
  try {
    const fileDirectory = image.getFileDirectory();
    if (fileDirectory && fileDirectory.GeoKeyDirectory) {
      const geoKeyDir = fileDirectory.GeoKeyDirectory;
      if (geoKeyDir && geoKeyDir.length >= 4) {
        for (let i = 0; i < geoKeyDir.length; i += 4) {
          const keyId = geoKeyDir[i];
          if (keyId === 3072 && geoKeyDir[i + 3] > 0) {
            const pcs = geoKeyDir[i + 3];
            if (KNOWN_CRS_MAP[pcs]) return KNOWN_CRS_MAP[pcs];
            return 'EPSG:' + pcs;
          }
          if (keyId === 2048 && geoKeyDir[i + 3] > 0) {
            const gcs = geoKeyDir[i + 3];
            if (KNOWN_CRS_MAP[gcs]) return KNOWN_CRS_MAP[gcs];
            return 'EPSG:' + gcs;
          }
        }
      }
    }
  } catch (e) {}
  return null;
}

async function loadGeoTiff(mapId) {
  destroyCachedPdfDoc();
  try {
    const arrayBuffer = await MapStorage.getMapData(mapId);
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const raster = await image.readRasters();
    const bbox = image.getBoundingBox();
    const width = image.getWidth();
    const height = image.getHeight();
    const values = raster.length >= 3 ? [raster[0], raster[1], raster[2]] : [raster[0]];

    // Detectar CRS del GeoTIFF
    const crs = getGeoTiffCRS(image);
    const isGeographic = crs === 'EPSG:4326';
    const needsProjTransform = crs && crs !== 'EPSG:4326' && crs !== 'EPSG:3857';

    if (AppState.mapOverlay) AppState.map.removeLayer(AppState.mapOverlay);

    // Para CRS proyectados (EPSG:24877 etc), usar overlay manual con proj4
    // GeoRasterLayer no soporta CRS proyectados y causa errores en cascada
    if (needsProjTransform || !crs) {
      const srcCRS = crs || 'EPSG:24877';
      const transformToWGS84 = (e, n) => {
        try {
          const [lng, lat] = proj4(srcCRS, WGS84, [e, n]);
          return [lat, lng];
        } catch (err) {
          console.warn('[loadGeoTiff] proj4 failed:', err);
          return [n, e];
        }
      };

      const tl = transformToWGS84(bbox[0], bbox[3]);
      const tr = transformToWGS84(bbox[2], bbox[3]);
      const bl = transformToWGS84(bbox[0], bbox[1]);
      const br = transformToWGS84(bbox[2], bbox[1]);

      const mapOffset = getMapOffset(mapId);
      if (mapOffset && (mapOffset.east || mapOffset.north)) {
        const refLat = (tl[0] + tr[0] + bl[0] + br[0]) / 4;
        const dLat = (mapOffset.north || 0) / 111000;
        const dLng = (mapOffset.east || 0) / (111000 * Math.cos(refLat * Math.PI / 180));
        tl[0] += dLat; tl[1] += dLng;
        tr[0] += dLat; tr[1] += dLng;
        bl[0] += dLat; bl[1] += dLng;
        br[0] += dLat; br[1] += dLng;
      }

      const bounds = [
        [Math.min(tl[0], tr[0], bl[0], br[0]), Math.min(tl[1], tr[1], bl[1], br[1])],
        [Math.max(tl[0], tr[0], bl[0], br[0]), Math.max(tl[1], tr[1], bl[1], br[1])]
      ];

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);

      if (values.length >= 3) {
        for (let i = 0; i < width * height; i++) {
          const r = values[0][i], g = values[1][i], b = values[2][i];
          imageData.data[i * 4] = Math.min(255, Math.max(0, r));
          imageData.data[i * 4 + 1] = Math.min(255, Math.max(0, g));
          imageData.data[i * 4 + 2] = Math.min(255, Math.max(0, b));
          imageData.data[i * 4 + 3] = (r === 0 && g === 0 && b === 0) ? 0 : 255;
        }
      } else {
        for (let i = 0; i < width * height; i++) {
          const v = Math.min(255, Math.max(0, values[0][i]));
          imageData.data[i * 4] = v;
          imageData.data[i * 4 + 1] = v;
          imageData.data[i * 4 + 2] = v;
          imageData.data[i * 4 + 3] = v === 0 ? 0 : 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);

      const dataUrl = canvas.toDataURL('image/png');
      AppState.mapOverlay = L.imageOverlay(dataUrl, bounds, { opacity: 0.85, interactive: true });
      AppState.mapOverlay.addTo(AppState.map);
      AppState.map.fitBounds(bounds);
      showToast('Mapa cargado (' + (crs || 'CRS desconocido') + ')', 'success');
    } else {
      // CRS geografico (EPSG:4326): usar GeoRasterLayer directamente
      const geoRaster = new GeoRaster({
        values: values,
        width: width, height: height,
        numberOfBands: values.length,
        pixelWidth: (bbox[2] - bbox[0]) / width,
        pixelHeight: (bbox[3] - bbox[1]) / height,
        xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3]
      });
      AppState.mapOverlay = new GeoRasterLayer({ georaster: geoRaster, opacity: 0.85, resolution: 256 });
      AppState.mapOverlay.addTo(AppState.map);
      AppState.map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);
      showToast('Mapa cargado (EPSG:4326)', 'success');
    }

    updateCalibButtonVisibility(true);
  } catch (error) {
    console.error('[loadGeoTiff] Error:', error);
    showToast('Error al cargar mapa: ' + (error.message || 'desconocido'), 'error');
  }
}
async function loadPDFMap(mapId) {
  try {
    const record = await MapStorage.getMapRecord(mapId);
    if (!record.georef || !record.georef.corners) { showToast('PDF sin georreferenciacion', 'error'); return; }
    if (AppState.pdfDoc && AppState.pdfDocMapId !== mapId) destroyCachedPdfDoc();
    if (!AppState.pdfDoc) {
      AppState.pdfDoc = await PDFProcessor.loadPDF(record.data);
      AppState.pdfDocMapId = mapId;
    }
    AppState.pdfGeoref = record.georef;
    AppState.currentMapOffset = getMapOffset(mapId);
    await setupPdfLayers(mapId, AppState.pdfDoc);
    await rerenderPDFOverlay();
    if (AppState.mapOverlay) AppState.map.fitBounds(AppState.mapOverlay.getBounds());
    showToast('PDF cargado', 'success');
    updateCalibButtonVisibility(true);
  } catch (error) { console.error('[loadPDFMap] Error:', error); showToast('Error al cargar PDF', 'error'); }
}

// ============================================
// MAP CALIBRATION (Offset fine-tuning)
// ============================================
function getMapOffsetKey(mapId) { return 'maps_gis_offset_' + mapId; }
function getMapOffset(mapId) {
  try { return JSON.parse(localStorage.getItem(getMapOffsetKey(mapId))) || { east: 0, north: 0 }; }
  catch { return { east: 0, north: 0 }; }
}
function saveMapOffset(mapId, offset) {
  localStorage.setItem(getMapOffsetKey(mapId), JSON.stringify(offset || { east: 0, north: 0 }));
}

function updateCalibButtonVisibility(visible) {
  const btn = document.getElementById('btn-calibrate');
  if (btn) btn.style.display = visible ? 'flex' : 'none';
}

function showCalibrationPanel() {
  let panel = document.getElementById('calibration-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'calibration-panel';
    panel.className = 'calibration-panel';
    panel.innerHTML = `
      <div class="calib-header">Calibrar Mapa</div>
      <div class="calib-display" id="calib-display">E: 0m | N: 0m</div>
      <div class="calib-grid">
        <button class="calib-btn" data-dir="n">▲</button>
        <button class="calib-btn" data-dir="w">◀</button>
        <button class="calib-btn" data-dir="e">▶</button>
        <button class="calib-btn" data-dir="s">▼</button>
      </div>
      <div class="calib-step">
        <label>Paso: <input type="number" id="calib-step" value="0.5" min="0.1" max="100" step="0.1" style="width:60px;"> m</label>
      </div>
      <div class="calib-actions">
        <button id="calib-save" class="btn-primary btn-sm">Guardar</button>
        <button id="calib-reset" class="btn-secondary btn-sm">Reset</button>
        <button id="calib-close" class="btn-secondary btn-sm">Cerrar</button>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelectorAll('.calib-btn').forEach(btn => {
      btn.addEventListener('click', () => applyCalibrationDelta(btn.dataset.dir));
    });
    document.getElementById('calib-save').addEventListener('click', () => {
      saveMapOffset(AppState.currentMapId, AppState.currentMapOffset);
      showToast('Calibracion guardada', 'success');
    });
    document.getElementById('calib-reset').addEventListener('click', () => {
      AppState.currentMapOffset = { east: 0, north: 0 };
      reloadMapWithOffset();
      updateCalibrationDisplay();
    });
    document.getElementById('calib-close').addEventListener('click', () => panel.classList.add('hidden'));
  }
  updateCalibrationDisplay();
  panel.classList.remove('hidden');
}

function applyCalibrationDelta(dir) {
  if (!AppState.currentMapId) return;
  const step = parseFloat(document.getElementById('calib-step').value) || 0.5;
  const offset = AppState.currentMapOffset || { east: 0, north: 0 };
  if (dir === 'n') offset.north += step;
  if (dir === 's') offset.north -= step;
  if (dir === 'e') offset.east += step;
  if (dir === 'w') offset.east -= step;
  AppState.currentMapOffset = offset;
  reloadMapWithOffset();
  updateCalibrationDisplay();
}

function updateCalibrationDisplay() {
  const disp = document.getElementById('calib-display');
  if (!disp) return;
  const o = AppState.currentMapOffset || { east: 0, north: 0 };
  const e = (o.east > 0 ? '+' : '') + o.east;
  const n = (o.north > 0 ? '+' : '') + o.north;
  disp.textContent = 'E: ' + e + 'm | N: ' + n + 'm';
}

async function reloadMapWithOffset() {
  if (!AppState.currentMapId || !AppState.pdfGeoref) return;
  await rerenderPDFOverlay();
}

// ============================================
// PDF LAYERS (Capas OCG del PDF)
// ============================================
function getPdfLayerStateKey(mapId) { return 'maps_gis_pdflayers_' + mapId; }
function loadSavedPdfLayerState(mapId) {
  try { return JSON.parse(localStorage.getItem(getPdfLayerStateKey(mapId))) || {}; }
  catch { return {}; }
}
function savePdfLayerState(mapId) {
  const state = {};
  AppState.pdfLayerGroups.forEach(g => { state[g.id] = g.visible; });
  localStorage.setItem(getPdfLayerStateKey(mapId), JSON.stringify(state));
}

async function setupPdfLayers(mapId, pdf) {
  AppState.pdfLayersConfig = null;
  AppState.pdfLayerGroups = [];
  const btn = document.getElementById('btn-pdf-layers');
  let info;
  try { info = await PDFProcessor.getPdfLayerInfo(pdf); }
  catch { info = { config: null, groups: [] }; }
  if (!info.config || info.groups.length === 0) {
    if (btn) btn.style.display = 'none';
    closePdfLayersPanel();
    return;
  }
  const saved = loadSavedPdfLayerState(mapId);
  info.groups.forEach(g => {
    if (Object.prototype.hasOwnProperty.call(saved, g.id)) g.visible = saved[g.id] !== false;
    try { info.config.setVisibility(g.id, g.visible); } catch (e) { /* grupo no controlable */ }
  });
  AppState.pdfLayersConfig = info.config;
  AppState.pdfLayerGroups = info.groups;
  if (btn) btn.style.display = 'flex';
  renderPdfLayersList();
}

function renderPdfLayersList() {
  const list = document.getElementById('pdf-layers-list');
  if (!list) return;
  list.innerHTML = '';
  AppState.pdfLayerGroups.forEach(g => {
    const row = document.createElement('div');
    row.className = 'pdf-layer-row';
    const name = document.createElement('span');
    name.className = 'pdf-layer-name';
    name.textContent = g.name;
    name.title = g.name;
    const toggle = document.createElement('label');
    toggle.className = 'layer-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'layer-toggle-input';
    input.checked = g.visible;
    input.addEventListener('change', () => togglePdfLayer(g.id, input.checked));
    const slider = document.createElement('span');
    slider.className = 'layer-toggle-slider';
    toggle.appendChild(input);
    toggle.appendChild(slider);
    row.appendChild(name);
    row.appendChild(toggle);
    list.appendChild(row);
  });
}

function togglePdfLayer(groupId, visible) {
  const g = AppState.pdfLayerGroups.find(x => x.id === groupId);
  if (!g || !AppState.pdfLayersConfig) return;
  g.visible = visible;
  try { AppState.pdfLayersConfig.setVisibility(groupId, visible); } catch (e) { return; }
  savePdfLayerState(AppState.currentMapId);
  schedulePdfRerender();
}

function setAllPdfLayers(visible) {
  if (!AppState.pdfLayersConfig) return;
  AppState.pdfLayerGroups.forEach(g => {
    g.visible = visible;
    try { AppState.pdfLayersConfig.setVisibility(g.id, visible); } catch (e) { /* continuar */ }
  });
  savePdfLayerState(AppState.currentMapId);
  renderPdfLayersList();
  schedulePdfRerender();
}

function schedulePdfRerender() {
  if (AppState.pdfLayerRenderTimer) clearTimeout(AppState.pdfLayerRenderTimer);
  AppState.pdfLayerRenderTimer = setTimeout(() => {
    AppState.pdfLayerRenderTimer = null;
    rerenderPDFOverlay();
  }, 250);
}

function openPdfLayersPanel() {
  const panel = document.getElementById('pdf-layers-panel');
  if (panel) panel.classList.remove('hidden');
}
function closePdfLayersPanel() {
  const panel = document.getElementById('pdf-layers-panel');
  if (panel) panel.classList.add('hidden');
}

async function rerenderPDFOverlay() {
  if (!AppState.pdfDoc || !AppState.pdfGeoref) return;
  try {
    const result = await PDFProcessor.renderPage(AppState.pdfDoc, 4, AppState.pdfGeoref.renderRotation, AppState.pdfLayersConfig);
    if (!result) return; // render cancelado: hay otro mas reciente en curso
    if (AppState.mapOverlay) AppState.map.removeLayer(AppState.mapOverlay);
    AppState.mapOverlay = PDFProcessor.createGeoOverlay(result.canvas, AppState.pdfGeoref.corners, AppState.pdfGeoref.crs, AppState.currentMapOffset, AppState.pdfGeoref.sourceDatum);
    AppState.mapOverlay.addTo(AppState.map);
  } catch (e) { console.error('[rerenderPDFOverlay] Error:', e); }
}

function destroyCachedPdfDoc() {
  if (AppState.pdfDoc) { try { AppState.pdfDoc.destroy(); } catch (e) { /* ya destruido */ } }
  AppState.pdfDoc = null;
  AppState.pdfDocMapId = null;
  AppState.pdfGeoref = null;
  AppState.pdfLayersConfig = null;
  AppState.pdfLayerGroups = [];
  if (AppState.pdfLayerRenderTimer) { clearTimeout(AppState.pdfLayerRenderTimer); AppState.pdfLayerRenderTimer = null; }
  const btn = document.getElementById('btn-pdf-layers');
  if (btn) btn.style.display = 'none';
  closePdfLayersPanel();
}

// ============================================
// GO TO COORDINATES (Buscar Punto)
// ============================================
function openGoToCoordsModal() {
  AppState.gotoMarkerType = 'qc';
  document.getElementById('goto-norte').value = '';
  document.getElementById('goto-este').value = '';
  document.getElementById('btn-goto-qc').classList.add('active');
  document.getElementById('btn-goto-lsm').classList.remove('active');
  document.getElementById('go-to-coords-modal').classList.remove('hidden');
  setTimeout(function() { document.getElementById('goto-norte').focus(); }, 100);
}
function closeGoToCoordsModal() {
  document.getElementById('go-to-coords-modal').classList.add('hidden');
}
function selectGotoType(type) {
  AppState.gotoMarkerType = type;
  document.getElementById('btn-goto-qc').classList.toggle('active', type === 'qc');
  document.getElementById('btn-goto-lsm').classList.toggle('active', type === 'lsm');
}
function confirmGoToCoords() {
  var norteVal = document.getElementById('goto-norte').value.trim();
  var esteVal = document.getElementById('goto-este').value.trim();
  if (!norteVal || !esteVal) { showToast('Ingresa Norte y Este', 'error'); return; }
  var north = parseFloat(norteVal);
  var east = parseFloat(esteVal);
  if (isNaN(north) || isNaN(east)) { showToast('Coordenadas invalidas', 'error'); return; }
  try {
    var lnglat = proj4('EPSG:24877', 'EPSG:4326', [east, north]);
    var lng = lnglat[0], lat = lnglat[1];
    var latlng = { lat: lat, lng: lng };
    closeGoToCoordsModal();
    AppState.isAddMarkerMode = false;
    document.getElementById('btn-add-marker').classList.remove('active');
    AppState.map.setView([lat, lng], 17);
    if (AppState.gotoMarkerType === 'lsm') {
      openLSMLoginOrMarkerModal(latlng);
    } else {
      AppState.pendingMarkerType = 'qc';
      openMarkerModal(latlng);
    }
  } catch (err) {
    console.error('[confirmGoToCoords] proj4 error:', err);
    showToast('Error al convertir coordenadas', 'error');
  }
}

// ============================================
// GPS / LOCATION
// ============================================
const LOCATION_SMOOTHING_ALPHA = 0.75; // 0= muy suave/lento, 1=sin suavizado. Valor alto para seguimiento GPS casi instantaneo
const LOCATION_MAX_AGE_MS = 10000;

function ensureUserLocationLayer() {
  if (!AppState.userLocationLayer) {
    const accuracyCircle = L.circle([0, 0], {
      radius: 1,
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      weight: 1,
      className: 'gps-location-accuracy'
    });
    const dotMarker = L.marker([0, 0], {
      icon: L.divIcon({
        className: 'gps-location-dot-container',
        html: '<div class="gps-location-dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      }),
      zIndexOffset: 1000
    });
    AppState.userLocationLayer = L.layerGroup([accuracyCircle, dotMarker]);
    AppState.userLocationLayer._accuracyCircle = accuracyCircle;
    AppState.userLocationLayer._dotMarker = dotMarker;
  }
  return AppState.userLocationLayer;
}

function smoothLocation(lat, lng) {
  if (!AppState.smoothedLocation) {
    AppState.smoothedLocation = { lat, lng };
    return AppState.smoothedLocation;
  }
  const s = AppState.smoothedLocation;
  s.lat = LOCATION_SMOOTHING_ALPHA * lat + (1 - LOCATION_SMOOTHING_ALPHA) * s.lat;
  s.lng = LOCATION_SMOOTHING_ALPHA * lng + (1 - LOCATION_SMOOTHING_ALPHA) * s.lng;
  return s;
}

function updateUserLocationOnMap(lat, lng, accuracy) {
  const layer = ensureUserLocationLayer();
  if (!AppState.map.hasLayer(layer)) layer.addTo(AppState.map);
  const latlng = [lat, lng];
  layer._accuracyCircle.setLatLng(latlng);
  layer._accuracyCircle.setRadius(accuracy || 1);
  layer._dotMarker.setLatLng(latlng);
}

function onLocationUpdate(position) {
  const { latitude: lat, longitude: lng, accuracy, altitude } = position.coords;
  AppState.currentLocation = { lat, lng, accuracy, timestamp: Date.now() };
  if (altitude !== null && altitude !== undefined && !isNaN(altitude)) {
    AppState.currentAltitude = altitude;
  }
  AppState.locationAccuracy = accuracy;
  const smoothed = smoothLocation(lat, lng);
  updateUserLocationOnMap(smoothed.lat, smoothed.lng, accuracy);
  updateCoordsDisplay({ lat: smoothed.lat, lng: smoothed.lng });
  if (AppState.isFollowingLocation && AppState.map) {
    // Solo re-centrar si el usuario se alejo lo suficiente del centro del mapa;
    // si esta quieto o casi quieto (jitter GPS), el mapa no baila con cada fix.
    const center = AppState.map.getCenter();
    const threshold = Math.max(50, accuracy || 0);
    const dist = haversineDistance(
      { lat: center.lat, lng: center.lng },
      { lat: smoothed.lat, lng: smoothed.lng }
    );
    if (dist > threshold) {
      AppState.map.panTo([smoothed.lat, smoothed.lng], { animate: true, duration: 0.1 });
    }
  }
}

let _lastLocationErrorToast = 0;
function onLocationError(error) {
  console.warn('[onLocationError] Error de geolocalizacion:', error);
  const now = Date.now();
  if (now - _lastLocationErrorToast > 15000) {
    _lastLocationErrorToast = now;
    const msgs = { 1: 'Permiso denegado', 2: 'No disponible', 3: 'Tiempo agotado' };
    showToast('Error GPS: ' + (msgs[error.code] || 'Desconocido'), 'error');
  }
}

function startLocationTracking() {
  if (!navigator.geolocation) { showToast('Geolocalizacion no disponible', 'error'); return false; }
  if (AppState.locationWatchId !== null) return true;
  AppState.locationWatchId = navigator.geolocation.watchPosition(
    onLocationUpdate,
    onLocationError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
  // Lectura inmediata para que el punto aparezca sin esperar al primer callback del watch
  navigator.geolocation.getCurrentPosition(onLocationUpdate, onLocationError, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 5000
  });
  return true;
}

function stopLocationTracking() {
  if (AppState.locationWatchId !== null) {
    navigator.geolocation.clearWatch(AppState.locationWatchId);
    AppState.locationWatchId = null;
  }
}

// Detiene el re-centrado automatico del mapa (seguimiento activo) pero mantiene
// el watchPosition vivo: el punto azul y la precision siguen actualizandose.
function stopFollowLocation() {
  AppState.isFollowingLocation = false;
  const btn = document.getElementById('btn-location');
  if (btn) btn.classList.remove('active');
}

// Arma el seguimiento activo. Debe llamarse DESPUES del centrado inicial:
// setView dispara `zoomstart` (que llama stopFollowLocation) si cambia el zoom.
function armFollowLocation() {
  AppState.isFollowingLocation = true;
  const btn = document.getElementById('btn-location');
  if (btn) btn.classList.add('active');
}

function goToMyLocation() {
  if (!startLocationTracking()) return;
  if (AppState.isFollowingLocation) {
    stopFollowLocation();
    showToast('Seguimiento desactivado', 'info');
    return;
  }
  showToast('Siguiendo ubicacion GPS...', 'info');
  if (AppState.currentLocation) {
    AppState.map.setView([AppState.smoothedLocation.lat, AppState.smoothedLocation.lng], 18);
    armFollowLocation();
  } else {
    // Si aun no hay lectura previa, obtener una inmediata y centrar de una vez
    navigator.geolocation.getCurrentPosition((position) => {
      onLocationUpdate(position);
      if (AppState.smoothedLocation) {
        AppState.map.setView([AppState.smoothedLocation.lat, AppState.smoothedLocation.lng], 18);
      }
      armFollowLocation();
    }, onLocationError, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
  }
}

// ============================================
// COLOCACION DE MARCADOR (crosshair / GPS)
// ============================================

function openMarkerPlacementModal() {
  const modal = document.getElementById('marker-placement-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeMarkerPlacementModal() {
  const modal = document.getElementById('marker-placement-modal');
  if (modal) modal.classList.add('hidden');
}

function selectMarkerPlacement(mode) {
  closeMarkerPlacementModal();
  if (mode === 'gps') { placeMarkerAtGps(); return; }
  AppState.markerPlacementMode = 'crosshair';
  const crosshair = document.getElementById('marker-crosshair');
  const bar = document.getElementById('marker-place-bar');
  if (crosshair) crosshair.classList.remove('hidden');
  if (bar) bar.classList.remove('hidden');
  updateCoordsFromCrosshair();
  showToast('Mueve el mapa y pulsa Colocar aqui (o toca el mapa)', 'info');
}

function exitMarkerPlacement() {
  AppState.markerPlacementMode = null;
  const crosshair = document.getElementById('marker-crosshair');
  const bar = document.getElementById('marker-place-bar');
  if (crosshair) crosshair.classList.add('hidden');
  if (bar) bar.classList.add('hidden');
  resetCoordsToGps();
}

function placeMarkerAt(latlng) {
  exitMarkerPlacement();
  closeMarkerPlacementModal();
  AppState.isAddMarkerMode = false;
  document.getElementById('btn-add-marker').classList.remove('active');
  if (AppState.currentMarkerMode === 'lsm') openLSMLoginOrMarkerModal(latlng);
  else openMarkerModal(latlng);
}

function placeMarkerAtGps() {
  // Reutiliza la lectura suavizada si es reciente; si no, pide una nueva.
  if (AppState.smoothedLocation && AppState.currentLocation &&
      (Date.now() - AppState.currentLocation.timestamp) < LOCATION_MAX_AGE_MS) {
    const { lat, lng } = AppState.smoothedLocation;
    showToast('Ubicacion (' + Math.round(AppState.locationAccuracy || 0) + 'm)', 'info');
    placeMarkerAt({ lat, lng });
    return;
  }
  if (!navigator.geolocation) {
    showToast('GPS no disponible en este dispositivo', 'error');
    if (AppState.isAddMarkerMode) openMarkerPlacementModal();
    return;
  }
  showToast('Obteniendo ubicacion...', 'info');
  navigator.geolocation.getCurrentPosition((position) => {
    if (!AppState.isAddMarkerMode) return; // el usuario cancelo mientras se obtenia el fix
    const { latitude: lat, longitude: lng, accuracy, altitude } = position.coords;
    if (altitude !== null && altitude !== undefined && !isNaN(altitude)) {
      AppState.currentAltitude = altitude;
    }
    showToast('Ubicacion (' + Math.round(accuracy) + 'm)', 'info');
    placeMarkerAt({ lat, lng });
  }, () => {
    showToast('No se pudo obtener la ubicacion GPS', 'error');
    if (AppState.isAddMarkerMode) openMarkerPlacementModal();
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
}

// ============================================
// TRACKING / RECORRIDOS
// ============================================
const TRACK_COLORS = ['#00bcd4', '#ff9800', '#e91e63', '#8bc34a', '#9c27b0', '#ffeb3b'];

function getTrackColor(index) {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

function haversineDistance(p1, p2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (p2.lat - p1.lat) * toRad;
  const dLng = (p2.lng - p1.lng) * toRad;
  const a = Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(p1.lat * toRad) * Math.cos(p2.lat * toRad) *
            Math.pow(Math.sin(dLng / 2), 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (hrs > 0) parts.push(hrs + 'h');
  if (mins > 0) parts.push(mins + 'm');
  if (secs > 0 || parts.length === 0) parts.push(secs + 's');
  return parts.join(' ');
}

function getTrackAltitudeStats(track) {
  const alts = (track.points || [])
    .map(p => p.altitude)
    .filter(a => a !== null && a !== undefined && !isNaN(a));
  if (alts.length === 0) return null;
  return {
    min: Math.min(...alts),
    max: Math.max(...alts),
    avg: alts.reduce((s, a) => s + a, 0) / alts.length
  };
}

function formatAltitude(stats) {
  if (!stats) return null;
  return Math.round(stats.min) + '-' + Math.round(stats.max) + ' m';
}

function generateTrackName() {
  const now = new Date();
  return 'Recorrido ' + now.toISOString().slice(0, 10) + ' ' +
         String(now.getHours()).padStart(2, '0') + ':' +
         String(now.getMinutes()).padStart(2, '0');
}

function openTrackNameModal() {
  const input = document.getElementById('track-name-input');
  if (input) input.value = generateTrackName();
  document.getElementById('track-name-modal')?.classList.remove('hidden');
  setTimeout(() => input?.focus(), 100);
}

function closeTrackNameModal() {
  document.getElementById('track-name-modal')?.classList.add('hidden');
}

async function confirmStartTrack() {
  const input = document.getElementById('track-name-input');
  const name = (input?.value || '').trim();
  if (!name) { showToast('Ingresa un nombre para el recorrido', 'error'); return; }
  closeTrackNameModal();
  startTrack(name);
}

function startTrack(name) {
  if (!navigator.geolocation) {
    showToast('Geolocalizacion no disponible', 'error');
    return;
  }
  if (AppState.isTracking) return;

  // Asegurar capas
  if (!AppState.tracksLayer) {
    AppState.tracksLayer = L.layerGroup().addTo(AppState.map);
  }
  clearActiveTrack();

  const color = getTrackColor(Date.now() % TRACK_COLORS.length);
  const now = new Date().toISOString();
  AppState.currentTrack = {
    id: 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 7),
    name: name,
    color: color,
    createdAt: now,
    startedAt: now,
    endedAt: null,
    distance: 0,
    duration: 0,
    points: []
  };
  AppState.isTracking = true;
  AppState.isTrackPaused = false;
  AppState.trackLastPoint = null;

  AppState.activeTrackLayer = L.layerGroup().addTo(AppState.map);

  AppState.trackWatchId = navigator.geolocation.watchPosition(
    onTrackPosition,
    onTrackError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );

  updateTrackButtonUI();
  updateTrackStatusText('Grabando recorrido...');
  showToast('Recorrido iniciado: ' + name, 'success');
}

function pauseTrack() {
  if (!AppState.isTracking || AppState.isTrackPaused) return;
  AppState.isTrackPaused = true;
  updateTrackButtonUI();
  updateTrackStatusText('Recorrido pausado');
  showToast('Recorrido pausado', 'info');
}

function resumeTrack() {
  if (!AppState.isTracking || !AppState.isTrackPaused) return;
  AppState.isTrackPaused = false;
  updateTrackButtonUI();
  updateTrackStatusText('Grabando recorrido...');
  showToast('Recorrido reanudado', 'info');
}

async function stopTrack() {
  if (!AppState.isTracking) return;

  if (AppState.trackWatchId !== null) {
    navigator.geolocation.clearWatch(AppState.trackWatchId);
    AppState.trackWatchId = null;
  }

  const track = AppState.currentTrack;
  if (track) {
    track.endedAt = new Date().toISOString();
    track.duration = track.startedAt ? Math.max(0, Math.round((new Date(track.endedAt) - new Date(track.startedAt)) / 1000)) : 0;
    if (track.points.length > 0) {
      try {
        await TrackManager.save(track);
        showToast('Recorrido guardado', 'success');
      } catch (e) {
        showToast('Error al guardar recorrido', 'error');
      }
    } else {
      showToast('Recorrido vacio descartado', 'info');
    }
  }

  AppState.isTracking = false;
  AppState.isTrackPaused = false;
  AppState.currentTrack = null;
  AppState.trackLastPoint = null;

  updateTrackButtonUI();
  updateTrackStatusText('');
  clearActiveTrack();
  await renderTracksOnMap();
  await updateTrackPanelList();
}

function onTrackPosition(position) {
  if (!AppState.isTracking || AppState.isTrackPaused) return;

  const { latitude: lat, longitude: lng, accuracy, altitude, speed } = position.coords;

  // Actualizar altitud actual si es valida
  if (altitude !== null && altitude !== undefined && !isNaN(altitude)) {
    AppState.currentAltitude = altitude;
  }

  // Filtrar por precision minima
  if (accuracy && accuracy > AppState.trackConfig.minAccuracy) {
    return;
  }

  const newPoint = {
    lat, lng, accuracy: accuracy || null,
    altitude: altitude || null,
    speed: speed || null,
    timestamp: new Date().toISOString()
  };

  const track = AppState.currentTrack;
  if (!track) return;

  // Filtrar por distancia minima respecto al ultimo punto
  if (AppState.trackLastPoint) {
    const d = haversineDistance(AppState.trackLastPoint, newPoint);
    if (d < AppState.trackConfig.minDistance) return;
    track.distance += d;
  }

  track.points.push(newPoint);
  AppState.trackLastPoint = newPoint;

  renderActiveTrack();
  updateTrackStatusText('Grabando: ' + track.points.length + ' pts | ' + formatDistance(track.distance) +
    (altitude ? ' | Alt: ' + Math.round(altitude) + ' m' : ''));
}

let _lastTrackErrorToast = 0;
function onTrackError(error) {
  console.warn('[onTrackError] Error de geolocalizacion:', error);
  const now = Date.now();
  if (now - _lastTrackErrorToast > 10000) {
    _lastTrackErrorToast = now;
    showToast('Error GPS: ' + (error?.message || 'desconocido'), 'error');
  }
}

function formatDistance(meters) {
  if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
  return Math.round(meters) + ' m';
}

function formatNEZ(north, east, altura) {
  let s = 'N: ' + Math.round(north) + ' | E: ' + Math.round(east);
  if (altura != null) s += ' | Z: ' + Math.round(altura) + ' m';
  return s;
}

function clearActiveTrack() {
  if (AppState.activeTrackLayer) {
    AppState.map.removeLayer(AppState.activeTrackLayer);
    AppState.activeTrackLayer = null;
  }
}

function renderActiveTrack() {
  if (!AppState.activeTrackLayer || !AppState.currentTrack) return;
  AppState.activeTrackLayer.clearLayers();

  const track = AppState.currentTrack;
  const points = track.points;
  if (points.length === 0) return;

  const latlngs = points.map(p => [p.lat, p.lng]);

  AppState.activeTrackLayer.addLayer(L.polyline(latlngs, {
    color: track.color,
    weight: 4,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  }));

  // Punto de inicio
  AppState.activeTrackLayer.addLayer(L.circleMarker(latlngs[0], {
    radius: 5, color: '#ffffff', weight: 2, fillColor: track.color, fillOpacity: 1
  }));

  // Punto actual
  AppState.activeTrackLayer.addLayer(L.circleMarker(latlngs[latlngs.length - 1], {
    radius: 5, color: '#ffffff', weight: 2, fillColor: '#ff5722', fillOpacity: 1
  }));
}

async function renderTracksOnMap() {
  if (!AppState.tracksLayer) return;
  AppState.tracksLayer.clearLayers();

  const tracks = await TrackManager.getAll();
  tracks.forEach((track, idx) => {
    const points = track.points || [];
    if (points.length < 2) return;
    const latlngs = points.map(p => [p.lat, p.lng]);
    const color = track.color || getTrackColor(idx);

    const polyline = L.polyline(latlngs, {
      color: color,
      weight: 4,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    });
    const alt = formatAltitude(getTrackAltitudeStats(track));
    polyline.bindPopup(escapeHtml(track.name) + '<br>' + formatDistance(track.distance || 0) + ' | ' + formatDuration(track.duration || 0) +
      (alt ? '<br>Alt: ' + alt : ''));
    AppState.tracksLayer.addLayer(polyline);

    // Inicio
    AppState.tracksLayer.addLayer(L.circleMarker(latlngs[0], {
      radius: 5, color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1
    }).bindPopup('Inicio: ' + escapeHtml(track.name)));

    // Fin
    AppState.tracksLayer.addLayer(L.circleMarker(latlngs[latlngs.length - 1], {
      radius: 5, color: '#ffffff', weight: 2, fillColor: '#ff5722', fillOpacity: 1
    }).bindPopup('Fin: ' + escapeHtml(track.name)));
  });
}

function updateTrackButtonUI() {
  const btn = document.getElementById('btn-track');
  if (!btn) return;
  btn.classList.toggle('tracking', AppState.isTracking);
  btn.classList.toggle('paused', AppState.isTracking && AppState.isTrackPaused);
  btn.title = AppState.isTracking ? 'Detener recorrido' : 'Iniciar recorrido';
}

function updateTrackStatusText(text) {
  const el = document.getElementById('track-status-text');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function handleTrackButtonClick() {
  if (!AppState.isTracking) {
    openTrackNameModal();
  } else {
    if (confirm('Detener el recorrido actual?')) {
      stopTrack();
    }
  }
}

function openTracksPanel() {
  const panel = document.getElementById('tracks-panel');
  if (panel) { panel.classList.remove('hidden'); updateTrackPanelList(); }
}

function closeTracksPanel() {
  document.getElementById('tracks-panel')?.classList.add('hidden');
}

async function updateTrackPanelList() {
  const container = document.getElementById('tracks-list-container');
  if (!container) return;

  const tracks = await TrackManager.getAll();
  if (tracks.length === 0) {
    container.innerHTML = '<p class="empty-msg">No hay recorridos guardados</p>';
    return;
  }

  container.innerHTML = tracks.map(t => {
    const pts = (t.points || []).length;
    const alt = formatAltitude(getTrackAltitudeStats(t));
    return '<div class="track-item" data-id="' + t.id + '">' +
             '<div class="track-item-info">' +
               '<div class="track-item-name">' + escapeHtml(t.name) + '</div>' +
               '<div class="track-item-meta">' + formatDistance(t.distance || 0) + ' | ' + formatDuration(t.duration || 0) + ' | ' + pts + ' pts' + (alt ? ' | Alt: ' + alt : '') + '</div>' +
             '</div>' +
             '<div class="track-item-actions">' +
               '<button class="track-btn-view" data-id="' + t.id + '" title="Ver en mapa">Ver</button>' +
               '<button class="track-btn-export" data-id="' + t.id + '" title="Exportar GeoJSON">GeoJSON</button>' +
               '<button class="track-btn-delete" data-id="' + t.id + '" title="Eliminar">&times;</button>' +
             '</div>' +
           '</div>';
  }).join('');

  container.querySelectorAll('.track-btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); zoomToTrack(btn.dataset.id); });
  });
  container.querySelectorAll('.track-btn-export').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); downloadTrackGeoJSON(btn.dataset.id); });
  });
  container.querySelectorAll('.track-btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTrackById(btn.dataset.id); });
  });
}

async function zoomToTrack(id) {
  const track = await TrackManager.getById(id);
  if (!track || !track.points || track.points.length === 0) return;
  const bounds = L.latLngBounds(track.points.map(p => [p.lat, p.lng]));
  AppState.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  closeTracksPanel();
}

async function deleteTrackById(id) {
  if (!confirm('Eliminar este recorrido?')) return;
  try {
    await TrackManager.delete(id);
    await renderTracksOnMap();
    await updateTrackPanelList();
    showToast('Recorrido eliminado', 'info');
  } catch (e) {
    showToast('Error al eliminar recorrido', 'error');
  }
}

function trackToGeoJSON(track) {
  const points = track.points || [];
  const toCoord = (p) => (p.altitude !== null && p.altitude !== undefined && !isNaN(p.altitude))
    ? [p.lng, p.lat, p.altitude]
    : [p.lng, p.lat];
  const coordinates = points.map(toCoord);
  const start = points[0];
  const end = points[points.length - 1];
  const features = [];
  const altStats = getTrackAltitudeStats(track);

  if (coordinates.length > 0) {
    const props = {
      name: track.name,
      type: 'track',
      distance: track.distance || 0,
      duration: track.duration || 0,
      startedAt: track.startedAt,
      endedAt: track.endedAt
    };
    if (altStats) {
      props.altitude_min = Math.round(altStats.min);
      props.altitude_max = Math.round(altStats.max);
      props.altitude_avg = Math.round(altStats.avg);
    }
    features.push({
      type: 'Feature',
      properties: props,
      geometry: {
        type: coordinates.length === 1 ? 'Point' : 'LineString',
        coordinates: coordinates.length === 1 ? coordinates[0] : coordinates
      }
    });
  }

  if (start) {
    features.push({
      type: 'Feature',
      properties: { name: track.name + ' - Inicio', type: 'start' },
      geometry: { type: 'Point', coordinates: toCoord(start) }
    });
  }
  if (end) {
    features.push({
      type: 'Feature',
      properties: { name: track.name + ' - Fin', type: 'end' },
      geometry: { type: 'Point', coordinates: toCoord(end) }
    });
  }

  return {
    type: 'FeatureCollection',
    features: features
  };
}

async function downloadTrackGeoJSON(id) {
  const track = await TrackManager.getById(id);
  if (!track) return;
  const geojson = trackToGeoJSON(track);
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
  const fileName = (track.name || 'recorrido').replace(/[^a-zA-Z0-9]/g, '_') + '.geojson';
  saveAs(blob, fileName);
}

// ============================================
// MARKER SVG ICON GENERATOR
// ============================================
function createMarkerSVG(color, initial) {
  const hex = MARKER_COLORS[color]?.hex || MARKER_COLORS.red.hex;
  return '<div class="custom-marker-pin"><svg viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg"><path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="' + hex + '"/></svg></div>';
}
function createMarkerIcon(marker) {
  return L.divIcon({ className: '', html: createMarkerSVG(marker.color || 'red', marker.name.charAt(0).toUpperCase()), iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40] });
}

// ============================================
// MARKER TYPE SELECTOR (QC vs LSM)
// ============================================
function openMarkerTypeModal(latlng) {
  AppState.pendingMarkerLatLng = latlng;
  document.getElementById('marker-type-modal').classList.remove('hidden');
}
function closeMarkerTypeModal() {
  document.getElementById('marker-type-modal').classList.add('hidden');
  AppState.pendingMarkerLatLng = null;
  AppState.isAddMarkerMode = false;
  document.getElementById('btn-add-marker').classList.remove('active');
}
function selectMarkerType(type) {
  closeMarkerTypeModal();
  const latlng = AppState.pendingMarkerLatLng;
  if (!latlng) return;
  if (type === 'qc') { AppState.pendingMarkerType = 'qc'; openMarkerModal(latlng); }
  else { AppState.pendingMarkerType = 'lsm'; openLSMLoginOrMarkerModal(latlng); }
}

// ============================================
// LSM LOGIN & MARKER MODAL
// ============================================
function openLSMLoginOrMarkerModal(latlng) {
  if (LSMUserManager.isLoggedIn()) openLSMMarkerModal(latlng);
  else openLSMLoginModal(latlng);
}
function openLSMLoginModal(latlng) {
  AppState.pendingMarkerLatLng = latlng;
  const saved = LSMUserManager.get();
  document.getElementById('lsm-nickname').value = saved ? saved.nickname : '';
  document.getElementById('lsm-password').value = '';
  document.getElementById('lsm-login-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('lsm-nickname').focus(), 100);
}
function closeLSMLoginModal() {
  document.getElementById('lsm-login-modal').classList.add('hidden');
  AppState.pendingMarkerLatLng = null;
  AppState.isAddMarkerMode = false;
  document.getElementById('btn-add-marker').classList.remove('active');
}
function confirmLSMLogin() {
  const nickname = document.getElementById('lsm-nickname').value.trim();
  const password = document.getElementById('lsm-password').value.trim();
  if (!nickname) { showToast('Ingresa un nickname', 'error'); return; }
  if (!LSMUserManager.validate(nickname, password)) { showToast('Contrasena incorrecta', 'error'); return; }
  LSMUserManager.set(nickname);
  showToast('Bienvenido, ' + nickname, 'success');
  closeLSMLoginModal();
  if (AppState.pendingMarkerLatLng) openLSMMarkerModal(AppState.pendingMarkerLatLng);
}
function populateLsmSelect(id, key, required) {
  const select = document.getElementById(id);
  if (!select) return;
  const values = ConfigManager.getValues(key);
  select.innerHTML = '';
  if (!required) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '-- Seleccionar --';
    select.appendChild(opt);
  }
  values.forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.textContent = v; select.appendChild(opt); });
}
function populateLsmEnsayos() {
  const container = document.getElementById('lsm-ensayos-group');
  if (!container) return;
  const values = ConfigManager.getValues('ensayos');
  container.innerHTML = '';
  values.forEach(v => {
    const label = document.createElement('label');
    label.className = 'checkbox-option';
    label.innerHTML = '<input type="checkbox" value="' + escapeHtml(v) + '"><span>' + escapeHtml(v) + '</span>';
    container.appendChild(label);
  });
}
function updateLSMCategorySelector() {
  document.querySelectorAll('#lsm-category-selector .category-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === AppState.lsmSelectedCategory);
  });
}
const LAST_LSM_KEY = 'maps_gis_last_lsm_form';
function getLastLSMForm() { try { return JSON.parse(localStorage.getItem(LAST_LSM_KEY)) || {}; } catch { return {}; } }
function saveLastLSMForm(data) { const copy = { ...data }; delete copy.nombreMuestra; delete copy.ensayos; localStorage.setItem(LAST_LSM_KEY, JSON.stringify(copy)); }

function getSemanaLaboratorio(date = new Date()) {
  const year = date.getFullYear();
  const yy = String(year).slice(-2);
  const jan1 = new Date(year, 0, 1);
  const dayOfWeek = jan1.getDay(); // 0=domingo, 1=lunes...
  const daysUntilMonday = (8 - dayOfWeek) % 7;
  const firstMonday = new Date(year, 0, 1 + daysUntilMonday);
  if (date < firstMonday) {
    return getSemanaLaboratorio(new Date(year - 1, 11, 31));
  }
  const diffMs = date - firstMonday;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return yy + String(week).padStart(2, '0');
}

async function openLSMMarkerModal(latlng, editId) {
  AppState.pendingMarkerLatLng = latlng;
  AppState.editingMarkerId = editId || null;
  AppState.pendingMarkerType = 'lsm';
  clearPendingPhotos();
  populateLsmSelect('lsm-tipo-material', 'tipo_material');
  populateLsmSelect('lsm-localizacion', 'localizacion');
  populateLsmSelect('lsm-fuente', 'fuente');
  populateLsmEnsayos();
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  const lsmAltura = editId ? (MarkerManager.getById(editId)?.altura) : AppState.currentAltitude;
  document.getElementById('lsm-coords-display').textContent = formatNEZ(north, east, lsmAltura);
  if (editId) {
    const marker = MarkerManager.getById(editId);
    if (!marker || marker.markerType !== 'lsm') return;
    document.getElementById('lsm-modal-title').textContent = 'Editar Muestra LSM';
    const d = marker.lsmData || {};
    document.getElementById('lsm-semana-laboratorio').value = d.semanaLaboratorio || '';
    document.getElementById('lsm-tipo-material').value = d.tipoMaterial || '';
    document.getElementById('lsm-nombre-muestra').value = marker.name || '';
    document.getElementById('lsm-localizacion').value = d.localizacion || '';
    document.getElementById('lsm-fuente').value = d.fuente || '';
    const ensayos = d.ensayos || [];
    document.querySelectorAll('#lsm-ensayos-group input[type="checkbox"]').forEach(cb => { cb.checked = ensayos.includes(cb.value); });
    AppState.lsmSelectedCategory = marker.color || 'red';
    if (marker.photos && marker.photos.length > 0) {
      for (const photoId of marker.photos) {
        try {
          const photoRecord = await MapStorage.getPhoto(photoId);
          if (photoRecord && photoRecord.blob) {
            const dataUrl = await blobToDataURL(photoRecord.blob);
            // Se conserva la foto cruda para poder re-estampar si cambian los datos del formulario
            AppState.pendingPhotos.push({
              photoId: photoId,
              blob: photoRecord.blob,
              dataUrl: dataUrl,
              originalBlob: photoRecord.originalBlob || null
            });
          }
        } catch (e) { console.warn('Could not load photo:', photoId); }
      }
      renderPhotoGrid();
    }
  } else {
    document.getElementById('lsm-modal-title').textContent = 'Nueva Muestra LSM';
    const last = getLastLSMForm();
    document.getElementById('lsm-semana-laboratorio').value = getSemanaLaboratorio();
    document.getElementById('lsm-tipo-material').value = last.tipoMaterial || '';
    document.getElementById('lsm-nombre-muestra').value = getDefaultMarkerName('lsm');
    document.getElementById('lsm-localizacion').value = last.localizacion || '';
    document.getElementById('lsm-fuente').value = last.fuente || '';
    document.querySelectorAll('#lsm-ensayos-group input[type="checkbox"]').forEach(cb => cb.checked = false);
    AppState.lsmSelectedCategory = 'red';
  }
  updateLSMCategorySelector();
  document.getElementById('lsm-marker-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('lsm-nombre-muestra').focus(), 100);
}
function closeLSMMarkerModal() {
  document.getElementById('lsm-marker-modal').classList.add('hidden');
  clearAutocomplete(document.getElementById('lsm-name-suggestions'));
  AppState.pendingMarkerLatLng = null;
  AppState.editingMarkerId = null;
  AppState.isAddMarkerMode = false;
  clearPendingPhotos();
  document.getElementById('btn-add-marker').classList.remove('active');
}

// ============================================
// AUTOCOMPLETE DE NOMBRES DE MARCADORES
// ============================================
function getMarkerNameSuggestions(type, query, excludeId) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const markers = MarkerManager.getAll();
  const names = new Set();
  for (const m of markers) {
    if (m.markerType !== type) continue;
    if (excludeId && m.id === excludeId) continue;
    if (!m.name) continue;
    const nameNorm = m.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (nameNorm.includes(q)) names.add(m.name.trim());
    if (names.size >= 5) break;
  }
  return Array.from(names);
}

function renderAutocompleteList(listEl, items, query) {
  listEl.innerHTML = '';
  if (items.length === 0) {
    listEl.classList.add('hidden');
    return;
  }
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const item of items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.value = item;
    const itemNorm = item.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const idx = itemNorm.indexOf(q);
    if (idx >= 0) {
      li.innerHTML = escapeHtml(item.slice(0, idx)) + '<em>' + escapeHtml(item.slice(idx, idx + query.length)) + '</em>' + escapeHtml(item.slice(idx + query.length));
    } else {
      li.textContent = item;
    }
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const input = listEl.previousElementSibling;
      if (input) {
        input.value = item;
        input.focus();
      }
      listEl.classList.add('hidden');
    });
    listEl.appendChild(li);
  }
  listEl.classList.remove('hidden');
  listEl.dataset.activeIndex = '-1';
}

function clearAutocomplete(listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';
  listEl.classList.add('hidden');
  listEl.dataset.activeIndex = '-1';
}

function setupAutocomplete(inputId, listId, type) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!input || !list) return;

  function refreshSuggestions() {
    const query = input.value;
    const excludeId = AppState.editingMarkerId || null;
    const items = getMarkerNameSuggestions(type, query, excludeId);
    renderAutocompleteList(list, items, query);
  }

  input.addEventListener('input', refreshSuggestions);

  input.addEventListener('focus', () => {
    if (input.value.trim().length > 0) refreshSuggestions();
  });

  input.addEventListener('blur', () => {
    setTimeout(() => clearAutocomplete(list), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden')) return;
    const items = Array.from(list.querySelectorAll('li'));
    let activeIndex = parseInt(list.dataset.activeIndex || '-1', 10);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActiveItem(items, activeIndex, list);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      updateActiveItem(items, activeIndex, list);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        input.value = items[activeIndex].dataset.value;
        clearAutocomplete(list);
      }
    } else if (e.key === 'Escape') {
      clearAutocomplete(list);
    }
  });
}

function updateActiveItem(items, activeIndex, listEl) {
  items.forEach((li, idx) => li.classList.toggle('active', idx === activeIndex));
  listEl.dataset.activeIndex = String(activeIndex);
  const active = items[activeIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

async function saveLSMMarker() {
  const nombreMuestra = document.getElementById('lsm-nombre-muestra').value.trim();
  if (!nombreMuestra) { showToast('Ingresa el Nombre de Muestra', 'error'); return; }
  const lsmData = {
    semanaLaboratorio: document.getElementById('lsm-semana-laboratorio').value.trim(),
    tipoMaterial: document.getElementById('lsm-tipo-material').value.trim(),
    nombreMuestra: nombreMuestra,
    localizacion: document.getElementById('lsm-localizacion').value.trim(),
    fuente: document.getElementById('lsm-fuente').value.trim(),
    ensayos: Array.from(document.querySelectorAll('#lsm-ensayos-group input[type="checkbox"]:checked')).map(cb => cb.value)
  };
  const photoIds = [];
  const markerLatLng = AppState.editingMarkerId
    ? (() => {
        const m = MarkerManager.getById(AppState.editingMarkerId);
        return m ? { lat: m.lat, lng: m.lng } : null;
      })()
    : AppState.pendingMarkerLatLng;

  // Datos previos del marcador: sirven para saber si cambio algo que va estampado en la foto
  const oldMarker = AppState.editingMarkerId ? MarkerManager.getById(AppState.editingMarkerId) : null;
  const oldLsmData = (oldMarker && oldMarker.lsmData) || {};
  // Fecha estable: la del dia en que se creo el marcador, para que reeditar
  // semanas despues no cambie la fecha impresa en la foto.
  const fechaEstampado = oldMarker && oldMarker.createdAt
    ? getLocalDateString(new Date(oldMarker.createdAt))
    : getLocalDateString();

  for (const photo of AppState.pendingPhotos) {
    try {
      let blobToSave = photo.blob;
      if (photo.photoId) {
        // Foto existente: si cambio algun dato que se imprime en el estampado,
        // se vuelve a estampar partiendo de la foto cruda (nunca sobre la ya estampada).
        const stampDataChanged =
          (oldLsmData.localizacion || '') !== (lsmData.localizacion || '') ||
          ((oldMarker && oldMarker.name) || '') !== nombreMuestra;
        if (stampDataChanged && photo.originalBlob) {
          const restamped = await stampImage(photo.originalBlob, {
            nombreMuestra: nombreMuestra,
            localizacion: lsmData.localizacion,
            fecha: fechaEstampado,
            lat: markerLatLng ? markerLatLng.lat : null,
            lng: markerLatLng ? markerLatLng.lng : null
          });
          await MapStorage.updatePhotoBlob(photo.photoId, restamped.stampedBlob);
        } else if (stampDataChanged && !photo.originalBlob) {
          console.warn('[saveLSMMarker] Sin foto cruda guardada, no se re-estampa:', photo.photoId);
        }
        photoIds.push(photo.photoId);
      } else if (photo.blob) {
        const markerId = AppState.editingMarkerId || ('m_' + Date.now());
        if (markerLatLng && (photo.lat == null || photo.lng == null)) {
          const dataUrl = await blobToDataURL(photo.blob);
          const withGps = injectGpsExif(dataUrl, markerLatLng.lat, markerLatLng.lng);
          blobToSave = dataURLtoBlob(withGps);
        }
        const photoId = await MapStorage.savePhoto(blobToSave, markerId, photo.originalBlob || null);
        photoIds.push(photoId);
      }
    } catch (e) { console.error('Error saving photo:', e); }
  }
  if (AppState.editingMarkerId) {
    if (oldMarker && oldMarker.photos) {
      const removedPhotos = oldMarker.photos.filter(id => !photoIds.includes(id));
      for (const photoId of removedPhotos) {
        try { await MapStorage.deletePhoto(photoId); } catch (e) { console.warn('Could not delete old photo:', photoId); }
      }
    }
    MarkerManager.update(AppState.editingMarkerId, { name: nombreMuestra, color: AppState.lsmSelectedCategory, photos: photoIds, lsmData: lsmData, pendingUpload: true });
    showToast('Muestra LSM actualizada', 'success');
  } else if (AppState.pendingMarkerLatLng) {
    const { lat, lng } = AppState.pendingMarkerLatLng;
    MarkerManager.createLSM(lat, lng, AppState.lsmSelectedCategory, photoIds, lsmData, AppState.currentAltitude);
    showToast('Muestra LSM "' + nombreMuestra + '" guardada', 'success');
  }
  saveLastLSMForm(lsmData);
  autoLearnLSMConfig(lsmData);
  if (AppState.markersLayer) refreshMarkersOnMap();
  updateMarkerCountBadge();
  closeLSMMarkerModal();
}

// ============================================
// MARKER MODAL (QC)
// ============================================
async function openMarkerModal(latlng, editId) {
  AppState.pendingMarkerType = 'qc';
  AppState.pendingMarkerLatLng = latlng;
  AppState.editingMarkerId = editId || null;
  clearPendingPhotos();
  if (editId) {
    const marker = MarkerManager.getById(editId);
    if (!marker) return;
    document.getElementById('marker-modal-title').textContent = 'Editar Marcador';
    document.getElementById('marker-name').value = marker.name;
    document.getElementById('marker-description').value = marker.description || '';
    AppState.selectedCategory = marker.color || 'red';
    const [east, north] = proj4(WGS84, 'EPSG:24877', [marker.lng, marker.lat]);
    document.getElementById('marker-coords-display').textContent = formatNEZ(north, east, marker.altura);
    if (marker.photos && marker.photos.length > 0) {
      for (const photoId of marker.photos) {
        try {
          const photoRecord = await MapStorage.getPhoto(photoId);
          if (photoRecord && photoRecord.blob) {
            const dataUrl = await blobToDataURL(photoRecord.blob);
            AppState.pendingPhotos.push({ photoId: photoId, blob: photoRecord.blob, dataUrl: dataUrl });
          }
        } catch (e) { console.warn('Could not load photo:', photoId); }
      }
      renderPhotoGrid();
    }
  } else {
    document.getElementById('marker-modal-title').textContent = 'Nuevo Marcador';
    document.getElementById('marker-name').value = getDefaultMarkerName('qc');
    document.getElementById('marker-description').value = '';
    AppState.selectedCategory = 'red';
    const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
    document.getElementById('marker-coords-display').textContent = formatNEZ(north, east, AppState.currentAltitude);
  }
  updateCategorySelector();
  document.getElementById('marker-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('marker-name').focus(), 100);
}
function closeMarkerModal() {
  document.getElementById('marker-modal').classList.add('hidden');
  clearAutocomplete(document.getElementById('marker-name-suggestions'));
  AppState.pendingMarkerLatLng = null;
  AppState.editingMarkerId = null;
  AppState.isAddMarkerMode = false;
  clearPendingPhotos();
  document.getElementById('btn-add-marker').classList.remove('active');
}
async function saveMarker() {
  const name = document.getElementById('marker-name').value.trim();
  const description = document.getElementById('marker-description').value.trim();
  if (!name) { showToast('Ingresa un nombre', 'error'); return; }
  const photoIds = [];
  const markerLatLng = AppState.editingMarkerId
    ? (() => {
        const m = MarkerManager.getById(AppState.editingMarkerId);
        return m ? { lat: m.lat, lng: m.lng } : null;
      })()
    : AppState.pendingMarkerLatLng;

  for (const photo of AppState.pendingPhotos) {
    try {
      let blobToSave = photo.blob;
      if (photo.photoId) {
        photoIds.push(photo.photoId);
      } else if (photo.blob) {
        const markerId = AppState.editingMarkerId || ('m_' + Date.now());
        if (markerLatLng && (photo.lat == null || photo.lng == null)) {
          const dataUrl = await blobToDataURL(photo.blob);
          const withGps = injectGpsExif(dataUrl, markerLatLng.lat, markerLatLng.lng);
          blobToSave = dataURLtoBlob(withGps);
        }
        const photoId = await MapStorage.savePhoto(blobToSave, markerId, photo.originalBlob || null);
        photoIds.push(photoId);
      }
    } catch (e) { console.error('Error saving photo:', e); }
  }
  if (AppState.editingMarkerId) {
    const oldMarker = MarkerManager.getById(AppState.editingMarkerId);
    if (oldMarker && oldMarker.photos) {
      const removedPhotos = oldMarker.photos.filter(id => !photoIds.includes(id));
      for (const photoId of removedPhotos) {
        try { await MapStorage.deletePhoto(photoId); } catch (e) { console.warn('Could not delete old photo:', photoId); }
      }
    }
    MarkerManager.update(AppState.editingMarkerId, { name: name, description: description, color: AppState.selectedCategory, photos: photoIds });
    showToast('Marcador actualizado', 'success');
  } else if (AppState.pendingMarkerLatLng) {
    const { lat, lng } = AppState.pendingMarkerLatLng;
    MarkerManager.createQC(name, description, lat, lng, AppState.selectedCategory, photoIds, AppState.currentAltitude);
    showToast('Marcador "' + name + '" guardado', 'success');
  }
  if (AppState.markersLayer) refreshMarkersOnMap();
  updateMarkerCountBadge();
  closeMarkerModal();
}
function updateCategorySelector() {
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === AppState.selectedCategory);
  });
}

// ============================================
// MARKER DETAIL
// ============================================
async function openMarkerDetail(id) {
  const marker = MarkerManager.getById(id);
  if (!marker) return;
  const color = MARKER_COLORS[marker.color]?.hex || MARKER_COLORS.red.hex;
  const initial = marker.name.charAt(0).toUpperCase();
  document.getElementById('detail-marker-icon').style.background = color;
  document.getElementById('detail-marker-icon').textContent = initial;
  document.getElementById('detail-marker-name').textContent = marker.name;
  document.getElementById('detail-marker-date').textContent = formatDateTime(marker.createdAt);
  document.getElementById('detail-marker-category').textContent = MARKER_COLORS[marker.color]?.label || 'Rojo';
  const detailBody = document.querySelector('#marker-detail-modal .detail-body');
  if (marker.markerType === 'lsm') {
    const d = marker.lsmData || {};
    const ensayosStr = (d.ensayos || []).join(', ');
    detailBody.innerHTML = '<div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">LSM</span></div><div class="detail-row"><span class="detail-label">Semana Laboratorio</span><span class="detail-value">' + escapeHtml(d.semanaLaboratorio || '-') + '</span></div><div class="detail-row"><span class="detail-label">Tipo de Material</span><span class="detail-value">' + escapeHtml(d.tipoMaterial || '-') + '</span></div><div class="detail-row"><span class="detail-label">Localizacion</span><span class="detail-value">' + escapeHtml(d.localizacion || '-') + '</span></div><div class="detail-row"><span class="detail-label">Fuente</span><span class="detail-value">' + escapeHtml(d.fuente || '-') + '</span></div><div class="detail-row"><span class="detail-label">Ensayos</span><span class="detail-value">' + escapeHtml(ensayosStr || '-') + '</span></div><div class="detail-row"><span class="detail-label">Norte (PSAD56)</span><span class="detail-value">' + marker.norte + ' m</span></div><div class="detail-row"><span class="detail-label">Este (PSAD56)</span><span class="detail-value">' + marker.este + ' m</span></div><div class="detail-row"><span class="detail-label">Altura</span><span class="detail-value">' + (marker.altura != null ? marker.altura + ' m' : '-') + '</span></div><div class="detail-row"><span class="detail-label">Latitud (WGS84)</span><span class="detail-value">' + marker.lat.toFixed(8) + '</span></div><div class="detail-row"><span class="detail-label">Longitud (WGS84)</span><span class="detail-value">' + marker.lng.toFixed(8) + '</span></div><div id="detail-photos-row" class="detail-row detail-photos"><span class="detail-label">Fotos</span><div id="detail-marker-photos" class="detail-photo-grid"></div></div>';
  } else {
    detailBody.innerHTML = '<div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">QC</span></div><div class="detail-row"><span class="detail-label">Categoria</span><span class="detail-value">' + (MARKER_COLORS[marker.color]?.label || 'Rojo') + '</span></div><div class="detail-row"><span class="detail-label">Norte (PSAD56)</span><span class="detail-value">' + marker.norte + ' m</span></div><div class="detail-row"><span class="detail-label">Este (PSAD56)</span><span class="detail-value">' + marker.este + ' m</span></div><div class="detail-row"><span class="detail-label">Altura</span><span class="detail-value">' + (marker.altura != null ? marker.altura + ' m' : '-') + '</span></div><div class="detail-row"><span class="detail-label">Latitud (WGS84)</span><span class="detail-value">' + marker.lat.toFixed(8) + '</span></div><div class="detail-row"><span class="detail-label">Longitud (WGS84)</span><span class="detail-value">' + marker.lng.toFixed(8) + '</span></div><div id="detail-description-row" class="detail-row detail-description"><span class="detail-label">Descripcion</span><p id="detail-marker-description"></p></div><div id="detail-photos-row" class="detail-row detail-photos"><span class="detail-label">Fotos</span><div id="detail-marker-photos" class="detail-photo-grid"></div></div>';
    const descRow = document.getElementById('detail-description-row');
    if (marker.description) { descRow.classList.remove('hidden'); document.getElementById('detail-marker-description').textContent = marker.description; }
    else { descRow.classList.add('hidden'); }
  }
  const photosRow = document.getElementById('detail-photos-row');
  const photosGrid = document.getElementById('detail-marker-photos');
  photosGrid.innerHTML = '';
  if (marker.photos && marker.photos.length > 0) {
    photosRow.classList.remove('hidden');
    for (const photoId of marker.photos) {
      try {
        const photoRecord = await MapStorage.getPhoto(photoId);
        if (photoRecord && photoRecord.blob) {
          const dataUrl = await blobToDataURL(photoRecord.blob);
          const img = document.createElement('img');
          img.src = dataUrl;
          img.alt = 'Foto';
          img.addEventListener('click', () => { const win = window.open(); win.document.write('<img src="' + dataUrl + '" style="max-width:100%">'); });
          photosGrid.appendChild(img);
        }
      } catch (e) { console.warn('Could not load photo for detail:', photoId); }
    }
  } else { photosRow.classList.add('hidden'); }
  document.getElementById('marker-detail-modal').dataset.markerId = id;
  document.getElementById('marker-detail-modal').classList.remove('hidden');
}
function closeMarkerDetail() { document.getElementById('marker-detail-modal').classList.add('hidden'); }
function editCurrentMarker() {
  const id = document.getElementById('marker-detail-modal').dataset.markerId;
  const marker = MarkerManager.getById(id);
  if (!marker) return;
  closeMarkerDetail();
  if (marker.markerType === 'lsm') openLSMMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
  else openMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
}
async function deleteCurrentMarker() {
  const id = document.getElementById('marker-detail-modal').dataset.markerId;
  const marker = MarkerManager.getById(id);
  if (marker && marker.photos && marker.photos.length > 0) {
    for (const photoId of marker.photos) {
      try { await MapStorage.deletePhoto(photoId); } catch (e) { console.warn('Could not delete photo:', photoId); }
    }
  }
  MarkerManager.remove(id);
  if (AppState.markersLayer) refreshMarkersOnMap();
  updateMarkerCountBadge();
  closeMarkerDetail();
  showToast('Marcador eliminado', 'info');
}

// ============================================
// MARKERS ON MAP
// ============================================
function addMarkerToMap(marker) {
  const icon = createMarkerIcon(marker);
  const typeLabel = marker.markerType === 'lsm' ? 'LSM' : 'QC';
  const popupContent = '<div class="marker-popup">' +
    '<div class="marker-popup-title">' +
      '<span class="marker-popup-name">' + escapeHtml(marker.name) + '</span>' +
      '<span class="marker-item-type ' + marker.markerType + '">' + typeLabel + '</span>' +
    '</div>' +
    '<div class="marker-popup-coords">N: ' + marker.norte + ' | E: ' + marker.este +
      (marker.altura != null ? ' | Z: ' + marker.altura + ' m' : '') + '</div>' +
  '</div>';
  L.marker([marker.lat, marker.lng], { icon: icon }).bindPopup(popupContent).on('click', () => {
    AppState.map.setView([marker.lat, marker.lng], AppState.map.getZoom());
  }).addTo(AppState.markersLayer);
}
function refreshMarkersOnMap() {
  if (!AppState.markersLayer) return;
  AppState.markersLayer.clearLayers();
  MarkerManager.getAll()
    .filter(m => LayerManager.isActive(getMarkerDayLayer(m)))
    .forEach(m => addMarkerToMap(m));
}

// ============================================
// MARKERS SIDE PANEL
// ============================================
function openMarkersPanel() { renderMarkersList(); document.getElementById('markers-panel').classList.remove('hidden'); }
function closeMarkersPanel() { document.getElementById('markers-panel').classList.add('hidden'); }
function renderMarkersList(filter = '') {
  const container = document.getElementById('markers-list-container');
  let markers = MarkerManager.getAll();
  if (filter) {
    const q = filter.toLowerCase();
    markers = markers.filter(m => m.name.toLowerCase().includes(q) || (m.description && m.description.toLowerCase().includes(q)));
  }
  if (markers.length === 0) {
    container.innerHTML = '<p class="empty-msg">' + (filter ? 'Sin resultados' : 'No hay marcadores') + '</p>';
    return;
  }
  markers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  // Agrupar por capa diaria (fecha de creacion), grupos ordenados por fecha descendente
  const groups = {};
  markers.forEach(m => {
    const day = getMarkerDayLayer(m);
    if (!groups[day]) groups[day] = [];
    groups[day].push(m);
  });
  const days = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  container.innerHTML = days.map(day => {
    const active = LayerManager.isActive(day);
    const groupMarkers = groups[day];
    const dateLabel = formatDate(day + 'T12:00:00');
    const items = groupMarkers.map(m => {
      const color = MARKER_COLORS[m.color]?.hex || MARKER_COLORS.red.hex;
      const typeLabel = m.markerType === 'lsm' ? 'LSM' : 'QC';
      return '<div class="marker-item" data-id="' + m.id + '"><span class="marker-dot" style="background:' + color + ';"></span><div class="marker-item-info"><div class="marker-item-name"><span class="marker-name-text">' + escapeHtml(m.name) + '</span><span class="marker-item-type ' + m.markerType + '">' + typeLabel + '</span></div><div class="marker-item-coords">N: ' + m.norte + ' | E: ' + m.este + (m.altura != null ? ' | Z: ' + m.altura + ' m' : '') + '</div></div><div class="marker-item-actions"><button class="marker-item-btn marker-btn-edit" data-id="' + m.id + '" title="Editar" aria-label="Editar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="marker-item-btn marker-btn-delete" data-id="' + m.id + '" title="Eliminar" aria-label="Eliminar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"></path><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button></div></div>';
    }).join('');
    return '<div class="layer-group' + (active ? '' : ' layer-disabled') + '" data-day="' + day + '">' +
      '<div class="layer-group-header">' +
        '<label class="layer-toggle" title="Mostrar/ocultar en el mapa">' +
          '<input type="checkbox" class="layer-toggle-input" data-day="' + day + '"' + (active ? ' checked' : '') + '>' +
          '<span class="layer-toggle-slider"></span>' +
        '</label>' +
        '<span class="layer-group-title">' + dateLabel + '</span>' +
        '<span class="layer-group-count">' + groupMarkers.length + '</span>' +
      '</div>' +
      '<div class="layer-group-items">' + items + '</div>' +
    '</div>';
  }).join('');
  container.querySelectorAll('.layer-toggle-input').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const day = toggle.dataset.day;
      LayerManager.setActive(day, toggle.checked);
      const group = container.querySelector('.layer-group[data-day="' + day + '"]');
      if (group) group.classList.toggle('layer-disabled', !toggle.checked);
      if (AppState.markersLayer) refreshMarkersOnMap();
    });
  });
  container.querySelectorAll('.marker-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.marker-item-btn')) return;
      const id = item.dataset.id;
      const marker = MarkerManager.getById(id);
      if (marker) { AppState.map.setView([marker.lat, marker.lng], 17); closeMarkersPanel(); }
    });
  });
  container.querySelectorAll('.marker-item-btn.marker-btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const marker = MarkerManager.getById(id);
      if (marker) { closeMarkersPanel(); if (marker.markerType === 'lsm') openLSMMarkerModal({ lat: marker.lat, lng: marker.lng }, id); else openMarkerModal({ lat: marker.lat, lng: marker.lng }, id); }
    });
  });
  container.querySelectorAll('.marker-item-btn.marker-btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const marker = MarkerManager.getById(id);
      const name = marker ? marker.name : 'este marcador';
      if (!confirm('¿Eliminar "' + name + '"? Esta accion no se puede deshacer.')) return;
      MarkerManager.remove(id);
      if (AppState.markersLayer) refreshMarkersOnMap();
      updateMarkerCountBadge();
      renderMarkersList(document.getElementById('marker-search').value);
      showToast('Marcador eliminado', 'info');
    });
  });
}
function updateMarkerCountBadge() {
  const count = MarkerManager.getCount();
  const badge = document.getElementById('marker-count-badge');
  if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }
  document.getElementById('markers-count').textContent = count;
}

// ============================================
// ZIP + EXCEL EXPORT
// ============================================
function openExportModal() {
  const today = getLocalDateString();
  document.getElementById('export-today-date').textContent = formatDate(today);
  document.getElementById('export-date-from').value = today;
  document.getElementById('export-date-to').value = today;
  updateExportSummary();
  document.getElementById('export-modal').classList.remove('hidden');
}
function closeExportModal() { document.getElementById('export-modal').classList.add('hidden'); }
function getExportType() { return document.querySelector('input[name="export-type"]:checked').value; }
function getExportMarkers() {
  const markers = MarkerManager.getAll();
  const type = getExportType();
  if (type === 'today') {
    const todayStr = getLocalDateString();
    return markers.filter(m => m.createdAt && getMarkerDayLayer(m) === todayStr);
  } else {
    const fromStr = document.getElementById('export-date-from').value || getLocalDateString();
    const toStr = document.getElementById('export-date-to').value || getLocalDateString();
    const fromDate = new Date(fromStr + 'T00:00:00');
    const toDate = new Date(toStr + 'T23:59:59.999');
    return markers.filter(m => { if (!m.createdAt) return false; const d = new Date(m.createdAt); return d >= fromDate && d <= toDate; });
  }
}
function updateExportSummary() { document.getElementById('export-count').textContent = getExportMarkers().length; }
async function exportToZIP() {
  const markers = getExportMarkers();
  const tracks = await TrackManager.getAll();
  const dateType = getExportType();
  const fromStr = document.getElementById('export-date-from').value || getLocalDateString();
  const toStr = document.getElementById('export-date-to').value || getLocalDateString();
  const fromDate = new Date(fromStr + 'T00:00:00');
  const toDate = new Date(toStr + 'T23:59:59.999');

  const filteredTracks = dateType === 'today'
    ? tracks.filter(t => t.createdAt && getLocalDateString(new Date(t.createdAt)) === getLocalDateString())
    : tracks.filter(t => { if (!t.createdAt) return false; const d = new Date(t.createdAt); return d >= fromDate && d <= toDate; });

  if (markers.length === 0 && filteredTracks.length === 0) { showToast('No hay marcadores ni recorridos para exportar', 'error'); return; }
  showToast('Generando ZIP...', 'info');
  try {
    const zip = new JSZip();
    const folder = zip.folder('fotos');
    const folderCrudas = zip.folder('fotos_crudas');
    const wb = XLSX.utils.book_new();
    const qcMarkers = markers.filter(m => m.markerType === 'qc');
    const lsmMarkers = markers.filter(m => m.markerType === 'lsm');
    if (qcMarkers.length > 0) {
      const qcData = [['Nombre', 'Categoria', 'Descripcion', 'Norte (m)', 'Este (m)', 'Altura (m)', 'Latitud', 'Longitud', 'Fecha_Hora', 'Foto_1', 'Foto_2']];
      for (let i = 0; i < qcMarkers.length; i++) {
        const m = qcMarkers[i];
        const prefix = 'QC';
        const safeName = (m.name || 'SinNombre').replace(/[^a-zA-Z0-9]/g, '_');
        const rowNum = String(i + 1).padStart(3, '0');
        let foto1 = '', foto2 = '';
        if (m.photos && m.photos.length > 0) {
          for (let p = 0; p < m.photos.length && p < 2; p++) {
            const photoId = m.photos[p];
            try {
              const photoRecord = await MapStorage.getPhoto(photoId);
              if (photoRecord && photoRecord.blob) {
                const fileName = prefix + '_' + safeName + '_' + rowNum + '_foto' + (p + 1) + '.jpg';
                folder.file(fileName, photoRecord.blob);
                const original = photoRecord.originalBlob || (await MapStorage.getPhotoOriginal(photoId));
                if (original) {
                  folderCrudas.file(fileName.replace('.jpg', '_cruda.jpg'), original);
                }
                if (p === 0) foto1 = fileName;
                if (p === 1) foto2 = fileName;
              }
            } catch (e) { console.warn('Could not add photo to zip:', photoId); }
          }
        }
        qcData.push([m.name || '', MARKER_COLORS[m.color]?.label || '', m.description || '', m.norte, m.este, m.altura != null ? m.altura : '', m.lat, m.lng, new Date(m.createdAt), foto1, foto2]);
      }
      const wsQC = XLSX.utils.aoa_to_sheet(qcData, { cellDates: true });
      for (let r = 1; r < qcData.length; r++) {
        const addr = XLSX.utils.encode_col(7) + (r + 1);
        if (wsQC[addr] && wsQC[addr].v instanceof Date) {
          wsQC[addr].z = 'DD/MM/YYYY';
          wsQC[addr].t = 'd';
        }
      }
      XLSX.utils.book_append_sheet(wb, wsQC, 'QC');
    }
    if (lsmMarkers.length > 0) {
      const lsmData = [['Semana_Laboratorio', 'Fecha_Hora', 'Tipo_Material', 'Nombre_Muestra', 'Localizacion', 'Fuente', 'Este', 'Norte', 'Altura (m)', 'Ensayos', 'Latitud', 'Longitud', 'Foto_1', 'Foto_2']];
      for (let i = 0; i < lsmMarkers.length; i++) {
        const m = lsmMarkers[i];
        const d = m.lsmData || {};
        const prefix = 'LSM';
        const safeName = (m.name || 'SinNombre').replace(/[^a-zA-Z0-9]/g, '_');
        const rowNum = String(i + 1).padStart(3, '0');
        let foto1 = '', foto2 = '';
        if (m.photos && m.photos.length > 0) {
          for (let p = 0; p < m.photos.length && p < 2; p++) {
            const photoId = m.photos[p];
            try {
              const photoRecord = await MapStorage.getPhoto(photoId);
              if (photoRecord && photoRecord.blob) {
                const fileName = prefix + '_' + safeName + '_' + rowNum + '_foto' + (p + 1) + '.jpg';
                folder.file(fileName, photoRecord.blob);
                const original = photoRecord.originalBlob || (await MapStorage.getPhotoOriginal(photoId));
                if (original) {
                  folderCrudas.file(fileName.replace('.jpg', '_cruda.jpg'), original);
                }
                if (p === 0) foto1 = fileName;
                if (p === 1) foto2 = fileName;
              }
            } catch (e) { console.warn('Could not add photo to zip:', photoId); }
          }
        }
        lsmData.push([d.semanaLaboratorio || '', new Date(m.createdAt), d.tipoMaterial || '', m.name || '', d.localizacion || '', d.fuente || '', m.este, m.norte, m.altura != null ? m.altura : '', (d.ensayos || []).join(', '), m.lat, m.lng, foto1, foto2]);
      }
      const wsLSM = XLSX.utils.aoa_to_sheet(lsmData, { cellDates: true });
      for (let r = 1; r < lsmData.length; r++) {
        const addr = XLSX.utils.encode_col(1) + (r + 1);
        if (wsLSM[addr] && wsLSM[addr].v instanceof Date) {
          wsLSM[addr].z = 'DD/MM/YYYY';
          wsLSM[addr].t = 'd';
        }
      }
      XLSX.utils.book_append_sheet(wb, wsLSM, 'LSM');
    }

    // Recorridos / Tracks
    if (filteredTracks.length > 0) {
      const tracksFolder = zip.folder('recorridos');
      const trackData = [['Nombre', 'Fecha_Inicio', 'Fecha_Fin', 'Distancia_m', 'Distancia_km', 'Duracion_s', 'Duracion', 'Puntos', 'Alt_Min_m', 'Alt_Max_m', 'Alt_Prom_m']];
      for (const t of filteredTracks) {
        const geojson = trackToGeoJSON(t);
        const fileName = (t.name || 'recorrido').replace(/[^a-zA-Z0-9]/g, '_') + '.geojson';
        tracksFolder.file(fileName, JSON.stringify(geojson, null, 2));
        const altStats = getTrackAltitudeStats(t);
        trackData.push([
          t.name || '',
          t.startedAt || '',
          t.endedAt || '',
          t.distance || 0,
          ((t.distance || 0) / 1000).toFixed(3),
          t.duration || 0,
          formatDuration(t.duration || 0),
          (t.points || []).length,
          altStats ? Math.round(altStats.min) : '',
          altStats ? Math.round(altStats.max) : '',
          altStats ? Math.round(altStats.avg) : ''
        ]);
      }
      const wsTracks = XLSX.utils.aoa_to_sheet(trackData);
      XLSX.utils.book_append_sheet(wb, wsTracks, 'Recorridos');
    }

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    zip.file('marcadores.xlsx', excelBuffer);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, 'marcadores_' + new Date().toISOString().slice(0, 10) + '.zip');
    showToast(markers.length + ' marcadores, ' + filteredTracks.length + ' recorridos exportados', 'success');
    closeExportModal();
  } catch (error) { console.error('[exportToZIP]', error); showToast('Error al generar ZIP', 'error'); }
}

// ============================================
// MAPS LIST (HOME)
// ============================================
async function loadMapsList() {
  const container = document.getElementById('maps-list');
  try {
    const maps = await MapStorage.getAllMaps();
    document.getElementById('maps-count').textContent = maps.length;
    if (maps.length === 0) { container.innerHTML = '<p class="empty-msg">No hay mapas cargados</p>'; return; }
    let totalSize = 0;
    container.innerHTML = maps.map(map => {
      totalSize += map.size || 0;
      const typeIcon = map.type === 'pdf' ? '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16"/></svg>';
      return '<div class="map-card" data-id="' + map.id + '"><div class="map-card-icon">' + typeIcon + '</div><div class="map-card-info"><div class="map-card-name">' + escapeHtml(map.name) + '</div><div class="map-card-meta">' + (map.type || 'tiff').toUpperCase() + ' - ' + formatBytes(map.size) + ' - ' + formatDate(map.createdAt) + '</div></div><button class="map-card-delete" data-id="' + map.id + '" data-name="' + escapeHtml(map.name) + '" title="Eliminar">X</button></div>';
    }).join('');
    container.querySelectorAll('.map-card').forEach(card => {
      card.addEventListener('click', (e) => { if (!e.target.closest('.map-card-delete')) openMap(card.dataset.id); });
    });
    container.querySelectorAll('.map-card-delete').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openDeleteMapModal(btn.dataset.id, btn.dataset.name); });
    });
    // Alerta intuitiva si se alcanzo el limite de mapas
    if (maps.length >= 3) {
      const warningEl = document.createElement('div');
      warningEl.style.cssText = 'background:rgba(217,164,30,0.15);border:1px solid var(--warning);color:var(--warning);padding:10px 12px;border-radius:var(--radius-sm);font-size:0.8rem;text-align:center;margin-bottom:8px;';
      warningEl.textContent = 'Limite de 3 mapas alcanzado. Elimina uno para cargar otro.';
      container.insertBefore(warningEl, container.firstChild);
    }
    const storageInfoEl = document.getElementById('storage-info');
    if (storageInfoEl) storageInfoEl.textContent = formatBytes(totalSize) + ' usado';
  } catch (error) { container.innerHTML = '<p class="empty-msg">Error al cargar mapas</p>'; }
}

// ============================================
// FILE UPLOAD (TIFF + PDF)
// ============================================
async function handleFileUpload(file) {
  if (!file) return;
  const maps = await MapStorage.getAllMaps();
  if (maps.length >= 3) {
    showToast('Limite de 3 mapas alcanzado. Elimina un mapa existente para cargar uno nuevo.', 'error');
    document.getElementById('map-input').value = '';
    return;
  }
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (ext === '.tif' || ext === '.tiff') handleTIFFUpload(file);
  else if (ext === '.pdf') handlePDFUpload(file);
  else showToast('Solo archivos .TIF, .TIFF o .PDF', 'error');
}
function handleTIFFUpload(file) {
  const progressEl = document.getElementById('upload-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressText = progressEl.querySelector('.progress-text');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '30%';
  progressText.textContent = 'Leyendo archivo...';
  const reader = new FileReader();
  reader.onprogress = (e) => { if (e.lengthComputable) progressFill.style.width = (Math.round((e.loaded / e.total) * 70) + 30) + '%'; };
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
      setTimeout(() => { progressEl.classList.add('hidden'); progressFill.style.width = '0%'; }, 1500);
    } catch (error) { showToast(error.message || 'Error al guardar', 'error'); progressEl.classList.add('hidden'); }
  };
  reader.onerror = () => { showToast('Error al leer archivo', 'error'); progressEl.classList.add('hidden'); };
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
    const arrayBufferForStorage = arrayBuffer.slice(0);
    const processed = await PDFProcessor.processPDF(arrayBuffer.slice(0));
    progressFill.style.width = '60%';
    progressText.textContent = 'Renderizando...';
    const previewCanvas = document.getElementById('pdf-preview-canvas');
    const ctx = previewCanvas.getContext('2d');
    previewCanvas.width = processed.canvas.width;
    previewCanvas.height = processed.canvas.height;
    ctx.drawImage(processed.canvas, 0, 0);
    AppState.pendingPDF = { name: file.name, arrayBuffer: arrayBufferForStorage, size: file.size, isGeoPDF: processed.isGeoPDF, geoData: processed.geoData || null, renderRotation: processed.renderRotation };
    const geoData = processed.geoData;
    if (geoData && geoData.corners) {
      progressText.textContent = 'Coordenadas detectadas!';
      const crs = geoData.crs || 'EPSG:4326';
      const c = geoData.corners;
      // Guardamos coordenadas originales para poder recalcular si el usuario
      // cambia el datum de origen en el modal.
      AppState.pendingPDF.sourceCrs = crs;
      AppState.pendingPDF.sourceCorners = { tl: c.tl.slice(), tr: c.tr.slice(), bl: c.bl.slice(), br: c.br.slice() };
      const sourceDatum = inferSourceDatum(crs, geoData);
      AppState.pendingPDF.sourceDatum = sourceDatum;

      // Normalizar a UTM PSAD56 (EPSG:24877) para el modal.
      const cornersUTM = {};
      for (const key of ['tl', 'tr', 'bl', 'br']) {
        cornersUTM[key] = convertCornerToUTMPSAD56(c[key], crs, sourceDatum);
      }
      document.getElementById('georef-tl-e').value = cornersUTM.tl[0].toFixed(2);
      document.getElementById('georef-tl-n').value = cornersUTM.tl[1].toFixed(2);
      document.getElementById('georef-tr-e').value = cornersUTM.tr[0].toFixed(2);
      document.getElementById('georef-tr-n').value = cornersUTM.tr[1].toFixed(2);
      document.getElementById('georef-bl-e').value = cornersUTM.bl[0].toFixed(2);
      document.getElementById('georef-bl-n').value = cornersUTM.bl[1].toFixed(2);
      document.getElementById('georef-br-e').value = cornersUTM.br[0].toFixed(2);
      document.getElementById('georef-br-n').value = cornersUTM.br[1].toFixed(2);
      document.getElementById('georef-crs').value = 'EPSG:24877';
      document.getElementById('georef-datum').value = sourceDatum;
      console.log('[handlePDFUpload] CRS entrada:', crs, '| datum inferido:', sourceDatum, '| corners UTM:', cornersUTM);
      showToast('Coordenadas detectadas!', 'success');
    } else {
      progressText.textContent = 'Ingresa coordenadas';
      document.getElementById('georef-crs').value = 'EPSG:24877';
      showToast('PDF sin georreferenciacion', 'info');
    }
    document.getElementById('georef-modal').classList.remove('hidden');
  } catch (error) { showToast('Error al procesar PDF: ' + error.message, 'error'); progressEl.classList.add('hidden'); }
}

// ============================================
// GEOREFERENCING MODAL
// ============================================
function closeGeorefModal() {
  document.getElementById('georef-modal').classList.add('hidden');
  AppState.pendingPDF = null;
}
function recalcGeorefFromDatum() {
  const pending = AppState.pendingPDF;
  if (!pending || !pending.sourceCorners) return;
  const sourceDatum = document.getElementById('georef-datum').value;
  AppState.pendingPDF.sourceDatum = sourceDatum;
  const cornersUTM = {};
  for (const key of ['tl', 'tr', 'bl', 'br']) {
    cornersUTM[key] = convertCornerToUTMPSAD56(pending.sourceCorners[key], pending.sourceCrs, sourceDatum);
  }
  document.getElementById('georef-tl-e').value = cornersUTM.tl[0].toFixed(2);
  document.getElementById('georef-tl-n').value = cornersUTM.tl[1].toFixed(2);
  document.getElementById('georef-tr-e').value = cornersUTM.tr[0].toFixed(2);
  document.getElementById('georef-tr-n').value = cornersUTM.tr[1].toFixed(2);
  document.getElementById('georef-bl-e').value = cornersUTM.bl[0].toFixed(2);
  document.getElementById('georef-bl-n').value = cornersUTM.bl[1].toFixed(2);
  document.getElementById('georef-br-e').value = cornersUTM.br[0].toFixed(2);
  document.getElementById('georef-br-n').value = cornersUTM.br[1].toFixed(2);
}

async function applyGeoref() {
  const crs = document.getElementById('georef-crs').value;
  const sourceDatum = document.getElementById('georef-datum').value;
  const tlE = parseFloat(document.getElementById('georef-tl-e').value);
  const tlN = parseFloat(document.getElementById('georef-tl-n').value);
  const trE = parseFloat(document.getElementById('georef-tr-e').value);
  const trN = parseFloat(document.getElementById('georef-tr-n').value);
  const blE = parseFloat(document.getElementById('georef-bl-e').value);
  const blN = parseFloat(document.getElementById('georef-bl-n').value);
  const brE = parseFloat(document.getElementById('georef-br-e').value);
  const brN = parseFloat(document.getElementById('georef-br-n').value);
  if ([tlE, tlN, trE, trN, blE, blN, brE, brN].some(v => isNaN(v))) { showToast('Completa coordenadas', 'error'); return; }
  const pending = AppState.pendingPDF;
  if (!pending) { showToast('Error: no hay PDF', 'error'); return; }
  const previewCanvas = document.getElementById('pdf-preview-canvas');
  const thumbCanvas = document.createElement('canvas');
  const scale = 200 / previewCanvas.width;
  thumbCanvas.width = 200;
  thumbCanvas.height = previewCanvas.height * scale;
  thumbCanvas.getContext('2d').drawImage(previewCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.5);
  const georef = { corners: { tl: [tlE, tlN], tr: [trE, trN], bl: [blE, blN], br: [brE, brN] }, crs: crs, renderRotation: pending.renderRotation, sourceDatum: sourceDatum };
  if (pending.sourceCrs) georef.sourceCrs = pending.sourceCrs;
  try {
    await MapStorage.savePDFMap(pending.name, pending.arrayBuffer, pending.size, georef, thumbnail);
    showToast('PDF guardado', 'success');
    closeGeorefModal();
    await loadMapsList();
    document.getElementById('map-input').value = '';
  } catch (error) { showToast(error.message || 'Error al guardar PDF', 'error'); }
}

// ============================================
// OPEN MAP VIEW
// ============================================
function updateModeToggleButton() {
  const btn = document.getElementById('btn-mode-toggle');
  const label = document.getElementById('mode-label');
  if (!btn || !label) return;
  if (AppState.currentMarkerMode === 'lsm') { label.textContent = 'LSM'; btn.classList.add('mode-lsm'); }
  else { label.textContent = 'QC'; btn.classList.remove('mode-lsm'); }
}
async function openMap(mapId) {
  resetMapVisualRotation(); // cada mapa se abre sin rotación visual previa
  AppState.currentMapId = mapId;
  const maps = await MapStorage.getAllMaps();
  const map = maps.find(m => m.id === mapId);
  AppState.currentMapType = map ? (map.type || 'tiff') : 'tiff';
  AppState.mapTitle = map ? map.name : 'Mapa';
  document.getElementById('map-title').textContent = AppState.mapTitle;
  AppState.currentMarkerMode = localStorage.getItem('maps_gis_marker_mode') || AppState.currentMarkerMode || 'qc';
  updateModeToggleButton();
  showScreen('map-screen');
  stopMeasurement();
  initMap();
  setTimeout(() => AppState.map.invalidateSize(), 200);
  if (AppState.currentMapType === 'pdf') await loadPDFMap(mapId);
  else await loadGeoTiff(mapId);
  refreshMarkersOnMap();
  await renderTracksOnMap();
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
  try { await MapStorage.deleteMap(pendingDeleteMapId); showToast('Mapa eliminado', 'info'); await loadMapsList(); }
  catch { showToast('Error al eliminar', 'error'); }
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
    if (isLight) { AppState.map.removeLayer(AppState.darkTiles); AppState.lightTiles.addTo(AppState.map); }
    else { AppState.map.removeLayer(AppState.lightTiles); AppState.darkTiles.addTo(AppState.map); }
  }
  localStorage.setItem('maps_gis_theme', isLight ? 'light' : 'dark');
}
function loadThemePreference() {
  if (localStorage.getItem('maps_gis_theme') === 'light') document.body.classList.add('light-mode');
}

// ============================================
// EVENT LISTENERS
// ============================================
function initEventListeners() {
  document.getElementById('map-input').addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileUpload(e.target.files[0]); });
  document.getElementById('btn-back').addEventListener('click', () => {
    resetMapVisualRotation(); // al salir del mapa se limpia la rotación visual
    stopLocationTracking();   // y se detiene el seguimiento GPS continuo
    stopFollowLocation();     // limpia el estado visual del botón de ubicación
    destroyCachedPdfDoc();    // libera el PDF cacheado y oculta el panel de capas
    if (AppState.isTracking) {
      if (!confirm('Hay un recorrido en curso. ¿Salir y guardarlo?')) return;
      stopTrack().finally(() => {
        stopMeasurement();
        exitMarkerPlacement();
        closeMarkerPlacementModal();
        showScreen('home-screen');
        loadMapsList();
        updateMarkerCountBadge();
      });
    } else {
      stopMeasurement();
      exitMarkerPlacement();
      closeMarkerPlacementModal();
      showScreen('home-screen');
      loadMapsList();
      updateMarkerCountBadge();
    }
  });
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-location').addEventListener('click', goToMyLocation);
  document.getElementById('btn-center').addEventListener('click', () => { if (AppState.mapOverlay) AppState.map.fitBounds(AppState.mapOverlay.getBounds()); });
  document.getElementById('btn-add-marker').addEventListener('click', () => {
    AppState.isAddMarkerMode = !AppState.isAddMarkerMode;
    document.getElementById('btn-add-marker').classList.toggle('active', AppState.isAddMarkerMode);
    if (AppState.isAddMarkerMode) {
      if (AppState.isMeasurementMode) stopMeasurement();
      openMarkerPlacementModal();
    } else {
      exitMarkerPlacement();
      closeMarkerPlacementModal();
      showToast('Modo marcador desactivado', 'info');
    }
  });
  document.getElementById('btn-measure').addEventListener('click', toggleMeasurementMode);
  document.getElementById('btn-close-measurement').addEventListener('click', stopMeasurement);
  document.getElementById('btn-measure-finish').addEventListener('click', finishMeasurement);
  document.getElementById('btn-measure-clear').addEventListener('click', clearMeasurement);
  document.getElementById('btn-measure-undo')?.addEventListener('click', undoMeasurementPoint);
  document.getElementById('btn-measure-add-point')?.addEventListener('click', () => {
    if (AppState.map && AppState.isMeasurementMode && !AppState.measurementFinished) {
      addMeasurementPoint(AppState.map.getCenter());
    }
  });
  document.querySelectorAll('.measurement-type-btn').forEach(btn => {
    btn.addEventListener('click', () => setMeasurementType(btn.dataset.type));
  });
  document.getElementById('btn-go-to-coords').addEventListener('click', openGoToCoordsModal);
  document.getElementById('btn-cancel-goto').addEventListener('click', closeGoToCoordsModal);
  document.getElementById('btn-confirm-goto').addEventListener('click', confirmGoToCoords);
  document.getElementById('btn-goto-qc').addEventListener('click', () => selectGotoType('qc'));
  document.getElementById('btn-goto-lsm').addEventListener('click', () => selectGotoType('lsm'));
  document.getElementById('btn-place-crosshair').addEventListener('click', () => selectMarkerPlacement('crosshair'));
  document.getElementById('btn-place-gps').addEventListener('click', () => selectMarkerPlacement('gps'));
  document.getElementById('btn-cancel-placement').addEventListener('click', () => {
    closeMarkerPlacementModal();
    exitMarkerPlacement();
    AppState.isAddMarkerMode = false;
    document.getElementById('btn-add-marker').classList.remove('active');
    showToast('Modo marcador desactivado', 'info');
  });
  document.getElementById('btn-place-here').addEventListener('click', () => {
    if (AppState.map && AppState.isAddMarkerMode) placeMarkerAt(AppState.map.getCenter());
  });
  var gotoNorte = document.getElementById('goto-norte');
  var gotoEste = document.getElementById('goto-este');
  if (gotoNorte) gotoNorte.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmGoToCoords(); if (e.key === 'Escape') closeGoToCoordsModal(); });
  if (gotoEste) gotoEste.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmGoToCoords(); if (e.key === 'Escape') closeGoToCoordsModal(); });
  document.getElementById('btn-mode-toggle').addEventListener('click', () => {
    AppState.currentMarkerMode = AppState.currentMarkerMode === 'qc' ? 'lsm' : 'qc';
    localStorage.setItem('maps_gis_marker_mode', AppState.currentMarkerMode);
    updateModeToggleButton();
    showToast('Modo: ' + (AppState.currentMarkerMode === 'lsm' ? 'LSM' : 'QC'), 'info');
  });
  document.getElementById('btn-save-marker').addEventListener('click', saveMarker);
  document.getElementById('btn-cancel-marker').addEventListener('click', closeMarkerModal);
  document.getElementById('marker-name').addEventListener('keydown', (e) => {
    const list = document.getElementById('marker-name-suggestions');
    const activeIndex = parseInt(list?.dataset.activeIndex || '-1', 10);
    if (e.key === 'Enter' && activeIndex < 0) saveMarker();
    if (e.key === 'Escape') closeMarkerModal();
  });
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => { AppState.selectedCategory = btn.dataset.color; updateCategorySelector(); });
  });
  document.getElementById('btn-close-detail').addEventListener('click', closeMarkerDetail);
  document.getElementById('btn-edit-marker').addEventListener('click', editCurrentMarker);
  document.getElementById('btn-delete-marker').addEventListener('click', deleteCurrentMarker);
  document.getElementById('btn-add-photo').addEventListener('click', () => { document.getElementById('photo-input').click(); });
  document.getElementById('photo-input').addEventListener('change', (e) => { if (e.target.files.length > 0) { handlePhotoCapture(e.target.files[0], AppState.pendingMarkerLatLng); e.target.value = ''; } });
  document.getElementById('btn-export').addEventListener('click', openExportModal);
  document.getElementById('btn-calibrate').addEventListener('click', showCalibrationPanel);
  document.getElementById('btn-pdf-layers').addEventListener('click', openPdfLayersPanel);
  document.getElementById('btn-close-pdf-layers').addEventListener('click', closePdfLayersPanel);
  document.getElementById('btn-pdf-layers-all').addEventListener('click', () => setAllPdfLayers(true));
  document.getElementById('btn-pdf-layers-none').addEventListener('click', () => setAllPdfLayers(false));
  document.getElementById('btn-markers-panel').addEventListener('click', openMarkersPanel);
  document.getElementById('btn-close-panel').addEventListener('click', closeMarkersPanel);
  document.getElementById('btn-export-panel').addEventListener('click', openExportModal);

  // Tracking / recorridos
  const btnTrack = document.getElementById('btn-track');
  if (btnTrack) {
    btnTrack.addEventListener('click', handleTrackButtonClick);
  }
  document.getElementById('btn-tracks-panel')?.addEventListener('click', openTracksPanel);
  document.getElementById('btn-close-tracks-panel')?.addEventListener('click', closeTracksPanel);
  document.getElementById('btn-confirm-track-name')?.addEventListener('click', confirmStartTrack);
  document.getElementById('btn-cancel-track-name')?.addEventListener('click', closeTrackNameModal);
  document.getElementById('track-name-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmStartTrack(); if (e.key === 'Escape') closeTrackNameModal(); });
  document.getElementById('marker-search').addEventListener('input', (e) => { renderMarkersList(e.target.value); });
  document.getElementById('btn-cancel-export').addEventListener('click', closeExportModal);
  document.getElementById('btn-confirm-export').addEventListener('click', exportToZIP);
  document.querySelectorAll('input[name="export-type"]').forEach(radio => {
    radio.addEventListener('change', () => { document.getElementById('export-range-fields').classList.toggle('hidden', getExportType() !== 'range'); updateExportSummary(); });
  });
  document.getElementById('export-date-from').addEventListener('change', updateExportSummary);
  document.getElementById('export-date-to').addEventListener('change', updateExportSummary);
  document.getElementById('btn-confirm-delete').addEventListener('click', confirmDeleteMap);
  document.getElementById('btn-cancel-delete').addEventListener('click', () => { pendingDeleteMapId = null; document.getElementById('delete-map-modal').classList.add('hidden'); });
  document.getElementById('btn-apply-georef').addEventListener('click', applyGeoref);
  document.getElementById('btn-cancel-georef').addEventListener('click', closeGeorefModal);
  document.getElementById('georef-datum').addEventListener('change', recalcGeorefFromDatum);
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        if (modal.id === 'marker-modal') closeMarkerModal();
        else if (modal.id === 'georef-modal') closeGeorefModal();
        else if (modal.id === 'export-modal') closeExportModal();
        else if (modal.id === 'marker-type-modal') closeMarkerTypeModal();
        else if (modal.id === 'lsm-login-modal') closeLSMLoginModal();
        else if (modal.id === 'lsm-marker-modal') closeLSMMarkerModal();
        else if (modal.id === 'config-modal') closeConfigModal();
        else if (modal.id === 'inline-config-modal') closeInlineConfigEditor();
        else if (modal.id === 'marker-detail-modal') closeMarkerDetail();
        else if (modal.id === 'go-to-coords-modal') closeGoToCoordsModal();
        else if (modal.id === 'delete-map-modal') { pendingDeleteMapId = null; modal.classList.add('hidden'); }
        else if (modal.id === 'photo-preview-modal') closePhotoPreview();
        else if (modal.id === 'track-name-modal') closeTrackNameModal();
        else modal.classList.add('hidden');
      }
    });
  });
  document.getElementById('btn-type-qc').addEventListener('click', () => selectMarkerType('qc'));
  document.getElementById('btn-type-lsm').addEventListener('click', () => selectMarkerType('lsm'));
  document.getElementById('btn-cancel-type').addEventListener('click', closeMarkerTypeModal);
  document.getElementById('btn-confirm-lsm-login').addEventListener('click', confirmLSMLogin);
  document.getElementById('btn-cancel-lsm-login').addEventListener('click', closeLSMLoginModal);
  document.getElementById('lsm-nickname').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmLSMLogin(); });
  document.getElementById('btn-save-lsm-marker').addEventListener('click', saveLSMMarker);
  document.getElementById('btn-cancel-lsm-marker').addEventListener('click', closeLSMMarkerModal);
  document.getElementById('lsm-nombre-muestra').addEventListener('keydown', (e) => {
    const list = document.getElementById('lsm-name-suggestions');
    const activeIndex = parseInt(list?.dataset.activeIndex || '-1', 10);
    if (e.key === 'Enter' && activeIndex < 0) saveLSMMarker();
  });
  document.querySelectorAll('#lsm-category-selector .category-btn').forEach(btn => {
    btn.addEventListener('click', () => { AppState.lsmSelectedCategory = btn.dataset.color; updateLSMCategorySelector(); });
  });
  document.getElementById('btn-lsm-add-photo').addEventListener('click', () => { document.getElementById('lsm-photo-input').click(); });
  document.getElementById('lsm-photo-input').addEventListener('change', (e) => { if (e.target.files.length > 0) { handlePhotoCapture(e.target.files[0], AppState.pendingMarkerLatLng); e.target.value = ''; } });

  // Photo preview modal
  document.getElementById('btn-close-photo-preview').addEventListener('click', closePhotoPreview);
  document.getElementById('btn-accept-photo-preview').addEventListener('click', closePhotoPreview);
  document.getElementById('btn-delete-photo-preview').addEventListener('click', deletePendingPhotoFromPreview);
  document.getElementById('btn-retake-photo-preview').addEventListener('click', retakePhoto);

  // Config button (local only)
  document.getElementById('btn-config').addEventListener('click', openConfigModal);
  document.getElementById('btn-close-config').addEventListener('click', closeConfigModal);

  // Editor de opciones inline (desde el formulario LSM)
  document.querySelectorAll('.btn-manage-field[data-config-key]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openInlineConfigEditor(btn.dataset.configKey);
    });
  });
  document.getElementById('btn-inline-config-add').addEventListener('click', addInlineConfigValue);
  document.getElementById('inline-config-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addInlineConfigValue(); }
  });
  document.getElementById('btn-close-inline-config').addEventListener('click', closeInlineConfigEditor);
  document.getElementById('btn-done-inline-config').addEventListener('click', closeInlineConfigEditor);

  // Device setup
  document.getElementById('btn-save-device-name').addEventListener('click', saveDeviceName);
  document.getElementById('device-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveDeviceName(); });

  // Sync button
  const syncBtn = document.getElementById('btn-sync');
  if (syncBtn) syncBtn.addEventListener('click', () => SyncManager.syncAllPending(true));

  // Force app update button
  const updateBtn = document.getElementById('btn-update-app');
  if (updateBtn) updateBtn.addEventListener('click', forceAppUpdate);

  // Autocomplete de nombres de marcadores
  setupAutocomplete('marker-name', 'marker-name-suggestions', 'qc');
  setupAutocomplete('lsm-nombre-muestra', 'lsm-name-suggestions', 'lsm');
}

// ============================================
// CONFIG MODAL (LOCAL ONLY)
// ============================================
const STAMP_LOGO_SIZE_KEY = 'maps_gis_logo_size';
const STAMP_FONT_SIZE_KEY = 'maps_gis_stamp_font_size';
const DEFAULT_STAMP_LOGO_SIZE = 25;
const DEFAULT_STAMP_FONT_SIZE = 30;

function getStampConfig() {
  const logoSize = parseInt(localStorage.getItem(STAMP_LOGO_SIZE_KEY), 10);
  const fontSize = parseInt(localStorage.getItem(STAMP_FONT_SIZE_KEY), 10);
  return {
    logoSize: isNaN(logoSize) ? DEFAULT_STAMP_LOGO_SIZE : Math.max(15, Math.min(150, logoSize)),
    fontSize: isNaN(fontSize) ? DEFAULT_STAMP_FONT_SIZE : Math.max(12, Math.min(80, fontSize))
  };
}

function setStampConfig(logoSize, fontSize) {
  localStorage.setItem(STAMP_LOGO_SIZE_KEY, String(Math.max(15, Math.min(150, logoSize))));
  localStorage.setItem(STAMP_FONT_SIZE_KEY, String(Math.max(12, Math.min(80, fontSize))));
}

function initStampConfig() {
  const logoRange = document.getElementById('stamp-logo-size');
  const logoNumber = document.getElementById('stamp-logo-size-number');
  const fontRange = document.getElementById('stamp-font-size');
  const fontNumber = document.getElementById('stamp-font-size-number');
  const canvas = document.getElementById('stamp-preview-canvas');
  if (!logoRange || !logoNumber || !fontRange || !fontNumber || !canvas) return;

  const cfg = getStampConfig();
  logoRange.value = cfg.logoSize;
  logoNumber.value = cfg.logoSize;
  fontRange.value = cfg.fontSize;
  fontNumber.value = cfg.fontSize;

  const update = () => {
    const logoSize = parseInt(logoRange.value, 10);
    const fontSize = parseInt(fontRange.value, 10);
    logoNumber.value = logoSize;
    fontNumber.value = fontSize;
    setStampConfig(logoSize, fontSize);
    renderStampPreview(canvas, logoSize, fontSize);
  };

  logoRange.addEventListener('input', update);
  fontRange.addEventListener('input', update);
  logoNumber.addEventListener('change', () => {
    const v = parseInt(logoNumber.value, 10);
    if (!isNaN(v)) {
      logoRange.value = v;
      update();
    }
  });
  fontNumber.addEventListener('change', () => {
    const v = parseInt(fontNumber.value, 10);
    if (!isNaN(v)) {
      fontRange.value = v;
      update();
    }
  });

  renderStampPreview(canvas, cfg.logoSize, cfg.fontSize);

  // Boton para probar estampado con camara real
  const btnTestCamera = document.getElementById('btn-test-stamp-camera');
  const inputTestCamera = document.getElementById('test-stamp-photo-input');
  if (btnTestCamera && inputTestCamera) {
    btnTestCamera.addEventListener('click', () => inputTestCamera.click());
    inputTestCamera.addEventListener('change', async (e) => {
      if (e.target.files.length === 0) return;
      const file = e.target.files[0];
      e.target.value = '';
      try {
        showToast('Procesando foto de prueba...', 'info');
        const markerData = {
          nombreMuestra: 'Nombre de muestra',
          localizacion: 'Localizacion',
          fecha: new Date().toISOString().slice(0, 10)
        };
        const stamped = await stampImage(file, markerData);
        const stampedUrl = await blobToDataURL(stamped.stampedBlob);
        openPhotoPreview(stampedUrl, 'Vista previa de estampado');
        showToast('Vista previa actualizada', 'success');
      } catch (err) {
        console.error('[testStampWithCamera]', err);
        showToast('Error al procesar foto de prueba', 'error');
      }
    });
  }
}

async function renderStampPreview(canvas, logoSize, fontSize) {
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const isLight = document.body.classList.contains('light-mode');

  // Fondo
  ctx.fillStyle = isLight ? '#f6f8fb' : '#0a0f1a';
  ctx.fillRect(0, 0, width, height);

  // Simular ancho de foto para escala proporcional de fuente
  const previewPhotoWidth = 1600;
  const scaledFontSize = Math.max(12, Math.round(fontSize * (previewPhotoWidth / 1600)));

  // Dibujar texto izquierdo
  const lines = ['2026-07-05', 'Localizacion', 'Nombre de muestra'];
  ctx.font = `bold ${scaledFontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const lineHeight = scaledFontSize * 1.3;
  const textX = 10;
  const bottomMargin = 10;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const y = height - bottomMargin - (i * lineHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.max(2, scaledFontSize * 0.15);
    ctx.strokeText(text, textX, y);
    ctx.fillStyle = 'white';
    ctx.fillText(text, textX, y);
  }

  // Dibujar logo derecho
  try {
    const logoUrl = await loadLogoDataUrl();
    const logo = await loadImage(logoUrl);
    const aspect = logo.width / logo.height;
    const drawHeight = logoSize;
    const drawWidth = drawHeight * aspect;
    const logoX = width - drawWidth - 10;
    const logoY = height - drawHeight - 10;
    ctx.drawImage(logo, logoX, logoY, drawWidth, drawHeight);
  } catch (e) {
    // Fallback: rectangulo con etiqueta
    ctx.fillStyle = '#f97316';
    ctx.fillRect(width - 50, height - 30, 40, 20);
    ctx.fillStyle = 'white';
    ctx.font = '10px sans-serif';
    ctx.fillText('LOGO', width - 48, height - 16);
  }
}

function openConfigModal() {
  renderConfigSections();
  initStampConfig();
  document.getElementById('config-modal').classList.remove('hidden');
}
function closeConfigModal() {
  document.getElementById('config-modal').classList.add('hidden');
}
function renderConfigSections() {
  const container = document.getElementById('config-sections');
  const labels = {
    tipo_material: 'Tipo de Material', localizacion: 'Localizacion',
    fuente: 'Fuente', ensayos: 'Ensayos'
  };

  const existingSections = container.querySelectorAll('.config-section');
  const isFirstRender = existingSections.length === 0;

  if (isFirstRender) {
    container.innerHTML = '';
    CONFIG_KEYS.forEach(key => {
      const section = document.createElement('div');
      section.className = 'config-section open';
      section.dataset.key = key;
      section.innerHTML =
        '<div class="config-section-header"><h4>' + labels[key] + '</h4><span class="config-section-toggle">&#9650;</span></div>' +
        '<div class="config-section-body"><div class="config-tag-list"></div><div class="config-input-row"><input type="text" placeholder="Nueva opcion..." maxlength="50"><button class="btn-primary btn-sm btn-add-config">Agregar</button></div></div>';
      container.appendChild(section);
      section.querySelector('.config-section-header').addEventListener('click', () => { section.classList.toggle('open'); });
      const addBtn = section.querySelector('.btn-add-config');
      const input = section.querySelector('input');
      const doAdd = async () => {
        const val = input.value.trim();
        if (!val) { showToast('Ingresa un valor', 'error'); return; }
        if (ConfigManager.addValue(key, val)) {
          input.value = '';
          const tagList = section.querySelector('.config-tag-list');
          const tag = createConfigTag(key, val);
          tagList.appendChild(tag);
          showToast('Agregado: ' + val, 'success');
        } else { showToast('Opcion duplicada o vacia', 'error'); }
      };
      addBtn.addEventListener('click', doAdd);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    });
  }

  // Refresh tag lists
  CONFIG_KEYS.forEach(key => {
    const section = container.querySelector('.config-section[data-key="' + key + '"]');
    if (!section) return;
    const values = ConfigManager.getValues(key);
    const tagList = section.querySelector('.config-tag-list');
    const currentTags = Array.from(tagList.querySelectorAll('.config-tag'));
    const currentValues = currentTags.map(tag => tag.dataset.val);
    currentTags.forEach(tag => { if (!values.includes(tag.dataset.val)) tag.remove(); });
    values.forEach(val => {
      if (!currentValues.includes(val)) {
        const tag = createConfigTag(key, val);
        tagList.appendChild(tag);
      }
    });
  });
}

function createConfigTag(key, val) {
  const tag = document.createElement('span');
  tag.className = 'config-tag';
  tag.dataset.val = val;
  tag.innerHTML = escapeHtml(val) + '<button>&times;</button>';
  tag.querySelector('button').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (ConfigManager.removeValue(key, val)) {
      tag.remove();
      showToast('Eliminado: ' + val, 'info');
    } else { showToast('Error al borrar', 'error'); }
  });
  return tag;
}

// ============================================
// EDITOR DE OPCIONES INLINE (desde el formulario LSM)
// ============================================
// Permite agregar/quitar opciones de las listas LSM sin cerrar el modal LSM
// ni salir del mapa hacia la pantalla de Configuracion.

let inlineConfigCurrentKey = null;

const INLINE_CONFIG_LABELS = {
  tipo_material: 'Tipo de Material',
  localizacion: 'Localizacion',
  fuente: 'Fuente',
  ensayos: 'Ensayos'
};

const INLINE_CONFIG_SELECT_IDS = {
  tipo_material: 'lsm-tipo-material',
  localizacion: 'lsm-localizacion',
  fuente: 'lsm-fuente'
};

function openInlineConfigEditor(key) {
  if (!CONFIG_KEYS.includes(key)) return;
  inlineConfigCurrentKey = key;
  document.getElementById('inline-config-title').textContent = 'Gestionar: ' + (INLINE_CONFIG_LABELS[key] || key);
  renderInlineConfigTags();
  const input = document.getElementById('inline-config-input');
  input.value = '';
  document.getElementById('inline-config-modal').classList.remove('hidden');
  setTimeout(() => input.focus(), 100);
}

function closeInlineConfigEditor() {
  document.getElementById('inline-config-modal').classList.add('hidden');
  // Refresca solo el campo afectado, preservando lo que el usuario ya lleno en el resto del formulario
  refreshLsmFieldPreservingSelection(inlineConfigCurrentKey);
  inlineConfigCurrentKey = null;
}

function renderInlineConfigTags() {
  const list = document.getElementById('inline-config-tag-list');
  if (!list || !inlineConfigCurrentKey) return;
  list.innerHTML = '';
  const values = ConfigManager.getValues(inlineConfigCurrentKey);
  if (values.length === 0) {
    list.innerHTML = '<p class="empty-msg">Sin opciones todavia</p>';
    return;
  }
  values.forEach(val => { list.appendChild(createConfigTag(inlineConfigCurrentKey, val)); });
}

function addInlineConfigValue() {
  const input = document.getElementById('inline-config-input');
  const val = input.value.trim();
  if (!val) { showToast('Ingresa un valor', 'error'); return; }
  if (ConfigManager.addValue(inlineConfigCurrentKey, val)) {
    input.value = '';
    renderInlineConfigTags();
    showToast('Agregado: ' + val, 'success');
    input.focus();
  } else {
    showToast('Esa opcion ya existe', 'error');
  }
}

// Repuebla el select (o los checkboxes) del modal LSM conservando la seleccion actual.
function refreshLsmFieldPreservingSelection(key) {
  if (!key) return;
  if (key === 'ensayos') {
    const checked = Array.from(document.querySelectorAll('#lsm-ensayos-group input[type="checkbox"]:checked')).map(cb => cb.value);
    populateLsmEnsayos();
    document.querySelectorAll('#lsm-ensayos-group input[type="checkbox"]').forEach(cb => {
      cb.checked = checked.includes(cb.value);
    });
    return;
  }
  const selectId = INLINE_CONFIG_SELECT_IDS[key];
  if (!selectId) return;
  const select = document.getElementById(selectId);
  if (!select) return;
  const currentVal = select.value;
  populateLsmSelect(selectId, key);
  if (Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  }
}

// ============================================
// DEVICE SETUP MODAL (Primera vez)
// ============================================
function openDeviceSetupModal() {
  document.getElementById('device-setup-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('device-name-input').focus(), 100);
}
function closeDeviceSetupModal() {
  document.getElementById('device-setup-modal').classList.add('hidden');
}
function saveDeviceName() {
  const input = document.getElementById('device-name-input');
  const name = input.value.trim();
  if (!name) { showToast('Ingresa un nombre', 'error'); return; }
  if (DeviceManager.register(name)) {
    // Migrar marcadores existentes que no tengan deviceId
    const all = MarkerManager.getAll();
    let migrated = 0;
    all.forEach(m => {
      if (!m.deviceId) {
        m.deviceId = DeviceManager.getId();
        m.userName = DeviceManager.getName();
        m.pendingUpload = m.pendingUpload !== false; // Si ya estaba sync, no lo marques
        migrated++;
      }
    });
    if (migrated > 0) MarkerManager.saveAll(all);

    closeDeviceSetupModal();
    showToast('Dispositivo registrado: ' + name + (migrated > 0 ? ` (${migrated} marcadores migrados)` : ''), 'success');
    SyncManager.updateBadge();
  }
}

// ============================================
// APP INITIALIZATION
// ============================================
async function loadConfigFromJSON() {
  try {
    const res = await fetch('./config.json');
    if (res.ok) {
      const json = await res.json();
      DEFAULT_CONFIG = json;
      console.log('[App] Config loaded from config.json');
    }
  } catch (e) {
    console.warn('[App] Could not load config.json, using built-in defaults');
  }
}

async function initApp() {
  await loadConfigFromJSON();
  loadThemePreference();
  initEventListeners();
  loadMapsList(); // no bloquear la UI
  updateMarkerCountBadge();

  // Migrar config si cambio la version de la app
  migrateConfigIfNeeded();

  // Inicializar SyncManager (se carga despues de app.js)
  if (typeof SyncManager !== 'undefined' && SyncManager.init) {
    SyncManager.init();
  }

  // Verificar registro del dispositivo (solo primera vez)
  if (!DeviceManager.isRegistered()) {
    openDeviceSetupModal();
  }
}

function migrateConfigIfNeeded() {
  const CONFIG_VERSION_KEY = 'maps_gis_config_version';
  const storedVersion = localStorage.getItem(CONFIG_VERSION_KEY);
  if (storedVersion !== APP_VERSION) {
    // Resetear config a los nuevos valores por defecto
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...DEFAULT_CONFIG }));
    localStorage.setItem(CONFIG_VERSION_KEY, APP_VERSION);
    console.log('[App] Config migrated to version', APP_VERSION);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
