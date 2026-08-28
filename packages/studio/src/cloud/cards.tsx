import { CardMenu, relativeTime } from '../kit';
import { AssetThumb, ProjectThumb } from './Thumb';
import type { AssetRow, ProjectRow } from './types';
import type { Preset, Project } from '../core/types';

/**
 * One ProjectCard and one AssetCard, used by the dashboard, the community browser and the
 * admin panel alike. Role changes the `menu` passed in; it does not fork the component
 * (spec §29/§36) — which is what keeps an admin's view from drifting out of sync with
 * what a user actually sees.
 */

export function ProjectCard({ project, data, onOpen, menu, footer }: {
  project: ProjectRow;
  /** The loaded animation, when the list has it. Absent is fine — the card still renders. */
  data?: Project | null;
  onOpen: () => void;
  menu?: { label: string; onSelect: () => void; danger?: boolean }[];
  footer?: string;
}) {
  return (
    <div className="card" role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <div className="card-thumb"><ProjectThumb project={data ?? null} /></div>
      <div className="card-body">
        <div className="card-name">{project.name}</div>
        <div className="card-meta">
          {footer ?? `Edited ${relativeTime(Date.parse(project.updatedAt))}`}
          {project.visibility === 'public' && <> · <span className="tag" data-tone="live">Public</span></>}
        </div>
      </div>
      {menu?.length ? <CardMenu items={menu} /> : null}
    </div>
  );
}

const STATUS_TONE: Record<string, string | undefined> = {
  published: 'live', pending_review: 'warn', rejected: 'bad', draft: undefined, archived: undefined,
};

const STATUS_LABEL: Record<string, string> = {
  published: 'Published', pending_review: 'In review', rejected: 'Rejected', draft: 'Draft', archived: 'Archived',
};

export function AssetCard({ asset, onOpen, menu, showStatus }: {
  asset: AssetRow;
  onOpen: () => void;
  menu?: { label: string; onSelect: () => void; danger?: boolean }[];
  showStatus?: boolean;
}) {
  return (
    <div className="card" role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <div className="card-thumb"><AssetThumb preset={asset.data as Preset | null} /></div>
      <div className="card-body">
        <div className="card-name">{asset.name}</div>
        <div className="card-meta" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{asset.kind}</span>
          {asset.downloadCount > 0 && <span>· {asset.downloadCount} used</span>}
          {showStatus && <span className="tag" data-tone={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</span>}
        </div>
      </div>
      {menu?.length ? <CardMenu items={menu} /> : null}
    </div>
  );
}
