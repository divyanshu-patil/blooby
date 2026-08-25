import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, keyframeTimes } from '../core/store';
import { COMP } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { blockStarts, blocksEnd, characteristicTime, DEFAULT_TRANSITION_EASING, DEFAULT_TRANSITION_MS, explicitTransitionFor, fmtSec } from '../core/timeline';
import { applyEasing, easingLabel, easingShape } from '../core/easing';
import { activeTimeline, PROP_LABEL, type Block, type Track, type Transition } from '../core/types';
import { MascotThumb } from './Mascot';
import { GraphEditor } from './GraphEditor';
import { CurveEditor } from './CurveEditor';
import { NumberField } from './bits';

const FPS_OPTIONS = [12, 15, 24, 25, 30, 50, 60];

const kfKey = (trackId: string, kfId: string) => `${trackId} ${kfId}`;
const parseKfKey = (key: string) => { const [trackId, kfId] = key.split(' '); return { trackId, kfId }; };

/** The color a clip reads as everywhere (strip, track lane, graph) — its own override,
 * else its source preset's, else undefined (no accent, exactly like before clip colors
 * existed). Never the gallery/blank case's problem: those just show no accent either. */
export function clipColor(project: { presets: { id: string; color?: string }[] }, block: Block | undefined): string | undefined {
  if (!block) return undefined;
  return block.color ?? project.presets.find((p) => p.id === block.presetId)?.color;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const tl = activeTimeline(project);
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
  const selectedBlockId = useEditor((s) => s.selectedBlockId);
  const selectBlock = useEditor((s) => s.selectBlock);
  const moveBlock = useEditor((s) => s.moveBlock);
  const setBlockDuration = useEditor((s) => s.setBlockDuration);
  const setTransition = useEditor((s) => s.setTransition);
  const removeTransition = useEditor((s) => s.removeTransition);
  const setDurationMode = useEditor((s) => s.setDurationMode);
  const setTimelineDuration = useEditor((s) => s.setTimelineDuration);
  const moveKeyframe = useEditor((s) => s.moveKeyframe);
  const moveKeyframes = useEditor((s) => s.moveKeyframes);
  const deleteKeyframe = useEditor((s) => s.deleteKeyframe);
  const deleteKeyframes = useEditor((s) => s.deleteKeyframes);
  const setEasing = useEditor((s) => s.setEasing);
  const savePreset = useEditor((s) => s.savePreset);
  const setBlockColor = useEditor((s) => s.setBlockColor);
  const commit = useEditor((s) => s.commit);

  const [view, setView] = useState<'tracks' | 'graph'>('tracks');
  const [zoom, setZoom] = useState(1);
  const [stripZoom, setStripZoom] = useState(1);
  const [isolatedBlockId, setIsolatedBlockId] = useState<string | null>(null);
  // multi-select: every selected keyframe as `${trackId} ${kfId}`, click to replace,
  // shift/cmd-click to add or remove one from the set. `sel` (below) is the *primary* one
  // — the easing/curve editor in the transport only makes sense for exactly one at a time.
  const [selKeys, setSelKeys] = useState<Set<string>>(new Set());
  const sel = selKeys.size === 1 ? parseKfKey([...selKeys][0]) : null;
  const setSel = (s: { trackId: string; kfId: string } | null) => setSelKeys(s ? new Set([kfKey(s.trackId, s.kfId)]) : new Set());
  const [curveOpen, setCurveOpen] = useState(false);
  useEffect(() => { if (!sel) setCurveOpen(false); }, [sel]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [stripWidth, setStripWidth] = useState(600);
  const kfDrag = useRef<{ keys: { trackId: string; kfId: string; startTime: number }[]; anchorStartTime: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const resize = useRef<{ id: string; startX: number; startMs: number } | null>(null);
  const resizing = useRef(false);
  const durDrag = useRef<{ startX: number; startMs: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // property-level focus, independent of (and layered on top of) the layer selection
  // that already narrows `visible` — click a track row to solo it, shift-click to build
  // up a multi-focus set. Local to the timeline: it's a view concern, not project data.
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const toggleFocus = (id: string, additive: boolean) => setFocus((f) => {
    if (additive) { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); return n; }
    return f.size === 1 && f.has(id) ? new Set() : new Set([id]);
  });
  const dimmed = (id: string) => focus.size > 0 && !focus.has(id);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // the lanes are as wide as the content, so measure the viewport that holds them
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width - 168)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStripWidth(Math.max(120, e.contentRect.width - 16)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // a selected clip can vanish out from under isolate mode (removed, or a different one
  // picked) — never leave the timeline silently stuck showing a dead clip's empty tracks.
  useEffect(() => {
    if (isolatedBlockId && selectedBlockId !== isolatedBlockId) setIsolatedBlockId(null);
  }, [selectedBlockId, isolatedBlockId]);

  const duration = Math.max(tl.timelineDurationMs, 1);
  const pxPerMs = ((width - 12) / duration) * zoom;
  const laneW = duration * pxPerMs;
  // clip width in the strip is proportional to its own duration, fit to the strip's own
  // viewport at stripZoom=1 (a literal "resize to viewport") — the +/- buttons scale that
  // baseline, same convention as the Tracks/Graph zoom just above it.
  const blockPxPerMs = (stripWidth / Math.max(blocksEnd(tl), 1)) * stripZoom;

  const visible = useMemo(
    () => {
      const byNode = selection.length ? tl.tracks.filter((t) => selection.includes(t.nodeId)) : tl.tracks;
      return isolatedBlockId ? byNode.filter((t) => t.blockId === isolatedBlockId) : byNode;
    },
    [tl.tracks, selection, isolatedBlockId],
  );
  const jumps = useMemo(() => keyframeTimes(visible.length ? visible : tl.tracks), [visible, tl.tracks]);
  const starts = blockStarts(tl);

  // a focused track can fall out of `visible` (layer selection changed, track deleted) —
  // an orphaned focus set would just dim every remaining track with nothing emphasized,
  // so drop whatever no longer applies instead of leaving a confusing all-dim view.
  useEffect(() => {
    setFocus((f) => {
      if (!f.size) return f;
      const next = new Set([...f].filter((id) => visible.some((t) => t.id === id)));
      return next.size === f.size ? f : next;
    });
  }, [visible]);

  const thumbs = useMemo(
    () => tl.blocks.map((b, i) => {
      const preset = project.presets.find((p) => p.id === b.presetId);
      const rel = preset ? (characteristicTime(preset) / preset.durationMs) * b.durationMs : b.durationMs * 0.45;
      return sceneAt(project, starts[i] + rel, COMP);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tl.blocks, tl.tracks, project.rig, tl.modifiers],
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

  const selKf = sel && tl.tracks.find((t) => t.id === sel.trackId)?.keyframes.find((k) => k.id === sel.kfId);
  const isolatedBlock = isolatedBlockId ? tl.blocks.find((b) => b.id === isolatedBlockId) : null;
  const colorForBlockId = (id: string | undefined) => (id ? clipColor(project, tl.blocks.find((b) => b.id === id)) : undefined);

  const tickStep = duration > 12000 ? 2000 : duration > 5000 ? 1000 : 500;
  const activeBlock = starts.findIndex((s, i) => playhead >= s && playhead < s + tl.blocks[i].durationMs);

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
            <div style={{ position: 'relative' }}>
              <button className="btn sm" aria-pressed={curveOpen} onClick={() => setCurveOpen((v) => !v)}
                title="Edit this keyframe's curve">
                {easingLabel(selKf.easingOut)} ⌃
              </button>
              {curveOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20 }}>
                  <CurveEditor value={selKf.easingOut} onChange={(c) => setEasing(sel!.trackId, sel!.kfId, c)} />
                </div>
              )}
            </div>
            <button className="btn sm" onClick={() => { deleteKeyframe(sel!.trackId, sel!.kfId); setSel(null); }}>Delete key</button>
          </>
        )}
        {!sel && selKeys.size > 1 && (
          <button className="btn sm" onClick={() => { deleteKeyframes([...selKeys].map(parseKfKey)); setSelKeys(new Set()); }}>
            Delete {selKeys.size} keys
          </button>
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
        <label className="dur-field" title="Total timeline length. Shrinking it clamps any keyframe past the new end onto it — nothing is deleted. It can never go shorter than the blocks tiled below.">
          <span className="t">Duration</span>
          <NumberField className="prop-num" value={Math.round(duration) / 1000} step={0.1}
            onChange={(sec) => setTimelineDuration(Math.max(0.2, sec) * 1000)} />
          <span className="t">s</span>
        </label>
        <select className="sel" style={{ alignSelf: 'center' }} value={tl.durationMode}
          title="How block durations are decided"
          onChange={(e) => setDurationMode(e.target.value as 'custom' | 'even')}>
          <option value="custom">custom</option>
          <option value="even">even</option>
        </select>
        <button className="btn sm" aria-pressed={tl.loop} style={{ alignSelf: 'center' }}
          title="Ease the last moment back to the first, so playback and export loop with no seam"
          onClick={() => commit((p) => { const t2 = activeTimeline(p); t2.loop = !t2.loop; }, 'projloop')}>
          {tl.loop ? 'Loops' : 'Loop'}
        </button>
        <div style={{ display: 'flex', alignSelf: 'center', gap: 2 }}>
          <button className="btn icon sm" title="Shrink clips (fit more of the strip in view)" onClick={() => setStripZoom((z) => Math.max(0.25, z / 1.4))}>−</button>
          <button className="btn icon sm" title="Grow clips" onClick={() => setStripZoom((z) => Math.min(6, z * 1.4))}>+</button>
        </div>
        {isolatedBlock && (
          <button className="btn sm" style={{ alignSelf: 'center' }}
            title="Tracks/Graph below are showing only this clip's own keyframes"
            onClick={() => setIsolatedBlockId(null)}>
            Editing "{isolatedBlock.name}" only · show all
          </button>
        )}
        <div ref={stripRef} className={tl.blocks.length ? 'strip' : 'strip empty'}
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
              const from = tl.blocks.findIndex((b) => b.id === reorderId);
              moveBlock(reorderId, from >= 0 && target > from ? target - 1 : target);
              return;
            }
            const presetId = e.dataTransfer.getData('text/blooby-preset');
            if (presetId) { e.preventDefault(); addBlock(presetId, target); }
          }}>
          {!tl.blocks.length && 'Drag a preset here, or click one to append it.'}
          {tl.blocks.map((b, i) => {
            const start = starts[i];
            const within = playhead >= start && playhead < start + b.durationMs;
            const color = clipColor(project, b);
            return (
              <Fragment key={b.id}>
              <div className="block" data-active={activeBlock === i} data-dragging={dragging === b.id}
                data-selected={selectedBlockId === b.id}
                style={{ width: Math.max(56, b.durationMs * blockPxPerMs), ...(color ? { borderTopColor: color, borderTopWidth: 3 } : {}) }}
                draggable title="Drag to reorder · click to select for editing (effects, inspector) · double-click to isolate its keyframes below"
                onDragStart={(e) => {
                  // a resize just starting on the child handle still targets this
                  // element for native dragstart (per spec, the ancestor draggable
                  // element is always the drag source) — refuse it in that case, or
                  // dragging the resize handle silently reorders the block instead.
                  if (resizing.current) { e.preventDefault(); return; }
                  e.dataTransfer.setData('text/blooby-block-reorder', b.id); e.dataTransfer.effectAllowed = 'move'; setDragging(b.id);
                }}
                onDragEnd={() => setDragging(null)}
                onClick={() => {
                  setPlayhead(start);
                  if (isolatedBlockId && isolatedBlockId !== b.id) setIsolatedBlockId(null);
                  selectBlock(selectedBlockId === b.id ? null : b.id);
                }}
                onDoubleClick={() => { setPlayhead(start); selectBlock(b.id); setIsolatedBlockId(b.id); }}>
                {within && <span className="tick" style={{ left: `${((playhead - start) / b.durationMs) * 100}%` }} />}
                <button className="x" title="Remove block" onClick={(e) => { e.stopPropagation(); removeBlock(b.id); }}>✕</button>
                <input type="color" className="block-color" title="Clip accent color — shows in the strip, track lanes and graph"
                  value={color ?? '#8c8577'} onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); setBlockColor(b.id, e.target.value); }} />
                <MascotThumb className="thumb" scene={thumbs[i]} view={COMP} />
                <span style={{ font: '600 10.5px var(--ui)', width: '100%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <DurInput ms={b.durationMs} label={`${b.name} duration`} locked={tl.durationMode === 'even'}
                  onCommit={(sec) => setBlockDuration(b.id, sec * 1000)} />
                {tl.durationMode === 'custom' && (
                  <div className="block-resize" title="Drag to change duration"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      resizing.current = true;
                      resize.current = { id: b.id, startX: e.clientX, startMs: b.durationMs };
                    }}
                    onPointerMove={(e) => {
                      const r = resize.current;
                      if (!r || r.id !== b.id) return;
                      const next = r.startMs + (e.clientX - r.startX) / blockPxPerMs;
                      setBlockDuration(b.id, Math.max(60, next));
                    }}
                    onPointerUp={() => { resize.current = null; resizing.current = false; }}
                    onPointerCancel={() => { resize.current = null; resizing.current = false; }} />
                )}
              </div>
              {i < tl.blocks.length - 1 && (
                <TransitionConnector
                  transition={explicitTransitionFor(tl, b.id)}
                  onChange={(patch) => setTransition(b.id, patch)}
                  onRemove={() => removeTransition(b.id)} />
              )}
              </Fragment>
            );
          })}
          <button className="btn icon add-blank-clip" title="Add a blank clip — the rig's own rest pose, ready to animate from scratch"
            onClick={() => addBlock('p_neutral')}>+</button>
        </div>
      </div>

      <div className="panel flush" style={{ minHeight: 172, flex: 1 }}>
        {view === 'graph' ? (
          <GraphEditor tracks={visible} selected={sel} onSelect={setSel}
            focus={focus} onToggleFocus={toggleFocus} onClearFocus={() => setFocus(new Set())} />
        ) : (
          <div className="tracks" ref={scrollRef}>
            <div className="track-names">
              <div className="ruler" style={{ paddingLeft: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ position: 'static', transform: 'none' }}>
                  {selection.length || isolatedBlockId
                    ? `${visible.length} track${visible.length === 1 ? '' : 's'}${selection.length ? ' · selected' : ''}`
                    : `${tl.tracks.length} tracks`}
                </span>
                {focus.size > 0 && (
                  <button className="btn ghost sm" style={{ height: 18, padding: '0 6px', fontSize: 10 }}
                    title="Clear property focus" onClick={() => setFocus(new Set())}>
                    {focus.size} focused · show all
                  </button>
                )}
              </div>
              {visible.map((t) => {
                const numeric = t.keyframes.every((k) => typeof k.value === 'number');
                return (
                  <div key={t.id} style={{ display: 'contents' }}>
                    <div className="trow" aria-selected={sel?.trackId === t.id}
                      data-focused={focus.has(t.id)} data-dim={dimmed(t.id)}
                      style={!focus.has(t.id) && colorForBlockId(t.blockId) ? { boxShadow: `inset 2.5px 0 0 ${colorForBlockId(t.blockId)}` } : undefined}
                      title="Click to focus this property in Tracks and Graph · shift-click to focus several"
                      onClick={(e) => toggleFocus(t.id, e.shiftKey)}>
                      {numeric ? (
                        <button className="expand" aria-pressed={expanded.has(t.id)} title="Show the value curve"
                          onClick={(e) => { e.stopPropagation(); setExpanded((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; }); }}>
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
                  {tl.blocks.map((b, i) => (
                    <div key={b.id} className="blockband" title={b.name}
                      style={{ left: starts[i] * pxPerMs, width: b.durationMs * pxPerMs, borderLeftColor: clipColor(project, b) || undefined }}>
                      {b.name}
                    </div>
                  ))}
                  {Array.from({ length: Math.floor(duration / tickStep) + 1 }, (_, i) => i * tickStep).map((t) => (
                    <span key={t} style={{ left: t * pxPerMs }}>{(t / 1000).toFixed(t % 1000 ? 1 : 0)}s</span>
                  ))}
                </div>
                {visible.map((t) => {
                  const numeric = t.keyframes.every((k) => typeof k.value === 'number');
                  return (
                    <div key={t.id} style={{ display: 'contents' }}>
                      <div className="lane" data-focused={focus.has(t.id)} data-dim={dimmed(t.id)}>
                        {t.keyframes.length > 1 && (
                          <span className="seg-fill" style={{ left: t.keyframes[0].time * pxPerMs, width: (t.keyframes[t.keyframes.length - 1].time - t.keyframes[0].time) * pxPerMs }} />
                        )}
                        {t.keyframes.map((k) => (
                          <span key={k.id} className="kfd" data-sel={selKeys.has(kfKey(t.id, k.id))} data-shape={easingShape(k.easingOut)}
                            style={{ left: k.time * pxPerMs }}
                            title={`${(k.time / 1000).toFixed(2)}s · ${easingLabel(k.easingOut)} — shift/cmd-click to select several`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              (e.target as Element).setPointerCapture?.(e.pointerId);
                              const key = kfKey(t.id, k.id);
                              const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                              let next: Set<string>;
                              if (additive) { next = new Set(selKeys); next.has(key) ? next.delete(key) : next.add(key); }
                              else next = selKeys.has(key) && selKeys.size > 1 ? new Set(selKeys) : new Set([key]);
                              setSelKeys(next);
                              if (!next.has(key)) { kfDrag.current = null; return; }
                              const group = [...next].map(parseKfKey).map(({ trackId, kfId }) => {
                                const kf = tl.tracks.find((x) => x.id === trackId)?.keyframes.find((x) => x.id === kfId);
                                return { trackId, kfId, startTime: kf?.time ?? 0 };
                              });
                              kfDrag.current = { keys: group, anchorStartTime: k.time };
                            }}
                            onPointerMove={(e) => {
                              const d = kfDrag.current;
                              if (!d) return;
                              e.stopPropagation();
                              const r = lanesRef.current!.getBoundingClientRect();
                              const raw = (e.clientX - r.left) / pxPerMs;
                              const snap = [...jumps, playhead].find((j) => Math.abs(j - raw) < 6 / pxPerMs && Math.abs(j - d.anchorStartTime) > 0.5);
                              const target = snap ?? raw;
                              const delta = target - d.anchorStartTime;
                              if (d.keys.length > 1) moveKeyframes(d.keys.map((x) => ({ trackId: x.trackId, kfId: x.kfId, time: x.startTime + delta })));
                              else moveKeyframe(d.keys[0].trackId, d.keys[0].kfId, target);
                            }}
                            onPointerUp={() => { kfDrag.current = null; }}
                            onDoubleClick={() => {
                              if (selKeys.size > 1 && selKeys.has(kfKey(t.id, k.id))) deleteKeyframes([...selKeys].map(parseKfKey));
                              else deleteKeyframe(t.id, k.id);
                              setSelKeys(new Set());
                            }} />
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
                <div className="dur-end" style={{ left: duration * pxPerMs }} title="Drag to change the timeline's total duration"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    durDrag.current = { startX: e.clientX, startMs: duration };
                  }}
                  onPointerMove={(e) => {
                    const d = durDrag.current;
                    if (!d) return;
                    e.stopPropagation();
                    setTimelineDuration(d.startMs + (e.clientX - d.startX) / pxPerMs);
                  }}
                  onPointerUp={() => { durDrag.current = null; }}
                  onPointerCancel={() => { durDrag.current = null; }} />
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
 * The visible, editable seam between two clips (spec §9) — never invisible metadata.
 * Every seam morphs by default now (no more silent hard cuts), so this reads three states:
 * a faint "⋯" means the implicit default (250ms easeInOut, nothing stored yet) is doing
 * the work; a filled "◆" means someone customized it; a hollow "–" means it was explicitly
 * turned off (`durationMs: 0`) for an intentional hard cut, the one opt-out that exists.
 */
function TransitionConnector({ transition, onChange, onRemove }: {
  transition: Transition | undefined;
  onChange: (patch: Partial<Pick<Transition, 'durationMs' | 'easing'>>) => void;
  onRemove: () => void;
}) {
  const isNone = transition?.durationMs === 0;
  const effective = transition ?? { durationMs: DEFAULT_TRANSITION_MS, easing: DEFAULT_TRANSITION_EASING };
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  // .strip clips overflow-y (the same reason the cut-button hit area had to move inline
  // rather than hang off the block's edge) — an absolutely-positioned popover here would
  // be invisible, not just clipped at the corner. Portal it to <body> as position:fixed
  // instead, computed from the trigger's real screen position, and close on scroll/outside
  // click since it's no longer anchored in the DOM to move or get dismissed automatically.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    };
    place();
    const onOutside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || popover.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', () => setOpen(false), { capture: true, once: true });
    document.addEventListener('pointerdown', onOutside, true);
    return () => document.removeEventListener('pointerdown', onOutside, true);
  }, [open]);

  return (
    <div className="flex w-[22px] flex-none items-center justify-center self-stretch">
      <button ref={btn}
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] leading-none transition-colors ${isNone
          ? 'border-line text-muted hover:border-ink-2 hover:text-ink-2'
          : transition ? 'border-signal bg-signal-soft text-signal' : 'border-line-soft text-muted/70 hover:border-ink-2 hover:text-ink-2'}`}
        title={isNone ? 'Hard cut — no morph. Click to change.'
          : `Transition: ${easingLabel(effective.easing)} · ${(effective.durationMs / 1000).toFixed(2)}s${transition ? '' : ' (default)'} — click to edit`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {isNone ? '–' : transition ? '◆' : '⋯'}
      </button>
      {open && createPortal(
        <div ref={popover} className="fixed z-50 -translate-x-1/2" style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-2 rounded-lg border border-line-soft bg-panel p-2.5 shadow-lg">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted">
              <span className="flex-1 text-ink-2">Transition</span>
              {!isNone && (
                <>
                  <span>duration</span>
                  <input type="number" min={20} step={20} className="w-14 rounded border border-line bg-field px-1 py-0.5 text-[11px] text-ink"
                    value={effective.durationMs}
                    onChange={(e) => onChange({ durationMs: Math.max(20, Math.round(+e.target.value)) })} />
                  <span>ms</span>
                </>
              )}
            </div>
            {!isNone && <CurveEditor value={effective.easing} onChange={(easing) => onChange({ easing })} />}
            <div className="flex items-center gap-2">
              {transition && !isNone && (
                <button className="text-[10px] font-medium text-muted underline decoration-dotted underline-offset-2 self-start"
                  onClick={() => { onRemove(); setOpen(false); }}>
                  Reset to default
                </button>
              )}
              <button className="text-[10px] font-medium text-hot underline decoration-dotted underline-offset-2 self-start"
                onClick={() => { isNone ? onRemove() : onChange({ durationMs: 0 }); setOpen(false); }}>
                {isNone ? 'Turn morphing back on' : 'None — hard cut'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
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
  const setFps = (v: number) => commit((p) => { p.fps = Math.min(60, Math.max(6, Math.round(v))); }, 'fps');
  const isStandard = FPS_OPTIONS.includes(project.fps);
  return (
    <div className="fps" title="Frames per second — the rate every export bakes at">
      <span className="prop-label"><span className="t">fps</span></span>
      <select className="sel" value={isStandard ? project.fps : 'custom'}
        onChange={(e) => { if (e.target.value !== 'custom') setFps(+e.target.value); }}>
        {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        {!isStandard && <option value="custom">{project.fps} (custom)</option>}
      </select>
    </div>
  );
}
