import { useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { COMP } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { MascotThumb } from './Mascot';
import { Panel } from './bits';
import { EASING_NAMES, namedEasing } from '../core/easing';
import { characteristicTime } from '../core/timeline';
import { activeTimeline } from '../core/types';
import type { Preset, Project } from '../core/types';

/** A preset's own pose at its most characteristic moment — the icon *is* the animation. */
function glyphScene(project: Project, preset: Preset) {
  const tl = activeTimeline(project);
  const temp: Project = { ...project, timelines: [{ ...tl, tracks: preset.tracks, modifiers: [], blocks: [] }], activeTimelineId: tl.id };
  return sceneAt(temp, characteristicTime(preset), COMP);
}

export function Presets() {
  const project = useEditor((s) => s.project);
  const addBlock = useEditor((s) => s.addBlock);
  const renamePreset = useEditor((s) => s.renamePreset);
  const setPresetColor = useEditor((s) => s.setPresetColor);
  const [filter, setFilter] = useState<'all' | 'builtin' | 'custom'>('all');
  const list = project.presets.filter((p) => filter === 'all' || p.source === filter);

  return (
    <Panel title="Presets" actions={
      <div className="seg">
        {(['all', 'builtin', 'custom'] as const).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'builtin' ? 'built-in' : f}</button>
        ))}
      </div>
    }>
      <div className="chips">
        {list.map((preset) => (
          // a plain <button> can't nest the color swatch's own <input type="color"> without
          // invalid/broken interactive-inside-interactive markup, so this one's a div
          // acting as a button — role/tabIndex/onKeyDown restore what <button> gave for free.
          <div key={preset.id} className="chip" draggable role="button" tabIndex={0}
            title={`Add ${preset.name} · ${(preset.durationMs / 1000).toFixed(1)}s — double-click to rename`}
            onDragStart={(e) => { e.dataTransfer.setData('text/blooby-preset', preset.id); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => addBlock(preset.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addBlock(preset.id); } }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const name = prompt('Rename preset', preset.name);
              if (name?.trim()) renamePreset(preset.id, name);
            }}>
            <input type="color" className="chip-color" title="Accent color — shows on this preset's clips"
              value={preset.color ?? '#8c8577'} onClick={(e) => e.stopPropagation()}
              onChange={(e) => setPresetColor(preset.id, e.target.value)} />
            <MascotThumb className="glyph" scene={glyphScene(project, preset)} view={COMP} />
            {preset.name}
          </div>
        ))}
      </div>
      {!list.length && <p className="empty-note">Save a selection of tracks from the timeline to make one.</p>}
    </Panel>
  );
}

/**
 * "Another timeline from the current project" as a clip source (spec §8 step 1) — every
 * other timeline in this same project, one click appends its full content as a new clip
 * on the timeline being edited. Same rig, so nothing here needs the gallery's node-id
 * compatibility filter (addClipFrom applies it anyway; it's just always a no-op here).
 */
export function OtherTimelines() {
  const project = useEditor((s) => s.project);
  const addClipFrom = useEditor((s) => s.addClipFrom);
  const others = project.timelines.filter((t) => t.id !== project.activeTimelineId);
  if (!others.length) return null;

  return (
    <Panel title="Other timelines">
      <div className="chips">
        {others.map((t) => (
          <button key={t.id} className="chip" title={`Add all of "${t.name}" as one clip · ${(t.timelineDurationMs / 1000).toFixed(1)}s`}
            onClick={() => addClipFrom({ label: t.name, timeline: t })}>
            <MascotThumb className="glyph" scene={sceneAt({ ...project, activeTimelineId: t.id }, t.timelineDurationMs * 0.45, COMP)} view={COMP} />
            {t.name}
          </button>
        ))}
      </div>
    </Panel>
  );
}

export function Expressions() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const capture = useEditor((s) => s.captureExpression);
  const renameExpression = useEditor((s) => s.renameExpression);
  const apply = useEditor((s) => s.applyExpression);
  const morph = useEditor((s) => s.morphBetween);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dur, setDur] = useState(320);
  const [easing, setEasing] = useState('easeInOut');

  const ids = useMemo(() => project.expressions.map((e) => e.id), [project.expressions]);
  const a = from || ids[0] || '';
  const b = to || ids[1] || ids[0] || '';

  return (
    <Panel title="Expressions">
      <div className="row">
        <input className="txt" placeholder="Capture current pose as…" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { capture(name.trim()); setName(''); } }} />
        <button className="btn sm" disabled={!name.trim()} onClick={() => { capture(name.trim()); setName(''); }}>Capture</button>
      </div>
      {project.expressions.length > 0 && (
        <>
          <span className="panel-title">Captured poses</span>
          <div className="chips">
            {project.expressions.map((x) => (
              <button key={x.id} className="chip" title={`Apply "${x.name}" at ${(playhead / 1000).toFixed(2)}s — double-click to rename`}
                onClick={() => apply(x.id, playhead)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const next = prompt('Rename captured pose', x.name);
                  if (next?.trim()) renameExpression(x.id, next);
                }}>
                <span className="glyph" style={{ display: 'grid', placeItems: 'center', font: '600 9px var(--mono)', color: 'var(--paper)' }}>
                  {Object.keys(x.snapshot).length}
                </span>
                {x.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="divider" />
      <span className="panel-title">Morph</span>
      <div className="row">
        <select className="sel" style={{ flex: 1 }} value={a} onChange={(e) => setFrom(e.target.value)}>
          {project.expressions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <span className="hint">→</span>
        <select className="sel" style={{ flex: 1 }} value={b} onChange={(e) => setTo(e.target.value)}>
          {project.expressions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <div className="row">
        <select className="sel" value={easing} onChange={(e) => setEasing(e.target.value)}>
          {EASING_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input className="txt" style={{ width: 66 }} type="number" min={40} step={20} value={dur}
          onChange={(e) => setDur(Math.max(40, +e.target.value))} />
        <span className="hint">ms</span>
        <span className="spacer" />
        <button className="btn sm primary" disabled={!a || !b || a === b}
          onClick={() => morph(a, b, playhead, dur, namedEasing(easing))}>Morph here</button>
      </div>
    </Panel>
  );
}
