import { expect, it, vi } from 'vitest';
import { defaultProject } from './defaults';

/**
 * The store reads localStorage and the catalogue once, as the module loads, and writes both
 * from a timer — none of which node has. A fresh copy of the module per scenario, with a
 * small stand-in for what the browser offers (see gallery.test.ts for the same trick).
 */
const g = globalThis as Record<string, any>;

function fakeStorage(seed: Record<string, string> = {}) {
  const rows = new Map(Object.entries(seed));
  return { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v); }, rows };
}

async function boot(opts: { storage?: ReturnType<typeof fakeStorage>; fetchCatalog?: () => Promise<unknown> } = {}) {
  vi.resetModules();
  delete g.indexedDB;
  g.localStorage = opts.storage ?? fakeStorage(); // never removed: an earlier scenario's save timer may still fire
  vi.doMock('./catalog', () => ({ fetchCatalog: opts.fetchCatalog ?? (async () => ({ presets: [], expressions: [] })) }));
  return import('./store');
}

it('a project saved last time is the one that opens, and the open gallery entry is kept', async () => {
  const saved = { ...defaultProject(), name: 'From last time' };
  const storage = fakeStorage({ 'blooby.gallery.active': 'g_kept', 'blooby.project.v1': JSON.stringify(saved) });
  const { useEditor } = await boot({ storage });
  expect(useEditor.getState().project.name).toBe('From last time');
  expect(storage.rows.get('blooby.gallery.active')).toBe('g_kept');
});

it('no saved project and no open entry: a fresh mascot, and an entry is opened', async () => {
  const storage = fakeStorage();
  const { useEditor } = await boot({ storage });
  expect(useEditor.getState().project.rig.nodes.body).toBeDefined();
  expect(storage.rows.get('blooby.gallery.active')).toMatch(/^g_/);
});

it('a project from a newer build opens with a warning, an older one with a note', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const future = { ...defaultProject(), schemaVersion: 9999 };
  const { useEditor } = await boot({ storage: fakeStorage({ 'blooby.project.v1': JSON.stringify(future) }) });
  expect(warn).toHaveBeenCalled();
  const old = { ...defaultProject(), schemaVersion: 1 };
  useEditor.getState().loadProject(old as never);
  expect(info).toHaveBeenCalled();
  warn.mockRestore(); info.mockRestore();
});

it('an edit is saved after a pause, and survives there being no IndexedDB', async () => {
  const storage = fakeStorage({ 'blooby.gallery.active': 'g_open' });
  const { useEditor } = await boot({ storage });
  useEditor.getState().commit((p) => { p.name = 'edited'; });
  // real time: an earlier scenario's own save may still land first, ours is the last to
  await expect.poll(() => JSON.parse(storage.rows.get('blooby.project.v1') ?? '{}').name, { timeout: 3000 }).toBe('edited');
});

it('the catalogue loads, and says why when it does not', async () => {
  const ok = await boot({ fetchCatalog: async () => ({ presets: [{ id: 'p' }], expressions: [] }) });
  await ok.useEditor.getState().loadCatalog();
  expect(ok.useEditor.getState().catalog).toHaveLength(1);
  const bad = await boot({ fetchCatalog: async () => { throw new Error('offline'); } });
  await bad.useEditor.getState().loadCatalog();
  expect(bad.useEditor.getState().catalogError).toBe('offline');
  const odd = await boot({ fetchCatalog: async () => { throw 'plain string'; } });
  await odd.useEditor.getState().loadCatalog();
  expect(odd.useEditor.getState().catalogError).toBe('plain string');
});

it('a font arriving bumps the version the panels watch', async () => {
  const { useEditor } = await boot();
  const fonts = await import('./fonts');
  const before = useEditor.getState().fontsVersion;
  fonts.registerFont({ family: 'Probe', weight: 400, style: 'normal' } as never, {} as never);
  expect(useEditor.getState().fontsVersion).toBe(before + 1);
});
