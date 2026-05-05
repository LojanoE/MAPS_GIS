/**
 * sync-manager.js - MAPS GIS Offline-First Sync Manager v2.0
 * Sincroniza marcadores QC y LSM a Supabase via REST API.
 * One-way UP: dispositivo -> Supabase.
 *
 * NOTA: Este archivo se carga DESPUES de app.js.
 * Usa variables globales definidas en app.js: MarkerManager, DEVICE_NAME_KEY, DEVICE_ID_KEY, showToast
 */

const SYNC_SUPABASE_URL = 'https://dzmhhlsttqygjvfabdxx.supabase.co/rest/v1';
const SYNC_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6bWhobHN0dHF5Z2p2ZmFiZHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTE3MDAsImV4cCI6MjA5MDcyNzcwMH0._Gf0G2gpV_9QAYqFx1Kn6TN0lFDq3LxmBdNI82Suj-o';

const SyncManager = {
  isOnline: navigator.onLine,
  isWifi: false,
  syncing: false,

  init() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => { this.isOnline = false; this.updateBadge(); });
    if ('connection' in navigator) {
      navigator.connection.addEventListener('change', () => this.checkConnection());
      this.checkConnection();
    }
    this.updateBadge();
  },

  getDeviceInfo() {
    // Usa las variables de app.js
    return {
      deviceId: localStorage.getItem('maps_gis_device_id') || '',
      userName: localStorage.getItem('maps_gis_device_name') || ''
    };
  },

  checkConnection() {
    const conn = navigator.connection;
    if (conn) {
      this.isWifi = (conn.effectiveType === '4g' || conn.effectiveType === 'wifi') && !conn.saveData;
      if (this.isWifi && this.isOnline && !this.syncing) {
        this.syncAllPending();
      }
    }
    this.updateBadge();
  },

  handleOnline() {
    this.isOnline = true;
    this.checkConnection();
  },

  getPendingCount() {
    if (typeof MarkerManager === 'undefined') return 0;
    return MarkerManager.getAll().filter(m => m.pendingUpload === true).length;
  },

  updateBadge() {
    const badge = document.getElementById('sync-pending-badge');
    if (!badge) return;
    const count = this.getPendingCount();
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const btn = document.getElementById('btn-sync');
    if (btn) {
      if (!this.isOnline) {
        btn.style.opacity = '0.5';
        btn.title = 'Sin conexion';
      } else if (this.syncing) {
        btn.style.opacity = '0.7';
        btn.title = 'Sincronizando...';
      } else {
        btn.style.opacity = '1';
        btn.title = count > 0 ? `Sincronizar ${count} pendientes` : 'Todo sincronizado';
      }
    }
  },

  async syncAllPending(force = false) {
    if (this.syncing) return { uploaded: 0, failed: 0 };
    if (!this.isOnline) {
      if (typeof showToast === 'function') showToast('Sin conexion a internet', 'error');
      return { uploaded: 0, failed: 0 };
    }
    if (typeof MarkerManager === 'undefined') {
      if (typeof showToast === 'function') showToast('Error interno: MarkerManager no disponible', 'error');
      return { uploaded: 0, failed: 0 };
    }

    const pending = MarkerManager.getAll().filter(m => m.pendingUpload === true);
    if (pending.length === 0) {
      if (force && typeof showToast === 'function') showToast('No hay marcadores pendientes', 'info');
      return { uploaded: 0, failed: 0 };
    }

    this.syncing = true;
    this.updateBadge();
    if (typeof showToast === 'function') showToast(`Sincronizando ${pending.length} marcadores...`, 'info');

    let uploaded = 0;
    let failed = 0;

    for (const marker of pending) {
      try {
        const success = marker.markerType === 'qc'
          ? await this.uploadQC(marker)
          : await this.uploadLSM(marker);
        if (success) {
          MarkerManager.update(marker.id, { pendingUpload: false, syncedAt: new Date().toISOString() });
          uploaded++;
        } else {
          failed++;
        }
      } catch (e) {
        console.error('[Sync] Error uploading marker:', marker.id, e);
        failed++;
      }
    }

    this.syncing = false;
    this.updateBadge();

    if (typeof showToast === 'function') {
      if (uploaded > 0 && failed === 0) {
        showToast(`${uploaded} marcador(es) sincronizado(s)`, 'success');
      } else if (uploaded > 0 && failed > 0) {
        showToast(`${uploaded} ok, ${failed} fallaron`, 'warning');
      } else if (failed > 0) {
        showToast(`${failed} marcador(es) fallaron`, 'error');
      }
    }

    return { uploaded, failed };
  },

  async uploadQC(marker) {
    const { deviceId, userName } = this.getDeviceInfo();
    if (!deviceId || !userName) return false;

    const body = {
      device_id: deviceId,
      local_marker_id: marker.id,
      user_name: userName,
      name: marker.name,
      description: marker.description || '',
      lat: marker.lat,
      lng: marker.lng,
      norte: marker.norte || '',
      este: marker.este || '',
      color: marker.color || 'red',
      photos_count: (marker.photos || []).length,
      photo_ids: marker.photos || []
    };

    const exists = await this.checkExists('qc_markers', marker.id, deviceId);
    const method = exists ? 'PATCH' : 'POST';
    const url = exists
      ? `${SYNC_SUPABASE_URL}/qc_markers?local_marker_id=eq.${encodeURIComponent(marker.id)}&device_id=eq.${encodeURIComponent(deviceId)}`
      : `${SYNC_SUPABASE_URL}/qc_markers`;

    const res = await fetch(url, {
      method,
      headers: {
        'apikey': SYNC_SUPABASE_KEY,
        'Authorization': `Bearer ${SYNC_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': exists ? 'return=representation' : 'return=representation'
      },
      body: JSON.stringify(body)
    });

    return res.ok;
  },

  async uploadLSM(marker) {
    const { deviceId, userName } = this.getDeviceInfo();
    if (!deviceId || !userName) return false;

    const d = marker.lsmData || {};
    const body = {
      device_id: deviceId,
      local_marker_id: marker.id,
      user_name: userName,
      lat: marker.lat,
      lng: marker.lng,
      norte: marker.norte || '',
      este: marker.este || '',
      color: marker.color || 'red',
      photos_count: (marker.photos || []).length,
      photo_ids: marker.photos || [],
      nombre_muestra: marker.name || d.nombreMuestra || '',
      tipo_muestra: d.tipoMuestra || '',
      nombre_proyecto: d.nombreProyecto || '',
      solicitante: d.solicitante || '',
      estructura_deposito: d.estructuraDeposito || '',
      subestructuras: d.subestructuras || '',
      categoria: d.categoria || '',
      tipo_material: d.tipoMaterial || '',
      proveniencia: d.proveniencia || '',
      localizacion: d.localizacion || '',
      fuente: d.fuente || '',
      ensayos: d.ensayos || []
    };

    const exists = await this.checkExists('lsm_markers', marker.id, deviceId);
    const method = exists ? 'PATCH' : 'POST';
    const url = exists
      ? `${SYNC_SUPABASE_URL}/lsm_markers?local_marker_id=eq.${encodeURIComponent(marker.id)}&device_id=eq.${encodeURIComponent(deviceId)}`
      : `${SYNC_SUPABASE_URL}/lsm_markers`;

    const res = await fetch(url, {
      method,
      headers: {
        'apikey': SYNC_SUPABASE_KEY,
        'Authorization': `Bearer ${SYNC_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': exists ? 'return=representation' : 'return=representation'
      },
      body: JSON.stringify(body)
    });

    return res.ok;
  },

  async checkExists(table, localMarkerId, deviceId) {
    if (!deviceId) return false;
    try {
      const res = await fetch(
        `${SYNC_SUPABASE_URL}/${table}?select=id&local_marker_id=eq.${encodeURIComponent(localMarkerId)}&device_id=eq.${encodeURIComponent(deviceId)}&limit=1`,
        {
          headers: {
            'apikey': SYNC_SUPABASE_KEY,
            'Authorization': `Bearer ${SYNC_SUPABASE_KEY}`
          }
        }
      );
      if (!res.ok) return false;
      const data = await res.json();
      return Array.isArray(data) && data.length > 0;
    } catch (e) {
      return false;
    }
  }
};
