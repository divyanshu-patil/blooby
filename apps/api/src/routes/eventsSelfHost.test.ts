import { expect, it, vi } from 'vitest';

vi.mock('../middlewares/authenticate.js', () => ({ optionalAuth: (_q: unknown, _s: unknown, n: () => void) => n() }));
const { env } = await import('../config/env.js');

it('copes with an app url that is not a url', async () => {
  (env as { appUrl: string }).appUrl = 'not a url';
  await expect(import('./events.routes.js')).resolves.toHaveProperty('eventsRoutes');
});
