import { it } from 'vitest';
import { check } from '../core/testkit';
import { acceptsKeys, displayModel, DEFAULT_SETTINGS, loadSettings, maskKey, rotation, saveSettings, type CopilotSettings, type PoolKey } from './pool';

const g = globalThis as unknown as { localStorage?: unknown };
const store = new Map<string, string>();
const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };

{
  const S = (o: Partial<CopilotSettings>): CopilotSettings => ({ ...DEFAULT_SETTINGS, ...o });
  const key = (id: string, status: PoolKey['status'], usedAt?: number): PoolKey => ({ id, value: id, status, usedAt });

  // settings round-trip through storage, minus the server's answer
  g.localStorage = fake;
  const empty = loadSettings();
  saveSettings(S({ model: 'm', server: { allowUserKeys: true, hasServerKeys: true } }));
  const back = loadSettings();
  g.localStorage = { getItem: () => '{bad', setItem: () => { throw new Error('private'); } };
  const corrupt = loadSettings();
  saveSettings(S({}));                                  // a throwing setItem is swallowed
  delete g.localStorage;
  it('nothing stored gives the defaults', check(empty === DEFAULT_SETTINGS));
  it('stored settings come back without `server`', check(back.model === 'm' && back.server === undefined));
  it('corrupt storage gives the defaults', check(corrupt === DEFAULT_SETTINGS));

  it('custom and open cloud accept keys; local and locked cloud do not', check(
    acceptsKeys(S({ endpoint: 'custom' })) && acceptsKeys(S({})) && !acceptsKeys(S({ endpoint: 'local' }))
    && !acceptsKeys(S({ server: { allowUserKeys: false, hasServerKeys: true } }))));

  // rotation: no key needed, none held, then healthiest first and least recently used first
  it('no key needed gives [null]', check(rotation(S({ endpoint: 'local' }))[0] === null));
  it('a key needed but none held gives [null]', check(rotation(S({ endpoint: 'custom' }))[0] === null));
  const order = rotation(S({ endpoint: 'custom', keys: [key('err', 'error'), key('late', 'ok', 9), key('rl', 'rate-limited'), key('new', 'ok'), key('early', 'ok', 1)] }));
  it('healthy first, then by last use', check(order.join() === 'new,early,late,rl,err', order.join()));

  it('displayModel drops the proxy marker', check(displayModel('glm-5.2:cloud') === 'glm-5.2'));
  it('short keys are fully masked, long ones keep the ends', check(maskKey('abc') === '••••' && maskKey('abcdefghijkl') === 'abcd…ijkl'));
}
