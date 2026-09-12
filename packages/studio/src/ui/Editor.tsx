import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { Stage } from './Stage';
import { Layers } from './Layers';
import { Presets, Expressions, OtherTimelines } from './Presets';
import { NodeInspector, CameraPanel, ClipInspector } from './Inspector';
import { EyePanel } from './EyePanel';
import { Effects } from './Effects';
import { Collapsible } from './Collapsible';
import { Timeline, DurationField } from './Timeline';
import { Copilot } from './Copilot';
import { ExportBar } from './ExportBar';
import { Split } from './Resizable';
import { TimelineTabs } from './TimelineTabs';
import { Gallery, openGallery } from './Gallery';
import { importDotLottie } from '../export/dotlottie';
import { StateMachine } from './StateMachine';
import { looksLikeSvg } from '../core/svg';
import { makeSvgLayer } from '../core/layers';
import { activeTimeline } from '../core/types';
import { startTourWhenReady } from '../kit/tour';
import { TourMenu } from '../kit/TourMenu';
import { EDITOR_TOURS, INTRO_TOUR } from './tours';
import type { ReactNode } from 'react';
import type { Project } from '../core/types';

type Tab = 'node' | 'eyes' | 'fx' | 'states' | 'ai';


/** The whole editor UI — apps/web renders it with no onSave (local-file Save/Open only),
 * apps/admin's Preset Publisher passes onSave/saveLabel to add a second save destination
 * (a cloud table) alongside the local JSON download, which always stays available.
 *
 * `cloudBar` is whatever owns persisting this project — a save state and a save button.
 * It sits inside this header rather than in a strip above it: a second bar carrying one
 * button and a title the editor already shows is a row of chrome for nothing. */
