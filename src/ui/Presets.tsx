import { useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { COMP } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { MascotThumb } from './Mascot';
import { Panel } from './bits';
import { EASING_NAMES, namedEasing } from '../core/easing';
import type { Preset, Project } from '../core/types';

/** A preset's own pose, rendered live — the icon *is* the animation. */
function glyphScene(project: Project, preset: Preset) {
  const temp: Project = { ...project, tracks: preset.tracks, modifiers: [], blocks: [] };
  return sceneAt(temp, preset.durationMs * 0.45, COMP);
}

export function Presets() {
  const project = useEditor((s) => s.project);
  const addBlock = useEditor((s) => s.addBlock);
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
          <button key={preset.id} className="chip" draggable title={`Add ${preset.name} · ${(preset.durationMs / 1000).toFixed(1)}s`}
            onDragStart={(e) => { e.dataTransfer.setData('text/blooby-preset', preset.id); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => addBlock(preset.id)}>
            <MascotThumb className="glyph" scene={glyphScene(project, preset)} view={COMP} />
            {preset.name}
          </button>
        ))}
      </div>
      {!list.length && <p className="empty-note">Save a selection of tracks from the timeline to make one.</p>}
    </Panel>
  );
}

export function Expressions() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const capture = useEditor((s) => s.captureExpression);
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
      <div>
        {project.expressions.map((x) => (
          <div key={x.id} className="layer">
            <span style={{ flex: 1 }}>{x.name}</span>
            <span className="tag">{Object.keys(x.snapshot).length}</span>
            <button className="btn sm" title={`Write keyframes at ${(playhead / 1000).toFixed(2)}s`}
              onClick={() => apply(x.id, playhead)}>Set</button>
          </div>
        ))}
      </div>
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
