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
    version: '2026.10.26',
    date: '26 October 2026',
    title: 'AI edits land the moment they are made',
    items: [
      {
        id: 'mcp-save-per-edit', surface: 'editor',
        title: 'Claude and ChatGPT edits show up straight away',
        body: 'When an AI app is working on your project, each change it makes is saved as it makes it, so it appears in your editor without the old few-second pause — and nothing it did is lost if the connection drops halfway through. If you edit at the same moment, it is told to take your version or keep its own instead of quietly overwriting yours.',
      },
    ],
  },
  {
    version: '2026.09.29',
    date: '29 September 2026',
    title: 'A fresh new look, and a much faster editor',
    items: [
      {
        id: 'm3-expressive', surface: 'editor',
        title: 'blooby has a new look',
        body: 'The whole app now wears Material 3 Expressive in warm blooby apricot: softer surfaces, rounder controls, a big button for the one thing to do next (Create, Done, Export), and buttons that squish a little when you press them. Play turns into a square while it plays, keyframes pop in, menus and panels spring open — and all of it holds still if your system asks for reduced motion.',
        tour: [step('stage', 'The stage', 'The tools now float at the bottom of the canvas, and the backdrop swatches sit in the top corner — out of your mascot’s way.')],
      },
      {
        id: 'panels-in-order', surface: 'editor',
        title: 'Everything where you would look for it',
        body: 'The right-hand tabs are Design, Effects, Eyes, States and AI, in the order most people reach for them — the copilot and connecting Claude or ChatGPT now share the AI tab. In Design, Transform and Fill come first, then what the layer is made of, then Stroke and Effects; settings you rarely need live under More options. Open, download, the gallery and Start over moved into the ⋯ menu at the top.',
        tour: [
          step('tab-node', 'Design first', 'Select anything and its position, size and colour are right at the top.'),
          step('tab-ai', 'AI in one place', 'Ask the copilot, or switch to Connect AI apps.'),
          step('more-menu', 'Your project file', 'Open, download, the gallery and Start over — plus privacy and terms.'),
        ],
      },
      {
        id: 'tooltips-and-start', surface: 'editor',
        title: 'Hover anything to see what it does',
        body: 'Every button and control now explains itself in a proper tooltip, with its shortcut. With nothing selected, the Design tab offers three ways to begin: select the mascot, add a preset, or ask the copilot.',
        tour: [step('rail-right', 'Start here', 'Nothing selected? Pick one of the three starting points.')],
      },
      {
        id: 'faster-big-scenes', surface: 'editor',
        title: 'Big scenes play smoothly',
        body: 'Projects with hundreds of layers and keyframes used to stutter. Each frame now does a fraction of the work it did, and the panels no longer redraw on every frame of playback, so the stage keeps its full frame rate.',
      },
      {
        id: 'legal-pages', surface: 'dashboard',
        title: 'Privacy policy and terms of use',
        body: 'What we collect, where it is stored, who handles it and what you can ask us to do with it — in plain words. Find Privacy and Terms under the sidebar, on the sign-in page and in the editor’s ⋯ menu.',
      },
    ],
  },
  {
    version: '2026.09.27.2',
    date: '27 September 2026',
    title: 'Copy and paste mascots, keyframed pins',
    items: [
      {
        id: 'copy-paste-layers', surface: 'editor',
        title: 'Copy a mascot or a layer into another project',
        body: 'Select a mascot, a part or any layer and press ⌘C (Ctrl+C), then ⌘V (Ctrl+V) — in this state, another state, or another project open in any tab. It arrives as a new mascot or a new layer with its keyframes, effects and, for a mascot, its own lane of clips. A part like a hat lands on the mascot you have selected.',
        tour: [step('layer-duplicate', 'Copy, then paste anywhere', '⌘C copies what is selected — ⌘V pastes it here or in another project.')],
      },
      {
        id: 'pin-keyframes', surface: 'editor',
        title: 'Pin and unpin a limb over time',
        body: 'A pinned hand or foot now has a Held slider you can keyframe: 1 plants it, 0 lets it follow the body, and in between it eases from one to the other — no snap. Select a limb, open Points in the inspector, and click the diamond beside Held. Once it has keys, the pin buttons on the stage ease the pin on or off over a fifth of a second from the playhead instead of removing it.',
      },
    ],
  },
  {
    version: '2026.09.27',
    date: '27 September 2026',
    title: 'The Sailors mascot',
    items: [
      {
        id: 'sailors-presets', surface: 'editor',
        title: 'Eighteen new states for a round little mascot',
        body: 'Head scratch, waiting for mail, covering its eyes, a happy idle, a sad slump, a peek over a card, a “Hii!” wave, a victory bounce, hugging an empty bookmark, pointing the way back, reading a script, a sleepy wait — four streak scenes (a cracked heart with a crowd of friends, a spent restore, an expired streak, an alarm clock ringing down the last minutes), a march with a flame held high, and a full 😭 wail with tears flying. Every one is a seamless loop, with squash that keeps its volume, hands and feet that trail the body, and legs that bend like rubber instead of at a knee. Drop one onto your own mascot from Presets.',
        tour: [step('rail-left', 'Find them in Presets', 'Scroll to the Sailors presets, after the character ones — each previews on your own mascot before you add it.')],
      },
      {
        id: 'appearance-reset', surface: 'editor',
        title: 'Resetting a layer’s range keeps the layer',
        body: 'Reset under Appearance used to take a layer that lives only in its ranges off the screen entirely — it looked deleted. Now Reset puts it back for the whole clip. And a range that runs to the clip’s start or end stays that way when the timeline gets longer, instead of stopping at the old length.',
      },
    ],
  },
  {
    version: '2026.09.21',
    date: '21 September 2026',
    title: 'The cloud got quick',
    items: [
      {
        id: 'faster-everything', surface: 'dashboard',
        title: 'Saving, opening and loading are much faster',
        body: 'Every request used to look your account up in the database first, and every project travelled through our server twice on its way to you. Now it does neither: your projects come straight from storage, compressed, and the server is out of the way. Dashboards fill in at once and saves land in a fraction of the time.',
      },
      {
        id: 'new-icon', surface: 'dashboard',
        title: 'Blooby has its icon',
        body: 'The real icon — the one with the gradient and the sheen, not a flat stand-in — is in the browser tab now, in the sidebar, on your home screen if you add it there, and on every link you share. The tab icon follows your system theme: dark on a light tab strip, light on a dark one.',
      },
      {
        id: 'share-cards', surface: 'dashboard',
        title: 'A shared project shows the mascot',
        body: 'Paste a link to one of your public projects into Slack, Discord, X or anywhere else and the preview is the mascot itself, with the project’s name — rendered by the same engine as the editor, so it can never be out of date. Private projects show the plain blooby card and nothing about them at all.',
      },
      {
        id: 'admin-traffic-mcp', surface: 'dashboard',
        title: 'For admins: Traffic and MCP',
        body: 'Two new tabs in the admin panel. Traffic shows which pages people open, where they arrived from and where they go next — cookieless, so a “visitor” is a hash that rotates daily and can never follow anyone across days. MCP shows who has connected an AI app, which apps, what they call and why calls fail.',
      },
      {
        id: 'mcp-project-link', surface: 'editor',
        title: 'Your AI app can send you straight to the project',
        body: 'Ask Claude or ChatGPT to make you something and it now hands back a link that opens it right here — which is where GIF and MP4 are made, since those render on your own machine.',
      },
      {
        id: 'faster-saves', surface: 'editor',
        title: 'Saves are a sixth of the size',
        body: 'The editor compresses your project before sending it, so autosave over a slow connection finishes in about a seventh of the time it took. Nothing changes about what is saved — only how much of it goes up the wire.',
      },
    ],
  },
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
        id: 'mcp-stays-open', surface: 'editor',
        title: 'The project you open stays open',
        body: 'An AI app now keeps working in the project you opened, even if its connection drops between messages — and it can look up what Blooby can do before opening anything.',
      },
      {
        id: 'mcp-dashboard', surface: 'dashboard',
        title: 'AI apps, from the dashboard',
        body: 'The AI apps page in the sidebar connects apps and manages their access without opening a project.',
        tour: [step('/ai', 'AI apps', 'Connect and manage the AI apps that work on your projects.')],
      },
      {
        id: 'smaller-lottie', surface: 'editor',
        title: 'Exports are a fraction of the size',
        body: 'A .lottie now comes out around ten times smaller — a three-state mascot that was 3MB is about 300KB, and a simple one lands under 5KB. Nothing about the animation changed: same states, same state machine, same motion. Every file also carries a “Made with Blooby” credit.',
        tour: [step('export', 'Export', 'Lottie, .lottie and the React Native pack — all much lighter than they were.')],
      },
      {
        id: 'blob-body', surface: 'editor',
        title: 'Give your mascot a less perfect body',
        body: 'A new Shape section on the body has two dials. Blobbiness turns the body from a perfect circle into something that looks drawn. Variation picks which irregular shape it is. Both keyframe like any other property: animate Blobbiness and the body swells between round and blobby, or hold it and animate Variation and the body morphs from one shape into another. Shuffle jumps somewhere else on the dial. It all exports to Lottie, and left at 0 the body is exactly the circle it always was.',
        tour: [step('tab-node', 'Shape', 'Select the body, then open Shape to find Blobbiness and Shuffle.')],
      },
      {
        id: 'lighter-saves', surface: 'editor',
        title: 'Saving to the cloud is much faster',
        body: 'Every project was carrying its own copy of the whole built-in preset library — about 1.2MB of a 1.3MB project, uploaded on every autosave and downloaded every time you opened it. Projects now reference the built-in presets instead of copying them, which makes a typical project around six times smaller and saves noticeably quicker. Presets you have made or changed are still stored in full, exactly as they are.',
      },
      {
        id: 'export-layer-order', surface: 'editor',
        title: 'Exports keep your layer order',
        body: 'A layer that was off screen in the middle of an export came out on top of everything — most visibly a hand you had sent behind the mascot appearing in front of it. Exports now follow the layer order you set, whatever is on screen at the time.',
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
