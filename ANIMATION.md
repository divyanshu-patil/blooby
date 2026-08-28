# Animation craft — where the copilot's numbers come from

The copilot receives a condensed craft block in every system prompt. It lives in
[`packages/studio/src/copilot/craft.ts`](packages/studio/src/copilot/craft.ts) as
`ANIMATION_CRAFT`, and that file is the single source for the numbers — this document
does not restate them, it explains where each came from and why it was chosen for a
mascot rig rather than for a web UI.

**If you change a number in `craft.ts`, update the reasoning here.** A number with no
argument behind it gets "tuned" back and forth forever.

## Why the copilot needs this at all

A language model asked to "make it blink then look surprised" will emit two keyframes
half a second apart with default easing. That is interpolation, not animation, and it
reads as a slideshow. Everything in `craft.ts` is one of the specific differences, stated
as a number the model can act on, against this rig's real property paths.

It is included on every turn rather than detected. Deciding "is this an animation
request?" needs a classifier, and the failure mode of getting it wrong is exactly the
output we are trying to fix. ~600 tokens is worth not being clever.

## Where each rule comes from

### Blink: 60–90 close, 30–60 hold, 90–140 open

Character animation references put a natural blink at 100–400 ms, with the common
working breakdown being 3–5 frames to close, a 1-frame hold, and 2–4 frames to open — at
24 fps that is roughly 125–200 ms down, 40 ms held, 85–165 ms up
([Animation Mentor](https://www.animationmentor.com/blog/tutorial-animate-blinks-eye-movement/),
[Bloop Animation](https://www.bloopanimation.com/blinking-animation/)). Disney Research's
work on eye blinks found that blinks which fully close are consistently perceived as more
natural than partial ones, which is why the recipe closes to 0.05 rather than 0.2
([Disney Research, *Modeling and Animating Eye Blinks*](https://la.disneyresearch.com/wp-content/uploads/Modeling-and-Animating-Eye-Blinks-Paper.pdf)).

The asymmetry matters more than the totals: the close is faster than the open. A
symmetric blink reads as a wink or a flinch.

### The close is faster than the open, and the inhale is slower than the exhale

Both come from the same observation in idle-loop and breathing references: real motion is
uneven, and evenness is what makes an animation read as machine-made
([AnimSchool, *Breathing Life into Idle Animations*](https://blog.animschool.edu/2024/06/14/breathing-life-into-idle-animations/),
[Animation Mentor, natural breathing loops](https://www.animationmentor.com/blog/tutorial-animate-natural-breathing-loops/)).

### Idle breath cycle 2500–4000 ms

A relaxed character breathes at roughly 15–20 breaths per minute, an alert one at 20–25
([AnimSchool](https://blog.animschool.edu/2024/06/14/breathing-life-into-idle-animations/)).
15 bpm is a 4000 ms cycle; 25 bpm is 2400 ms. The range is that arithmetic, not taste.

### Under ~80 ms reads as a jump, over ~500 ms for a small change reads as sluggish

From interface motion practice, which has measured this far more carefully than character
animation has. The hard rule in Emil Kowalski's standards is that UI animation stays under
300 ms, with button feedback at 100–160 ms and dropdowns at 150–250 ms
([emilkowalski/skills — review-animations STANDARDS.md](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md)).
eBay's motion tokens bracket the same territory: 17 ms "instant", 50/83/167 ms short,
250/333/500 ms medium, 667/833/1000 ms long
([eBay Playbook motion tokens](https://playbook.ebay.com/design-system/tokens/motion-tokens)).

A mascot is not a dropdown, so the upper bound is looser here — an expression change gets
200–350 ms and a large head turn 400–650 ms, above what a UI would allow — but the lower
bound holds: below ~80 ms nothing is perceived as having moved.

### "Scale duration with distance, not time"

Material's stated principle: use shorter durations for smaller changes and longer for
larger ones, so perceived *speed* stays constant
([Material Design 3, easing and duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)).
This is why the craft block gives ranges tied to the size of the move rather than a
single default.

### easeOut by default, easeIn almost never

`ease-in` starts slow, which delays movement at the exact moment the viewer is watching
for it; `ease-out` at the same duration feels faster because motion is visible
immediately ([emilkowalski/skills](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md)).
Material's split is the same shape: emphasized/standard curves that decelerate into rest,
with accelerate reserved for exits.

The exception kept here — `easeIn` for something leaving — is the same exception both
sources make.

### Squash and stretch: 2–5% subtle, 8–12% lively, 20–50% rubbery

Volume conservation is the underlying principle: as one dimension contracts another must
expand ([Animation Mentor](https://www.animationmentor.com/blog/squash-and-stretch-the-12-basic-principles-of-animation/),
[RebusFarm](https://rebusfarm.net/blog/squash-and-stretch-in-animation-the-essential-principle-for-lifelike-motion)).
The percentage bands come from the same material-dependent guidance: ~50% for rubbery
objects, 2–5% for subtle work, ~10% as the starting point for energetic motion
([Pixune](https://pixune.com/blog/squash-and-stretch/)).

`scale.x 1.08` pairing with `scale.y 0.93` is 1.08 × 0.93 ≈ 1.00 — the pairing is
arithmetic, and it is exactly what a model gets wrong when it scales one axis alone.

### Anticipation 60–120 ms at 10–20% of the main move

Anticipation is the second of the twelve principles: a small counter-move that prepares
the audience for a larger one
([Disney's 12 principles](https://www.nyfa.edu/student-resources/12-principles-of-animation/),
[CG Spectrum](https://www.cgspectrum.com/blog/12-principles-of-animation)). The
magnitudes are not specified in the literature — these are conservative values chosen so
that anticipation reads without becoming a visible second move, and the "skip under
150 ms" rule exists because anticipation on a fast move just makes it look like a stutter.

### Overshoot 8–15%, settle over 40–60% of the main duration

The design-system equivalent is a bounce curve —
`cubic-bezier(0.3, 0, 0, 1.25)` in eBay's tokens
([eBay Playbook](https://playbook.ebay.com/design-system/tokens/motion-tokens)) — where
the `1.25` control point is what carries the value past its target. Emil's spring guidance
brackets the same feel as `bounce: 0.1–0.3`, "keep it subtle"
([emilkowalski/skills](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md)).
8–15% sits inside both.

"Never overshoot a blink or anything closing" is ours: an eyelid that overshoots closed
has passed through the eye.

### Overlap: offset each layer 40–80 ms

Follow-through and overlapping action — parts of a body move at different rates and
arrive at different times ([Disney's 12 principles](https://www.nyfa.edu/student-resources/12-principles-of-animation/)).
The 40–80 ms figure is borrowed from list stagger, where 30–80 ms between items is the
band that reads as sequenced rather than slow
([emilkowalski/skills](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md)).
Simultaneity across every layer is the single most reliable tell of generated motion,
which is why this rule is stated as an absolute.

### Secondary action, holds, arcs

Straight from the twelve principles — secondary action supports the main one without
competing, arcs describe the curved path natural motion follows, and timing includes the
rests ([Disney's 12 principles](https://www.nyfa.edu/student-resources/12-principles-of-animation/),
[Creative Bloq](https://www.creativebloq.com/advice/understand-the-12-principles-of-animation)).

Arcs are the one place this rig gets a principle for free: `surface.yaw` and
`surface.pitch` move a feature *around a sphere*, so the screen-space path is curved
automatically. `flatOffset.x` / `flatOffset.y` move in a straight line and will look
wrong for anything but a small correction. That is why the craft block tells the model to
prefer the surface angles — it is rig-specific advice a general animation guide could not
give.

## Recipes

The recipe list is not sourced; it is this rig's properties applied to the rules above,
and it exists because the model otherwise has to derive "what is a surprised face" from
first principles every time and lands somewhere different each turn. Values were picked
to sit in the same neighbourhood as the built-in presets in `core/defaults.ts`, so a
generated clip and a built-in one look like they came from the same hand.

Treat them as starting points. If a recipe here and a built-in preset disagree, the
preset wins — it was authored, not derived.

## Sources

- [Animation Mentor — animating blinks and eye movement](https://www.animationmentor.com/blog/tutorial-animate-blinks-eye-movement/)
- [Bloop Animation — blinking animation tutorial](https://www.bloopanimation.com/blinking-animation/)
- [Disney Research — Modeling and Animating Eye Blinks (PDF)](https://la.disneyresearch.com/wp-content/uploads/Modeling-and-Animating-Eye-Blinks-Paper.pdf)
- [Animation Mentor — natural breathing loops](https://www.animationmentor.com/blog/tutorial-animate-natural-breathing-loops/)
- [AnimSchool — Breathing Life into Idle Animations](https://blog.animschool.edu/2024/06/14/breathing-life-into-idle-animations/)
- [Animation Mentor — Squash and Stretch](https://www.animationmentor.com/blog/squash-and-stretch-the-12-basic-principles-of-animation/)
- [RebusFarm — Squash and stretch, complete guide](https://rebusfarm.net/blog/squash-and-stretch-in-animation-the-essential-principle-for-lifelike-motion)
- [Pixune — What is squash and stretch](https://pixune.com/blog/squash-and-stretch/)
- [NYFA — Disney's 12 principles of animation](https://www.nyfa.edu/student-resources/12-principles-of-animation/)
- [CG Spectrum — the 12 principles of animation](https://www.cgspectrum.com/blog/12-principles-of-animation)
- [Creative Bloq — the 12 principles in action](https://www.creativebloq.com/advice/understand-the-12-principles-of-animation)
- [Material Design 3 — easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
- [eBay Playbook — motion tokens](https://playbook.ebay.com/design-system/tokens/motion-tokens)
- [emilkowalski/skills — review-animations STANDARDS.md](https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md)