export function Editor({ onSave, saveLabel, cloudBar }: { onSave?: (project: Project) => void; saveLabel?: string; cloudBar?: ReactNode } = {}) {
  // first visit only; skipping counts as seen, and the ? button replays it
  useEffect(() => { startTourWhenReady('editor', INTRO_TOUR); }, []);
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const loop = useEditor((s) => s.loop);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const selection = useEditor((s) => s.selection);
  const selectedBlockId = useEditor((s) => s.selectedBlockId);
  const deleteNode = useEditor((s) => s.deleteNode);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const commit = useEditor((s) => s.commit);
  const loadProject = useEditor((s) => s.loadProject);
  const resetProject = useEditor((s) => s.resetProject);
  const [tab, setTab] = useState<Tab>('node');
  const file = useRef<HTMLInputElement>(null);

  // playback: wall-clock driven so a slow frame doesn't slow the animation down
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const state = useEditor.getState();
      const { playhead, project: p, pendingStateChange } = state;
      const duration = activeTimeline(p).timelineDurationMs;
      let t = playhead + (now - last);
      last = now;
      // a scheduled state.enableState(name, {at}) fires the instant playback reaches it
      if (pendingStateChange && t >= pendingStateChange.atMs) {
        state.setState(pendingStateChange.timelineId, { duration: pendingStateChange.durationMs, easing: pendingStateChange.easing });
        raf = requestAnimationFrame(tick);
        return;
      }
      if (t >= duration) {
        if (loop) t = t % duration;
        else { setPlayhead(duration); setPlaying(false); return; }
      }
      setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, setPlayhead, setPlaying]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd' && selection[0]) { e.preventDefault(); duplicateLayer(selection[0]); return; }
      if (e.key === ' ') { e.preventDefault(); setPlaying(!useEditor.getState().playing); }
      if (e.key === 'Home') setPlayhead(0);
      if (e.key === 'Escape') useEditor.getState().setEditPoints(false);
      if ((e.key === 'Backspace' || e.key === 'Delete') && selection.length) {
        const rig = useEditor.getState().project.rig;
        for (const id of selection) if (!rig.nodes[id]?.locked) deleteNode(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setPlaying, setPlayhead, selection, deleteNode, duplicateLayer]);

  /**
   * Paste an SVG anywhere — the stage, the timeline, the rails — and it becomes a layer,
   * starting at the playhead. Text fields keep their own paste (the shape editor's path
   * field turns an SVG into an outline instead), and anything that is not SVG markup is
   * left for the timeline's keyframe paste.
   */
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const text = e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text/html') || '';
      if (!looksLikeSvg(text)) return;
      const made = makeSvgLayer(text);
      if (!made) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const { addLayer: add, playhead } = useEditor.getState();
      add(made.node, { appearAt: playhead });
      setPasteNote(made.warnings.length ? `Pasted "${made.node.name}". Not carried over: ${made.warnings.join('; ')}.` : `Pasted "${made.node.name}".`);
      setTimeout(() => setPasteNote(null), 4000);
    };
    // capture, so it is decided here before the timeline's keyframe paste sees it
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  }, []);

  const importProject = async (f: File) => {
    // §12: a .lottie brings its state machine in — inputs, states, transitions,
    // conditions, timing and the initial state — rather than being treated as opaque.
    if (f.name.toLowerCase().endsWith('.lottie')) {
      try {
        const { project: next, states, inputs, warnings } = await importDotLottie(f, useEditor.getState().project);
        loadProject(next);
        alert([`Imported ${states} state${states === 1 ? '' : 's'} and ${inputs} input${inputs === 1 ? '' : 's'}.`, ...warnings].join('\n'));
      } catch (e) { alert(e instanceof Error ? e.message : 'That .lottie could not be read.'); }
      return;
    }
    try { loadProject(JSON.parse(await f.text()) as Project); }
    catch { alert('That file is not a blooby project.'); }
  };

  const saveProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}.blooby.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark"><span className="dot" />blooby</span>
        <input className="txt" style={{ width: 190 }} value={project.name} aria-label="Project name"
          onChange={(e) => commit((p) => { p.name = e.target.value; }, 'projname')} />
        <span className="crumb">
          <strong>{Object.keys(project.rig.nodes).length}</strong> layers ·
          <strong> {activeTimeline(project).tracks.length}</strong> tracks ·
          <strong> {activeTimeline(project).blocks.length}</strong> blocks
        </span>
        <DurationField />
        {cloudBar}
        <span className="spacer" />
        <input ref={file} type="file" accept=".json,.lottie" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importProject(f); e.target.value = ''; }} />
        <button className="btn ghost sm" onClick={undo} title="Undo (⌘Z)">Undo</button>
        <button className="btn ghost sm" onClick={redo} title="Redo (⇧⌘Z)">Redo</button>
        <button className="btn sm" title="A .blooby.json project, or a .lottie to import its state machine"
          onClick={() => file.current?.click()}>Open</button>
        <button className="btn sm" onClick={saveProject}>Save</button>
        {onSave && <button className="btn sm" onClick={() => onSave(project)}>{saveLabel ?? 'Save to cloud'}</button>}
        <button className="btn sm" onClick={openGallery}>Gallery</button>
        <button className="btn sm" title="Reset everything back to the default mascot — the rig, every timeline and the state machine"
          onClick={() => confirm(`Reset "${project.name}"?\n\nThe rig, every timeline, the state machine and all keyframes go back to the default mascot. This cannot be undone — save or export first if you want to keep it.`) && resetProject()}>New</button>
        <span data-tour="export"><ExportBar /></span>
        <TourMenu tours={EDITOR_TOURS} label="Show me around" />
      </header>

      <div className="body-split">
        <Split direction="column" storageKey="vertical" flexIndex={0} panes={[
          { content: (
            <Split direction="row" storageKey="main" flexIndex={1} panes={[
              { min: 190, max: 460, content: (
                <div className="rail rail-left" data-tour="rail-left">
                  <Layers />
                  <Presets />
                  <OtherTimelines />
                  <Expressions />
                </div>
              ) },
              { min: 320, content: <div className="stage" data-tour="stage"><Stage /></div> },
              { min: 240, max: 560, content: (
                <div className="rail rail-right" data-tour="rail-right">
                  <div className="tabs">
                    {(['node', 'eyes', 'fx', 'states', 'ai'] as Tab[]).map((t) => (
                      <button key={t} data-tour={`tab-${t}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
                        {t === 'node' ? (selectedBlockId ? 'Clip' : 'Node') : t === 'eyes' ? 'Eyes' : t === 'fx' ? 'Effects' : t === 'states' ? 'States' : 'Copilot'}
                      </button>
                    ))}
                  </div>
                  <div className="rail-tab-body">
                    {/* folds rather than a split, for the same reason as the Effects tab:
                        the inspector is the section you are working in, so it gets the height */}
                    {tab === 'node' && (
                      selectedBlockId ? <ClipInspector /> : (
                        <>
                          <NodeInspector />
                          <Collapsible title="Camera" storageKey="node-camera" defaultOpen={false}>
                            <CameraPanel bare />
                          </Collapsible>
                        </>
                      )
                    )}
                    {tab === 'eyes' && <EyePanel />}
                    {/* folds, not a split: a split gives every section a share of the
                        height whether or not it has anything in it, so the one you are
                        working in never gets enough */}
                    {tab === 'fx' && (
                      <>
                        <Effects />
                        <Collapsible title="Camera" storageKey="camera" defaultOpen={false}>
                          <CameraPanel bare />
                        </Collapsible>
                      </>
                    )}
                    {tab === 'states' && <StateMachine />}
                    {tab === 'ai' && <Copilot />}
                  </div>
                </div>
              ) },
            ]} />
          ) },
          { min: 220, max: 780, default: 420, content: (
            <div className="timeline-pane" data-tour="timeline">
              <TimelineTabs />
              <Timeline onOpenEffects={() => setTab('fx')} />
            </div>
          ) },
        ]} />
      </div>
      <Gallery />
      {pasteNote && <div className="toast" role="status">{pasteNote}</div>}
    </div>
  );
}
