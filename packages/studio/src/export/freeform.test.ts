import { it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { check } from '../core/testkit';
import { defaultProject, makeTimeline } from '../core/defaults';
import { compOf } from '../core/comp';
import { makeLimb, makeShapeLayer, makeSvgLayer, setAppearance, setAttachment } from '../core/layers';
import { sceneAt, type SceneItem } from '../core/scene';
import { libraryOutline } from '../core/emitters';
import { pathBounds } from '../core/path';
import { activeTimeline } from '../core/types';
import { Shapes } from '../ui/Mascot';
import { bakeLottie } from './lottie';
import { buildDotLottie } from './dotlottie';
import { unzip } from './zip';
import type { ColorStop, Keyframe, KeyValue, Project, RigNode } from '../core/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const k = (time: number, value: KeyValue): Keyframe => ({ id: `k${time}${Math.random()}`, time, value, easingOut: { type: 'preset', name: 'easeInOut' } });
const c = (r: number, g: number, b: number): ColorStop => ({ r, g, b, a: 1 });

/** Every new kind of thing the editor can draw, in one project, animated. */
function freeform(): Project {
  const p = defaultProject();
  p.composition = { width: 1080, height: 720 };
  const tl = activeTimeline(p);
  Object.assign(tl, { tracks: [], blocks: [], modifiers: [], durationOverrideMs: 1000, timelineDurationMs: 1000 });

  p.rig.nodes.star = makeShapeLayer('star', { id: 'star', name: 'Star', stroke: { enabled: true, color: c(0, 0, 0), width: 4, lineCap: 'round', lineJoin: 'round' } });
  tl.tracks.push(
    // fill and stroke, keyed on their OWN tracks at the same times, going opposite ways
    { id: 'f', nodeId: 'star', property: 'color', keyframes: [k(0, c(40, 80, 230)), k(500, c(240, 130, 190))] },
    { id: 's', nodeId: 'star', property: 'stroke.color', keyframes: [k(0, c(0, 0, 0)), k(500, c(255, 255, 255))] },
    { id: 'r', nodeId: 'star', property: 'transform.rotation', keyframes: [k(0, 0), k(1000, 90)] },
  );

  const badge = makeSvgLayer('<svg viewBox="0 0 40 20"><rect width="18" height="20" fill="#ff0000"/><circle cx="30" cy="10" r="10" fill="#0000ff" stroke="#00ff00" stroke-width="2"/></svg>', 'Badge')!.node;
  p.rig.nodes.badge = { ...badge, id: 'badge', surface: { yaw: 0, pitch: 0, mapped: false, flatOffset: { x: 40, y: -60 } } };
  setAttachment(p, 'badge', 'mascot', undefined, 0);
  setAppearance(p, 'badge', { startMs: 300, endMs: 800, fadeInMs: 100 }, 0);

  p.rig.nodes.armR = makeLimb('arm', 1, 'body', { id: 'armR', name: 'Right hand' });
  p.rig.nodes.legL = makeLimb('leg', -1, 'body', { id: 'legL', name: 'Left leg' });
  tl.tracks.push({ id: 'w', nodeId: 'armR', property: 'limb.b.y', keyframes: [k(0, 96), k(400, -120), k(700, -120)] });
  tl.tracks.push({ id: 'm', nodeId: 'body', property: 'shape.path', keyframes: [k(0, libraryOutline('circle')!), k(600, libraryOutline('octopus')!)] });

  // artwork with nothing in it that can become an outline
  const pic: RigNode = { ...badge, id: 'pic', name: 'Pic', svg: { sourceMarkup: '<text>hi</text>', viewBox: '0 0 10 10' } };
  p.rig.nodes.pic = pic;
  return p;
}

const p = freeform();
const view = compOf(p);
const baked = bakeLottie(p, { background: null, name: 'freeform' });
const j = baked.json as any;
const layers = j.layers as any[];
const byName = (n: string) => layers.find((l) => l.nm === n);
const items = (it: any[]): any[] => it.flatMap((x) => (x.ty === 'gr' ? items(x.it) : [x]));

// --- the composition and the layer list ---------------------------------------------
it('the Lottie is the composition size, not 720×720', check(j.w === 1080 && j.h === 720, `${j.w}×${j.h}`));
const drawn = new Set<string>();
for (let f = 0; f <= baked.frames; f++) for (const s of sceneAt(p, (f / p.fps) * 1000, view)) drawn.add(s.name);
const exported = new Set(layers.map((l) => l.nm));
const missing = [...drawn].filter((n) => !exported.has(n) && !baked.skipped.includes(n));
it('no layer the editor draws is silently left out', check(missing.length === 0, missing.join(', ')));
it('the one that cannot be carried is named, not dropped', check(baked.skipped.join() === 'Pic', baked.skipped.join()));
it('and is not faked as a rounded rectangle', check(!byName('Pic')));

// --- fill and stroke are separate, native, and animated independently -----------------
{
  const star = items(byName('Star').shapes);
  const fl = star.find((x) => x.ty === 'fl'), st = star.find((x) => x.ty === 'st');
  it('a stroked shape exports a real Lottie stroke', check(!!st && !!fl));
  it('its fill colour is animated on its own channel', check(fl.c.a === 1, JSON.stringify(fl.c).slice(0, 60)));
  it('and its stroke colour on another', check(st.c.a === 1));
  it('going opposite ways, as keyed', check(fl.c.k[0].s[2] > 0.8 && st.c.k[0].s[0] < 0.05 && st.c.k.at(-1).s[0] > 0.95));
  it('with the stroke over the fill, as SVG draws it', check(star.indexOf(st) < star.indexOf(fl)));
  it('round caps and joins are carried', check(st.lc === 2 && st.lj === 2));
  it('the star is a bezier outline, not a primitive', check(star.some((x) => x.ty === 'sh')));
}

// --- imported vector art keeps its own paints ---------------------------------------
{
  const groups = byName('Badge').shapes as any[];
  const fills = groups.map((g) => items(g.it).find((x) => x.ty === 'fl')?.c.k).filter(Boolean);
  it('each imported path keeps its own colour', check(fills.some((f) => f[0] === 1 && f[2] === 0) && fills.some((f) => f[2] === 1 && f[0] === 0), JSON.stringify(fills)));
  const green = groups.flatMap((g) => items(g.it)).find((x) => x.ty === 'st');
  it('and its own stroke', check(!!green && green.c.k[1] === 1 && green.w.k > 0));
  it('the path drawn last is on top', check(items(groups[0].it).find((x) => x.ty === 'fl').c.k[2] === 1));
  const o = byName('Badge').ks.o;
  const at = (ms: number) => {
    if (o.a === 0) return o.k;
    const f = (ms / 1000) * p.fps;
    let v = o.k[0].s[0];
    for (const key of o.k) if (key.t <= f) v = key.s[0];
    return v;
  };
  it('its appearance range reaches the file: invisible before it', check(at(100) === 0, String(at(100))));
  it('and visible inside it', check(at(600) > 99, String(at(600))));
  it('and gone after it', check(at(950) === 0, String(at(950))));
}

// --- procedural geometry is baked, then thinned ----------------------------------------
{
  const arm = items(byName('Right hand').shapes).find((x) => x.ty === 'sh');
  it('a rubber-hose limb is baked to animated path keyframes', check(arm?.ks.a === 1));
  it('and the frames it holds still are not written out', check(arm.ks.k.length < baked.frames * 0.8, `${arm.ks.k.length} of ${baked.frames + 1}`));
  it('every vertex it writes is finite', check(arm.ks.k.every((kk: any) => kk.s[0].v.flat().every(Number.isFinite))));
  const leg = items(byName('Left leg').shapes).filter((x) => x.ty === 'sh');
  it('a leg exports its foot as a second outline, not joined by a stray edge', check(leg.length === 2));
  const body = items(byName('Body').shapes).find((x) => x.ty === 'sh');
  it('the body shape morph is baked', check(body?.ks.a === 1));
}

// --- read it back like a player, and compare to the canvas ----------------------------
{
  const read = (pr: any, frame: number): number[] => {
    if (pr.a !== 1) return Array.isArray(pr.k) ? pr.k : [pr.k];
    const ks = pr.k;
    if (frame <= ks[0].t) return ks[0].s;
    if (frame >= ks[ks.length - 1].t) return ks[ks.length - 1].s;
    let i = 0;
    while (i < ks.length - 1 && ks[i + 1].t <= frame) i++;
    const u = (frame - ks[i].t) / (ks[i + 1].t - ks[i].t);
    return ks[i].s.map((v: number, d: number) => v + (ks[i + 1].s[d] - v) * u);
  };
  const readVerts = (sh: any, frame: number): number[][] => {
    if (sh.ks.a !== 1) return sh.ks.k.v;
    const ks = sh.ks.k;
    if (frame <= ks[0].t) return ks[0].s[0].v;
    if (frame >= ks[ks.length - 1].t) return ks[ks.length - 1].s[0].v;
    let i = 0;
    while (i < ks.length - 1 && ks[i + 1].t <= frame) i++;
    const u = (frame - ks[i].t) / (ks[i + 1].t - ks[i].t);
    return ks[i].s[0].v.map((v: number[], n: number) => [v[0] + (ks[i + 1].s[0].v[n][0] - v[0]) * u, v[1] + (ks[i + 1].s[0].v[n][1] - v[1]) * u]);
  };
  let worstPos = 0, worstSize = 0;
  for (let f = 0; f <= baked.frames; f += 3) {
    const truth = sceneAt(p, (f / p.fps) * 1000, view);
    for (const name of ['Star', 'Badge', 'Right hand', 'Left leg', 'Body']) {
      const item: SceneItem | undefined = truth.find((t) => t.name === name);
      const l = byName(name);
      if (!item || !l) continue;
      const [px, py] = read(l.ks.p, f);
      worstPos = Math.max(worstPos, Math.abs(px - item.cx), Math.abs(py - item.cy));
      // the drawn width: the outline's own extent in the file, times the layer's scale,
      // against the same outline's extent on the canvas — a star does not fill its box
      const [sx] = read(l.ks.s, f);
      const shapes = items(l.shapes).filter((x) => x.ty === 'sh');
      const xs = shapes.flatMap((sh) => readVerts(sh, f).map((v) => v[0]));
      const w = ((Math.max(...xs) - Math.min(...xs)) * sx) / 100;
      const unit = item.path ?? item.paths?.map((q) => q.d).join(' ') ?? '';
      const b = pathBounds(unit);
      const truthW = b ? (b.x1 - b.x0) * item.w : item.w;
      worstSize = Math.max(worstSize, Math.abs(w - truthW) / Math.max(1, truthW));
    }
  }
  it('every freeform layer plays back where the canvas draws it, within a pixel', check(worstPos < 1, `${worstPos.toFixed(3)}px`));
  it('at the size the canvas draws it, within 3%', check(worstSize < 0.03, `${(worstSize * 100).toFixed(2)}%`));
}

// --- GIF / MP4 / PNG render through the same Shapes, so they carry the same paint -------
{
  const svg = renderToStaticMarkup(Shapes({ scene: sceneAt(p, 500, view) }));
  it('the raster renderer draws the stroke', check(/stroke="rgba\(/.test(svg)));
  it('and each imported path with its own colour', check(svg.includes('rgba(255,0,0,') && svg.includes('rgba(0,0,255,')));
  it('and no NaN anywhere in the frame', check(!svg.includes('NaN')));
}

// --- dotLottie: the freeform layers ride the strip, and the machine still loads --------
{
  const two = freeform();
  const second = makeTimeline('Wave');
  second.timelineDurationMs = 800;
  two.timelines.push(second);
  two.stateMachine = {
    id: 'mascot', initialStateId: two.timelines[0].id,
    inputs: [{ name: 'state', type: 'String', value: '' }],
    transitions: [{ id: 't', from: two.timelines[0].id, to: second.id, logic: 'AND', durationMs: 300, conditions: [{ input: 'state', operator: 'Equal', value: 'Wave' }] }],
  };
  const files = await unzip(new Uint8Array(await buildDotLottie(two, { background: null }).blob.arrayBuffer()) as Uint8Array<ArrayBuffer>);
  const anim = JSON.parse(new TextDecoder().decode(files.get('a/mascot.json')!));
  const machine = JSON.parse(new TextDecoder().decode(files.get('s/mascot.json')!));
  it('the .lottie composition is the project\'s size', check(anim.w === 1080 && anim.h === 720));
  it('every state points into one composition by marker name', check(machine.states.every((s: any) => s.animation === 'mascot' && typeof s.segment === 'string')));
  it('every marker exists', check(machine.states.every((s: any) => anim.markers.some((m: any) => m.cm === s.segment))));
  it('and every layer spans the whole strip, so a tween can scrub through', check(anim.layers.every((l: any) => l.ip === 0 && l.op === anim.op + 1)));
}
