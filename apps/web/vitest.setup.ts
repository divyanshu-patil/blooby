import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

/**
 * jsdom implements neither of these, and the editor calls both on mount — matchMedia for
 * the reduced-motion check, ResizeObserver for every panel that measures itself.
 */
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}));
vi.stubGlobal('ResizeObserver', class {
  observe() {} unobserve() {} disconnect() {}
});
