import { it } from 'vitest';
import { check, near } from './testkit';
import { importSvg, looksLikeSvg, parseSvgGeometry, parseTransform, svgOutline } from './svg';
import { flattenPath, morphPath, pathBounds, primitivePath } from './path';
import { makeSvgLayer } from './layers';
import { libraryOutline, shapeIdOf, SHAPE_LIBRARY } from './emitters';
import { defaultProject } from './defaults';
import { compOf } from './comp';
import { sceneAt } from './scene';
import { activeTimeline } from './types';

const box = (d: string) => pathBounds(d)!;

// --- every supported element becomes a path ---------------------------------------
{
  const svg = `<svg viewBox="0 0 100 100">
    <path d="M10 10 L30 10 L30 30 Z" fill="#ff0000"/>
    <rect x="40" y="10" width="20" height="10" rx="4"/>
    <circle cx="80" cy="15" r="5"/>
    <ellipse cx="20" cy="60" rx="10" ry="5"/>
    <line x1="40" y1="50" x2="60" y2="70" stroke="#000" stroke-width="2"/>
    <polygon points="70,50 90,50 80,70"/>
    <polyline points="10,90 20,80 30,90" fill="none" stroke="blue"/>
  </svg>`;
  const g = parseSvgGeometry(svg)!;
  it('path, rect, circle, ellipse, line, polygon and polyline all come through', check(g.paths.length === 7, String(g.paths.length)));
  it('with nothing unsupported in them', check(g.unsupported.length === 0, g.unsupported.join()));
  const circle = box(g.paths[2].d);
  it('a circle is a real circle, not its bounding box', check(near(circle.x0, 75, 0.05) && near(circle.x1, 85, 0.05) && near(circle.y1, 20, 0.05)));
  const rounded = flattenPath(g.paths[1].d, 128);
  it('a rounded rect keeps its round corners', check(!rounded.some((p) => near(p.x, 40, 1e-3) && near(p.y, 10, 1e-3))));
  it('an explicit fill is kept as the path\'s own', check(g.paths[0].fill?.r === 255 && g.paths[0].fill?.g === 0));
  it('an unpainted one defers to the layer', check(g.paths[1].fill === undefined));
  it('a line has nothing to fill but a stroke', check(g.paths[4].fill === null && g.paths[4].stroke?.r === 0 && g.paths[4].strokeWidth === 2));
  it('and an open polyline stays open — no closing edge it never had', check(!/Z\s*$/.test(g.paths[6].d), g.paths[6].d));
  it('a named colour is understood', check(g.paths[6].stroke?.b === 255));
}

// --- groups and transforms ---------------------------------------------------------
{
  const m = parseTransform('translate(10 20) scale(2)');
  it('a transform list composes left to right', check(m[0] === 2 && m[4] === 10 && m[5] === 20));
  const svg = `<svg viewBox="0 0 200 200"><g transform="translate(100 0)" fill="#00ff00">
    <g transform="rotate(90)"><rect x="0" y="0" width="10" height="20"/></g></g></svg>`;
  const g = parseSvgGeometry(svg)!;
  const b = box(g.paths[0].d);
  it('nested group transforms are applied to the geometry', check(near(b.x0, 80, 1e-6) && near(b.x1, 100, 1e-6) && near(b.y1, 10, 1e-6), JSON.stringify(b)));
  it('and paint is inherited down the tree', check(g.paths[0].fill?.g === 255));
  const scaled = parseSvgGeometry('<svg viewBox="0 0 10 10"><g transform="scale(3)"><line x1="0" y1="0" x2="1" y2="1" stroke="#000" stroke-width="2"/></g></svg>')!;
  it('stroke width scales with the transform', check(near(scaled.paths[0].strokeWidth!, 6, 1e-6)));
}

// --- unsupported things are named, never silently dropped ---------------------------
{
  const g = parseSvgGeometry(`<svg viewBox="0 0 10 10"><defs><linearGradient id="a"/></defs>
    <text x="0" y="5">Hi</text><rect width="4" height="4" fill="url(#a)"/><image href="x.png"/></svg>`)!;
  it('text is reported', check(g.unsupported.some((u) => /text/.test(u)), g.unsupported.join(' | ')));
  it('a gradient is reported, and the shape still comes through', check(g.unsupported.some((u) => /gradient/.test(u)) && g.paths.length === 1));
  it('an embedded bitmap is reported', check(g.unsupported.some((u) => /bitmap/.test(u))));
  it('defs are not drawn', check(g.paths.length === 1));
}

