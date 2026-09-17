import { useEffect, useMemo, useRef, useState } from 'react';
import { sceneAt } from '../core/scene';
import { compOf, defaultProject, presetPreviewProject } from '../core/defaults';
import { migrateProject } from '../core/migrate';
import { derivedDuration } from '../core/timeline';
import { MascotThumb, sceneBounds, unionBounds, type Bounds } from '../ui/Mascot';
import { activeTimeline, type Preset, type Project } from '../core/types';

/**
 * The signature of the whole shell: a card's picture is the mascot itself, rendered from
 * the project's own scene at its most characteristic frame — not a stored PNG.
 *
 * It costs one pure function call, it can never go stale against the animation it stands
 * for, and it means an empty S3 bucket still produces a browsable library.
 */
export function ProjectThumb({ project, at = 0 }: { project: Project | null; at?: number }) {
  const scene = useMemo(() => {
    if (!project) return null;
    try { return sceneAt(project, at, compOf(project)); } catch { return null; }
  }, [project, at]);

  if (!scene) return <Placeholder />;
  return <MascotThumb scene={scene} view={compOf(project)} />;
}

/** Where in the active timeline the three frames of a card are taken: early, middle, late. */
export const THUMB_FRAMES = [0.12, 0.5, 0.82];

/** The frames a card cycles through, as fractions of the active timeline's length, in ms. */
export function thumbTimes(project: Project): number[] {
  const tl = activeTimeline(project);
  const span = tl.timelineDurationMs ?? derivedDuration(tl);
  return span > 0 ? THUMB_FRAMES.map((f) => Math.round(span * f)) : [0];
}

/** A stored project JSON as something the renderer can draw: migrated, and backfilled with the
 *  default rig when it is empty (a brand-new project's file is `{}`). */
export function thumbProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    const { project } = migrateProject({ ...(raw as Project) });
    return project.rig && project.timelines?.length ? project : { ...fallback(), ...project, rig: project.rig ?? fallback().rig, timelines: fallback().timelines, activeTimelineId: fallback().activeTimelineId };
  } catch { return null; }
}
let blank: Project | null = null;
/** built once: a default project costs ~90ms (every builtin preset), and a dashboard has dozens of cards */
const fallback = () => (blank ??= defaultProject());

// ponytail: the dashboard fetches each visible card's project JSON once per edit (keyed by
// id + updatedAt). Store a rendered thumbnail at save time if a large dashboard gets slow.
const loads = new Map<string, Promise<Project | null>>();

/**
 * A card's picture, loaded when the card scrolls into view: three frames of its timeline —
 * early, middle, late — crossfading slowly, framed on the union of all three so the mascot
 * does not jump. With reduced motion it holds the middle frame.
 */
export function LiveProjectThumb({ cacheKey, load }: { cacheKey: string; load: () => Promise<unknown> }) {
  const host = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [seen, setSeen] = useState(false);
  const [frame, setFrame] = useState(1);

  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    if (!loads.has(cacheKey)) loads.set(cacheKey, Promise.resolve().then(load).then(thumbProject).catch(() => { loads.delete(cacheKey); return null; }));
    void loads.get(cacheKey)!.then((p) => { if (live) setProject(p); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is named by cacheKey
  }, [seen, cacheKey]);

  const frames = useMemo(() => {
    if (!project) return null;
    try {
      const view = compOf(project);
      const scenes = thumbTimes(project).map((t) => sceneAt(project, t, view));
      const box = scenes.reduce<Bounds | null>((b, s) => unionBounds(b, sceneBounds(s)), null);
      return { view, scenes, box };
    } catch { return null; }
  }, [project]);

  useEffect(() => {
    if (!frames || frames.scenes.length < 2) return;
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.scenes.length), 1100);
    return () => clearInterval(id);
  }, [frames]);

  return (
    <div ref={host} className="thumb-frames">
      {project === undefined ? null : !frames ? <Placeholder /> : frames.scenes.map((scene, i) => (
        <div key={i} className="thumb-frame" data-on={i === Math.min(frame, frames.scenes.length - 1) || undefined}>
          <MascotThumb scene={scene} view={frames.view} box={frames.box} />
        </div>
      ))}
    </div>
  );
}

/** An asset holds only its tracks, so it is previewed on the default rig — the same way
 *  the editor's own preset chips already draw themselves. */
export function AssetThumb({ preset, at = 0 }: { preset: Preset | null; at?: number }) {
  const scene = useMemo(() => {
    if (!preset?.tracks) return null;
    try {
      // the editor's own construction, so a preset's hands, legs, shapes and effects come too
      const temp: Project = presetPreviewProject(defaultProject(), preset);
      return sceneAt(temp, at, compOf(temp));
    } catch { return null; }
  }, [preset, at]);

  if (!scene) return <Placeholder />;
  return <MascotThumb scene={scene} view={compOf(null)} />;
}

const Placeholder = () => (
  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>no preview</span>
);
