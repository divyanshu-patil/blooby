import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AssetCard, ChipBar, Dialog, EmptyState, ErrorState, LoadingGrid, PageHeader, ProjectCard, SearchBar,
  assetsApi, communityApi, projectsApi, useAsync, useEditor,
  type AssetKind, type AssetRow, type AssetSource, type Page, type Preset, type ProjectRow,
} from '@blooby/studio';

const SOURCES = [
  { id: 'community' as const, label: 'Community' },
  { id: 'official' as const, label: 'Official' },
  { id: 'builtin' as const, label: 'Built-in' },
  { id: 'user' as const, label: 'My library' },
];

const KINDS = [
  { id: 'preset' as const, label: 'Presets' },
  { id: 'expression' as const, label: 'Expressions' },
];
/** public projects are community work too — only offered there */
const COMMUNITY_KINDS = [{ id: 'project' as const, label: 'Projects' }, ...KINDS];

type Sort = 'trending' | 'newest' | 'popular' | 'name';
const SORTS = [
  { id: 'trending' as const, label: 'Trending' },
  { id: 'newest' as const, label: 'Newest' },
  { id: 'popular' as const, label: 'Popular' },
  { id: 'name' as const, label: 'A–Z' },
];

/**
 * Browsing reusable assets, not administering them: cards with live previews, filters
 * across the top, one obvious action per item (spec §23).
 *
 * All four sources render through the same query and the same card — `source` only
 * changes the filter and which actions are offered.
 */
export function Community({ onAdded }: { onAdded?: (asset: AssetRow) => void }) {
  const [source, setSource] = useState<AssetSource>('community');
  const [pickedKind, setKind] = useState<AssetKind | 'project'>('preset');
  const [pickedSort, setSort] = useState<Sort>('trending');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<AssetRow | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const projects = source === 'community' && pickedKind === 'project';
  const kind: AssetKind = pickedKind === 'project' ? 'preset' : pickedKind;
  // a project has no download count or A–Z here: trending or newest
  const sort: Sort = projects && (pickedSort === 'popular' || pickedSort === 'name') ? 'trending' : pickedSort;

  const { data, error, loading, reload } = useAsync<Page<AssetRow> | Page<ProjectRow>>(
    () => (projects
      ? communityApi.projects({ q: q || undefined, sort: sort as 'trending' | 'newest', limit: 48 })
      : source === 'user'
        ? assetsApi.mine({ kind, q: q || undefined, limit: 48 })
        : assetsApi.browse({ kind, source, q: q || undefined, sort, limit: 48 })),
    [source, kind, sort, q, projects],
  );
  const insights = useAsync(() => communityApi.insights(), []);

  /** Anyone can copy a public project into their own — then it opens, theirs to change. */
  const duplicate = async (p: ProjectRow) => {
    setBusy(true);
    try { navigate(`/projects/${(await projectsApi.duplicate(p.id)).id}`); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Library" subtitle="Presets and expressions you can drop straight into a project.">
        <SearchBar value={q} onChange={setQ} placeholder="Search the library" />
      </PageHeader>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          <ChipBar options={SOURCES} value={source} onChange={setSource} />
          <ChipBar options={source === 'community' ? COMMUNITY_KINDS : KINDS} value={projects ? 'project' : kind} onChange={setKind} />
          {source !== 'user' && <ChipBar options={projects ? SORTS.slice(0, 2) : SORTS} value={sort} onChange={setSort} />}
        </div>

        {source === 'community' && insights.data && (insights.data.topCreators.length > 0 || insights.data.topAssets.length > 0) && (
          <section className="insights" aria-label="Community insights" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
            {insights.data.topAssets.length > 0 && (
              <div><div className="state-note">Most used</div>
                {insights.data.topAssets.slice(0, 5).map((a) => <div key={a.id}>{a.name} <span className="tag">{a.downloadCount} uses</span></div>)}</div>
            )}
            {insights.data.topCreators.length > 0 && (
              <div><div className="state-note">Most active creators</div>
                {insights.data.topCreators.slice(0, 5).map((c, i) => <div key={i}>{c.username ?? 'Someone'} <span className="tag">{c.projects} public</span></div>)}</div>
            )}
          </section>
        )}

        {loading && <LoadingGrid />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {projects && data && !loading && (data.items.length === 0 ? (
          <EmptyState title="No public projects yet" note="Make one of yours public from the editor and it shows up here." />
        ) : (
          <div className="card-grid">
            {(data.items as ProjectRow[]).map((p) => (
              <ProjectCard key={p.id} project={p}
                footer={`${p.owner ? `by ${p.owner} · ` : ''}${p.viewCount ?? 0} views · ${p.duplicateCount ?? 0} copies${p.access === 'edit' ? ' · open to edit' : ''}`}
                onOpen={() => navigate(`/projects/${p.id}`)}
                menu={[
                  { label: p.access === 'edit' ? 'Open and edit' : 'Open', onSelect: () => navigate(`/projects/${p.id}`) },
                  { label: busy ? 'Duplicating…' : 'Duplicate to my projects', onSelect: () => void duplicate(p) },
                ]} />
            ))}
          </div>
        ))}

        {!projects && data && !loading && (data.items.length === 0 ? (
          <EmptyState
            title={source === 'user' ? 'Nothing saved yet' : 'Nothing here yet'}
            note={source === 'user'
              ? 'Save a preset from the editor and it will show up here, ready to publish.'
              : 'Once people publish to the community, their work appears here.'}
          />
        ) : (
          <div className="card-grid">
            {(data.items as AssetRow[]).map((a) => (
              <AssetCard key={a.id} asset={a} showStatus={source === 'user'}
                onOpen={() => setPreview(a)}
                menu={[{ label: 'Add to project', onSelect: () => void add(a, onAdded) }]} />
            ))}
          </div>
        ))}
      </div>

      {preview && (
        <Dialog title={preview.name} note={preview.description ?? undefined} onClose={() => setPreview(null)}
          actions={<>
            <button className="btn ghost" onClick={() => setPreview(null)}>Close</button>
            <button className="btn primary" onClick={() => { void add(preview, onAdded); setPreview(null); }}>
              Add to project
            </button>
          </>}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {preview.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * Adding pulls the asset into the open project's own preset list, exactly the way the
 * editor's preset panel already works — so a community item behaves identically to a
 * built-in one the moment it lands.
 */
async function add(asset: AssetRow, onAdded?: (a: AssetRow) => void) {
  const preset = asset.data as Preset;
  useEditor.getState().commit((p) => {
    if (!p.presets.some((x) => x.id === preset.id)) p.presets = [...p.presets, preset];
  }, 'add from library');
  void assetsApi.markUsed(asset.id);
  onAdded?.(asset);
}
