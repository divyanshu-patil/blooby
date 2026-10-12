import { expect, it, vi } from 'vitest';

vi.mock('@blooby/studio/engine', async (orig) => ({
  ...(await orig<object>()),
  migrateProject: () => { throw new Error('unrepairable'); },
}));
const { readable } = await import('./og.service.js');

it('treats a document migrate cannot repair as not drawable', () => {
  expect(readable({ rig: {} })).toBeNull();
});
