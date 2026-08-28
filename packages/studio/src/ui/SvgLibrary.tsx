import { useRef, useState } from 'react';
import { useEditor } from '../core/store';
import type { SvgAsset } from '../core/types';

/**
 * One SVG parser for the whole app.
 *
 * Only the inside of the <svg> is kept, plus its viewBox — the outer element is re-created
 * by the renderer at whatever size the thing drawing it is, so a file authored at 512px
 * and one authored at 24px come out the same size. Anything that can execute is stripped:
 * this markup goes through dangerouslySetInnerHTML, and pasted artwork is untrusted.
 */
export function parseSvg(text: string): { markup: string; viewBox: string } | null {
  const open = /<svg\b[^>]*>/i.exec(text);
  const inner = /<svg\b[^>]*>([\s\S]*)<\/svg\s*>/i.exec(text)?.[1];
  if (!open || inner === undefined) return null;
  const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(open[0])?.[1];
  const viewBox = attr('viewBox') ?? `0 0 ${parseFloat(attr('width') ?? '') || 100} ${parseFloat(attr('height') ?? '') || 100}`;
  const markup = inner
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .trim();
  return markup ? { markup, viewBox } : null;
}

/**
 * The project's imported artwork: add by paste or by file, several at a time, and see
 * what is already in there.
 *
 * It was one file input that replaced whatever the emitter pointed at, so there was no
 * way to build up a set, no way to paste, and nothing showed you what you had imported.
 */
export function SvgLibrary({ onPick, selectedId }: {
  onPick: (asset: SvgAsset) => void;
  selectedId?: string;
}) {
  const assets = useEditor((s) => s.project.svgAssets) ?? [];
  const addSvgAsset = useEditor((s) => s.addSvgAsset);
  const removeSvgAsset = useEditor((s) => s.removeSvgAsset);
  const file = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const add = (text: string, fallbackName: string): SvgAsset | null => {
    const parsed = parseSvg(text);
    if (!parsed) { setErr('That does not look like an SVG — paste the whole <svg>…</svg>.'); return null; }
    setErr(null);
    const id = addSvgAsset(fallbackName.slice(0, 24) || 'artwork', parsed.markup, parsed.viewBox);
    return { id, name: fallbackName, ...parsed };
  };

  const addPasted = () => {
    const a = add(paste, name.trim() || `pasted ${assets.length + 1}`);
    if (!a) return;
    setPaste(''); setName('');
    onPick(a);
  };

  const addFiles = async (files: FileList) => {
    let last: SvgAsset | null = null;
    for (const f of [...files]) last = add(await f.text(), f.name.replace(/\.svg$/i, '')) ?? last;
    if (last) onPick(last);
  };

  return (
    <div className="svglib">
      <input ref={file} type="file" accept=".svg,image/svg+xml" multiple hidden
        onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />

      {assets.length > 0 && (
        <div className="svglib-grid">
          {assets.map((a) => (
            <div key={a.id} className={`svglib-item${selectedId === a.id ? ' on' : ''}`}>
              <button type="button" title={a.name} onClick={() => onPick(a)}>
                <svg viewBox={a.viewBox} preserveAspectRatio="xMidYMid meet"
                  dangerouslySetInnerHTML={{ __html: a.markup }} />
                <span>{a.name}</span>
              </button>
              <button type="button" className="svglib-x" title={`Forget ${a.name}`}
                onClick={() => removeSvgAsset(a.id)}>✕</button>
            </div>
          ))}
        </div>
      )}

      <textarea className="svglib-paste" rows={3} value={paste} spellCheck={false}
        placeholder={'Paste <svg>…</svg> here'}
        onChange={(e) => setPaste(e.target.value)}
        onPaste={(e) => {
          // paste-and-go: the common case is one SVG off a clipboard, and making someone
          // then find a button for it is the kind of step that gets called "not working"
          const text = e.clipboardData.getData('text');
          if (!parseSvg(text)) return;
          e.preventDefault();
          const a = add(text, name.trim() || `pasted ${assets.length + 1}`);
          if (a) { setName(''); onPick(a); }
        }} />
      <div className="row">
        <input className="inp" style={{ flex: 1 }} value={name} placeholder="name (optional)"
          onChange={(e) => setName(e.target.value)} />
        <button className="btn sm" disabled={!paste.trim()} onClick={addPasted}>Add</button>
        <button className="btn sm" onClick={() => file.current?.click()}>From file…</button>
      </div>
      {err && <p className="hint err">{err}</p>}
    </div>
  );
}
