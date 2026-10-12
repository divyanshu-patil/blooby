import { it, vi } from 'vitest';

// no DOM here: run the hook's subscribe / unsubscribe / snapshot by hand instead of rendering
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  useSyncExternalStore: (sub: (l: () => void) => () => void, get: () => unknown, server: () => unknown) => { (globalThis as { unsub?: () => void }).unsub = sub(() => {}); server(); return get(); },
}));
import { check } from './core/testkit';
import { RELEASES, compareVersions, unseenReleases, type Release } from './whatsNew';

// every data-tour anchor the UI renders, from the source of both the studio and the web app
const sources = {
  ...import.meta.glob('./ui/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('./kit/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../apps/web/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;
const anchors = new Set(Object.values(sources).flatMap((src) => [...src.matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1])));
// the right rail's tabs are rendered from a list as `tab-${t}`
for (const src of Object.values(sources)) {
  const tabs = /\(\[([^\]]+)\] as RailTab\[\]\)/.exec(src)?.[1];
  if (tabs && src.includes('data-tour={`tab-${t}`}')) for (const m of tabs.matchAll(/'([^']+)'/g)) anchors.add(`tab-${m[1]}`);
}

it('the anchors were found at all', check(anchors.has('stage') && anchors.has('/projects'), [...anchors].join()));

const versions = RELEASES.map((r) => r.version);
it('releases are newest first', check(versions.every((v, i) => i === 0 || compareVersions(versions[i - 1], v) > 0), versions.join()));
it('versions look like YYYY.MM.DD', check(versions.every((v) => /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(v))));
const ids = RELEASES.flatMap((r) => r.items.map((i) => i.id));
it('every item id is unique', check(new Set(ids).size === ids.length));
it('every release has something to say', check(RELEASES.every((r) => r.items.length && r.items.every((i) => i.title && i.body.length > 20))));

const missing = RELEASES.flatMap((r) => r.items.flatMap((i) => (i.tour ?? []).map((s) => String(s.element ?? '')).filter(Boolean)
  .map((sel) => /\[data-tour="([^"]+)"\]/.exec(sel)?.[1] ?? sel).filter((a) => !anchors.has(a)).map((a) => `${i.id}: ${a}`)));
it('every tour step points at an anchor the UI actually renders', check(missing.length === 0, missing.join('; ')));

// what someone is shown
const fake: Release[] = [
  { version: '2026.10.02', date: '', title: 'c', items: [] },
  { version: '2026.10.01.2', date: '', title: 'b', items: [] },
  { version: '2026.10.01', date: '', title: 'a', items: [] },
];
it('everything newer than what was last seen, newest first', check(unseenReleases('2026.10.01', fake).map((r) => r.title).join() === 'c,b'));
it('nothing when the newest has been seen', check(unseenReleases('2026.10.02', fake).length === 0));
it('someone who has never looked sees only the latest', check(unseenReleases(null, fake).map((r) => r.title).join() === 'c'));
it('a same-day second release sorts after the first', check(compareVersions('2026.10.01.2', '2026.10.01') > 0 && compareVersions('2026.09.30', '2026.10.01') < 0));

// --- "seen": kept in storage, or in the signed-in profile -----------------------------------
{
  const { configureWhatsNew, markWhatsNewSeen, useWhatsNewSeen: readSeen } = await import('./whatsNew');
  markWhatsNewSeen('1999.01.01');                      // the default save: no storage here, swallowed
  await Promise.resolve(); await Promise.resolve();
  const saved: string[] = [];
  configureWhatsNew({ seen: null, save: (v) => { saved.push(v); } });
  readSeen();                                          // subscribes, so the next change notifies it
  markWhatsNewSeen('2020.01.01');
  (globalThis as { unsub?: () => void }).unsub!();
  markWhatsNewSeen('2019.01.01');                      // never moves backwards
  markWhatsNewSeen('2020.01.01.1');                    // a second release the same day does
  markWhatsNewSeen();                                  // the latest
  await Promise.resolve(); await Promise.resolve();
  it('only forward moves are saved', check(saved.join() === `2020.01.01,2020.01.01.1,${(await import('./whatsNew')).LATEST_RELEASE}`, saved.join()));
  configureWhatsNew({ seen: '2999.01.01', save: () => { throw new Error('offline'); } });
  markWhatsNewSeen();                                  // older than seen: nothing to save
  configureWhatsNew({ seen: null, save: () => { throw new Error('offline'); } });
  markWhatsNewSeen();                                  // a failing save is swallowed
  await Promise.resolve(); await Promise.resolve();
  it('compareVersions pads a short version with zeros', check(compareVersions('2020.01', '2020.01.0') === 0 && compareVersions('2020.01.1', '2020.01') > 0));
  it('the hook reads the current value', check(readSeen() === RELEASES[0].version));
}
