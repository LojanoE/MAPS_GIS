/* ============================================
   SlopeMeter — Medidor de pendiente con cámara (v2.12.0)
   Clinómetro con cámara en vivo + sensores de orientación.
   Modos: 'aim' (apuntar a una marca) y 'flat' (teléfono apoyado en la superficie).
   Se carga al final (después de admin-manager.js) y usa globals de app.js:
   AppState, showToast, injectGpsExif, dataURLtoBlob, blobToDataURL,
   openMarkerModal, renderPhotoGrid, getLocalDateString, proj4, WGS84,
   stopMeasurement, exitMarkerPlacement, closeMarkerPlacementModal.
   ============================================ */
const SlopeMeter = (function () {
  'use strict';

  const OFFSET_KEY = 'maps_gis_slope_offset';
  const HEIGHT_KEY = 'maps_gis_slope_height';
  const MIN_BASE_DEG = 1;         // elevación mínima (hacia abajo) para medir distancia al suelo
  const SMOOTH = 0.15;            // factor del filtro exponencial sobre el vector "arriba"
  const HISTORY_LEN = 30;         // lecturas para medir estabilidad
  const STABLE_DEG = 0.3;         // variación máxima para considerarla estable
  const LOCK_FRAMES = 60;         // ~1 s estable para bloquear
  const VFOV_DEG = 60;            // campo de visión vertical aproximado de la cámara

  const S = {
    open: false,
    mode: 'aim',
    stream: null,
    hasVideo: false,
    raf: 0,
    up: null,            // vector arriba suavizado {x,y,z}
    hasSensor: false,
    frozen: false,       // lectura fijada por el usuario o por estabilidad
    frozenVals: null,
    history: [],
    stableFrames: 0,
    shown: 0,            // valor mostrado (tween)
    offsets: { aim: 0, flat: 0 },
    reduced: false,
    lastAngles: null,
    height: 1.5,         // altura del celular sobre el suelo (m) para el modo Medir
    meas: { step: 0, baseDeg: null, dist: null, topDeg: null, alt: null },
    el: {}
  };

  function loadOffsets() {
    try {
      const o = JSON.parse(localStorage.getItem(OFFSET_KEY));
      if (o && typeof o === 'object') {
        S.offsets.aim = Number(o.aim) || 0;
        S.offsets.flat = Number(o.flat) || 0;
      }
    } catch (e) { /* sin offsets guardados */ }
  }
  function loadHeight() {
    try {
      const h = parseFloat(localStorage.getItem(HEIGHT_KEY));
      if (isFinite(h) && h >= 0.3 && h <= 3) S.height = h;
    } catch (e) { /* default */ }
    if (S.el.height) S.el.height.value = S.height;
  }
  function onHeightInput() {
    const h = parseFloat(S.el.height.value);
    if (!isFinite(h) || h < 0.3 || h > 3) return;
    S.height = h;
    try { localStorage.setItem(HEIGHT_KEY, String(h)); } catch (e) { /* ignorar */ }
    resetMeasure();
  }
  function resetMeasure() {
    S.meas = { step: 0, baseDeg: null, dist: null, topDeg: null, alt: null };
    updateButtons();
  }
  // Marca el siguiente punto: 0 → base (suelo), 1 → punta (altura del objeto), 2 → reiniciar
  function markPoint() {
    if (!S.lastAngles) return;
    const m = S.meas;
    const e = S.lastAngles.signed;
    if (m.step === 0) {
      if (e > -MIN_BASE_DEG) {
        showToast('Apunta al suelo (al menos ' + MIN_BASE_DEG + '° hacia abajo)', 'error');
        return;
      }
      m.baseDeg = e;
      m.dist = S.height / Math.tan(rad(-e));
      m.step = 1;
      if (navigator.vibrate) navigator.vibrate(20);
    } else if (m.step === 1) {
      m.topDeg = e;
      m.alt = S.height + m.dist * Math.tan(rad(e));
      m.step = 2;
      if (navigator.vibrate) navigator.vibrate(30);
    } else {
      resetMeasure();
      return;
    }
    updateButtons();
  }
  function saveOffsets() {
    try { localStorage.setItem(OFFSET_KEY, JSON.stringify(S.offsets)); } catch (e) { /* ignorar */ }
  }

  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;

  // ---- Matemática (único lugar con signos; validar en dispositivo real) ----
  function upFromOrientation(beta, gamma) {
    const b = rad(beta), g = rad(gamma);
    const dx = -Math.cos(b) * Math.sin(g), dy = Math.sin(b), dz = Math.cos(b) * Math.cos(g);
    // Compensa la rotación de pantalla (Android: screen.orientation; iOS: window.orientation)
    const a = rad(getScreenAngle());
    const c = Math.cos(a), s = Math.sin(a);
    return { x: dx * c - dy * s, y: dx * s + dy * c, z: dz };
  }

  function getScreenAngle() {
    let a = 0;
    if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    else if (typeof window.orientation === 'number') a = window.orientation;
    return ((a % 360) + 360) % 360;
  }

  function computeAngles(up, mode) {
    const clamp = v => Math.max(-1, Math.min(1, v));
    if (mode === 'aim' || mode === 'measure') {
      const elevRaw = deg(Math.asin(clamp(-up.z)));       // 0° vertical; + hacia arriba
      const roll = Math.atan2(up.x, up.y);                // rad, giro lateral
      const elev = elevRaw - S.offsets.aim;
      return { deg: elev, signed: elev, roll, ux: up.x, uy: up.y };
    }
    const inclRaw = deg(Math.acos(clamp(Math.abs(up.z))));
    const incl = Math.max(0, inclRaw - S.offsets.flat);
    return { deg: incl, signed: incl, roll: 0, ux: up.x, uy: up.y };
  }

  function formatReading(d) {
    const a = Math.abs(d);
    const pct = Math.tan(rad(a)) * 100;
    let hv = '—';
    if (a >= 0.5 && a < 89.5) {
      const r = 1 / Math.tan(rad(a));
      hv = (r >= 100 ? Math.round(r) : r.toFixed(1)) + 'H:1V';
    } else if (a >= 89.5) hv = '0H:1V';
    return {
      grados: Math.round(d * 10) / 10,
      porcentaje: Math.round(pct * 10) / 10,
      hv
    };
  }

  // ---- Sensores ----
  function onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    const raw = upFromOrientation(e.beta, e.gamma);
    if (!S.up) S.up = raw;
    else {
      S.up.x += SMOOTH * (raw.x - S.up.x);
      S.up.y += SMOOTH * (raw.y - S.up.y);
      S.up.z += SMOOTH * (raw.z - S.up.z);
      const n = Math.hypot(S.up.x, S.up.y, S.up.z) || 1;
      S.up.x /= n; S.up.y /= n; S.up.z /= n;
    }
    S.hasSensor = true;
  }

  async function requestSensors() {
    if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
    // iOS 13+ (Safari y Chrome iOS): el permiso debe pedirse dentro del gesto del usuario
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      let r;
      try { r = await DeviceOrientationEvent.requestPermission(); }
      catch (e) { console.warn('[SlopeMeter] permiso de movimiento:', e); return 'denied'; }
      if (r !== 'granted') return 'denied';
    }
    window.addEventListener('deviceorientation', onOrientation, true);
    return 'ok';
  }

  // Espera a que llegue al menos una lectura de orientación (si no, no hay sensor)
  function waitForSensor(ms) {
    return new Promise(resolve => {
      const t0 = Date.now();
      (function check() {
        if (S.hasSensor) return resolve(true);
        if (Date.now() - t0 > ms) return resolve(false);
        setTimeout(check, 100);
      })();
    });
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    const attempts = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false }
    ];
    const v = S.el.video;
    // iOS exige estos atributos puestos desde JS para reproducir en línea
    v.muted = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', '');
    for (let i = 0; i < attempts.length; i++) {
      try {
        S.stream = await navigator.mediaDevices.getUserMedia(attempts[i]);
        v.srcObject = S.stream;
        await v.play().catch(() => {});
        S.hasVideo = true;
        return true;
      } catch (e) {
        console.warn('[SlopeMeter] cámara (intento ' + (i + 1) + '):', e && e.name);
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break; // permiso negado: no reintentar
      }
    }
    return false;
  }

  function stopCamera() {
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
    S.hasVideo = false;
    if (S.el.video) S.el.video.srcObject = null;
  }

  // ---- Dibujo ----
  function drawOutlinedText(ctx, text, x, y, size, align, color) {
    ctx.font = '700 ' + size + 'px Inter, system-ui, sans-serif';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size / 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(text, x, y);
  }

  function drawOverlay(ctx, w, h, st) {
    // st: {mode, a (ángulos), shown, stable, progress}
    const accent = st.stable ? '#22c55e' : '#f97316';
    const u = Math.min(w, h) / 100; // unidad relativa
    const cx = w / 2, cy = h / 2;
    ctx.save();
    ctx.lineCap = 'round';
    const aimLike = st.mode === 'aim' || st.mode === 'measure';
    if (aimLike) {
      const ppd = h / VFOV_DEG;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(st.a.roll);
      ctx.translate(0, st.a.signed * ppd);
      // horizonte
      ctx.strokeStyle = accent; ctx.lineWidth = u * 0.5;
      ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(w, 0); ctx.stroke();
      // escalera de grados cada 5°
      ctx.lineWidth = u * 0.3;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      for (let e = -45; e <= 45; e += 5) {
        if (e === 0) continue;
        const y = -e * ppd;
        const half = (e % 10 === 0 ? 12 : 7) * u;
        ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y); ctx.stroke();
        if (e % 10 === 0) {
          drawOutlinedText(ctx, Math.abs(e) + '°', half + 3 * u, y, 2.6 * u, 'left');
          drawOutlinedText(ctx, Math.abs(e) + '°', -half - 3 * u, y, 2.6 * u, 'right');
        }
      }
      ctx.restore();
      // mira central
      ctx.strokeStyle = '#fff'; ctx.lineWidth = u * 0.35;
      ctx.beginPath(); ctx.arc(cx, cy, 4 * u, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 8 * u, cy); ctx.lineTo(cx - 4 * u, cy);
      ctx.moveTo(cx + 4 * u, cy); ctx.lineTo(cx + 8 * u, cy);
      ctx.moveTo(cx, cy - 8 * u); ctx.lineTo(cx, cy - 4 * u);
      ctx.moveTo(cx, cy + 4 * u); ctx.lineTo(cx, cy + 8 * u);
      ctx.stroke();
      // corchete entre la mira y el horizonte (ángulo)
      const hy = cy + st.a.signed * ppd * Math.cos(st.a.roll);
      const bx = cx + 22 * u;
      ctx.strokeStyle = accent; ctx.lineWidth = u * 0.4;
      ctx.beginPath();
      ctx.moveTo(bx - 2 * u, cy); ctx.lineTo(bx, cy); ctx.lineTo(bx, hy); ctx.lineTo(bx - 2 * u, hy);
      ctx.stroke();
    } else {
      const R = Math.min(w, h) * 0.28;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = u * 0.35;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, R / 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();
      // burbuja
      const k = R / Math.sin(rad(12));
      let bx = st.a.ux * k, by = -st.a.uy * k;
      const m = Math.hypot(bx, by);
      if (m > R) { bx *= R / m; by *= R / m; }
      ctx.fillStyle = st.stable ? 'rgba(34,197,94,0.75)' : 'rgba(249,115,22,0.75)';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = u * 0.3;
      ctx.beginPath(); ctx.arc(cx + bx, cy + by, R / 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // lectura grande
    const r = formatReading(st.shown);
    const top = aimLike ? h * 0.2 : h * 0.18;
    drawOutlinedText(ctx, r.grados.toFixed(1) + '°', cx, top, 11 * u, 'center', accent);
    if (st.mode === 'measure') {
      const m = st.meas;
      let y = top + 8 * u;
      if (m.dist != null) {
        drawOutlinedText(ctx, 'Distancia: ' + m.dist.toFixed(2) + ' m', cx, y, 4 * u, 'center', '#22c55e');
        y += 5.5 * u;
      }
      if (m.alt != null) {
        drawOutlinedText(ctx, 'Altura: ' + m.alt.toFixed(2) + ' m', cx, y, 4 * u, 'center', '#22c55e');
      }
    } else {
      drawOutlinedText(ctx, r.porcentaje.toFixed(1) + ' %  ·  ' + r.hv, cx, top + 8 * u, 3.8 * u, 'center');
    }
    // anillo de estabilidad
    if (st.progress > 0) {
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = u * 0.8;
      ctx.beginPath();
      ctx.arc(cx, top + 2 * u, 9 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, st.progress));
      ctx.stroke();
    }
    ctx.restore();
  }

  function frame() {
    if (!S.open) return;
    S.raf = requestAnimationFrame(frame);
    const cv = S.el.canvas, ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);
    if (!S.hasSensor || !S.up) {
      drawOutlinedText(ctx, 'Esperando sensores…', w / 2, h / 2, Math.min(w, h) * 0.05, 'center');
      return;
    }
    let a = computeAngles(S.up, S.mode);
    if (!S.frozen) {
      S.lastAngles = a;
      S.history.push(a.deg);
      if (S.history.length > HISTORY_LEN) S.history.shift();
      const full = S.history.length >= HISTORY_LEN;
      const spread = full ? Math.max.apply(null, S.history) - Math.min.apply(null, S.history) : 99;
      if (spread < STABLE_DEG) S.stableFrames++; else S.stableFrames = 0;
      if (S.mode !== 'measure' && S.stableFrames >= LOCK_FRAMES && !S.reduced) {
        freeze(true);
      }
    } else {
      a = Object.assign({}, S.frozenVals);
    }
    // tween del número mostrado
    if (S.reduced || S.frozen) S.shown = a.deg; else S.shown += (a.deg - S.shown) * 0.2;
    const stable = S.frozen || S.stableFrames > 10;
    drawOverlay(ctx, w, h, {
      mode: S.mode, a, shown: S.shown, stable, meas: S.meas,
      progress: (S.reduced || S.mode === 'measure') ? 0 : (S.frozen ? 1 : S.stableFrames / LOCK_FRAMES)
    });
  }

  function freeze(auto) {
    if (!S.lastAngles) return;
    S.frozen = true;
    S.frozenVals = Object.assign({}, S.lastAngles);
    if (auto && navigator.vibrate) navigator.vibrate(30);
    updateButtons();
  }
  function unfreeze() {
    S.frozen = false; S.frozenVals = null; S.stableFrames = 0; S.history = [];
    updateButtons();
  }

  function updateButtons() {
    if (S.el.freeze) S.el.freeze.textContent = S.frozen ? 'Soltar' : 'Fijar';
    S.el.modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === S.mode));
    const isMeasure = S.mode === 'measure';
    if (S.el.mark) {
      S.el.mark.classList.toggle('hidden', !isMeasure);
      S.el.mark.textContent = S.meas.step === 0 ? 'Marcar base' : (S.meas.step === 1 ? 'Marcar punta' : 'Nueva medida');
    }
    if (S.el.heightWrap) S.el.heightWrap.classList.toggle('hidden', !isMeasure);
    if (S.el.freeze) S.el.freeze.classList.toggle('hidden', isMeasure);
    if (S.el.hint) {
      if (S.mode === 'aim') {
        S.el.hint.textContent = 'Apunta a una marca a la altura de tus ojos (jalón o persona) en el otro extremo del talud';
      } else if (S.mode === 'flat') {
        S.el.hint.textContent = 'Apoya el borde del teléfono sobre la superficie';
      } else {
        S.el.hint.textContent = S.meas.step === 0
          ? 'Sostén el celular a la altura indicada, apunta la mira al pie del objeto en el suelo y toca "Marcar base"'
          : (S.meas.step === 1
            ? 'Sin moverte, apunta la mira a la parte más alta del objeto y toca "Marcar punta"'
            : 'Listo. Toca "Capturar" para guardar o "Nueva medida" para repetir');
      }
    }
  }

  function setMode(m) {
    S.mode = m === 'flat' ? 'flat' : (m === 'measure' ? 'measure' : 'aim');
    resetMeasure();
    unfreeze();
    S.shown = 0;
  }

  function calibrate() {
    if (!S.up) return;
    const key = S.mode === 'flat' ? 'flat' : 'aim';
    const prev = S.offsets[key];
    S.offsets[key] = 0;
    const raw = computeAngles(S.up, S.mode).deg;
    S.offsets[key] = raw; // lectura actual = 0°
    if (!isFinite(S.offsets[key])) S.offsets[key] = prev;
    saveOffsets();
    unfreeze();
    resetMeasure();
    showToast('Calibrado: 0° en modo ' + (key === 'aim' ? 'apuntar/medir' : 'apoyar'), 'success');
  }

  // ---- GPS ----
  function getGpsFix() {
    return new Promise((resolve, reject) => {
      if (AppState.smoothedLocation && AppState.currentLocation &&
          (Date.now() - AppState.currentLocation.timestamp) < LOCATION_MAX_AGE_MS) {
        resolve({ lat: AppState.smoothedLocation.lat, lng: AppState.smoothedLocation.lng });
        return;
      }
      if (!navigator.geolocation) { reject(new Error('GPS no disponible')); return; }
      navigator.geolocation.getCurrentPosition(p => {
        const alt = p.coords.altitude;
        if (alt !== null && alt !== undefined && !isNaN(alt)) AppState.currentAltitude = alt;
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      }, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 });
    });
  }

  // ---- Captura ----
  function canvasToBlob(cv, q) {
    return new Promise(res => cv.toBlob(res, 'image/jpeg', q));
  }

  async function capture() {
    if (!S.lastAngles) { showToast('Aún no hay lectura de sensores', 'error'); return; }
    const vals = S.frozen ? S.frozenVals : S.lastAngles;
    const r = formatReading(vals.deg);
    const modo = S.mode;
    const meas = Object.assign({}, S.meas);
    if (modo === 'measure' && meas.dist == null) {
      showToast('Primero marca la base del objeto', 'error');
      return;
    }
    const hCel = S.height;
    let fix;
    try { fix = await getGpsFix(); }
    catch (e) { showToast('No se pudo obtener la ubicación GPS', 'error'); return; }

    // 1) Foto cruda (frame del video o fondo oscuro si no hay cámara)
    const vw = (S.hasVideo && S.el.video.videoWidth) || 1080;
    const vh = (S.hasVideo && S.el.video.videoHeight) || 1440;
    const raw = document.createElement('canvas');
    raw.width = vw; raw.height = vh;
    const rctx = raw.getContext('2d');
    if (S.hasVideo && S.el.video.videoWidth) rctx.drawImage(S.el.video, 0, 0, vw, vh);
    else { rctx.fillStyle = '#0a0f1a'; rctx.fillRect(0, 0, vw, vh); }

    // 2) Foto con overlay + estampado
    const out = document.createElement('canvas');
    out.width = vw; out.height = vh;
    const octx = out.getContext('2d');
    octx.drawImage(raw, 0, 0);
    drawOverlay(octx, vw, vh, {
      mode: modo, a: vals, shown: vals.deg, stable: true, progress: 0, meas
    });
    const [east, north] = proj4(WGS84, 'EPSG:24877', [fix.lng, fix.lat]);
    const fs = Math.max(18, Math.round(Math.min(vw, vh) * 0.032));
    const modoTxt = modo === 'aim' ? 'Modo apuntar' : (modo === 'flat' ? 'Modo apoyar' : 'Modo medir');
    const lines = [];
    if (modo === 'measure') {
      lines.push('Distancia ' + meas.dist.toFixed(2) + ' m' +
        (meas.alt != null ? ' · Altura ' + meas.alt.toFixed(2) + ' m' : ''));
      lines.push(modoTxt + ' (celular a ' + hCel.toFixed(2) + ' m) · ' + getLocalDateString(new Date()));
    } else {
      lines.push('Pendiente ' + r.grados.toFixed(1) + '° · ' + r.porcentaje.toFixed(1) + ' % · ' + r.hv);
      lines.push(modoTxt + ' · ' + getLocalDateString(new Date()));
    }
    lines.push('E ' + Math.round(east) + '  N ' + Math.round(north));
    lines.forEach((t, i) => drawOutlinedText(octx, t, fs, vh - fs * (lines.length - i) * 1.45, fs, 'left'));

    const stampedBlob = await canvasToBlob(out, 0.9);
    const rawBlob = await canvasToBlob(raw, 0.9);
    if (!stampedBlob || !rawBlob) { showToast('No se pudo generar la foto', 'error'); return; }
    const stampedUrl = injectGpsExif(await blobToDataURL(stampedBlob), fix.lat, fix.lng);
    const rawUrl = injectGpsExif(await blobToDataURL(rawBlob), fix.lat, fix.lng);
    const finalBlob = dataURLtoBlob(stampedUrl);
    const rawFinal = dataURLtoBlob(rawUrl);

    close();
    await openMarkerModal({ lat: fix.lat, lng: fix.lng });
    let desc;
    if (modo === 'measure') {
      desc = 'Distancia: ' + meas.dist.toFixed(2) + ' m' +
        (meas.alt != null ? ' — Altura: ' + meas.alt.toFixed(2) + ' m' : '') +
        ' (celular a ' + hCel.toFixed(2) + ' m)';
    } else {
      desc = 'Pendiente: ' + r.grados.toFixed(1) + '° (' + r.porcentaje.toFixed(1) + ' %, ' + r.hv + ') — modo ' +
        (modo === 'aim' ? 'apuntar' : 'apoyar');
    }
    document.getElementById('marker-description').value = desc;
    AppState.pendingPhotos.push({ blob: finalBlob, dataUrl: stampedUrl, originalBlob: rawFinal });
    renderPhotoGrid();
    if (modo === 'measure') {
      AppState.pendingSlope = {
        modo: 'medir',
        distancia: Math.round(meas.dist * 100) / 100,
        altura: meas.alt != null ? Math.round(meas.alt * 100) / 100 : null,
        alturaCelular: hCel
      };
    } else {
      AppState.pendingSlope = { grados: r.grados, porcentaje: r.porcentaje, hv: r.hv, modo };
    }
  }

  // ---- Ciclo de vida ----
  function cacheEls() {
    const q = id => document.getElementById(id);
    S.el = {
      screen: q('slope-screen'), video: q('slope-video'), canvas: q('slope-overlay'),
      hint: q('slope-hint'), freeze: q('btn-slope-freeze'),
      mark: q('btn-slope-mark'), heightWrap: q('slope-height-wrap'), height: q('slope-height'),
      modeBtns: Array.prototype.slice.call(document.querySelectorAll('.slope-mode-btn'))
    };
  }

  async function open() {
    if (S.open) return;
    if (!S.el.screen) cacheEls();
    if (!window.isSecureContext) {
      showToast('La cámara y los sensores requieren HTTPS', 'error');
      return;
    }
    // exclusión mutua con medición y modo marcador
    if (AppState.isMeasurementMode && typeof stopMeasurement === 'function') stopMeasurement();
    if (AppState.isAddMarkerMode) {
      AppState.isAddMarkerMode = false;
      const b = document.getElementById('btn-add-marker');
      if (b) b.classList.remove('active');
    }
    if (typeof exitMarkerPlacement === 'function') exitMarkerPlacement();
    if (typeof closeMarkerPlacementModal === 'function') closeMarkerPlacementModal();

    S.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    loadOffsets();
    S.up = null; S.hasSensor = false;
    let sensors = 'unsupported';
    try { sensors = await requestSensors(); }
    catch (e) { console.warn('[SlopeMeter] sensores:', e); }
    if (sensors !== 'ok') {
      showToast(sensors === 'denied'
        ? 'Permiso de movimiento denegado. En iPhone: Ajustes → Safari/Chrome → Movimiento y orientación, y vuelve a intentar'
        : 'Este dispositivo no tiene sensores de movimiento (usa un celular)', 'error');
      return;
    }
    const cam = await startCamera();
    if (!(await waitForSensor(2500))) {
      window.removeEventListener('deviceorientation', onOrientation, true);
      stopCamera();
      showToast('No llegan datos del sensor. Revisa que el permiso de movimiento esté activo en el navegador', 'error');
      return;
    }
    if (!cam) {
      if (S.mode === 'aim' || S.mode === 'measure') {
        showToast('Cámara no disponible: se usará el modo Apoyar', 'info');
        S.mode = 'flat';
      } else {
        showToast('Cámara no disponible: se muestra solo el nivel', 'info');
      }
    }
    S.shown = 0; S.history = []; S.stableFrames = 0;
    S.frozen = false; S.frozenVals = null; S.lastAngles = null;
    S.open = true;
    S.el.screen.classList.remove('hidden');
    S.el.screen.classList.toggle('no-video', !cam);
    updateButtons();
    S.raf = requestAnimationFrame(frame);
  }

  function close() {
    if (!S.open && !S.stream) return;
    S.open = false;
    cancelAnimationFrame(S.raf);
    window.removeEventListener('deviceorientation', onOrientation, true);
    stopCamera();
    if (S.el.screen) S.el.screen.classList.add('hidden');
  }

  function init() {
    cacheEls();
    if (!S.el.screen) return;
    const on = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', fn); };
    on('btn-slope', open);
    on('btn-slope-close', close);
    on('btn-slope-calibrate', calibrate);
    on('btn-slope-freeze', () => { if (S.frozen) unfreeze(); else freeze(false); });
    on('btn-slope-capture', capture);
    on('btn-slope-mark', markPoint);
    if (S.el.height) S.el.height.addEventListener('change', onHeightInput);
    S.el.modeBtns.forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); }));
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.open) close(); });
    loadOffsets();
    loadHeight();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { open, close, computeAngles, formatReading };
})();
