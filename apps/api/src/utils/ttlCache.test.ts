import { describe, expect, it } from 'vitest';
import { ttlCache } from './ttlCache.js';

describe('ttlCache', () => {
  it('loads once and serves the cached value', async () => {
    let calls = 0;
    const get = ttlCache(10_000, async (k) => { calls++; return `v:${k}`; });
    expect(await get('a')).toBe('v:a');
    expect(await get('a')).toBe('v:a');
    expect(calls).toBe(1);
  });

  it('coalesces concurrent loads of the same key into one round trip', async () => {
    let calls = 0;
    const get = ttlCache(10_000, async (k) => { calls++; await new Promise((r) => setTimeout(r, 5)); return k; });
    await Promise.all(Array.from({ length: 20 }, () => get('same')));
    expect(calls).toBe(1);
  });

  it('reloads once the ttl has passed', async () => {
    let calls = 0;
    const get = ttlCache(5, async (k) => { calls++; return k; });
    await get('a');
    await new Promise((r) => setTimeout(r, 12));
    await get('a');
    expect(calls).toBe(2);
  });

  it('never remembers a failure', async () => {
    let calls = 0;
    const get = ttlCache(10_000, async () => { calls++; throw new Error('nope'); });
    await expect(get('a')).rejects.toThrow('nope');
    await expect(get('a')).rejects.toThrow('nope');
    expect(calls).toBe(2);
  });

  it('forget drops one key so the next read sees the new row', async () => {
    let n = 0;
    const get = ttlCache(10_000, async () => ++n);
    expect(await get('a')).toBe(1);
    get.forget('a');
    expect(await get('a')).toBe(2);
  });

  it('sweeps expired entries once it holds more than 2000', async () => {
    const get = ttlCache(0, async (k) => k);
    for (let i = 0; i < 2002; i++) await get(`k${i}`);
    expect(get.size()).toBeLessThan(2002);
  });

  it('keeps live entries when it sweeps', async () => {
    const get = ttlCache(60_000, async (k) => k);
    for (let i = 0; i < 2002; i++) await get(`k${i}`);
    expect(get.size()).toBe(2002);
  });
});
