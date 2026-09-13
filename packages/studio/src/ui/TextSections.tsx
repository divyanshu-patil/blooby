import { useEditor, writeKeyframe } from '../core/store';
import { valueAt } from '../core/scene';
import { hasItalic as italicAvailable, loadFont } from '../core/fonts';
import { textName } from '../core/layers';
import { TEXT_DEFAULTS } from '../core/text';
import { PropRow } from './bits';
import { FontPicker, WeightSelect } from './FontPicker';
import type { RigNode, TextCharAnim, TextPathSpec, TextStyle } from '../core/types';

/**
 * A text layer's inspector sections: what it says and in what, how it is set, what it
 * runs along, and how its letters arrive. Every number is a PropRow — stopwatch, slider,
 * typed value — because every one of them is a keyframable property in PROPS.
 */

export function TextSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setValue = useEditor((s) => s.setValue);
  const updateNode = useEditor((s) => s.updateNode);
  const setText = useEditor((s) => s.setText);
  const t = node.text!;
  const shown = valueAt(project, node.id, 'text.content', playhead);
  const content = typeof shown === 'string' ? shown : t.content;
  const family = valueAt(project, node.id, 'text.font.family', playhead);
  const font = { ...t.font, family: typeof family === 'string' ? family : t.font.family };

  const pickFamily = (f: string) => {
    setValue(node.id, 'text.font.family', f, `font.${node.id}`);
    void loadFont({ ...font, family: f });
  };
  return (
    <>
      <textarea className="ask text-content" aria-label="Text" rows={Math.min(5, content.split('\n').length + 1)}
        value={content} spellCheck={false}
        onChange={(e) => {
          const v = e.target.value;
          const label = `content.${node.id}`;
          setValue(node.id, 'text.content', v, label);
          // a layer still called by its words keeps being called by them
          if (node.name === textName(content)) updateNode(node.id, (n) => { n.name = textName(v); }, label);
        }} />
      <FontPicker value={font} onPick={pickFamily} />
      <div className="row">
        <WeightSelect value={font} onChange={(w) => { setValue(node.id, 'text.font.weight', w, `weight.${node.id}`); void loadFont({ ...font, weight: w }); }} />
        <div className="seg" role="group" aria-label="Style">
          <button aria-pressed={font.style === 'normal'} onClick={() => setText(node.id, (x) => { x.font = { ...x.font, style: 'normal' }; })}>Normal</button>
          <button aria-pressed={font.style === 'italic'} disabled={!italicAvailable(font.family)} title={italicAvailable(font.family) ? 'Italic' : `${font.family} has no italic`}
            style={{ fontStyle: 'italic' }}
            onClick={() => { setText(node.id, (x) => { x.font = { ...x.font, style: 'italic' }; }); void loadFont({ ...font, style: 'italic' }); }}>Italic</button>
        </div>
      </div>
      <PropRow nodeId={node.id} property="text.size" />
    </>
  );
}

const ALIGN: TextStyle['align'][] = ['left', 'center', 'right'];
const VALIGN: TextStyle['valign'][] = ['top', 'middle', 'bottom'];
const ALIGN_ICON: Record<string, string> = { left: 'M4 6h16 M4 10h10 M4 14h16 M4 18h10', center: 'M4 6h16 M7 10h10 M4 14h16 M7 18h10', right: 'M4 6h16 M10 10h10 M4 14h16 M10 18h10' };
const VALIGN_ICON: Record<string, string> = { top: 'M4 4h16 M8 8h8 M8 12h8', middle: 'M8 8h8 M4 12h16 M8 16h8', bottom: 'M8 12h8 M8 16h8 M4 20h16' };
const glyph = (d: string) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden><path d={d} /></svg>
);

