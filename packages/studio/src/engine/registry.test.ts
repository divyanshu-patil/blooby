import { it, vi } from 'vitest';
import { check } from '../core/testkit';

// a tool with no doc block, one whose block is never closed, and one whose argument list is
// not a plain name — the shapes the real docs never contain
vi.mock('../copilot/tools', async (orig) => {
  const actual = await orig<typeof import('../copilot/tools')>();
  return {
    ...actual,
    TOOL_NAMES: [...actual.TOOL_NAMES, 'zz_undocumented', 'zz_open', 'zz_odd'],
    TOOL_DOCS: `${actual.TOOL_DOCS}\nzz_open { a, b\nzz_odd { ...rest, ok?: "x"|"y" }\n`,
  };
});

const { capabilities, capability, docBlocks, findCapabilities, paramsOf, registerCapabilities } = await import('./registry');

const bare = capability('zz_undocumented')!;
it('an undocumented tool still gets a description', check(bare.description.startsWith("The editor's zz undocumented.") && bare.description.endsWith('Arguments: {}')));
it('…an empty schema and no layer requirement', check(Object.keys((bare.inputSchema as { properties: object }).properties).join() === 'requestId,dryRun,expectedRevision' && bare.requires.join() === 'project'));
it('a block that never closes has no arguments', check(docBlocks('zz { a, b').every((b) => b.braced === '{}')));
it('a bare spread is not an argument, a real one is', check(Object.keys((capability('zz_odd')!.inputSchema as { properties: object }).properties).includes('ok') && !Object.keys((capability('zz_odd')!.inputSchema as { properties: object }).properties).includes('rest')));

it('a parameter with no type is dropped', check(paramsOf('f(a: string, b) => void').map((p) => p.name).join() === 'a'));
it('a signature with no arrow still parses', check(paramsOf('f(a: string, b?: number)').map((p) => `${p.name}${p.optional ? '?' : ''}`).join() === 'a,b?'));

const base = capability('add_keyframe')!;
registerCapabilities([{ ...base, id: 'zz_again', kind: 'server', description: 'first' }]);
registerCapabilities([{ ...base, id: 'zz_again', kind: 'server', description: 'second' }]);
it('registering an id again replaces it', check(capabilities().filter((c) => c.id === 'zz_again').length === 1 && capability('zz_again')!.description === 'second'));

it('discovery filters on scope and on read/write', check(findCapabilities({ scope: 'preset:read' }).every((c) => c.scope === 'preset:read') && findCapabilities({ mutates: false }).every((c) => !c.mutates) && findCapabilities({ mutates: true, scope: 'project:write', query: 'zz_again' }).some((c) => c.id === 'zz_again')));
