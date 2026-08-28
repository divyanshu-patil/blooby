import type { AssetSource, Prisma, UserRole } from '@prisma/client';
import { toJson } from '../utils/json.js';
import { assetsRepository } from '../repositories/assets.repository.js';
import { HttpError } from '../utils/httpError.js';
import type { CreateAssetDto, ListAssetsDto, ModerateAssetDto, SubmitToCommunityDto, UpdateAssetDto } from '../dtos/assets/index.js';

/**
 * One service for presets and expressions, every source.
 *
 * What differs between "my custom preset", "an official preset" and "a community preset"
 * is `source` + `status` + `ownerId` — not the storage, not the validation, not the
 * browse query. Role decides which transitions a caller may request; it does not fork
 * the implementation. (spec §19, §36)
 */

async function ownedBy(assetId: string, userId: string) {
  const asset = await assetsRepository.findById(assetId);
  if (!asset) throw HttpError.notFound('That item does not exist');
  if (asset.ownerId !== userId) throw HttpError.notFound('That item does not exist');
  return asset;
}

/** What an anonymous or ordinary caller is allowed to see in a browse listing. */
function browseFilter(dto: ListAssetsDto, viewerId: string | null): Prisma.AssetWhereInput {
  const visible: Prisma.AssetWhereInput[] = [{ status: 'published' }];
  // your own drafts show up in your own library, but never in anyone else's browse
  if (viewerId && dto.source === 'user') visible.push({ ownerId: viewerId });

  return {
    OR: visible,
    ...(dto.kind ? { kind: dto.kind } : {}),
    ...(dto.source ? { source: dto.source } : {}),
    ...(dto.category ? { category: dto.category } : {}),
    ...(dto.tag ? { tags: { has: dto.tag } } : {}),
    ...(dto.q ? { name: { contains: dto.q, mode: 'insensitive' } } : {}),
  };
}

export const assetsService = {
  browse: (dto: ListAssetsDto, viewerId: string | null) =>
    assetsRepository.list(browseFilter(dto, viewerId), dto),

  /** The signed-in user's own library, whatever its status. */
  mine: (userId: string, dto: ListAssetsDto) =>
    assetsRepository.list(
      {
        ownerId: userId,
        ...(dto.kind ? { kind: dto.kind } : {}),
        ...(dto.q ? { name: { contains: dto.q, mode: 'insensitive' } } : {}),
      },
      dto,
    ),

  async get(assetId: string, viewerId: string | null, role: UserRole) {
    const asset = await assetsRepository.findById(assetId);
    if (!asset) throw HttpError.notFound('That item does not exist');
    const maySee = asset.status === 'published' || asset.ownerId === viewerId || role === 'admin';
    if (!maySee) throw HttpError.notFound('That item does not exist');
    return asset;
  },

  /**
   * Create. `source` is derived from the caller's role, never accepted from the request —
   * that is what stops a user from posting `source: "official"` and appearing alongside
   * curated content.
   */
  create(userId: string, role: UserRole, dto: CreateAssetDto, asOfficial = false) {
    if (asOfficial && role !== 'admin') throw HttpError.forbidden('Only administrators can publish official content');
    const source: AssetSource = asOfficial ? 'official' : 'user';

    return assetsRepository.create({
      ...dto,
      source,
      ownerId: userId,
      // official content is curated at the point of creation, so it goes straight live;
      // a user's own item starts private to them
      status: asOfficial ? 'published' : 'draft',
      publishedAt: asOfficial ? new Date() : null,
      data: toJson(dto.data),
    });
  },

  async update(assetId: string, userId: string, role: UserRole, dto: UpdateAssetDto) {
    const asset = role === 'admin'
      ? await assetsRepository.findById(assetId).then((a) => a ?? Promise.reject(HttpError.notFound('That item does not exist')))
      : await ownedBy(assetId, userId);

    // editing a published community item sends it back for review, so a benign listing
    // cannot be swapped for something else after approval
    const backToReview = asset.source === 'community' && asset.status === 'published' && role !== 'admin' && dto.data !== undefined;

    const { data, ...rest } = dto;
    return assetsRepository.update(assetId, {
      ...rest,
      ...(data ? { data: toJson(data), version: { increment: 1 } } : {}),
      ...(backToReview ? { status: 'pending_review', publishedAt: null } : {}),
    });
  },

  async remove(assetId: string, userId: string, role: UserRole) {
    if (role !== 'admin') await ownedBy(assetId, userId);
    return assetsRepository.delete(assetId);
  },

  /**
   * Submit a personal item to the community. Goes to pending_review, never straight to
   * published — moderation is the whole reason this queue exists.
   */
  async submitToCommunity(assetId: string, userId: string, dto: SubmitToCommunityDto) {
    const asset = await ownedBy(assetId, userId);
    if (asset.status === 'pending_review') throw HttpError.conflict('This is already awaiting review');
    if (asset.source === 'community' && asset.status === 'published') throw HttpError.conflict('This is already published to the community');

    return assetsRepository.update(assetId, {
      ...dto,
      source: 'community',
      status: 'pending_review',
      reviewNote: null,
      reviewedAt: null,
      reviewedBy: null,
    });
  },

  /** Admin moderation. Statuses, not deletion, so the history stays inspectable. */
  async moderate(assetId: string, adminId: string, dto: ModerateAssetDto) {
    const asset = await assetsRepository.findById(assetId);
    if (!asset) throw HttpError.notFound('That item does not exist');

    const common = { reviewedBy: adminId, reviewedAt: new Date() };
    switch (dto.action) {
      case 'approve':
        return assetsRepository.update(assetId, { ...common, status: 'published', publishedAt: new Date(), reviewNote: null });
      case 'reject':
        return assetsRepository.update(assetId, { ...common, status: 'rejected', reviewNote: dto.reason, publishedAt: null });
      case 'unpublish':
        return assetsRepository.update(assetId, { ...common, status: 'draft', publishedAt: null });
      case 'archive':
        return assetsRepository.update(assetId, { ...common, status: 'archived', publishedAt: null });
    }
  },

  /** Counted when an item is actually pulled into a project — the number that answers
   *  "which presets do people really use". */
  use: (assetId: string) => assetsRepository.incrementDownloads(assetId),
};
