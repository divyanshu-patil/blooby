import { it } from 'vitest';
import { check } from './testkit';
import { compOf } from './comp';
import type { Project } from './types';

{
  const c = (width: unknown, height: unknown) => compOf({ composition: { width, height } } as unknown as Project);
  it('no project, or no composition, is the default canvas', check(compOf(null).width === 720 && compOf({} as Project).height === 720));
  it('a size that is not a number falls back, one out of range is clamped', check(c('wide', NaN).width === 720 && c(1e9, -5).width > 720 && c(1e9, -5).height < 720));
}
