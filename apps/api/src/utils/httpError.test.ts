import { expect, it } from 'vitest';
import { HttpError } from './httpError.js';

it('every factory carries the status and code the API contract promises', () => {
  const cases: [HttpError, number, string][] = [
    [HttpError.badRequest('x'), 400, 'bad_request'],
    [HttpError.unauthorized(), 401, 'unauthorized'],
    [HttpError.forbidden(), 403, 'forbidden'],
    [HttpError.notFound(), 404, 'not_found'],
    [HttpError.conflict('x'), 409, 'conflict'],
    [HttpError.payloadTooLarge('x'), 413, 'payload_too_large'],
    [HttpError.upstream('x'), 502, 'upstream_error'],
  ];
  for (const [err, status, code] of cases) {
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err instanceof HttpError, 'must survive the instanceof check errorHandler does').toBeTruthy();
    expect(err instanceof Error).toBeTruthy();
  }
});

it('details ride along for the field-level messages a form needs', () => {
  const e = HttpError.badRequest('nope', [{ field: 'name', message: 'required' }]);
  expect(e.details).toEqual([{ field: 'name', message: 'required' }]);
});
