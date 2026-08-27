import { useState } from 'react';
import {
  AssetCard, ChipBar, Dialog, EmptyState, ErrorState, LoadingGrid, PageHeader,
  adminApi, useAsync, type AssetRow,
} from '@blooby/studio';

const QUEUES = [
  { id: 'pending_review' as const, label: 'Pending' },
  { id: 'published' as const, label: 'Published' },
  { id: 'rejected' as const, label: 'Rejected' },
  { id: 'archived' as const, label: 'Archived' },
];

/**
 * Moderation works in statuses, never deletion, so the history of a decision survives it
 * and a rejection can be revisited (spec §26).
 */
export function Moderation() {
  const [queue, setQueue] = useState<'pending_review' | 'published' | 'rejected' | 'archived'>('pending_review');
  const [review, setReview] = useState<AssetRow | null>(null);
  const { data, error, loading, reload } = useAsync(() => adminApi.moderationQueue({ status: queue, limit: 48 }), [queue]);

  return (
    <>
      <PageHeader title="Community" subtitle="Review what people have submitted.">
        <ChipBar options={QUEUES} value={queue} onChange={setQueue} />
      </PageHeader>

      <div className="page-body">
        {loading && <LoadingGrid />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !loading && (data.items.length === 0 ? (
          <EmptyState
            title={queue === 'pending_review' ? 'Nothing waiting' : 'Nothing here'}
            note={queue === 'pending_review'
              ? 'New community submissions will appear here for review.'
              : 'No items currently have this status.'}
          />
        ) : (
          <div className="card-grid">
            {data.items.map((a) => <AssetCard key={a.id} asset={a} showStatus onOpen={() => setReview(a)} />)}
          </div>
        ))}
      </div>

      {review && <ReviewDialog asset={review} onClose={() => setReview(null)} onDone={() => { setReview(null); reload(); }} />}
    </>
  );
}

function ReviewDialog({ asset, onClose, onDone }: { asset: AssetRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: 'approve' | 'reject' | 'unpublish' | 'archive') => {
    setBusy(true); setError(null);
    try {
      await adminApi.moderate(asset.id, action === 'reject' ? { action, reason } : { action });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that.');
      setBusy(false);
    }
  };

  return (
    <Dialog title={asset.name} note={asset.description ?? 'No description was submitted.'} onClose={onClose}
      actions={
        rejecting ? <>
          <button className="btn ghost" onClick={() => setRejecting(false)}>Back</button>
          <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => void act('reject')}>
            Reject submission
          </button>
        </> : <>
          <button className="btn ghost" onClick={onClose}>Close</button>
          {asset.status === 'published'
            ? <button className="btn" disabled={busy} onClick={() => void act('unpublish')}>Unpublish</button>
            : <button className="btn ghost" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>}
          {asset.status !== 'published' && (
            <button className="btn primary" disabled={busy} onClick={() => void act('approve')}>Approve &amp; publish</button>
          )}
        </>
      }>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="tag">{asset.kind}</span>
        <span className="tag">{asset.source}</span>
        {asset.tags.map((t) => <span key={t} className="tag">{t}</span>)}
      </div>

      {asset.reviewNote && (
        <p style={{ fontSize: 12.5, color: 'var(--hot)' }}>Previously rejected: {asset.reviewNote}</p>
      )}

      {rejecting && (
        <div className="field-row">
          <label htmlFor="reason">Why are you rejecting this?</label>
          <textarea id="reason" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="The creator sees this, so be specific about what to change." />
        </div>
      )}
      {error && <p style={{ color: 'var(--hot)', fontSize: 12.5 }}>{error}</p>}
    </Dialog>
  );
}
