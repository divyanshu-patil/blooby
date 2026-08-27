import type { Project } from './types';

/**
 * The project gallery: every mascot you've built, as independent saved documents.
 * "New clip" never touches the one you're working on — it creates a fresh entry and
 * switches to it, so nothing is ever lost by starting something new.
 *
 * IndexedDB, not localStorage: a handful of full projects (each with keyframes and
 * possibly base64 thumbnails) clears localStorage's ~5MB ceiling easily.
 */

export interface GalleryEntry {
  id: string;
  name: string;
  updatedAt: number;
  project: Project;
}

const DB_NAME = 'blooby-gallery';
const STORE = 'projects';
const ACTIVE_KEY = 'blooby.gallery.active';

// guarded for the node-based selfcheck harness, which has neither indexedDB nor
// localStorage — the store still needs to construct and commit there, just without
// gallery persistence (autosave's .catch already swallows the rejection this produces).
const hasIndexedDb = typeof indexedDB !== 'undefined';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb) return Promise.reject(new Error('indexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const listEntries = (): Promise<GalleryEntry[]> =>
  tx('readonly', (s) => s.getAll()).then((rows) => rows.sort((a, b) => b.updatedAt - a.updatedAt));

export const getEntry = (id: string): Promise<GalleryEntry | undefined> => tx('readonly', (s) => s.get(id));

export const putEntry = (entry: GalleryEntry): Promise<IDBValidKey> => tx('readwrite', (s) => s.put(entry));

export const deleteEntry = (id: string): Promise<undefined> => tx('readwrite', (s) => s.delete(id));

// guarded for the node-based selfcheck harness, which has neither localStorage nor
// indexedDB — the store still needs to construct there, just without persistence.
const hasStorage = typeof localStorage !== 'undefined';
export const getActiveId = (): string | null => (hasStorage ? localStorage.getItem(ACTIVE_KEY) : null);
export const setActiveId = (id: string) => {
  if (!hasStorage) return;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
};

export const uidGallery = () => `g_${Math.random().toString(36).slice(2, 10)}`;
