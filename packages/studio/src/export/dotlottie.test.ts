import { it } from 'vitest';
import { check } from '../core/testkit';
import { defaultProject, makeTimeline } from '../core/defaults';
import { buildDotLottie } from './dotlottie';

// --- dotLottie: one state per timeline, 1:1 ------------------------------------
{
  const proj = defaultProject();
  const tl2 = makeTimeline('Wave');
  tl2.tracks.push({ id: 'wt', nodeId: 'body', property: 'transform.rotation', keyframes: [
    { id: 'a', time: 0, value: 0, easingOut: { type: 'linear' } },
    { id: 'b', time: 500, value: 20, easingOut: { type: 'linear' } },
  ] });
  tl2.timelineDurationMs = 500;
  tl2.loop = true;
  proj.timelines.push(tl2);

  const { animations, blob } = buildDotLottie(proj, { background: null });
  it('one animation per timeline', check(animations.length === proj.timelines.length, `${animations.length} vs ${proj.timelines.length}`));

  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const text = new TextDecoder().decode(bytes);
  // cheap local-file-header scan — good enough to confirm the v2.0 directory names
  // without pulling in a zip-reader for a test
  it('animations live under a/, not animations/', check(text.includes('a/idle.json') || text.includes('a/wave.json')));
  it('the state machine lives under s/, not states/', check(text.includes('s/mascot.json')));
  it('no legacy animations/ or states/ path leaked back in', check(!text.includes('animations/idle.json') && !text.includes('states/mascot.json')));

  // the looping second timeline gets no auto-advance guard — it never completes
  const sIdx = text.indexOf('s/mascot.json');
  it('a .lottie was actually produced with a state machine entry', check(sIdx >= 0));
}
