/**
 * The README's pictures: the editor (docs/readme/editor.svg still, editor.gif moving) and a
 * showcase of presets (docs/readme/preset-*.gif, and the README's table between the
 * `showcase` markers), each played straight off the renderer and captioned from its own data.
 *
 *   pnpm --filter @blooby/api readme:hero        (needs ffmpeg on PATH for the GIF)
 *
 * A drawing of the editor's frame — layers, stage, inspector, timeline — around things that
 * are NOT drawn: the mascot on the stage is the real renderer's output (frameSvg), the layer
 * list is the rig's own, the keyframes are the preset's own, and the inspector's numbers are
 * the rig evaluated at the playhead. Change the preset or the renderer and this follows.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { builtinPresets, CAMERA_ID, compOf, defaultProject, evaluateRig, frameSvg, mascotKitPresets, presetPreviewProject } from '@blooby/studio/engine';
import type { Preset } from '@blooby/studio/engine';

const OUT = join(import.meta.dirname, '../../../docs/readme');
const PRESET = 'p_kit_hello';
const STILL_MS = 720;
const FPS = 20;

const preset = mascotKitPresets().find((p) => p.id === PRESET)!;
const project = presetPreviewProject(defaultProject(), preset);
const tracks = project.timelines[0]!.tracks;
const DUR = preset.durationMs;

// M3 roles from DESIGN.md — never a new hex
const C = {
  canvas: '#F7ECE4', card: '#FFFFFF', ink: '#201B16', variant: '#504539', muted: '#6B5F52', line: '#E6DACF',
  primary: '#FBBF79', onPrimary: '#472A00', accent: '#AC7A3B', container: '#FFDDB9', onContainer: '#663E01',
  secondary: '#F7E4CF', inverse: '#352F2A', onInverse: '#FAEFE6', stage: '#17161b', field: '#F7ECE4',
};
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, monospace`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const t = (x: number, y: number, s: string, o: { size?: number; fill?: string; weight?: number; anchor?: string; mono?: boolean } = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${o.size ?? 16}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? C.ink}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(s)}</text>`;
const pill = (x: number, y: number, w: number, h: number, fill: string, r = h / 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;

// brand/geometry.txt's three shapes, at r 14
const mark = (cx: number, cy: number) => `<g transform="translate(${cx - 15.4} ${cy - 15.8}) scale(0.0067)">
  <circle cx="2293.58" cy="2356.58" r="2088" fill="${C.ink}"/>
  <rect x="2293.68" y="1094" width="722" height="1486" rx="361" transform="rotate(21.0472 2293.68 1094)" fill="#fff"/>
  <rect x="3602.03" y="1689.49" width="574.157" height="1346.14" rx="287.079" transform="rotate(21.0472 3602.03 1689.49)" fill="#fff"/></g>`;

const W = 1200, H = 720;
const STAGE = { x: 280, y: 88, w: 580, h: 380 };
const TL = { x: 256, w: 900 }; // the time axis inside the timeline card
const xAt = (ms: number) => TL.x + (ms / DUR) * TL.w;

/** The layer panel: the rig as a tree, top of the draw order first. */
function layers(): string {
  const nodes = Object.values(project.rig.nodes);
  const rows: { name: string; depth: number; id: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of nodes.filter((x) => x.parentId === parent).sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))) {
      rows.push({ name: n.name, depth, id: n.id });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows.slice(0, 10).map((r, i) => {
    const y = 136 + i * 32;
    const on = r.id === 'body';
    return (on ? pill(32, y - 21, 224, 30, C.container, 12) : '')
      + `<circle cx="${50 + r.depth * 18}" cy="${y - 6}" r="5" fill="none" stroke="${on ? C.onContainer : C.muted}" stroke-width="2"/>`
      + t(64 + r.depth * 18, y, r.name, { size: 17, fill: on ? C.onContainer : C.ink, weight: on ? 600 : 400 });
  }).join('');
}

