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
// SUPABASE CONFIG
// ============================================
function parsePostgresArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val !== 'string') return [];
  if (val.startsWith('{') && val.endsWith('}')) {
    const inner = val.slice(1, -1);
    if (inner.trim() === '') return [];
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SUPABASE_URL = 'https://dzmhhlsttqygjvfabdxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6bWhobHN0dHF5Z2p2ZmFiZHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTE3MDAsImV4cCI6MjA5MDcyNzcwMH0._Gf0G2gpV_9QAYqFx1Kn6TN0lFDq3LxmBdNI82Suj-o';
let supabaseClient = null;

function getSupabaseCreateClient() {
  const candidates = [
    window.supabase?.createClient,
    typeof window.supabase === 'function' ? window.supabase : null,
    window.Supabase?.createClient,
    typeof window.Supabase === 'function' ? window.Supabase : null,
    window.supabaseJs?.createClient,
    window.createClient
  ];
  for (const fn of candidates) {
    if (typeof fn === 'function') return fn;
  }
  return null;
}

function initSupabase() {
  const createClient = getSupabaseCreateClient();
  if (!createClient) {
    console.warn('[Supabase] createClient not found. Offline mode.');
    supabaseClient = null;
    return null;
  }
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      db: { schema: 'public' }
    });
    console.log('[Supabase] Client initialized');
    return supabaseClient;
  } catch (e) {
    console.error('[Supabase] Failed to initialize:', e);
    supabaseClient = null;
    return null;
  }
}

async function pingSupabase() {
  if (!supabaseClient) return { ok: false, error: 'No client' };
  try {
    const { data, error } = await supabaseClient
      .from('app_config')
      .select('config_key')
      .limit(1);
    if (error) {
      return { ok: false, error: error.message, code: error.code };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

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
// APP VERSION - Must match sw.js APP_VERSION
// ============================================
const APP_VERSION = '1.5.2';

// ============================================
// APP STATE
// ============================================

const AppState = {
  map: null,
  mapOverlay: null,
  markersLayer: null,
  userLocationLayer: null,
  adminMarkersLayer: null,
  isAddMarkerMode: false,
  pendingMarkerLatLng: null,
  currentMapId: null,
  currentMapType: 'tiff',
  mapTitle: '',
  editingMarkerId: null,
  selectedCategory: 'red',
  darkTiles: null,
  lightTiles: null,
  pendingPDF: null,
  pendingPhotos: [], // Array of { photoId, dataUrl } for current marker
  currentMarkerMode: 'qc', // 'qc' or 'lsm' - persistent mode on map screen
  lsmSelectedCategory: 'red',
  isAdmin: false // admin mode active
};

// ============================================
// MARKER MANAGER (LocalStorage)
// ============================================

const MarkerManager = {
  STORAGE_KEY: 'maps_gis_markers_v3',

  getAll() {
    try {
      const data = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
      if (!Array.isArray(data)) return [];
      // Migrate old markers without markerType to QC
      return data.map(m => ({
        ...m,
        markerType: m.markerType || 'qc'
      }));
    } catch {
      return [];
    }
  },

  saveAll(markers) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(markers));
  },

  createQC(name, description, lat, lng, color, photos) {
    const markers = this.getAll();
    const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
    const marker = {
      id: 'm_' + Date.now(),
      markerType: 'qc',
      name: name.trim(),
      description: description.trim(),
      lat: lat,
      lng: lng,
      norte: north.toFixed(3),
      este: east.toFixed(3),
      color: color || 'red',
      photos: photos || [],
      createdAt: new Date().toISOString()
    };
    markers.push(marker);
    this.saveAll(markers);
    return marker;
  },

  createLSM(lat, lng, color, photos, lsmData) {
    const markers = this.getAll();
    const [east, north] = proj4(WGS84, 'EPSG:24877', [lng, lat]);
    const marker = {
      id: 'm_' + Date.now(),
      markerType: 'lsm',
      name: (lsmData.nombreMuestra || '').trim(),
      lat: lat,
      lng: lng,
      norte: north.toFixed(3),
      este: east.toFixed(3),
      color: color || 'red',
      photos: photos || [],
      lsmData: lsmData,
      pendingUpload: true,
      createdAt: new Date().toISOString()
    };
    markers.push(marker);
    this.saveAll(markers);
    return marker;
  },

  createLSMFromRemote(remoteMarker, localId) {
    const markers = this.getAll();
    const lsmData = {
      tipoMuestra: remoteMarker.tipo_muestra || '',
      nombreProyecto: remoteMarker.nombre_proyecto || '',
      solicitante: remoteMarker.solicitante || '',
      estructuraDeposito: remoteMarker.estructura_deposito || '',
      subestructuras: remoteMarker.subestructuras || '',
      categoria: remoteMarker.categoria || '',
      tipoMaterial: remoteMarker.tipo_material || '',
      nombreMuestra: remoteMarker.nombre_muestra || '',
      proveniencia: remoteMarker.proveniencia || '',
      localizacion: remoteMarker.localizacion || '',
      fuente: remoteMarker.fuente || '',
      ensayos: Array.isArray(remoteMarker.ensayos) ? remoteMarker.ensayos : []
    };
    const marker = {
      id: localId || ('m_' + Date.now() + '_r'),
      markerType: 'lsm',
      name: (remoteMarker.nombre_muestra || '').trim(),
      lat: remoteMarker.lat,
      lng: remoteMarker.lng,
      norte: remoteMarker.norte != null ? String(remoteMarker.norte) : '',
      este: remoteMarker.este != null ? String(remoteMarker.este) : '',
      color: remoteMarker.color || 'red',
      photos: [],
      lsmData: lsmData,
      pendingUpload: false,
      createdAt: remoteMarker.created_at || new Date().toISOString()
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
// LSM USER MANAGER (Local Auth)
// ============================================
const LSM_USER_KEY = 'maps_gis_lsm_user';
const LSM_PASS = '354';

const LSMUserManager = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(LSM_USER_KEY)) || null;
    } catch {
      return null;
    }
  },

  set(nickname) {
    localStorage.setItem(LSM_USER_KEY, JSON.stringify({ nickname, loggedInAt: Date.now() }));
  },

  clear() {
    localStorage.removeItem(LSM_USER_KEY);
  },

  isLoggedIn() {
    return !!this.get();
  },

  getNickname() {
    const u = this.get();
    return u ? u.nickname : null;
  },

  validate(nickname, password) {
    return nickname && nickname.trim().length > 0 && password === LSM_PASS;
  }
};

// ============================================
// CONFIG MANAGER (Dropdown lists + Supabase sync)
// ============================================
const CONFIG_KEY = 'maps_gis_config_v2';
const CONFIG_KEYS = [
  'tipo_muestra', 'nombre_proyecto', 'solicitante',
  'estructura_deposito', 'subestructuras', 'categoria',
  'tipo_material', 'proveniencia', 'localizacion',
  'fuente', 'ensayos'
];

const DELETED_CONFIG_KEY = 'maps_gis_deleted_config';