// --- malformed input degrades safely -------------------------------------------------
{
  it('not an SVG is null', check(parseSvgGeometry('hello') === null && importSvg('<div/>') === null));
  const junk = parseSvgGeometry('<svg viewBox="0 0 10 10"><path d="M 1 zz 4 L NaN 3"/><rect width="x" height="-3"/><circle r="0"/></svg>')!;
  it('garbage geometry yields no NaN', check(junk.paths.every((p) => !/NaN/.test(p.d))));
  it('and a broken attribute is skipped, not thrown', check(!!junk));
  it('looksLikeSvg recognises markup on a clipboard', check(looksLikeSvg('  <svg><path d="M0 0"/></svg> ') && !looksLikeSvg('M 0 0 L 1 1')));
}

// --- SVG → a layer: one path is a shape, several are a vector layer ------------------
{
  const one = makeSvgLayer('<svg viewBox="0 0 24 24"><path d="M12 2 L22 22 L2 22 Z" fill="#3366ff"/></svg>', 'tri')!;
  it('a single path becomes an editable shape layer', check(one.node.kind === 'primitive' && !!one.node.shapePath));
  it('whose outline is in the unit box', check((() => { const b = box(one.node.shapePath!); return near(b.x0, -0.5, 1e-3) && near(b.y1, 0.5, 1e-3); })()));
  it('with its colour as the layer fill, so Fill recolours it', check(one.node.color.b === 255 && one.node.color.r === 0x33));
  it('keeping the original markup', check(one.node.svg?.sourceMarkup.includes('M12 2') === true));
  it('and its aspect in its size', check(one.node.size.x === 150 && one.node.size.y === 150 * 20 / 20));

  const multi = makeSvgLayer(`<svg viewBox="0 0 40 20"><rect width="18" height="20" fill="#ff0000"/><circle cx="30" cy="10" r="10" fill="#0000ff"/></svg>`)!;
  it('several paths become one vector layer', check(multi.node.kind === 'svgLayer' && multi.node.svg?.paths?.length === 2));
  it('each keeping its own colour', check(multi.node.svg!.paths![0].fill?.r === 255 && multi.node.svg!.paths![1].fill?.b === 255));
  it('placed together in one box', check(multi.node.size.x === 150 && multi.node.size.y === 75));
  it('with a sensible default name', check(multi.node.name === 'SVG Layer'));

  const icon = makeSvgLayer(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`)!;
  it('a currentColor line icon keeps its strokes on the layer\'s own stroke', check(icon.node.stroke?.enabled === true && (icon.node.stroke.width ?? 0) > 1, JSON.stringify(icon.node.stroke)));
  it('and paints no fill', check(icon.node.svg!.paths!.every((p) => p.fill === null)));

  it('text that is not an SVG makes no layer', check(makeSvgLayer('just words') === null));

  // it renders, in the scene every renderer and the exporter read
  const p = defaultProject();
  Object.assign(activeTimeline(p), { tracks: [], blocks: [] });
  p.rig.nodes[multi.node.id] = multi.node;
  const item = sceneAt(p, 0, compOf(p)).find((s) => s.id === multi.node.id)!;
  it('a vector layer is in the scene with its paths', check(!!item && item.paths?.length === 2 && item.w === 150));
}

// --- the shape library: one list, every entry usable as a layer outline --------------
{
  it('every generated outline is in SHAPE_LIBRARY', check(['pebble', 'capsule', 'roundedRect', 'blob', 'octopus'].every((id) => SHAPE_LIBRARY.some((s) => s.id === id && s.outline))));
  it('every library entry can be a layer outline', check(SHAPE_LIBRARY.every((s) => !!libraryOutline(s.id)), SHAPE_LIBRARY.filter((s) => !libraryOutline(s.id)).map((s) => s.id).join()));
  it('drawn artwork keeps its proportions as an outline', check((() => { const b = box(libraryOutline('drop')!); return (b.y1 - b.y0) > (b.x1 - b.x0) * 1.2; })()));
  it('an outline is recognised by name at any moment', check(shapeIdOf(primitivePath('octopus')) === 'octopus' && shapeIdOf('M 0 0 L 1 0 Z') === undefined));

  // arbitrary imported shapes morph like anything else
  const imported = svgOutline('<svg viewBox="0 0 10 10"><path d="M0 0 L10 0 L10 10 Z"/></svg>')!;
  const mid = morphPath(imported, primitivePath('blob'), 0.5);
  it('an imported outline morphs into a library shape', check(flattenPath(mid, 64).length === 64 && !/NaN/.test(mid)));
  it('even when they are wound in opposite directions', check((() => {
    const cw = 'M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z', ccw = 'M -0.5 -0.5 L -0.5 0.5 L 0.5 0.5 L 0.5 -0.5 Z';
    const half = flattenPath(morphPath(cw, ccw, 0.5), 64);
    // a correctly aligned morph of a square into itself stays a square, never collapses
    const b = pathBounds(morphPath(cw, ccw, 0.5))!;
    return half.length === 64 && b.x1 - b.x0 > 0.9;
  })()));
}
