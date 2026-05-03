/**
 * pdf-processor.js - PDF Map Processor for MAPS GIS
 *
 * Handles PDF rendering, GeoPDF metadata extraction,
 * and georeferenced image overlay creation for Leaflet.
 */

const PDFProcessor = (() => {
  // Set PDF.js worker source
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }

  /**
   * Load a PDF from ArrayBuffer
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<PDFDocumentProxy>}
   */
  async function loadPDF(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js no esta disponible');
    }
    return await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  }

  /**
   * Render first page of PDF to canvas
   * @param {PDFDocumentProxy} pdf
   * @param {number} scale - Render scale (1 = 72dpi, 2 = 144dpi, etc.)
   * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number}>}
   */
  async function renderPage(pdf, scale = 2) {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    return {
      canvas: canvas,
      width: viewport.width,
      height: viewport.height
    };
  }

  /**
   * Try to extract GeoPDF metadata from the PDF
   * @param {PDFDocumentProxy} pdf
   * @returns {Promise<object|null>} GeoPDF corner coords or null
   */
  async function extractGeoPDFMetadata(pdf) {
    try {
      const metadata = await pdf.getMetadata();

      // Check for GeoPDF GPTS (Ground Control Points) in the PDF
      // GeoPDF stores coordinates in the PDF's coordinate system
      // We look for common GeoPDF metadata patterns

      if (metadata && metadata.info) {
        const info = metadata.info;

        // Check for common GeoPDF indicators
        const producer = info.Producer || info.producer || '';
        const creator = info.Creator || info.creator || '';

        // TerraGo, GeoPDF, or other GeoPDF producers
        if (producer.includes('TerraGo') || producer.includes('GeoPDF') ||
            creator.includes('GeoPDF') || producer.includes('LizardTech')) {

          // Try to get the PDF's coordinate system info
          // This is a simplified extraction - full GeoPDF parsing is complex
          console.log('GeoPDF detectado:', producer);

          // Attempt to extract from the first page's content
          const page = await pdf.getPage(1);
          const ops = await page.getOperatorList();

          // Look for transformation matrices that might indicate georeferencing
          // This is a best-effort approach
          return null; // Full GeoPDF parsing requires more complex logic
        }
      }

      // Also check for embedded GeoTIFF or similar
      if (metadata && metadata.contentDispositionFilename) {
        console.log('PDF filename:', metadata.contentDispositionFilename);
      }

      return null;
    } catch (e) {
      console.log('No se pudo extraer metadata GeoPDF:', e);
      return null;
    }
  }

  /**
   * Check if a PDF might be a GeoPDF
   * @param {PDFDocumentProxy} pdf
   * @returns {Promise<boolean>}
   */
  async function isGeoPDF(pdf) {
    try {
      const metadata = await pdf.getMetadata();
      if (metadata && metadata.info) {
        const producer = (metadata.info.Producer || metadata.info.producer || '').toLowerCase();
        const creator = (metadata.info.Creator || metadata.info.creator || '').toLowerCase();
        return producer.includes('geopdf') || producer.includes('terrago') ||
               producer.includes('lizardtech') || creator.includes('geopdf');
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Create a georeferenced image overlay for Leaflet
   * @param {HTMLCanvasElement} canvas - Rendered PDF page
   * @param {object} corners - { tl: [e,n], tr: [e,n], bl: [e,n], br: [e,n] } in UTM
   * @param {string} crs - Input CRS (EPSG:24877 or EPSG:4326)
   * @returns {L.ImageOverlay} Leaflet image overlay
   */
  function createGeoOverlay(canvas, corners, crs) {
    // Convert corners to WGS84 (Leaflet's native CRS)
    const toWGS84 = (e, n) => {
      if (crs === 'EPSG:4326') {
        return [n, e]; // lat, lng
      }
      // Convert from input CRS to WGS84
      const [lng, lat] = proj4(crs, 'EPSG:4326', [e, n]);
      return [lat, lng];
    };

    const tl = toWGS84(corners.tl[0], corners.tl[1]);
    const tr = toWGS84(corners.tr[0], corners.tr[1]);
    const bl = toWGS84(corners.bl[0], corners.bl[1]);
    const br = toWGS84(corners.br[0], corners.br[1]);

    // Create bounds for Leaflet (southwest, northeast)
    const minLat = Math.min(tl[0], tr[0], bl[0], br[0]);
    const maxLat = Math.max(tl[0], tr[0], bl[0], br[0]);
    const minLng = Math.min(tl[1], tr[1], bl[1], br[1]);
    const maxLng = Math.max(tl[1], tr[1], bl[1], br[1]);

    const bounds = [[minLat, minLng], [maxLat, maxLng]];

    // Convert canvas to data URL
    const dataUrl = canvas.toDataURL('image/png');

    return L.imageOverlay(dataUrl, bounds, {
      opacity: 0.9,
      interactive: true,
      crossOrigin: true
    });
  }

  /**
   * Get a thumbnail data URL for the PDF (for map list display)
   * @param {PDFDocumentProxy} pdf
   * @returns {Promise<string>} Data URL
   */
  async function getThumbnail(pdf) {
    const { canvas } = await renderPage(pdf, 0.5);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  /**
   * Process a PDF file for loading
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<{pdf: PDFDocumentProxy, canvas: HTMLCanvasElement, width: number, height: number, isGeoPDF: boolean}>}
   */
  async function processPDF(arrayBuffer) {
    const pdf = await loadPDF(arrayBuffer);
    const { canvas, width, height } = await renderPage(pdf, 2);
    const geoPDF = await isGeoPDF(pdf);

    return {
      pdf: pdf,
      canvas: canvas,
      width: width,
      height: height,
      isGeoPDF: geoPDF
    };
  }

  return {
    loadPDF,
    renderPage,
    extractGeoPDFMetadata,
    isGeoPDF,
    createGeoOverlay,
    getThumbnail,
    processPDF
  };
})();