const ConfigManager = {
  _syncing: false,
  _localVersion: 0,

  getLocal() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch {
      return {};
    }
  },

  saveLocal(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    this._localVersion++;
  },

  getDeletedValues() {
    try {
      return JSON.parse(localStorage.getItem(DELETED_CONFIG_KEY)) || {};
    } catch {
      return {};
    }
  },

  saveDeletedValues(deleted) {
    localStorage.setItem(DELETED_CONFIG_KEY, JSON.stringify(deleted));
  },

  clearDeletedValues() {
    localStorage.removeItem(DELETED_CONFIG_KEY);
  },

  getValues(key) {
    const cfg = this.getLocal();
    return Array.isArray(cfg[key]) ? cfg[key] : [];
  },

  addValue(key, value) {
    if (!value || !value.trim()) return false;
    const cfg = this.getLocal();
    if (!Array.isArray(cfg[key])) cfg[key] = [];
    if (cfg[key].includes(value.trim())) return false;
    cfg[key].push(value.trim());
    this.saveLocal(cfg);
    // Remove from deleted tracking if it was previously deleted
    const deleted = this.getDeletedValues();
    if (deleted[key]) {
      deleted[key] = deleted[key].filter(v => v !== value.trim());
      this.saveDeletedValues(deleted);
    }
    return true;
  },

  removeValue(key, value) {
    const cfg = this.getLocal();
    if (!Array.isArray(cfg[key])) return false;
    cfg[key] = cfg[key].filter(v => v !== value);
    this.saveLocal(cfg);
    // Track deletion so it doesn't come back on download
    const deleted = this.getDeletedValues();
    if (!deleted[key]) deleted[key] = [];
    if (!deleted[key].includes(value)) deleted[key].push(value);
    this.saveDeletedValues(deleted);
    return true;
  },


  async downloadFromSupabase(force = false) {
    if (!supabaseClient) {
      console.warn('[Config] No Supabase client');
      return false;
    }
    if (ConfigManager._syncing) {
      console.log('[Config] Sync in progress');
      return false;
    }
    const configModal = document.getElementById('config-modal');
    if (configModal && !configModal.classList.contains('hidden') && !force) {
      console.log('[Config] Config modal open, frozen (use force=true to override)');
      return false;
    }
    ConfigManager._syncing = true;
    try {
      console.log('[Config] Downloading from Supabase...');
      const { data, error } = await supabaseClient
        .from('app_config')
        .select('config_key, config_values');
      if (error) {
        console.error('[Config] Download error:', error.message);
        return false;
      }
      if (!data || data.length === 0) {
        console.warn('[Config] No data from Supabase');
        return false;
      }
      // Log each row for debugging
      data.forEach(row => {
        console.log('[Config] Row:', row.config_key, '=', JSON.stringify(row.config_values), 'length:', Array.isArray(row.config_values) ? row.config_values.length : 0);
      });
      const remoteCfg = {};
      data.forEach(row => {
        remoteCfg[row.config_key] = parsePostgresArray(row.config_values);
      });
      CONFIG_KEYS.forEach(k => {
        if (!remoteCfg[k]) remoteCfg[k] = [];
      });
      const localCfg = this.getLocal();
      const deleted = this.getDeletedValues();
      const mergedCfg = {};
      CONFIG_KEYS.forEach(k => {
        const localVals = Array.isArray(localCfg[k]) ? localCfg[k] : [];
        const remoteVals = Array.isArray(remoteCfg[k]) ? remoteCfg[k] : [];
        const merged = [...localVals];
        remoteVals.forEach(v => {
          if (!merged.includes(v)) merged.push(v);
        });
        // Remove values that were deleted locally (but only if upload succeeded for them)
        if (deleted[k] && deleted[k].length > 0) {
          mergedCfg[k] = merged.filter(v => !deleted[k].includes(v));
        } else {
          mergedCfg[k] = merged;
        }
      });
      console.log('[Config] Merge result localizacion:', JSON.stringify(mergedCfg.localizacion));
      this.saveLocal(mergedCfg);
      console.log('[Config] Downloaded and saved', Object.keys(remoteCfg).length, 'keys');
      showToast('Datos descargados correctamente', 'success');
      if (typeof renderConfigSections === 'function') {
        try { renderConfigSections(); } catch(e) { console.error('[Config] Render error:', e); }
      }
      return true;
    } catch (e) {
      console.error('[Config] Download exception:', e);
      return false;
    } finally {
      ConfigManager._syncing = false;
    }
  },

  async uploadToSupabase() {
    if (!supabaseClient) {
      console.warn('[Config] No Supabase client');
      return false;
    }
    if (ConfigManager._syncing) {
      setTimeout(() => ConfigManager.uploadToSupabase(), 500);
      return false;
    }
    ConfigManager._syncing = true;
    try {
      // First, download remote config to merge with local
      const { data: remoteData, error: fetchError } = await supabaseClient
        .from('app_config')
        .select('config_key, config_values');
      const remoteCfg = {};
      if (!fetchError && remoteData) {
        remoteData.forEach(row => {
          remoteCfg[row.config_key] = parsePostgresArray(row.config_values);
        });
      }
      const localCfg = this.getLocal();
      const mergedCfg = {};
      CONFIG_KEYS.forEach(k => {
        const localVals = Array.isArray(localCfg[k]) ? localCfg[k] : [];
        const remoteVals = Array.isArray(remoteCfg[k]) ? remoteCfg[k] : [];
        const merged = [...remoteVals];
        localVals.forEach(v => {
          if (!merged.includes(v)) merged.push(v);
        });
        mergedCfg[k] = merged;
      });
      // Save merged locally too
      this.saveLocal(mergedCfg);

      const updates = CONFIG_KEYS.map(k => ({
        config_key: k,
        config_values: mergedCfg[k] || [],
        updated_at: new Date().toISOString()
      }));
      console.log('[Config] Uploading merged', updates.length, 'keys...');
      const { data, error } = await supabaseClient
        .from('app_config')
        .upsert(updates, { onConflict: 'config_key' });
      if (error) {
        console.error('[Config] Upload error:', error.message);
        showToast('Error al subir: ' + error.message, 'error');
        return false;
      }
      console.log('[Config] Upload OK');
      showToast('Config subida correctamente', 'success');
      // Clear deleted tracking since server now matches local
      this.clearDeletedValues();
      return true;
    } catch (e) {
      console.error('[Config] Upload exception:', e);
      return false;
    } finally {
      ConfigManager._syncing = false;
    }
  },

  subscribeToRealtime() {
    if (!supabaseClient) {
      console.warn('[Config] No Supabase client, skipping Realtime subscription');
      return;
    }
    try {
      if (ConfigManager._realtimeChannel) {
        try { supabaseClient.removeChannel(ConfigManager._realtimeChannel); } catch(e) {}
      }
      const channel = supabaseClient
        .channel('app_config_changes')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'app_config' },
          () => {
            console.log('[Config] Realtime change detected, scheduling download...');
            clearTimeout(ConfigManager._realtimeDebounce);
            ConfigManager._realtimeDebounce = setTimeout(() => {
              ConfigManager.downloadFromSupabase();
            }, 1000);
          }
        )
        .subscribe((status) => {
          console.log('[Config] Realtime subscription status:', status);
        });
      ConfigManager._realtimeChannel = channel;
      console.log('[Config] Subscribed to Realtime for app_config');
    } catch (e) {
      console.error('[Config] Realtime subscription failed:', e);
    }
  },

  startPolling() {
    this.stopPolling();
    ConfigManager._pollInterval = setInterval(async () => {
      if (navigator.onLine && supabaseClient) {
        console.log('[Config] Polling for changes...');
        await ConfigManager.downloadFromSupabase();
      }
    }, 30 * 1000);
    console.log('[Config] Started polling every 30 seconds');
  },

  stopPolling() {
    if (ConfigManager._pollInterval) {
      clearInterval(ConfigManager._pollInterval);
      ConfigManager._pollInterval = null;
    }
    console.log('[Config] Stopped polling');
  }
};

// ============================================
// LSM SYNC MANAGER (Upload to Supabase)
// ============================================
const LSMSyncManager = {
  async shouldUpload() {
    // Always try if online
    if (!navigator.onLine) return false;
    // Check network type - but don't block if unknown
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.effectiveType) {
      const good = ['4g', '5g'].includes(conn.effectiveType);
      if (!good) {
        console.log('[Sync] Network type:', conn.effectiveType, '- not uploading');
        return false;
      }
    }
    // Quick ping to Supabase
    if (!supabaseClient) {
      console.log('[Sync] No Supabase client');
      return false;
    }
    try {
      const { data, error } = await supabaseClient.from('app_config').select('id').limit(1);
      if (error) {
        console.log('[Sync] Supabase ping error:', error.message);
        return false;
      }
      console.log('[Sync] Supabase is reachable, can upload');
      return true;
    } catch (e) {
      console.log('[Sync] Supabase unreachable:', e.message);
      return false;
    }
  },

  async uploadMarker(marker) {
    if (!supabaseClient || marker.markerType !== 'lsm') return false;
    try {
      const data = {
        nickname: LSMUserManager.getNickname() || 'anon',
        device_id: getDeviceId(),
        local_marker_id: marker.id,
        lat: marker.lat,
        lng: marker.lng,
        norte: marker.norte,
        este: marker.este,
        color: marker.color,
        photos_count: (marker.photos || []).length,
        nombre_muestra: marker.name,
        tipo_muestra: marker.lsmData?.tipoMuestra || null,
        nombre_proyecto: marker.lsmData?.nombreProyecto || null,
        solicitante: marker.lsmData?.solicitante || null,
        estructura_deposito: marker.lsmData?.estructuraDeposito || null,
        subestructuras: marker.lsmData?.subestructuras || null,
        categoria: marker.lsmData?.categoria || null,
        tipo_material: marker.lsmData?.tipoMaterial || null,
        proveniencia: marker.lsmData?.proveniencia || null,
        localizacion: marker.lsmData?.localizacion || null,
        fuente: marker.lsmData?.fuente || null,
        ensayos: marker.lsmData?.ensayos || []
      };
      console.log('[Sync] Uploading marker to Supabase:', data.nombre_muestra);
      const { data: result, error } = await supabaseClient.from('lsm_markers').insert(data).select();
      if (error) {
        console.error('[Sync] Insert error:', error.message, error.code, error.details, error.hint);
        return false;
      }
      console.log('[Sync] Upload successful:', result);
      return true;
    } catch (e) {
      console.error('[Sync] Upload exception:', e);
      return false;
    }
  },

  async syncPending() {
    const markers = MarkerManager.getAll().filter(m => m.markerType === 'lsm' && m.pendingUpload);
    if (markers.length === 0) return;
    if (!await this.shouldUpload()) return;

    showToast('Sincronizando ' + markers.length + ' muestra(s)...', 'info');
    let success = 0;
    for (const marker of markers) {
      const ok = await this.uploadMarker(marker);
      if (ok) {
        MarkerManager.update(marker.id, { pendingUpload: false });
        success++;
      }
    }
    if (success > 0) {
      showToast(success + ' muestra(s) subidas a la nube', 'success');
    }
  },

  async syncMarkersFromSupabase() {
    if (!supabaseClient) {
      console.warn('[Sync] No Supabase client');
      return false;
    }
    const nickname = LSMUserManager.getNickname();
    if (!nickname) {
      console.log('[Sync] No nickname set, skipping marker download');
      return false;
    }
    try {
      console.log('[Sync] Downloading LSM markers for nickname:', nickname);
      const { data, error } = await supabaseClient
        .from('lsm_markers')
        .select('*')
        .eq('nickname', nickname)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[Sync] Download markers error:', error.message);
        return false;
      }
      if (!data || data.length === 0) {
        console.log('[Sync] No markers found for nickname:', nickname);
        return true;
      }

      const markers = MarkerManager.getAll();
      const localById = {};
      markers.forEach(m => { localById[m.id] = m; });

      let updated = 0;
      let created = 0;

      data.forEach(remote => {
        const localId = remote.local_marker_id;
        const local = localId ? localById[localId] : null;

        const lsmData = {
          tipoMuestra: remote.tipo_muestra || '',
          nombreProyecto: remote.nombre_proyecto || '',
          solicitante: remote.solicitante || '',
          estructuraDeposito: remote.estructura_deposito || '',
          subestructuras: remote.subestructuras || '',
          categoria: remote.categoria || '',
          tipoMaterial: remote.tipo_material || '',
          nombreMuestra: remote.nombre_muestra || '',
          proveniencia: remote.proveniencia || '',
          localizacion: remote.localizacion || '',
          fuente: remote.fuente || '',
          ensayos: Array.isArray(remote.ensayos) ? remote.ensayos : (typeof remote.ensayos === 'string' ? parsePostgresArray(remote.ensayos) : [])
        };

        if (local) {
          MarkerManager.update(local.id, {
            name: (remote.nombre_muestra || '').trim(),
            lat: remote.lat,
            lng: remote.lng,
            norte: remote.norte != null ? String(remote.norte) : '',
            este: remote.este != null ? String(remote.este) : '',
            color: remote.color || 'red',
            lsmData: lsmData,
            pendingUpload: false
          });
          updated++;
        } else {
          MarkerManager.createLSMFromRemote(remote, localId);
          created++;
        }
      });

      console.log('[Sync] Markers synced:', updated, 'updated,', created, 'created from', data.length, 'remote');
      return true;
    } catch (e) {
      console.error('[Sync] Download markers exception:', e);
      return false;
    }
  }
};

