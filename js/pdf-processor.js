/**
 * pdf-processor.js - PDF Map Processor for MAPS GIS
 *
 * Handles PDF rendering, GeoPDF metadata extraction (ISO 32000-2,
 * OGC GeoPDF, TerraGo), and georeferenced image overlay creation.
 *
 * Extraction strategies:
 * 1. ISO 32000-2: VP > Measure > GPTS/LPTS (QGIS GeoPDF)
 * 2. OGC GeoPDF: LGIDict > CTM + Registration
 * 3. Viewport Bounds (fallback)
 * 4. Well-Known Text CRS in metadata
 */

const PDFProcessor = (() => {

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  // ============================================
  // GEOPDF DATA EXTRACTION
  // ============================================

  /**
   * Main entry: Extract geo data from a PDF ArrayBuffer
   * Tries multiple strategies and returns the first success
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<object|null>} { corners, crs, source } or null
   */
  async function extractGeoData(arrayBuffer) {
    // Strategy 1: ISO 32000-2 (QGIS GeoPDF) - GPTS/LPTS
    const isoResult = extractISO32000(arrayBuffer);
    if (isoResult) return isoResult;

    // Strategy 2: OGC GeoPDF - LGIDict / CTM
    const ogcResult = extractOGCGeoPDF(arrayBuffer);
    if (ogcResult) return ogcResult;

    // Strategy 3: Viewport Bounds
    const vpResult = extractViewportBounds(arrayBuffer);
    if (vpResult) return vpResult;

    // Strategy 4: Try PDF.js annotations
    const annotResult = await extractFromPDFAnnotations(arrayBuffer);
    if (annotResult) return annotResult;

    return null;
  }

  /**
   * Strategy 1: Extract ISO 32000-2 GeoPDF data (GPTS/LPTS)
   * Used by QGIS GeoPDF exports
   */
  function extractISO32000(arrayBuffer) {
    const text = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));

    // Find GPTS arrays - geographic points (lat, lon pairs)
    const gptsAll = findAllArrays(text, /\/GPTS\s*\[([^\]]+)\]/g);
    // Find LPTS arrays - corresponding normalized page coordinates
    const lptsAll = findAllArrays(text, /\/LPTS\s*\[([^\]]+)\]/g);

    if (gptsAll.length === 0 || lptsAll.length === 0) return null;

    // Use first match
    const gpts = gptsAll[0];
    const lpts = lptsAll[0];

    if (gpts.length < 8 || lpts.length < 8) return null;

    console.log('[GeoPDF extractISO32000]');
    console.log('  GPTS:', gpts);
    console.log('  LPTS:', lpts);

    // Map GPTS to corners using LPTS position indicators
    // LPTS values are normalized page coords: (0,0)=bottom-left, (1,1)=top-right
    let tl = null, tr = null, bl = null, br = null;

    for (let i = 0; i < 4; i++) {
      const lat = gpts[i * 2];
      const lon = gpts[i * 2 + 1];
      const nx = lpts[i * 2];     // normalized x (0=left, 1=right)
      const ny = lpts[i * 2 + 1]; // normalized y (0=bottom, 1=top)

      // PDF coordinate system: y increases upward
      if (nx <= 0.5 && ny >= 0.5) {
        tl = { lat, lon, nx, ny };
      } else if (nx >= 0.5 && ny >= 0.5) {
        tr = { lat, lon, nx, ny };
      } else if (nx <= 0.5 && ny <= 0.5) {
        bl = { lat, lon, nx, ny };
      } else if (nx >= 0.5 && ny <= 0.5) {
        br = { lat, lon, nx, ny };
      }
    }

    // If we couldn't determine corners by position, use order-based mapping
    // ISO 32000-2 order: UL (TL), UR (TR), LR (BR), LL (BL)
    if (!tl || !tr || !bl || !br) {
      // Fallback: assume ISO 32000-2 ordering
      // gpts[0,1]=TL, gpts[2,3]=TR, gpts[4,5]=BR, gpts[6,7]=BL
      tl = { lat: gpts[0], lon: gpts[1] };
      tr = { lat: gpts[2], lon: gpts[3] };
      br = { lat: gpts[4], lon: gpts[5] };
      bl = { lat: gpts[6], lon: gpts[7] };
    }

    // Detectar CRS solo dentro del contexto geoespacial (VP/Measure dict que
    // contiene las GPTS/LPTS), NO en todo el texto del PDF. Esto evita falsos
    // positivos cuando "PSAD56" o "EPSG" aparecen en leyendas/títulos/proyectos.
    // Per ISO 32000-2, GPTS son coordenadas geográficas lat/lon (WGS84 por defecto).
    const vpContext = extractVPContext(text);
    const detectedCrs = detectCRSInContext(vpContext) || 'EPSG:4326';
    console.log('  CRS detectado (contexto VP):', detectedCrs);

    // Leer Rotate y CropBox para diagnostico
    const rotate = matchPageInt(text, '/Rotate');
    const cropBox = matchNumberArray(text, '/CropBox');
    const mediaBox = matchNumberArray(text, '/MediaBox');
    console.log('  /Rotate:', rotate, '| /CropBox:', cropBox, '| /MediaBox:', mediaBox);

    return {
      corners: {
        tl: [tl.lon, tl.lat],
        tr: [tr.lon, tr.lat],
        bl: [bl.lon, bl.lat],
        br: [br.lon, br.lat]
      },
      crs: detectedCrs,
      source: 'ISO-32000-2 (GeoPDF)',
      _vpContext: vpContext
    };
  }

  /**
   * Extrae el substring del diccionario VP/Measure que contiene /GPTS.
   * Retorna null si no encuentra contexto geoespacial.
   */
  function extractVPContext(text) {
    const idx = text.indexOf('/GPTS');
    if (idx === -1) return null;
    // Tomar una ventana amplia alrededor de GPTS: 2 KB hacia atras y 2 KB hacia adelante.
    // Esto captura el VP/Measure dict completo, incluyendo cualquier /GEOGCS, /EPSG, /WKT.
    const start = Math.max(0, idx - 2048);
    const end = Math.min(text.length, idx + 2048);
    return text.substring(start, end);
  }

  /**
   * Detecta EPSG/WKT CRS unicamente dentro de un contexto geoespacial (VP/Measure).
   * Evita falsos positivos leyendo todo el texto del PDF.
   */
  function detectCRSInContext(ctx) {
    if (!ctx) return null;
    // 1. EPSG explicito dentro del contexto geoespacial
    const epsgMatch = ctx.match(/EPSG[":\s]*["']?(\d{4,5})/i);
    if (epsgMatch) return 'EPSG:' + epsgMatch[1];

    // 2. WKT / PROJCS / GEOGCS dentro del contexto
    if (/GEOGCS\s*\[?\s*"WGS 84"/i.test(ctx) || /DATUM\s*\[?\s*"WGS_1984"/i.test(ctx)) {
      return 'EPSG:4326';
    }
    if (/GEOGCS\s*\[?\s*"PSAD56"/i.test(ctx) || /DATUM\s*\[?\s*"PSAD56/i.test(ctx)) {
      // PSAD56 geografico (lat/lon) -> las GPTS siguen siendo lat/lon PSAD56 (datum Intl 1924)
      return 'PSAD56GEO';
    }
    // Si el contexto declara explicitamente un sistema proyectado PSAD56 UTM 17S,
    // las coordenadas son este/norte UTM (no lat/lon).
    if (/PROJCS\s*\[?\s*"[^"]*PSAD56[^"]*UTM[^"]*17S/i.test(ctx) ||
        /EPSG[":\s]*["']?24877/i.test(ctx)) {
      return 'EPSG:24877';
    }

    // 3. Indicadores WGS84 dentro del contexto geoespacial
    if (/\/WKT\s*[\(\[]/.test(ctx) && /WGS.?84/i.test(ctx)) return 'EPSG:4326';

    // 4. Si no hay nada claro, devolver null -> el llamador usara EPSG:4326 por defecto
    return null;
  }

  function matchPageInt(text, key) {
    const m = text.match(new RegExp(key + '\\s+(\\d+)'));
    return m ? parseInt(m[1]) : 0;
  }

  function matchNumberArray(text, key) {
    const m = text.match(new RegExp(key + '\\s*\\[\\s*([^\\]]+)\\]'));
    if (!m) return null;
    const v = m[1].trim().split(/\s+/).map(Number);
    return v.some(isNaN) ? null : v;
  }

  /**
   * Strategy 2: Extract OGC GeoPDF data (LGIDict/CTM)
   */
  function extractOGCGeoPDF(arrayBuffer) {
    const text = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));

    // Look for LGIDict entries
    const lgiMatch = text.match(/\/LGIDict\s+\d+\s+\d+\s+R/i);
    if (!lgiMatch) return null;

    // Look for CTM (Coordinate Transformation Matrix)
    const ctmMatch = text.match(/\/CTM\s*\[([^\]]+)\]/);
    if (!ctmMatch) return null;

    const ctmValues = ctmMatch[1].trim().split(/\s+/).map(Number);
    if (ctmValues.length < 6) return null;

    // CTM is an affine transformation matrix [a, b, c, d, e, f]
    // Maps PDF point (x,y) to world coordinates:
    //   worldX = a*x + c*y + e
    //   worldY = b*x + d*y + f
    const [a, b, c, d, e, f] = ctmValues;

    // Look for Registration points (pixel-to-world mapping)
    const regMatch = text.match(/\/Registration\s*\[([^\]]+)\]/);
    if (regMatch) {
      // Extract registration point pairs for verification
    }

    // Get page dimensions from PDF. Prefer CropBox (lo que PDF.js renderiza),
    // con fallback a MediaBox. Esto evita desfases cuando hay margenes blancos.
    const cropBox = matchNumberArray(text, '/CropBox');
    const mediaBox = matchNumberArray(text, '/MediaBox');
    let pageWidth = 612, pageHeight = 792; // Default US Letter
    const box = cropBox || mediaBox;
    if (box && box.length >= 4) {
      pageWidth = box[2] - box[0];
      pageHeight = box[3] - box[1];
    }
    const pageOriginX = box ? box[0] : 0;
    const pageOriginY = box ? box[1] : 0;

    // Calculate corner world coordinates from CTM.
    // PDF coords: origen bottom-left; usamos el cropbox origin como referencia
    // para mapear correctamente las esquinas del area renderizada.
    const blWorld = { x: a * pageOriginX + c * pageOriginY + e, y: b * pageOriginX + d * pageOriginY + f };
    const brWorld = { x: a * (pageOriginX + pageWidth) + c * pageOriginY + e, y: b * (pageOriginX + pageWidth) + d * pageOriginY + f };
    const tlWorld = { x: a * pageOriginX + c * (pageOriginY + pageHeight) + e, y: b * pageOriginX + d * (pageOriginY + pageHeight) + f };
    const trWorld = { x: a * (pageOriginX + pageWidth) + c * (pageOriginY + pageHeight) + e, y: b * (pageOriginX + pageWidth) + d * (pageOriginY + pageHeight) + f };

    // Determine CRS unicamente dentro del contexto LGIDict (no en todo el texto)
    const lgiIdx = text.search(/\/LGIDict\s+\d+\s+\d+\s+R/i);
    const lgiContext = lgiIdx >= 0 ? text.substring(lgiIdx, Math.min(text.length, lgiIdx + 4096)) : text;
    const crs = detectCRSInContext(lgiContext) || 'EPSG:4326';
    console.log('[GeoPDF extractOGCGeoPDF] CTM:', ctmValues, '| CRS:', crs, '| CropBox:', cropBox, '| MediaBox:', mediaBox);

    // If CRS is EPSG:4326, x=lon, y=lat
    if (crs === 'EPSG:4326') {
      return {
        corners: {
          tl: [tlWorld.x, tlWorld.y],
          tr: [trWorld.x, trWorld.y],
          bl: [blWorld.x, blWorld.y],
          br: [brWorld.x, brWorld.y]
        },
        crs: crs,
        source: 'OGC GeoPDF (CTM)'
      };
    }

    // For projected CRS, x=easting, y=northing
    return {
      corners: {
        tl: [tlWorld.x, tlWorld.y],
        tr: [trWorld.x, trWorld.y],
        bl: [blWorld.x, blWorld.y],
        br: [brWorld.x, brWorld.y]
      },
      crs: crs,
      source: 'OGC GeoPDF (CTM)'
    };
  }

  /**
   * Strategy 3: Extract viewport bounds
   * Some GeoPDFs store geographic extent in viewport Bounds
   */
  function extractViewportBounds(arrayBuffer) {
    const text = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));

    // Look for Bounds in VP dictionaries
    const vpMatches = text.match(/\/VP\s*\[[\s\S]*?\]/g);
    if (!vpMatches) return null;

    for (const vp of vpMatches) {
      const boundsMatch = vp.match(/\/Bounds\s*\[\s*([^\]]+)\]/);
      if (!boundsMatch) continue;

      const bounds = boundsMatch[1].trim().split(/\s+/).map(Number);
      if (bounds.length >= 4) {
        // Bounds typically [xmin, ymin, xmax, ymax]
        const xmin = bounds[0], ymin = bounds[1];
        const xmax = bounds[2], ymax = bounds[3];

        const crs = detectCRSInContext(vp) || 'EPSG:4326';

        return {
          corners: {
            tl: crs === 'EPSG:4326' ? [xmin, ymax] : [xmin, ymax],
            tr: crs === 'EPSG:4326' ? [xmax, ymax] : [xmax, ymax],
            bl: crs === 'EPSG:4326' ? [xmin, ymin] : [xmin, ymin],
            br: crs === 'EPSG:4326' ? [xmax, ymin] : [xmax, ymin]
          },
          crs: crs,
          source: 'Viewport Bounds'
        };
      }
    }

    return null;
  }

  /**
   * Strategy 4: Try PDF.js annotations extraction
   */
  async function extractFromPDFAnnotations(arrayBuffer) {
    try {
      const pdf = await pdfjsLib.getDocument({ data: freshUint8(arrayBuffer) }).promise;
      const page = await pdf.getPage(1);

      // Check for viewport annotations
      const viewport = page.getViewport({ scale: 1.0 });

      // Try to access the raw page dictionary for geo data
      // This is a best-effort approach using PDF.js internals
      const annotations = await page.getAnnotations();

      for (const annot of annotations) {
        if (annot.subtype === 'Measure' || annot.subtype === 'GEO') {
          // Found a measurement/geographic annotation
          if (annot.gpts && annot.lpts) {
            return processGPTS_LPTS(annot.gpts, annot.lpts);
          }
        }
      }

      return null;
    } catch (e) {
      console.log('PDF.js annotation extraction failed:', e);
      return null;
    }
  }

  /**
   * Process GPTS/LPTS from PDF.js annotation
   */
  function processGPTS_LPTS(gpts, lpts) {
    if (!gpts || !lpts || gpts.length < 8 || lpts.length < 8) return null;

    let tl, tr, bl, br;

    for (let i = 0; i < 4; i++) {
      const lat = gpts[i * 2];
      const lon = gpts[i * 2 + 1];
      const nx = lpts[i * 2];
      const ny = lpts[i * 2 + 1];

      if (nx < 0.5 && ny > 0.5) tl = { lat, lon };
      else if (nx > 0.5 && ny > 0.5) tr = { lat, lon };
      else if (nx < 0.5 && ny < 0.5) bl = { lat, lon };
      else if (nx > 0.5 && ny < 0.5) br = { lat, lon };
    }

    if (!tl || !tr || !bl || !br) return null;

    return {
      corners: {
        tl: [tl.lon, tl.lat],
        tr: [tr.lon, tr.lat],
        bl: [bl.lon, bl.lat],
        br: [br.lon, br.lat]
      },
      crs: 'EPSG:4326',
      source: 'PDF.js Annotations'
    };
  }

  /**
   * Detect the coordinate reference system from PDF metadata
   */
  function detectCRS(text) {
    // Look for EPSG codes
    const epsgMatch = text.match(/EPSG[:\s]*(\d+)/i);
    if (epsgMatch) {
      return 'EPSG:' + epsgMatch[1];
    }

    // Look for WGS84 indicators
    if (text.match(/WGS[\s_]?84/i) || text.match(/WGS_1984/i)) {
      return 'EPSG:4326';
    }

    // Look for PSAD56 indicators
    if (text.match(/PSAD[\s_]?56/i) || text.match(/EPSG[:\s]*24877/i)) {
      return 'EPSG:24877';
    }

    // Look for UTM zone indicators
    const utmMatch = text.match(/UTM[\s_]+Zone[\s_]*(\d+)[\s_]*(N|S)/i);
    if (utmMatch) {
      const zone = parseInt(utmMatch[1]);
      const hemisphere = utmMatch[2].toUpperCase();
      // Common UTM EPSG codes
      const utmEPSG = {
        '17S': 'EPSG:24877', // PSAD56 UTM 17S
        '17N': 'EPSG:32617', // WGS84 UTM 17N
        '18S': 'EPSG:24878', // PSAD56 UTM 18S
        '19S': 'EPSG:32719', // WGS84 UTM 19S
      };
      const key = zone + hemisphere;
      if (utmEPSG[key]) return utmEPSG[key];
    }

    // Check for projection strings
    if (text.match(/proj=utm/i)) {
      const zoneMatch = text.match(/zone=(\d+)/i);
      const southMatch = text.match(/south/i);
      if (zoneMatch) {
        return 'EPSG:4326'; // Default to WGS84 for unknown proj strings
      }
    }

    return null;
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Find all numeric arrays matching a regex pattern
   */
  function findAllArrays(text, regex) {
    const results = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const values = match[1].trim().split(/\s+/).map(Number);
      if (values.every(v => !isNaN(v))) {
        results.push(values);
      }
    }
    return results;
  }

  // ============================================
  // PDF LOADING AND RENDERING
  // ============================================

  /**
   * Crea una copia del ArrayBuffer como Uint8Array.
   * PDF.js con worker puede "detachear" (transferir) un ArrayBuffer que se le
   * pase directamente, dejandolo neutered (byteLength=0) para usos posteriores.
   * Pasarle un Uint8Array forces a PDF.js a copiarlo internamente, evitando
   * la transferencia zero-copy. Seguridad anti-detachment ademas de la slice.
   */
  function freshUint8(buffer) {
    const ab = buffer instanceof ArrayBuffer ? buffer.slice(0) : buffer.buffer.slice(0);
    return new Uint8Array(ab);
  }

  // ============================================
  // PAGE ROTATION HANDLING (/Rotate)
  // ============================================

  function normalizeRotation(rotate) {
    const r = Number(rotate) || 0;
    return ((r % 360) + 360) % 360;
  }

  /**
   * Permuta las etiquetas de esquinas del espacio de usuario PDF (sin rotar)
   * al espacio de display, para una rotacion horaria r (/Rotate de la pagina).
   */
  function permuteCorners(corners, rotate) {
    const { tl, tr, bl, br } = corners;
    switch (rotate) {
      case 90:  return { tl: bl, tr: tl, br: tr, bl: br };
      case 180: return { tl: br, tr: bl, br: tl, bl: tr };
      case 270: return { tl: tr, tr: br, br: bl, bl: tl };
      default:  return { tl, tr, bl, br };
    }
  }

  /**
   * Verificacion de cordura: las esquinas candidatas deben quedar
   * "norte-arriba" (borde superior al norte, borde izquierdo al oeste).
   * Funciona en lat/lon, PSAD56 geografico y UTM (x=easting, y=northing).
   *
   * Se exige un MARGEN (>=50% del span total de cada eje) y no solo una
   * desigualdad estricta: en mapas casi cuadrados, una permutacion
   * incorrecta puede ganar por diferencias minusculas de redondeo.
   */
  function isNorthUp(corners) {
    const pts = [corners.tl, corners.tr, corners.bl, corners.br];
    const xs = pts.map(c => c[0]);
    const ys = pts.map(c => c[1]);
    const spanX = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    const spanY = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    const deltaY = (corners.tl[1] + corners.tr[1] - corners.bl[1] - corners.br[1]) / 2;
    const deltaX = (corners.tr[0] + corners.br[0] - corners.tl[0] - corners.bl[0]) / 2;
    return deltaY > 0.5 * spanY && deltaX > 0.5 * spanX;
  }

  /**
   * Ajusta las esquinas extraidas (espacio de usuario PDF, SIN rotar) a la
   * orientacion con la que se renderizara la pagina, y decide que rotacion
   * debe usar el render. Devuelve { geoData, renderRotation } con las
   * esquinas ya en espacio de display y la rotacion para page.getViewport().
   *
   * Contexto: PDF.js renderiza aplicando page.rotate por defecto, pero las
   * estrategias de extraccion etiquetan esquinas en el espacio sin rotar.
   * Con /Rotate != 0 hay que permutar las etiquetas (o cambiar la rotacion
   * del render) para que imagen y esquinas coincidan.
   */
  function applyPageRotation(geoData, rotate) {
    const r = normalizeRotation(rotate);
    if (!geoData || !geoData.corners) {
      // Sin georreferencia detectada (georreferenciacion manual en el modal):
      // el preview/overlay se renderiza en orientacion de visor (como antes).
      return { geoData, renderRotation: r };
    }
    if (r === 0) {
      return { geoData, renderRotation: 0 };
    }
    // viewport-bounds entrega un bbox en coordenadas geo: invariante a permutacion
    if (geoData.source === 'viewport-bounds') {
      return { geoData, renderRotation: r };
    }

    const candidates = [
      { corners: permuteCorners(geoData.corners, r), renderRotation: r, label: 'permutadas+rotado' },
      { corners: geoData.corners,                    renderRotation: 0, label: 'originales+sin-rotacion' },
      { corners: geoData.corners,                    renderRotation: r, label: 'originales+rotado' }
    ];
    for (const c of candidates) {
      if (isNorthUp(c.corners)) {
        console.log('[applyPageRotation] /Rotate=' + r + ' -> candidato ganador: ' + c.label);
        return { geoData: Object.assign({}, geoData, { corners: c.corners }), renderRotation: c.renderRotation };
      }
    }
    // Ningun candidato paso la verificacion: mantener comportamiento anterior
    console.warn('[applyPageRotation] Ningun candidato paso isNorthUp; se usa render rotado con esquinas originales');
    return { geoData, renderRotation: r };
  }

  /**
   * Load a PDF from ArrayBuffer
   */
  async function loadPDF(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js no esta disponible');
    }
    const data = freshUint8(arrayBuffer);
    console.log('[loadPDF] bytes:', data.byteLength, '| header:', String.fromCharCode(...data.slice(0, 5)));
    return await pdfjsLib.getDocument({ data: data }).promise;
  }

  /**
   * Render first page of PDF to canvas
   * @param {object} pdf - PDF.js document
   * @param {number} scale - Escala de render
   * @param {number} [rotation] - Rotacion explicita para getViewport.
   *   Si es undefined, PDF.js usa page.rotate (orientacion de visor).
   */
  async function renderPage(pdf, scale = 2, rotation = undefined) {
    const page = await pdf.getPage(1);
    const viewportOptions = { scale: scale };
    if (rotation !== undefined && rotation !== null) {
      viewportOptions.rotation = rotation;
    }
    const viewport = page.getViewport(viewportOptions);

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    return { canvas, width: viewport.width, height: viewport.height };
  }

  /**
   * Check if a PDF might be a GeoPDF
   */
  async function isGeoPDF(arrayBuffer) {
    // First try quick regex check
    const text = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));
    if (text.match(/\/GPTS/i) || text.match(/\/LGIDict/i) ||
        text.match(/\/Measure\s/i) || text.match(/\/CTM\s*\[/i) ||
        text.match(/\/GEO/i)) {
      return true;
    }

    // Then try PDF.js metadata
    try {
      const pdf = await pdfjsLib.getDocument({ data: freshUint8(arrayBuffer) }).promise;
      const metadata = await pdf.getMetadata();
      if (metadata && metadata.info) {
        const str = JSON.stringify(metadata.info);
        if (str.match(/geopdf/i) || str.match(/terrago/i) ||
            str.match(/geospatial/i) || str.match(/lizardtech/i)) {
          return true;
        }
      }
    } catch (e) {
      // Ignore
    }

    return false;
  }

  /**
   * Rectifica (endereza a norte-arriba) el canvas de una pagina PDF cuyo
   * contenido esta rotado geograficamente (ej. planos con el marco a 45°).
   * g = esquinas {tl,tr,bl,br} en metros locales (x este, y norte),
   * correspondientes a los pixeles (0,0), (W,0), (0,H), (W,H) del canvas.
   * Devuelve un canvas nuevo axis-aligned que cubre el bbox de las esquinas
   * (las zonas fuera del plano quedan transparentes).
   */
  function rectifyCanvasToNorthUp(canvas, g) {
    const W = canvas.width, H = canvas.height;
    // Afin fuente: geo = M*(x,y) + t  (con esquinas tl, tr, bl)
    const M11 = (g.tr[0] - g.tl[0]) / W, M21 = (g.tr[1] - g.tl[1]) / W;
    const M12 = (g.bl[0] - g.tl[0]) / H, M22 = (g.bl[1] - g.tl[1]) / H;
    // Bbox en metros de las 4 esquinas
    const xs = [g.tl[0], g.tr[0], g.bl[0], g.br[0]];
    const ys = [g.tl[1], g.tr[1], g.bl[1], g.br[1]];
    const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    const spanX = maxX - minX, spanY = maxY - minY;
    // Resolucion destino ~ igual a la fuente (con tope de memoria)
    const mppX = Math.hypot(g.tr[0] - g.tl[0], g.tr[1] - g.tl[1]) / W;
    const mppY = Math.hypot(g.bl[0] - g.tl[0], g.bl[1] - g.tl[1]) / H;
    const newW = Math.max(1, Math.min(4096, Math.round(spanX / mppX)));
    const newH = Math.max(1, Math.min(4096, Math.round(spanY / mppY)));
    // D: pixel destino -> geo (norte-arriba sobre el bbox)
    const D11 = spanX / newW, D22 = -spanY / newH;
    // Transformacion canvas-fuente -> canvas-destino: T = D^-1 * M
    const out = document.createElement('canvas');
    out.width = newW;
    out.height = newH;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(
      M11 / D11, M21 / D22,
      M12 / D11, M22 / D22,
      (g.tl[0] - minX) / D11, (g.tl[1] - maxY) / D22
    );
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  /**
   * Create a georeferenced image overlay for Leaflet
   * @param {HTMLCanvasElement} canvas - Rendered PDF page
   * @param {object} corners - { tl: [e,n], tr: [e,n], bl: [e,n], br: [e,n] }
   * @param {string} crs - Input CRS
   */
  function createGeoOverlay(canvas, corners, crs, offset, sourceDatum) {
    // Convert corners to WGS84 (Leaflet's native CRS)
    sourceDatum = sourceDatum || 'auto';
    const toWGS84 = (e, n) => {
      if (crs === 'EPSG:4326') {
        // Por defecto ISO 32000-2 asume WGS84, pero muchos GeoPDFs locales usan
        // coordenadas geográficas PSAD56 sin declararlo bien. sourceDatum permite
        // forzar la interpretacion correcta.
        if (sourceDatum === 'PSAD56' && typeof proj4 !== 'undefined') {
          const [lng, lat] = proj4('PSAD56GEO', 'EPSG:4326', [e, n]);
          return [lat, lng];
        }
        return [n, e]; // lat, lng (input is [lon, lat])
      }
      if (crs === 'PSAD56GEO') {
        // Coordenadas geograficas en datum PSAD56 (International 1924).
        if (typeof proj4 !== 'undefined') {
          const [lng, lat] = proj4('PSAD56GEO', 'EPSG:4326', [e, n]);
          return [lat, lng];
        }
        return [n, e];
      }
      // Si el PDF declara EPSG:24877 (PSAD56 UTM 17S) pero las coordenadas son geográficas (<180),
      // probablemente el GPTS está en lat/lon PSAD56 (datum International 1924).
      if (crs === 'EPSG:24877' && typeof proj4 !== 'undefined') {
        if (Math.abs(e) < 180 && Math.abs(n) < 90) {
          if (sourceDatum === 'WGS84') {
            return [n, e];
          }
          const [lng, lat] = proj4('PSAD56GEO', 'EPSG:4326', [e, n]);
          return [lat, lng];
        }
        const [lng, lat] = proj4('EPSG:24877', 'EPSG:4326', [e, n]);
        return [lat, lng];
      }
      if (typeof proj4 !== 'undefined') {
        const [lng, lat] = proj4(crs, 'EPSG:4326', [e, n]);
        return [lat, lng];
      }
      return [n, e];
    };

    let tl = toWGS84(corners.tl[0], corners.tl[1]);
    let tr = toWGS84(corners.tr[0], corners.tr[1]);
    let bl = toWGS84(corners.bl[0], corners.bl[1]);
    let br = toWGS84(corners.br[0], corners.br[1]);

    // Aplicar offset de calibracion manual (en metros)
    if (offset && (offset.north || offset.east)) {
      const refLat = (tl[0] + tr[0] + bl[0] + br[0]) / 4;
      const refLng = (tl[1] + tr[1] + bl[1] + br[1]) / 4;
      // Conversion metros -> grados usando aproximacion del elipsoide WGS84.
      // Mucho mas precisa que 111000 fijo, especialmente para longitud.
      const rad = Math.PI / 180;
      const latRad = refLat * rad;
      const sin2 = Math.sin(2 * latRad);
      const sin4 = Math.sin(4 * latRad);
      const mPerDegLat = 111132.92 - 559.82 * sin2 + 1.175 * sin4;
      const mPerDegLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
      const dLat = (offset.north || 0) / mPerDegLat;
      const dLng = (offset.east || 0) / mPerDegLng;
      tl = [tl[0] + dLat, tl[1] + dLng];
      tr = [tr[0] + dLat, tr[1] + dLng];
      bl = [bl[0] + dLat, bl[1] + dLng];
      br = [br[0] + dLat, br[1] + dLng];
    }

    // Detectar contenido rotado geograficamente (plano no norte-arriba):
    // el eje X de la imagen (tl->tr) debe apuntar al este. Si no, se
    // rectifica el canvas con una transformacion afin inversa.
    const refLatC = (tl[0] + tr[0] + bl[0] + br[0]) / 4;
    const refLngC = (tl[1] + tr[1] + bl[1] + br[1]) / 4;
    const mPerDegLatC = 111000;
    const mPerDegLngC = 111000 * Math.cos(refLatC * Math.PI / 180);
    const toMeters = (p) => [(p[1] - refLngC) * mPerDegLngC, (p[0] - refLatC) * mPerDegLatC];
    const gM = { tl: toMeters(tl), tr: toMeters(tr), bl: toMeters(bl), br: toMeters(br) };
    const anguloDeg = Math.atan2(gM.tr[1] - gM.tl[1], gM.tr[0] - gM.tl[0]) * 180 / Math.PI;
    let finalCanvas = canvas;
    if (Math.abs(anguloDeg) >= 0.5) {
      console.log('[createGeoOverlay] Contenido rotado ' + anguloDeg.toFixed(2) + ' grados -> rectificando a norte-arriba');
      finalCanvas = rectifyCanvasToNorthUp(canvas, gM);
    }

    const minLat = Math.min(tl[0], tr[0], bl[0], br[0]);
    const maxLat = Math.max(tl[0], tr[0], bl[0], br[0]);
    const minLng = Math.min(tl[1], tr[1], bl[1], br[1]);
    const maxLng = Math.max(tl[1], tr[1], bl[1], br[1]);

    const bounds = [[minLat, minLng], [maxLat, maxLng]];
    const dataUrl = finalCanvas.toDataURL('image/png');

    return L.imageOverlay(dataUrl, bounds, {
      opacity: 0.9,
      interactive: true,
      crossOrigin: true
    });
  }

  /**
   * Get a thumbnail data URL
   */
  async function getThumbnail(pdf) {
    const { canvas } = await renderPage(pdf, 0.5);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  /**
   * Process a PDF file - main entry point
   */
  async function processPDF(arrayBuffer) {
    console.log('[processPDF] entrada byteLength:', arrayBuffer.byteLength);

    // Validar que el buffer realmente empieza con "%PDF-" (cabecera PDF).
    // Si no, no tiene sentido seguir y el mensaje de error sera mas claro
    // que el generico "Invalid PDF structure" de PDF.js.
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, 8));
    const headerStr = String.fromCharCode(...headerBytes);
    console.log('[processPDF] header:', headerStr, '| byteLength:', arrayBuffer.byteLength);
    if (!headerStr.startsWith('%PDF-')) {
      throw new Error('El archivo no es un PDF valido (cabecera %PDF- no encontrada). byteLength=' + arrayBuffer.byteLength);
    }

    // PDF.js con web worker puede "detachear" (transferir) el ArrayBuffer que
    // se le pasa. Creamos una copia FRESCA para CADA llamada a getDocument y
    // usamos una cuarta copia solo para extraccion por regex (que no detach).
    const bufForRender = arrayBuffer.slice(0);
    const bufForGeoDetect = arrayBuffer.slice(0);
    const bufForMeta = arrayBuffer.slice(0);

    // 1. Extraccion por regex ANTES de getDocument. Strategies 1-3 son regex
    //    y nunca llaman a PDF.js, por lo que bufForMeta queda intacto.
    //    Strategy 4 (annotations) si llama a getDocument, pero recibe su propia
    //    copia fresca internamente.
    const geoData = await extractGeoData(bufForMeta);
    if (geoData) {
      console.log('[processPDF] Estrategia:', geoData.source, '| CRS detectado:', geoData.crs);
      console.log('[processPDF] Esquinas (entrada):', geoData.corners);
    } else {
      console.log('[processPDF] No se detectaron coordenadas geoespaciales.');
    }

    // 2. Render con PDF.js (su propia copia fresca).
    //    Se ajusta la rotacion de pagina (/Rotate) ANTES de renderizar para
    //    que las esquinas (espacio de display) coincidan con la imagen.
    const pdf = await loadPDF(bufForRender);
    const firstPage = await pdf.getPage(1);
    const pageRotate = normalizeRotation(firstPage.rotate);
    const adjusted = applyPageRotation(geoData, pageRotate);
    const { canvas, width, height } = await renderPage(pdf, 4, adjusted.renderRotation);

    // 3. Deteccion GeoPDF. Si requiere getDocument, recibira copia fresca y
    //    no afectara a nada mas.
    const geoPDF = await isGeoPDF(bufForGeoDetect);

    return {
      pdf,
      canvas,
      width,
      height,
      isGeoPDF: geoPDF,
      geoData: adjusted.geoData,
      renderRotation: adjusted.renderRotation
    };
  }

  return {
    loadPDF,
    renderPage,
    extractGeoData,
    extractISO32000,
    extractOGCGeoPDF,
    extractViewportBounds,
    isGeoPDF,
    createGeoOverlay,
    getThumbnail,
    processPDF,
    detectCRS,
    applyPageRotation,
    normalizeRotation
  };
})();