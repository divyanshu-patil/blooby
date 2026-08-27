/**
 * Load the editor's built-in presets and expressions into the shared `assets` table so a
 * fresh install has a library to browse. Idempotent by (kind, name, source='builtin') —
 * re-running updates rather than duplicating.
 *
 * Reads supabase/presets.seed.json, captured from packages/studio's builtinPresets() /
 * builtinExpressions(). Deliberately not importing studio source directly: that package
 * is authored for a bundler (extensionless relative imports) and will not typecheck
 * under NodeNext.
 */
import 'dotenv/config'; // imported directly rather than via config/env.ts, which pulls in the whole server config
import { readFileSync } from 'node:fs';
import type { AssetKind } from '@prisma/client';
import { prisma } from '../src/config/prisma.js';
import { toJson } from '../src/utils/json.js';

interface SeedItem { id: string; name: string; [k: string]: unknown }

const seed = JSON.parse(
  readFileSync(new URL('../../../supabase/presets.seed.json', import.meta.url), 'utf8'),
) as { presets: SeedItem[]; expressions: SeedItem[] };

async function upsert(kind: AssetKind, items: SeedItem[]) {
  for (const item of items) {
    const existing = await prisma.asset.findFirst({ where: { kind, name: item.name, source: 'builtin' } });
    const data = {
      kind,
      source: 'builtin' as const,
      status: 'published' as const,
      name: item.name,
      category: 'builtin',
      data: toJson(item),
      publishedAt: new Date(),
    };
    if (existing) await prisma.asset.update({ where: { id: existing.id }, data });
    else await prisma.asset.create({ data });
    console.log(`  ${existing ? 'updated' : 'created'} ${kind} ${item.name}`);
  }
}

console.log(`seeding ${seed.presets.length} presets and ${seed.expressions.length} expressions…`);
await upsert('preset', seed.presets);
await upsert('expression', seed.expressions);

await prisma.$disconnect();
console.log('done.');
