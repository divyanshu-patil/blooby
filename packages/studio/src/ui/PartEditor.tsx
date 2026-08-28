import { useState } from 'react';
import { SHAPE_LIBRARY, shapeById, type ShapeLibraryEntry } from '../core/emitters';
import { cssColor, hexColor, parseHex } from '../core/color';
import { useEditor } from '../core/store';
import { NumberField } from './bits';
import type { Emitter, EmitterPart } from '../core/types';

/**
 * What an emitter throws: a list you add to, each entry with its own dials.
 *
 * One shape repeated is the difference between "confetti" and "squares falling". Each
 * part carries a speed and size multiplier and can override the colour, so the variety
 * that makes an effect read comes from the list rather than from randomness bolted on
 * afterwards.
 */
export function PartEditor({ emitter }: { emitter: Emitter }) {
  const project = useEditor((s) => s.project);
  const updateEmitter = useEditor((s) => s.updateEmitter);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<ShapeLibraryEntry | null>(null);

  const parts = emitter.parts ?? [];
  const patch = (id: string, fn: (p: EmitterPart) => void) =>
    updateEmitter(emitter.id, (e) => { const p = e.parts?.find((x) => x.id === id); if (p) fn(p); });

  const addPart = (over: Partial<EmitterPart>) =>
    updateEmitter(emitter.id, (e) => {
      (e.parts ??= []).push({
        id: `pt${Date.now().toString(36)}${(e.parts?.length ?? 0)}`,
        weight: 1, speed: 1, sizeScale: 1, spin: 0, ...over,
      });
      // once there is a part list the legacy glyph line is dead weight, and leaving it
      // makes "why is there still a z" a real question
      e.glyphs = [];
    });

  const artOf = (p: EmitterPart) => {
    if (p.shapeId) return shapeById(p.shapeId);
    const a = project.svgAssets?.find((x) => x.id === p.svgAssetId);
    return a ? { name: a.name, viewBox: a.viewBox, markup: a.markup } : undefined;
  };

  return (
    <>
      <div className="row">
        <span className="prop-label" style={{ flex: 1 }}>Throws</span>
        <button className="btn sm" title="Pick a shape to add" onClick={() => setPicking(true)}>+ Shape</button>
        <button className="btn sm" title="Add a plain character"
          onClick={() => addPart({ glyph: '★' })}>+ Text</button>
      </div>

      {!parts.length && (
        <p className="empty-note">
          Nothing to throw yet. Add a shape — several, in different colours and sizes, is what
          makes a burst read as confetti rather than as one square repeated.
        </p>
      )}

      {parts.map((p) => {
        const art = artOf(p);
        return (
          <div key={p.id} className="partrow">
            <span className="partart" style={{ color: cssColor(p.color ?? emitter.color) }}>
              {art
                ? <svg viewBox={art.viewBox} dangerouslySetInnerHTML={{ __html: art.markup }} />
                : <span className="partglyph">{p.glyph}</span>}
            </span>
            <div className="partbody">
              <div className="row">
                {p.glyph !== undefined ? (
                  <input className="txt" style={{ flex: 1 }} value={p.glyph} aria-label="Character"
                    onChange={(e) => patch(p.id, (x) => { x.glyph = e.target.value; })} />
                ) : (
                  <span className="tag" style={{ flex: 1 }}>{art?.name ?? 'missing shape'}</span>
                )}
                {/* The swatch is always here, showing whatever this piece is currently
                    drawn in. Hiding it behind "auto" meant there was no visible way to
                    recolour a glyph at all — picking a colour simply switches it off auto,
                    which is what picking a colour means. */}
                <input type="color" className="swatch" aria-label="Colour of this piece"
                  title={p.color === undefined ? 'Taking the emitter colour — pick one to override it' : 'Its own colour'}
                  value={hexColor(p.color ?? emitter.color)}
                  onChange={(e) => patch(p.id, (x) => { x.color = { ...parseHex(e.target.value), a: 1 }; })} />
                <button className="btn ghost sm" aria-pressed={p.color === undefined}
                  title={p.color === undefined ? 'Using the emitter colour' : 'Go back to the emitter colour'}
                  onClick={() => patch(p.id, (x) => { if (x.color === undefined) x.color = { ...emitter.color }; else delete x.color; })}>
                  auto
                </button>
                <button className="btn ghost sm icon" title="Remove"
                  onClick={() => updateEmitter(emitter.id, (e) => { e.parts = (e.parts ?? []).filter((x) => x.id !== p.id); })}>✕</button>
              </div>
              <div className="row partdials">
                <label title="How fast this one travels, against the emitter's own speed">
                  <span>speed</span>
                  <NumberField value={p.speed} step={0.1} onChange={(v) => patch(p.id, (x) => { x.speed = Math.max(0.05, v); })} />
                </label>
                <label title="Its size, against the emitter's own">
                  <span>size</span>
                  <NumberField value={p.sizeScale} step={0.1} onChange={(v) => patch(p.id, (x) => { x.sizeScale = Math.max(0.05, v); })} />
                </label>
                <label title="Extra turn over one life, in degrees">
                  <span>spin</span>
                  <NumberField value={p.spin} step={15} onChange={(v) => patch(p.id, (x) => { x.spin = v; })} />
                </label>
              </div>
            </div>
          </div>
        );
      })}

      {picking && (
        <div className="scrim" role="presentation" onClick={() => { setPicking(false); setPreview(null); }}>
          <div className="preview-card shapepick" role="dialog" aria-modal="true" aria-label="Pick a shape"
            onClick={(e) => e.stopPropagation()}>
            <div className="shapepick-head">
              <strong>Shapes</strong>
              <span className="spacer" />
              <button className="btn sm" onClick={() => { setPicking(false); setPreview(null); }}>Close</button>
            </div>

            {/* big preview of whatever is hovered, so a 20px thumbnail is not the only
                look you get at it before committing */}
            <div className="shapepick-preview" style={{ color: cssColor(emitter.color) }}>
              {preview
                ? <svg viewBox={preview.viewBox} dangerouslySetInnerHTML={{ __html: preview.markup }} />
                : <p className="empty-note">Hover a shape to see it big.</p>}
            </div>
            <div className="shapepick-name">{preview?.name ?? ''}</div>

            {(['symbols', 'drops', 'confetti', 'notes'] as const).map((group) => (
              <div key={group}>
                <span className="panel-title">{group}</span>
                <div className="shapepick-grid">
                  {SHAPE_LIBRARY.filter((s) => s.group === group).map((s) => (
                    <button key={s.id} className="shapepick-cell" title={s.name}
                      onPointerEnter={() => setPreview(s)} onFocus={() => setPreview(s)}
                      onClick={() => { addPart({ shapeId: s.id }); setPicking(false); setPreview(null); }}>
                      <svg viewBox={s.viewBox} dangerouslySetInnerHTML={{ __html: s.markup }} />
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {!!project.svgAssets?.length && (
              <div>
                <span className="panel-title">yours</span>
                <div className="shapepick-grid">
                  {project.svgAssets.map((a) => (
                    <button key={a.id} className="shapepick-cell" title={a.name}
                      onClick={() => { addPart({ svgAssetId: a.id }); setPicking(false); setPreview(null); }}>
                      <svg viewBox={a.viewBox} dangerouslySetInnerHTML={{ __html: a.markup }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