function getDeviceId() {
  let id = localStorage.getItem('maps_gis_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('maps_gis_device_id', id);
  }
  return id;
}

// ============================================
// ADMIN MANAGER (Review all LSM markers)
// ============================================
const ADMIN_PASS = 'LSM$';
const ADMIN_KEY = 'maps_gis_admin';
let adminMarkersCache = [];

const AdminManager = {
  isLoggedIn() {
    try {
      return JSON.parse(localStorage.getItem(ADMIN_KEY)) || false;
    } catch {
      return false;
    }
  },

  login(password) {
    if (password === ADMIN_PASS) {
      localStorage.setItem(ADMIN_KEY, 'true');
      AppState.isAdmin = true;
      return true;
    }
    return false;
  },

  logout() {
    localStorage.removeItem(ADMIN_KEY);
    AppState.isAdmin = false;
    adminMarkersCache = [];
  },

  async fetchAllMarkers() {
    if (!supabaseClient) {
      console.error('[Admin] No Supabase client available');
      showToast('No hay conexion con la base de datos', 'error');
      return [];
    }
    try {
      console.log('[Admin] Fetching all LSM markers from Supabase...');
      const { data, error } = await supabaseClient
        .from('lsm_markers')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[Admin] Supabase query error:', error.message, error.code, error.details, error.hint);
        showToast('Error de base de datos: ' + error.message, 'error');
        return [];
      }
      console.log('[Admin] Fetched', data ? data.length : 0, 'markers from Supabase');
      adminMarkersCache = data || [];
      return data || [];
    } catch (e) {
      console.error('[Admin] Fetch exception:', e);
      showToast('Error al descargar datos: ' + e.message, 'error');
      return [];
    }
  },

  getUniqueNicknames() {
    const nicks = [...new Set(adminMarkersCache.map(m => m.nickname))];
    nicks.sort();
    return nicks;
  },

  filterByNickname(nickname) {
    if (!nickname) return adminMarkersCache;
    return adminMarkersCache.filter(m => m.nickname === nickname);
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    AdminManager._refreshInterval = setInterval(async () => {
      if (!AppState.isAdmin || !supabaseClient) return;
      console.log('[Admin] Auto-refreshing markers...');
      await AdminManager.fetchAllMarkers();
      if (AppState.isAdmin) {
        addAdminMarkersToMap();
        renderAdminPanel();
      }
    }, 60000);
    console.log('[Admin] Auto-refresh started (60s)');
  },

  stopAutoRefresh() {
    if (AdminManager._refreshInterval) {
      clearInterval(AdminManager._refreshInterval);
      AdminManager._refreshInterval = null;
    }
    console.log('[Admin] Auto-refresh stopped');
  }
};

async function activateAdmin(password) {
  if (!AdminManager.login(password)) {
    showToast('Contrasena incorrecta', 'error');
    return;
  }
  showToast('Modo Admin activado. Descargando datos...', 'info');
  const markers = await AdminManager.fetchAllMarkers();
  if (markers.length === 0) {
    showToast('No hay muestras LSM en la base de datos', 'info');
  } else {
    showToast(markers.length + ' muestras LSM descargadas', 'success');
  }
  renderAdminPanel();
  updateConfigAccountTab();
  addAdminMarkersToMap();
  AdminManager.startAutoRefresh();
}

function deactivateAdmin() {
  AdminManager.stopAutoRefresh();
  AdminManager.logout();
  removeAdminMarkersFromMap();
  renderAdminPanel();
  updateConfigAccountTab();
  updateModeToggleButton();
  showToast('Modo Admin desactivado', 'info');
}

function addAdminMarkersToMap(filterNickname) {
  if (!AppState.map) return;
  removeAdminMarkersFromMap();

  if (!AppState.adminMarkersLayer) {
    AppState.adminMarkersLayer = L.layerGroup();
  }
  AppState.adminMarkersLayer.clearLayers();

  const markers = filterNickname
    ? AdminManager.filterByNickname(filterNickname)
    : adminMarkersCache;

  markers.forEach(m => {
    const color = MARKER_COLORS[m.color]?.hex || '#58a6ff';
    const initial = (m.nombre_muestra || 'X').charAt(0).toUpperCase();
    const icon = L.divIcon({
      className: '',
      html: '<div class="custom-marker-pin admin-marker-pin">' +
        '<svg viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="' + color + '"/>' +
          '<circle cx="16" cy="15" r="10" fill="rgba(255,255,255,0.3)"/>' +
          '<text x="16" y="19" text-anchor="middle" fill="#fff" font-size="12" font-weight="bold" font-family="sans-serif">' + initial + '</text>' +
        '</svg>' +
      '</div>',
      iconSize: [32, 40],
      iconAnchor: [16, 40],
      popupAnchor: [0, -40]
    });

    const ensayos = (m.ensayos || []).join(', ');
    const popupContent =
      '<div style="min-width:180px;padding:6px;font-size:0.8rem;">' +
      '<strong>' + escapeHtml(m.nombre_muestra || '') + '</strong> <span style="background:#58a6ff;color:#fff;padding:1px 6px;border-radius:8px;font-size:0.65rem;">LSM</span><br>' +
      '<span style="color:#666;">' + escapeHtml(m.nickname || '') + ' | ' + formatDate(m.created_at) + '</span><br>' +
      '<span style="color:#666;font-size:0.7rem;">N: ' + (m.norte || '') + ' | E: ' + (m.este || '') + '</span>' +
      (ensayos ? '<br><span style="color:#666;font-size:0.7rem;">Ensayos: ' + escapeHtml(ensayos) + '</span>' : '') +
      '</div>';

    L.marker([m.lat, m.lng], { icon: icon })
      .bindPopup(popupContent)
      .addTo(AppState.adminMarkersLayer);
  });

  AppState.adminMarkersLayer.addTo(AppState.map);
}

function removeAdminMarkersFromMap() {
  if (AppState.adminMarkersLayer) {
    AppState.map.removeLayer(AppState.adminMarkersLayer);
    AppState.adminMarkersLayer.clearLayers();
  }
}

function renderAdminPanel() {
  const tab = document.getElementById('config-tab-admin');
  if (!tab) return;

  const isAdmin = AppState.isAdmin;
  const markers = adminMarkersCache;
  const nicknames = AdminManager.getUniqueNicknames();

  if (!isAdmin) {
    tab.innerHTML =
      '<div class="form-group">' +
        '<label>Acceso Admin</label>' +
        '<p class="config-hint">Ingresa la contrasena de admin para ver todas las muestras LSM de todos los usuarios.</p>' +
        '<div class="admin-login-row">' +
          '<input type="password" id="admin-password" placeholder="Contrasena de admin" maxlength="20" autocomplete="off">' +
          '<button id="btn-admin-login" class="btn-primary btn-sm">Ingresar</button>' +
        '</div>' +
      '</div>';
  } else {
    const count = markers.length;
    const nickOptions = nicknames.map(n => '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');

    tab.innerHTML =
      '<div class="admin-status">' +
        '<div class="admin-status-icon">&#9989;</div>' +
        '<div class="admin-status-info">' +
          '<span class="admin-status-label">Modo Admin activo</span>' +
          '<span class="admin-status-count">' + count + ' muestras LSM en la base de datos</span>' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Filtrar por Nickname</label>' +
        '<select id="admin-nickname-filter" class="crs-select">' +
          '<option value="">Todos</option>' +
          nickOptions +
        '</select>' +
      '</div>' +
      '<div class="admin-actions-row">' +
        '<button id="btn-admin-refresh" class="btn-secondary btn-sm">Actualizar datos</button>' +
        '<button id="btn-admin-export" class="btn-primary btn-sm">Exportar Excel</button>' +
        '<button id="btn-admin-logout" class="btn-danger btn-sm">Salir de Admin</button>' +
      '</div>' +
      '<div id="admin-markers-list" class="admin-markers-list"></div>';

    setTimeout(() => {
      const filterEl = document.getElementById('admin-nickname-filter');
      if (filterEl) {
        filterEl.addEventListener('change', () => {
          addAdminMarkersToMap(filterEl.value);
          renderAdminMarkersList(filterEl.value);
        });
      }
      const refreshBtn = document.getElementById('btn-admin-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          showToast('Actualizando datos...', 'info');
          await AdminManager.fetchAllMarkers();
          renderAdminPanel();
          addAdminMarkersToMap();
        });
      }
      const exportBtn = document.getElementById('btn-admin-export');
      if (exportBtn) {
        exportBtn.addEventListener('click', adminExportExcel);
      }
      const logoutBtn = document.getElementById('btn-admin-logout');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', deactivateAdmin);
      }
      renderAdminMarkersList();
    }, 50);
  }

  setTimeout(() => {
    const loginBtn = document.getElementById('btn-admin-login');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        const pwd = document.getElementById('admin-password').value;
        activateAdmin(pwd);
      });
    }
    const pwdInput = document.getElementById('admin-password');
    if (pwdInput) {
      pwdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const pwd = pwdInput.value;
          activateAdmin(pwd);
        }
      });
    }
  }, 50);
}

