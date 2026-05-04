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

    // GPTS is always lat/lon (EPSG:4326) per ISO 32000-2 spec
    return {
      corners: {
        tl: [tl.lon, tl.lat],
        tr: [tr.lon, tr.lat],
        bl: [bl.lon, bl.lat],
        br: [br.lon, br.lat]
      },
      crs: 'EPSG:4326',
      source: 'ISO-32000-2 (GeoPDF)'
    };
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

    // Get page dimensions from PDF
    const mediaBoxMatch = text.match(/\/MediaBox\s*\[\s*([^\]]+)\]/);
    let pageWidth = 612, pageHeight = 792; // Default US Letter
    if (mediaBoxMatch) {
      const mb = mediaBoxMatch[1].trim().split(/\s+/).map(Number);
      if (mb.length >= 4) {
        pageWidth = mb[2] - mb[0];
        pageHeight = mb[3] - mb[1];
      }
    }

    // Calculate corner world coordinates from CTM
    // PDF coordinates: origin at bottom-left
    // (0, 0) = bottom-left, (pageWidth, pageHeight) = top-right
    const blWorld = { x: a * 0 + c * 0 + e, y: b * 0 + d * 0 + f };
    const brWorld = { x: a * pageWidth + c * 0 + e, y: b * pageWidth + d * 0 + f };
    const tlWorld = { x: a * 0 + c * pageHeight + e, y: b * 0 + d * pageHeight + f };
    const trWorld = { x: a * pageWidth + c * pageHeight + e, y: b * pageWidth + d * pageHeight + f };

    // Determine CRS from the LGIDict
    const crs = detectCRS(text) || 'EPSG:4326';

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

        const crs = detectCRS(text) || 'EPSG:4326';

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
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
   * Load a PDF from ArrayBuffer
   */
  async function loadPDF(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js no esta disponible');
    }
    return await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  }

  /**
   * Render first page of PDF to canvas
   */
  async function renderPage(pdf, scale = 2) {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: scale });

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
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
   * Create a georeferenced image overlay for Leaflet
   * @param {HTMLCanvasElement} canvas - Rendered PDF page
   * @param {object} corners - { tl: [e,n], tr: [e,n], bl: [e,n], br: [e,n] }
   * @param {string} crs - Input CRS
   */
  function createGeoOverlay(canvas, corners, crs) {
    // Convert corners to WGS84 (Leaflet's native CRS)
    const toWGS84 = (e, n) => {
      if (crs === 'EPSG:4326') {
        return [n, e]; // lat, lng (input is [lon, lat])
      }
      // Convert from input CRS to WGS84
      const [lng, lat] = proj4(crs, 'EPSG:4326', [e, n]);
      return [lat, lng];
    };

    const tl = toWGS84(corners.tl[0], corners.tl[1]);
    const tr = toWGS84(corners.tr[0], corners.tr[1]);
    const bl = toWGS84(corners.bl[0], corners.bl[1]);
    const br = toWGS84(corners.br[0], corners.br[1]);

    const minLat = Math.min(tl[0], tr[0], bl[0], br[0]);
    const maxLat = Math.max(tl[0], tr[0], bl[0], br[0]);
    const minLng = Math.min(tl[1], tr[1], bl[1], br[1]);
    const maxLng = Math.max(tl[1], tr[1], bl[1], br[1]);

    const bounds = [[minLat, minLng], [maxLat, maxLng]];
    const dataUrl = canvas.toDataURL('image/png');

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
    // PDF.js con web worker puede "detachear" (transferir) el ArrayBuffer,
    // dejandolo vacio en el hilo principal. Usamos una copia para PDF.js
    // y conservamos el original para metadata y guardado.
    const arrayBufferForPDF = arrayBuffer.slice(0);
    const arrayBufferForMeta = arrayBuffer.slice(0);

    const pdf = await loadPDF(arrayBufferForPDF);
    const { canvas, width, height } = await renderPage(pdf, 2);
    const geoPDF = await isGeoPDF(arrayBufferForMeta);

    // Try to extract geo data
    const geoData = await extractGeoData(arrayBufferForMeta);

    return {
      pdf,
      canvas,
      width,
      height,
      isGeoPDF: geoPDF,
      geoData: geoData
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
    detectCRS
  };
})();