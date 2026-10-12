import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'studio',
    // turbo runs the four suites at once; module-heavy tests overrun the 5s default under that load
    testTimeout: 30_000,
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
        // network / browser / process glue: a test would assert that fetch, Supabase,
        // canvas or window was called. Each is a thin wrapper; the logic they feed is in.
        'src/cloud/{api,auth,client,useAsync,useAutosave,useMcpConsole,useMcpLive,usePageViews}.ts',
        'src/copilot/{client,session,live-test}.ts',
        'src/export/{raster,gif.d}.ts',
        'src/core/{publicApi,catalog}.ts',
        'src/ui/{stageBg,tours}.ts',
        // re-exports and type-only modules: no executable statements
        'src/engine.ts',
        'src/**/types.ts',
      ],
      // terminal only: a per-file table where the run already is, and no
      // coverage/ directory to gitignore, serve or clean up
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      reporter: ['text'],
    },
  },
});
