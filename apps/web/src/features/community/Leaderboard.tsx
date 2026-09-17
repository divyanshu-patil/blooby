import type { PublicInsights } from '@blooby/studio';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * The community's two leaderboards side by side: the people making the most public work,
 * and the presets and expressions pulled into the most projects. Each row carries a bar
 * scaled to the leader, so the gap between first and fifth reads at a glance.
 */
export function Leaderboard({ insights }: { insights: PublicInsights }) {
  const { topCreators, topAssets } = insights;
  if (!topCreators.length && !topAssets.length) return null;
  return (
    <section className="boards" aria-label="Community leaderboard">
      {topCreators.length > 0 && (
        <Board title="Top creators" note="By public projects">
          {topCreators.map((c, i) => (
            <Row key={i} rank={i + 1} share={c.projects / topCreators[0].projects}
              lead={<Avatar name={c.name} url={c.avatarUrl} />}
              name={c.name ?? 'Unnamed creator'}
              meta={`${plural(c.views, 'view')} · ${plural(c.copies, 'copy', 'copies')}`}
              value={plural(c.projects, 'project')} />
          ))}
        </Board>
      )}
      {topAssets.length > 0 && (
        <Board title="Most used" note="Added to projects">
          {topAssets.map((a, i) => (
            <Row key={a.id} rank={i + 1} share={topAssets[0].downloadCount ? a.downloadCount / topAssets[0].downloadCount : 0}
              name={a.name}
              meta={[a.kind === 'preset' ? 'Preset' : 'Expression', a.owner].filter(Boolean).join(' · ')}
              value={plural(a.downloadCount, 'use')} />
          ))}
        </Board>
      )}
    </section>
  );
}

function Board({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="board">
      <header className="board-head"><h2>{title}</h2><span>{note}</span></header>
      <ol className="board-list">{children}</ol>
    </div>
  );
}

function Row({ rank, share, lead, name, meta, value }: {
  rank: number; share: number; lead?: React.ReactNode; name: string; meta: string; value: string;
}) {
  return (
    <li className="board-row" data-podium={rank <= 3 ? rank : undefined}>
      <span className="board-rank" aria-label={`Rank ${rank}`}>{rank}</span>
      {lead}
      <span className="board-who">
        <span className="board-name">{name}</span>
        <span className="board-meta">{meta}</span>
      </span>
      <span className="board-value">
        {value}
        <span className="board-bar" aria-hidden><span style={{ width: `${Math.max(4, Math.round(share * 100))}%` }} /></span>
      </span>
    </li>
  );
}

function Avatar({ name, url }: { name: string | null; url: string | null }) {
  if (url) return <img className="board-avatar" src={url} alt="" referrerPolicy="no-referrer" />;
  return <span className="board-avatar" aria-hidden>{(name ?? '?').trim().charAt(0).toUpperCase()}</span>;
}
