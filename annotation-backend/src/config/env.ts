import 'dotenv/config';
import { z } from 'zod';
import { DEFAULT_QUALITY_ARTIFACTS_DIR, DEFAULT_QUALITY_CONFIG_PATH } from './quality-paths.js';

const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/**
 * Valida las variables de entorno usadas por la aplicación.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().min(1).optional(),

    DB_HOST: z.string().min(1).optional(),

    DB_PORT: z.coerce.number().int().positive().default(3306),

    DB_USER: z.string().min(1).optional(),

    DB_PASSWORD: z.string().min(1).optional(),

    DB_NAME: z.string().min(1).optional(),

    DB_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    DB_SSL_CA_PATH: z.string().min(1).default('/etc/ssl/certs/aws-rds-global-bundle.pem'),

    STORAGE_PROVIDER: z.enum(['minio', 's3']).default('minio'),

    MINIO_ENDPOINT: z.string().min(1).optional(),

    MINIO_PORT: z.coerce.number().int().positive().default(9000),

    MINIO_USE_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    MINIO_ACCESS_KEY: z.string().min(1).optional(),

    MINIO_SECRET_KEY: z.string().min(1).optional(),

    MINIO_BUCKET: z.string().min(3).optional(),

    AWS_REGION: z.string().min(1).default('us-east-2'),

    S3_BUCKET: z.string().min(3).optional(),

    MAX_UPLOAD_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),

    // Artefactos del pipeline de calidad (Frente 3). El portal solo los lee.
    QUALITY_ARTIFACTS_DIR: z.string().min(1).default(DEFAULT_QUALITY_ARTIFACTS_DIR),

    // Política de calidad que la pantalla Settings puede editar.
    QUALITY_CONFIG_PATH: z.string().min(1).default(DEFAULT_QUALITY_CONFIG_PATH),

    // Copilot: proveedor de LLM opcional. La API key nunca se versiona; si
    // falta, el Copilot responde en modo anclado a las herramientas.
    COPILOT_PROVIDER: z.enum(['none', 'anthropic', 'mistral']).default('none'),
    // Vacío significa "sin configurar": .env.example los trae vacíos a propósito.
    COPILOT_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    COPILOT_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .superRefine((value, context) => {
    if (!value.DATABASE_URL) {
      for (const field of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const) {
        if (!value[field]) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} es obligatoria cuando DATABASE_URL no está definida.`,
          });
        }
      }
    }

    if (value.STORAGE_PROVIDER === 'minio') {
      for (const field of [
        'MINIO_ENDPOINT',
        'MINIO_ACCESS_KEY',
        'MINIO_SECRET_KEY',
        'MINIO_BUCKET',
      ] as const) {
        if (!value[field]) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} es obligatoria cuando STORAGE_PROVIDER=minio.`,
          });
        }
      }
    }

    if (value.STORAGE_PROVIDER === 's3' && !value.S3_BUCKET) {
      context.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET es obligatoria cuando STORAGE_PROVIDER=s3.',
      });
    }
  });

/**
 * Variables ya validadas y tipadas.
 * Si alguna configuración requerida falta, la aplicación falla al iniciar.
 */
export const env = envSchema.parse(process.env);
