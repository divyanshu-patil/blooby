/**
 * One SVG parser for the whole app.
 *
 * Only the inside of the <svg> is kept, plus its viewBox — the outer element is re-created
 * by the renderer at whatever size the thing drawing it is, so a file authored at 512px
 * and one authored at 24px come out the same size. Anything that can execute is stripped:
 * this markup goes through dangerouslySetInnerHTML, and pasted artwork is untrusted.
 */
const PAINT_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity'];

export function parseSvg(text: string): { markup: string; viewBox: string } | null {
  const open = /<svg\b[^>]*>/i.exec(text);
  const inner = /<svg\b[^>]*>([\s\S]*)<\/svg\s*>/i.exec(text)?.[1];
  if (!open || inner === undefined) return null;
  const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(open[0])?.[1];
  const viewBox = attr('viewBox') ?? `0 0 ${parseFloat(attr('width') ?? '') || 100} ${parseFloat(attr('height') ?? '') || 100}`;
  let markup = inner
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .trim();
  if (!markup) return null;

  /**
   * Paint set on the <svg> element itself has to come along.
   *
   * Icon sets put `fill="currentColor"` on the root and nothing on the paths, relying on
   * inheritance. Keeping only the inside threw that away, so the paths fell back to SVG's
   * default black — and changing the emitter colour did nothing, because nothing in the
   * artwork referred to `currentColor` any more.
   */
  const carried = PAINT_ATTRS
    .map((n) => [n, attr(n)] as const)
    .filter(([, v]) => v !== undefined)
    .map(([n, v]) => `${n}="${v}"`);
  if (carried.length) markup = `<g ${carried.join(' ')}>${markup}</g>`;
  return { markup, viewBox };
}