/** The inspector for the selected body, its numbers read off the rig evaluated at `ms`. */
function inspector(ms: number): string {
  const body = evaluateRig(project, ms).nodes.body!;
  const tabs = ['Design', 'Effects', 'Eyes', 'States', 'AI'];
  const tabRow = tabs.map((name, i) => {
    const x = 888 + i * 56;
    return (i === 0 ? pill(x - 4, 102, 64, 32, C.secondary) : '') + t(x + 28, 123, name, { size: 14, anchor: 'middle', weight: i === 0 ? 600 : 400, fill: i === 0 ? C.ink : C.variant });
  }).join('');
  const sq = body.squish ?? { x: 1, y: 1 };
  const off = body.surface.flatOffset ?? { x: 0, y: 0 };
  const field = (x: number, y: number, label: string, value: string, keyed: boolean) =>
    t(x, y, label, { size: 15, fill: C.muted })
    + pill(x + 22, y - 19, 96, 28, C.field, 8) + t(x + 34, y, value, { size: 16, mono: true })
    + `<path d="M${x + 106} ${y - 11} l5 5 l-5 5 l-5 -5 z" fill="${keyed ? C.accent : 'none'}" stroke="${C.accent}" stroke-width="1.5"/>`;
  const slider = (y: number, label: string, v: number) => {
    const frac = (v - 0.4) / 1.4;
    return t(896, y, label, { size: 15, fill: C.muted }) + pill(980, y - 9, 164, 6, '#EBE1D8', 3)
      + pill(980, y - 9, 164 * frac, 6, C.accent, 3) + `<circle cx="${980 + 164 * frac}" cy="${y - 6}" r="8" fill="${C.accent}"/>`
      + t(1160, y, v.toFixed(2), { size: 15, mono: true, anchor: 'end' });
  };
  return tabRow
    + t(896, 168, 'Transform', { size: 17, weight: 700 })
    + field(896, 204, 'X', off.x.toFixed(0), false) + field(1036, 204, 'Y', off.y.toFixed(0), true)
    + field(896, 244, 'R', `${body.transform.rotation.toFixed(1)}°`, true) + field(1036, 244, 'S', body.transform.scale.x.toFixed(2), false)
    + `<line x1="896" y1="270" x2="1160" y2="270" stroke="${C.line}"/>`
    + t(896, 298, 'Squash & stretch', { size: 17, weight: 700 })
    + slider(332, 'Squish X', sq.x) + slider(364, 'Squish Y', sq.y)
    + `<line x1="896" y1="388" x2="1160" y2="388" stroke="${C.line}"/>`
    + pill(892, 402, 268, 50, C.canvas, 16)
    + `<circle cx="916" cy="427" r="6" fill="#2E7D4F"/>` + t(932, 424, 'Claude is connected', { size: 15, weight: 700 })
    + t(932, 443, 'edits through MCP save as they land', { size: 13, fill: C.muted });
}

