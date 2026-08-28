/**
 * What separates animation from interpolation, as numbers.
 *
 * A model asked to "make it blink then look surprised" will happily emit two keyframes
 * 500 ms apart with linear easing and call it done. It reads as a slideshow. Everything
 * here is the difference — timings, overshoot, overlap, squash ratios — written against
 * this rig's actual property paths so it can be acted on rather than admired.
 *
 * Goes into every system prompt. Kept under ~3 KB deliberately: it competes for context
 * with the timeline dump, and a rule the model skims past is worse than no rule.
 *
 * The numbers are sourced and argued in ANIMATION.md — change them there too, or the
 * reasoning behind them is lost.
 */
export const ANIMATION_CRAFT = `
Craft — apply this to everything you animate. Interpolating between two poses is not
animation; these are the differences.

TIMING (ms). Under ~80 reads as a jump. Over ~500 for a small change reads as sluggish.
  blink            close 60-90, hold 30-60, open 90-140   (180-280 total)
  micro-expression 120-200
  expression change (neutral to happy) 200-350
  head turn small (under 20°) 250-400 · large (over 45°) 400-650
  reaction/surprise 120-200 to the peak, 300-500 to settle
  idle breath cycle 2500-4000, inhale slower than exhale
Scale duration with the distance moved — hold the speed constant, not the time.

EASING. Never linear except for genuinely constant motion.
  easeOut    arrivals, and almost anything the user just asked for
  easeInOut  a move that starts and ends at rest
  easeIn     only for something leaving or being taken away
  A hold after an easeOut reads as settled; after a linear it reads as broken.

ANTICIPATION. Before a big move, go the other way: 60-120ms, 10-20% of the main move.
A head turning right leans left first. Skip it when the whole move is under ~150ms.

OVERSHOOT AND SETTLE. End a lively move past its target, then come back. Overshoot
8-15% of the change, settle over 40-60% of the main duration — a scale to 1.3 goes
1.0 to 1.34 to 1.3. Never overshoot a blink or anything closing.

SQUASH AND STRETCH. Volume is conserved: transform.scale.x and transform.scale.y move
in opposite directions. Subtle 2-5% (breathing, talking), lively 8-12% (a bounce),
rubbery 20-50% (comedy only). scale.x 1.08 pairs with scale.y 0.93.

OVERLAP. Nothing starts on the same frame. Offset each layer 40-80ms behind whatever
drives it — body first, then eyes, then the small stuff. Identical timing across every
layer is the clearest sign of machine-made motion.

SECONDARY ACTION. One main action plus one quiet supporting one. A head turn with a
3-5° roll and a 2° pitch dip reads alive; the same turn alone reads mechanical.

ARCS. Never move a feature in a straight line across the face. On this rig you get arcs
free by animating surface.yaw / surface.pitch instead of flatOffset.x / flatOffset.y —
the sphere mapping curves the path. Prefer the surface angles.

HOLDS. A pose held 200-400ms after it lands is what makes it read. Unbroken motion is
noise.

REST. Start and end on the resting pose unless told otherwise, so the clip can sit
anywhere on the strip and loop.

RECIPES — starting points, not rules. Adjust to what was asked.
  blink         eyeL/eyeR eye.openness 1 → 0.05 → 1
  sleepy        eye.openness ~0.15, body surface.pitch +8..12
  happy         eye.openness ~0.45, eye transform.scale.x ~1.2, body surface.pitch +4
  surprised     eye transform.scale.x and transform.length 1.4-1.6, body scale 1.05-1.08
  big/cat eyes  eye transform.length 1.5-1.8 with transform.scale.x 1.3-1.5,
                eye.distanceFromCenter in by 2-4°, held 300-500ms, then a blink out
  curious       body surface.yaw ±10-18 with transform.rotation ±4-8 the same direction
  nod (yes)     body surface.pitch 0 → +12 → -4 → 0 over 500-700
  shake (no)    body surface.yaw 0 → -14 → +12 → -6 → 0 over 600-800
  talk          body transform.scale.y alternating 1.05 / 0.97 every 180-220
  breathe/idle  body transform.scale.y 1 → 1.03 → 1 and flatOffset.y 0 → -6 → 0 over ~3000
`.trim();
