import { it } from 'vitest';
import { check } from '../core/testkit';
import { thumbProject, thumbTimes } from './Thumb';
import { defaultProject } from '../core/defaults';
import { sceneAt } from '../core/scene';
import { compOf } from '../core/comp';

// a brand-new project's stored file is `{}` — it still draws, as the default mascot
const blank = thumbProject({});
it('an empty project file still has something to draw', check(!!blank && sceneAt(blank, 0, compOf(blank)).length > 0));
it('garbage is no preview, not a crash', check(thumbProject(null) === null && thumbProject('x') === null));

const p = defaultProject();
const times = thumbTimes(p);
it('three frames spread across the timeline, early to late', check(times.length === 3 && times[0] < times[1] && times[1] < times[2], times.join()));
it('a saved project keeps its own content', check(thumbProject(JSON.parse(JSON.stringify(p)))!.timelines[0].id === p.timelines[0].id));
