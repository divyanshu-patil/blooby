import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HttpError as HttpErrorType } from '../utils/httpError.js';

vi.mock('../repositories/copilot.repository.js', () => ({
  copilotRepository: {
    settings: vi.fn(),
    count: vi.fn(),
    listForAdmin: vi.fn(),
    setAllowUserKeys: vi.fn(),
    create: vi.fn((d: unknown) => d),
    delete: vi.fn(async () => {}),
    pool: vi.fn(),
    mark: vi.fn(async () => {}),
  },
}));

const { copilotRepository } = await import('../repositories/copilot.repository.js');
const { copilotService } = await import('./copilot.service.js');
const { HttpError } = await import('../utils/httpError.js');

const repo = copilotRepository as unknown as Record<string, ReturnType<typeof vi.fn>>;
const reply = (status: number, body = '') =>
  ({ ok: status < 400, status, json: async () => ({ done: true }), text: async () => body });

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.mark.mockResolvedValue(undefined);
  repo.settings.mockResolvedValue({ allowUserKeys: true });
  repo.pool.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Runs chat with the backoff skipped, so a failover test does not wait 1.2s. */
async function chat(body: Record<string, unknown>) {
  const p = copilotService.chat(body as never);
  const settled = p.then((v) => ({ v }), (e) => ({ e }));
  await vi.runAllTimersAsync();
  return settled;
}

/* ---- which keys a request may use ------------------------------------------- */

/**
 * The toggle is enforced here rather than by hiding a field in the browser: a client that
 * keeps sending its own keys after an admin turns user keys off must simply be ignored.
 */
it('ignores keys the client supplies once an admin turns user keys off', async () => {
  repo.settings.mockResolvedValue({ allowUserKeys: false });
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'server-key' }]);
  expect(await copilotService.keysFor(['mine'])).toEqual([{ id: 'k1', secret: 'server-key' }]);
});

it('prefers the caller’s own keys when that is allowed', async () => {
  repo.settings.mockResolvedValue({ allowUserKeys: true });
  expect(await copilotService.keysFor(['mine'])).toEqual([{ id: null, secret: 'mine' }]);
});

it('falls back to the server pool when the caller supplies none', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 's1' }]);
  expect(await copilotService.keysFor(undefined)).toEqual([{ id: 'k1', secret: 's1' }]);
});

it('never returns a key’s secret to an ordinary caller', async () => {
  repo.settings.mockResolvedValue({ allowUserKeys: true });
  repo.count.mockResolvedValue(2);
  expect(await copilotService.config()).toEqual({ allowUserKeys: true, hasServerKeys: true });
});

it('stores a hint that identifies a key without being usable', async () => {
  await copilotService.addKey('admin1', { label: 'l', key: 'abcd1234efgh5678' } as never);
  const saved = repo.create.mock.calls[0][0] as { hint: string; secret: string };
  expect(saved.hint).toBe('abcd…5678');
  expect(saved.hint).not.toContain('1234efgh');
  await copilotService.addKey('admin1', { label: 'l', key: 'short' } as never);
  expect((repo.create.mock.calls[1][0] as { hint: string }).hint).toBe('••••');
});

/* ---- failover ---------------------------------------------------------------- */

it('explains what to do when no key is configured at all', async () => {
  repo.pool.mockResolvedValue([]);
  repo.settings.mockResolvedValue({ allowUserKeys: false });
  const r = await chat({ model: 'm', messages: [] });
  expect((r as { e: HttpErrorType }).e).toBeInstanceOf(HttpError);
  expect((r as { e: HttpErrorType }).e.status).toBe(400);
  expect((r as { e: HttpErrorType }).e.message).toMatch(/admin/i);
});

it('moves to the next key when one is rejected, and marks the bad one', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'bad' }, { id: 'k2', secret: 'good' }]);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(reply(401))
    .mockResolvedValueOnce(reply(200));
  vi.stubGlobal('fetch', fetchMock);

  const r = await chat({ model: 'm', messages: [] });
  expect((r as { v: unknown }).v).toEqual({ done: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(repo.mark).toHaveBeenCalledWith('k1', 'error', '401');
  expect(repo.mark).toHaveBeenCalledWith('k2', 'ok');
});

