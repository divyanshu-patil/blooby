import { it } from 'vitest';
import { check } from './testkit';
import { confetti, defaultProject } from './defaults';
import { getCameraProp, getProp, setProp, NUMERIC_PROPS, PROP_ALIAS, PROPS, readEffectProp, readProp, resolveProp, writeEffectProp, writeProp } from './props';
import { MODIFIER_KINDS, MODIFIERS } from './types';
import { validate } from '../copilot/tools';
import { activeTimeline } from './types';
import { makeLimb, makeTextLayer } from './layers';
import { EFFECT_KINDS, makeEffect } from './effects';

// --- the registries: one table, and everything downstream derives from it -------
{
  // The contract COPILOT.md states: add a row to PROPS plus a case in
  // getProp/setProp, and the property is animatable, inspectable AND known to the agent.
  // These two checks are what make that a guarantee rather than a note in a file.
  const rig = defaultProject().rig;
  // a leg has every limb property there is — the foot and the ankle included
  rig.nodes.legProbe = makeLimb('leg', 1, rig.rootId, { id: 'legProbe' });
  // …with every point pinned, so each pin's position has somewhere to live
  rig.nodes.legProbe.limb!.pin = { x: 0, y: 0 };
  rig.nodes.legProbe.limb!.pins = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } };
  // and a text layer has every typography property
  rig.nodes.textProbe = makeTextLayer('probe', { id: 'textProbe' });
  // and the body wears every effect and a gradient, so their params have somewhere to live
  rig.nodes[rig.rootId].effects = EFFECT_KINDS.map(makeEffect);
  rig.nodes[rig.rootId].gradient = { type: 'linear', angle: 0, stops: [] };
  // the same guarantee for an effect's own properties, which live on the timeline rather
  // than in the rig and so have their own read/write pair
  const fxProject = defaultProject();
  const fxTl = activeTimeline(fxProject);
  fxTl.emitters = [{ ...confetti('body'), id: 'probeEm' }];
  fxTl.modifiers = [{ id: 'probeMod', nodeId: 'body', kind: 'shake', amount: 50, frequency: 2, amplitude: 8 }];

  const missing = NUMERIC_PROPS.filter((path) => {
    const spec = PROPS[path];
    // the midpoint, snapped to the property's own step — an on/off switch only holds 0 or 1
    const [min, max, step] = spec.range!;
    const probe = +(Math.round((min + max) / 2 / step) * step).toFixed(6);
    if (spec.on === 'effect') {
      // amount/frequency/amplitude belong to a modifier, everything else to an emitter
      const id = ['fx.amount', 'fx.frequency', 'fx.amplitude'].includes(path) ? 'probeMod' : 'probeEm';
      writeEffectProp(fxTl, id, path, probe);
      return readEffectProp(fxTl, id, path) !== probe;
    }
    const nodeId = spec.on === 'camera' ? '__camera'
      : path.startsWith('eye.') ? 'eyeL' : path.startsWith('limb.') ? 'legProbe' : path.startsWith('text.') ? 'textProbe' : rig.rootId;
    writeProp(rig, nodeId, path, probe);
    return readProp(rig, nodeId, path) !== probe;
  });
  it('every PROPS row round-trips through get/setProp', check(missing.length === 0, missing.join(', ')));

  it('every PROPS row has a help line the prompt can use', check(Object.entries(PROPS).every(([, s]) => s.help.length > 20 && s.label.length > 0)));

  // a short name must resolve, and an ambiguous one must NOT be guessed
  it('"openness" resolves to eye.openness', check(resolveProp('openness') === 'eye.openness'));
  it('"rotation" resolves to transform.rotation', check(resolveProp('rotation') === 'transform.rotation'));
  it('"scale.x" resolves to transform.scale.x', check(resolveProp('scale.x') === 'transform.scale.x'));
  it('a full path resolves to itself', check(resolveProp('surface.yaw') === 'surface.yaw'));
  it('an ambiguous tail is refused, not guessed', check(PROP_ALIAS.x === undefined && PROP_ALIAS.y === undefined));
  it('junk stays junk', check(resolveProp('vibes') === undefined));

  // every effect the renderer implements must be one the copilot may ask for
  const proj = defaultProject();
  const unreachable = MODIFIER_KINDS.filter((kind) =>
    validate(proj, { name: 'add_modifier', args: { nodeId: 'body', kind, amount: 100, frequency: 1, amplitude: 6 } }) !== null);
  it('every MODIFIERS kind is accepted by the copilot', check(unreachable.length === 0, unreachable.join(', ')));
  it('every MODIFIERS kind has a help line', check(MODIFIER_KINDS.every((k) => MODIFIERS[k].help.length > 20)));
  it('and an unknown effect is still refused', check(validate(proj, { name: 'add_modifier', args: { nodeId: 'body', kind: 'wobble' } }) !== null));
}

