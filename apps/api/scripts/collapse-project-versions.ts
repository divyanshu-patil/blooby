/**
 * One-off: collapse every project in S3 down to a single object.
 *
 *   pnpm --filter @blooby/api collapse:versions          # dry run, changes nothing
 *   pnpm --filter @blooby/api collapse:versions -- --go  # actually do it
 *
 * Projects used to store every save as `versions/{n}.json`, so an afternoon of autosaving
 * left a hundred-odd objects behind. New saves write `projects/{id}.json`; this brings the
 * existing ones over and deletes the rest.
 *
 * Per project: copy whatever the row points at to the flat key, point the row there, then
 * delete everything else under the project's prefix. The row is updated BEFORE the delete,
 * so an interrupted run leaves a project readable from its new key rather than pointing at
 * something that has just been removed.
 */
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { BUCKET, s3 } from '../src/config/aws.js';
import { prisma } from '../src/config/prisma.js';
import { deleteProjectObjects, listProjectObjects, projectKey } from '../src/services/storage.service.js';

const go = process.argv.includes('--go');

const projects = await prisma.project.findMany({ select: { id: true, userId: true, name: true, s3Key: true } });
console.log(`${projects.length} projects · ${go ? 'APPLYING' : 'dry run, nothing will change'}\n`);

let objectsBefore = 0, objectsRemoved = 0, moved = 0, skipped = 0, failed = 0;

for (const p of projects) {
  const target = projectKey(p.userId, p.id);
  const keys = await listProjectObjects(p.userId, p.id);
  objectsBefore += keys.length;

  if (!keys.length) {
    console.log(`  ${p.name}: no objects at all — leaving the row alone`);
    skipped++;
    continue;
  }

  // the row's own key is the source of truth for "latest"; fall back to the
  // highest-numbered version only if the row points at something that is gone
  let source = p.s3Key;
  if (!keys.includes(source)) {
    source = [...keys].sort((a, b) => (Number(a.match(/(\d+)\.json$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.json$/)?.[1] ?? 0))).at(-1)!;
    console.log(`  ${p.name}: row pointed at a missing object, using ${source.split('/').pop()}`);
  }

  const extra = keys.filter((k) => k !== target).length;
  if (source === target && extra === 0) { skipped++; continue; }

  console.log(`  ${p.name}: ${keys.length} objects -> 1${source === target ? '' : `  (latest: ${source.split('/').pop()})`}`);
  if (!go) { objectsRemoved += extra; moved++; continue; }

  try {
    if (source !== target) {
      await s3.send(new CopyObjectCommand({
        Bucket: BUCKET, Key: target, CopySource: `${BUCKET}/${encodeURIComponent(source).replace(/%2F/g, '/')}`,
        ContentType: 'application/json', MetadataDirective: 'REPLACE', CacheControl: 'no-cache',
      }));
      // prove the copy landed before anything is deleted
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: target }));
      await prisma.project.update({ where: { id: p.id }, data: { s3Key: target } });
    }
    objectsRemoved += await deleteProjectObjects(p.userId, p.id, target);
    moved++;
  } catch (e) {
    failed++;
    console.error(`  ! ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n${objectsBefore} objects before · ${moved} projects collapsed · ${objectsRemoved} objects ${go ? 'deleted' : 'would be deleted'} · ${skipped} already fine${failed ? ` · ${failed} FAILED` : ''}`);
if (!go) console.log('\nNothing was changed. Re-run with -- --go to apply.');
await prisma.$disconnect();
