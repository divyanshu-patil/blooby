import { create } from 'zustand';
import type { ToolCall } from './tools';

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
}

/** What the copilot is doing right now, so the UI can say so rather than just spin. */
export type Phase = 'idle' | 'thinking' | 'retrying' | 'applying';

interface CopilotSession {
  turns: Turn[];
  input: string;
  phase: Phase;
  status: string;
  /** the in-flight request, so Stop still works after the panel is unmounted and back */
  abort: AbortController | null;

  push: (t: Turn) => void;
  patchTurn: (i: number, patch: Partial<Turn>) => void;
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
  setInput: (input) => set({ input }),
  setPhase: (phase) => set({ phase }),
  setStatus: (status) => set({ status }),
  setAbort: (abort) => set({ abort }),
  clear: () => set({ turns: [], input: '', phase: 'idle' }),
}));