/** The tool strip floating on the stage: select, hand, shape, pen, text, turn. */
function tools(): string {
  const cx = STAGE.x + STAGE.w / 2, y = STAGE.y + STAGE.h - 34;
  const icons = [
    'M-5 -7 L6 1 L1 2 L4 8 L1 9 L-2 3 L-5 6 Z',                       // select
    'M-6 2 v-5 a1.5 1.5 0 0 1 3 0 v3 v-6 a1.5 1.5 0 0 1 3 0 v6 v-5 a1.5 1.5 0 0 1 3 0 v7 a6 6 0 0 1 -6 6 h-1 a5 5 0 0 1 -4 -3 z', // hand
    'M-6 -6 h12 v12 h-12 z',                                           // shape
    'M-6 7 L-3 -1 L4 -8 L8 -4 L1 3 Z',                                 // pen
    'M-6 -6 h12 M0 -6 v13',                                            // text
    'M-6 0 a6 6 0 1 1 3 5.2 M-6 5 v-5 h5',                            // turn
  ];
  return pill(cx - 150, y - 22, 300, 44, '#2a2730')
    + icons.map((d, i) => {
      const x = cx - 125 + i * 50;
      return (i === 0 ? `<circle cx="${x}" cy="${y}" r="17" fill="${C.primary}"/>` : '')
        + `<path transform="translate(${x} ${y})" d="${d}" fill="none" stroke="${i === 0 ? C.onPrimary : '#E8DED4'}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
}

/** Clip lane + four keyframe lanes, with the preset's real key times; keys behind the playhead are filled. */
function timeline(ms: number): string {
  const lanes: [string, string, string][] = [
    ['Body · roll', 'body', 'transform.rotation'],
    ['Body · squish', 'body', 'squish.x'],
    ['Face · roll', 'face', 'transform.rotation'],
    ['Hand R · bend', 'armR', 'limb.bend'],
  ];
  const ruler = [0, 500, 1000, 1500, 2000, 2500].map((m) =>
    `<line x1="${xAt(m)}" y1="538" x2="${xAt(m)}" y2="546" stroke="${C.muted}"/>` + t(xAt(m) + 4, 546, `${m / 1000}s`, { size: 13, fill: C.muted, mono: true })).join('');
  const rows = lanes.map(([label, nodeId, prop], i) => {
    const y = 604 + i * 24;
    const keys = tracks.find((k) => k.nodeId === nodeId && k.property === prop)?.keyframes ?? [];
    return (i % 2 ? '' : `<rect x="32" y="${y - 12}" width="1136" height="24" rx="6" fill="${C.canvas}" opacity="0.6"/>`)
      + t(48, y + 5, label, { size: 15, fill: C.variant })
      + keys.map((k) => `<path d="M${xAt(k.time)} ${y - 6} l6 6 l-6 6 l-6 -6 z" fill="${k.time <= ms ? C.accent : C.card}" stroke="${C.accent}" stroke-width="1.5"/>`).join('');
  }).join('');
  const px = xAt(ms);
  return pill(24, 484, 1152, 212, C.card, 16)
    + `<circle cx="52" cy="512" r="16" fill="${C.primary}"/><path d="M47 504 L59 512 L47 520 Z" fill="${C.onPrimary}"/>`
    + t(80, 518, `${(ms / 1000).toFixed(2)} s`, { size: 17, mono: true, weight: 700 }) + t(160, 518, `/ ${(DUR / 1000).toFixed(2)} s`, { size: 17, mono: true, fill: C.muted })
    + pill(1060, 498, 100, 28, C.canvas) + t(1110, 517, 'Graph', { size: 15, anchor: 'middle', fill: C.variant })
    + ruler
    + t(48, 574, 'Mascot', { size: 15, weight: 700 })
    + pill(TL.x, 556, TL.w, 28, C.primary, 8) + t(TL.x + 14, 575, preset.name, { size: 15, weight: 600, fill: C.onPrimary })
    + rows
    + `<line x1="${px}" y1="532" x2="${px}" y2="688" stroke="${C.accent}" stroke-width="2"/><path d="M${px - 7} 528 h14 v6 l-7 7 l-7 -7 z" fill="${C.accent}"/>`;
}

/** The real frame, cropped to the stage's shape and centred on the mascot. */
function stage(ms: number): string {
  const comp = compOf(project);
  const ww = comp.width * 1.2, wh = ww * (STAGE.h / STAGE.w); // a little room round the wave
  const frame = frameSvg(project, ms, null, { x: (comp.width - ww) / 2, y: (comp.height - wh) / 2 + 10, width: ww, height: wh })
    .replace(/^<svg ([^>]*?)width="[^"]*" height="[^"]*"/, `<svg $1x="${STAGE.x}" y="${STAGE.y}" width="${STAGE.w}" height="${STAGE.h}"`);
  return `<rect x="${STAGE.x}" y="${STAGE.y}" width="${STAGE.w}" height="${STAGE.h}" rx="28" fill="${C.stage}"/>`
    + `<g clip-path="url(#stage)">${frame}</g>` + tools();
}

function editor(ms: number): string {
  const states = ['Idle', 'Hello', 'Celebrate'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
<title id="title">The blooby editor</title>
<desc id="desc">The blooby editor playing the Hello Wave preset: layers on the left, the mascot waving on the dark stage, its transform and squash in the inspector, and the preset's keyframes on the timeline.</desc>
<defs><clipPath id="stage"><rect x="${STAGE.x}" y="${STAGE.y}" width="${STAGE.w}" height="${STAGE.h}" rx="28"/></clipPath></defs>
<rect width="${W}" height="${H}" rx="28" fill="${C.canvas}"/>
${mark(48, 48)}${t(74, 56, 'blooby', { size: 22, weight: 700 })}${t(150, 56, '/  Hello', { size: 18, fill: C.muted })}
${pill(474, 30, 252, 36, C.card)}${states.map((s, i) => (i === 1 ? pill(474 + 4 + i * 82, 34, 80, 28, C.inverse) : '') + t(474 + 44 + i * 82, 54, s, { size: 15, anchor: 'middle', weight: i === 1 ? 600 : 400, fill: i === 1 ? C.onInverse : C.variant })).join('')}
${t(1036, 54, 'Share', { size: 16, anchor: 'middle', fill: C.variant })}${pill(1076, 28, 100, 40, C.primary)}${t(1126, 54, 'Export', { size: 16, anchor: 'middle', weight: 600, fill: C.onPrimary })}
${pill(24, 88, 240, 380, C.card, 16)}${t(40, 116, 'Layers', { size: 17, weight: 700 })}<g transform="translate(0 16)">${layers()}</g>
${stage(ms)}
${pill(876, 88, 300, 380, C.card, 16)}${inspector(ms)}
${timeline(ms)}
</svg>`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'editor.svg'), editor(STILL_MS));

/** Render `n` frames of `svgAt` and encode them as one looping GIF. */
function gif(file: string, width: number, svgAt: (ms: number) => string, dur: number, fps = FPS) {
  const n = Math.round((dur / 1000) * fps);
  const frames = mkdtempSync(join(tmpdir(), 'readme-hero-'));
  for (let i = 0; i < n; i++) {
    const png = new Resvg(svgAt((i / n) * dur), { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render().asPng();
    writeFileSync(join(frames, `${String(i).padStart(3, '0')}.png`), png);
  }
  // one palette for the whole loop, no dithering (flat UI), and only the changed rectangle per frame
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(frames, '%03d.png'),
    '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    '-loop', '0', join(OUT, file)]);
  rmSync(frames, { recursive: true });
}

gif('editor.gif', W, editor, DUR);
console.log('wrote docs/readme/editor.svg and editor.gif');

// --- the showcase: the complex presets, each captioned with what it is made of ------------

const SHOWCASE = ['p_cine_portal', 'p_cine_walk', 'p_cine_particles', 'p_cine_morph', 'p_cine_liquid', 'p_cine_glitch',
  'p_cine_doodle', 'p_cine_title', 'p_cine_flip', 'p_friends', 'p_dance', 'p_txt_curved'];
const SIDE = 300;

const MODS: Record<string, string> = { shake: 'shake', follow: 'follow-through', jelly: 'jelly', walk: 'walk cycle', float: 'float', pendulum: 'pendulum', stretch: 'stretch' };
/** What a preset is made of, read off its data: the systems its layers use, then its keyed properties. */
function madeOf(p: Preset): { uses: string[]; keys: string[] } {
  const uses = new Set<string>();
  for (const n of p.layers ?? []) {
    if (n.kind === 'body') uses.add('a second mascot');
    if (n.limb) uses.add('rubber-hose limbs');
    if (n.text) uses.add(n.text.path ? 'text on a path' : 'text');
    if (n.curve) uses.add('drawn curves');
    for (const e of n.effects ?? []) uses.add(e.kind.replace(/([A-Z])/g, ' $1').toLowerCase());
    if (n.blend && n.blend !== 'normal') uses.add(`${n.blend} blend`);
    if (n.mask) uses.add('mask');
    if (n.gradient) uses.add('gradient');
    if (n.depth) uses.add('2.5D depth');
  }
  for (const e of p.emitters ?? []) uses.add(e.attract ? 'particles that gather' : e.path === 'burst' ? 'particle burst' : 'particles');
  for (const m of p.modifiers ?? []) uses.add(m.nodeId === CAMERA_ID ? 'camera shake' : MODS[m.kind] ?? m.kind);
  // x/y pairs and per-letter keys read as one property each
  const keys = [...new Set(p.tracks.map((t) => (t.nodeId === CAMERA_ID && !t.property.startsWith('camera') ? 'camera.' : '')
    + t.property.replace(/^text\.char\.\d+\./, 'text.char.*.').replace(/\.(x|y)$/, '').replace(/^text\.char\.\*\..*/, 'text.char.*')))];
  return { uses: [...uses], keys };
}

const cells: string[] = [];
for (const id of SHOWCASE) {
  const p = [...builtinPresets(), ...mascotKitPresets()].find((x) => x.id === id)!;
  const proj = presetPreviewProject(defaultProject(), p);
  const file = `preset-${id.replace(/^p_(cine_|txt_)?/, '')}.gif`;
  // the frame as the renderer writes it: resvg cannot draw some of them nested in another <svg>
  gif(file, SIDE, (ms) => frameSvg(proj, ms, C.stage), p.durationMs, 15);
  const { uses, keys } = madeOf(p);
  cells.push(`<td width="33%" valign="top"><img src="docs/readme/${file}" width="100%" alt="${esc(p.name)}" /><br /><b>${esc(p.name)}</b> <sub>${(p.durationMs / 1000).toFixed(1)} s</sub><br /><sub>${esc(uses.join(' · '))}</sub><br /><sub>${keys.map((k) => `<code>${esc(k)}</code>`).join(' ')}</sub></td>`);
  console.log(`wrote ${file} — ${p.name}`);
}
const table = `<table>\n${Array.from({ length: Math.ceil(cells.length / 3) }, (_, r) => `<tr>\n${cells.slice(r * 3, r * 3 + 3).join('\n')}\n</tr>`).join('\n')}\n</table>`;
const readme = join(OUT, '../../README.md');
const md = readFileSync(readme, 'utf8');
writeFileSync(readme, md.replace(/(<!-- showcase:start[^>]*-->)[\s\S]*?(<!-- showcase:end -->)/, `$1\n${table}\n$2`));
console.log('wrote the showcase table into README.md');
process.exit(0);
