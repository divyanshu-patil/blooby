import { it } from 'vitest';
import { check } from '../core/testkit';

/**
 * Tailwind generated NOTHING, and nothing said so.
 *
 * `index.css` imports `tailwindcss/theme.css` and `tailwindcss/utilities.css` directly
 * rather than `tailwindcss` itself, which skips automatic source detection — so every
 * utility class in this package compiled to no CSS at all, and `flex flex-col gap-2` laid
 * its children out inline. There is no error and no warning; it surfaces only as a panel
 * that looks wrong. `@source` in index.css fixes it, but the durable protection is that
 * this panel is written against the hand-rolled stylesheet, which cannot silently vanish.
 *
 * `?raw` works on a .tsx here; on a .css it comes back empty (Vite's CSS pipeline runs
 * first), so this asserts on the component rather than on the stylesheet.
 */
import panel from './StateMachine.tsx?raw';

const LOOSE = /className="[^"]*\b(flex-col|flex-wrap|gap-[0-9]|px-[0-9]|py-[0-9]|rounded-(md|lg|full)|bg-(field|panel|signal|line)|border-line-soft)\b[^"]*"/;

it('the state panel uses the project stylesheet, not loose utilities', check(
  !LOOSE.test(panel), LOOSE.exec(panel)?.[0] ?? ''));

it('and leans on the panel classes index.css defines for it', check(
  ['sm-card', 'sm-head', 'sm-row', 'sm-key', 'sm-note', 'sm-issue'].every((c) => panel.includes(c))));

// --- tooltips ------------------------------------------------------------------
// Crude on purpose: it cannot judge whether a tooltip is *good*, only that controls are
// not landing with no explanation at all. Every control on this panel maps to something
// in a file the designer never sees, so "what does this do" is the default state.
const controls = (panel.match(/<(input|select)\b/g) ?? []).length;
const titled = (panel.match(/title=/g) ?? []).length;
it('every input and select is outnumbered by tooltips', check(
  titled > controls, `${titled} titles for ${controls} inputs/selects`));
