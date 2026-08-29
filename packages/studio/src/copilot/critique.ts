import type { Project } from '../core/types';
import type { ToolCall } from './tools';

/**
 * Reads what the model produced and says what is wrong with it as animation.
 *
 * `validate` answers "will this corrupt the document". Everything it lets through is
 * legal and most of it is lifeless: a body that scales by 1.03, four layers moving on
 * identical frames, a pose passed through rather than held, a clip that ends somewhere
 * other than where it started. Craft advice in the prompt gets skimmed; a complaint about
 * the specific thing just produced does not.
 *
 * Its output feeds the same re-prompt loop `validate` uses, so a weak first answer is
 * revised once before the user ever sees it.
 *
 * Deliberately conservative — a false complaint costs a round trip and teaches nothing.
 * Magnitude is only ever questioned for a motion the user asked for by name.
 */

/** Words that name a motion, and the properties that would actually deliver it. */
const WANTED: { re: RegExp; props: string[]; label: string }[] = [
  { re: /\b(scale[sd]?|scaling|bigger|grows?|swells?|shrinks?|smaller|pops?)\b/i,
    props: ['transform.scale.x', 'transform.scale.y'], label: 'the body scaling' },
  { re: /\b(rotate[sd]?|rotation|tilts?|leans?|spins?|rolls?)\b/i,
    props: ['transform.rotation'], label: 'rotation' },
  { re: /\b(blinks?|winks?)\b/i, props: ['eye.openness'], label: 'a blink' },
  { re: /\b(wide[rn]?|round(ed)?|huge|enormous|big eyes)\b/i,
    props: ['transform.length', 'transform.scale.x', 'transform.scale.y'], label: 'the eyes widening' },
  { re: /\b(turns?|looks?|glances?)\b/i, props: ['surface.yaw', 'surface.pitch'], label: 'a head turn' },
  { re: /\b(nods?)\b/i, props: ['surface.pitch'], label: 'a nod' },
  { re: /\b(bounce[sd]?|hops?|floats?|bobs?)\b/i,
    props: ['flatOffset.y', 'transform.scale.y'], label: 'a bounce' },
];

/**
 * The smallest change that reads as the motion happening at all, per property.
 *
 * Not derived from PROPS.range: a range is what is *possible*, and 8% of scale's 0.05-3
 * range is a quarter — far more than "visible". These are what a viewer notices.
 */
const MIN_CHANGE: Record<string, number> = {
  'transform.scale.x': 0.08, 'transform.scale.y': 0.08,
  'transform.rotation': 5,
  'transform.length': 0.2,
  'eye.openness': 0.3,
  'eye.distanceFromCenter': 2,
  'surface.yaw': 8, 'surface.pitch': 8,
  'flatOffset.x': 8, 'flatOffset.y': 8,
  'size.x': 8, 'size.y': 8,
};

interface Key { time: number; value: number }
interface Track { nodeId: string; property: string; keys: Key[] }

/** Every track this batch introduces, in one flat list, with its keyframes sorted. */
function tracksIn(calls: ToolCall[]): Track[] {
  const out: Track[] = [];
  for (const c of calls) {
    if (c.name !== 'create_preset' && c.name !== 'edit_preset') continue;
    for (const raw of (c.args.tracks ?? []) as Record<string, unknown>[]) {
      const keys = ((raw?.keyframes ?? []) as Record<string, unknown>[])
        .map((k) => ({ time: Number(k.time) || 0, value: Number(k.value) }))
        .filter((k) => Number.isFinite(k.value))
        .sort((a, b) => a.time - b.time);
      if (keys.length) out.push({ nodeId: String(raw.nodeId), property: String(raw.property), keys });
    }
  }
  return out;
}

/** yaw, pitch and roll wrap; everything else is a plain number line. */
const isAngle = (p: string) => p.endsWith('rotation') || p.includes('yaw') || p.includes('pitch');

