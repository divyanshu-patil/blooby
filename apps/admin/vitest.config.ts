import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'admin',
    // turbo runs the four suites at once; module-heavy tests overrun the 5s default under that load
    testTimeout: 30_000,
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      // main.tsx is the mount point and harness.tsx is dev-only; neither has logic
      exclude: ['src/**/*.test.tsx', 'src/main.tsx', 'src/harness.tsx', 'vitest.setup.ts'],
      reporter: ['text'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
