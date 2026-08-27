import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

/**
 * The bucket is never public. Clients never talk to S3 directly with these credentials;
 * they either go through this server or use a short-lived presigned URL it mints, so the
 * IAM user's keys stay server-side and its policy stays scoped to this one bucket.
 */
export const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = env.AWS_S3_BUCKET;
