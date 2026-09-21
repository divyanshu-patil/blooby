/**
 * Puts the CORS rules on the project bucket.
 *
 *   pnpm --filter @blooby/api s3:cors            # show what is there, and what would change
 *   pnpm --filter @blooby/api s3:cors --apply    # write it
 *
 * WHY THE BUCKET NEEDS CORS AT ALL: the browser fetches a project's JSON straight from S3
 * through a presigned link, instead of it being proxied through this server (see
 * services/storage.service.ts). That took two round trips and a median 320KB out of every
 * card on the dashboard — and it means the bucket is answering a cross-origin request from
 * the app, which a bucket refuses by default with no `Access-Control-Allow-Origin` header.
 *
 * This is the one piece of that change that is not in the code, which is why it is a
 * committed script rather than a note: a new bucket is broken until it runs.
 *
 * CORS IS NOT THE ACCESS CONTROL HERE. The presigned signature is — it names one object
 * and expires. CORS only decides which page a BROWSER will hand the response to, so
 * listing an origin grants nothing to anyone who does not already hold a valid link that
 * only this server, authenticated, hands out. That is why a preview wildcard is safe.
 */
import { GetBucketCorsCommand, PutBucketCorsCommand, type CORSRule } from '@aws-sdk/client-s3';
import { BUCKET, s3 } from '../src/config/aws.js';
import { env } from '../src/config/env.js';

/**
 * Where the app runs. APP_URL and ADMIN_URL are already this server's own CORS allowlist,
 * so the bucket's and the API's cannot drift; S3_CORS_ORIGINS adds anything else — preview
 * deployments, a second domain — as a comma-separated list.
 */
const origins = [
  ...env.corsOrigins,
  ...(process.env.S3_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
];

const rules: CORSRule[] = [{
  ID: 'blooby-project-json',
  AllowedOrigins: [...new Set(origins)],
  // Read only. Uploads still go through the API, which is where the size limit and the
  // ownership check live — a browser must never be able to PUT into this bucket.
  AllowedMethods: ['GET', 'HEAD'],
  AllowedHeaders: ['*'],
  // the object is stored gzipped and the browser inflates it; nothing else is read back
  ExposeHeaders: ['Content-Length', 'Content-Type', 'Content-Encoding', 'ETag'],
  MaxAgeSeconds: 3000,
}];

const current = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }))
  .then((r) => r.CORSRules ?? [])
  .catch((e: { name?: string }) => {
    if (e.name === 'NoSuchCORSConfiguration') return [];
    throw e;
  });

console.log(`bucket   ${BUCKET} (${env.AWS_REGION})`);
console.log(`current  ${current.length ? JSON.stringify(current) : '— none, so every browser fetch of a project fails'}`);
console.log(`proposed ${JSON.stringify(rules)}`);

if (!origins.length) {
  throw new Error('No origins. Set APP_URL / ADMIN_URL, or S3_CORS_ORIGINS, before applying.');
}

if (!process.argv.includes('--apply')) {
  console.log('\nnothing written — re-run with --apply');
  process.exit(0);
}

await s3.send(new PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: { CORSRules: rules } }));
console.log('\napplied.');
