import { create } from 'zustand';
import type { ToolCall } from './tools';
import type { Project } from '../core/types';
import type { AgentEvent } from './agent';

/**
 * One agent run as a checkpoint: the document before it, every action it took, and the
 * document it left. Reverting restores `before` and reapplying restores `after` — the
 * recorded result, never a regeneration. Both are whole-document snapshots, which the store
 * makes anyway on every commit (a project object is never mutated after it is committed).
 */
export interface AgentRun {
  status: 'running' | 'done' | 'stopped' | 'failed' | 'steps';
  actions: AgentEvent[];
  usage: { input: number; output: number };
  steps: number;
  startedAt: number;
  endedAt?: number;
  before: Project;
  after?: Project;
  /** false after Revert, true again after Reapply */
  applied: boolean;
}

export interface Turn {
  /** `note` is the copilot reporting on itself (stopped, skipped) — not a failure, and
   *  not part of the conversation the model is shown. */
  role: 'user' | 'bot' | 'error' | 'note';
  text: string;
  calls?: ToolCall[];
  done?: boolean;
  /** the user said no. Kept rather than cleared, so the model is told not to re-propose it. */
  rejected?: boolean;
  /** what the model was reasoning about, when it says so — shown collapsed */
  thinking?: string;
  /** an agent run, with its checkpoint */
  run?: AgentRun;
}

/** What the copilot is doing right now, so the UI can say so rather than just spin. */
export type Phase = 'idle' | 'thinking' | 'retrying' | 'revising' | 'applying';

interface CopilotSession {
  turns: Turn[];
  input: string;
  phase: Phase;
  status: string;
  /** the in-flight request, so Stop still works after the panel is unmounted and back */
  abort: AbortController | null;

  push: (t: Turn) => void;
  patchTurn: (i: number, patch: Partial<Turn>) => void;
  patchRun: (i: number, patch: Partial<AgentRun>) => void;
  logAction: (i: number, e: AgentEvent) => void;
  setInput: (v: string) => void;
  setPhase: (p: Phase) => void;
  setStatus: (s: string) => void;
  setAbort: (a: AbortController | null) => void;
  clear: () => void;
}

/**
 * The conversation lives in a store, not in the component.
 *
 * The copilot is one tab in the right rail, so switching to Node or Effects unmounts it —
 * and with the thread in local state that silently destroyed the conversation and any
 * pending changes the model had prepared. Losing work by looking at another panel is not
 * a trade-off, it is a bug. Keeping it here also means an in-flight request survives the
 * switch instead of resolving into a dead component.
 */
export const useCopilotSession = create<CopilotSession>((set) => ({
  turns: [],
  input: '',
  phase: 'idle',
  status: '',
  abort: null,

  push: (t) => set((s) => ({ turns: [...s.turns, t] })),
  patchTurn: (i, patch) => set((s) => ({ turns: s.turns.map((x, n) => (n === i ? { ...x, ...patch } : x)) })),
  patchRun: (i, patch) => set((s) => ({ turns: s.turns.map((x, n) => (n === i && x.run ? { ...x, run: { ...x.run, ...patch } } : x)) })),
  logAction: (i, e) => set((s) => ({ turns: s.turns.map((x, n) => (n === i && x.run ? { ...x, run: { ...x.run, actions: [...x.run.actions, e] } } : x)) })),
  setInput: (input) => set({ input }),
  setPhase: (phase) => set({ phase }),
  setStatus: (status) => set({ status }),
  setAbort: (abort) => set({ abort }),
  clear: () => set({ turns: [], input: '', phase: 'idle' }),
}));
