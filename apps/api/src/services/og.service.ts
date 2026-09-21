import {
  compOf, defaultProject, migrateProject, sceneAt, sceneBounds, sceneToSvg,
  type FrameWindow, type Project,
} from '@blooby/studio/engine';
import { png } from './mcp/host.js';

/**
 * The picture and the words a link to Blooby unfurls with.
 *
 * A shared project shows THE MASCOT, drawn by the same renderer as the editor's stage
 * (`frameSvg` → `Shapes`), not a stock card with a logo on it. The thing being shared is a
 * character someone made; a card that does not show it is a card nobody clicks.
 *
 * Only PUBLIC projects get their own card. A private one falls back to the generic card
 * and generic words — the name of a private project is not public, and an unfurled link
 * preview is rendered by whatever service the link was pasted into, which is to say by a
 * stranger's server. That is exactly the shape of leak an og endpoint is used for.
 */

/** Facebook's stated ideal, and what every other unfurler crops from without complaining. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const escape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The card: words on the left, the mascot on the right.
 *
 * Side by side rather than stacked, because the mascot is the whole reason anyone clicks
 * and stacking gave it the short axis — a 1088×442 letterbox, of which a square character
 * could only use 442. A right-hand panel gives it ~560×518 and reads the way a product
 * card is expected to.
 *
 * The composition is FITTED, never stretched: a square project and a tall one both have to
 * look deliberate, and a squashed mascot is worse than one with room around it.
 */
function card(inner: string, view: FrameWindow, title: string, caption: string): string {
  const pad = 64;
  const art = { w: OG_WIDTH * 0.46, h: OG_HEIGHT - pad * 2 };
  const artX = OG_WIDTH - pad - art.w;

  const scale = Math.min(art.w / view.width, art.h / view.height);
  const w = view.width * scale, h = view.height * scale;
  const x = artX + (art.w - w) / 2, y = pad + (art.h - h) / 2;

  // The mascot's own svg, placed and scaled as a nested viewport. The viewBox has to carry
  // the CROP's origin, not 0 0 — the shapes are still at their composition coordinates, so
  // a viewBox starting at the origin shows whichever corner of the canvas happens to be
  // there and cuts the mascot in half.
  const placed = inner.replace(
    /^<svg [^>]*?>/,
    `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="${view.x} ${view.y} ${view.width} ${view.height}">`,
  );

  const font = 'Helvetica, Arial, sans-serif';
  // wrapped by hand: there is no text measurement in an SVG we never lay out, and a title
  // is short enough that breaking near the middle of a long one is the whole problem
  const lines = wrap(title, 22, 2);
  const titleTop = OG_HEIGHT / 2 - (lines.length - 1) * 30 - 18;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#fafafa"/>
${placed}
<text x="${pad}" y="${pad + 30}" font-family="${font}" font-size="22" font-weight="600" letter-spacing="3" fill="#6b6b76">BLOOBY</text>
${lines.map((l, i) => `<text x="${pad}" y="${titleTop + i * 62}" font-family="${font}" font-size="54" font-weight="600" fill="#17171c">${escape(l)}</text>`).join('\n')}
<text x="${pad}" y="${titleTop + lines.length * 62 + 6}" font-family="${font}" font-size="24" fill="#6b6b76">${escape(caption.slice(0, 60))}</text>
</svg>`;
}

/** Break on spaces at roughly `per` characters, up to `max` lines, eliding the rest. */
function wrap(text: string, per: number, max: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [''];
  for (const word of words) {
    const line = lines[lines.length - 1];
    if (!line) lines[lines.length - 1] = word;
    else if (line.length + 1 + word.length <= per) lines[lines.length - 1] = `${line} ${word}`;
    else if (lines.length < max) lines.push(word);
    else { lines[lines.length - 1] = `${line.slice(0, per - 1)}…`; break; }
  }
  return lines.filter(Boolean).length ? lines.filter(Boolean) : ['Untitled'];
}

/** Where in the timeline a card is taken: far enough in to be mid-pose, not the rest frame. */
const CARD_AT_MS = 400;

/**
 * Extra room around the mascot, as a share of its own size — small on purpose.
 *
 * `sceneBounds` measures each shape with `hypot(w, h) / 2`, a radius that holds however
 * the shape is rotated, which for an unrotated circle is already ~41% wider than it needs
 * to be. That inflation IS the breathing room; adding a generous margin on top of it was
 * what left the mascot looking like a dot in a field of paper.
 */
const BREATHING = 0.02;

/**
 * The frame to draw: what the scene ACTUALLY covers, not the composition it sits in.
 *
 * A mascot occupies a fraction of a 720×720 canvas, and fitting the canvas made the card
 * mostly empty paper with a small face in it — unreadable at the size a link preview is
 * shown. This is the same trick the dashboard's cards use (`sceneBounds` + a union), and
 * it is why `frameSvg` takes a window at all.
 */
function cropped(project: Project, atMs: number): { svg: string; view: FrameWindow } {
  const comp = compOf(project);
  const scene = sceneAt(project, atMs, comp);
  const b = sceneBounds(scene);
  const full: FrameWindow = { x: 0, y: 0, width: comp.width, height: comp.height };
  if (!b) return { svg: sceneToSvg(scene, null, comp), view: full };

  const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * BREATHING;
  const view: FrameWindow = {
    x: b.x0 - pad, y: b.y0 - pad,
    width: Math.max(1, b.x1 - b.x0 + pad * 2),
    height: Math.max(1, b.y1 - b.y0 + pad * 2),
  };
  return { svg: sceneToSvg(scene, null, comp, view), view };
}

/**
 * The stored document as the renderer needs it.
 *
 * `migrateProject` does all of it, preset references included — it calls `unpackPresets`
 * itself, because a stored project holds builtin ids rather than copies. A brand-new
 * project's file is `{}` and has no rig to draw, which is a generic card, not an error.
 */
export function readable(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    const { project } = migrateProject({ ...(raw as Project) });
    return project.rig && project.timelines?.length ? project : null;
  } catch { return null; }
}

export const ogService = {
  /** One project's card. */
  project(project: Project, name: string, caption: string): Buffer {
    return png(ogService.projectSvg(project, name, caption), OG_WIDTH);
  },

  /** The same card before it is rastered. Rendering a 1200px PNG is the expensive step and
   *  has nothing to do with whether a name is escaped, so the two are testable apart. */
  projectSvg(project: Project, name: string, caption: string): string {
    const { svg, view } = cropped(project, CARD_AT_MS);
    return card(svg, view, name, caption);
  },

  /**
   * The card for everything that is not one project: the landing page, a private project,
   * a document that will not render. Built from the default mascot — the same character
   * someone meets when they make their first project.
   */
  generic(title = 'blooby', caption = 'Design a mascot, animate it, export Lottie.'): Buffer {
    const { svg, view } = cropped(defaultProject(), CARD_AT_MS);
    return png(card(svg, view, title, caption), OG_WIDTH);
  },
};
