import { it } from 'vitest';
import { check } from './testkit';
import { confetti, defaultProject } from './defaults';
import { NUMERIC_PROPS, PROP_ALIAS, PROPS, readEffectProp, readProp, resolveProp, writeEffectProp, writeProp } from './props';
import { MODIFIER_KINDS, MODIFIERS } from './types';
import { validate } from '../copilot/tools';
import { activeTimeline } from './types';

// --- the registries: one table, and everything downstream derives from it -------
{
  // The contract COPILOT.md states: add a row to PROPS plus a case in
  // getProp/setProp, and the property is animatable, inspectable AND known to the agent.
  // These two checks are what make that a guarantee rather than a note in a file.
  const rig = defaultProject().rig;
  // the same guarantee for an effect's own properties, which live on the timeline rather
  // than in the rig and so have their own read/write pair
  const fxProject = defaultProject();
  const fxTl = activeTimeline(fxProject);
  fxTl.emitters = [{ ...confetti('body'), id: 'probeEm' }];
  fxTl.modifiers = [{ id: 'probeMod', nodeId: 'body', kind: 'shake', amount: 50, frequency: 2, amplitude: 8 }];

  const missing = NUMERIC_PROPS.filter((path) => {
    const spec = PROPS[path];
    const probe = (spec.range![0] + spec.range![1]) / 2;
    if (spec.on === 'effect') {
      // amount/frequency/amplitude belong to a modifier, everything else to an emitter
      const id = ['fx.amount', 'fx.frequency', 'fx.amplitude'].includes(path) ? 'probeMod' : 'probeEm';
      writeEffectProp(fxTl, id, path, probe);
      return readEffectProp(fxTl, id, path) !== probe;
    }
    const nodeId = spec.on === 'camera' ? '__camera' : (path.startsWith('eye.') ? 'eyeL' : rig.rootId);
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
