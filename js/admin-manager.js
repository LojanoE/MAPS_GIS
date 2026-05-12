/**
 * admin-manager.js - MAPS GIS Admin Panel v2.1
 * Panel de administracion remoto via Supabase.
 * Solo online. No afecta datos locales del dispositivo.
 */

const ADMIN_PASS = 'LSMQC$';
const SUPABASE_ADMIN_URL = 'https://dzmhhlsttqygjvfabdxx.supabase.co/rest/v1';
const SUPABASE_ADMIN_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6bWhobHN0dHF5Z2p2ZmFiZHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTE3MDAsImV4cCI6MjA5MDcyNzcwMH0._Gf0G2gpV_9QAYqFx1Kn6TN0lFDq3LxmBdNI82Suj-o';

const AdminManager = {
  isLoggedIn: false,
  allMarkers: [],
  filteredMarkers: [],
  selectedIds: new Set(),
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
    this.filteredMarkers = [];
    this.selectedIds.clear();
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

      this.populateUserFilter();
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

  populateUserFilter() {
    const select = document.getElementById('admin-filter-user');
    if (!select) return;
    const currentVal = select.value;
    const users = [...new Set(this.allMarkers.map(m => m.user_name).filter(Boolean))].sort();
    select.innerHTML = '<option value="">Todos los usuarios</option>';
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      select.appendChild(opt);
    });
    if (users.includes(currentVal)) select.value = currentVal;
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

    this.clearAdminMapOverlay();

    try {
      const record = await MapStorage.getMapRecord(mapId);
      if (!record) { showToast('Mapa no encontrado', 'error'); return; }

      if (record.type === 'pdf') {
        await this.loadAdminPDF(record);
      } else {
        await this.loadAdminTiff(record.data || await MapStorage.getMapData(mapId));
      }

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
    const width = image.getWidth();
    const height = image.getHeight();
    const values = raster.length >= 3 ? [raster[0], raster[1], raster[2]] : [raster[0]];
    const crs = this.getGeoTiffCRS(image);
    const isGeographic = crs === 'EPSG:4326';
    const needsProjTransform = crs && crs !== 'EPSG:4326' && crs !== 'EPSG:3857';

    if (needsProjTransform || !crs) {
      const srcCRS = crs || 'EPSG:24877';
      const transformToWGS84 = (e, n) => {
        try { const [lng, lat] = proj4(srcCRS, 'EPSG:4326', [e, n]); return [lat, lng]; }
        catch (err) { return [n, e]; }
      };
      const tl = transformToWGS84(bbox[0], bbox[3]);
      const tr = transformToWGS84(bbox[2], bbox[3]);
      const bl = transformToWGS84(bbox[0], bbox[1]);
      const br = transformToWGS84(bbox[2], bbox[1]);
      const bounds = [
        [Math.min(tl[0], tr[0], bl[0], br[0]), Math.min(tl[1], tr[1], bl[1], br[1])],
        [Math.max(tl[0], tr[0], bl[0], br[0]), Math.max(tl[1], tr[1], bl[1], br[1])]
      ];
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);
      if (values.length >= 3) {
        for (let i = 0; i < width * height; i++) {
          imageData.data[i*4] = Math.min(255, Math.max(0, values[0][i]));
          imageData.data[i*4+1] = Math.min(255, Math.max(0, values[1][i]));
          imageData.data[i*4+2] = Math.min(255, Math.max(0, values[2][i]));
          imageData.data[i*4+3] = (values[0][i]===0&&values[1][i]===0&&values[2][i]===0)?0:255;
        }
      } else {
        for (let i = 0; i < width * height; i++) {
          const v = Math.min(255, Math.max(0, values[0][i]));
          imageData.data[i*4]=v; imageData.data[i*4+1]=v; imageData.data[i*4+2]=v; imageData.data[i*4+3]=v===0?0:255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      this.adminMapOverlay = L.imageOverlay(canvas.toDataURL('image/png'), bounds, { opacity: 0.85, interactive: true });
      this.adminMapOverlay.addTo(this.adminMap);
      this.adminMap.fitBounds(bounds);
    } else {
      const geoRaster = new GeoRaster({
        values: values, width: width, height: height, numberOfBands: values.length,
        pixelWidth: (bbox[2] - bbox[0]) / width, pixelHeight: (bbox[3] - bbox[1]) / height,
        xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3]
      });
      this.adminMapOverlay = new GeoRasterLayer({ georaster: geoRaster, opacity: 0.85, resolution: 256 });
      this.adminMapOverlay.addTo(this.adminMap);
      this.adminMap.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);
    }
  },

  getGeoTiffCRS(image) {
    try {
      if (typeof image.geoKeys !== 'undefined') {
        const geoKeys = image.geoKeys;
        if (geoKeys.ProjectedCSTypeGeoKey) return 'EPSG:' + geoKeys.ProjectedCSTypeGeoKey;
        if (geoKeys.GeographicTypeGeoKey) return 'EPSG:' + geoKeys.GeographicTypeGeoKey;
      }
    } catch (e) {}
    try {
      const fileDirectory = image.getFileDirectory();
      if (fileDirectory && fileDirectory.GeoKeyDirectory) {
        const geoKeyDir = fileDirectory.GeoKeyDirectory;
        if (geoKeyDir && geoKeyDir.length >= 4) {
          for (let i = 0; i < geoKeyDir.length; i += 4) {
            const keyId = geoKeyDir[i];
            if (keyId === 3072 && geoKeyDir[i + 3] > 0) return 'EPSG:' + geoKeyDir[i + 3];
            if (keyId === 2048 && geoKeyDir[i + 3] > 0) return 'EPSG:' + geoKeyDir[i + 3];
          }
        }
      }
    } catch (e) {}
    return null;
  },

  async loadAdminPDF(record) {
    if (!record.georef || !record.georef.corners) {
      showToast('PDF sin georreferenciacion', 'error'); return;
    }
    const pdf = await PDFProcessor.loadPDF(record.data);
    const { canvas } = await PDFProcessor.renderPage(pdf, 2);
    const offset = this.getMapOffset(record.id);
    this.adminMapOverlay = PDFProcessor.createGeoOverlay(canvas, record.georef.corners, record.georef.crs, offset);
    this.adminMapOverlay.addTo(this.adminMap);
    this.adminMap.fitBounds(this.adminMapOverlay.getBounds());
  },

  getMapOffsetKey(mapId) { return 'maps_gis_offset_' + mapId; },
  getMapOffset(mapId) {
    try { return JSON.parse(localStorage.getItem(this.getMapOffsetKey(mapId))) || { east: 0, north: 0 }; }
    catch { return { east: 0, north: 0 }; }
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

    this.renderMapSelector();

    if (this.adminSelectedMapId) {
      this.loadAdminMap(this.adminSelectedMapId);
    } else {
      this.renderAdminMarkers();
    }
  },

  // ============================================
  // TAB: TABLA (con filtros, seleccion, exportacion)
  // ============================================
  renderTableTab() {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    const filterType = document.getElementById('admin-filter-type').value;
    const filterUser = document.getElementById('admin-filter-user').value;
    const filterDateFrom = document.getElementById('admin-filter-date-from').value;
    const filterDateTo = document.getElementById('admin-filter-date-to').value;
    const filterDeleted = document.getElementById('admin-filter-deleted').checked;

    let filtered = this.allMarkers;
    if (filterType !== 'all') filtered = filtered.filter(m => m._type === filterType);
    if (filterUser) filtered = filtered.filter(m => m.user_name === filterUser);
    if (filterDateFrom) {
      const from = new Date(filterDateFrom + 'T00:00:00');
      filtered = filtered.filter(m => new Date(m.created_at) >= from);
    }
    if (filterDateTo) {
      const to = new Date(filterDateTo + 'T23:59:59');
      filtered = filtered.filter(m => new Date(m.created_at) <= to);
    }
    if (!filterDeleted) filtered = filtered.filter(m => !m.is_deleted);

    this.filteredMarkers = filtered;

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No hay registros</td></tr>';
      this.updateSelectAllState();
      this.updateMassActionsBar();
      return;
    }

    filtered.forEach(m => {
      const tr = document.createElement('tr');
      tr.className = m.is_deleted ? 'admin-row-deleted' : '';
      const checked = this.selectedIds.has(m.id) ? 'checked' : '';
      tr.innerHTML = `
        <td style="text-align:center;"><input type="checkbox" class="admin-row-checkbox" data-id="${m.id}" ${checked}></td>
        <td><span class="admin-badge ${m._type}">${m._type.toUpperCase()}</span></td>
        <td>${escapeHtml(m.name || m.nombre_muestra || '-')}</td>
        <td>${escapeHtml(m.user_name || '-')}</td>
        <td>${formatDate(m.created_at)}</td>
        <td>${m.is_deleted ? '<span class="status-deleted">ELIMINADO</span>' : '<span class="status-active">ACTIVO</span>'}</td>
        <td>${(m.norte || '-')} / ${(m.este || '-')}</td>
      `;
      const checkbox = tr.querySelector('.admin-row-checkbox');
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        this.toggleSelectOne(m.id, e.target.checked);
      });
      tr.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        this.selectMarker(m);
      });
      tbody.appendChild(tr);
    });

    this.updateSelectAllState();
    this.updateMassActionsBar();
  },

  toggleSelectOne(id, checked) {
    if (checked) {
      this.selectedIds.add(id);
    } else {
      this.selectedIds.delete(id);
    }
    this.updateSelectAllState();
    this.updateMassActionsBar();
  },

  toggleSelectAll(checked) {
    if (checked) {
      this.filteredMarkers.forEach(m => this.selectedIds.add(m.id));
    } else {
      this.filteredMarkers.forEach(m => this.selectedIds.delete(m.id));
    }
    document.querySelectorAll('.admin-row-checkbox').forEach(cb => {
      cb.checked = checked;
    });
    this.updateMassActionsBar();
  },

  updateSelectAllState() {
    const selectAllCb = document.getElementById('admin-select-all');
    if (!selectAllCb) return;
    if (this.filteredMarkers.length === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      return;
    }
    const allChecked = this.filteredMarkers.every(m => this.selectedIds.has(m.id));
    const someChecked = this.filteredMarkers.some(m => this.selectedIds.has(m.id));
    selectAllCb.checked = allChecked;
    selectAllCb.indeterminate = !allChecked && someChecked;
  },

  updateMassActionsBar() {
    const bar = document.getElementById('admin-mass-actions');
    const countSpan = document.getElementById('admin-selected-count');
    if (!bar || !countSpan) return;
    const count = this.selectedIds.size;
    if (count > 0) {
      bar.classList.remove('hidden');
      countSpan.textContent = count + ' seleccionado' + (count !== 1 ? 's' : '');
    } else {
      bar.classList.add('hidden');
    }
  },

  // ============================================
  // EXPORTAR SELECCIONADOS
  // ============================================
  async exportSelectedExcel() {
    if (this.selectedIds.size === 0) {
      showToast('Selecciona al menos un registro', 'error');
      return;
    }

    const selected = this.allMarkers.filter(m => this.selectedIds.has(m.id));
    await this._doExportExcel(selected, 'Seleccionados');
  },

  async exportExcel() {
    if (this.allMarkers.length === 0) {
      showToast('No hay datos para exportar', 'error');
      return;
    }
    await this._doExportExcel(this.allMarkers, 'Admin');
  },

  async _doExportExcel(markers, label) {
    const qcData = markers.filter(m => m._type === 'qc').map(m => ({
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
      Fecha_Creacion: m.created_at ? new Date(m.created_at) : null,
      Fecha_Eliminacion: m.deleted_at ? new Date(m.deleted_at) : null
    }));

    const lsmData = markers.filter(m => m._type === 'lsm').map(m => ({
      ID: m.local_marker_id,
      Nombre_Muestra: m.nombre_muestra || '',
      Proyecto: m.nombre_proyecto || '',
      Solicitante: m.solicitante || '',
      Estructura: m.estructura_deposito || '',
      Subestructuras: m.subestructuras || '',
      Categoria: m.categoria || '',
      Semana_Laboratorio: m.semana_laboratorio || '',
      Tipo_Material: m.tipo_material || '',
      Proveniencia: m.proveniencia || '',
      Localizacion: m.localizacion || '',
      Fuente: m.fuente || '',
      Ensayos: (m.ensayos || []).join(', '),
      Norte: m.norte || '',
      Este: m.este || '',
      Latitud: m.lat,
      Longitud: m.lng,
      Usuario: m.user_name || '',
      Dispositivo: m.device_id || '',
      Color: m.color || '',
      Fotos: (m.photo_ids || []).join(', '),
      Estado: m.is_deleted ? 'ELIMINADO' : 'ACTIVO',
      Fecha_Creacion: m.created_at ? new Date(m.created_at) : null,
      Fecha_Eliminacion: m.deleted_at ? new Date(m.deleted_at) : null
    }));

    const wb = XLSX.utils.book_new();
    const dateCols = ['Fecha_Creacion', 'Fecha_Eliminacion'];

    if (qcData.length > 0) {
      const wsQC = XLSX.utils.json_to_sheet(qcData, { cellDates: true });
      qcData.forEach((_, i) => {
        dateCols.forEach(col => {
          const addr = XLSX.utils.encode_col(Object.keys(qcData[0]).indexOf(col)) + (i + 2);
          if (wsQC[addr] && wsQC[addr].v instanceof Date) {
            wsQC[addr].z = 'DD/MM/YYYY';
            wsQC[addr].t = 'd';
          }
        });
      });
      const qcWidths = Object.keys(qcData[0]).map(k => ({ wch: Math.max(k.length, 12) }));
      wsQC['!cols'] = qcWidths;
      XLSX.utils.book_append_sheet(wb, wsQC, 'QC');
    }

    if (lsmData.length > 0) {
      const wsLSM = XLSX.utils.json_to_sheet(lsmData, { cellDates: true });
      lsmData.forEach((_, i) => {
        dateCols.forEach(col => {
          const addr = XLSX.utils.encode_col(Object.keys(lsmData[0]).indexOf(col)) + (i + 2);
          if (wsLSM[addr] && wsLSM[addr].v instanceof Date) {
            wsLSM[addr].z = 'DD/MM/YYYY';
            wsLSM[addr].t = 'd';
          }
        });
      });
      XLSX.utils.book_append_sheet(wb, wsLSM, 'LSM');
    }

    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `MAPS_GIS_${label}_${today}.xlsx`);
    showToast(`Excel (${markers.length} registros) descargado`, 'success');
  },

  selectMarker(marker) {
    this.selectedMarker = marker;
    const panel = document.getElementById('admin-detail-panel');
    const isLSM = marker._type === 'lsm';

    let fieldsHtml = '';

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
        this.selectedIds.clear();
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

  const exportSelectedBtn = document.getElementById('btn-admin-export-selected');
  if (exportSelectedBtn) exportSelectedBtn.addEventListener('click', () => AdminManager.exportSelectedExcel());

  const resetBtn = document.getElementById('btn-admin-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => AdminManager.resetDatabase());

  const filterType = document.getElementById('admin-filter-type');
  if (filterType) filterType.addEventListener('change', () => AdminManager.renderTableTab());

  const filterUser = document.getElementById('admin-filter-user');
  if (filterUser) filterUser.addEventListener('change', () => AdminManager.renderTableTab());

  const filterDateFrom = document.getElementById('admin-filter-date-from');
  if (filterDateFrom) filterDateFrom.addEventListener('change', () => AdminManager.renderTableTab());

  const filterDateTo = document.getElementById('admin-filter-date-to');
  if (filterDateTo) filterDateTo.addEventListener('change', () => AdminManager.renderTableTab());

  const filterDeleted = document.getElementById('admin-filter-deleted');
  if (filterDeleted) filterDeleted.addEventListener('change', () => AdminManager.renderTableTab());

  const selectAllCb = document.getElementById('admin-select-all');
  if (selectAllCb) selectAllCb.addEventListener('change', (e) => {
    AdminManager.toggleSelectAll(e.target.checked);
  });

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