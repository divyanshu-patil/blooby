/**
 * The node-safe surface of the Studio: the capability registry, the headless editor
 * session, frame rendering to SVG and the exporters — everything a server (the MCP server
 * in apps/api) needs, and nothing that touches the DOM or imports CSS.
 *
 * `./index.ts` stays the browser package; this is `@blooby/studio/engine`.
 */
export * from './engine/registry';
export * from './engine/diff';
export { EditorSession, CapabilityError, MCP_WORKFLOW, GUIDE_TOPICS, guide, type OpResult, type OpLog, type Checkpoint, type SessionEvent } from './engine/session';
export { frameSvg, contactSheetSvg, sceneToSvg, type FrameWindow } from './export/frame';
export { bakeLottie, type BakeResult } from './export/lottie';
export { buildDotLottie } from './export/dotlottie';
export { buildRuntimePack } from './export/runtime';
export { allPresets, searchPresets, presetData, presetTags } from './copilot/agent';
export { ANIMATION_CRAFT } from './copilot/craft';
export { TOOL_DOCS } from './copilot/tools';
export { catalogFromRows } from './core/catalog';
export { compOf } from './core/comp';
export { migrateProject, SCHEMA_VERSION } from './core/migrate';
export { packProject, unpackPresets } from './core/presetRefs';
export { defaultProject, builtinPresets } from './core/defaults';
export { activeTimeline, type Project, type Preset, type Expression } from './core/types';
/** core/types.ts as text — the whole data model with the reasoning in its comments */
export { default as PROJECT_TYPES_SOURCE } from './core/types.ts?raw';
