import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKET, s3 } from '../config/aws.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Everything that touches S3. The rest of the app deals in project ids and JSON; only
 * this file knows the bucket layout, so changing it (prefix, provider, anything) is one
 * file's problem.
 *
 * Layout — exactly one object per project, overwritten in place:
 *   users/{userId}/projects/{projectId}.json
 *
 * It used to keep every save as its own `versions/{n}.json`, which meant a project
 * autosaved for an afternoon left a hundred-odd objects behind and the bucket grew
 * without bound. `currentVersion` is still in Postgres and still does the job it actually
 * mattered for — the compare-and-set that stops two tabs overwriting each other — it just
 * no longer decides a key.
 *
 * What that costs, stated plainly: there is no longer an older copy to fall back on. S3
 * PutObject is atomic, so an interrupted or failed upload leaves the previous object
 * whole; what is gone is recovery from a save that *succeeded* with bad content.
 *
 * Objects are stored GZIPPED, with `Content-Encoding: gzip` on the object itself. Measured
 * on the real bucket, a project is 13-17% of its JSON size, so every save and every card
 * on the dashboard moves six or seven times less over the wire — and because the header
 * rides on the object, a browser fetching a presigned URL decompresses it without knowing
 * anything about this. Objects written before this are plain JSON and stay readable:
 * `decode` sniffs gzip's two magic bytes rather than trusting any metadata.
 */

/** gzip's magic number. Present ⇒ this object was written compressed. */
const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const decode = (b: Uint8Array) => (isGzip(b) ? gunzipSync(b) : Buffer.from(b)).toString('utf8');
export const projectKey = (userId: string, projectId: string) =>
  `users/${userId}/projects/${projectId}.json`;

/** Everything this project has ever written, including keys from the versioned era. */
const projectPrefix = (userId: string, projectId: string) => `users/${userId}/projects/${projectId}`;

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

export interface StoredObject { key: string; bucket: string; sizeBytes: number; checksum: string }

/** Serialize, size-check, and upload the project, replacing whatever was there. */
export async function putProjectJson(
  userId: string,
  projectId: string,
  project: unknown,
): Promise<StoredObject> {
  const body = JSON.stringify(project);
  const sizeBytes = Buffer.byteLength(body, 'utf8');

  // checked here rather than only at the body parser, because this is the limit that
  // actually matters — what we are about to persist
  if (sizeBytes > env.MAX_PROJECT_BYTES) {
    throw HttpError.payloadTooLarge(
      `This project is ${(sizeBytes / 1_048_576).toFixed(1)}MB, over the ${(env.MAX_PROJECT_BYTES / 1_048_576).toFixed(0)}MB limit.`,
    );
  }

  const key = projectKey(userId, projectId);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: gzipSync(body),
    ContentType: 'application/json',
    // on the object, so a presigned GET carries it and the browser inflates for free
    ContentEncoding: 'gzip',
    CacheControl: 'no-cache',
  }));

  // sizeBytes and the checksum describe the DOCUMENT, not its encoding: they are what the
  // limit is measured against and what the admin panel shows, and both must stay
  // comparable with every project stored before compression
  return { key, bucket: BUCKET, sizeBytes, checksum: sha256(body) };
}

export async function getProjectJson(key: string): Promise<unknown> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes?.length) throw new Error('empty object');
    return JSON.parse(decode(bytes));
  } catch (e) {
    // a metadata row pointing at a missing/corrupt object is a server-side inconsistency,
    // not something the caller did wrong
    throw HttpError.upstream(`Could not read project data: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Every object belonging to one project — the current one, plus anything left over from
 * when each save had its own key.
 *
 * Listed rather than reconstructed from a version count: a project saved 200 times and
 * then pruned has gaps, and guessing keys leaves orphans behind forever. Filtered to
 * `{id}.json` and `{id}/…` exactly, so a prefix can never reach a neighbouring project
 * (uuids are fixed-length, so this is belt and braces, but the belt is free).
 */
export async function listProjectObjects(userId: string, projectId: string): Promise<string[]> {
  const prefix = projectPrefix(userId, projectId);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) {
      if (o.Key === `${prefix}.json` || o.Key?.startsWith(`${prefix}/`)) keys.push(o.Key);
    }
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

/** Best-effort cleanup. A failed delete must not fail the user's request — the metadata
 *  row is already gone, so the object is unreachable either way. */
export async function deleteProjectObjects(userId: string, projectId: string, except?: string) {
  const keys = (await listProjectObjects(userId, projectId).catch(() => [])).filter((k) => k !== except);
  // DeleteObjects takes 1000 at a time, and a long-lived project from the versioned era
  // can exceed that on its own
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
    })).catch(() => {});
  }
  return keys.length;
}

/**
 * A short-lived read URL, for the browser to fetch a large project directly instead of
 * streaming it through this server. The bucket itself stays private.
 *
 * This is how a project's JSON reaches the browser now. Proxying it meant the API held a
 * median 320KB (up to 2.6MB) in memory per open project and spent a round trip to S3
 * inside a request that had already spent one on Postgres — forty times over on a
 * dashboard. The URL is minted with local crypto: no network, no DB, no per-card request.
 */
export const presignedReadUrl = (key: string, expiresIn = 300) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });

/**
 * An export an AI client made (a .lottie, a Lottie JSON, a PNG), under the person's own
 * prefix, with a one-hour download link — how "give me the Lottie" reaches the person.
 */
export async function putExport(userId: string, jobId: string, filename: string, body: Uint8Array | string, contentType: string) {
  const key = `users/${userId}/exports/${jobId}/${filename.replace(/[^\w.-]+/g, '-')}`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, ContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"` }));
  return { key, url: await presignedReadUrl(key, 3600) };
}
