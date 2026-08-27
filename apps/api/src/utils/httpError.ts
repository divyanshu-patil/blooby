/**
 * The one error type routes throw. errorHandler turns it into a response; anything else
 * that escapes a handler becomes a generic 500, so an internal message (a Postgres
 * constraint name, an S3 key) can never leak to a client by accident.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = 'error',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest = (m: string, d?: unknown) => new HttpError(400, m, 'bad_request', d);
  static unauthorized = (m = 'Authentication required') => new HttpError(401, m, 'unauthorized');
  static forbidden = (m = 'You do not have access to this resource') => new HttpError(403, m, 'forbidden');
  static notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
  static conflict = (m: string) => new HttpError(409, m, 'conflict');
  static payloadTooLarge = (m: string) => new HttpError(413, m, 'payload_too_large');
  static upstream = (m: string) => new HttpError(502, m, 'upstream_error');
}
