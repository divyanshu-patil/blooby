import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../core/store';
import { defaultProject } from '../core/defaults';
import { Stage } from './Stage';
import { Layers } from './Layers';
import { Presets, Expressions, OtherTimelines } from './Presets';
import { NodeInspector, CameraPanel, ClipInspector } from './Inspector';
import { EyePanel } from './EyePanel';
import { Effects } from './Effects';
import { Timeline, DurationField } from './Timeline';
import { Copilot } from './Copilot';
import { ExportBar } from './ExportBar';
import { Split } from './Resizable';
import { TimelineTabs } from './TimelineTabs';
import { Gallery, openGallery } from './Gallery';
import { StateMachine } from './StateMachine';
import { activeTimeline } from '../core/types';
import { startTourWhenReady } from '../kit/tour';
import { TourMenu } from '../kit/TourMenu';
import { EDITOR_TOURS, INTRO_TOUR } from './tours';
import type { Project } from '../core/types';

type Tab = 'node' | 'eyes' | 'fx' | 'states' | 'ai';


/** The whole editor UI — apps/web renders it with no onSave (local-file Save/Open only),
 * apps/admin's Preset Publisher passes onSave/saveLabel to add a second save destination
 * (a cloud table) alongside the local JSON download, which always stays available. */
export function Editor({ onSave, saveLabel }: { onSave?: (project: Project) => void; saveLabel?: string } = {}) {
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
  const commit = useEditor((s) => s.commit);
  const loadProject = useEditor((s) => s.loadProject);
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
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === ' ') { e.preventDefault(); setPlaying(!useEditor.getState().playing); }
      if (e.key === 'Home') setPlayhead(0);
      if ((e.key === 'Backspace' || e.key === 'Delete') && selection[0]) deleteNode(selection[0]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setPlaying, setPlayhead, selection, deleteNode]);

  const importProject = async (f: File) => {
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
        <span className="spacer" />
        <input ref={file} type="file" accept=".json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importProject(f); e.target.value = ''; }} />
        <button className="btn ghost sm" onClick={undo} title="Undo (⌘Z)">Undo</button>
        <button className="btn ghost sm" onClick={redo} title="Redo (⇧⌘Z)">Redo</button>
        <button className="btn sm" onClick={() => file.current?.click()}>Open</button>
        <button className="btn sm" onClick={saveProject}>Save</button>
        {onSave && <button className="btn sm" onClick={() => onSave(project)}>{saveLabel ?? 'Save to cloud'}</button>}
        <button className="btn sm" onClick={openGallery}>Gallery</button>
        <button className="btn sm" title="Start over from the default mascot"
          onClick={() => confirm('Discard this project and start fresh?') && loadProject(defaultProject())}>New</button>
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
                    {tab === 'node' && (
                      selectedBlockId ? <ClipInspector /> : (
                        <Split direction="column" storageKey="rail-node" panes={[
                          { min: 160, content: <NodeInspector /> },
                          { min: 140, content: <CameraPanel /> },
                        ]} />
                      )
                    )}
                    {tab === 'eyes' && <EyePanel />}
                    {tab === 'fx' && (
                      <Split direction="column" storageKey="rail-fx" panes={[
                        { min: 160, content: <Effects /> },
                        { min: 140, content: <CameraPanel /> },
                      ]} />
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
              <Timeline />
            </div>
          ) },
        ]} />
      </div>
      <Gallery />
    </div>
  );
}
