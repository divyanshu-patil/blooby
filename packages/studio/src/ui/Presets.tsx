import { useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { COMP } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { MascotThumb } from './Mascot';
import { Panel } from './bits';
import { EASING_NAMES, namedEasing } from '../core/easing';
import { characteristicTime } from '../core/timeline';
import { activeTimeline } from '../core/types';
import { hasBackend } from '../core/catalog';
import { PublishDialog } from '../cloud/PublishDialog';
import { assetsApi } from '../cloud/api';
import { PresetPreview } from './PresetPreview';
import type { Expression, Preset, Project } from '../core/types';

/** A preset's own pose at its most characteristic moment — the icon *is* the animation. */
function glyphScene(project: Project, preset: Preset) {
  const tl = activeTimeline(project);
  const temp: Project = { ...project, timelines: [{ ...tl, tracks: preset.tracks, modifiers: [], blocks: [] }], activeTimelineId: tl.id };
  return sceneAt(temp, characteristicTime(preset), COMP);
}

/** The four places a preset can come from, plus "everything". Official and community
 *  only appear once a backend is configured — with none, they would always be empty. */
type Filter = 'all' | 'builtin' | 'custom' | 'official' | 'community';

const FILTER_LABEL: Record<Filter, string> = {
  all: 'all', builtin: 'built-in', custom: 'custom', official: 'official', community: 'community',
};
const FILTER_HINT: Record<Filter, string> = {
  all: 'Everything available to this project',
  builtin: 'Shipped with blooby',
  custom: 'Saved in this project',
  official: 'Curated and published by the blooby team',
  community: 'Published by other people',
};

type Sort = 'default' | 'newest' | 'popular';

const SORT_LABEL: Record<Sort, string> = { default: 'library order', newest: 'newest', popular: 'popular' };

export function Presets() {
  const project = useEditor((s) => s.project);
  const addBlock = useEditor((s) => s.addBlock);
  const renamePreset = useEditor((s) => s.renamePreset);
  const setPresetColor = useEditor((s) => s.setPresetColor);
  const catalog = useEditor((s) => s.catalog);
  const catalogError = useEditor((s) => s.catalogError);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('default');
  const [preview, setPreview] = useState<Preset | null>(null);
  const [publishing, setPublishing] = useState<Preset | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  // the shared library and this file's own presets browse as one list; a catalogue entry
  // already pulled into the project (addBlock copies it in) must not show up twice
  const all = useMemo(() => {
    const own = new Set(project.presets.map((p) => p.id));
    return [...project.presets, ...catalog.filter((p) => !own.has(p.id))];
  }, [project.presets, catalog]);
  const filtered = all.filter((p) => filter === 'all' || p.source === filter);

  // Only library presets carry a publish date or a usage count; a builtin has neither, so
  // it sorts last rather than pretending to be brand new or unused.
  const list = useMemo(() => {
    if (sort === 'default') return filtered;
    const rank = (p: Preset) => (sort === 'popular' ? (p.uses ?? -1) : Date.parse(p.publishedAt ?? '') || -1);
    return [...filtered].sort((a, b) => rank(b) - rank(a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);

  /**
   * Adding is the moment worth counting — a browse is curiosity, an add is the preset
   * actually being used. Fire-and-forget: the count is a metric, and failing to record
   * one must never stop the preset landing on the timeline.
   */
  const add = (preset: Preset) => {
    addBlock(preset.id);
    if (preset.source === 'official' || preset.source === 'community') void assetsApi.markUsed(preset.id);
  };
  // hide the shared-library tabs entirely when there is no library to browse, rather
  // than offering two filters that can only ever come back empty
  const FILTERS = hasBackend
    ? (['all', 'builtin', 'custom', 'official', 'community'] as const)
    : (['all', 'builtin', 'custom'] as const);

  return (
    <Panel title="Presets">
      {/* Five filters plus a sort will not fit beside the title in a narrow rail, and
          wrapping them inside the segmented control's own border reads as a broken box
          rather than two rows of tabs. Their own full-width row scrolls sideways
          instead, staying one clean line at any rail width. */}
      <div className="filter-row">
        <div className="seg">
          {FILTERS.map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}
              title={FILTER_HINT[f]}>{FILTER_LABEL[f]}</button>
          ))}
        </div>
        <select className="sel" value={sort} onChange={(e) => setSort(e.target.value as Sort)}
          title="Order presets by">
          {(['default', 'newest', 'popular'] as const).map((o) => (
            <option key={o} value={o}>{SORT_LABEL[o]}</option>
          ))}
        </select>
      </div>
      {catalogError && <p className="warn">Preset library unavailable — {catalogError}</p>}
      {published && <p className="hint">“{published}” submitted for review.</p>}
      {preview && (
        <PresetPreview project={project} preset={preview}
          onAdd={() => { add(preview); setPreview(null); }}
          onClose={() => setPreview(null)} />
      )}
      {publishing && (
        <PublishDialog item={{ kind: 'preset', value: publishing }}
          onClose={() => setPublishing(null)}
          onDone={(n) => { setPublishing(null); setPublished(n); }} />
      )}
      <div className="chips">
        {list.map((preset) => (
          // a plain <button> can't nest the color swatch's own <input type="color"> without
          // invalid/broken interactive-inside-interactive markup, so this one's a div
          // acting as a button — role/tabIndex/onKeyDown restore what <button> gave for free.
          <div key={preset.id} className="chip" draggable role="button" tabIndex={0}
            title={`Preview ${preset.name} · ${(preset.durationMs / 1000).toFixed(1)}s — drag straight onto the strip to skip the preview, double-click to rename`}
            onDragStart={(e) => { e.dataTransfer.setData('text/blooby-preset', preset.id); e.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => setPreview(preset)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreview(preset); } }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const name = prompt('Rename preset', preset.name);
              if (name?.trim()) renamePreset(preset.id, name);
            }}>
            <input type="color" className="chip-color" title="Accent color — shows on this preset's clips"
              value={preset.color ?? '#8c8577'} onClick={(e) => e.stopPropagation()}
              onChange={(e) => setPresetColor(preset.id, e.target.value)} />
            <MascotThumb className="glyph" scene={glyphScene(project, preset)} view={COMP} />
            {preset.name}
            {/* only your own work can be submitted — a builtin or something already in
                the shared library has nowhere to go */}
            {hasBackend && preset.source === 'custom' && (
              <button className="chip-pub" title={`Publish "${preset.name}" to the community`}
                onClick={(e) => { e.stopPropagation(); setPublishing(preset); }}>Publish</button>
            )}
          </div>
        ))}
      </div>
      {!list.length && (
        <p className="empty-note">
          {filter === 'custom' ? 'Save a selection of tracks from the timeline to make one.'
            : filter === 'community' ? 'Nothing published by the community yet.'
            : filter === 'official' ? 'No official presets published yet.'
            : 'Save a selection of tracks from the timeline to make one.'}
        </p>
      )}
    </Panel>
  );
}

