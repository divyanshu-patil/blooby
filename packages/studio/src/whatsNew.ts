import { useSyncExternalStore } from 'react';
import type { DriveStep } from 'driver.js';

/**
 * What's New — the changelog people actually see, in the editor and on the dashboard.
 *
 * AGENTS: every user-visible change adds an item here, in the same change. A new version goes
 * at the TOP of `RELEASES` (newest first); its `version` must sort after the previous one
 * (YYYY.MM.DD, with a `.2` suffix for a second release on a day). Write items for a person,
 * not a commit log: what they can do now and where to find it. Give an item a `tour` when the
 * feature has a place on screen — its steps point at `data-tour` anchors that exist
 * (whatsNew.test.ts checks every one). See CLAUDE.md → "What's New".
 *
 * What a person has seen is one field, the newest version they closed the panel on:
 * `profiles.last_seen_release` when signed in (the web app wires it with `configureWhatsNew`),
 * localStorage otherwise. Everything newer is shown, from there.
 */

export type Surface = 'editor' | 'dashboard';

export interface WhatsNewItem {
  id: string;
  title: string;
  body: string;
  /** where it lives — its tour can only run there */
  surface: Surface;
  tour?: DriveStep[];
}

export interface Release {
  version: string;
  date: string;
  title: string;
  items: WhatsNewItem[];
}

const step = (element: string, title: string, description: string): DriveStep => ({ element: `[data-tour="${element}"]`, popover: { title, description } });

export const RELEASES: Release[] = [
  {
    version: '2026.09.20',
    date: '20 September 2026',
    title: 'Animate with Claude, ChatGPT and Cursor — and your picture in the sidebar',
    items: [
      {
        id: 'mcp-connect', surface: 'editor',
        title: 'Connect an AI app',
        body: 'The new MCP tab shows your Blooby MCP link. Copy it, paste it into Claude (or ChatGPT, Cursor, Claude Code) as a connector, approve on the Blooby page it opens — then ask it to animate, and watch the changes land here. It uses the same tools as the editor, renders frames to check its own work, and can export Lottie for you.',
        tour: [
          step('tab-mcp', 'The MCP tab', 'Everything about AI apps: how to connect one, what it is doing right now, and its changes waiting for your approval.'),
          step('mcp-link', 'Your MCP link', 'Copy it and paste it into your AI app. It opens a Blooby page where you approve it and choose how much it may do.'),
        ],
      },
      {
        id: 'mcp-control', surface: 'editor',
        title: 'You stay in control',
        body: 'Choose Look only, Ask me first or Full control when you connect. In Ask me first, every change waits in the MCP tab for you to approve. Disconnect an app or revoke a token at any time; every AI edit is undoable.',
      },
      {
        id: 'mcp-dashboard', surface: 'dashboard',
        title: 'AI apps, from the dashboard',
        body: 'The AI apps page in the sidebar connects apps and manages their access without opening a project.',
        tour: [step('/ai', 'AI apps', 'Connect and manage the AI apps that work on your projects.')],
      },
      {
        id: 'sidebar-avatar', surface: 'dashboard',
        title: 'You, in the sidebar',
        body: 'The sidebar now shows your profile picture and name from your sign-in, instead of just an email address.',
      },
    ],
  },
  {
    version: '2026.09.18.2',
    date: '18 September 2026',
    title: 'Grouped eyes look around, and a skipped start is flagged',
    items: [
      {
        id: 'grouped-eyes-gaze', surface: 'editor',
        title: 'Eyes in a group follow the gaze',
        body: 'Grouping the eyes no longer stops the Eyes panel from aiming them. Eyes grouped before this change are fixed by dragging them back onto the face in Layers.',
      },
      {
        id: 'sm-start-warning', surface: 'editor',
        title: 'A warning when the starting state is skipped',
        body: 'If a transition already holds when the machine starts, it leaves the ★ state before it is seen. The States panel now says so, and which input default to change.',
      },
    ],
  },
  {
    version: '2026.09.18',
    date: '18 September 2026',
    title: 'New timelines keep your mascot',
    items: [
      {
        id: 'timeline-base-mascot', surface: 'editor',
        title: 'A new timeline starts with your mascot',
        body: '+ on the timeline tabs now starts with your mascot, without the extra layers. Adding a layer to an empty timeline no longer crashes the editor.',
        tour: [step('timeline-add', 'Your mascot comes along', '+ starts a timeline with just your mascot. ⧉ on a tab still copies everything.')],
      },
    ],
  },
  {
    version: '2026.09.17',
    date: '17 September 2026',
    title: 'States of their own, characters with personality',
    items: [
      {
        id: 'timeline-layers', surface: 'editor',
        title: 'Every timeline keeps its own layers',
        body: 'Changing a limb, a shape or any value in one timeline no longer changes it in the others. A new timeline is a blank canvas; the ⧉ on a timeline tab copies one, layers and animation included.',
        tour: [
          step('timeline-tabs', 'Timelines are independent', 'Each tab is a state with its own layers and keyframes. Editing one never touches another.'),
          step('timeline-add', 'A blank canvas', '+ starts an empty timeline. To start from this one instead, use ⧉ on its tab.'),
        ],
      },
      {
        id: 'character-presets', surface: 'editor',
        title: 'Cartoon look and ten character presets',
        body: 'Cartoon inks your mascot with a thick outline and a hand-drawn boil. Plus Boing Landing, Shy Peek, Giggle, Thinking… Aha!, Love Struck, Dizzy, Sneeze, Victory Hop, Melt & Reform and Dreamy Float.',
        tour: [step('rail-left', 'Find them in Presets', 'Scroll to the character presets — each previews on your own mascot before you add it.')],
      },
      {
        id: 'new-motion', surface: 'editor',
        title: 'New modifiers and effects',
        body: 'Bounce, Breathe, Orbit and Heartbeat modifiers; Wave, Outline, Grain and Hue shift effects. Follow-through and Jelly now visibly react — to modifiers too — and Walk has real knees, feet that point the way it walks and arms that swing from the shoulder.',
        tour: [
          step('tab-fx', 'Effects tab', 'Add a modifier or an effect here. With a layer selected, only its own effects are listed.'),
          step('fx-target', 'Pick the layer', 'Choose what the new effect goes on — the body, the eyes, or any other layer.'),
        ],
      },
      {
        id: 'eye-actions', surface: 'editor',
        title: 'Blink & squish in the Eyes tab',
        body: 'Blink, double blink, slow blink, squint, close, open and eye squishes, each with a live preview before you apply it at the playhead.',
        tour: [step('tab-eyes', 'Eyes tab', 'Open it and scroll to Blink & squish. Pick an action to preview it, then Apply.')],
      },
      {
        id: 'states-order', surface: 'editor',
        title: 'States: inputs first, then the node editor',
        body: 'Add an input, then wire states in the node editor. Click a wire to change its conditions, blend and easing right under the graph.',
        tour: [step('tab-states', 'States tab', 'Inputs come first — the node editor unlocks once there is one to test.')],
      },
      {
        id: 'delete-keys', surface: 'editor',
        title: 'Delete removes selected keyframes',
        body: 'Select keyframes in the timeline and press Delete or Backspace — the layer stays.',
        tour: [step('timeline', 'In the timeline', 'Click or box-select keyframes, then press Delete.')],
      },
      {
        id: 'project-previews', surface: 'dashboard',
        title: 'Project cards show your animation',
        body: 'Every card plays three frames of its timeline instead of “no preview”.',
        tour: [step('/projects', 'Your projects', 'Each card now previews its animation.')],
      },
      {
        id: 'community', surface: 'dashboard',
        title: 'Community projects, sharing and a leaderboard',
        body: 'Public projects appear in the Library under Community → Projects, ranked by trending. Owners choose whether others can view or edit, anyone can duplicate a public project, and a leaderboard shows top creators and the most-used presets.',
        tour: [step('/library', 'Library → Community', 'Switch to Projects to browse what people have shared.')],
      },
    ],
  },
];

