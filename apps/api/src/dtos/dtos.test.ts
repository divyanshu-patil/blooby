import { expect, it } from 'vitest';
import { contentEnvelope, paginationDto, uuidParam } from './common.js';

/* ---- pagination -------------------------------------------------------------- */

it('defaults a page size and coerces the one a query string carries', () => {
  expect(paginationDto.parse({})).toEqual({ limit: 24 });
  expect(paginationDto.parse({ limit: '50' }).limit).toBe(50);
});

it('caps the page size, so one request cannot ask for the whole table', () => {
  expect(paginationDto.safeParse({ limit: 101 }).success).toBe(false);
  expect(paginationDto.safeParse({ limit: 0 }).success).toBe(false);
  expect(paginationDto.safeParse({ limit: 1.5 }).success).toBe(false);
});

it('trims a search term and refuses an unbounded one', () => {
  expect(paginationDto.parse({ q: '  hello  ' }).q).toBe('hello');
  expect(paginationDto.safeParse({ q: 'x'.repeat(121) }).success).toBe(false);
});

/* ---- ids --------------------------------------------------------------------- */

it('accepts only a real uuid as a path id', () => {
  const p = uuidParam('id');
  expect(p.safeParse({ id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).success).toBe(true);
  for (const bad of ['1', 'not-a-uuid', '', "' OR 1=1--"]) {
    expect(p.safeParse({ id: bad }).success, bad).toBe(false);
  }
});

/* ---- stored payloads ---------------------------------------------------------- */

it('stamps a schema version so stored payloads can be migrated later', () => {
  expect(contentEnvelope.parse({ data: {} }).schemaVersion).toBe(1);
  expect(contentEnvelope.parse({ schemaVersion: 3, data: {} }).schemaVersion).toBe(3);
  expect(contentEnvelope.safeParse({ schemaVersion: 0, data: {} }).success).toBe(false);
});

it('insists the payload is an object, not a bare scalar or null', () => {
  expect(contentEnvelope.safeParse({ data: {} }).success).toBe(true);
  expect(contentEnvelope.safeParse({ data: [] }).success).toBe(true);
  for (const bad of [null, 'a string', 42, undefined]) {
    expect(contentEnvelope.safeParse({ data: bad }).success).toBe(false);
  }
});