function renderAdminMarkersList(filterNickname) {
  const listEl = document.getElementById('admin-markers-list');
  if (!listEl) return;

  const filtered = filterNickname
    ? AdminManager.filterByNickname(filterNickname)
    : adminMarkersCache;

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="empty-msg">No hay muestras LSM</p>';
    return;
  }

  listEl.innerHTML = filtered.slice(0, 50).map(m => {
    const color = MARKER_COLORS[m.color]?.hex || '#58a6ff';
    return '<div class="admin-marker-item" data-lat="' + m.lat + '" data-lng="' + m.lng + '">' +
      '<span class="marker-item-dot" style="background:' + color + ';"></span>' +
      '<div class="marker-item-info">' +
        '<div class="marker-item-name">' + escapeHtml(m.nombre_muestra || '') + ' <span class="marker-type-badge">LSM</span></div>' +
        '<div class="marker-item-coords">' + escapeHtml(m.nickname || '') + ' | ' + formatDate(m.created_at) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  if (filtered.length > 50) {
    listEl.innerHTML += '<p class="empty-msg">Mostrando 50 de ' + filtered.length + '</p>';
  }

  listEl.querySelectorAll('.admin-marker-item').forEach(item => {
    item.addEventListener('click', () => {
      const lat = parseFloat(item.dataset.lat);
      const lng = parseFloat(item.dataset.lng);
      if (AppState.map && !isNaN(lat) && !isNaN(lng)) {
        AppState.map.setView([lat, lng], 17);
      }
    });
  });
}

async function adminExportExcel() {
  const markers = adminMarkersCache;
  if (markers.length === 0) {
    showToast('No hay datos para exportar', 'error');
    return;
  }

  showToast('Generando Excel...', 'info');

  try {
    const data = [];
    data.push([
      'Nickname', 'Nombre_Muestra', 'Tipo_Muestra', 'Nombre_Proyecto', 'Solicitante',
      'Estructura_Deposito', 'Subestructuras', 'Categoria', 'Tipo_Material',
      'Proveniencia', 'Localizacion', 'Fuente', 'Ensayos',
      'Norte', 'Este', 'Latitud', 'Longitud', 'Fecha_Hora'
    ]);

    markers.forEach(m => {
      data.push([
        m.nickname || '',
        m.nombre_muestra || '',
        m.tipo_muestra || '',
        m.nombre_proyecto || '',
        m.solicitante || '',
        m.estructura_deposito || '',
        m.subestructuras || '',
        m.categoria || '',
        m.tipo_material || '',
        m.proveniencia || '',
        m.localizacion || '',
        m.fuente || '',
        (m.ensayos || []).join(', '),
        m.norte || '',
        m.este || '',
        m.lat,
        m.lng,
        m.created_at ? formatDateTime(m.created_at) : ''
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'LSM_Admin');
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const dateStr = new Date().toISOString().slice(0, 10);
    saveAs(blob, 'LSM_Admin_' + dateStr + '.xlsx');

    showToast(markers.length + ' muestras exportadas', 'success');
  } catch (error) {
    console.error('Admin export error:', error);
    showToast('Error al exportar: ' + (error.message || 'Desconocido'), 'error');
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
// IMAGE COMPRESSION & PHOTO HANDLING
// ============================================

function compressImage(file, maxWidth = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
    };

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Error al comprimir imagen'));
        }
      }, 'image/jpeg', quality);
    };

    img.onerror = () => reject(new Error('Error al cargar imagen'));
    reader.onerror = () => reject(new Error('Error al leer archivo'));
    reader.readAsDataURL(file);
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handlePhotoCapture(file) {
  if (!file) return;

  try {
    showToast('Procesando foto...', 'info');
    const compressedBlob = await compressImage(file, 1600, 0.90);
    const dataUrl = await blobToDataURL(compressedBlob);

    if (AppState.pendingPhotos.length >= 2) {
      showToast('Solo se permiten 2 fotos por marcador', 'error');
      return;
    }

    AppState.pendingPhotos.push({ blob: compressedBlob, dataUrl: dataUrl });
    renderPhotoGrid();
    showToast('Foto agregada', 'success');
  } catch (error) {
    console.error('Error processing photo:', error);
    showToast('Error al procesar la foto', 'error');
  }
}

function getPhotoGridId() {
  return AppState.pendingMarkerType === 'lsm' ? 'lsm-photo-grid' : 'photo-grid';
}

function getAddPhotoBtnId() {
  return AppState.pendingMarkerType === 'lsm' ? 'btn-lsm-add-photo' : 'btn-add-photo';
}

function renderPhotoGrid() {
  const grid = document.getElementById(getPhotoGridId());
  if (!grid) return;

  grid.innerHTML = AppState.pendingPhotos.map((photo, index) => {
    return '<div class="photo-thumb">' +
      '<img src="' + photo.dataUrl + '" alt="Foto ' + (index + 1) + '">' +
      '<button class="photo-remove" data-index="' + index + '" title="Eliminar foto">&times;</button>' +
      '</div>';
  }).join('');

  grid.querySelectorAll('.photo-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      AppState.pendingPhotos.splice(idx, 1);
      renderPhotoGrid();
    });
  });

  const btnAddPhoto = document.getElementById(getAddPhotoBtnId());
  if (btnAddPhoto) {
    btnAddPhoto.style.display = AppState.pendingPhotos.length >= 2 ? 'none' : 'flex';
  }
}

function clearPendingPhotos() {
  AppState.pendingPhotos = [];
  renderPhotoGrid();
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
      if (AppState.currentMarkerMode === 'lsm') {
        openLSMLoginOrMarkerModal(e.latlng);
      } else {
        openMarkerModal(e.latlng);
      }
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

  if (type === 'qc') {
    AppState.pendingMarkerType = 'qc';
    openMarkerModal(latlng);
  } else {
    AppState.pendingMarkerType = 'lsm';
    openLSMLoginOrMarkerModal(latlng);
  }
}

// ============================================
// LSM LOGIN & MARKER MODAL
// ============================================

function openLSMLoginOrMarkerModal(latlng) {
  if (LSMUserManager.isLoggedIn()) {
    openLSMMarkerModal(latlng);
  } else {
    openLSMLoginModal(latlng);
  }
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

  if (!nickname) {
    showToast('Ingresa un nickname', 'error');
    return;
  }

  if (!LSMUserManager.validate(nickname, password)) {
    showToast('Contrasena incorrecta', 'error');
    return;
  }

  LSMUserManager.set(nickname);
  showToast('Bienvenido, ' + nickname, 'success');
  closeLSMLoginModal();

  const latlng = AppState.pendingMarkerLatLng;
  if (latlng) {
    openLSMMarkerModal(latlng);
  }
}

function populateLsmSelect(id, key, required) {
  const select = document.getElementById(id);
  if (!select) return;
  const values = ConfigManager.getValues(key);
  select.innerHTML = '';
  if (!required) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- Seleccionar --';
    select.appendChild(opt);
  }
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
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

function getLastLSMForm() {
  try {
    return JSON.parse(localStorage.getItem(LAST_LSM_KEY)) || {};
  } catch {
    return {};
  }
}

function saveLastLSMForm(data) {
  const copy = { ...data };
  delete copy.nombreMuestra;
  delete copy.ensayos;
  localStorage.setItem(LAST_LSM_KEY, JSON.stringify(copy));
}

