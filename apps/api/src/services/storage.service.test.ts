import { gunzipSync, gzipSync } from 'node:zlib';
import { beforeEach, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async (_c: unknown, cmd: { input: { Key: string } }, o: { expiresIn: number }) => `https://s3/${cmd.input.Key}?e=${o.expiresIn}`) }));
vi.mock('../config/aws.js', () => ({ BUCKET: 'test-bucket', s3: { send } }));

const storage = await import('./storage.service.js');
const { HttpError } = await import('../utils/httpError.js');

beforeEach(() => { send.mockReset(); send.mockResolvedValue({}); });

/**
 * Exactly one object per project, overwritten in place. The key is derived from the two
 * ids and nothing else, so a caller cannot aim a write at another user's prefix.
 */
it('derives the key from the owner and the project, and nothing else', () => {
  expect(storage.projectKey('u1', 'p1')).toBe('users/u1/projects/p1.json');
  expect(storage.projectKey('u2', 'p1')).toBe('users/u2/projects/p1.json');
});

it('writes one object and reports where it went', async () => {
  const stored = await storage.putProjectJson('u1', 'p1', { hello: 'world' });
  expect(stored.key).toBe('users/u1/projects/p1.json');
  expect(stored.bucket).toBe('test-bucket');
  expect(stored.sizeBytes).toBe(JSON.stringify({ hello: 'world' }).length);
  expect(send).toHaveBeenCalledTimes(1);
});

/**
 * A project is 13-17% of its size gzipped, measured on the real bucket, and the encoding
 * rides on the OBJECT — so a browser fetching a presigned URL inflates it for free and
 * every card on a dashboard moves six or seven times less.
 */
it('stores the object compressed, and says so on the object itself', async () => {
  const doc = { hello: 'world', filler: 'x'.repeat(4000) };
  await storage.putProjectJson('u1', 'p1', doc);
  const put = send.mock.calls[0][0].input;
  expect(put.ContentEncoding).toBe('gzip');
  expect(put.Body.length).toBeLessThan(JSON.stringify(doc).length);
  expect(JSON.parse(gunzipSync(put.Body as Buffer).toString())).toEqual(doc);
});

/** sizeBytes and the checksum describe the document, not the encoding — they are what the
 *  limit is measured against and what the admin panel shows, for old projects and new. */
it('reports the document\'s size, not the compressed size', async () => {
  const doc = { a: 'b'.repeat(10_000) };
  const stored = await storage.putProjectJson('u1', 'p1', doc);
  expect(stored.sizeBytes).toBe(JSON.stringify(doc).length);
  expect((send.mock.calls[0][0].input.Body as Buffer).length).toBeLessThan(stored.sizeBytes);
});

it('reads a compressed object back', async () => {
  const doc = { round: 'trip' };
  send.mockResolvedValue({ Body: { transformToByteArray: async () => gzipSync(JSON.stringify(doc)) } });
  expect(await storage.getProjectJson('users/u1/projects/p1.json')).toEqual(doc);
});

/** Everything written before compression is plain JSON and must keep opening. The check is
 *  gzip's own magic number, not any stored metadata, which can be wrong or absent. */
it('reads an object written before compression, as plain JSON', async () => {
  const doc = { old: true };
  send.mockResolvedValue({ Body: { transformToByteArray: async () => Buffer.from(JSON.stringify(doc)) } });
  expect(await storage.getProjectJson('users/u1/projects/p1.json')).toEqual(doc);
});

it('checksums the exact bytes it stored, so a later save can be compared', async () => {
  const a = await storage.putProjectJson('u1', 'p1', { a: 1 });
  const b = await storage.putProjectJson('u1', 'p1', { a: 1 });
  const c = await storage.putProjectJson('u1', 'p1', { a: 2 });
  expect(a.checksum).toBe(b.checksum);
  expect(a.checksum).not.toBe(c.checksum);
  expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
});

/**
 * The ceiling that actually matters is on what is about to be persisted, not on what the
 * body parser happened to accept — a payload can grow between the two.
 */
it('refuses an oversized project before it reaches the bucket', async () => {
  const huge = { blob: 'x'.repeat(9 * 1024 * 1024) };
  await expect(storage.putProjectJson('u1', 'p1', huge)).rejects.toThrow(HttpError);
  await expect(storage.putProjectJson('u1', 'p1', huge)).rejects.toMatchObject({ status: 413 });
  expect(send).not.toHaveBeenCalled();
});

it('names the real size in the refusal, so the limit is actionable', async () => {
  try {
    await storage.putProjectJson('u1', 'p1', { blob: 'x'.repeat(9 * 1024 * 1024) });
  } catch (e) {
    expect((e as Error).message).toMatch(/9\.0MB/);
    expect((e as Error).message).toMatch(/8MB limit/);
  }
});

it('reports an empty or unreadable object as an upstream failure', async () => {
  send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array() } });
  await expect(storage.getProjectJson('k')).rejects.toMatchObject({ status: 502 });
  send.mockResolvedValueOnce({});
  await expect(storage.getProjectJson('k')).rejects.toThrow(/empty object/);
  send.mockRejectedValueOnce('plain');
  await expect(storage.getProjectJson('k')).rejects.toThrow(/plain/);
});

it('lists a project\'s objects across pages, ignoring a neighbour with the same prefix', async () => {
  send.mockResolvedValueOnce({ Contents: [{ Key: 'users/u/projects/p.json' }, { Key: 'users/u/projects/p/old' }, { Key: 'users/u/projects/pp.json' }, {}], NextContinuationToken: 't' })
    .mockResolvedValueOnce({});
  expect(await storage.listProjectObjects('u', 'p')).toEqual(['users/u/projects/p.json', 'users/u/projects/p/old']);
});

it('deletes a project\'s other objects in batches of 1000, and shrugs off a failed delete', async () => {
  const keys = Array.from({ length: 1001 }, (_, i) => ({ Key: `users/u/projects/p/${i}` }));
  send.mockResolvedValueOnce({ Contents: keys }).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({});
  expect(await storage.deleteProjectObjects('u', 'p', 'users/u/projects/p/0')).toBe(1000);
  expect(send).toHaveBeenCalledTimes(2); // list + one batch (the list was a single page of 1000 kept)
  send.mockReset();
  send.mockRejectedValueOnce(new Error('list failed'));
  expect(await storage.deleteProjectObjects('u', 'p')).toBe(0);
});

it('signs a read link and files an export under the person\'s prefix', async () => {
  expect(await storage.presignedReadUrl('k')).toBe('https://s3/k?e=300');
  const r = await storage.putExport('u1', 'job', 'my file.json', '{}', 'application/json');
  expect(r.key).toBe('users/u1/exports/job/my-file.json');
  expect(r.url).toContain('e=3600');
});
