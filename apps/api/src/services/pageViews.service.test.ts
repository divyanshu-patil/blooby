import { beforeEach, expect, it, vi } from 'vitest';
import type { Request } from 'express';

const createMany = vi.fn();
vi.mock('../config/prisma.js', () => ({ prisma: { pageView: { createMany } } }));

const { pageViewsService, normalisePath } = await import('./pageViews.service.js');

const req = (over: Partial<{ ip: string; ua: string; userId: string }> = {}) =>
  ({
    ip: over.ip ?? '1.2.3.4',
    headers: { 'user-agent': over.ua ?? 'Mozilla/5.0' },
    user: over.userId ? { id: over.userId } : undefined,
  }) as unknown as Request;

const rowsOf = () => (createMany.mock.calls[0]?.[0].data ?? []) as Record<string, unknown>[];

beforeEach(async () => {
  await pageViewsService.flush();
  createMany.mockReset();
  createMany.mockResolvedValue({ count: 0 });
});

/**
 * An id in the path makes every project its own line in "top pages", and puts ids that are
 * nobody's business into an analytics table. The client sends the route; this is the
 * backstop for anything that does not.
 */
it('keeps the route and never the id', () => {
  expect(normalisePath('/projects/9f8c1c0e-1111-4222-8333-444455556666')).toBe('/projects/:id');
  expect(normalisePath('/projects/9F8C1C0E-1111-4222-8333-444455556666/edit')).toBe('/projects/:id/edit');
  expect(normalisePath('/library?tab=presets#x')).toBe('/library');
  expect(normalisePath('/')).toBe('/');
  expect(normalisePath('/projects/')).toBe('/projects');
});

/** The point of the buffer: nothing a visitor waits on touches a database ~580ms away. */
it('records without writing anything, then writes the batch in one call', async () => {
  pageViewsService.record(req(), { path: '/projects' }, 'blooby.app');
  pageViewsService.record(req({ ip: '9.9.9.9' }), { path: '/library' }, 'blooby.app');
  expect(createMany).not.toHaveBeenCalled();
  expect(pageViewsService.buffered()).toBe(2);

  expect(await pageViewsService.flush()).toBe(2);
  expect(createMany).toHaveBeenCalledTimes(1);
  expect(rowsOf().map((r) => r.path)).toEqual(['/projects', '/library']);
  expect(pageViewsService.buffered()).toBe(0);
});

/**
 * Cookieless: the visitor is a hash of things the client cannot choose, with a salt that
 * rotates daily. It has to tell two people apart on one day — and the address it was made
 * from must not be recoverable from the row.
 */
it('tells two visitors apart without storing anything that identifies either', async () => {
  pageViewsService.record(req({ ip: '1.2.3.4' }), { path: '/a' }, 'blooby.app');
  pageViewsService.record(req({ ip: '1.2.3.4' }), { path: '/b' }, 'blooby.app');
  pageViewsService.record(req({ ip: '5.6.7.8' }), { path: '/a' }, 'blooby.app');
  await pageViewsService.flush();

  const visitors = rowsOf().map((r) => r.visitor as string);
  expect(visitors[0]).toBe(visitors[1]);            // same person, two pages
  expect(visitors[0]).not.toBe(visitors[2]);        // different person
  const stored = JSON.stringify(rowsOf());
  expect(stored).not.toContain('1.2.3.4');
  expect(stored).not.toContain('Mozilla');
});

it('records the person when they are signed in, and nothing when they are not', async () => {
  pageViewsService.record(req({ userId: 'u1' }), { path: '/a' }, 'blooby.app');
  pageViewsService.record(req({ ip: '2.2.2.2' }), { path: '/a' }, 'blooby.app');
  await pageViewsService.flush();
  expect(rowsOf().map((r) => r.userId)).toEqual(['u1', null]);
});

/** A full referrer URL carries query strings we have no use for and no business keeping. */
it('keeps a referrer’s host only, and treats arriving from ourselves as no referrer', async () => {
  pageViewsService.record(req(), { path: '/a', referrer: 'https://www.google.com/search?q=secret+thing' }, 'blooby.app');
  pageViewsService.record(req(), { path: '/b', referrer: 'https://blooby.app/projects' }, 'blooby.app');
  pageViewsService.record(req(), { path: '/c', referrer: 'not a url' }, 'blooby.app');
  await pageViewsService.flush();
  expect(rowsOf().map((r) => r.referrer)).toEqual(['google.com', null, null]);
});

/** A traffic counter is never worth an out-of-memory. */
it('drops views rather than growing the buffer without bound', () => {
  for (let i = 0; i < 5_200; i++) pageViewsService.record(req(), { path: '/a' }, 'blooby.app');
  expect(pageViewsService.buffered()).toBe(5_000);
});

/** Analytics must not be able to fail a request, or lose the next batch with it. */
it('drops a failed batch and keeps accepting views', async () => {
  createMany.mockRejectedValueOnce(new Error('database is away'));
  pageViewsService.record(req(), { path: '/a' }, 'blooby.app');
  expect(await pageViewsService.flush()).toBe(0);

  createMany.mockResolvedValue({ count: 1 });
  pageViewsService.record(req(), { path: '/b' }, 'blooby.app');
  expect(await pageViewsService.flush()).toBe(1);
});