async function openLSMMarkerModal(latlng, editId) {
  AppState.pendingMarkerLatLng = latlng;
  AppState.editingMarkerId = editId || null;
  AppState.pendingMarkerType = 'lsm';
  clearPendingPhotos();

  // Populate selects
  populateLsmSelect('lsm-tipo-muestra', 'tipo_muestra');
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
  document.getElementById('lsm-coords-display').textContent =
    'N: ' + north.toFixed(3) + ' | E: ' + east.toFixed(3);

  if (editId) {
    const marker = MarkerManager.getById(editId);
    if (!marker || marker.markerType !== 'lsm') return;
    document.getElementById('lsm-modal-title').textContent = 'Editar Muestra LSM';
    const d = marker.lsmData || {};
    document.getElementById('lsm-tipo-muestra').value = d.tipoMuestra || '';
    document.getElementById('lsm-nombre-proyecto').value = d.nombreProyecto || '';
    document.getElementById('lsm-solicitante').value = d.solicitante || '';
    document.getElementById('lsm-estructura-deposito').value = d.estructuraDeposito || '';
    document.getElementById('lsm-subestructuras').value = d.subestructuras || '';
    document.getElementById('lsm-categoria').value = d.categoria || '';
    document.getElementById('lsm-tipo-material').value = d.tipoMaterial || '';
    document.getElementById('lsm-nombre-muestra').value = marker.name || '';
    document.getElementById('lsm-proveniencia').value = d.proveniencia || '';
    document.getElementById('lsm-localizacion').value = d.localizacion || '';
    document.getElementById('lsm-fuente').value = d.fuente || '';

    // Check ensayos
    const ensayos = d.ensayos || [];
    document.querySelectorAll('#lsm-ensayos-group input[type="checkbox"]').forEach(cb => {
      cb.checked = ensayos.includes(cb.value);
    });

    AppState.lsmSelectedCategory = marker.color || 'red';

    // Load photos
    if (marker.photos && marker.photos.length > 0) {
      for (const photoId of marker.photos) {
        try {
          const photoRecord = await MapStorage.getPhoto(photoId);
          if (photoRecord && photoRecord.blob) {
            const dataUrl = await blobToDataURL(photoRecord.blob);
            AppState.pendingPhotos.push({ photoId: photoId, blob: photoRecord.blob, dataUrl: dataUrl });
          }
        } catch (e) {
          console.warn('Could not load photo:', photoId, e);
        }
      }
      renderPhotoGrid();
    }
  } else {
    document.getElementById('lsm-modal-title').textContent = 'Nueva Muestra LSM';
    const last = getLastLSMForm();
    document.getElementById('lsm-tipo-muestra').value = last.tipoMuestra || '';
    document.getElementById('lsm-nombre-proyecto').value = last.nombreProyecto || '';
    document.getElementById('lsm-solicitante').value = last.solicitante || '';
    document.getElementById('lsm-estructura-deposito').value = last.estructuraDeposito || '';
    document.getElementById('lsm-subestructuras').value = last.subestructuras || '';
    document.getElementById('lsm-categoria').value = last.categoria || '';
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
  AppState.pendingMarkerLatLng = null;
  AppState.editingMarkerId = null;
  AppState.isAddMarkerMode = false;
  clearPendingPhotos();
  document.getElementById('btn-add-marker').classList.remove('active');
}

async function saveLSMMarker() {
  const nombreMuestra = document.getElementById('lsm-nombre-muestra').value.trim();
  if (!nombreMuestra) {
    showToast('Ingresa el Nombre de Muestra', 'error');
    return;
  }

  // Gather LSM data
  const lsmData = {
    tipoMuestra: document.getElementById('lsm-tipo-muestra').value.trim(),
    nombreProyecto: document.getElementById('lsm-nombre-proyecto').value.trim(),
    solicitante: document.getElementById('lsm-solicitante').value.trim(),
    estructuraDeposito: document.getElementById('lsm-estructura-deposito').value.trim(),
    subestructuras: document.getElementById('lsm-subestructuras').value.trim(),
    categoria: document.getElementById('lsm-categoria').value.trim(),
    tipoMaterial: document.getElementById('lsm-tipo-material').value.trim(),
    nombreMuestra: nombreMuestra,
    proveniencia: document.getElementById('lsm-proveniencia').value.trim(),
    localizacion: document.getElementById('lsm-localizacion').value.trim(),
    fuente: document.getElementById('lsm-fuente').value.trim(),
    ensayos: Array.from(document.querySelectorAll('#lsm-ensayos-group input[type="checkbox"]:checked')).map(cb => cb.value)
  };

  // Save photos
  const photoIds = [];
  for (const photo of AppState.pendingPhotos) {
    try {
      if (photo.photoId) {
        photoIds.push(photo.photoId);
      } else if (photo.blob) {
        const markerId = AppState.editingMarkerId || ('m_' + Date.now());
        const photoId = await MapStorage.savePhoto(photo.blob, markerId);
        photoIds.push(photoId);
      }
    } catch (e) {
      console.error('Error saving photo:', e);
    }
  }

  if (AppState.editingMarkerId) {
    const oldMarker = MarkerManager.getById(AppState.editingMarkerId);
    if (oldMarker && oldMarker.photos) {
      const removedPhotos = oldMarker.photos.filter(id => !photoIds.includes(id));
      for (const photoId of removedPhotos) {
        try {
          await MapStorage.deletePhoto(photoId);
        } catch (e) {
          console.warn('Could not delete old photo:', photoId);
        }
      }
    }

    MarkerManager.update(AppState.editingMarkerId, {
      name: nombreMuestra,
      color: AppState.lsmSelectedCategory,
      photos: photoIds,
      lsmData: lsmData,
      pendingUpload: true
    });
    showToast('Muestra LSM actualizada', 'success');
  } else if (AppState.pendingMarkerLatLng) {
    const { lat, lng } = AppState.pendingMarkerLatLng;
    MarkerManager.createLSM(lat, lng, AppState.lsmSelectedCategory, photoIds, lsmData);
    showToast('Muestra LSM "' + nombreMuestra + '" guardada', 'success');
  }

  saveLastLSMForm(lsmData);
  refreshMarkersOnMap();
  updateMarkerCountBadge();
  closeLSMMarkerModal();

  // Try sync
  if (await LSMSyncManager.shouldUpload()) {
    LSMSyncManager.syncPending();
  }
}

// ============================================
// MARKER MODAL (Create/Edit) - QC ONLY
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
    document.getElementById('marker-coords-display').textContent =
      'N: ' + north.toFixed(3) + ' | E: ' + east.toFixed(3);

    // Load existing photos
    if (marker.photos && marker.photos.length > 0) {
      for (const photoId of marker.photos) {
        try {
          const photoRecord = await MapStorage.getPhoto(photoId);
          if (photoRecord && photoRecord.blob) {
            const dataUrl = await blobToDataURL(photoRecord.blob);
            AppState.pendingPhotos.push({ photoId: photoId, blob: photoRecord.blob, dataUrl: dataUrl });
          }
        } catch (e) {
          console.warn('Could not load photo:', photoId, e);
        }
      }
      renderPhotoGrid();
    }
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
  clearPendingPhotos();
  document.getElementById('btn-add-marker').classList.remove('active');
}

