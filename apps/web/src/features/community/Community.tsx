import { useState } from 'react';
import {
  AssetCard, ChipBar, Dialog, EmptyState, ErrorState, LoadingGrid, PageHeader, SearchBar,
  assetsApi, useAsync, useEditor, type AssetKind, type AssetRow, type AssetSource, type Preset,
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

const SORTS = [
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
  const [kind, setKind] = useState<AssetKind>('preset');
  const [sort, setSort] = useState<'newest' | 'popular' | 'name'>('newest');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<AssetRow | null>(null);

  const { data, error, loading, reload } = useAsync(
    () => (source === 'user'
      ? assetsApi.mine({ kind, q: q || undefined, limit: 48 })
      : assetsApi.browse({ kind, source, q: q || undefined, sort, limit: 48 })),
    [source, kind, sort, q],
  );

  return (
    <>
      <PageHeader title="Library" subtitle="Presets and expressions you can drop straight into a project.">
        <SearchBar value={q} onChange={setQ} placeholder="Search the library" />
      </PageHeader>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          <ChipBar options={SOURCES} value={source} onChange={setSource} />
          <ChipBar options={KINDS} value={kind} onChange={setKind} />
          {source !== 'user' && <ChipBar options={SORTS} value={sort} onChange={setSort} />}
        </div>

        {loading && <LoadingGrid />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !loading && (data.items.length === 0 ? (
          <EmptyState
            title={source === 'user' ? 'Nothing saved yet' : 'Nothing here yet'}
            note={source === 'user'
              ? 'Save a preset from the editor and it will show up here, ready to publish.'
              : 'Once people publish to the community, their work appears here.'}
          />
        ) : (
          <div className="card-grid">
            {data.items.map((a) => (
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
