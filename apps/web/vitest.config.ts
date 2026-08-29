import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      // main.tsx is the mount point and harness.tsx is dev-only; neither has logic
      exclude: ['src/**/*.test.tsx', 'src/main.tsx', 'src/harness.tsx', 'vitest.setup.ts'],
      reporter: ['text'],
    },
  },
});
