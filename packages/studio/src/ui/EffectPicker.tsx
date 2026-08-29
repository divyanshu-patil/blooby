import { useEffect, useMemo, useRef, useState } from 'react';
import { COMP, effectPreviewProject } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { MODIFIER_KINDS, MODIFIERS, type Emitter, type Modifier, type ModifierKind, type Project } from '../core/types';
import { MascotThumb, sceneBounds, unionBounds, type Bounds } from './Mascot';

export interface EffectChoice {
  key: string;
  label: string;
  help: string;
  group: 'modifier' | 'effect';
  /** what gets added; exactly one of these */
  modifier?: Omit<Modifier, 'id' | 'nodeId'>;
  emitter?: (nodeId: string) => Omit<Emitter, 'id' | 'blockId'>;
  /** a burst rather than a stream: ranged to the playhead when added */
  burstMs?: number;
}

/**
 * A drawer of everything that can be added, with a live preview of whatever is hovered.
 *
 * A row of `+ Shake` buttons tells you a shake exists and nothing about what it looks
 * like, which for eight of them is eight guesses. Here the list is the whole catalogue,
 * one line of description each, and hovering plays it on a resting mascot — the difference
 * between float and pendulum is obvious in a second and unguessable from two words.
 */
export function EffectPicker({ project, choices, title, onPick, onClose }: {
  project: Project;
  choices: EffectChoice[];
  title: string;
  onPick: (c: EffectChoice) => void;
  onClose: () => void;
}) {
  const [hover, setHover] = useState<EffectChoice | null>(choices[0] ?? null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="drawer-scrim" role="presentation" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <strong>{title}</strong>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>

        <div className="drawer-preview">
          {hover ? <EffectPreview project={project} choice={hover} /> : <p className="empty-note">Hover one to see it.</p>}
        </div>
        <div className="drawer-caption">
          <strong>{hover?.label ?? ''}</strong>
          <span>{hover?.help ?? ''}</span>
        </div>

        <div className="drawer-list">
          {(['modifier', 'effect'] as const).map((g) => {
            const items = choices.filter((c) => c.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <span className="panel-title">{g === 'modifier' ? 'modifiers' : 'effects'}</span>
                {items.map((c) => (
                  <button key={c.key} className="drawer-item" aria-pressed={hover?.key === c.key}
                    onPointerEnter={() => setHover(c)} onFocus={() => setHover(c)}
                    onClick={() => { onPick(c); onClose(); }}>
                    <span className="drawer-item-name">{c.label}</span>
                    <span className="drawer-item-help">{c.help}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

/** Plays the hovered effect on a resting mascot, on a loop. */
function EffectPreview({ project, choice }: { project: Project; choice: EffectChoice }) {
  const [t, setT] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    const started = performance.now();
    const tick = () => {
      setT((performance.now() - started) % 2000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [choice.key]);

  const temp = useMemo(() => {
    try {
      return effectPreviewProject(project, {
        modifier: choice.modifier ? { ...choice.modifier, nodeId: project.rig.rootId } : undefined,
        emitter: choice.emitter?.(project.rig.rootId),
      });
    } catch { return null; }
  }, [project, choice]);

  // the whole loop's frame, once — a big pad only dampened the reframing, it did not stop
  // it, and the mascot still crept as particles came and went
  const box = useMemo(() => {
    if (!temp) return null;
    let b: Bounds | null = null;
    for (let i = 0; i < 24; i++) {
      try { b = unionBounds(b, sceneBounds(sceneAt(temp, (i / 24) * 2000, COMP))); } catch { /* skip */ }
    }
    return b && {
      x0: Math.max(0, b.x0), y0: Math.max(0, b.y0),
      x1: Math.min(COMP.width, b.x1), y1: Math.min(COMP.height, b.y1),
    };
  }, [temp]);

  const scene = (() => {
    try { return temp ? sceneAt(temp, t, COMP) : null; } catch { return null; }
  })();

  if (!scene) return <p className="empty-note">No preview.</p>;
  return <MascotThumb scene={scene} view={COMP} box={box} pad={24} />;
}

/** The built-in modifiers, described so the list is readable without hovering. */
export const MODIFIER_CHOICES: EffectChoice[] = MODIFIER_KINDS.map((k: ModifierKind) => ({
  key: k,
  label: MODIFIERS[k].label,
  help: MODIFIERS[k].blurb,
  group: 'modifier' as const,
  modifier: {
    kind: k,
    ...(k === 'shake' ? { amount: 100, frequency: 12, amplitude: 6, seed: 1 }
      : k === 'float' ? { amount: 100, frequency: 0.6, amplitude: 8, phase: 0 }
      : k === 'stretch' ? { amount: 100, frequency: 0.8, amplitude: 12, phase: 0 }
      : { amount: 100, frequency: 0.7, amplitude: 10, phase: 0 }),
  },
}));
