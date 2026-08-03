/**
 * leaflet-rotate-patches.js
 *
 * Parches no invasivos sobre leaflet-rotate (Raruto) para mejorar la fluidez
 * de rotación + zoom en móvil. Se cargan DESPUÉS de leaflet-rotate.js.
 *
 * Objetivos:
 * 1. Eliminar el _resetView final agresivo al soltar el gesto táctil.
 * 2. Evitar que los tiles se recalculen en cada frame de rotación.
 * 3. Agrupar el evento 'rotate' con requestAnimationFrame.
 * 4. Reducir el trabajo de vectores y marcadores durante rotación activa.
 */

(function () {
  'use strict';

  // Esperar a que L exista y el plugin haya extendido las clases
  if (typeof L === 'undefined') return;

  // ------------------------------------------------------------------
  // a) _onTouchEnd sin _resetView / _animateZoom
  // ------------------------------------------------------------------
  if (L.Map && L.Map.TouchGestures && L.Map.TouchGestures.prototype) {
    L.Map.TouchGestures.prototype._onTouchEnd = function () {
      if (this._moved && (this._zooming || this._rotating)) {
        this._zooming = false;
        this._rotating = false;
        L.Util.cancelAnimFrame(this._animRequest);
        L.DomEvent
          .off(document, 'touchmove', this._onTouchMove, this)
          .off(document, 'touchend touchcancel', this._onTouchEnd, this);

        // NO hacemos _resetView ni _animateZoom.
        // Simplemente confirmamos la posición final con _move sin animación.
        if (this.zoom && this._center && typeof this._zoom === 'number') {
          this._map._move(this._center, this._map._limitZoom(this._zoom), {
            pinch: true,
            round: false
          }, undefined);
        }
      } else {
        this._zooming = false;
      }
    };
  }

  // ------------------------------------------------------------------
  // b) Tiles: no refrescar en cada frame de rotate
  // ------------------------------------------------------------------
  if (L.GridLayer && L.GridLayer.prototype) {
    const originalGridGetEvents = L.GridLayer.prototype.getEvents;
    L.GridLayer.prototype.getEvents = function () {
      const events = originalGridGetEvents.apply(this, arguments);
      // Si el mapa está rotado, eliminamos el listener 'rotate' que el
      // plugin añadió. Los tiles seguirán rotando visualmente con el pane,
      // pero no se recalcularán hasta moveend/zoomend.
      if (this._map && this._map._rotate && events.rotate) {
        delete events.rotate;
      }
      return events;
    };
  }

  // ------------------------------------------------------------------
  // c) Agrupar evento 'rotate' con requestAnimationFrame
  // ------------------------------------------------------------------
  if (L.Map && L.Map.prototype) {
    const originalSetBearing = L.Map.prototype.setBearing;
    let rotateRafPending = null;

    L.Map.prototype.setBearing = function (theta) {
      // Aplicar la transformación inmediatamente para que el gesto sea fluido
      const result = originalSetBearing.apply(this, arguments);

      // Agrupar la emisión del evento 'rotate' en un único frame
      if (!rotateRafPending) {
        rotateRafPending = requestAnimationFrame(() => {
          rotateRafPending = null;
          this.fire('rotate');
        });
      }
      return result;
    };
  }

  // ------------------------------------------------------------------
  // d) Vectores y marcadores: actualizar con RAF / sin rotate listener
  // ------------------------------------------------------------------
  if (L.Renderer && L.Renderer.prototype) {
    const originalRendererGetEvents = L.Renderer.prototype.getEvents;
    L.Renderer.prototype.getEvents = function () {
      const events = originalRendererGetEvents.apply(this, arguments);
      // Quitamos la actualización completa en cada rotate.
      // Los vectores dentro del rotatePane rotan con el pane; los demás
      // se actualizarán en moveend/zoomend.
      if (this._map && this._map._rotate && events.rotate) {
        delete events.rotate;
      }
      return events;
    };
  }

  if (L.Marker && L.Marker.prototype) {
    const originalMarkerGetEvents = L.Marker.prototype.getEvents;
    L.Marker.prototype.getEvents = function () {
      const events = originalMarkerGetEvents.apply(this, arguments);
      if (this._map && this._map._rotate && events.rotate) {
        const marker = this;
        let markerRaf = null;
        events.rotate = function () {
          if (markerRaf) return;
          markerRaf = requestAnimationFrame(() => {
            markerRaf = null;
            marker.update();
          });
        };
      }
      return events;
    };
  }

  // ------------------------------------------------------------------
  // e) Forzar composición GPU en panes rotados (inyección CSS)
  // ------------------------------------------------------------------
  const gpuStyle = document.createElement('style');
  gpuStyle.id = 'leaflet-rotate-gpu';
  gpuStyle.textContent = `
    .leaflet-rotate-pane,
    .leaflet-tile-container {
      backface-visibility: hidden;
      transform-style: preserve-3d;
    }
    .leaflet-tile-container {
      will-change: transform;
    }
  `;
  document.head.appendChild(gpuStyle);
})();
