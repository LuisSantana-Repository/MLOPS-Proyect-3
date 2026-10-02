import type { Readable } from 'node:stream';

import { env } from '../../config/env.js';

export async function ensureObjectBucket(): Promise<void> {
  if (env.STORAGE_PROVIDER === 's3') {
    const storage = await import('./s3.storage.js');
    await storage.ensureS3Bucket();
    return;
  }

  const storage = await import('./minio.storage.js');
  await storage.ensureMinioBucket();
}

export async function uploadImageObject(
  storageKey: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  if (env.STORAGE_PROVIDER === 's3') {
    const storage = await import('./s3.storage.js');
    await storage.uploadS3Object(storageKey, buffer, mimeType);
    return;
  }

  const storage = await import('./minio.storage.js');
  await storage.uploadImageObject(storageKey, buffer, mimeType);
}

export async function deleteImageObject(storageKey: string): Promise<void> {
  if (env.STORAGE_PROVIDER === 's3') {
    const storage = await import('./s3.storage.js');
    await storage.deleteS3Object(storageKey);
    return;
  }

  const storage = await import('./minio.storage.js');
  await storage.deleteImageObject(storageKey);
}

export async function getImageObjectStream(storageKey: string): Promise<Readable> {
  if (env.STORAGE_PROVIDER === 's3') {
    const storage = await import('./s3.storage.js');
    return storage.getS3ObjectStream(storageKey);
  }

  const storage = await import('./minio.storage.js');
  return storage.getImageObjectStream(storageKey);
}
