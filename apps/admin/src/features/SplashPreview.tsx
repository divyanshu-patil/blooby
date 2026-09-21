import { useEffect, useRef, useState } from 'react';
import { compOf, MascotThumb, sceneAt, type Project } from '@blooby/studio';

/**
 * Plays a splashscreen exactly as a visitor will see it — the same sceneAt() the runtime
 * overlay uses, the same duration, the same fade.
 *
 * Previewing with a still frame would hide the two things most likely to be wrong: an
 * animation that reads badly at speed, and a fade that begins before it has settled.
 */
export function SplashPreview({ data, background, durationMs, fadeMs, playKey }: {
  data: unknown; background: string; durationMs: number; fadeMs: number; playKey: number;
}) {
  const [t, setT] = useState(0);
  const [fading, setFading] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    setT(0);
    setFading(false);
    const started = performance.now();
    const tick = () => {
      const elapsed = performance.now() - started;
      setT(elapsed);
      if (elapsed >= durationMs) setFading(true);
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [durationMs, playKey, data]);

  const view = compOf(data as Project);
  const scene = (() => {
    try { return data ? sceneAt(data as Project, t, view) : null; } catch { return null; }
  })();

  return (
    <div className="splash-preview" style={{ background }}>
      {scene
        ? (
          <div style={{
            height: '86%', aspectRatio: `${view.width} / ${view.height}`,
            opacity: fading ? 0 : 1, transition: `opacity ${fadeMs}ms ease`,
          }}>
            {/* framed by the composition, never by what is in it: left to fit its own
             *  bounds the mascot grows and shrinks as particles fly and as you switch
             *  preset, which is not what ships */}
            <MascotThumb scene={scene} view={view} box={COMP_BOX(view)} pad={0} />
          </div>
        )
        : <p className="splash-preview-empty">This animation can’t be rendered. Choose another source.</p>}
    </div>
  );
}

const COMP_BOX = (view: { width: number; height: number }) =>
  ({ x0: 0, y0: 0, x1: view.width, y1: view.height });