it('records a rate limit as its own state, not as a plain error', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'a' }, { id: 'k2', secret: 'b' }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(429)).mockResolvedValue(reply(200)));
  await chat({ model: 'm', messages: [] });
  expect(repo.mark).toHaveBeenCalledWith('k1', 'rate-limited', '429');
});

/** A different key cannot fix a bad request or a model that does not exist. */
it('does not retry a 400 or a 404 against every other key', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'a' }, { id: 'k2', secret: 'b' }]);
  const fetchMock = vi.fn().mockResolvedValue(reply(404, 'model "nope" not found'));
  vi.stubGlobal('fetch', fetchMock);
  const r = await chat({ model: 'nope', messages: [] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((r as { e: HttpErrorType }).e.status).toBe(400);
});

it('sweeps every key twice before giving up, and reports upstream failure', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'a' }, { id: 'k2', secret: 'b' }]);
  const fetchMock = vi.fn().mockResolvedValue(reply(500, 'boom'));
  vi.stubGlobal('fetch', fetchMock);
  const r = await chat({ model: 'm', messages: [] });
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect((r as { e: HttpErrorType }).e.status).toBe(502);
});

it('survives a network throw and keeps trying the remaining keys', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'a' }, { id: 'k2', secret: 'b' }]);
  vi.stubGlobal('fetch', vi.fn()
    .mockRejectedValueOnce(new Error('ECONNRESET'))
    .mockResolvedValue(reply(200)));
  const r = await chat({ model: 'm', messages: [] });
  expect((r as { v: unknown }).v).toEqual({ done: true });
});

it('sends the key as a bearer token and never streams', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'sekrit' }]);
  const fetchMock = vi.fn().mockResolvedValue(reply(200));
  vi.stubGlobal('fetch', fetchMock);
  await chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers.Authorization).toBe('Bearer sekrit');
  expect(JSON.parse(init.body).stream).toBe(false);
});

it('shows an admin the settings and keys, toggles user keys, and removes a key', async () => {
  repo.listForAdmin.mockResolvedValue([{ id: 'k' }]);
  expect(await copilotService.adminView()).toEqual({ allowUserKeys: true, keys: [{ id: 'k' }] });
  repo.setAllowUserKeys.mockResolvedValue({ allowUserKeys: false });
  expect(await copilotService.setAllowUserKeys(false)).toEqual({ allowUserKeys: false });
  expect(await copilotService.removeKey('k')).toBeUndefined();
  expect(repo.delete).toHaveBeenCalledWith('k');
});

it('asks for a key when user keys are allowed but none were sent', async () => {
  const r = await chat({ model: 'm', messages: [] });
  expect((r as { e: HttpErrorType }).e.message).toMatch(/Add an Ollama/);
});

it('a caller\'s own keys are never marked, and a rejected one says so', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(401)));
  const r = await chat({ model: 'm', messages: [], keys: ['mine'] });
  expect((r as { e: HttpErrorType }).e.message).toMatch(/rejected that API key/);
  expect(repo.mark).not.toHaveBeenCalled();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200)));
  expect(((await chat({ model: 'm', messages: [], keys: ['mine'] })) as { v: unknown }).v).toEqual({ done: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(429)));
  await chat({ model: 'm', messages: [], keys: ['mine'] });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue('plain'));
  expect(((await chat({ model: 'm', messages: [], keys: ['mine'] })) as { e: HttpErrorType }).e.message).toBe('plain');
  expect(repo.mark).not.toHaveBeenCalled();
});

it('names a rejected server key, and uses the status when a 400 has no body', async () => {
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'a' }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(403)));
  expect(((await chat({ model: 'm', messages: [] })) as { e: HttpErrorType }).e.message).toMatch(/configured on this server/);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(400)));
  expect(((await chat({ model: 'm', messages: [] })) as { e: HttpErrorType }).e.message).toMatch(/^400/);
});

it('a failing bookkeeping write never fails or delays a chat', async () => {
  repo.mark.mockRejectedValue(new Error('db'));
  repo.pool.mockResolvedValue([{ id: 'k1', secret: 'a' }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(200)));
  expect(((await chat({ model: 'm', messages: [] })) as { v: unknown }).v).toEqual({ done: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => { throw new Error('body'); } }));
  expect(((await chat({ model: 'm', messages: [] })) as { e: HttpErrorType }).e.status).toBe(502);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
  expect(((await chat({ model: 'm', messages: [] })) as { e: HttpErrorType }).e.status).toBe(502);
});
