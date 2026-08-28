import { useEffect, useRef, useState } from 'react';
import { COMP, MascotThumb, sceneAt, type Project } from '@blooby/studio';

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

  const scene = (() => {
    try { return data ? sceneAt(data as Project, t, COMP) : null; } catch { return null; }
  })();

  return (
    <div className="splash-preview" style={{ background }}>
      {scene
        ? (
          <div style={{ width: '58%', opacity: fading ? 0 : 1, transition: `opacity ${fadeMs}ms ease` }}>
            <MascotThumb scene={scene} view={COMP} />
          </div>
        )
        : <p className="splash-preview-empty">This animation can’t be rendered. Choose another source.</p>}
    </div>
  );
}
