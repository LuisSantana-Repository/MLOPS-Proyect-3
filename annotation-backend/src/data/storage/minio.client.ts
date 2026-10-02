import * as Minio from 'minio';

import { env } from '../../config/env.js';

function requiredMinioValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} es obligatoria para usar MinIO.`);
  }
  return value;
}

/**
 * Cliente de MinIO configurado desde variables de entorno.
 */
export const minioClient = new Minio.Client({
  endPoint: requiredMinioValue('MINIO_ENDPOINT', env.MINIO_ENDPOINT),
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: requiredMinioValue('MINIO_ACCESS_KEY', env.MINIO_ACCESS_KEY),
  secretKey: requiredMinioValue('MINIO_SECRET_KEY', env.MINIO_SECRET_KEY),
});

// Bucket donde se almacenan las imágenes.
export const minioBucket = requiredMinioValue('MINIO_BUCKET', env.MINIO_BUCKET);
