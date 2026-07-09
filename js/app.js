/**
 * app.js - MAPS GIS Main Application (LOCAL ONLY v1.7.0)
 * Visor de mapas y marcadores. Todo local, sin base de datos.
 */

const PSAD56_UTM_17S = '+proj=utm +zone=17 +south +ellps=intl +towgs84=-288,175,-376,0,0,0,0 +units=m +no_defs';
const PSAD56_GEOGRAPHIC = '+proj=longlat +ellps=intl +towgs84=-288,175,-376,0,0,0,0 +no_defs';
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

const APP_VERSION = '2.4.3';

const MARKER_COLORS = {
  red:    { hex: '#f85149', label: 'Rojo' },
  blue:   { hex: '#58a6ff', label: 'Azul' },
  green:  { hex: '#3fb950', label: 'Verde' },
  yellow: { hex: '#d29922', label: 'Amarillo' },
  orange: { hex: '#db6d28', label: 'Naranja' },
  purple: { hex: '#a371f7', label: 'Morado' }
};

const AppState = {
  map: null, mapOverlay: null, markersLayer: null, userLocationLayer: null,
  isAddMarkerMode: false, pendingMarkerLatLng: null, currentMapId: null,
  currentMapType: 'tiff', mapTitle: '', editingMarkerId: null,
  selectedCategory: 'red', darkTiles: null, lightTiles: null,
  pendingPDF: null, pendingPhotos: [], previewPhotoIndex: -1,
  currentMarkerMode: localStorage.getItem('maps_gis_marker_mode') || 'qc',
  lsmSelectedCategory: 'red', gotoMarkerType: 'qc', pendingMarkerType: 'qc'
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
  createQC(name, description, lat, lng, color, photos) {
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
    markers.push(marker); this.saveAll(markers); return marker;
  },
  createLSM(lat, lng, color, photos, lsmData) {
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
  'nombre_proyecto', 'solicitante',
  'estructura_deposito', 'subestructuras', 'categoria',
  'tipo_material', 'proveniencia', 'localizacion',
  'fuente', 'ensayos'
];

let DEFAULT_CONFIG = {
  nombre_proyecto: [
    '-',
    'Ingenieria Detallada para los Crecimientos El.945 m, El.970 m del DRT',
    'Servicio de Diseno Detallado para la Ampliacion de la Escombrera Sur de la Mina Mirador',
    'Caracterizacion de Relaves del DRT',
    'Ingenieria Detallada de Cierre para la Estabilidad Fisica e Hidrologica del Deposito de Relaves Quimi',
    'Departamento de Gestion de Relaves (GDR)',
    'Coronamiento C980',
    'Coronamiento C990'
  ],
  solicitante: [
    '-',
    'Control de Calidad de la Construccion (CQC)',
    'Klon Crippen Berger (KCB)',
    'Departamento de Produccion y Tecnologia (PyT)',
    'Unidad de Monitoreo y Vigilancia (U_MV)',
    'Jefaturas del Departamento de Depositos de Relaves'
  ],
  estructura_deposito: ['-','DRT','DRQ','TMS','ESS','TMN'],
  subestructuras: ['-','C990','C980','Fase I-II','Fase III'],
  categoria: ['-','EETT','GDR','PPT4','ESAN','PPP1','IMPC970','PPT6','EETQ'],
  tipo_material: ['-','Zona 1 - Relleno','Zona 2 - Filtro Fino','Zona 3 - Filtro Grueso','Zona 6 - Drenante','Fundacion','Zona 1 Seleccionado - Relleno','Relaves','Arcilla','Zona 1 - Zona 6'],
  proveniencia: ['-','Banda 4','Mina Maricela','Visconticorp','Mina Samaniego','Mina Castillo','Mina Guzman','Mina Blanca Cajamarca','Mina Pablo','El Ideal Amazonico','Banda 6'],
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
    nombreProyecto: 'nombre_proyecto',
    solicitante: 'solicitante',
    estructuraDeposito: 'estructura_deposito',
    subestructuras: 'subestructuras',
    categoria: 'categoria',
    tipoMaterial: 'tipo_material',
    proveniencia: 'proveniencia',
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
function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(isoString) {
  const d = new Date(isoString);
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

  const [photoDataUrl, logoDataUrl] = await Promise.all([
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(imageFile);
    }),
    loadLogoDataUrl()
  ]);

  const img = await loadImage(photoDataUrl);
  const logo = await loadImage(logoDataUrl);

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

  // Logo en margen derecho, configurable
  const logoHeight = stampConfig.logoSize;
  const logoWidth = (logo.width / logo.height) * logoHeight;
  const logoX = width - logoWidth - 10;
  const logoY = height - logoHeight - 10;
  ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);

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
    img.src = 'assets/logo_lab_chino_PNG.png';
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
  } catch (error) { showToast('Error al procesar foto', 'error'); }
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
  AppState.map = L.map('map', { center: [-0.1807, -78.4678], zoom: 13, zoomControl: false });
  L.control.zoom({ position: 'topleft' }).addTo(AppState.map);
  AppState.darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 19 });
  AppState.lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 19 });
  AppState.darkTiles.addTo(AppState.map);
  AppState.markersLayer = L.layerGroup().addTo(AppState.map);
  AppState.map.on('click', (e) => {
    if (AppState.isAddMarkerMode) {
      hideGpsSnackbar();
      if (AppState.currentMarkerMode === 'lsm') openLSMLoginOrMarkerModal(e.latlng);
      else openMarkerModal(e.latlng);
    }
  });
  AppState.map.on('mousemove', (e) => updateCoordsDisplay(e.latlng));
}
function updateCoordsDisplay(latlng) {
  if (!latlng) return;
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  document.getElementById('coord-norte').textContent = 'N: ' + Math.round(north);
  document.getElementById('coord-este').textContent = 'E: ' + Math.round(east);
  document.getElementById('coord-lat').textContent = 'Lat: ' + latlng.lat.toFixed(6);
  document.getElementById('coord-lng').textContent = 'Lon: ' + latlng.lng.toFixed(6);
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
    const pdf = await PDFProcessor.loadPDF(record.data);
    const { canvas } = await PDFProcessor.renderPage(pdf, 2);
    if (AppState.mapOverlay) AppState.map.removeLayer(AppState.mapOverlay);
    const offset = getMapOffset(mapId);
    AppState.currentMapOffset = offset;
    AppState.mapOverlay = PDFProcessor.createGeoOverlay(canvas, record.georef.corners, record.georef.crs, offset);
    AppState.mapOverlay.addTo(AppState.map);
    AppState.map.fitBounds(AppState.mapOverlay.getBounds());
    showToast('PDF cargado', 'success');
    updateCalibButtonVisibility(true);
  } catch (error) { showToast('Error al cargar PDF', 'error'); }
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
        <label>Paso: <input type="number" id="calib-step" value="5" min="1" max="100" style="width:50px;"> m</label>
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
  const step = parseInt(document.getElementById('calib-step').value) || 5;
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
  if (!AppState.currentMapId) return;
  const record = await MapStorage.getMapRecord(AppState.currentMapId);
  if (!record || !record.georef) return;
  const pdf = await PDFProcessor.loadPDF(record.data);
  const { canvas } = await PDFProcessor.renderPage(pdf, 2);
  if (AppState.mapOverlay) AppState.map.removeLayer(AppState.mapOverlay);
  AppState.mapOverlay = PDFProcessor.createGeoOverlay(canvas, record.georef.corners, record.georef.crs, AppState.currentMapOffset);
  AppState.mapOverlay.addTo(AppState.map);
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
function goToMyLocation() {
  if (!navigator.geolocation) { showToast('Geolocalizacion no disponible', 'error'); return; }
  showToast('Obteniendo ubicacion...', 'info');
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    if (AppState.userLocationLayer) AppState.map.removeLayer(AppState.userLocationLayer);
    AppState.userLocationLayer = L.layerGroup([
      L.circle([lat, lng], { radius: accuracy, color: '#58a6ff', fillColor: '#58a6ff', fillOpacity: 0.08, weight: 1 }),
      L.circleMarker([lat, lng], { radius: 7, fillColor: '#1a73e8', fillOpacity: 1, color: '#ffffff', weight: 2.5 })
    ]);
    AppState.userLocationLayer.addTo(AppState.map);
    AppState.map.setView([lat, lng], 16);
    updateCoordsDisplay({ lat, lng });
    showToast('Ubicacion obtenida', 'success');
  }, (error) => {
    const msgs = { 1: 'Permiso denegado', 2: 'No disponible', 3: 'Tiempo agotado' };
    showToast('Error: ' + (msgs[error.code] || 'Desconocido'), 'error');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

let _gpsSnackbarCoords = null;
let _gpsSnackbarWatchId = null;

function requestGpsForMarker() {
  if (!navigator.geolocation) return;
  const snackbar = document.getElementById('gps-snackbar');
  const textEl = document.getElementById('gps-snackbar-text');
  if (!snackbar) return;
  snackbar.classList.add('hidden');
  _gpsSnackbarCoords = null;
  navigator.geolocation.getCurrentPosition((position) => {
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    _gpsSnackbarCoords = { lat, lng, accuracy };
    textEl.textContent = 'Ubicacion detectada (' + Math.round(accuracy) + 'm)';
    snackbar.classList.remove('hidden');
  }, () => {
    snackbar.classList.add('hidden');
    _gpsSnackbarCoords = null;
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
}

function useGpsForMarker() {
  if (!_gpsSnackbarCoords) return;
  const { lat, lng } = _gpsSnackbarCoords;
  hideGpsSnackbar();
  AppState.isAddMarkerMode = false;
  document.getElementById('btn-add-marker').classList.remove('active');
  const latlng = { lat, lng };
  if (AppState.currentMarkerMode === 'lsm') openLSMLoginOrMarkerModal(latlng);
  else openMarkerModal(latlng);
}

function hideGpsSnackbar() {
  const snackbar = document.getElementById('gps-snackbar');
  if (snackbar) snackbar.classList.add('hidden');
  _gpsSnackbarCoords = null;
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
  populateLsmSelect('lsm-nombre-proyecto', 'nombre_proyecto');
  populateLsmSelect('lsm-solicitante', 'solicitante');
  populateLsmSelect('lsm-estructura-deposito', 'estructura_deposito');
  populateLsmSelect('lsm-subestructuras', 'subestructuras');
  populateLsmSelect('lsm-categoria', 'categoria');
  populateLsmSelect('lsm-tipo-material', 'tipo_material');
  populateLsmSelect('lsm-proveniencia', 'proveniencia');
  populateLsmSelect('lsm-localizacion', 'localizacion');
  populateLsmSelect('lsm-fuente', 'fuente');
  populateLsmEnsayos();
  const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
  document.getElementById('lsm-coords-display').textContent = 'N: ' + Math.round(north) + ' | E: ' + Math.round(east);
  if (editId) {
    const marker = MarkerManager.getById(editId);
    if (!marker || marker.markerType !== 'lsm') return;
    document.getElementById('lsm-modal-title').textContent = 'Editar Muestra LSM';
    const d = marker.lsmData || {};
    document.getElementById('lsm-nombre-proyecto').value = d.nombreProyecto || '';
    document.getElementById('lsm-solicitante').value = d.solicitante || '';
    document.getElementById('lsm-estructura-deposito').value = d.estructuraDeposito || '';
    document.getElementById('lsm-subestructuras').value = d.subestructuras || '';
    document.getElementById('lsm-categoria').value = d.categoria || '';
    document.getElementById('lsm-semana-laboratorio').value = d.semanaLaboratorio || '';
    document.getElementById('lsm-tipo-material').value = d.tipoMaterial || '';
    document.getElementById('lsm-nombre-muestra').value = marker.name || '';
    document.getElementById('lsm-proveniencia').value = d.proveniencia || '';
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
            AppState.pendingPhotos.push({ photoId: photoId, blob: photoRecord.blob, dataUrl: dataUrl });
          }
        } catch (e) { console.warn('Could not load photo:', photoId); }
      }
      renderPhotoGrid();
    }
  } else {
    document.getElementById('lsm-modal-title').textContent = 'Nueva Muestra LSM';
    const last = getLastLSMForm();
    document.getElementById('lsm-nombre-proyecto').value = last.nombreProyecto || '';
    document.getElementById('lsm-solicitante').value = last.solicitante || '';
    document.getElementById('lsm-estructura-deposito').value = last.estructuraDeposito || '';
    document.getElementById('lsm-subestructuras').value = last.subestructuras || '';
    document.getElementById('lsm-categoria').value = last.categoria || '';
    document.getElementById('lsm-semana-laboratorio').value = getSemanaLaboratorio();
    document.getElementById('lsm-tipo-material').value = last.tipoMaterial || '';
    document.getElementById('lsm-nombre-muestra').value = '';
    document.getElementById('lsm-proveniencia').value = last.proveniencia || '';
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
    nombreProyecto: document.getElementById('lsm-nombre-proyecto').value.trim(),
    solicitante: document.getElementById('lsm-solicitante').value.trim(),
    estructuraDeposito: document.getElementById('lsm-estructura-deposito').value.trim(),
    subestructuras: document.getElementById('lsm-subestructuras').value.trim(),
    categoria: document.getElementById('lsm-categoria').value.trim(),
    semanaLaboratorio: document.getElementById('lsm-semana-laboratorio').value.trim(),
    tipoMaterial: document.getElementById('lsm-tipo-material').value.trim(),
    nombreMuestra: nombreMuestra,
    proveniencia: document.getElementById('lsm-proveniencia').value.trim(),
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
    MarkerManager.update(AppState.editingMarkerId, { name: nombreMuestra, color: AppState.lsmSelectedCategory, photos: photoIds, lsmData: lsmData, pendingUpload: true });
    showToast('Muestra LSM actualizada', 'success');
  } else if (AppState.pendingMarkerLatLng) {
    const { lat, lng } = AppState.pendingMarkerLatLng;
    MarkerManager.createLSM(lat, lng, AppState.lsmSelectedCategory, photoIds, lsmData);
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
    document.getElementById('marker-coords-display').textContent = 'N: ' + Math.round(north) + ' | E: ' + Math.round(east);
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
    document.getElementById('marker-name').value = '';
    document.getElementById('marker-description').value = '';
    AppState.selectedCategory = 'red';
    const [east, north] = proj4(WGS84, 'EPSG:24877', [latlng.lng, latlng.lat]);
    document.getElementById('marker-coords-display').textContent = 'N: ' + Math.round(north) + ' | E: ' + Math.round(east);
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
    MarkerManager.createQC(name, description, lat, lng, AppState.selectedCategory, photoIds);
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
    detailBody.innerHTML = '<div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">LSM</span></div><div class="detail-row"><span class="detail-label">Proyecto</span><span class="detail-value">' + escapeHtml(d.nombreProyecto || '-') + '</span></div><div class="detail-row"><span class="detail-label">Solicitante</span><span class="detail-value">' + escapeHtml(d.solicitante || '-') + '</span></div><div class="detail-row"><span class="detail-label">Estructura/Deposito</span><span class="detail-value">' + escapeHtml(d.estructuraDeposito || '-') + '</span></div><div class="detail-row"><span class="detail-label">Subestructuras</span><span class="detail-value">' + escapeHtml(d.subestructuras || '-') + '</span></div><div class="detail-row"><span class="detail-label">Categoria</span><span class="detail-value">' + escapeHtml(d.categoria || '-') + '</span></div><div class="detail-row"><span class="detail-label">Semana Laboratorio</span><span class="detail-value">' + escapeHtml(d.semanaLaboratorio || '-') + '</span></div><div class="detail-row"><span class="detail-label">Tipo de Material</span><span class="detail-value">' + escapeHtml(d.tipoMaterial || '-') + '</span></div><div class="detail-row"><span class="detail-label">Proveniencia</span><span class="detail-value">' + escapeHtml(d.proveniencia || '-') + '</span></div><div class="detail-row"><span class="detail-label">Localizacion</span><span class="detail-value">' + escapeHtml(d.localizacion || '-') + '</span></div><div class="detail-row"><span class="detail-label">Fuente</span><span class="detail-value">' + escapeHtml(d.fuente || '-') + '</span></div><div class="detail-row"><span class="detail-label">Ensayos</span><span class="detail-value">' + escapeHtml(ensayosStr || '-') + '</span></div><div class="detail-row"><span class="detail-label">Norte (PSAD56)</span><span class="detail-value">' + marker.norte + ' m</span></div><div class="detail-row"><span class="detail-label">Este (PSAD56)</span><span class="detail-value">' + marker.este + ' m</span></div><div class="detail-row"><span class="detail-label">Latitud (WGS84)</span><span class="detail-value">' + marker.lat.toFixed(8) + '</span></div><div class="detail-row"><span class="detail-label">Longitud (WGS84)</span><span class="detail-value">' + marker.lng.toFixed(8) + '</span></div><div id="detail-photos-row" class="detail-row detail-photos"><span class="detail-label">Fotos</span><div id="detail-marker-photos" class="detail-photo-grid"></div></div>';
  } else {
    detailBody.innerHTML = '<div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">QC</span></div><div class="detail-row"><span class="detail-label">Categoria</span><span class="detail-value">' + (MARKER_COLORS[marker.color]?.label || 'Rojo') + '</span></div><div class="detail-row"><span class="detail-label">Norte (PSAD56)</span><span class="detail-value">' + marker.norte + ' m</span></div><div class="detail-row"><span class="detail-label">Este (PSAD56)</span><span class="detail-value">' + marker.este + ' m</span></div><div class="detail-row"><span class="detail-label">Latitud (WGS84)</span><span class="detail-value">' + marker.lat.toFixed(8) + '</span></div><div class="detail-row"><span class="detail-label">Longitud (WGS84)</span><span class="detail-value">' + marker.lng.toFixed(8) + '</span></div><div id="detail-description-row" class="detail-row detail-description"><span class="detail-label">Descripcion</span><p id="detail-marker-description"></p></div><div id="detail-photos-row" class="detail-row detail-photos"><span class="detail-label">Fotos</span><div id="detail-marker-photos" class="detail-photo-grid"></div></div>';
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
  const popupContent = '<div style="min-width:140px;padding:4px;"><strong style="font-size:0.9rem;">' + escapeHtml(marker.name) + '</strong><br><span style="font-size:0.75rem;color:#666;">N: ' + marker.norte + ' | E: ' + marker.este + '</span></div>';
  L.marker([marker.lat, marker.lng], { icon: icon }).bindPopup(popupContent).on('click', () => {
    AppState.map.setView([marker.lat, marker.lng], AppState.map.getZoom());
  }).addTo(AppState.markersLayer);
}
function refreshMarkersOnMap() {
  if (!AppState.markersLayer) return;
  AppState.markersLayer.clearLayers();
  MarkerManager.getAll().forEach(m => addMarkerToMap(m));
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
  container.innerHTML = markers.map(m => {
    const color = MARKER_COLORS[m.color]?.hex || MARKER_COLORS.red.hex;
    const typeLabel = m.markerType === 'lsm' ? 'LSM' : 'QC';
    return '<div class="marker-item" data-id="' + m.id + '"><span class="marker-item-dot" style="background:' + color + ';"></span><div class="marker-item-info"><div class="marker-item-name">' + escapeHtml(m.name) + ' <span class="marker-type-badge">' + typeLabel + '</span></div><div class="marker-item-coords">N: ' + m.norte + ' | E: ' + m.este + '</div></div><div class="marker-item-actions"><button class="marker-item-btn marker-btn-edit" data-id="' + m.id + '" title="Editar" aria-label="Editar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="marker-item-btn marker-btn-delete" data-id="' + m.id + '" title="Eliminar" aria-label="Eliminar"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"></path><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button></div></div>';
  }).join('');
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
    return markers.filter(m => m.createdAt && m.createdAt.startsWith(todayStr));
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
  if (markers.length === 0) { showToast('No hay marcadores para exportar', 'error'); return; }
  showToast('Generando ZIP...', 'info');
  try {
    const zip = new JSZip();
    const folder = zip.folder('fotos');
    const wb = XLSX.utils.book_new();
    const qcMarkers = markers.filter(m => m.markerType === 'qc');
    const lsmMarkers = markers.filter(m => m.markerType === 'lsm');
    if (qcMarkers.length > 0) {
      const qcData = [['Nombre', 'Categoria', 'Descripcion', 'Norte (m)', 'Este (m)', 'Latitud', 'Longitud', 'Fecha_Hora', 'Foto_1', 'Foto_2']];
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
                if (p === 0) foto1 = fileName;
                if (p === 1) foto2 = fileName;
              }
            } catch (e) { console.warn('Could not add photo to zip:', photoId); }
          }
        }
        qcData.push([m.name || '', MARKER_COLORS[m.color]?.label || '', m.description || '', m.norte, m.este, m.lat, m.lng, new Date(m.createdAt), foto1, foto2]);
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
      const lsmData = [['Proyecto', 'Solicitante', 'Estructura', 'Subestructuras', 'Categoria', 'Semana_Laboratorio', 'Fecha_Hora', 'Tipo_Material', 'Nombre_Muestra', 'Proveniencia', 'Localizacion', 'Fuente', 'Este', 'Norte', 'Ensayos', 'Latitud', 'Longitud', 'Foto_1', 'Foto_2']];
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
                if (p === 0) foto1 = fileName;
                if (p === 1) foto2 = fileName;
              }
            } catch (e) { console.warn('Could not add photo to zip:', photoId); }
          }
        }
        lsmData.push([d.nombreProyecto || '', d.solicitante || '', d.estructuraDeposito || '', d.subestructuras || '', d.categoria || '', d.semanaLaboratorio || '', new Date(m.createdAt), d.tipoMaterial || '', m.name || '', d.proveniencia || '', d.localizacion || '', d.fuente || '', m.este, m.norte, (d.ensayos || []).join(', '), m.lat, m.lng, foto1, foto2]);
      }
      const wsLSM = XLSX.utils.aoa_to_sheet(lsmData, { cellDates: true });
      for (let r = 1; r < lsmData.length; r++) {
        const addr = XLSX.utils.encode_col(6) + (r + 1);
        if (wsLSM[addr] && wsLSM[addr].v instanceof Date) {
          wsLSM[addr].z = 'DD/MM/YYYY';
          wsLSM[addr].t = 'd';
        }
      }
      XLSX.utils.book_append_sheet(wb, wsLSM, 'LSM');
    }
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    zip.file('marcadores.xlsx', excelBuffer);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, 'marcadores_' + new Date().toISOString().slice(0, 10) + '.zip');
    showToast(markers.length + ' marcadores exportados', 'success');
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
    AppState.pendingPDF = { name: file.name, arrayBuffer: arrayBufferForStorage, size: file.size, isGeoPDF: processed.isGeoPDF, geoData: processed.geoData || null };
    const geoData = processed.geoData;
    if (geoData && geoData.corners) {
      progressText.textContent = 'Coordenadas detectadas!';
      const crs = geoData.crs || 'EPSG:4326';
      const c = geoData.corners;
      // Normalizar SIEMPRE a UTM PSAD56 (EPSG:24877) para el modal, replicando
      // exactamente la misma logica que createGeoOverlay usara al renderizar.
      // Esto garantiza que lo que ve el usuario y lo que se guarda coincide
      // con el overlay final. corner = [lon_or_e, lat_or_n] segun crs.
      const toUTM = (corner) => {
        const [x, y] = corner; // x=lon/e, y=lat/n
        if (crs === 'EPSG:4326') {
          return proj4('EPSG:4326', 'EPSG:24877', [x, y]);
        }
        if (crs === 'EPSG:24877') {
          // Puede ser geograficas PSAD56 (lat/lon) o UTM PSAD56 ya proyectadas.
          if (Math.abs(x) < 180 && Math.abs(y) < 90) {
            // lat/lon PSAD56 (datum Intl 1924) -> UTM PSAD56 17S
            return proj4('PSAD56GEO', 'EPSG:24877', [x, y]);
          }
          return [x, y]; // ya son UTM
        }
        // Otro CRS proyectado/lat-lon conocido por proj4
        return proj4(crs, 'EPSG:24877', [x, y]);
      };
      const cornersUTM = {};
      for (const key of ['tl', 'tr', 'bl', 'br']) { cornersUTM[key] = toUTM(c[key]); }
      document.getElementById('georef-tl-e').value = cornersUTM.tl[0].toFixed(2);
      document.getElementById('georef-tl-n').value = cornersUTM.tl[1].toFixed(2);
      document.getElementById('georef-tr-e').value = cornersUTM.tr[0].toFixed(2);
      document.getElementById('georef-tr-n').value = cornersUTM.tr[1].toFixed(2);
      document.getElementById('georef-bl-e').value = cornersUTM.bl[0].toFixed(2);
      document.getElementById('georef-bl-n').value = cornersUTM.bl[1].toFixed(2);
      document.getElementById('georef-br-e').value = cornersUTM.br[0].toFixed(2);
      document.getElementById('georef-br-n').value = cornersUTM.br[1].toFixed(2);
      document.getElementById('georef-crs').value = 'EPSG:24877';
      console.log('[handlePDFUpload] CRS entrada:', crs, '| corners UTM guardadas:', cornersUTM);
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
async function applyGeoref() {
  const crs = document.getElementById('georef-crs').value;
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
  const georef = { corners: { tl: [tlE, tlN], tr: [trE, trN], bl: [blE, blN], br: [brE, brN] }, crs: crs };
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
  AppState.currentMapId = mapId;
  const maps = await MapStorage.getAllMaps();
  const map = maps.find(m => m.id === mapId);
  AppState.currentMapType = map ? (map.type || 'tiff') : 'tiff';
  AppState.mapTitle = map ? map.name : 'Mapa';
  document.getElementById('map-title').textContent = AppState.mapTitle;
  AppState.currentMarkerMode = localStorage.getItem('maps_gis_marker_mode') || AppState.currentMarkerMode || 'qc';
  updateModeToggleButton();
  showScreen('map-screen');
  initMap();
  setTimeout(() => AppState.map.invalidateSize(), 200);
  if (AppState.currentMapType === 'pdf') await loadPDFMap(mapId);
  else await loadGeoTiff(mapId);
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
  document.getElementById('btn-back').addEventListener('click', () => { showScreen('home-screen'); loadMapsList(); updateMarkerCountBadge(); });
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-location').addEventListener('click', goToMyLocation);
  document.getElementById('btn-center').addEventListener('click', () => { if (AppState.mapOverlay) AppState.map.fitBounds(AppState.mapOverlay.getBounds()); });
  document.getElementById('btn-add-marker').addEventListener('click', () => {
    AppState.isAddMarkerMode = !AppState.isAddMarkerMode;
    document.getElementById('btn-add-marker').classList.toggle('active', AppState.isAddMarkerMode);
    if (AppState.isAddMarkerMode) {
      showToast('Modo marcador activo', 'info');
      requestGpsForMarker();
    } else {
      hideGpsSnackbar();
      showToast('Modo marcador desactivado', 'info');
    }
  });
  document.getElementById('btn-go-to-coords').addEventListener('click', openGoToCoordsModal);
  document.getElementById('btn-cancel-goto').addEventListener('click', closeGoToCoordsModal);
  document.getElementById('btn-confirm-goto').addEventListener('click', confirmGoToCoords);
  document.getElementById('btn-goto-qc').addEventListener('click', () => selectGotoType('qc'));
  document.getElementById('btn-goto-lsm').addEventListener('click', () => selectGotoType('lsm'));
  document.getElementById('btn-use-gps').addEventListener('click', useGpsForMarker);
  document.getElementById('btn-dismiss-gps').addEventListener('click', hideGpsSnackbar);
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
  document.getElementById('btn-markers-panel').addEventListener('click', openMarkersPanel);
  document.getElementById('btn-close-panel').addEventListener('click', closeMarkersPanel);
  document.getElementById('btn-export-panel').addEventListener('click', openExportModal);
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
        else if (modal.id === 'marker-detail-modal') closeMarkerDetail();
        else if (modal.id === 'go-to-coords-modal') closeGoToCoordsModal();
        else if (modal.id === 'delete-map-modal') { pendingDeleteMapId = null; modal.classList.add('hidden'); }
        else if (modal.id === 'photo-preview-modal') closePhotoPreview();
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
  ctx.fillStyle = isLight ? '#f6f8fa' : '#0d1117';
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
    ctx.fillStyle = '#58a6ff';
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
    nombre_proyecto: 'Nombre del Proyecto', solicitante: 'Solicitante',
    estructura_deposito: 'Estructura / Deposito', subestructuras: 'Subestructuras', categoria: 'Categoria',
    tipo_material: 'Tipo de Material', proveniencia: 'Proveniencia', localizacion: 'Localizacion',
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