// --- the fallbacks: nodes missing the optional parts a property lives in --------------------
{
  const rig = defaultProject().rig;
  const body = rig.nodes[rig.rootId];
  const arm = makeLimb('arm', 1, rig.rootId, { id: 'armP' });
  const leg = makeLimb('leg', 1, rig.rootId, { id: 'legP' });
  const text = makeTextLayer('hi', { id: 'textP' });
  const num = (n: typeof body, path: string, v: number) => { setProp(n, path, v); return getProp(n, path); };
  // limbs
  it('limb props on a non-limb read nothing and write nothing', check(getProp(body, 'limb.hose') === undefined && (setProp(body, 'limb.hose', 1), true)));
  it('unknown limb path reads nothing', check(getProp(leg, 'limb.zzz') === undefined && (setProp(leg, 'limb.zzz', 1), true)));
  it('NaN is ignored', check((setProp(arm, 'limb.hose', NaN), arm.limb!.hose === 1)));
  it('a two-point limb has no c and no foot', check(
    (setProp(arm, 'limb.c.x', 5), getProp(arm, 'limb.c.x') === undefined)
    && (setProp(arm, 'limb.foot.angle', 5), setProp(arm, 'limb.foot.length', 5), setProp(arm, 'limb.foot.width', 5), true)));
  it('a pin that is not there is not made', check((setProp(arm, 'limb.pin.b.x', 5), arm.limb!.pin === undefined && getProp(arm, 'limb.pin.b.x') === undefined)));
  it('toggling a missing pin does nothing', check((setProp(arm, 'limb.pin.b.on', 0), arm.limb!.pinOff === undefined)));
  arm.limb!.pin = { x: 1, y: 2 };
  it('pin held (no pinOff yet) is a no-op; let go then hold again clears pinOff', check(
    (setProp(arm, 'limb.pin.b.on', 1), arm.limb!.pinOff === undefined)
    && (setProp(arm, 'limb.pin.b.on', 0), (arm.limb!.pinOff as { b?: number } | undefined)?.b === 1)
    && (setProp(arm, 'limb.pin.b.on', 1), arm.limb!.pinOff === undefined)));
  arm.limb!.pinOff = { a: 0.5, b: 0.5 };
  arm.limb!.pins = { a: { x: 0, y: 0 } };
  it('holding one pin again keeps the others let go', check((setProp(arm, 'limb.pin.b.on', 1), Object.keys(arm.limb!.pinOff!).join() === 'a')));
  // text
  it('text props on a non-text node', check(getProp(body, 'text.size') === undefined && (setProp(body, 'text.size', 3), true)));
  it('unknown text path', check(getProp(text, 'text.zzz') === undefined));
  it('bad text values are refused', check(
    (setProp(text, 'text.content', 5 as never), text.text!.content === 'hi')
    && (setProp(text, 'text.font.family', '  '), text.text!.font.family !== '')
    && (setProp(text, 'text.font.family', 7 as never), true)
    && (setProp(text, 'text.chars.kind', 'zzz'), text.text!.chars === undefined)
    && (setProp(text, 'text.size', 'big' as never), text.text!.size !== undefined)
    && (setProp(text, 'text.size', Infinity), true)));
  it('chars: stagger first, kind kept after', check(
    num(text, 'text.chars.stagger', 3) === 1 && (text.text!.chars = undefined, true)
    && (setProp(text, 'text.chars.kind', 'pop'), getProp(text, 'text.chars.kind') === 'pop')));
  // optional parts
  it('blob seed, trim offset/end, gradient, eye, shape path', check(
    num(body, 'blob.seed', 3) === 3 && num(body, 'trim.offset', 0.3) === 0.3 && num(body, 'trim.end', 0.5) === 0.5
    && (body.trim = undefined, num(body, 'trim.offset', 0.3) === 0.3)
    && (body.trim = { start: 0, end: 1 }, num(body, 'trim.end', 0.4) === 0.4)
    && (body.gradient = undefined, setProp(body, 'gradient.angle', 4), getProp(body, 'gradient.angle') === undefined)
    && (setProp(body, 'eye.openness', 1), setProp(body, 'eye.distanceFromCenter', 1), getProp(body, 'eye.openness') === undefined)
    && (setProp(body, 'shape.path', 5 as never), body.shapePath === undefined)));
  it('effect params: only an existing effect, only numbers', check(
    (setProp(body, 'effect.glow.radius', 4), body.effects === undefined)
    && (body.effects = [makeEffect('glow')], setProp(body, 'effect.glow.radius', 'x' as never), true)));
  it('unknown plain path reads nothing', check(getProp(body, 'zzz') === undefined));
  it('camera fallback', check(getCameraProp(rig, 'camera.zzz') === 0 && readProp(rig, 'nope', 'opacity') === undefined));
  // effect props
  const tl = activeTimeline(defaultProject());
  tl.emitters = [{ ...confetti('body'), id: 'em' }];
  tl.modifiers = [{ id: 'mod', nodeId: 'body', kind: 'shake', amount: 5, frequency: 2, amplitude: 8 }];
  it('effects: missing id, modifier opacity, unset radiusY, defaults', check(
    readEffectProp(tl, 'zz', 'fx.speed') === undefined && (writeEffectProp(tl, 'zz', 'fx.speed', 1), true)
    && readEffectProp(tl, 'mod', 'fx.opacity') === undefined && (writeEffectProp(tl, 'mod', 'fx.opacity', 0.5), true)
    && readEffectProp(tl, 'mod', 'fx.amount') === 5
    && (writeEffectProp(tl, 'em', 'fx.opacity', 0.5), readEffectProp(tl, 'em', 'fx.opacity') === 0.5)
    && (writeEffectProp(tl, 'em', 'fx.radiusX', 40), readEffectProp(tl, 'em', 'fx.radiusY') === 40)
    && readEffectProp(tl, 'mod', 'fx.speed') === 1
    && (tl.emitters = undefined, readEffectProp(tl, 'mod', 'fx.amount') === 5)));
}
