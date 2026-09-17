import { useEffect, useRef, useState } from 'react';
import { Dialog } from './index';
import { isTourRunning, startTour } from './tour';
import { LATEST_RELEASE, RELEASES, markWhatsNewSeen, unseenReleases, useWhatsNewSeen, type Release, type Surface } from '../whatsNew';

/**
 * The "What's new" button and its panel — the same one in the editor and on the dashboard.
 *
 * It opens by itself once when there is something the person has not seen, lists everything
 * newer than what they last closed it on, and keeps older releases one click away. An item with
 * a tour here gets "Show me", which closes the panel and walks to the feature; an item that lives
 * on the other surface says where to find it instead. Closing it records the newest version seen.
 */
export function WhatsNewButton({ surface, autoOpen = true }: { surface: Surface; autoOpen?: boolean }) {
  const seen = useWhatsNewSeen();
  const unseen = unseenReleases(seen);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  // what is unseen right now — the signed-in value can arrive after this mounts
  const pending = useRef(unseen.length);
  pending.current = unseen.length;

  useEffect(() => {
    if (!autoOpen || opened.current || !unseen.length) return;
    // after the first paint and the onboarding tour's own start, so they do not stack
    // and never over a tour someone is in the middle of: try again once it is done
    const t = setInterval(() => {
      if (isTourRunning()) return;
      clearInterval(t);
      if (pending.current) { opened.current = true; setOpen(true); }
    }, 1200);
    return () => clearInterval(t);
  }, [autoOpen, unseen.length]);

  const close = () => { setOpen(false); markWhatsNewSeen(LATEST_RELEASE); };

  return (
    <>
      <button className="btn ghost sm whatsnew-btn" onClick={() => setOpen(true)} aria-haspopup="dialog"
        title={unseen.length ? "What's new — there is something you have not seen" : "What's new"}>
        What’s new{unseen.length > 0 && <span className="whatsnew-dot" aria-label="unseen" />}
      </button>
      {open && <WhatsNewPanel surface={surface} unseen={unseen} onClose={close} />}
    </>
  );
}

function WhatsNewPanel({ surface, unseen, onClose }: { surface: Surface; unseen: Release[]; onClose: () => void }) {
  const [older, setOlder] = useState(false);
  const fresh = new Set(unseen.map((r) => r.version));
  const shown = RELEASES.filter((r) => fresh.has(r.version) || older);
  const rest = RELEASES.length - unseen.length;

  return (
    <Dialog title="What’s new" note={unseen.length ? 'Here is what changed since you last looked.' : 'You are all caught up — the latest release is below.'}
      onClose={onClose}
      actions={<button className="btn primary" onClick={onClose}>Got it</button>}>
      <div className="whatsnew">
        {(shown.length ? shown : RELEASES.slice(0, 1)).map((r) => (
          <section key={r.version} className="whatsnew-release" aria-label={r.title}>
            <header>
              <strong>{r.title}</strong>
              <span className="hint">{r.date}{fresh.has(r.version) ? ' · new' : ''}</span>
            </header>
            <ul>
              {r.items.map((it) => (
                <li key={it.id} className="whatsnew-item">
                  <div className="whatsnew-item-head">
                    <span className="whatsnew-title">{it.title}</span>
                    <span className="tag">{it.surface === 'editor' ? 'Editor' : 'Dashboard'}</span>
                  </div>
                  <p>{it.body}</p>
                  {it.tour?.length ? (
                    it.surface === surface
                      ? <button className="btn sm" onClick={() => { onClose(); setTimeout(() => startTour(`whatsnew.${it.id}`, it.tour!, { force: true }), 60); }}>Show me</button>
                      : <span className="hint">{it.surface === 'editor' ? 'Open a project to see it.' : 'Find it on the dashboard.'}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {rest > 0 && !older && <button className="btn ghost sm" onClick={() => setOlder(true)}>Earlier releases</button>}
      </div>
    </Dialog>
  );
}
