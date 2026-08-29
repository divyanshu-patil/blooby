import { it } from 'vitest';
import { check } from '../core/testkit';
import { sceneAt } from '../core/scene';
import { builtinPresets, defaultProject, presetPreviewProject } from '../core/defaults';
import { sceneBounds, unionBounds } from './Mascot';

// --- a playing preview keeps ONE frame, instead of refitting every tick ----------
{
  const base3 = defaultProject();
  const moved: string[] = [];
  const escaped: string[] = [];
  for (const preset of builtinPresets()) {
    const temp = presetPreviewProject(base3, preset);
    const frames: (ReturnType<typeof sceneBounds>)[] = [];
    let union: ReturnType<typeof sceneBounds> = null;
    for (let i = 0; i < 24; i++) {
      const b = sceneBounds(sceneAt(temp, (i / 24) * preset.durationMs, { width: 720, height: 720 }));
      if (!b) continue;
      frames.push(b);
      union = unionBounds(union, b);
    }
    if (!frames.length || !union) continue;
    const widths = frames.map((b) => b!.x1 - b!.x0);
    // the thing that made the mascot creep: fitting each frame gives a different frame
    if (Math.max(...widths) - Math.min(...widths) > 2) moved.push(preset.name);
    // and the union has to actually contain every one of them, or the fix clips
    if (frames.some((b) => b!.x0 < union!.x0 - 1e-6 || b!.x1 > union!.x1 + 1e-6
      || b!.y0 < union!.y0 - 1e-6 || b!.y1 > union!.y1 + 1e-6)) escaped.push(preset.name);
  }
  it('fitting a frame at a time really does move the frame', check(moved.length > 8, `${moved.length} presets`));
  it('and the loop-wide box contains every frame of every preset', check(escaped.length === 0, escaped.join()));
}

