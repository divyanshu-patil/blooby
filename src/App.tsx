import { useEffect, useRef, useState } from 'react';
import { useEditor } from './core/store';
import { defaultProject } from './core/defaults';
import { Stage } from './ui/Stage';
import { Layers } from './ui/Layers';
import { Presets, Expressions } from './ui/Presets';
import { NodeInspector, CameraPanel, ClipInspector } from './ui/Inspector';
import { EyePanel } from './ui/EyePanel';
import { Effects } from './ui/Effects';
import { Timeline, DurationField } from './ui/Timeline';
import { Copilot } from './ui/Copilot';
import { ExportBar } from './ui/ExportBar';
import { Split } from './ui/Resizable';
import { TimelineTabs } from './ui/TimelineTabs';
import { Gallery, openGallery } from './ui/Gallery';
import { activeTimeline } from './core/types';
import type { Project } from './core/types';

type Tab = 'node' | 'eyes' | 'fx' | 'ai';

export default function App() {
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
      const { playhead, project: p } = useEditor.getState();
      const duration = activeTimeline(p).timelineDurationMs;
      let t = playhead + (now - last);
      last = now;
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
        <button className="btn sm" onClick={openGallery}>Gallery</button>
        <button className="btn sm" title="Start over from the default mascot"
          onClick={() => confirm('Discard this project and start fresh?') && loadProject(defaultProject())}>New</button>
        <ExportBar />
      </header>

      <div className="body-split">
        <Split direction="column" storageKey="vertical" flexIndex={0} panes={[
          { content: (
            <Split direction="row" storageKey="main" flexIndex={1} panes={[
              { min: 190, max: 460, content: (
                <div className="rail rail-left">
                  <Layers />
                  <Presets />
                  <Expressions />
                </div>
              ) },
              { min: 320, content: <div className="stage"><Stage /></div> },
              { min: 240, max: 560, content: (
                <div className="rail rail-right">
                  <div className="tabs">
                    {(['node', 'eyes', 'fx', 'ai'] as Tab[]).map((t) => (
                      <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
                        {t === 'node' ? (selectedBlockId ? 'Clip' : 'Node') : t === 'eyes' ? 'Eyes' : t === 'fx' ? 'Effects' : 'Copilot'}
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
                    {tab === 'ai' && <Copilot />}
                  </div>
                </div>
              ) },
            ]} />
          ) },
          { min: 220, max: 780, default: 420, content: (
            <div className="timeline-pane">
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