async function saveMarker() {
  const name = document.getElementById('marker-name').value.trim();
  const description = document.getElementById('marker-description').value.trim();

  if (!name) {
    showToast('Ingresa un nombre', 'error');
    return;
  }

  // Save photos to IndexedDB and collect photoIds
  const photoIds = [];
  for (const photo of AppState.pendingPhotos) {
    try {
      if (photo.photoId) {
        // Existing photo, keep the ID
        photoIds.push(photo.photoId);
      } else if (photo.blob) {
        // New photo, save to IndexedDB
        const markerId = AppState.editingMarkerId || ('m_' + Date.now());
        const photoId = await MapStorage.savePhoto(photo.blob, markerId);
        photoIds.push(photoId);
      }
    } catch (e) {
      console.error('Error saving photo:', e);
    }
  }

  if (AppState.editingMarkerId) {
    // Delete old photos that were removed
    const oldMarker = MarkerManager.getById(AppState.editingMarkerId);
    if (oldMarker && oldMarker.photos) {
      const removedPhotos = oldMarker.photos.filter(id => !photoIds.includes(id));
      for (const photoId of removedPhotos) {
        try {
          await MapStorage.deletePhoto(photoId);
        } catch (e) {
          console.warn('Could not delete old photo:', photoId);
        }
      }
    }

    MarkerManager.update(AppState.editingMarkerId, {
      name: name,
      description: description,
      color: AppState.selectedCategory,
      photos: photoIds
    });
    showToast('Marcador actualizado', 'success');
  } else if (AppState.pendingMarkerLatLng) {
    const { lat, lng } = AppState.pendingMarkerLatLng;
    MarkerManager.createQC(name, description, lat, lng, AppState.selectedCategory, photoIds);
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
    detailBody.innerHTML =
      '<div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">LSM</span></div>' +
      '<div class="detail-row"><span class="detail-label">Tipo de Muestra</span><span class="detail-value">' + escapeHtml(d.tipoMuestra || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Proyecto</span><span class="detail-value">' + escapeHtml(d.nombreProyecto || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Solicitante</span><span class="detail-value">' + escapeHtml(d.solicitante || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Estructura/Deposito</span><span class="detail-value">' + escapeHtml(d.estructuraDeposito || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Subestructuras</span><span class="detail-value">' + escapeHtml(d.subestructuras || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Categoria</span><span class="detail-value">' + escapeHtml(d.categoria || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Tipo de Material</span><span class="detail-value">' + escapeHtml(d.tipoMaterial || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Proveniencia</span><span class="detail-value">' + escapeHtml(d.proveniencia || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Localizacion</span><span class="detail-value">' + escapeHtml(d.localizacion || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Fuente</span><span class="detail-value">' + escapeHtml(d.fuente || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Ensayos</span><span class="detail-value">' + escapeHtml(ensayosStr || '-') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Norte (PSAD56)</span><span class="detail-value">' + marker.norte + ' m</span></div>' +
      '<div class="detail-row"><span class="detail-label">Este (PSAD56)</span><span class="detail-value">' + marker.este + ' m</span></div>' +
      '<div class="detail-row"><span class="detail-label">Latitud (WGS84)</span><span class="detail-value">' + marker.lat.toFixed(8) + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Longitud (WGS84)</span><span class="detail-value">' + marker.lng.toFixed(8) + '</span></div>' +
      '<div id="detail-photos-row" class="detail-row detail-photos"><span class="detail-label">Fotos</span><div id="detail-marker-photos" class="detail-photo-grid"></div></div>';
  } else {
    detailBody.innerHTML =
      '<div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">QC</span></div>' +
      '<div class="detail-row"><span class="detail-label">Categoria</span><span class="detail-value">' + (MARKER_COLORS[marker.color]?.label || 'Rojo') + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Norte (PSAD56)</span><span class="detail-value">' + marker.norte + ' m</span></div>' +
      '<div class="detail-row"><span class="detail-label">Este (PSAD56)</span><span class="detail-value">' + marker.este + ' m</span></div>' +
      '<div class="detail-row"><span class="detail-label">Latitud (WGS84)</span><span class="detail-value">' + marker.lat.toFixed(8) + '</span></div>' +
      '<div class="detail-row"><span class="detail-label">Longitud (WGS84)</span><span class="detail-value">' + marker.lng.toFixed(8) + '</span></div>' +
      '<div id="detail-description-row" class="detail-row detail-description"><span class="detail-label">Descripcion</span><p id="detail-marker-description"></p></div>' +
      '<div id="detail-photos-row" class="detail-row detail-photos"><span class="detail-label">Fotos</span><div id="detail-marker-photos" class="detail-photo-grid"></div></div>';

    const descRow = document.getElementById('detail-description-row');
    if (marker.description) {
      descRow.classList.remove('hidden');
      document.getElementById('detail-marker-description').textContent = marker.description;
    } else {
      descRow.classList.add('hidden');
    }
  }

  // Load and display photos
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
          img.addEventListener('click', () => {
            const win = window.open();
            win.document.write('<img src="' + dataUrl + '" style="max-width:100%">');
          });
          photosGrid.appendChild(img);
        }
      } catch (e) {
        console.warn('Could not load photo for detail:', photoId);
      }
    }
  } else {
    photosRow.classList.add('hidden');
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
  if (marker.markerType === 'lsm') {
    openLSMMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
  } else {
    openMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
  }
}

async function deleteCurrentMarker() {
  const id = document.getElementById('marker-detail-modal').dataset.markerId;
  const marker = MarkerManager.getById(id);

  // Delete associated photos
  if (marker && marker.photos && marker.photos.length > 0) {
    for (const photoId of marker.photos) {
      try {
        await MapStorage.deletePhoto(photoId);
      } catch (e) {
        console.warn('Could not delete photo:', photoId);
      }
    }
  }

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
    const typeLabel = m.markerType === 'lsm' ? 'LSM' : 'QC';
    return '<div class="marker-item" data-id="' + m.id + '">' +
      '<span class="marker-item-dot" style="background:' + color + ';"></span>' +
      '<div class="marker-item-info">' +
        '<div class="marker-item-name">' + escapeHtml(m.name) + ' <span class="marker-type-badge">' + typeLabel + '</span></div>' +
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
        if (marker.markerType === 'lsm') {
          openLSMMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
        } else {
          openMarkerModal({ lat: marker.lat, lng: marker.lng }, id);
        }
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
// ZIP + EXCEL EXPORT
// ============================================

function openExportModal() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('export-today-date').textContent = formatDate(today);
  document.getElementById('export-date-from').value = today;
  document.getElementById('export-date-to').value = today;

  updateExportSummary();
  document.getElementById('export-modal').classList.remove('hidden');
}

function closeExportModal() {
  document.getElementById('export-modal').classList.add('hidden');
}

function getExportType() {
  return document.querySelector('input[name="export-type"]:checked').value;
}

function getExportMarkers() {
  const markers = MarkerManager.getAll();
  const type = getExportType();

  if (type === 'today') {
    const todayStr = new Date().toISOString().slice(0, 10);
    return markers.filter(m => m.createdAt && m.createdAt.startsWith(todayStr));
  } else {
    const fromVal = document.getElementById('export-date-from').value;
    const toVal = document.getElementById('export-date-to').value;
    if (!fromVal || !toVal) return markers;

    const fromDate = new Date(fromVal);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(toVal);
    toDate.setHours(23, 59, 59, 999);

    return markers.filter(m => {
      if (!m.createdAt) return false;
      const d = new Date(m.createdAt);
      return d >= fromDate && d <= toDate;
    });
  }
}

function updateExportSummary() {
  const count = getExportMarkers().length;
  document.getElementById('export-count').textContent = count;
}

async function exportToZIP() {
  const markers = getExportMarkers();

  if (markers.length === 0) {
    showToast('No hay marcadores para exportar en el rango seleccionado', 'error');
    return;
  }

  showToast('Generando ZIP...', 'info');

  try {
    const zip = new JSZip();
    const folder = zip.folder('fotos');

    const qcMarkers = markers.filter(m => m.markerType === 'qc');
    const lsmMarkers = markers.filter(m => m.markerType === 'lsm');

    // Create Excel workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: QC
    if (qcMarkers.length > 0) {
      const qcData = [];
      qcData.push([
        'Nombre', 'Categoria', 'Descripcion', 'Norte (m)', 'Este (m)',
        'Latitud', 'Longitud', 'Fecha_Hora', 'Foto_1', 'Foto_2'
      ]);

      for (let i = 0; i < qcMarkers.length; i++) {
        const m = qcMarkers[i];
        const safeName = (m.name || 'SinNombre').replace(/[^a-zA-Z0-9]/g, '_');
        const rowNum = String(i + 1).padStart(3, '0');
        let foto1Name = '';
        let foto2Name = '';

        if (m.photos && m.photos.length > 0) {
          for (let p = 0; p < m.photos.length && p < 2; p++) {
            const photoId = m.photos[p];
            try {
              const photoRecord = await MapStorage.getPhoto(photoId);
              if (photoRecord && photoRecord.blob) {
                const fileName = safeName + '_' + rowNum + '_foto' + (p + 1) + '.jpg';
                folder.file(fileName, photoRecord.blob);
                if (p === 0) foto1Name = fileName;
                if (p === 1) foto2Name = fileName;
              }
            } catch (e) {
              console.warn('Could not add photo to zip:', photoId);
            }
          }
        }

        qcData.push([
          m.name || '',
          MARKER_COLORS[m.color]?.label || '',
          m.description || '',
          m.norte,
          m.este,
          m.lat,
          m.lng,
          formatDateTime(m.createdAt),
          foto1Name,
          foto2Name
        ]);
      }
      const wsQC = XLSX.utils.aoa_to_sheet(qcData);
      XLSX.utils.book_append_sheet(wb, wsQC, 'Marcadores_QC');
    }

    // Sheet 2: LSM
    if (lsmMarkers.length > 0) {
      const lsmData = [];
      lsmData.push([
        'Nombre_Muestra', 'Tipo_Muestra', 'Nombre_Proyecto', 'Solicitante',
        'Estructura_Deposito', 'Subestructuras', 'Categoria', 'Tipo_Material',
        'Proveniencia', 'Localizacion', 'Fuente', 'Ensayos',
        'Norte (m)', 'Este (m)', 'Latitud', 'Longitud', 'Fecha_Hora', 'Foto_1', 'Foto_2'
      ]);

      for (let i = 0; i < lsmMarkers.length; i++) {
        const m = lsmMarkers[i];
        const d = m.lsmData || {};
        const safeName = (m.name || 'SinNombre').replace(/[^a-zA-Z0-9]/g, '_');
        const rowNum = String(i + 1).padStart(3, '0');
        let foto1Name = '';
        let foto2Name = '';

        if (m.photos && m.photos.length > 0) {
          for (let p = 0; p < m.photos.length && p < 2; p++) {
            const photoId = m.photos[p];
            try {
              const photoRecord = await MapStorage.getPhoto(photoId);
              if (photoRecord && photoRecord.blob) {
                const fileName = safeName + '_' + rowNum + '_foto' + (p + 1) + '.jpg';
                folder.file(fileName, photoRecord.blob);
                if (p === 0) foto1Name = fileName;
                if (p === 1) foto2Name = fileName;
              }
            } catch (e) {
              console.warn('Could not add photo to zip:', photoId);
            }
          }
        }

        lsmData.push([
          m.name || '',
          d.tipoMuestra || '',
          d.nombreProyecto || '',
          d.solicitante || '',
          d.estructuraDeposito || '',
          d.subestructuras || '',
          d.categoria || '',
          d.tipoMaterial || '',
          d.proveniencia || '',
          d.localizacion || '',
          d.fuente || '',
          (d.ensayos || []).join(', '),
          m.norte,
          m.este,
          m.lat,
          m.lng,
          formatDateTime(m.createdAt),
          foto1Name,
          foto2Name
        ]);
      }
      const wsLSM = XLSX.utils.aoa_to_sheet(lsmData);
      XLSX.utils.book_append_sheet(wb, wsLSM, 'Marcadores_LSM');
    }

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    zip.file('marcadores.xlsx', excelBuffer);

    // Generate and download ZIP
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const dateStr = new Date().toISOString().slice(0, 10);
    saveAs(zipBlob, 'marcadores_' + dateStr + '.zip');

    showToast(markers.length + ' marcadores exportados en ZIP', 'success');
    closeExportModal();
  } catch (error) {
    console.error('Export error:', error);
    showToast('Error al generar ZIP: ' + (error.message || 'Desconocido'), 'error');
  }
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
        console.error('Error guardando mapa:', error);
        const msg = error && error.message ? error.message : 'Error al guardar el mapa';
        showToast(msg, 'error');
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
    // Hacer una copia inmediata ANTES de que PDF.js la modifique/detache
    const arrayBufferForStorage = arrayBuffer.slice(0);
    // Pasar otra copia a PDFProcessor
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

    // Store pending PDF data - usar la copia que NUNCA paso por PDF.js
    AppState.pendingPDF = {
      name: file.name,
      arrayBuffer: arrayBufferForStorage,
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
    console.error('Error guardando PDF:', error);
    const msg = error && error.message ? error.message : 'Error al guardar el PDF';
    showToast(msg, 'error');
  }
}

// ============================================
// OPEN MAP VIEW
// ============================================

function updateModeToggleButton() {
  const btn = document.getElementById('btn-mode-toggle');
  const label = document.getElementById('mode-label');
  if (!btn || !label) return;
  if (AppState.isAdmin) {
    label.textContent = 'ADMIN';
    btn.classList.add('mode-lsm');
  } else if (AppState.currentMarkerMode === 'lsm') {
    label.textContent = 'LSM';
    btn.classList.add('mode-lsm');
  } else {
    label.textContent = 'QC';
    btn.classList.remove('mode-lsm');
  }
}

async function openMap(mapId) {
  AppState.currentMapId = mapId;
  const maps = await MapStorage.getAllMaps();
  const map = maps.find(m => m.id === mapId);
  AppState.currentMapType = map ? (map.type || 'tiff') : 'tiff';
  AppState.mapTitle = map ? map.name : 'Mapa';
  document.getElementById('map-title').textContent = AppState.mapTitle;

  // Reset mode to QC by default when entering map
  AppState.currentMarkerMode = 'qc';
  updateModeToggleButton();

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
  if (!navigator.onLine) {
    badge.textContent = 'Sin conexion';
    badge.className = 'status-badge offline';
    return;
  }
  if (supabaseClient) {
    badge.textContent = 'En linea + Sync';
    badge.className = 'status-badge online';
  } else {
    badge.textContent = 'En linea (sin DB)';
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
    const modeText = AppState.currentMarkerMode === 'lsm' ? 'LSM' : 'QC';
    showToast(
      AppState.isAddMarkerMode ? 'Modo ' + modeText + ': Toca el mapa para colocar un marcador' : 'Modo marcador desactivado',
      'info'
    );
  });

  // Mode toggle (QC / LSM)
  document.getElementById('btn-mode-toggle').addEventListener('click', () => {
    if (AppState.isAdmin) {
      showToast('Modo Admin activo. Desactiva Admin primero para cambiar modo.', 'info');
      return;
    }
    AppState.currentMarkerMode = AppState.currentMarkerMode === 'qc' ? 'lsm' : 'qc';
    updateModeToggleButton();
    showToast('Modo: ' + (AppState.currentMarkerMode === 'lsm' ? 'LSM' : 'QC'), 'info');
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

  // Photo capture
  document.getElementById('btn-add-photo').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });
  document.getElementById('photo-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handlePhotoCapture(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', openExportModal);

  // Markers panel
  document.getElementById('btn-markers-panel').addEventListener('click', openMarkersPanel);
  document.getElementById('btn-close-panel').addEventListener('click', closeMarkersPanel);
  document.getElementById('btn-export-panel').addEventListener('click', openExportModal);
  document.getElementById('marker-search').addEventListener('input', (e) => {
    renderMarkersList(e.target.value);
  });

  // Export modal
  document.getElementById('btn-cancel-export').addEventListener('click', closeExportModal);
  document.getElementById('btn-confirm-export').addEventListener('click', exportToZIP);
  document.querySelectorAll('input[name="export-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isRange = getExportType() === 'range';
      document.getElementById('export-range-fields').classList.toggle('hidden', !isRange);
      updateExportSummary();
    });
  });
  document.getElementById('export-date-from').addEventListener('change', updateExportSummary);
  document.getElementById('export-date-to').addEventListener('change', updateExportSummary);

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
        if (modal.id === 'marker-modal') {
          closeMarkerModal();
        } else if (modal.id === 'georef-modal') {
          closeGeorefModal();
        } else if (modal.id === 'export-modal') {
          closeExportModal();
        } else if (modal.id === 'marker-type-modal') {
          closeMarkerTypeModal();
        } else if (modal.id === 'lsm-login-modal') {
          closeLSMLoginModal();
        } else if (modal.id === 'lsm-marker-modal') {
          closeLSMMarkerModal();
        } else if (modal.id === 'config-modal') {
          closeConfigModal();
        } else if (modal.id === 'marker-detail-modal') {
          closeMarkerDetail();
        } else if (modal.id === 'delete-map-modal') {
          pendingDeleteMapId = null;
          modal.classList.add('hidden');
        } else {
          modal.classList.add('hidden');
        }
      }
    });
  });

  // Marker type selector
  document.getElementById('btn-type-qc').addEventListener('click', () => selectMarkerType('qc'));
  document.getElementById('btn-type-lsm').addEventListener('click', () => selectMarkerType('lsm'));
  document.getElementById('btn-cancel-type').addEventListener('click', closeMarkerTypeModal);

  // LSM login modal
  document.getElementById('btn-confirm-lsm-login').addEventListener('click', confirmLSMLogin);
  document.getElementById('btn-cancel-lsm-login').addEventListener('click', closeLSMLoginModal);
  document.getElementById('lsm-nickname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmLSMLogin();
  });

  // LSM marker modal
  document.getElementById('btn-save-lsm-marker').addEventListener('click', saveLSMMarker);
  document.getElementById('btn-cancel-lsm-marker').addEventListener('click', closeLSMMarkerModal);
  document.getElementById('lsm-nombre-muestra').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveLSMMarker();
  });

  // LSM category selector
  document.querySelectorAll('#lsm-category-selector .category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.lsmSelectedCategory = btn.dataset.color;
      updateLSMCategorySelector();
    });
  });

  // LSM photo capture
  document.getElementById('btn-lsm-add-photo').addEventListener('click', () => {
    document.getElementById('lsm-photo-input').click();
  });
  document.getElementById('lsm-photo-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handlePhotoCapture(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Home: download from Supabase
  document.getElementById('btn-home-pull').addEventListener('click', pullConfigFromHome);
  document.getElementById('btn-home-refresh').addEventListener('click', forceFullRefresh);

  // Config modal
  document.getElementById('btn-config').addEventListener('click', openConfigModal);
  document.getElementById('btn-close-config').addEventListener('click', closeConfigModal);
  document.getElementById('btn-config-sync').addEventListener('click', syncConfigWithSupabase);
  document.getElementById('btn-close-config-login').addEventListener('click', closeConfigLoginModal);
  document.getElementById('btn-config-login-cancel').addEventListener('click', closeConfigLoginModal);
  document.getElementById('btn-config-login-enter').addEventListener('click', attemptConfigLogin);
  document.getElementById('config-login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptConfigLogin();
  });
  document.querySelectorAll('.config-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.config-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('config-tab-' + tab.dataset.tab).classList.add('active');
    });
  });
  document.getElementById('btn-lsm-logout').addEventListener('click', () => {
    LSMUserManager.clear();
    updateConfigAccountTab();
    showToast('Sesion LSM cerrada', 'info');
  });

  // Online status + sync
  window.addEventListener('online', () => {
    updateOnlineStatus();
    if (!supabaseClient) {
      console.log('[App] Back online, attempting to reconnect to Supabase...');
      initSupabase();
      updateOnlineStatus();
    }
    LSMSyncManager.syncPending();
  });
  window.addEventListener('offline', updateOnlineStatus);
}

