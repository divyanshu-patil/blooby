import { useState } from 'react';
import { useEditor } from '../core/store';
import { Panel } from './bits';
import { CurveEditor } from './CurveEditor';
import { easingLabel } from '../core/easing';
import type { EasingCurve } from '../core/types';

/**
 * Manual test surface for the state machine (spec §14): view states, trigger one
 * immediately or with a blend, schedule one for later in the current playback, return to
 * whatever was active before, and see the exact API call each action corresponds to — the
 * same functions available externally as window.blooby.*, never editor-internal-only.
 */
export function StateMachine() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const previousTimelineId = useEditor((s) => s.previousTimelineId);
  const pendingStateChange = useEditor((s) => s.pendingStateChange);
  const setState = useEditor((s) => s.setState);
  const cancelScheduledState = useEditor((s) => s.cancelScheduledState);
  const returnToPreviousState = useEditor((s) => s.returnToPreviousState);

  const [duration, setDuration] = useState(300); // matches the store's own default
  const [easing, setEasing] = useState<EasingCurve>({ type: 'preset', name: 'easeInOut' });
  const [curveOpen, setCurveOpen] = useState(false);
  const [atSec, setAtSec] = useState('');

  const active = project.timelines.find((t) => t.id === project.activeTimelineId);
  const previous = project.timelines.find((t) => t.id === previousTimelineId);
  const pendingTarget = project.timelines.find((t) => t.id === pendingStateChange?.timelineId);

  const trigger = (id: string, scheduled: boolean) => {
    const opts = { duration, easing, ...(scheduled && atSec.trim() ? { at: Math.max(0, parseFloat(atSec)) * 1000 } : {}) };
    setState(id, opts);
  };

  return (
    <Panel title="State machine">
      <p className="hint">
        Each timeline is one state, same as the exported .lottie's state machine. Trigger one here
        to test transitions before wiring <code>window.blooby.setState(...)</code> to real app events.
      </p>

      <div className="flex flex-col gap-1.5">
        {project.timelines.map((t) => {
          const isActive = t.id === project.activeTimelineId;
          return (
            <div key={t.id}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] ${isActive ? 'border-signal bg-signal-soft' : 'border-line-soft bg-field'}`}>
              <span className={`h-1.5 w-1.5 flex-none rounded-full ${isActive ? 'bg-signal' : 'bg-line'}`} />
              <span className="flex-1 font-medium text-ink-2">{t.name}</span>
              {isActive ? (
                <span className="text-[10px] font-medium uppercase tracking-wide text-signal">active</span>
              ) : (
                <>
                  <button className="btn ghost sm" title={`setState("${t.name}")`} onClick={() => trigger(t.id, false)}>Set</button>
                  <button className="btn ghost sm" title={`enableState("${t.name}", { at, duration, easing })`} onClick={() => trigger(t.id, true)}>Schedule</button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="divider" />
      <span className="panel-title">Transition</span>
      <div className="flex items-center gap-2">
        <span className="prop-label" style={{ width: 62 }}>Duration</span>
        <input type="number" min={0} step={20} className="prop-num" style={{ width: 64 }}
          value={duration} onChange={(e) => setDuration(Math.max(0, Math.round(+e.target.value)))} />
        <span className="hint">ms · 0 = instant</span>
      </div>
      <div className="relative flex items-center gap-2">
        <span className="prop-label" style={{ width: 62 }}>Easing</span>
        <button className="btn sm" onClick={() => setCurveOpen((v) => !v)}>{easingLabel(easing)} ⌃</button>
        {curveOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 62, marginTop: 6, zIndex: 20 }}>
            <CurveEditor value={easing} onChange={setEasing} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="prop-label" style={{ width: 62 }}>At</span>
        <input className="prop-num" style={{ width: 64 }} placeholder={(playhead / 1000).toFixed(1)}
          value={atSec} onChange={(e) => setAtSec(e.target.value)} />
        <span className="hint">s into playback · used by "Schedule"</span>
      </div>

      {pendingStateChange && pendingTarget && (
        <div className="flex items-center gap-2 rounded-md border border-hot/40 bg-hot/10 px-2.5 py-1.5 text-[11px] text-ink-2">
          <span className="flex-1">Scheduled → <strong>{pendingTarget.name}</strong> at {(pendingStateChange.atMs / 1000).toFixed(2)}s</span>
          <button className="text-hot underline decoration-dotted underline-offset-2" onClick={cancelScheduledState}>Cancel</button>
        </div>
      )}

      <div className="divider" />
      <div className="row">
        <button className="btn sm" disabled={!previous} title={previous ? `returnToPreviousState() → ${previous.name}` : 'No previous state yet'}
          onClick={() => returnToPreviousState({ duration, easing })}>
          ↩ Return to previous{previous ? ` (${previous.name})` : ''}
        </button>
      </div>
      <p className="hint">
        Current: <strong>{active?.name}</strong>{previous && <> · was <strong>{previous.name}</strong></>}
      </p>
    </Panel>
  );
}
