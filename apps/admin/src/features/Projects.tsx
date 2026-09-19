import { useState } from 'react';
import { Avatar, EmptyState, ErrorState, PageHeader, Pager, SearchBar, adminApi, relativeTime, useAsync, usePager } from '@blooby/studio';

/** Metadata only, deliberately. Admin analytics must not quietly open private user work
 *  (spec §15), so this lists names, sizes and timestamps — never project contents. */
export function Projects() {
  const [q, setQ] = useState('');
  const pager = usePager();
  const { data, error, loading, reload } = useAsync(
    () => adminApi.projects({ q: q || undefined, limit: 50, ...(pager.cursor ? { cursor: pager.cursor } : {}) }),
    [q, pager.cursor],
  );

  return (
    <>
      <PageHeader title="Projects" subtitle="Every project on the platform, by metadata.">
        <SearchBar value={q} onChange={(v) => { setQ(v); pager.reset(); }} placeholder="Search project names" />
      </PageHeader>

      <div className="page-body">
        {loading && <div className="skeleton" style={{ height: 260 }} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {data && !loading && (data.items.length === 0 ? (
          <EmptyState title="No projects" note={q ? `Nothing matches “${q}”.` : 'Nobody has created a project yet.'} />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Project</th><th>Owner</th><th>Visibility</th><th>Versions</th><th>Size</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <span className="person">
                      <Avatar name={p.owner} url={p.ownerAvatarUrl} size={22} />
                      <span className="person-name">{p.owner ?? <span className="num">{p.userId.slice(0, 8)}</span>}</span>
                    </span>
                  </td>
                  <td>{p.visibility === 'public' ? <span className="tag" data-tone="live">Public</span> : 'Private'}</td>
                  <td className="num">{p.currentVersion}</td>
                  <td className="num">{(Number(p.sizeBytes) / 1024).toFixed(0)} KB</td>
                  <td className="num">{relativeTime(Date.parse(p.updatedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {data && !loading && <Pager pager={pager} nextCursor={data.nextCursor} />}
      </div>
    </>
  );
}
