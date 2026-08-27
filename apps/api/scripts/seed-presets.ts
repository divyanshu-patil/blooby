/**
 * One-off: load the editor's built-in presets into the shared `presets` table so a fresh
 * project has a library to browse. Idempotent by name — re-running updates rather than
 * duplicating.
 *
 * Reads supabase/presets.seed.json, captured once from packages/studio's builtinPresets().
 * Regenerate it with:
 *   cd packages/studio && npx esbuild gen-seed.ts --bundle --format=esm | node --input-type=module
 * Deliberately not importing studio source directly: that package is authored for a
 * bundler (extensionless relative imports) and does not typecheck under NodeNext.
 */
import { readFileSync } from 'node:fs';
import { prisma } from '../src/prisma.js';

interface SeedPreset { id: string; name: string; source: string; durationMs: number; tracks: unknown[] }

const seed = JSON.parse(
  readFileSync(new URL('../../../supabase/presets.seed.json', import.meta.url), 'utf8'),
) as { presets: SeedPreset[] };

console.log(`seeding ${seed.presets.length} built-in presets…`);

for (const preset of seed.presets) {
  const existing = await prisma.preset.findFirst({ where: { name: preset.name, source: 'builtin' } });
  const data = {
    name: preset.name,
    category: 'builtin',
    source: 'builtin',
    presetJson: preset as unknown as object,
    published: true,
    updatedAt: new Date(),
  };
  if (existing) await prisma.preset.update({ where: { id: existing.id }, data });
  else await prisma.preset.create({ data });
  console.log(`  ${existing ? 'updated' : 'created'} ${preset.name}`);
}

await prisma.$disconnect();
console.log('done.');
