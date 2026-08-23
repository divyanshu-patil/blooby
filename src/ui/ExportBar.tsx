import { useState } from 'react';
import { useEditor } from '../core/store';
import { bakeLottie } from '../export/lottie';
import { buildDotLottie } from '../export/dotlottie';
import { download, exportGif, exportPng, exportVideo, videoMime } from '../export/raster';

const INK_BG = '#17161b';

export function ExportBar() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const [busy, setBusy] = useState<{ what: string; p: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [bg, setBg] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const mime = videoMime();

  const base = project.name.replace(/\s+/g, '-').toLowerCase() || 'mascot';
  const background = bg ? INK_BG : null;

  const run = async (what: string, fn: (p: (n: number) => void) => Promise<void>) => {
    setBusy({ what, p: 0 });
    setNote(null);
    try { await fn((p) => setBusy({ what, p })); }
    catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const lottieJson = () => {
    const baked = bakeLottie(project, { background, name: project.name });
    download(new Blob([JSON.stringify(baked.json)], { type: 'application/json' }), `${base}.json`);
    setNote(`${baked.frames} frames → ${baked.keyframeCount} keyframes${baked.skipped.length ? ` · SVG layers skipped: ${baked.skipped.join(', ')}` : ''}`);
  };

  const dotLottie = () => {
    const { blob, animations } = buildDotLottie(project, { background });
    download(blob, `${base}.lottie`);
    setNote(`${animations.length} animation${animations.length === 1 ? '' : 's'}: ${animations.join(', ')}`);
  };

  return (
    <>
      <details className="export">
        <summary className="btn primary" style={{ listStyle: 'none' }}>Export ▾</summary>
        <div className="export-pop panel">
          <div className="panel-body">
            <div className="row">
              <span className="prop-label" style={{ flex: 1 }}>Backdrop</span>
              <button className="btn sm" aria-pressed={bg} onClick={() => setBg(!bg)}>{bg ? 'Ink' : 'Transparent'}</button>
            </div>
            <div className="row">
              <span className="prop-label" style={{ flex: 1 }}>Size</span>
              <div className="seg">
                {[0.5, 1, 2].map((s) => (
                  <button key={s} aria-pressed={scale === s} onClick={() => setScale(s)}>{Math.round(720 * s)}px</button>
                ))}
              </div>
            </div>
            <div className="divider" />
            <button className="btn" onClick={lottieJson}>Lottie JSON</button>
            <button className="btn" onClick={dotLottie}>
              .lottie {project.blocks.length > 1 ? `· ${project.blocks.length + 1} states` : ''}
            </button>
            <button className="btn" disabled={!!busy}
              onClick={() => run('GIF', async (p) => download(await exportGif(project, { fps: Math.min(project.fps, 25), scale, background }, p), `${base}.gif`))}>
              Animated GIF
            </button>
            <button className="btn" disabled={!!busy || !mime}
              title={mime ? `Records as ${mime}` : 'This browser cannot record canvas video'}
              onClick={() => run('Video', async (p) => {
                const { blob, ext } = await exportVideo(project, { fps: project.fps, scale, background }, p);
                download(blob, `${base}.${ext}`);
              })}>
              {mime?.startsWith('video/mp4') ? 'MP4 video' : 'WebM video'}
            </button>
            <button className="btn" disabled={!!busy}
              onClick={() => run('PNG', async () => download(await exportPng(project, playhead, scale * 2, background), `${base}-${Math.round(playhead)}ms.png`))}>
              PNG of this frame
            </button>
            {note && <p className="hint">{note}</p>}
            {!mime && <p className="hint">Video recording is unavailable here — GIF and Lottie still work.</p>}
          </div>
        </div>
      </details>
      {busy && (
        <div className="toast" role="status">
          Rendering {busy.what}
          <span className="bar"><i style={{ width: `${Math.round(busy.p * 100)}%` }} /></span>
          {Math.round(busy.p * 100)}%
        </div>
      )}
    </>
  );
}
