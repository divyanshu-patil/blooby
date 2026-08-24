import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, keyframeTimes } from '../core/store';
import { COMP } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { blockStarts, characteristicTime, fmtSec } from '../core/timeline';
import { applyEasing, EASING_NAMES, easingLabel, easingShape, namedEasing } from '../core/easing';
import { PROP_LABEL, type Track } from '../core/types';
import { MascotThumb } from './Mascot';
import { GraphEditor } from './GraphEditor';
import { NumberField } from './bits';

export function Timeline() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const loop = useEditor((s) => s.loop);
  const setLoop = useEditor((s) => s.setLoop);
  const autoKey = useEditor((s) => s.autoKey);
  const toggleAutoKey = useEditor((s) => s.toggleAutoKey);
  const selection = useEditor((s) => s.selection);
  const addBlock = useEditor((s) => s.addBlock);
  const removeBlock = useEditor((s) => s.removeBlock);
  const moveBlock = useEditor((s) => s.moveBlock);
  const setBlockDuration = useEditor((s) => s.setBlockDuration);
  const setDurationMode = useEditor((s) => s.setDurationMode);
  const moveKeyframe = useEditor((s) => s.moveKeyframe);
  const deleteKeyframe = useEditor((s) => s.deleteKeyframe);
  const setEasing = useEditor((s) => s.setEasing);
  const savePreset = useEditor((s) => s.savePreset);
  const commit = useEditor((s) => s.commit);

  const [view, setView] = useState<'tracks' | 'graph'>('tracks');
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<{ trackId: string; kfId: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const kfDrag = useRef<{ trackId: string; kfId: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const resize = useRef<{ id: string; startX: number; startMs: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // the lanes are as wide as the content, so measure the viewport that holds them
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width - 168)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const duration = Math.max(project.timelineDurationMs, 1);
  const pxPerMs = ((width - 12) / duration) * zoom;
  const laneW = duration * pxPerMs;

  const visible = useMemo(
    () => (selection.length ? project.tracks.filter((t) => selection.includes(t.nodeId)) : project.tracks),
    [project.tracks, selection],
  );
  const jumps = useMemo(() => keyframeTimes(visible.length ? visible : project.tracks), [visible, project.tracks]);
  const starts = blockStarts(project);

  const thumbs = useMemo(
    () => project.blocks.map((b, i) => {
      const preset = project.presets.find((p) => p.id === b.presetId);
      const rel = preset ? (characteristicTime(preset) / preset.durationMs) * b.durationMs : b.durationMs * 0.45;
      return sceneAt(project, starts[i] + rel, COMP);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.blocks, project.tracks, project.rig, project.modifiers],
  );

  const goto = (dir: -1 | 1) => {
    const t = Math.round(playhead);
    const next = dir < 0 ? [...jumps].reverse().find((k) => k < t - 1) : jumps.find((k) => k > t + 1);
    setPlayhead(next ?? (dir < 0 ? 0 : duration));
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.type === 'pointermove' && e.buttons === 0) return;
    const r = lanesRef.current!.getBoundingClientRect();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setPlayhead(Math.max(0, Math.min(duration, (e.clientX - r.left) / pxPerMs)));
  };

  const selKf = sel && project.tracks.find((t) => t.id === sel.trackId)?.keyframes.find((k) => k.id === sel.kfId);

  const tickStep = duration > 12000 ? 2000 : duration > 5000 ? 1000 : 500;
  const activeBlock = starts.findIndex((s, i) => playhead >= s && playhead < s + project.blocks[i].durationMs);

  return (
    <div className="timeline">
      <div className="transport">
        <button className="btn icon" title="Previous keyframe (,)" onClick={() => goto(-1)}>‹</button>
        <button className="btn icon" title={playing ? 'Pause (space)' : 'Play (space)'} onClick={() => setPlaying(!playing)}>
          {playing ? '❙❙' : '▶'}
        </button>
        <button className="btn icon" title="Next keyframe (.)" onClick={() => goto(1)}>›</button>
        <button className="btn sm" aria-pressed={loop} title="Loop playback" onClick={() => setLoop(!loop)}>Loop</button>
        <span className="tc">{(playhead / 1000).toFixed(2)}<span className="dim">s / {(duration / 1000).toFixed(2)}s</span></span>
        <span className="tc dim">f{Math.round((playhead / 1000) * project.fps)}</span>
        <button className="btn sm rec" aria-pressed={autoKey} title="Record every change as a keyframe" onClick={toggleAutoKey}>
          ● Auto-key
        </button>
        <span className="spacer" />
        {selKf && (
          <>
            <span className="hint">easing</span>
            <select className="sel" value={easingLabel(selKf.easingOut)}
              onChange={(e) => setEasing(sel!.trackId, sel!.kfId, namedEasing(e.target.value))}>
              {EASING_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              {selKf.easingOut.type === 'bezier' && <option value="bezier">custom</option>}
            </select>
            <button className="btn sm" onClick={() => { deleteKeyframe(sel!.trackId, sel!.kfId); setSel(null); }}>Delete key</button>
          </>
        )}
        <div className="seg">
          <button aria-pressed={view === 'tracks'} onClick={() => setView('tracks')}>Tracks</button>
          <button aria-pressed={view === 'graph'} onClick={() => setView('graph')}>Graph</button>
        </div>
        <button className="btn icon sm" title="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
        <button className="btn icon sm" title="Zoom in" onClick={() => setZoom((z) => Math.min(24, z * 1.5))}>+</button>
        <button className="btn sm" disabled={!visible.length}
          title="Save the visible tracks as a reusable preset"
          onClick={() => {
            const name = prompt('Preset name', selection.length ? project.rig.nodes[selection[0]]?.name : 'My preset');
            if (name) savePreset(name, visible.map((t) => t.id), Math.max(200, Math.round(duration)));
          }}>Save preset</button>
      </div>

      <div className="strip-wrap">
        <select className="sel" style={{ alignSelf: 'center' }} value={project.durationMode}
          title="How block durations are decided"
          onChange={(e) => setDurationMode(e.target.value as 'custom' | 'even')}>
          <option value="custom">custom</option>
          <option value="even">even</option>
        </select>
        <button className="btn sm" aria-pressed={project.loop} style={{ alignSelf: 'center' }}
          title="Ease the last moment back to the first, so playback and export loop with no seam"
          onClick={() => commit((p) => { p.loop = !p.loop; }, 'projloop')}>
          {project.loop ? 'Loops' : 'Loop'}
        </button>
        <div className={project.blocks.length ? 'strip' : 'strip empty'}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('text/blooby-preset') || e.dataTransfer.types.includes('text/blooby-block-reorder')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = e.dataTransfer.types.includes('text/blooby-block-reorder') ? 'move' : 'copy';
            }
          }}
          onDrop={(e) => {
            const kids = [...e.currentTarget.querySelectorAll('.block')];
            const idx = kids.findIndex((k) => e.clientX < k.getBoundingClientRect().left + k.getBoundingClientRect().width / 2);
            const target = idx < 0 ? kids.length : idx;

            const reorderId = e.dataTransfer.getData('text/blooby-block-reorder');
            if (reorderId) {
              e.preventDefault();
              const from = project.blocks.findIndex((b) => b.id === reorderId);
              moveBlock(reorderId, from >= 0 && target > from ? target - 1 : target);
              return;
            }
            const presetId = e.dataTransfer.getData('text/blooby-preset');
            if (presetId) { e.preventDefault(); addBlock(presetId, target); }
          }}>
          {!project.blocks.length && 'Drag a preset here, or click one to append it.'}
          {project.blocks.map((b, i) => {
            const start = starts[i];
            const within = playhead >= start && playhead < start + b.durationMs;
            return (
              <div key={b.id} className="block" data-active={activeBlock === i} data-dragging={dragging === b.id}
                draggable title="Drag to reorder"
                onDragStart={(e) => { e.dataTransfer.setData('text/blooby-block-reorder', b.id); e.dataTransfer.effectAllowed = 'move'; setDragging(b.id); }}
                onDragEnd={() => setDragging(null)}
                onClick={() => setPlayhead(start)}>
                {within && <span className="tick" style={{ left: `${((playhead - start) / b.durationMs) * 100}%` }} />}
                <button className="x" title="Remove block" onClick={(e) => { e.stopPropagation(); removeBlock(b.id); }}>✕</button>
                <MascotThumb className="thumb" scene={thumbs[i]} view={COMP} />
                <span style={{ font: '600 10.5px var(--ui)', width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <DurInput ms={b.durationMs} label={`${b.name} duration`} locked={project.durationMode === 'even'}
                  onCommit={(sec) => setBlockDuration(b.id, sec * 1000)} />
                {project.durationMode === 'custom' && (
                  <div className="block-resize" title="Drag to change duration"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      resize.current = { id: b.id, startX: e.clientX, startMs: b.durationMs };
                    }}
                    onPointerMove={(e) => {
                      const r = resize.current;
                      if (!r || r.id !== b.id) return;
                      const pxPerMsNow = (width - 12) / Math.max(project.timelineDurationMs, 1) * zoom;
                      const next = r.startMs + (e.clientX - r.startX) / pxPerMsNow;
                      setBlockDuration(b.id, Math.max(60, next));
                    }}
                    onPointerUp={() => { resize.current = null; }}
                    onPointerCancel={() => { resize.current = null; }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel flush" style={{ minHeight: 172 }}>
        {view === 'graph' ? (
          <GraphEditor tracks={visible} selected={sel} onSelect={setSel} />
        ) : (
          <div className="tracks" ref={scrollRef}>
            <div className="track-names">
              <div className="ruler" style={{ paddingLeft: 8, display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'static', transform: 'none' }}>
                  {selection.length ? `${visible.length} track${visible.length === 1 ? '' : 's'} · selected` : `${project.tracks.length} tracks`}
                </span>
              </div>
              {visible.map((t) => {
                const numeric = t.keyframes.every((k) => typeof k.value === 'number');
                return (
                  <div key={t.id} style={{ display: 'contents' }}>
                    <div className="trow" aria-selected={sel?.trackId === t.id}>
                      {numeric ? (
                        <button className="expand" aria-pressed={expanded.has(t.id)} title="Show the value curve"
                          onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
                          ▸
                        </button>
                      ) : <span className="expand-spacer" />}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {PROP_LABEL[t.property] ?? t.property}
                      </span>
                      <span className="node">{project.rig.nodes[t.nodeId]?.name ?? t.nodeId}</span>
                    </div>
                    {expanded.has(t.id) && numeric && <div className="trow-detail" />}
                  </div>
                );
              })}
              {!visible.length && <div className="empty-note" style={{ padding: 10 }}>Click a stopwatch to animate a property.</div>}
            </div>

            <div className="track-lanes" ref={lanesRef} style={{ width: laneW }} onPointerDown={scrub} onPointerMove={scrub}>
              <div style={{ position: 'relative' }}>
                <div className="ruler">
                  {project.blocks.map((b, i) => (
                    <div key={b.id} className="blockband" style={{ left: starts[i] * pxPerMs, width: b.durationMs * pxPerMs }}>{b.name}</div>
                  ))}
                  {Array.from({ length: Math.floor(duration / tickStep) + 1 }, (_, i) => i * tickStep).map((t) => (
                    <span key={t} style={{ left: t * pxPerMs }}>{(t / 1000).toFixed(t % 1000 ? 1 : 0)}s</span>
                  ))}
                </div>
                {visible.map((t) => {
                  const numeric = t.keyframes.every((k) => typeof k.value === 'number');
                  return (
                    <div key={t.id} style={{ display: 'contents' }}>
                      <div className="lane">
                        {t.keyframes.length > 1 && (
                          <span className="seg-fill" style={{ left: t.keyframes[0].time * pxPerMs, width: (t.keyframes[t.keyframes.length - 1].time - t.keyframes[0].time) * pxPerMs }} />
                        )}
                        {t.keyframes.map((k) => (
                          <span key={k.id} className="kfd" data-sel={sel?.kfId === k.id} data-shape={easingShape(k.easingOut)}
                            style={{ left: k.time * pxPerMs }}
                            title={`${(k.time / 1000).toFixed(2)}s · ${easingLabel(k.easingOut)}`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              (e.target as Element).setPointerCapture?.(e.pointerId);
                              setSel({ trackId: t.id, kfId: k.id });
                              kfDrag.current = { trackId: t.id, kfId: k.id };
                            }}
                            onPointerMove={(e) => {
                              if (!kfDrag.current) return;
                              e.stopPropagation();
                              const r = lanesRef.current!.getBoundingClientRect();
                              const raw = (e.clientX - r.left) / pxPerMs;
                              const snap = [...jumps, playhead].find((j) => Math.abs(j - raw) < 6 / pxPerMs && Math.abs(j - k.time) > 0.5);
                              moveKeyframe(t.id, k.id, snap ?? raw);
                            }}
                            onPointerUp={() => { kfDrag.current = null; }}
                            onDoubleClick={() => { deleteKeyframe(t.id, k.id); setSel(null); }} />
                        ))}
                      </div>
                      {expanded.has(t.id) && numeric && (
                        <div className="lane-detail">
                          <Sparkline track={t} width={laneW} height={40} pxPerMs={pxPerMs} />
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="playhead" style={{ left: playhead * pxPerMs }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Seconds in, milliseconds out — only on Enter or blur, so typing "1." works. */
function DurInput({ ms, label, locked, onCommit }: { ms: number; label: string; locked: boolean; onCommit: (sec: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input className="dur" aria-label={label} readOnly={locked}
      value={draft ?? fmtSec(ms)}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = parseFloat(draft ?? '');
        if (Number.isFinite(n) && n > 0) onCommit(n);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }} />
  );
}

/**
 * A track's own value-vs-time curve, inline in its row — the "expand" affordance.
 * Just enough to see the shape without leaving Tracks view for the full Graph editor.
 */
function Sparkline({ track, width, height, pxPerMs }: { track: Track; width: number; height: number; pxPerMs: number }) {
  const ks = track.keyframes;
  if (ks.length < 2) return null;
  const vals = ks.map((k) => k.value as number);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const y = (v: number) => height - 4 - ((v - lo) / (hi - lo)) * (height - 8);

  let d = '';
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    const STEPS = 20;
    for (let s = 0; s <= STEPS; s++) {
      const u = s / STEPS;
      const v = (a.value as number) + ((b.value as number) - (a.value as number)) * applyEasing(a.easingOut, u);
      const x = (a.time + (b.time - a.time) * u) * pxPerMs;
      d += `${s === 0 && i === 0 ? 'M' : 'L'}${x},${y(v)} `;
    }
  }
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={d} fill="none" stroke="var(--signal)" strokeWidth={1.4} />
      {ks.map((k) => <circle key={k.id} cx={k.time * pxPerMs} cy={y(k.value as number)} r={2} fill="var(--signal)" />)}
    </svg>
  );
}

export function DurationField() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  return (
    <div className="fps" title="Frames per second — the rate every export bakes at">
      <span className="prop-label"><span className="t">fps</span></span>
      <NumberField value={project.fps} onChange={(v) => commit((p) => { p.fps = Math.min(60, Math.max(6, Math.round(v))); })} />
    </div>
  );
}
