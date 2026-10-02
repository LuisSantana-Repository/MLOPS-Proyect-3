import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { env } from '../../config/env.js';

const s3Client = new S3Client({ region: env.AWS_REGION });

function getS3Bucket(): string {
  if (!env.S3_BUCKET) {
    throw new Error('S3_BUCKET es obligatoria para usar S3.');
  }
  return env.S3_BUCKET;
}

export async function ensureS3Bucket(): Promise<void> {
  await s3Client.send(new HeadBucketCommand({ Bucket: getS3Bucket() }));
}

export async function uploadS3Object(
  storageKey: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType,
    }),
  );
}

export async function deleteS3Object(storageKey: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: storageKey }));
}

export async function getS3ObjectStream(storageKey: string): Promise<Readable> {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: getS3Bucket(), Key: storageKey }),
  );

  if (!response.Body) {
    throw new Error(`S3 no devolvio contenido para ${storageKey}.`);
  }

  return response.Body as Readable;
}
