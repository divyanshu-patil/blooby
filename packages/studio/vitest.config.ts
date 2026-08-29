import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'studio',
    include: ['src/**/*.test.ts'],
    // pure maths and store logic — no DOM needed, and node is faster to start
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/core/testkit.ts',
        'src/index.ts',
        'src/smoke.ts',
        // React components: rendered and driven in a real browser rather than jsdom, so
        // counting their statements here would report a number no unit test can move.
        // The pure helpers they call (core/, export/, and Mascot's bounds maths) are in.
        'src/ui/**/*.tsx',
        'src/cloud/**/*.tsx',
        'src/kit/**',
      ],
      // terminal only: a per-file table where the run already is, and no
      // coverage/ directory to gitignore, serve or clean up
      reporter: ['text'],
    },
  },
});