// ============================================
// CONFIG MODAL
// ============================================

function openConfigModal() {
  // Always show login first - require password every time
  document.getElementById('config-login-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('config-login-password').focus(), 100);
}

function closeConfigModal() {
  document.getElementById('config-modal').classList.add('hidden');
  // Upload local changes to Supabase, then resume sync
  if (supabaseClient && navigator.onLine) {
    ConfigManager.uploadToSupabase().then(ok => {
      if (ok) console.log('[Config] Uploaded on close');
    });
  }
  // Resume sync
  ConfigManager.subscribeToRealtime();
  ConfigManager.startPolling();
  // Log out so next time requires password again
  AdminManager.logout();
}

async function syncConfigWithSupabase() {
  const statusEl = document.getElementById('config-sync-status');
  const btn = document.getElementById('btn-config-sync');
  if (!statusEl || !btn) return;
  btn.disabled = true;
  statusEl.textContent = 'Subiendo...';
  statusEl.className = 'sync-status syncing';
  try {
    const up = await ConfigManager.uploadToSupabase();
    if (up) {
      statusEl.textContent = 'Subido!';
      statusEl.className = 'sync-status success';
      showToast('Config subida a Supabase', 'success');
    } else {
      statusEl.textContent = 'Sin cambios';
      statusEl.className = 'sync-status';
    }
  } catch (e) {
    console.error('[Config] Sync failed:', e);
    statusEl.textContent = 'Error al subir';
    statusEl.className = 'sync-status error';
    showToast('Error al subir', 'error');
  } finally {
    btn.disabled = false;
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'sync-status'; }, 3000);
  }
}

