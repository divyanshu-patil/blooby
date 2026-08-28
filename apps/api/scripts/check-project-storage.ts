/**
 * One object per project, checked against the real bucket.
 *
 *   pnpm --filter @blooby/api check:storage
 *
 * Not part of `pnpm check`: that one is offline and deterministic, and this needs AWS and
 * a database. It exists because "saves overwrite instead of accumulating" is invisible
 * from inside the app — the old versioned layout worked perfectly from the user's side
 * while quietly leaving 149 objects behind for one project.
 *
 * Creates a throwaway project, saves it five times, and deletes it. Asserts the bucket
 * ends where it started.
 */
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { BUCKET, s3 } from '../src/config/aws.js';
import { prisma } from '../src/config/prisma.js';
import { projectsService } from '../src/services/projects.service.js';
import { listProjectObjects } from '../src/services/storage.service.js';

let bad = 0;
const ok = (l: string, c: boolean, d = '') => { if (!c) { bad++; console.error('FAIL', l, d); } };
const total = async () => {
  let t: string | undefined, n = 0;
  do { const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'users/', ContinuationToken: t })); n += r.KeyCount ?? 0; t = r.NextContinuationToken; } while (t);
  return n;
};

const before = await total();
const me = (await prisma.project.findFirst({ select: { userId: true } }))!.userId;

const p = await projectsService.create(me, { name: 'zz-storage-probe', project: { hello: 1 } } as never);
ok('create writes exactly one object', (await listProjectObjects(me, p.id)).length === 1);
ok('and the key is flat, not versioned', p.s3Key.endsWith(`${p.id}.json`), p.s3Key);

let version = p.currentVersion;
for (let i = 0; i < 5; i++) {
  const r = await projectsService.save(p.id, me, { project: { hello: 1, i }, expectedVersion: version } as never);
  version = r.version;
}
ok('five saves still leave one object', (await listProjectObjects(me, p.id)).length === 1);
ok('while currentVersion still counts them', version === p.currentVersion + 5, String(version));

const { data } = await projectsService.getData(p.id, me);
ok('and the object holds the newest content', (data as { i: number }).i === 4, JSON.stringify(data));

// the concurrency guard must survive losing the versioned keys
let conflicted = false;
try { await projectsService.save(p.id, me, { project: {}, expectedVersion: version - 1 } as never); }
catch { conflicted = true; }
ok('a stale expectedVersion is still refused', conflicted);

await projectsService.remove(p.id, me);
ok('remove takes the object with it', (await listProjectObjects(me, p.id)).length === 0);
ok('and the bucket is back where it started', (await total()) === before, `${await total()} vs ${before}`);

console.log(bad === 0 ? 'storage roundtrip: all checks passed' : `storage roundtrip: ${bad} FAILED`);
await prisma.$disconnect();
