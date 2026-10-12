import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    // turbo runs the four suites at once; module-heavy tests overrun the 5s default under that load
    testTimeout: 30_000,
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // fake, committed configuration: these tests never open a socket, but the modules
    // under test validate the environment the moment they are imported
    env: Object.fromEntries(
      (await import('node:fs')).readFileSync(new URL('.env.test', import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    ),
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**',
        'src/index.ts',
        // Prisma delegation with no branching of our own — a test here would assert that
        // Prisma was called, which is a test of Prisma
        'src/repositories/**',
        'src/config/prisma.ts',
        // an empty placeholder: no statements to cover
        'src/testkit.ts',
      ],
      // terminal only: a per-file table where the run already is, and no
      // coverage/ directory to gitignore, serve or clean up
      reporter: ['text'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
