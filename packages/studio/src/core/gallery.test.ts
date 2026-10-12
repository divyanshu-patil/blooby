import { it, vi } from 'vitest';
import { check } from './testkit';
import type { GalleryEntry } from './gallery';
import { defaultProject } from './defaults';

/**
 * The gallery is IndexedDB + localStorage, neither of which node has: a small in-memory
 * stand-in for each, and a fresh copy of the module per scenario because it reads what the
 * environment offers once, at import.
 */
const g = globalThis as Record<string, any>;
const fresh = async () => { vi.resetModules(); return await import('./gallery'); };
const entry = (id: string, updatedAt: number): GalleryEntry => ({ id, name: id, updatedAt, project: defaultProject() });
const later = (fn: () => void) => queueMicrotask(fn);

/** failOpen: opening the database errors; failRequests: every request errors. */
function fakeIndexedDb(opts: { failOpen?: boolean; failRequests?: boolean } = {}) {
  const rows = new Map<string, GalleryEntry>();
  let created = 0, opened = 0;
  const request = (result: unknown) => {
    const req: Record<string, any> = {};
    later(() => { if (opts.failRequests) { req.error = new Error('request failed'); req.onerror(); } else { req.result = result; req.onsuccess(); } });
    return req;
  };
  const store = {
    getAll: () => request([...rows.values()]),
    get: (id: string) => request(rows.get(id)),
    put: (e: GalleryEntry) => { rows.set(e.id, e); return request(e.id); },
    delete: (id: string) => { rows.delete(id); return request(undefined); },
  };
  const db = { createObjectStore: () => { created++; }, transaction: () => ({ objectStore: () => store }) };
  g.indexedDB = {
    open: () => {
      opened++;
      const req: Record<string, any> = { result: db };
      later(() => { if (opts.failOpen) { req.error = new Error('open failed'); req.onerror(); } else { req.onupgradeneeded(); req.onsuccess(); } });
      return req;
    },
  };
  return { rows, stats: () => ({ created, opened }) };
}

// --- no indexedDB, no localStorage (the node harness) ----------------------------------------
{
  delete g.indexedDB; delete g.localStorage;
  const G = await fresh();
  it('without indexedDB every read rejects', check(await G.listEntries().then(() => false, (e: Error) => /unavailable/.test(e.message))));
  it('without localStorage there is no active id and setting one does nothing', check(G.getActiveId() === null && G.setActiveId('x') === undefined));
}

// --- both present ------------------------------------------------------------------------------
{
  const db = fakeIndexedDb();
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const G = await fresh();
  await G.putEntry(entry('a', 1));
  await G.putEntry(entry('b', 5));
  it('the database is opened and created once, however many calls', check(db.stats().opened === 1 && db.stats().created === 1));
  it('entries list newest first', check((await G.listEntries()).map((e) => e.id).join() === 'b,a'));
  it('one is fetched by id', check((await G.getEntry('a'))?.id === 'a' && (await G.getEntry('zzz')) === undefined));
  await G.deleteEntry('b');
  it('and deleted', check((await G.listEntries()).map((e) => e.id).join() === 'a' && db.rows.size === 1));
  G.setActiveId('a');
  it('the active id is remembered', check(G.getActiveId() === 'a' && /^g_/.test(G.uidGallery())));
  g.localStorage.setItem = () => { throw new Error('private mode'); };
  it('and a private-mode write is swallowed', check(G.setActiveId('b') === undefined && G.getActiveId() === 'a'));
}

// --- failures ----------------------------------------------------------------------------------
{
  fakeIndexedDb({ failOpen: true });
  const G = await fresh();
  it('a database that will not open rejects with its error', check(await G.listEntries().then(() => false, (e: Error) => e.message === 'open failed')));
}
{
  fakeIndexedDb({ failRequests: true });
  const G = await fresh();
  it('a request that fails rejects with its error', check(await G.getEntry('a').then(() => false, (e: Error) => e.message === 'request failed')));
}

delete g.indexedDB; delete g.localStorage;
