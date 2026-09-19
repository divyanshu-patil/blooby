import { ANIMATION_CRAFT, MCP_WORKFLOW } from '@blooby/studio/engine';

/**
 * Starting workflows an MCP client offers its user (Claude shows them as slash commands).
 *
 * They hide nothing — every step is a capability the agent could call anyway. What they
 * carry is the in-house copilot's method: study a real preset first, write in beats with
 * this rig's numbers, look at the result, let `critique` review it, then fix. That method
 * is why the built-in presets look the way they do; an outside model gets the same one.
 */

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  build: (a: Record<string, string>) => string;
}

const LOOP = `Work in this loop and do not skip the looking:
1. editor_get_state { level: "standard" } and render_frame — know what is there before changing it.
2. preset_search for the closest existing animation, preset_get it, and copy its TIMING and EASING, not its content.
3. transaction_begin, then edits in small batches (batch_execute is fine), checkpoint_create before anything drastic.
4. render_sequence over the span you changed, and evaluate at the key beats — compare with what you intended.
5. critique { request } — fix every note it gives, then render again.
6. transaction_commit, project_save.`;

export const PROMPTS: PromptDef[] = [
  {
    name: 'create_animation', title: 'Create an animation',
    description: 'Build an animation from a description, the way Blooby\'s own presets are built.',
    arguments: [{ name: 'request', description: 'What should happen, e.g. "Blooby jumps in from the bottom, squashes on landing, waves, settles"', required: true }, { name: 'project', description: 'Project name or id (default: a new project)' }],
    build: (a) => `Create this animation in Blooby: "${a.request}".

${a.project ? `Open the project "${a.project}" (project_open { name }).` : 'Create a new project named after the request (project_create).'}
Read guide_get { topic: "craft" } first. Plan beats with absolute times before any call:
rest → anticipation → action → overshoot → settle → hold. Nothing starts on frame 0; everything eases.

${LOOP}

Finish by telling the person what you made, how long it is, and offer export_start { format: "lottie" }.

${ANIMATION_CRAFT.trim()}`,
  },
  {
    name: 'create_preset', title: 'Create a reusable preset',
    description: 'Make an animation that works as a preset in the library: closes on its first pose, reads on any mascot.',
    arguments: [{ name: 'description', description: 'What the preset does', required: true }, { name: 'name', description: 'Preset name' }],
    build: (a) => `Make a reusable Blooby preset: "${a.description}"${a.name ? `, named "${a.name}"` : ''}.
A preset must END on the pose it STARTS on (it loops and chains), animate relative to the rest pose, and read at a glance.
Study two similar presets with preset_search + preset_get first.
Author it with create_preset (times relative to 0), place it with add_preset_to_timeline, then check it:
render_sequence across its span, critique, fix. Save it with preset_save${a.name ? ` { name: "${a.name}", preset: "${a.name}" }` : ''}.

${LOOP}`,
  },
  {
    name: 'debug_animation', title: 'Debug an animation',
    description: 'Find out why an animation looks wrong and fix it.',
    arguments: [{ name: 'problem', description: 'What looks wrong', required: true }],
    build: (a) => `Something is wrong with the animation in the open project: "${a.problem}".
Diagnose before changing anything:
- render_sequence around where it happens; evaluate the layers involved at those times;
- timeline_get { nodeId } for the actual keyframes and easings; inspector_get for resting values;
- look for: a pose passed through rather than held, linear easing, keys on identical frames across layers,
  a track that does not close on its first value, a layer hidden by its appearance range, a clip overwriting another.
checkpoint_create "before fix", make the smallest fix, render again, and explain the cause in one sentence.`,
  },
  {
    name: 'optimize_animation', title: 'Polish an animation',
    description: 'Make an existing animation feel more alive without changing what it does.',
    arguments: [{ name: 'focus', description: 'Optional: what to improve (timing, easing, squash, overlap…)' }],
    build: (a) => `Polish the animation in the open project${a.focus ? `, focusing on ${a.focus}` : ''} — same story, better motion.
checkpoint_create "before polish". Then, guided by guide_get { topic: "craft" }: add anticipation before big moves,
overshoot and settle after them, offset secondary parts (eyes, hands) 40–120ms behind the body, squash on contacts,
hold key poses long enough to read. critique { request } must come back clean. checkpoint_diff "before polish"
to summarise what changed.`,
  },
  {
    name: 'inspect_project', title: 'Inspect a project',
    description: 'Understand a project: its layers, states, clips and animation.',
    arguments: [{ name: 'project', description: 'Project name or id' }],
    build: (a) => `${a.project ? `Open "${a.project}" (project_open { name }). ` : ''}Describe the project to the person:
editor_get_state { level: "full" }, render_frame at the start and render_sequence across the timeline, timeline_get.
Report: canvas, mascots and layers, the states (timelines) and how the state machine moves between them,
what each clip does and when. Do not change anything.`,
  },
  {
    name: 'explain_current_animation', title: 'Explain the current animation',
    description: 'A plain-language walkthrough of what the animation does, beat by beat.',
    arguments: [],
    build: () => `Explain the animation in the open project beat by beat, for someone who is not an animator.
Use timeline_get and render_sequence (8–12 frames) to see it. For each beat: when, what moves, and why it reads
the way it does (anticipation, overshoot, squash, holds). Suggest at most three improvements. Change nothing.`,
  },
  {
    name: 'prepare_for_export', title: 'Prepare for export',
    description: 'Check an animation is ready to ship as Lottie / dotLottie, then export it.',
    arguments: [{ name: 'format', description: 'lottie, dotlottie or runtime (React Native pack)' }],
    build: (a) => `Prepare the open project for export as ${a.format ?? 'lottie'}.
Check: every loop closes on its first frame (evaluate first and last frame), states and the state machine make sense
(editor_get_state { level: "full" }), nothing important relies on effects Lottie cannot carry (export warnings list them).
project_save, then export_start { format: "${a.format ?? 'lottie'}" } and give the person the download link.`,
  },
  {
    name: 'blooby_workflow', title: 'How to work in Blooby',
    description: 'The working method for any Blooby task.',
    arguments: [],
    build: () => MCP_WORKFLOW,
  },
];