/**
 * "Another timeline from the current project" as a clip source (spec §8 step 1) — every
 * other timeline in this same project, one click appends its full content as a new clip
 * on the timeline being edited. Same rig, so nothing here needs the gallery's node-id
 * compatibility filter (addClipFrom applies it anyway; it's just always a no-op here).
 */
export function OtherTimelines() {
  const project = useEditor((s) => s.project);
  const addClipFrom = useEditor((s) => s.addClipFrom);
  const others = project.timelines.filter((t) => t.id !== project.activeTimelineId);
  if (!others.length) return null;

  return (
    <Panel title="Other timelines">
      <div className="chips">
        {others.map((t) => (
          <button key={t.id} className="chip" title={`Add all of "${t.name}" as one clip · ${(t.timelineDurationMs / 1000).toFixed(1)}s`}
            onClick={() => addClipFrom({ label: t.name, timeline: t })}>
            <MascotThumb className="glyph" scene={sceneAt({ ...project, activeTimelineId: t.id }, t.timelineDurationMs * 0.45, COMP)} view={COMP} />
            {t.name}
          </button>
        ))}
      </div>
    </Panel>
  );
}

export function Expressions() {
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.playhead);
  const capture = useEditor((s) => s.captureExpression);
  const renameExpression = useEditor((s) => s.renameExpression);
  const apply = useEditor((s) => s.applyExpression);
  const morph = useEditor((s) => s.morphBetween);
  const [name, setName] = useState('');
  const [publishingPose, setPublishingPose] = useState<Expression | null>(null);
  const [publishedPose, setPublishedPose] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dur, setDur] = useState(320);
  const [easing, setEasing] = useState('easeInOut');

  const expressionCatalog = useEditor((s) => s.expressionCatalog);
  const commit = useEditor((s) => s.commit);

  // Shared-library poses browse alongside your own. Applying one copies it into the
  // project first, so the file keeps working offline and morph can address it by id.
  const shared = useMemo(() => {
    const own = new Set(project.expressions.map((e) => e.id));
    return expressionCatalog.filter((e) => !own.has(e.id));
  }, [project.expressions, expressionCatalog]);

  const adoptShared = (x: Expression) => {
    commit((p) => { if (!p.expressions.some((e) => e.id === x.id)) p.expressions = [...p.expressions, x]; }, 'add pose from library');
    apply(x.id, playhead);
  };

  const ids = useMemo(() => project.expressions.map((e) => e.id), [project.expressions]);
  const a = from || ids[0] || '';
  const b = to || ids[1] || ids[0] || '';

  return (
    <Panel title="Expressions">
      {publishedPose && <p className="hint">“{publishedPose}” submitted for review.</p>}
      {publishingPose && (
        <PublishDialog item={{ kind: 'expression', value: publishingPose }}
          onClose={() => setPublishingPose(null)}
          onDone={(n) => { setPublishingPose(null); setPublishedPose(n); }} />
      )}
      <div className="row">
        <input className="txt" placeholder="Capture current pose as…" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { capture(name.trim()); setName(''); } }} />
        <button className="btn sm" disabled={!name.trim()} onClick={() => { capture(name.trim()); setName(''); }}>Capture</button>
      </div>
      {project.expressions.length > 0 && (
        <>
          <span className="panel-title">Captured poses</span>
          <div className="chips">
            {project.expressions.map((x) => (
              <button key={x.id} className="chip" title={`Apply "${x.name}" at ${(playhead / 1000).toFixed(2)}s — double-click to rename`}
                onClick={() => apply(x.id, playhead)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const next = prompt('Rename captured pose', x.name);
                  if (next?.trim()) renameExpression(x.id, next);
                }}>
                <span className="glyph" style={{ display: 'grid', placeItems: 'center', font: '600 9px var(--mono)', color: 'var(--paper)' }}>
                  {Object.keys(x.snapshot).length}
                </span>
                {x.name}
                {hasBackend && (
                  <span className="chip-pub" role="button" tabIndex={0} title={`Publish "${x.name}" to the community`}
                    onClick={(e) => { e.stopPropagation(); setPublishingPose(x); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setPublishingPose(x); } }}>Publish</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {shared.length > 0 && (
        <>
          <span className="panel-title">From the library</span>
          <div className="chips">
            {shared.map((x) => (
              <button key={x.id} className="chip" title={`Add "${x.name}" and apply it at ${(playhead / 1000).toFixed(2)}s`}
                onClick={() => adoptShared(x)}>
                <span className="glyph" style={{ display: 'grid', placeItems: 'center', font: '600 9px var(--mono)', color: 'var(--paper)' }}>
                  {Object.keys(x.snapshot ?? {}).length}
                </span>
                {x.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="divider" />
      <span className="panel-title">Morph</span>
      <div className="row">
        <select className="sel" style={{ flex: 1 }} value={a} onChange={(e) => setFrom(e.target.value)}>
          {project.expressions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <span className="hint">→</span>
        <select className="sel" style={{ flex: 1 }} value={b} onChange={(e) => setTo(e.target.value)}>
          {project.expressions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <div className="row">
        <select className="sel" value={easing} onChange={(e) => setEasing(e.target.value)}>
          {EASING_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input className="txt" style={{ width: 66 }} type="number" min={40} step={20} value={dur}
          onChange={(e) => setDur(Math.max(40, +e.target.value))} />
        <span className="hint">ms</span>
        <span className="spacer" />
        <button className="btn sm primary" disabled={!a || !b || a === b}
          onClick={() => morph(a, b, playhead, dur, namedEasing(easing))}>Morph here</button>
      </div>
    </Panel>
  );
}
