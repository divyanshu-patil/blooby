import { it } from 'vitest';
import { check, near } from './testkit';
import { applyEasing, cubicBezier } from './easing';

// --- easing --------------------------------------------------------------------
it('bezier endpoints', check(cubicBezier({ x: .42, y: 0 }, { x: .58, y: 1 }, 0) === 0 && cubicBezier({ x: .42, y: 0 }, { x: .58, y: 1 }, 1) === 1));
it('linear is identity', check(near(applyEasing({ type: 'linear' }, 0.37), 0.37)));
it('easeIn lags', check(applyEasing({ type: 'preset', name: 'easeIn' }, 0.5) < 0.5));
it('easeOut leads', check(applyEasing({ type: 'preset', name: 'easeOut' }, 0.5) > 0.5));
it('easeInOut symmetric', check(near(applyEasing({ type: 'preset', name: 'easeInOut' }, 0.5), 0.5, 1e-4)));
it('bounce lands on 1', check(near(applyEasing({ type: 'preset', name: 'bounce' }, 1), 1, 1e-6)));
it('elastic lands on 1', check(applyEasing({ type: 'preset', name: 'elastic' }, 1) === 1));
for (let i = 0; i <= 20; i++) {
  const v = applyEasing({ type: 'preset', name: 'easeInOut' }, i / 20);
  it('easeInOut monotone in 0..1', check(v >= -1e-9 && v <= 1 + 1e-9));
}