export function TextLayoutSection({ node }: { node: RigNode }) {
  const setText = useEditor((s) => s.setText);
  const t = node.text!;
  return (
    <>
      <div className="row text-align-row">
        <div className="seg" role="group" aria-label="Alignment">
          {ALIGN.map((a) => (
            <button key={a} aria-pressed={t.align === a} title={`Align ${a}`} aria-label={`Align ${a}`}
              onClick={() => setText(node.id, (x) => { x.align = a; })}>{glyph(ALIGN_ICON[a])}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Vertical alignment">
          {VALIGN.map((a) => (
            <button key={a} aria-pressed={t.valign === a} title={`Anchor at the ${a}`} aria-label={`Anchor at the ${a}`}
              onClick={() => setText(node.id, (x) => { x.valign = a; })}>{glyph(VALIGN_ICON[a])}</button>
          ))}
        </div>
      </div>
      <PropRow nodeId={node.id} property="text.letterSpacing" />
      <PropRow nodeId={node.id} property="text.lineHeight" />
      <PropRow nodeId={node.id} property="text.width" label="Wrap at" />
      <p className="hint">The alignment is also the anchor: the corner or edge that stays put as the words, font or size change.</p>
    </>
  );
}

/** Layers with an outline text can run along — a drawn curve, any shape, a mascot. */
const followable = (n: RigNode) => n.kind === 'primitive' || n.kind === 'eye' || n.kind === 'body' || n.kind === 'limb' || (n.kind === 'svgLayer' && !!n.svg?.paths?.length);

export function TextPathSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const setText = useEditor((s) => s.setText);
  const t = node.text!;
  const path = t.path ?? { mode: 'straight' as const };
  const targets = Object.values(project.rig.nodes).filter((n) => n.id !== node.id && followable(n))
    .sort((a, b) => Number(!!b.curve) - Number(!!a.curve) || a.name.localeCompare(b.name));
  const set = (patch: Partial<TextPathSpec>) => setText(node.id, (x) => { x.path = { mode: 'straight', ...x.path, ...patch }; }, `tpath.${node.id}`);
  const toMode = (mode: TextPathSpec['mode']) => {
    if (mode === 'arc') set({ mode, radius: path.radius ?? TEXT_DEFAULTS.arc.radius, start: path.start ?? TEXT_DEFAULTS.arc.start, end: path.end ?? TEXT_DEFAULTS.arc.end });
    else if (mode === 'path') set({ mode, nodeId: path.nodeId && project.rig.nodes[path.nodeId] ? path.nodeId : targets[0]?.id });
    else set({ mode });
  };
  const flag = (key: 'reverse' | 'flip' | 'rotate', label: string, on: boolean, title: string) => (
    <button className="btn sm" aria-pressed={on} title={title} onClick={() => set({ [key]: !on })}>{label}</button>
  );
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Text runs" style={{ display: 'flex' }}>
        {(['straight', 'arc', 'path'] as const).map((m) => (
          <button key={m} role="radio" style={{ flex: 1 }} aria-checked={path.mode === m} aria-pressed={path.mode === m}
            disabled={m === 'path' && !targets.length} title={m === 'path' && !targets.length ? 'Draw a curve with the pen first' : undefined}
            onClick={() => toMode(m)}>{m === 'straight' ? 'Straight' : m === 'arc' ? 'Arc' : 'Path'}</button>
        ))}
      </div>
      {path.mode === 'arc' && (
        <>
          <PropRow nodeId={node.id} property="text.arc.radius" />
          <PropRow nodeId={node.id} property="text.arc.start" />
          <PropRow nodeId={node.id} property="text.arc.end" />
          <div className="seg" role="radiogroup" aria-label="Arc direction" style={{ display: 'flex' }}>
            <button style={{ flex: 1 }} aria-pressed={!path.reverse} onClick={() => set({ reverse: false })}>Over the top</button>
            <button style={{ flex: 1 }} aria-pressed={!!path.reverse} onClick={() => set({ reverse: true })}>Underneath</button>
          </div>
        </>
      )}
      {path.mode === 'path' && (
        <div className="row">
          <span className="prop-label" style={{ width: 52 }}>Follows</span>
          <select className="sel" style={{ flex: 1, minWidth: 0 }} value={path.nodeId ?? ''} aria-label="Path to follow"
            onChange={(e) => set({ nodeId: e.target.value })}>
            {targets.map((n) => <option key={n.id} value={n.id}>{n.name}{n.curve ? '' : n.kind === 'body' ? ' (mascot)' : ' (shape)'}</option>)}
          </select>
        </div>
      )}
      {path.mode !== 'straight' && (
        <>
          <PropRow nodeId={node.id} property="text.path.offset" label="Start offset" />
          <PropRow nodeId={node.id} property="text.path.baseline" label="Baseline" />
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {path.mode === 'path' && flag('reverse', 'Reverse', !!path.reverse, 'Start from the other end of the path')}
            {flag('flip', 'Flip', !!path.flip, 'Turn every letter over and read the other way — for text round the bottom of a loop')}
            {flag('rotate', 'Turn letters', path.rotate !== false, 'Letters turn with the path; off keeps each one upright')}
          </div>
          <p className="hint">Drag the start marker on the stage to slide the words along; the tick lifts them off the path.</p>
        </>
      )}
    </>
  );
}

const CHAR_KINDS: { id: TextCharAnim; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'pop', label: 'Pop' }, { id: 'fade', label: 'Fade' }, { id: 'drop', label: 'Drop' },
  { id: 'rise', label: 'Rise' }, { id: 'scatter', label: 'Scatter' }, { id: 'wave', label: 'Wave' },
];

