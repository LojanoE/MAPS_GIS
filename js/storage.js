/**
 * storage.js - IndexedDB Manager for GeoTIFF files
 *
 * Handles CRUD operations for storing large GeoTIFF files
 * in the browser's IndexedDB for offline persistence.
 */

const MapStorage = (() => {
  const DB_NAME = 'MapsGISDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'maps';

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

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
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

  /**
   * Save a GeoTIFF file to IndexedDB
   * @param {string} name - Display name of the map
   * @param {ArrayBuffer} arrayBuffer - Raw GeoTIFF data
   * @param {number} size - File size in bytes
   * @returns {Promise<object>} Saved map record
   */
  async function saveMap(name, arrayBuffer, size) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const record = {
        id: 'map_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name,
        data: arrayBuffer,
        size: size,
        createdAt: new Date().toISOString()
      };

      const request = store.add(record);

      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(new Error('Error al guardar el mapa'));
    });
  }

  /**
   * Get all saved maps (metadata only, no data)
   * @returns {Promise<Array<object>>} List of map records
   */
  async function getAllMaps() {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const maps = request.result.map(map => ({
          id: map.id,
          name: map.name,
          size: map.size,
          createdAt: map.createdAt
        }));
        maps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        resolve(maps);
      };

      request.onerror = () => reject(new Error('Error al obtener los mapas'));
    });
  }

  /**
   * Get a single map's raw data by ID
   * @param {string} id - Map record ID
   * @returns {Promise<ArrayBuffer>} Raw GeoTIFF ArrayBuffer
   */
  async function getMapData(id) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.data);
        } else {
          reject(new Error('Mapa no encontrado'));
        }
      };

      request.onerror = () => reject(new Error('Error al obtener el mapa'));
    });
  }

  /**
   * Delete a map from IndexedDB
   * @param {string} id - Map record ID
   * @returns {Promise<void>}
   */
  async function deleteMap(id) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Error al eliminar el mapa'));
    });
  }

  /**
   * Get total storage used by all maps
   * @returns {Promise<number>} Total size in bytes
   */
  async function getTotalStorage() {
    const maps = await getAllMaps();
    return maps.reduce((total, map) => total + map.size, 0);
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes
   * @returns {string}
   */
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
    getAllMaps,
    getMapData,
    deleteMap,
    getTotalStorage,
    formatBytes
  };
})();
