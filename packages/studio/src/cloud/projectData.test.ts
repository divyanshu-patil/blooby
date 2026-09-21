import { beforeEach, expect, it, vi } from 'vitest';

/**
 * Reading a project's document, and what happens when the fast way does not work.
 *
 * The fast way is a presigned link the browser fetches from the bucket itself — no request
 * to the API, no round trip to Postgres, and the payload never passes through the server.
 * The first deploy of that went to a bucket with no CORS rules on it and EVERY project in
 * the app failed to open, which is the wrong answer to "this is slower than it should be".
 * So these pin the fallback, not the happy path.
 */

const get = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./client');
  return { ...actual, api: { get, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() } };
});

const { projectsApi } = await import('./api');

const fetchMock = vi.fn();
const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'p1', dataUrl: 'https://bucket.example/p1.json?sig', ...over }) as never;

beforeEach(() => {
  get.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const fromBucket = (body: unknown) =>
  fetchMock.mockResolvedValue({ ok: true, json: async () => body });

it('reads a listed project straight from the bucket, without touching the API', async () => {
  fromBucket({ rig: 'from-bucket' });
  expect(await projectsApi.projectData(row())).toEqual({ rig: 'from-bucket' });
  expect(fetchMock).toHaveBeenCalledWith('https://bucket.example/p1.json?sig');
  expect(get, 'a page of forty cards must cost the API nothing').not.toHaveBeenCalled();
});

/** CORS missing from the bucket is exactly this: the fetch rejects before any response. */
it('falls back to the API when the bucket refuses the browser', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  get.mockResolvedValue({ data: { rig: 'from-api' } });
  expect(await projectsApi.projectData(row())).toEqual({ rig: 'from-api' });
  expect(get).toHaveBeenCalledWith('/api/projects/p1/data', { inline: 1 });
});

/** A presigned link lasts an hour; a dashboard left open overnight outlives it. */
it('falls back when the link has expired', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
  get.mockResolvedValue({ data: { rig: 'from-api' } });
  expect(await projectsApi.projectData(row())).toEqual({ rig: 'from-api' });
});

/** It is correct and it is several times slower — it should read as a misconfiguration
 *  to whoever opens the console, not pass silently. */
it('says so in the console when it falls back', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  get.mockResolvedValue({ data: {} });
  await projectsApi.projectData(row());
  expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('CORS');
});

it('asks the API outright for a row that came without a link', async () => {
  get.mockResolvedValue({ project: { id: 'p1' }, data: { rig: 'from-api' } });
  expect(await projectsApi.projectData(row({ dataUrl: undefined }))).toEqual({ rig: 'from-api' });
  expect(fetchMock).not.toHaveBeenCalled();
});

/** Opening the editor is the same two-step, and it must survive the same failure. */
it('getData resolves the link, and falls back to the API when it cannot', async () => {
  get.mockResolvedValue({ project: { id: 'p1', currentVersion: 3 }, dataUrl: 'https://bucket.example/p1.json?sig', canEdit: true });
  fromBucket({ rig: 'from-bucket' });
  expect(await projectsApi.getData('p1')).toMatchObject({ data: { rig: 'from-bucket' }, canEdit: true });

  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  get.mockResolvedValueOnce({ project: { id: 'p1', currentVersion: 3 }, dataUrl: 'https://bucket.example/p1.json?sig', canEdit: true })
    .mockResolvedValueOnce({ data: { rig: 'from-api' } });
  expect(await projectsApi.getData('p1')).toMatchObject({ data: { rig: 'from-api' }, canEdit: true });
});
