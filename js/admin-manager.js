/**
 * admin-manager.js - MAPS GIS Admin Panel v2.0
 * Panel de administracion remoto via Supabase.
 * Solo online. No afecta datos locales del dispositivo.
 */

const ADMIN_PASS = 'LSMQC$';
const SUPABASE_ADMIN_URL = 'https://dzmhhlsttqygjvfabdxx.supabase.co/rest/v1';
const SUPABASE_ADMIN_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6bWhobHN0dHF5Z2p2ZmFiZHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTE3MDAsImV4cCI6MjA5MDcyNzcwMH0._Gf0G2gpV_9QAYqFx1Kn6TN0lFDq3LxmBdNI82Suj-o';

const AdminManager = {
  isLoggedIn: false,
  allMarkers: [],
  selectedMarker: null,
  adminMap: null,
  adminMapLayer: null,
  adminMapOverlay: null,
  adminSelectedMapId: null,
  currentTab: 'mapa',

  // ============================================
  // LOGIN
  // ============================================
  openLogin() {
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-login-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('admin-password').focus(), 100);
  },

  closeLogin() {
    document.getElementById('admin-login-modal').classList.add('hidden');
  },

  confirmLogin() {
    const pass = document.getElementById('admin-password').value.trim();
    if (pass === ADMIN_PASS) {
      this.isLoggedIn = true;
      this.closeLogin();
      this.openPanel();
    } else {
      showToast('Contrasena incorrecta', 'error');
    }
  },

  logout() {
    this.isLoggedIn = false;
    this.allMarkers = [];
    this.selectedMarker = null;
    this.closePanel();
    showToast('Sesion de admin cerrada', 'info');
  },

  // ============================================
  // PANEL PRINCIPAL
  // ============================================
  openPanel() {
    this.currentTab = 'mapa';
    this.renderTabs();
    document.getElementById('admin-panel-modal').classList.remove('hidden');
    this.loadMarkers().then(() => {
      this.switchTab('mapa');
    });
  },

  closePanel() {
    document.getElementById('admin-panel-modal').classList.add('hidden');
    if (this.adminMap) {
      this.adminMap.remove();
      this.adminMap = null;
      this.adminMapLayer = null;
    }
  },

  renderTabs() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === this.currentTab);
    });
    document.querySelectorAll('.admin-tab-content').forEach(content => {
      content.classList.toggle('hidden', content.dataset.tab !== this.currentTab);
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    this.renderTabs();
    if (tab === 'mapa') this.renderMapTab();
    if (tab === 'tabla') this.renderTableTab();
  },

  // ============================================
  // CARGAR DATOS DESDE SUPABASE
  // ============================================
  async loadMarkers() {
    showToast('Cargando datos del admin...', 'info');
    try {
      const results = await Promise.allSettled([
        this.fetchTable('qc_markers'),
        this.fetchTable('lsm_markers')
      ]);

      const qc = results[0].status === 'fulfilled' ? results[0].value : [];
      const lsm = results[1].status === 'fulfilled' ? results[1].value : [];

      if (results[0].status === 'rejected') {
        console.error('[Admin] Error loading qc_markers:', results[0].reason);
        showToast('Error cargando QC: ' + results[0].reason.message, 'error');
      }
      if (results[1].status === 'rejected') {
        console.error('[Admin] Error loading lsm_markers:', results[1].reason);
        showToast('Error cargando LSM: ' + results[1].reason.message, 'error');
      }

      this.allMarkers = [
        ...(Array.isArray(qc) ? qc.map(m => ({ ...m, _type: 'qc' })) : []),
        ...(Array.isArray(lsm) ? lsm.map(m => ({ ...m, _type: 'lsm' })) : [])
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const activeCount = this.allMarkers.filter(m => !m.is_deleted).length;
      const deletedCount = this.allMarkers.filter(m => m.is_deleted).length;
      const qcCount = Array.isArray(qc) ? qc.length : 0;
      const lsmCount = Array.isArray(lsm) ? lsm.length : 0;

      showToast(
        `${this.allMarkers.length} registros cargados (${qcCount} QC + ${lsmCount} LSM, ${activeCount} activos${deletedCount > 0 ? ', ' + deletedCount + ' eliminados' : ''})`,
        'success'
      );
    } catch (e) {
      console.error('[Admin] Error loading markers:', e);
      showToast('Error al cargar datos del admin', 'error');
    }
  },

  async fetchTable(table) {
    const res = await fetch(`${SUPABASE_ADMIN_URL}/${table}?select=*&order=created_at.desc`, {
      cache: 'no-store',
      headers: {
        'apikey': SUPABASE_ADMIN_KEY,
        'Authorization': `Bearer ${SUPABASE_ADMIN_KEY}`
      }
    });
    if (!res.ok) {
      console.error(`[Admin] fetchTable ${table} failed: HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status} en ${table}`);
    }
    return res.json();
  },

  // ============================================
  // MAPA SELECTOR (Mapas locales del dispositivo)
  // ============================================
  async renderMapSelector() {
    const select = document.getElementById('admin-map-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Seleccionar mapa --</option>';

    try {
      const maps = await MapStorage.getAllMaps();
      maps.forEach(map => {
        const opt = document.createElement('option');
        opt.value = map.id;
        opt.textContent = map.name + ' (' + (map.type || 'tiff').toUpperCase() + ')';
        select.appendChild(opt);
      });
    } catch (e) {
      console.error('[Admin] Error loading map list:', e);
    }
  },

  async loadAdminMap(mapId) {
    if (!mapId) return;
    this.adminSelectedMapId = mapId;

    // Limpiar mapa anterior
    this.clearAdminMapOverlay();

    try {
      const record = await MapStorage.getMapRecord(mapId);
      if (!record) { showToast('Mapa no encontrado', 'error'); return; }

      if (record.type === 'pdf') {
        await this.loadAdminPDF(record);
      } else {
        await this.loadAdminTiff(record.data || await MapStorage.getMapData(mapId));
      }

      // Redibujar puntos sobre el mapa cargado
      this.renderAdminMarkers();
      showToast('Mapa cargado: ' + record.name, 'success');
    } catch (e) {
      console.error('[Admin] Error loading map:', e);
      showToast('Error al cargar mapa', 'error');
    }
  },

  async loadAdminTiff(arrayBuffer) {
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const raster = await image.readRasters();
    const bbox = image.getBoundingBox();
    const geoRaster = new GeoRaster({
      values: raster.length >= 3 ? [raster[0], raster[1], raster[2]] : [raster[0]],
      width: image.getWidth(), height: image.getHeight(),
      numberOfBands: raster.length >= 3 ? 3 : 1,
      pixelWidth: (bbox[2] - bbox[0]) / image.getWidth(),
      pixelHeight: (bbox[3] - bbox[1]) / image.getHeight(),
      xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3]
    });
    this.adminMapOverlay = new GeoRasterLayer({ georaster: geoRaster, opacity: 0.85, resolution: 256 });
    this.adminMapOverlay.addTo(this.adminMap);
    this.adminMap.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);
  },

  async loadAdminPDF(record) {
    if (!record.georef || !record.georef.corners) {
      showToast('PDF sin georreferenciacion', 'error'); return;
    }
    const pdf = await PDFProcessor.loadPDF(record.data);
    const { canvas } = await PDFProcessor.renderPage(pdf, 2);
    this.adminMapOverlay = PDFProcessor.createGeoOverlay(canvas, record.georef.corners, record.georef.crs);
    this.adminMapOverlay.addTo(this.adminMap);
    this.adminMap.fitBounds(this.adminMapOverlay.getBounds());
  },

  clearAdminMapOverlay() {
    if (this.adminMapOverlay) {
      this.adminMap.removeLayer(this.adminMapOverlay);
      this.adminMapOverlay = null;
    }
    if (this.adminMapLayer) {
      this.adminMap.removeLayer(this.adminMapLayer);
      this.adminMapLayer = null;
    }
  },

  renderAdminMarkers() {
    if (!this.adminMap) return;

    // Limpiar capa de marcadores anterior
    if (this.adminMapLayer) {
      this.adminMap.removeLayer(this.adminMapLayer);
    }
    this.adminMapLayer = L.layerGroup().addTo(this.adminMap);

    const activeMarkers = this.allMarkers.filter(m => !m.is_deleted);
    const bounds = [];

    activeMarkers.forEach(m => {
      const lat = parseFloat(m.lat);
      const lng = parseFloat(m.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      bounds.push([lat, lng]);

      const color = m._type === 'lsm' ? '#58a6ff' : '#3fb950';
      const label = m._type === 'lsm' ? 'LSM' : 'QC';

      const circle = L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(this.adminMapLayer);

      const popupContent = `
        <strong>${escapeHtml(m.name || m.nombre_muestra || 'Sin nombre')}</strong><br>
        <small>Tipo: ${label}</small><br>
        <small>Usuario: ${escapeHtml(m.user_name || '')}</small><br>
        <small>Dispositivo: ${escapeHtml(m.device_id || '').substring(0, 12)}...</small><br>
        <small>N: ${m.norte || '-'} | E: ${m.este || '-'}</small>
      `;
      circle.bindPopup(popupContent);
    });

    // Solo hacer fitBounds si NO hay un mapa cargado (el mapa ya hizo su propio fit)
    if (bounds.length > 0 && !this.adminMapOverlay) {
      this.adminMap.fitBounds(bounds, { padding: [30, 30] });
    }

    document.getElementById('admin-map-count').textContent = `${activeMarkers.length} puntos activos${this.adminMapOverlay ? ' | Mapa cargado' : ''}`;
  },

  // ============================================
  // TAB: MAPA
  // ============================================
  renderMapTab() {
    const container = document.getElementById('admin-map-container');
    if (!container) return;

    if (!this.adminMap) {
      this.adminMap = L.map(container).setView([-1.8, -78.5], 7);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(this.adminMap);
    }

    // Renderizar selector de mapas
    this.renderMapSelector();

    // Si hay un mapa seleccionado previamente, recargarlo
    if (this.adminSelectedMapId) {
      this.loadAdminMap(this.adminSelectedMapId);
    } else {
      // Sin mapa: mostrar puntos sobre mapa base
      this.renderAdminMarkers();
    }
  },

  // ============================================
  // TAB: TABLA
  // ============================================
  renderTableTab() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    const filterType = document.getElementById('admin-filter-type').value;
    const filterUser = (document.getElementById('admin-filter-user').value || '').toLowerCase();
    const filterDeleted = document.getElementById('admin-filter-deleted').checked;

    let filtered = this.allMarkers;
    if (filterType !== 'all') filtered = filtered.filter(m => m._type === filterType);
    if (filterUser) filtered = filtered.filter(m => (m.user_name || '').toLowerCase().includes(filterUser));
    if (!filterDeleted) filtered = filtered.filter(m => !m.is_deleted);

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No hay registros</td></tr>';
      return;
    }

    filtered.forEach(m => {
      const tr = document.createElement('tr');
      tr.className = m.is_deleted ? 'admin-row-deleted' : '';
      tr.innerHTML = `
        <td><span class="admin-badge ${m._type}">${m._type.toUpperCase()}</span></td>
        <td>${escapeHtml(m.name || m.nombre_muestra || '-')}</td>
        <td>${escapeHtml(m.user_name || '-')}</td>
        <td>${formatDate(m.created_at)}</td>
        <td>${m.is_deleted ? '<span class="status-deleted">ELIMINADO</span>' : '<span class="status-active">ACTIVO</span>'}</td>
        <td>${(m.norte || '-')} / ${(m.este || '-')}</td>
      `;
      tr.addEventListener('click', () => this.selectMarker(m));
      tbody.appendChild(tr);
    });
  },

  selectMarker(marker) {
    this.selectedMarker = marker;
    const panel = document.getElementById('admin-detail-panel');
    const isLSM = marker._type === 'lsm';

    let fieldsHtml = '';

    // Campos comunes
    fieldsHtml += this.detailField('ID', marker.local_marker_id);
    fieldsHtml += this.detailField('Tipo', marker._type.toUpperCase());
    fieldsHtml += this.detailField('Usuario', marker.user_name);
    fieldsHtml += this.detailField('Dispositivo', marker.device_id);
    fieldsHtml += this.detailField('Nombre', marker.name || marker.nombre_muestra);
    fieldsHtml += this.detailField('Norte', marker.norte);
    fieldsHtml += this.detailField('Este', marker.este);
    fieldsHtml += this.detailField('Latitud', marker.lat);
    fieldsHtml += this.detailField('Longitud', marker.lng);
    fieldsHtml += this.detailField('Color', marker.color);
    fieldsHtml += this.detailField('Fotos', (marker.photo_ids || []).join(', ') || 'Ninguna');
    fieldsHtml += this.detailField('Creado', formatDateTime(marker.created_at));

    if (isLSM) {
      fieldsHtml += this.detailField('Tipo Muestra', marker.tipo_muestra);
      fieldsHtml += this.detailField('Proyecto', marker.nombre_proyecto);
      fieldsHtml += this.detailField('Solicitante', marker.solicitante);
      fieldsHtml += this.detailField('Estructura', marker.estructura_deposito);
      fieldsHtml += this.detailField('Subestructuras', marker.subestructuras);
      fieldsHtml += this.detailField('Categoria', marker.categoria);
      fieldsHtml += this.detailField('Tipo Material', marker.tipo_material);
      fieldsHtml += this.detailField('Proveniencia', marker.proveniencia);
      fieldsHtml += this.detailField('Localizacion', marker.localizacion);
      fieldsHtml += this.detailField('Fuente', marker.fuente);
      fieldsHtml += this.detailField('Ensayos', (marker.ensayos || []).join(', '));
    } else {
      fieldsHtml += this.detailField('Descripcion', marker.description);
    }

    if (marker.is_deleted) {
      fieldsHtml += `<div class="detail-row" style="color:#f85149;margin-top:12px;"><strong>Eliminado por:</strong> ${escapeHtml(marker.deleted_by || 'admin')} el ${formatDateTime(marker.deleted_at)}</div>`;
    }

    panel.innerHTML = `
      <div class="admin-detail-header">
        <h4>Detalle</h4>
        <button id="admin-btn-close-detail" class="icon-btn">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="admin-detail-body">${fieldsHtml}</div>
      ${!marker.is_deleted ? `
      <div class="admin-detail-actions">
        <button id="admin-btn-edit" class="btn-secondary btn-sm">Editar</button>
        <button id="admin-btn-delete" class="btn-danger btn-sm">Eliminar</button>
      </div>
      ` : ''}
    `;

    document.getElementById('admin-btn-close-detail').addEventListener('click', () => {
      panel.innerHTML = '<p class="empty-msg">Selecciona un registro para ver detalles</p>';
      this.selectedMarker = null;
    });

    if (!marker.is_deleted) {
      document.getElementById('admin-btn-edit').addEventListener('click', () => this.startEdit(marker));
      document.getElementById('admin-btn-delete').addEventListener('click', () => this.confirmDelete(marker));
    }
  },

  detailField(label, value) {
    const v = value !== undefined && value !== null && value !== '' ? String(value) : '-';
    return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${escapeHtml(v)}</span></div>`;
  },

  // ============================================
  // EDITAR
  // ============================================
  startEdit(marker) {
    const panel = document.getElementById('admin-detail-panel');
    const isLSM = marker._type === 'lsm';

    let inputsHtml = '';
    inputsHtml += this.editInput('name', 'Nombre', marker.name || marker.nombre_muestra || '');
    if (isLSM) {
      inputsHtml += this.editInput('tipo_muestra', 'Tipo Muestra', marker.tipo_muestra || '');
      inputsHtml += this.editInput('nombre_proyecto', 'Proyecto', marker.nombre_proyecto || '');
      inputsHtml += this.editInput('solicitante', 'Solicitante', marker.solicitante || '');
      inputsHtml += this.editInput('estructura_deposito', 'Estructura', marker.estructura_deposito || '');
      inputsHtml += this.editInput('subestructuras', 'Subestructuras', marker.subestructuras || '');
      inputsHtml += this.editInput('categoria', 'Categoria', marker.categoria || '');
      inputsHtml += this.editInput('tipo_material', 'Tipo Material', marker.tipo_material || '');
      inputsHtml += this.editInput('proveniencia', 'Proveniencia', marker.proveniencia || '');
      inputsHtml += this.editInput('localizacion', 'Localizacion', marker.localizacion || '');
      inputsHtml += this.editInput('fuente', 'Fuente', marker.fuente || '');
      inputsHtml += this.editInput('ensayos', 'Ensayos (separados por coma)', (marker.ensayos || []).join(', '));
    } else {
      inputsHtml += this.editInput('description', 'Descripcion', marker.description || '');
    }

    panel.innerHTML = `
      <div class="admin-detail-header"><h4>Editar Registro</h4></div>
      <div class="admin-detail-body">${inputsHtml}</div>
      <div class="admin-detail-actions">
        <button id="admin-btn-cancel-edit" class="btn-secondary btn-sm">Cancelar</button>
        <button id="admin-btn-save-edit" class="btn-primary btn-sm">Guardar</button>
      </div>
    `;

    document.getElementById('admin-btn-cancel-edit').addEventListener('click', () => this.selectMarker(marker));
    document.getElementById('admin-btn-save-edit').addEventListener('click', () => this.saveEdit(marker));
  },

  editInput(key, label, value) {
    return `
      <div class="form-group">
        <label>${label}</label>
        <input type="text" id="admin-edit-${key}" value="${escapeHtml(value)}" data-key="${key}">
      </div>
    `;
  },

  async saveEdit(marker) {
    const isLSM = marker._type === 'lsm';
    const table = isLSM ? 'lsm_markers' : 'qc_markers';
    const updates = {};

    const getVal = (key) => document.getElementById(`admin-edit-${key}`)?.value.trim();

    if (isLSM) {
      updates.nombre_muestra = getVal('name');
      updates.tipo_muestra = getVal('tipo_muestra');
      updates.nombre_proyecto = getVal('nombre_proyecto');
      updates.solicitante = getVal('solicitante');
      updates.estructura_deposito = getVal('estructura_deposito');
      updates.subestructuras = getVal('subestructuras');
      updates.categoria = getVal('categoria');
      updates.tipo_material = getVal('tipo_material');
      updates.proveniencia = getVal('proveniencia');
      updates.localizacion = getVal('localizacion');
      updates.fuente = getVal('fuente');
      const ensStr = getVal('ensayos');
      updates.ensayos = ensStr ? ensStr.split(',').map(s => s.trim()).filter(Boolean) : [];
    } else {
      updates.name = getVal('name');
      updates.description = getVal('description');
    }

    try {
      const res = await fetch(
        `${SUPABASE_ADMIN_URL}/${table}?id=eq.${marker.id}`,
        {
          method: 'PATCH',
          cache: 'no-store',
          headers: {
            'apikey': SUPABASE_ADMIN_KEY,
            'Authorization': `Bearer ${SUPABASE_ADMIN_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(updates)
        }
      );

      if (res.ok) {
        showToast('Registro actualizado', 'success');
        await this.loadMarkers();
        this.renderTableTab();
        const updated = this.allMarkers.find(m => m.id === marker.id);
        if (updated) this.selectMarker(updated);
      } else {
        showToast('Error al actualizar', 'error');
      }
    } catch (e) {
      console.error('[Admin] Edit error:', e);
      showToast('Error al actualizar', 'error');
    }
  },

  // ============================================
  // ELIMINAR (Soft Delete)
  // ============================================
  confirmDelete(marker) {
    if (!confirm(`Seguro que deseas eliminar "${marker.name || marker.nombre_muestra || 'este registro'}"?`)) return;
    this.deleteMarker(marker);
  },

  async deleteMarker(marker) {
    const table = marker._type === 'lsm' ? 'lsm_markers' : 'qc_markers';
    try {
      const res = await fetch(
        `${SUPABASE_ADMIN_URL}/${table}?id=eq.${marker.id}`,
        {
          method: 'PATCH',
          cache: 'no-store',
          headers: {
            'apikey': SUPABASE_ADMIN_KEY,
            'Authorization': `Bearer ${SUPABASE_ADMIN_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            is_deleted: true,
            deleted_at: new Date().toISOString(),
            deleted_by: 'admin'
          })
        }
      );

      if (res.ok) {
        showToast('Registro eliminado', 'info');
        await this.loadMarkers();
        this.renderTableTab();
        document.getElementById('admin-detail-panel').innerHTML = '<p class="empty-msg">Selecciona un registro para ver detalles</p>';
      } else {
        showToast('Error al eliminar', 'error');
      }
    } catch (e) {
      console.error('[Admin] Delete error:', e);
      showToast('Error al eliminar', 'error');
    }
  },

  // ============================================
  // EXPORTAR EXCEL
  // ============================================
  async exportExcel() {
    if (this.allMarkers.length === 0) {
      showToast('No hay datos para exportar', 'error');
      return;
    }

    const qcData = this.allMarkers.filter(m => m._type === 'qc').map(m => ({
      ID: m.local_marker_id,
      Nombre: m.name || '',
      Descripcion: m.description || '',
      Usuario: m.user_name || '',
      Dispositivo: m.device_id || '',
      Norte: m.norte || '',
      Este: m.este || '',
      Latitud: m.lat,
      Longitud: m.lng,
      Color: m.color || '',
      Fotos: (m.photo_ids || []).join(', '),
      Estado: m.is_deleted ? 'ELIMINADO' : 'ACTIVO',
      Fecha_Creacion: m.created_at,
      Fecha_Eliminacion: m.deleted_at || ''
    }));

    const lsmData = this.allMarkers.filter(m => m._type === 'lsm').map(m => ({
      ID: m.local_marker_id,
      Nombre_Muestra: m.nombre_muestra || '',
      Tipo_Muestra: m.tipo_muestra || '',
      Proyecto: m.nombre_proyecto || '',
      Solicitante: m.solicitante || '',
      Estructura: m.estructura_deposito || '',
      Subestructuras: m.subestructuras || '',
      Categoria: m.categoria || '',
      Tipo_Material: m.tipo_material || '',
      Proveniencia: m.proveniencia || '',
      Localizacion: m.localizacion || '',
      Fuente: m.fuente || '',
      Ensayos: (m.ensayos || []).join(', '),
      Usuario: m.user_name || '',
      Dispositivo: m.device_id || '',
      Norte: m.norte || '',
      Este: m.este || '',
      Latitud: m.lat,
      Longitud: m.lng,
      Color: m.color || '',
      Fotos: (m.photo_ids || []).join(', '),
      Estado: m.is_deleted ? 'ELIMINADO' : 'ACTIVO',
      Fecha_Creacion: m.created_at,
      Fecha_Eliminacion: m.deleted_at || ''
    }));

    const wb = XLSX.utils.book_new();

    if (qcData.length > 0) {
      const wsQC = XLSX.utils.json_to_sheet(qcData);
      XLSX.utils.book_append_sheet(wb, wsQC, 'QC');
    }

    if (lsmData.length > 0) {
      const wsLSM = XLSX.utils.json_to_sheet(lsmData);
      XLSX.utils.book_append_sheet(wb, wsLSM, 'LSM');
    }

    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `MAPS_GIS_Admin_${today}.xlsx`);
    showToast('Excel descargado', 'success');
  },

  // ============================================
  // RESET BASE DE DATOS
  // ============================================
  async resetDatabase() {
    if (!confirm('ATENCION: Esto eliminara TODOS los registros de qc_markers y lsm_markers en Supabase. Esta accion no se puede deshacer. Continuar?')) return;
    if (!confirm('Confirmacion final: Realmente deseas vaciar toda la base de datos?')) return;

    try {
      const [resQC, resLSM] = await Promise.all([
        fetch(`${SUPABASE_ADMIN_URL}/qc_markers?is_deleted=eq.false`, {
          method: 'DELETE',
          cache: 'no-store',
          headers: {
            'apikey': SUPABASE_ADMIN_KEY,
            'Authorization': `Bearer ${SUPABASE_ADMIN_KEY}`
          }
        }),
        fetch(`${SUPABASE_ADMIN_URL}/lsm_markers?is_deleted=eq.false`, {
          method: 'DELETE',
          cache: 'no-store',
          headers: {
            'apikey': SUPABASE_ADMIN_KEY,
            'Authorization': `Bearer ${SUPABASE_ADMIN_KEY}`
          }
        })
      ]);

      if (resQC.ok && resLSM.ok) {
        showToast('Base de datos vaciada correctamente', 'success');
        this.allMarkers = [];
        this.renderMapTab();
        this.renderTableTab();
      } else {
        showToast('Error al vaciar base de datos', 'error');
      }
    } catch (e) {
      console.error('[Admin] Reset error:', e);
      showToast('Error al vaciar base de datos', 'error');
    }
  }
};

// Inicializar event listeners del admin cuando el DOM este listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminListeners);
} else {
  initAdminListeners();
}

function initAdminListeners() {
  const loginBtn = document.getElementById('btn-admin');
  if (loginBtn) loginBtn.addEventListener('click', () => AdminManager.openLogin());

  const confirmLoginBtn = document.getElementById('btn-confirm-admin-login');
  if (confirmLoginBtn) confirmLoginBtn.addEventListener('click', () => AdminManager.confirmLogin());

  const cancelLoginBtn = document.getElementById('btn-cancel-admin-login');
  if (cancelLoginBtn) cancelLoginBtn.addEventListener('click', () => AdminManager.closeLogin());

  const closePanelBtn = document.getElementById('btn-close-admin-panel');
  if (closePanelBtn) closePanelBtn.addEventListener('click', () => AdminManager.closePanel());

  const logoutBtn = document.getElementById('btn-admin-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => AdminManager.logout());

  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => AdminManager.switchTab(btn.dataset.tab));
  });

  const refreshBtn = document.getElementById('btn-admin-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    AdminManager.loadMarkers().then(() => AdminManager.renderTabs());
  });

  const exportBtn = document.getElementById('btn-admin-export');
  if (exportBtn) exportBtn.addEventListener('click', () => AdminManager.exportExcel());

  const resetBtn = document.getElementById('btn-admin-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => AdminManager.resetDatabase());

  const filterType = document.getElementById('admin-filter-type');
  if (filterType) filterType.addEventListener('change', () => AdminManager.renderTableTab());

  const filterUser = document.getElementById('admin-filter-user');
  if (filterUser) filterUser.addEventListener('input', () => AdminManager.renderTableTab());

  const filterDeleted = document.getElementById('admin-filter-deleted');
  if (filterDeleted) filterDeleted.addEventListener('change', () => AdminManager.renderTableTab());

  const loadMapBtn = document.getElementById('btn-admin-load-map');
  const mapSelect = document.getElementById('admin-map-select');
  if (loadMapBtn && mapSelect) {
    loadMapBtn.addEventListener('click', () => {
      const mapId = mapSelect.value;
      if (mapId) AdminManager.loadAdminMap(mapId);
      else showToast('Selecciona un mapa', 'error');
    });
  }
}
