/**
 * Writes docs/mcp/tools.md and docs/mcp/parity.json from the capability registry.
 *
 *   pnpm --filter @blooby/api mcp:docs
 *
 * Both are generated so they cannot drift: a new store action, edit tool or host capability
 * appears here on the next run. parity.json is the Studio → core → MCP audit: for every
 * capability its source, the core function behind it, its MCP tool, scope, schema, the tests
 * that exercise it and its docs anchor — plus every store action NOT exposed, with the reason.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { capabilities, excludedActions, CAPABILITY_VERSION, SCOPES, type Capability } from '@blooby/studio/engine';
import '../src/services/mcp/host.js';   // registers the server capabilities

const root = new URL('../../../', import.meta.url).pathname;
const out = join(root, 'docs/mcp');

// which tests name each capability
const testFiles: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.test\.tsx?$/.test(f)) testFiles.push(p);
  }
};
walk(join(root, 'packages/studio/src'));
walk(join(root, 'apps/api/src'));
const sources = testFiles.map((f) => ({ file: relative(root, f), text: readFileSync(f, 'utf8') }));
/** a capability's id in quotes, or — for a store action — its store name called as a method */
const testsFor = (id: string) => {
  const c = capabilities().find((x) => x.id === id);
  const action = c?.kind === 'action' ? `.${c.title}(` : null;
  return sources.filter((s) => s.text.includes(`'${id}'`) || s.text.includes(`"${id}"`) || (action && s.text.includes(action))).map((s) => s.file);
};

const CORE: Record<Capability['kind'], (c: Capability) => string> = {
  edit: (c) => `copilot/tools.ts applyCalls → case '${c.id}' (the copilot's own edit path)`,
  action: (c) => `core/store.ts useEditor().${c.title}`,
  read: (c) => `copilot/agent.ts runAgentTool → case '${c.id}'`,
  session: (c) => `engine/session.ts SESSION['${c.id}']`,
  server: (c) => `apps/api/src/services/mcp/host.ts HOST['${c.id}']`,
};

const list = capabilities().sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
const anchor = (id: string) => `tools.md#${id}`;

const parity = {
  capabilityVersion: CAPABILITY_VERSION,
  generatedAt: new Date().toISOString(),
  summary: {
    capabilities: list.length,
    byKind: Object.fromEntries(['edit', 'action', 'read', 'session', 'server'].map((k) => [k, list.filter((c) => c.kind === k).length])),
    tested: list.filter((c) => testsFor(c.id).length).length,
    excludedStoreActions: excludedActions().length,
  },
  capabilities: list.map((c) => ({
    feature: c.title, id: c.id, category: c.category, source: c.kind, core: CORE[c.kind](c), mcpTool: c.id,
    alsoVia: 'invoke { capability }', schema: c.inputSchema, scope: c.scope, mutates: c.mutates, reversible: c.reversible,
    tests: testsFor(c.id), docs: anchor(c.id),
  })),
  notExposed: excludedActions(),
};
writeFileSync(join(out, 'parity.json'), `${JSON.stringify(parity, null, 2)}\n`);

const args = (c: Capability) => {
  const s = c.inputSchema as { properties?: Record<string, { type?: unknown; enum?: string[]; description?: string }>; required?: string[] };
  const rows = Object.entries(s.properties ?? {}).filter(([k]) => !['requestId', 'dryRun', 'expectedRevision'].includes(k));
  if (!rows.length) return '_no arguments_';
  return rows.map(([k, v]) => `\`${k}\`${s.required?.includes(k) ? '' : '?'}${v.enum ? ` — one of ${v.enum.slice(0, 12).map((e) => `\`${e}\``).join(', ')}${v.enum.length > 12 ? '…' : ''}` : v.type ? ` (${String(v.type)})` : ''}`).join(' · ');
};

const categories = [...new Set(list.map((c) => c.category))];
const md = [
  '# Tool reference',
  '',
  `_Generated from the capability registry (version ${CAPABILITY_VERSION}) by \`pnpm --filter @blooby/api mcp:docs\` — do not edit by hand._`,
  '',
  `${list.length} capabilities. Every one is callable as its own MCP tool with \`?tools=full\`, or through \`invoke { capability, args }\` in the default compact profile. Mutating capabilities also take \`requestId\` (idempotency), \`dryRun\` and \`expectedRevision\`.`,
  '',
  '## Scopes',
  '',
  ...Object.entries(SCOPES).map(([k, v]) => `- \`${k}\` — ${v}`),
  '',
  '## Contents',
  '',
  ...categories.map((cat) => `- [${cat}](#category-${cat}) (${list.filter((c) => c.category === cat).length})`),
  '',
  ...categories.flatMap((cat) => [
    `## Category: ${cat}`, '', `<a id="category-${cat}"></a>`, '',
    ...list.filter((c) => c.category === cat).flatMap((c) => [
      `### ${c.id}`, `<a id="${c.id}"></a>`, '',
      `**${c.title}** · \`${c.scope}\` · ${c.mutates ? `changes the project${c.reversible ? ', undoable' : ''}` : 'read-only'} · source: ${c.kind}`,
      '',
      c.description.split('\n\nArguments:')[0].split('\n\nStore action:')[0].trim(),
      '',
      `Arguments: ${args(c)}`,
      ...(c.examples?.length ? ['', `Example: \`${JSON.stringify(c.examples[0])}\``] : []),
      '',
    ]),
  ]),
].join('\n');
writeFileSync(join(out, 'tools.md'), `${md}\n`);
console.log(`wrote docs/mcp/tools.md and parity.json — ${list.length} capabilities, ${parity.summary.tested} named in tests, ${parity.notExposed.length} store actions excluded with reasons`);