export const LATEST_RELEASE = RELEASES[0].version;

/**
 * The releases newer than `seen`, newest first. Someone who has never closed the panel is shown
 * the latest release only — the onboarding tour covers everything before it.
 */
export function unseenReleases(seen: string | null | undefined, releases: Release[] = RELEASES): Release[] {
  if (!seen) return releases.slice(0, 1);
  return releases.filter((r) => compareVersions(r.version, seen) > 0);
}

/** YYYY.MM.DD[.n] compared part by part as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// --- where "seen" is kept ------------------------------------------------------------------

const LOCAL = 'blooby.whatsNew.seen';
let seen: string | null = (() => { try { return localStorage.getItem(LOCAL); } catch { return null; } })();
let save: (version: string) => unknown = (v) => { try { localStorage.setItem(LOCAL, v); } catch { /* private mode */ } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Back "seen" with the signed-in user's profile: its current value, and how to store a new one. */
export function configureWhatsNew(opts: { seen: string | null; save: (version: string) => unknown }) {
  seen = opts.seen;
  save = opts.save;
  emit();
}

/** Everything up to `version` has been seen. Never moves backwards. */
export function markWhatsNewSeen(version = LATEST_RELEASE) {
  if (seen && compareVersions(version, seen) <= 0) return;
  seen = version;
  emit();
  void Promise.resolve().then(() => save(version)).catch(() => {});
}

export function useWhatsNewSeen(): string | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => seen, () => seen);
}