async function pullConfigFromSupabase() {
  const statusEl = document.getElementById('config-sync-status');
  if (!supabaseClient) {
    showToast('No hay conexion con Supabase', 'error');
    return;
  }
  if (statusEl) {
    statusEl.textContent = 'Descargando...';
    statusEl.className = 'sync-status syncing';
  }
  try {
    const ok = await ConfigManager.downloadFromSupabase(true);
    if (ok) {
      if (statusEl) {
        statusEl.textContent = 'Descargado!';
        statusEl.className = 'sync-status success';
      }
      showToast('Config descargada de Supabase', 'success');
    } else {
      if (statusEl) {
        statusEl.textContent = 'Sin cambios';
        statusEl.className = 'sync-status';
      }
    }
  } catch (e) {
    console.error('[Config] Pull failed:', e);
    if (statusEl) {
      statusEl.textContent = 'Error al descargar';
      statusEl.className = 'sync-status error';
    }
    showToast('Error al descargar', 'error');
  } finally {
    if (statusEl) {
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'sync-status'; }, 3000);
    }
  }
}

async function pullConfigFromHome() {
  const btn = document.getElementById('btn-home-pull');
  const statusEl = document.getElementById('home-sync-status');
  if (!btn) return;

  if (!supabaseClient) {
    showToast('No hay conexion con Supabase', 'error');
    return;
  }

  btn.disabled = true;
  if (statusEl) {
    statusEl.textContent = 'Descargando...';
    statusEl.className = 'sync-status syncing';
  }
  try {
    const configOk = await ConfigManager.downloadFromSupabase(true);
    const markersOk = await LSMSyncManager.syncMarkersFromSupabase();
    if (configOk || markersOk) {
      if (AppState.markersLayer) refreshMarkersOnMap();
      updateMarkerCountBadge();
      if (statusEl) {
        statusEl.textContent = 'Datos actualizados!';
        statusEl.className = 'sync-status success';
      }
      showToast('Datos descargados de la base de datos', 'success');
    } else {
      if (statusEl) {
        statusEl.textContent = 'Sin cambios nuevos';
        statusEl.className = 'sync-status';
      }
    }
  } catch (e) {
    console.error('[Home] Pull failed:', e);
    if (statusEl) {
      statusEl.textContent = 'Error al descargar';
      statusEl.className = 'sync-status error';
    }
    showToast('Error al descargar datos', 'error');
  } finally {
    btn.disabled = false;
    if (statusEl) {
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'sync-status'; }, 3000);
    }
  }
}

async function forceFullRefresh() {
  if (!supabaseClient) {
    showToast('No hay conexion con Supabase', 'error');
    return;
  }
  if (!confirm('Esto limpiara los datos locales y descargara todo de la base de datos.\n\nNo se perderan los mapas ni fotos guardados.\n\nContinuar?')) {
    return;
  }

  const btn = document.getElementById('btn-home-refresh');
  const statusEl = document.getElementById('home-refresh-status');
  if (btn) btn.disabled = true;
  if (statusEl) {
    statusEl.textContent = 'Actualizando...';
    statusEl.className = 'sync-status syncing';
  }

  const savedNickname = LSMUserManager.getNickname();

  localStorage.removeItem('maps_gis_markers_v3');
  localStorage.removeItem('maps_gis_config_v2');
  localStorage.removeItem('maps_gis_last_lsm_form');
  ConfigManager.clearDeletedValues();

  try {
    await ConfigManager.downloadFromSupabase(true);

    if (savedNickname) {
      LSMUserManager.set(savedNickname);
    }
    await LSMSyncManager.syncMarkersFromSupabase();
    await LSMSyncManager.syncPending();

    if (AppState.markersLayer) refreshMarkersOnMap();
    updateMarkerCountBadge();
    if (statusEl) {
      statusEl.textContent = 'Listo!';
      statusEl.className = 'sync-status success';
    }
    showToast('Actualizacion completa finalizada', 'success');
  } catch (e) {
    console.error('[FullRefresh] Error:', e);
    if (statusEl) {
      statusEl.textContent = 'Error';
      statusEl.className = 'sync-status error';
    }
    showToast('Error en la actualizacion: ' + (e.message || 'Desconocido'), 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (statusEl) {
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'sync-status'; }, 3000);
    }
  }
}

function closeConfigLoginModal() {
  document.getElementById('config-login-modal').classList.add('hidden');
  document.getElementById('config-login-password').value = '';
}

function attemptConfigLogin() {
  const pwd = document.getElementById('config-login-password').value;
  if (!pwd) {
    showToast('Ingresa la contrasena', 'error');
    return;
  }
  if (pwd === ADMIN_PASS) {
    console.log('[Config] Login successful');
    AdminManager.login(pwd);
    closeConfigLoginModal();
    AppState.isAdmin = true;
    renderConfigSections();
    updateConfigAccountTab();
    renderAdminPanel();
    document.getElementById('config-modal').classList.remove('hidden');
    // Freeze sync while editing config
    ConfigManager.stopPolling();
    if (ConfigManager._realtimeChannel) {
      try { supabaseClient.removeChannel(ConfigManager._realtimeChannel); } catch(e) {}
      ConfigManager._realtimeChannel = null;
    }
    // Show connection status
    if (!supabaseClient) {
      showToast('Admin activado pero sin conexion a Supabase', 'warning');
    } else {
      showToast('Admin activado. Conectado a Supabase.', 'success');
    }
  } else {
    console.warn('[Config] Login failed - incorrect password');
    showToast('Contrasena incorrecta', 'error');
  }
}

function updateConfigAccountTab() {
  const nick = LSMUserManager.getNickname();
  document.getElementById('config-lsm-nickname').textContent = nick || 'No ingresado';
}

function renderConfigSections() {
  const container = document.getElementById('config-sections');
  const labels = {
    tipo_muestra: 'Tipo de Muestra',
    nombre_proyecto: 'Nombre del Proyecto',
    solicitante: 'Solicitante',
    estructura_deposito: 'Estructura / Deposito',
    subestructuras: 'Subestructuras',
    categoria: 'Categoria',
    tipo_material: 'Tipo de Material',
    proveniencia: 'Proveniencia',
    localizacion: 'Localizacion',
    fuente: 'Fuente',
    ensayos: 'Ensayos'
  };

  container.innerHTML = '';
  CONFIG_KEYS.forEach(key => {
    const values = ConfigManager.getValues(key);
    const section = document.createElement('div');
    section.className = 'config-section open';
    section.dataset.key = key;
    section.innerHTML =
      '<div class="config-section-header">' +
        '<h4>' + labels[key] + '</h4>' +
        '<span class="config-section-toggle">&#9650;</span>' +
      '</div>' +
      '<div class="config-section-body">' +
        '<div class="config-tag-list">' + values.map(v =>
          '<span class="config-tag">' + escapeHtml(v) + '<button data-val="' + v.replace(/"/g, '&quot;') + '">&times;</button></span>'
        ).join('') + '</div>' +
        '<div class="config-input-row">' +
          '<input type="text" placeholder="Nueva opcion..." maxlength="50">' +
          '<button class="btn-primary btn-sm btn-add-config">Agregar</button>' +
        '</div>' +
      '</div>';

    container.appendChild(section);

    // Toggle section
    section.querySelector('.config-section-header').addEventListener('click', () => {
      section.classList.toggle('open');
    });

    // Remove value
    section.querySelectorAll('.config-tag button').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const val = btn.dataset.val;
        console.log('[Config] Removing value:', key, '=', val);
        ConfigManager.removeValue(key, val);
        renderConfigSections();
        // Auto-upload to Supabase
        if (supabaseClient && navigator.onLine) {
          try {
            await ConfigManager.uploadToSupabase();
          } catch (err) {
            console.error('[Config] Auto-upload failed after remove:', err);
          }
        }
      });
    });

    // Add value
    const addBtn = section.querySelector('.btn-add-config');
    const input = section.querySelector('input');
    const doAdd = async () => {
      const val = input.value.trim();
      if (!val) {
        showToast('Ingresa un valor', 'error');
        return;
      }
      if (ConfigManager.addValue(key, val)) {
        input.value = '';
        renderConfigSections();
        // Auto-upload to Supabase
        if (supabaseClient && navigator.onLine) {
          try {
            await ConfigManager.uploadToSupabase();
          } catch (err) {
            console.error('[Config] Auto-upload failed after add:', err);
          }
        }
      } else {
        showToast('Opcion duplicada o vacia', 'error');
      }
    };
    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd();
    });
  });
}

// ============================================
// APP INITIALIZATION
// ============================================

async function initApp() {
  loadThemePreference();
  updateOnlineStatus();
  initSupabase();
  updateOnlineStatus();
  initEventListeners();
  await loadMapsList();
  updateMarkerCountBadge();

  if (supabaseClient) {
    // Sync config from Supabase on startup
    await ConfigManager.downloadFromSupabase();
    ConfigManager.subscribeToRealtime();
    ConfigManager.startPolling();
    LSMSyncManager.syncPending();
    LSMSyncManager.syncMarkersFromSupabase();
  } else {
    console.warn('[App] No Supabase client - running in offline mode');
  }

  // Re-sync config when user returns to the tab
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && supabaseClient && navigator.onLine) {
      console.log('[App] Tab regained focus, syncing...');
      ConfigManager.downloadFromSupabase();
      LSMSyncManager.syncMarkersFromSupabase();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
