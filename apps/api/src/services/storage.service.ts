import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BUCKET, s3 } from '../config/aws.js';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Everything that touches S3. The rest of the app deals in project ids and JSON; only
 * this file knows the bucket layout, so changing it (versioning scheme, prefix, even the
 * provider) is one file's problem.
 *
 * Layout — versioned, so a bad save never destroys the previous good one:
 *   users/{userId}/projects/{projectId}/versions/{version}.json
 */
export const projectKey = (userId: string, projectId: string, version: number) =>
  `users/${userId}/projects/${projectId}/versions/${version}.json`;

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

export interface StoredObject { key: string; bucket: string; sizeBytes: number; checksum: string }

/** Serialize, size-check, and upload one project version. */
export async function putProjectJson(
  userId: string,
  projectId: string,
  version: number,
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

  const key = projectKey(userId, projectId, version);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    CacheControl: 'no-cache',
  }));

  return { key, bucket: BUCKET, sizeBytes, checksum: sha256(body) };
}

export async function getProjectJson(key: string): Promise<unknown> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const text = await res.Body?.transformToString();
    if (!text) throw new Error('empty object');
    return JSON.parse(text);
  } catch (e) {
    // a metadata row pointing at a missing/corrupt object is a server-side inconsistency,
    // not something the caller did wrong
    throw HttpError.upstream(`Could not read project data: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Best-effort cleanup. A failed delete must not fail the user's request — the metadata
 *  row is already gone, so the object is unreachable either way. */
export async function deleteProjectObjects(userId: string, projectId: string, upToVersion: number) {
  const keys = Array.from({ length: upToVersion }, (_, i) => projectKey(userId, projectId, i + 1));
  await Promise.allSettled(
    keys.map((Key) => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key }))),
  );
}

/**
 * A short-lived read URL, for the browser to fetch a large project directly instead of
 * streaming it through this server. The bucket itself stays private.
 */
export const presignedReadUrl = (key: string, expiresIn = 300) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
