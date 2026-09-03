/**
 * storage.js - IndexedDB Manager for MAPS GIS
 *
 * Handles CRUD operations for storing GeoTIFF and PDF map files
 * in the browser's IndexedDB for offline persistence.
 * v3.0 - Added photo storage support
 */

const MapStorage = (() => {
  const DB_NAME = 'MapsGISDB';
  const DB_VERSION = 4;
  const STORE_MAPS = 'maps';
  const STORE_PHOTOS = 'photos';
  const STORE_TRACKS = 'tracks';

  let db = null;

  /**
   * Initialize the IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  function initDB() {
    return new Promise((resolve, reject) => {
      if (db) {
        resolve(db);
        return;
      }

      if (!window.indexedDB) {
        reject(new Error('IndexedDB no disponible. Es posible que estes en modo privado/incognito. Usa el modo normal del navegador.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        // Maps store
        if (!database.objectStoreNames.contains(STORE_MAPS)) {
          const store = database.createObjectStore(STORE_MAPS, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        } else {
          // Migration: add type index if missing
          const transaction = event.target.transaction;
          const store = transaction.objectStore(STORE_MAPS);
          if (!store.indexNames.contains('type')) {
            store.createIndex('type', 'type', { unique: false });
          }
        }

        // Photos store (new in v3)
        if (!database.objectStoreNames.contains(STORE_PHOTOS)) {
          const photoStore = database.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
          photoStore.createIndex('markerId', 'markerId', { unique: false });
          photoStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Tracks store (new in v4)
        if (!database.objectStoreNames.contains(STORE_TRACKS)) {
          const trackStore = database.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
          trackStore.createIndex('createdAt', 'createdAt', { unique: false });
          trackStore.createIndex('name', 'name', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = (event) => {
        reject(new Error('Error al abrir IndexedDB: ' + event.target.error));
      };
    });
  }

  // ============================================
  // MAP OPERATIONS
  // ============================================

  async function saveMap(name, arrayBuffer, size) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_MAPS], 'readwrite');
      const store = transaction.objectStore(STORE_MAPS);

      const record = {
        id: 'map_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name,
        data: arrayBuffer,
        size: size,
        type: 'tiff',
        createdAt: new Date().toISOString()
      };

      const request = store.add(record);

      request.onsuccess = () => {};
      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al guardar el mapa'));
      };

      transaction.oncomplete = () => resolve(record);
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en la transaccion de guardado'));
      };
      transaction.onabort = (e) => {
        const err = transaction.error || new Error('Transaccion abortada. Posiblemente almacenamiento lleno.');
        reject(err);
      };
    });
  }

  async function savePDFMap(name, arrayBuffer, size, georef, thumbnail) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_MAPS], 'readwrite');
      const store = transaction.objectStore(STORE_MAPS);

      const record = {
        id: 'map_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name,
        data: arrayBuffer,
        size: size,
        type: 'pdf',
        georef: georef,
        thumbnail: thumbnail || null,
        createdAt: new Date().toISOString()
      };

      const request = store.add(record);

      request.onsuccess = () => {};
      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al guardar el mapa PDF'));
      };

      transaction.oncomplete = () => resolve(record);
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en la transaccion de guardado PDF'));
      };
      transaction.onabort = (e) => {
        const err = transaction.error || new Error('Transaccion abortada. Posiblemente almacenamiento lleno.');
        reject(err);
      };
    });
  }

  async function getAllMaps() {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_MAPS], 'readonly');
      const store = transaction.objectStore(STORE_MAPS);
      const request = store.getAll();

      let mapsResult = [];

      request.onsuccess = () => {
        mapsResult = request.result.map(map => ({
          id: map.id,
          name: map.name,
          size: map.size,
          type: map.type || 'tiff',
          thumbnail: map.thumbnail || null,
          createdAt: map.createdAt
        }));
      };

      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al obtener los mapas'));
      };

      transaction.oncomplete = () => {
        mapsResult.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        resolve(mapsResult);
      };
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de lectura'));
      };
    });
  }

  async function getMapRecord(id) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_MAPS], 'readonly');
      const store = transaction.objectStore(STORE_MAPS);
      const request = store.get(id);

      let result = null;

      request.onsuccess = () => {
        result = request.result;
      };

      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al obtener el mapa'));
      };

      transaction.oncomplete = () => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Mapa no encontrado'));
        }
      };
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de lectura'));
      };
    });
  }

  async function getMapData(id) {
    const record = await getMapRecord(id);
    return record.data;
  }

  async function deleteMap(id) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_MAPS], 'readwrite');
      const store = transaction.objectStore(STORE_MAPS);
      const request = store.delete(id);

      request.onsuccess = () => {};
      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al eliminar el mapa'));
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de eliminacion'));
      };
      transaction.onabort = () => {
        reject(new Error('Transaccion de eliminacion abortada'));
      };
    });
  }

  async function getTotalStorage() {
    const maps = await getAllMaps();
    return maps.reduce((total, map) => total + map.size, 0);
  }

  // ============================================
  // PHOTO OPERATIONS
  // ============================================

  async function savePhoto(blob, markerId, originalBlob) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_PHOTOS], 'readwrite');
      const store = transaction.objectStore(STORE_PHOTOS);

      const photoId = 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const record = {
        id: photoId,
        markerId: markerId || null,
        blob: blob,
        originalBlob: originalBlob || null,
        createdAt: new Date().toISOString()
      };

      const request = store.add(record);

      request.onsuccess = () => {};
      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al guardar la foto'));
      };

      transaction.oncomplete = () => resolve(photoId);
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de foto'));
      };
      transaction.onabort = (e) => {
        const err = transaction.error || new Error('Transaccion de foto abortada. Posiblemente almacenamiento lleno.');
        reject(err);
      };
    });
  }

  async function getPhoto(photoId) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_PHOTOS], 'readonly');
      const store = transaction.objectStore(STORE_PHOTOS);
      const request = store.get(photoId);

      let result = null;

      request.onsuccess = () => {
        result = request.result;
      };

      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al obtener la foto'));
      };

      transaction.oncomplete = () => {
        if (result) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de lectura de foto'));
      };
    });
  }

  async function getPhotoOriginal(photoId) {
    const record = await getPhoto(photoId);
    return record && record.originalBlob ? record.originalBlob : null;
  }

  /**
   * Reemplaza solo el blob procesado/estampado de una foto existente,
   * conservando id, markerId, originalBlob (foto cruda) y createdAt.
   * Se usa al reeditar un marcador LSM para re-estampar desde la foto cruda.
   */
  async function updatePhotoBlob(photoId, newBlob) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_PHOTOS], 'readwrite');
      const store = transaction.objectStore(STORE_PHOTOS);
      const getRequest = store.get(photoId);

      let found = false;

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) return;
        found = true;
        record.blob = newBlob;
        record.updatedAt = new Date().toISOString();
        store.put(record);
      };

      getRequest.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al leer la foto para actualizar'));
      };

      transaction.oncomplete = () => {
        if (found) {
          resolve(photoId);
        } else {
          reject(new Error('Foto no encontrada: ' + photoId));
        }
      };
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de actualizacion de foto'));
      };
    });
  }

  async function getPhotosByMarker(markerId) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_PHOTOS], 'readonly');
      const store = transaction.objectStore(STORE_PHOTOS);
      const index = store.index('markerId');
      const request = index.getAll(markerId);

      let result = [];

      request.onsuccess = () => {
        result = request.result || [];
      };

      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al obtener fotos del marcador'));
      };

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de lectura de fotos'));
      };
    });
  }

  async function deletePhoto(photoId) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_PHOTOS], 'readwrite');
      const store = transaction.objectStore(STORE_PHOTOS);
      const request = store.delete(photoId);

      request.onsuccess = () => {};
      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al eliminar la foto'));
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de eliminacion de foto'));
      };
    });
  }

  async function deletePhotosByMarker(markerId) {
    const photos = await getPhotosByMarker(markerId);
    for (const photo of photos) {
      await deletePhoto(photo.id);
    }
  }

  // ============================================
  // TRACK OPERATIONS
  // ============================================

  async function saveTrack(record) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_TRACKS], 'readwrite');
      const store = transaction.objectStore(STORE_TRACKS);

      const request = store.put(record);

      request.onsuccess = () => {};
      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al guardar el recorrido'));
      };

      transaction.oncomplete = () => resolve(record);
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de recorrido'));
      };
      transaction.onabort = (e) => {
        const err = transaction.error || new Error('Transaccion de recorrido abortada. Posiblemente almacenamiento lleno.');
        reject(err);
      };
    });
  }

  async function getAllTracks() {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_TRACKS], 'readonly');
      const store = transaction.objectStore(STORE_TRACKS);
      const request = store.getAll();

      let result = [];

      request.onsuccess = () => {
        result = request.result || [];
      };

      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al obtener recorridos'));
      };

      transaction.oncomplete = () => {
        result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        resolve(result);
      };
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de lectura de recorridos'));
      };
    });
  }

  async function getTrack(id) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_TRACKS], 'readonly');
      const store = transaction.objectStore(STORE_TRACKS);
      const request = store.get(id);

      let result = null;

      request.onsuccess = () => {
        result = request.result;
      };

      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al obtener el recorrido'));
      };

      transaction.oncomplete = () => {
        resolve(result);
      };
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de lectura de recorrido'));
      };
    });
  }

  async function deleteTrack(id) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_TRACKS], 'readwrite');
      const store = transaction.objectStore(STORE_TRACKS);
      const request = store.delete(id);

      request.onsuccess = () => {};
      request.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error al eliminar el recorrido'));
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => {
        e.preventDefault();
        reject(new Error('Error en transaccion de eliminacion de recorrido'));
      };
      transaction.onabort = () => {
        reject(new Error('Transaccion de eliminacion de recorrido abortada'));
      };
    });
  }

  // ============================================
  // UTILS
  // ============================================

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  return {
    initDB,
    saveMap,
    savePDFMap,
    getAllMaps,
    getMapRecord,
    getMapData,
    deleteMap,
    getTotalStorage,
    formatBytes,
    // Photos
    savePhoto,
    getPhoto,
    getPhotoOriginal,
    updatePhotoBlob,
    getPhotosByMarker,
    deletePhoto,
    deletePhotosByMarker,
    // Tracks
    saveTrack,
    getAllTracks,
    getTrack,
    deleteTrack
  };
})();
