import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const get = vi.fn();
const getProjectJson = vi.fn();
const project = vi.fn();
const generic = vi.fn(() => Buffer.from('generic'));
const readable = vi.fn();
vi.mock('../services/projects.service.js', () => ({ projectsService: { get } }));
vi.mock('../services/storage.service.js', () => ({ getProjectJson }));
vi.mock('../services/og.service.js', () => ({ OG_WIDTH: 1200, OG_HEIGHT: 630, ogService: { project, generic }, readable }));

const { ogRoutes } = await import('./og.routes.js');

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base: string;
beforeAll(async () => {
  server = express().use('/og', ogRoutes).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/og`;
});
afterAll(() => new Promise((r) => server.close(() => r(undefined))));

const id = '3f1c2b8e-1111-4222-8333-444455556666';
const pub = { name: 'Bloo <b>', visibility: 'public', s3Key: 'k' };
beforeEach(() => {
  for (const m of [get, getProjectJson, project, readable]) m.mockReset();
  get.mockResolvedValue(pub); getProjectJson.mockResolvedValue({}); readable.mockReturnValue({ p: 1 }); project.mockReturnValue(Buffer.from('card'));
});

const text = async (path: string) => { const r = await fetch(base + path); return { r, t: await r.text() }; };

it('draws a public project\'s own card', async () => {
  const { r, t } = await text(`/projects/${id}.png`);
  expect(r.headers.get('content-type')).toBe('image/png');
  expect(t).toBe('card');
});

it('falls back to the generic card for a private, missing, unreadable or undrawable project', async () => {
  get.mockResolvedValueOnce({ ...pub, visibility: 'private' });
  expect((await text(`/projects/${id}.png`)).t).toBe('generic');
  get.mockRejectedValueOnce(new Error('gone'));
  expect((await text(`/projects/${id}.png`)).t).toBe('generic');
  getProjectJson.mockRejectedValueOnce(new Error('s3'));
  readable.mockReturnValueOnce(null);
  expect((await text(`/projects/${id}.png`)).t).toBe('generic');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  project.mockImplementationOnce(() => { throw new Error('bad doc'); });
  expect((await text(`/projects/${id}.png`)).t).toBe('generic');
  project.mockImplementationOnce(() => { throw 'str'; });
  expect((await text(`/projects/${id}.png`)).t).toBe('generic');
  expect(warn).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});

it('serves the site card', async () => {
  expect((await text('/card.png')).t).toBe('generic');
});

it('renders the unfurl page with the project\'s name escaped, or the site\'s own words', async () => {
  const a = await text(`/projects/${id}`);
  expect(a.t).toContain('Bloo &#60;b&#62; — blooby');
  expect(a.t).toContain(`/og/projects/${id}.png`);
  get.mockResolvedValueOnce({ ...pub, visibility: 'private' });
  const b = await text(`/projects/${id}`);
  expect(b.t).toContain('blooby — mascot studio');
  expect(b.t).toContain('/og/card.png');
});
