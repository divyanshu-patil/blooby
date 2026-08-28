import { toJson } from '../utils/json.js';
import { splashscreensRepository } from '../repositories/splashscreens.repository.js';
import { HttpError } from '../utils/httpError.js';
import type { CreateSplashscreenDto, UpdateSplashscreenDto } from '../dtos/splashscreens/index.js';

/**
 * At most one splashscreen is live at a time; publishing a new one archives the old.
 * That invariant is enforced by a partial unique index in Postgres and executed as a
 * transaction in the repository, so it holds even if two admins publish at once.
 */
export const splashscreenService = {
  /** What every visitor's app boot asks for. Null is a perfectly normal answer. */
  active: () => splashscreensRepository.findPublished(),

  list: () => splashscreensRepository.listAll(),

  async get(id: string) {
    const row = await splashscreensRepository.findById(id);
    if (!row) throw HttpError.notFound('That splashscreen does not exist');
    return row;
  },

  create: (adminId: string, dto: CreateSplashscreenDto) =>
    splashscreensRepository.create({ ...dto, data: toJson(dto.data), createdBy: adminId }),

  async update(id: string, dto: UpdateSplashscreenDto) {
    await splashscreenService.get(id);
    const { data, ...rest } = dto;
    return splashscreensRepository.update(id, { ...rest, ...(data ? { data: toJson(data) } : {}) });
  },

  async publish(id: string) {
    await splashscreenService.get(id);
    return splashscreensRepository.publish(id);
  },

  async unpublish(id: string) {
    const row = await splashscreenService.get(id);
    if (row.status !== 'published') throw HttpError.conflict('That splashscreen is not currently live');
    return splashscreensRepository.update(id, { status: 'archived' });
  },

  async remove(id: string) {
    const row = await splashscreenService.get(id);
    // removing the live one would leave the app with no splash and no warning
    if (row.status === 'published') throw HttpError.conflict('Unpublish this splashscreen before deleting it');
    return splashscreensRepository.delete(id);
  },
};
