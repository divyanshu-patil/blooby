import { useEffect, useRef, useState } from 'react';
import { splashApi } from './api';
import type { SplashscreenRow as SplashRow } from './types';
import { sceneAt } from '../core/scene';
import { COMP } from '../core/defaults';
import { MascotThumb } from '../ui/Mascot';
import type { Project } from '../core/types';

/**
 * The admin-controlled splash overlay.
 *
 * The hard requirement is that this can never trap anyone: it unmounts after its fade,
 * it stops being clickable the instant the fade starts, a load failure skips it entirely,
 * and a watchdog tears it down even if the animation frame loop never reports finishing.
 * Any of those failing would leave the app unreachable behind a decorative layer.
 */
export function Splashscreen({ onDone }: { onDone?: () => void }) {
  const [splash, setSplash] = useState<SplashRow | null>(null);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'fading' | 'gone'>('idle');
  const [t, setT] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    let live = true;
    splashApi
      .active()
      .then((s) => {
        if (!live) return;
        // no splash configured, or a malformed payload — either way, show the app
        if (!s || !s.data || typeof s.data !== 'object') { setPhase('gone'); onDone?.(); return; }
        setSplash(s);
        setPhase('playing');
      })
      .catch(() => { if (live) { setPhase('gone'); onDone?.(); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // drive the animation clock, then hand over to the fade
  useEffect(() => {
    if (phase !== 'playing' || !splash) return;
    const started = performance.now();
    const tick = () => {
      const elapsed = performance.now() - started;
      setT(elapsed);
      if (elapsed >= splash.durationMs) setPhase('fading');
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    // the frame loop is paused by the browser in a background tab, so a splash opened in
    // one would otherwise still be sitting there on return. This is the backstop.
    const watchdog = setTimeout(() => setPhase('fading'), splash.durationMs + 2000);
    return () => { cancelAnimationFrame(raf.current); clearTimeout(watchdog); };
  }, [phase, splash]);

  useEffect(() => {
    if (phase !== 'fading' || !splash) return;
    const t = setTimeout(() => { setPhase('gone'); onDone?.(); }, splash.fadeMs);
    return () => clearTimeout(t);
  }, [phase, splash, onDone]);

  if (phase === 'gone' || phase === 'idle' || !splash) return null;

  const scene = (() => {
    try {
      return sceneAt(splash.data as Project, t, COMP);
    } catch {
      // a payload the renderer rejects must not take the app down with it
      return null;
    }
  })();
  if (!scene) { queueMicrotask(() => { setPhase('gone'); onDone?.(); }); return null; }

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'grid', placeItems: 'center',
        background: splash.background,
        opacity: phase === 'fading' ? 0 : 1,
        // stops intercepting clicks the moment the fade begins, not when it ends
        pointerEvents: 'none',
        transition: `opacity ${splash.fadeMs}ms ease`,
      }}
    >
      <div style={{ width: 'min(52vmin, 380px)', aspectRatio: '1' }}>
        <MascotThumb scene={scene} view={COMP} />
      </div>
    </div>
  );
}