export function TextLettersSection({ node }: { node: RigNode }) {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const commit = useEditor((s) => s.commit);
  const setText = useEditor((s) => s.setText);
  const t = node.text!;
  const kind = t.chars?.kind ?? 'none';
  const length = [...t.content.replace(/\n/g, '')].length;
  /** two keyframes on one property: `from` here, `to` after `ms` — one undo step */
  const playIn = (property: string, from: number, to: number, ms: number) => commit((p) => {
    writeKeyframe(p, node.id, property, playhead, from, { type: 'preset', name: 'easeOut' });
    writeKeyframe(p, node.id, property, playhead + ms, to, { type: 'preset', name: 'easeOut' });
  }, `playin.${node.id}.${property}`);
  const typing = valueAt(project, node.id, 'text.reveal.end', playhead);
  return (
    <>
      <span className="prop-label">Typewriter</span>
      <PropRow nodeId={node.id} property="text.reveal.end" label="Show up to" />
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} title={`Key 0 here and all ${length} characters ${length * 45}ms later`}
        onClick={() => playIn('text.reveal.end', 0, length, Math.max(200, length * 45))}>Type it out from here</button>
      <div className="divider" />
      <div className="row">
        <span className="prop-label" style={{ width: 52 }}>Letters</span>
        <select className="sel" style={{ flex: 1 }} aria-label="Letter animation" value={kind}
          onChange={(e) => setText(node.id, (x) => { x.chars = { progress: 1, stagger: 0.5, ...x.chars, kind: e.target.value as TextCharAnim }; })}>
          {CHAR_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </div>
      {kind !== 'none' && (
        <>
          <PropRow nodeId={node.id} property="text.chars.progress" label={kind === 'wave' ? 'Phase' : 'Progress'} />
          <PropRow nodeId={node.id} property="text.chars.stagger" />
          <button className="btn sm" style={{ alignSelf: 'flex-start' }}
            onClick={() => (kind === 'wave' ? playIn('text.chars.progress', 0, 2, 1600) : playIn('text.chars.progress', 0, 1, Math.max(400, length * 70)))}>
            {kind === 'wave' ? 'Wave twice from here' : 'Play letters in from here'}
          </button>
        </>
      )}
      {typeof typing === 'number' && typing < length && <p className="hint">{Math.max(0, Math.floor(typing))} of {length} characters showing at the playhead.</p>}
    </>
  );
}
