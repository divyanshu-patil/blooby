import { beforeEach, expect, it, vi } from 'vitest';

const send = vi.fn();
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