/** Does a track end on the pose it opened with? */
export function closes(property: string, first: number, last: number): boolean {
  if (!isAngle(property)) return Math.abs(first - last) < 1e-6;
  const d = ((last - first) % 360 + 360) % 360;
  return Math.min(d, 360 - d) < 1e-6;
}

const span = (t: Track) => Math.max(...t.keys.map((k) => k.value)) - Math.min(...t.keys.map((k) => k.value));

export function critique(p: Project, calls: ToolCall[], ask: string): string[] {
  const notes: string[] = [];
  const tracks = tracksIn(calls);
  if (!tracks.length) return notes;               // nothing preset-shaped to judge

  const isBody = (nodeId: string) => nodeId === p.rig.rootId;

  // 1. a motion the user named, with nothing animating it at all
  for (const w of WANTED) {
    if (!w.re.test(ask)) continue;
    const hit = tracks.filter((t) => w.props.includes(t.property));
    if (!hit.length) {
      notes.push(`The request asks for ${w.label} and no track animates it — add one on ${w.props.join(' or ')}.`);
      continue;
    }
    // 2. ...or animating it by an amount nobody would see
    const best = Math.max(...hit.map(span));
    const floor = Math.min(...hit.map((t) => MIN_CHANGE[t.property] ?? 0));
    if (best < floor) {
      notes.push(`${w.label} only changes by ${best.toFixed(2)}, which is invisible — it needs at least ${floor} to read, and the user named it, so go to the top of the range.`);
    }
  }

  // 3. the body specifically: "the mascot scales" means the body, not just the eyes
  if (/\b(mascot|body|he|she|it)\b/i.test(ask) && /\b(scale[sd]?|scaling|rotate[sd]?|rotation)\b/i.test(ask)) {
    const body = tracks.filter((t) => isBody(t.nodeId));
    if (!body.length) notes.push(`The request is about the mascot itself, but no track animates ${p.rig.rootId}.`);
  }

  // 4. a clip that ends somewhere other than where it started cannot loop or be followed.
  //
  // Angles compare modulo 360: a full spin ends on 360, which is the same pose it opened
  // on and must not be reported as drift. Caught by running this over the builtins.
  const drifting = tracks.filter((t) => !closes(t.property, t.keys[0].value, t.keys[t.keys.length - 1].value));
  if (drifting.length) {
    notes.push(`${drifting.map((t) => `${t.nodeId}.${t.property}`).join(', ')} end on a different value than they start on, so the clip cannot loop or be followed. Close each one back on its opening value.`);
  }

  // 5. nothing held: every pose passed straight through, so none of them read.
  //
  // Only asked of clips shaped like a single gesture. A blink or a talk cycle has no peak
  // to hold — the repetition IS the motion — and demanding a hold there would be asking
  // the model to make it worse. Caught by running this over the hand-authored builtins:
  // it complained about Blink and Talk, which are correct as they are.
  const gesture = tracks.every((t) => t.keys.length <= 5);
  const held = tracks.some((t) => t.keys.some((k, i) =>
    i > 0 && Math.abs(k.value - t.keys[i - 1].value) < 1e-6 && k.time - t.keys[i - 1].time >= 250));
  if (gesture && !held) notes.push('No pose is held — every keyframe moves straight into the next, so nothing reads. Repeat a value 300-600ms apart at the peak.');

  // 6. identical timing on every layer is the clearest tell of machine-made motion
  if (tracks.length >= 3) {
    const shape = (t: Track) => t.keys.map((k) => Math.round(k.time)).join(',');
    if (new Set(tracks.map(shape)).size === 1) {
      notes.push('Every layer moves on exactly the same frames. Offset them 40-80ms from whatever drives them — body first, then eyes.');
    }
  }

  // three is as much as a model will act on well; the rest would be noise
  return notes.slice(0, 3);
}

/** Only for the checks — which properties a word is expected to reach. */
export const __wanted = WANTED;
