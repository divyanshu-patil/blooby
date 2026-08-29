import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../core/store';
import { COMP, presetPreviewProject } from '../core/defaults';
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
  const temp = presetPreviewProject(project, preset);
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

/** Six chips — the .chips grid is two columns, so three complete rows. */
const PEEK = 6;

const SORT_LABEL: Record<Sort, string> = { default: 'library order', newest: 'newest', popular: 'popular' };

export function Presets() {
  const project = useEditor((s) => s.project);
  const addBlock = useEditor((s) => s.addBlock);
  const renamePreset = useEditor((s) => s.renamePreset);
  const deletePreset = useEditor((s) => s.deletePreset);
  const selectBlock = useEditor((s) => s.selectBlock);
  const setPresetColor = useEditor((s) => s.setPresetColor);
  const catalog = useEditor((s) => s.catalog);
  const catalogError = useEditor((s) => s.catalogError);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('default');
  const [preview, setPreview] = useState<Preset | null>(null);
  const [publishing, setPublishing] = useState<Preset | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
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
  // three full rows of two, plus one more row that gets cut in half by the fade
  const peeking = list.length > PEEK;
  const shown = peeking ? list.slice(0, PEEK + 2) : list;

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
          onRename={(name) => renamePreset(preview.id, name)}
          // editing a preset means editing it where you can see it: place it, select it —
          // which is what puts the clip panel and its "Save to preset" in front of you —
          // change the keyframes there, and save it back
          onEdit={() => {
            add(preview);
            const placed = activeTimeline(useEditor.getState().project).blocks.at(-1);
            if (placed) selectBlock(placed.id);
            setPreview(null);
          }}
          // built-ins and library presets are not yours to delete — they come back on
          // the next load anyway, from the bundle or the catalogue
          onDelete={preview.source === 'custom'
            ? () => { deletePreset(preview.id); setPreview(null); }
            : undefined}
          onClose={() => setPreview(null)} />
      )}
      {publishing && (
        <PublishDialog item={{ kind: 'preset', value: publishing }}
          onClose={() => setPublishing(null)}
          onDone={(n) => { setPublishing(null); setPublished(n); }} />
      )}
      {/* Three rows, then a fourth cut off mid-chip and faded — enough to browse from
          without the rail's other panels being pushed off the bottom, and obviously
          truncated rather than looking like the whole library. */}
      <div className={peeking ? 'chips-peek' : undefined}>
        <div className="chips">
          {shown.map((preset) => (
            <PresetChip key={preset.id} project={project} preset={preset}
              onOpen={() => setPreview(preset)}
              onRename={(name) => renamePreset(preset.id, name)}
              onColor={(c) => setPresetColor(preset.id, c)}
              onPublish={hasBackend && preset.source === 'custom' ? () => setPublishing(preset) : undefined} />
          ))}
        </div>
      </div>
      {list.length > PEEK && (
        <button className="btn sm chips-more" onClick={() => setBrowsing(true)}>
          Show all {list.length}
        </button>
      )}
      {browsing && (
        <PresetDrawer project={project} presets={list} title={`${FILTER_LABEL[filter]} presets`}
          onOpen={(preset) => { setBrowsing(false); setPreview(preset); }}
          onRename={renamePreset} onColor={setPresetColor}
          onPublish={hasBackend ? (preset) => { setBrowsing(false); setPublishing(preset); } : undefined}
          onClose={() => setBrowsing(false)} />
      )}
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
 * One preset in the library, in the rail or in the drawer.
 *
 * A plain <button> cannot nest the colour swatch's own <input type="color"> without
 * invalid interactive-inside-interactive markup, so this is a div acting as one —
 * role/tabIndex/onKeyDown restore what <button> gave for free.
 */
function PresetChip({ project, preset, onOpen, onRename, onColor, onPublish }: {
  project: Project;
  preset: Preset;
  onOpen: () => void;
  onRename: (name: string) => void;
  onColor: (color: string) => void;
  /** absent for anything that is not yours to publish — a builtin has nowhere to go */
  onPublish?: () => void;
}) {
  return (
    <div className="chip" draggable role="button" tabIndex={0}
      title={`Preview ${preset.name} · ${(preset.durationMs / 1000).toFixed(1)}s — drag straight onto the strip to skip the preview, double-click to rename`}
      onDragStart={(e) => { e.dataTransfer.setData('text/blooby-preset', preset.id); e.dataTransfer.effectAllowed = 'copy'; }}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const name = prompt('Rename preset', preset.name);
        if (name?.trim()) onRename(name);
      }}>
      <input type="color" className="chip-color" title="Accent color — shows on this preset's clips"
        value={preset.color ?? '#8c8577'} onClick={(e) => e.stopPropagation()}
        onChange={(e) => onColor(e.target.value)} />
      <MascotThumb className="glyph" scene={glyphScene(project, preset)} view={COMP} />
      {preset.name}
      {onPublish && (
        <button className="chip-pub" title={`Publish "${preset.name}" to the community`}
          onClick={(e) => { e.stopPropagation(); onPublish(); }}>Publish</button>
      )}
    </div>
  );
}

/**
 * The whole library, in the same sliding panel the effect picker uses.
 *
 * The rail can only ever show a handful before it crowds out the layers and the strip
 * below it, and scrolling a two-column grid inside a narrow rail is a poor way to browse
 * twenty of anything. This is where you go to look at all of them.
 */
function PresetDrawer({ project, presets, title, onOpen, onRename, onColor, onPublish, onClose }: {
  project: Project;
  presets: Preset[];
  title: string;
  onOpen: (p: Preset) => void;
  onRename: (id: string, name: string) => void;
  onColor: (id: string, color: string) => void;
  onPublish?: (p: Preset) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const hit = q.trim().toLowerCase();
  const shown = hit ? presets.filter((p) => p.name.toLowerCase().includes(hit)) : presets;

  return (
    <div className="drawer-scrim" role="presentation" onClick={onClose}>
      <aside className="drawer wide" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <strong>{title}</strong>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <input className="inp" value={q} autoFocus placeholder={`Search ${presets.length} presets`}
          aria-label="Search presets" onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {shown.map((preset) => (
            <PresetChip key={preset.id} project={project} preset={preset}
              onOpen={() => onOpen(preset)}
              onRename={(name) => onRename(preset.id, name)}
              onColor={(c) => onColor(preset.id, c)}
              onPublish={onPublish && preset.source === 'custom' ? () => onPublish(preset) : undefined} />
          ))}
        </div>
        {!shown.length && <p className="empty-note">Nothing matches “{q}”.</p>}
      </aside>
    </div>
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
