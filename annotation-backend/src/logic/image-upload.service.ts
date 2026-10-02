import { randomUUID } from 'node:crypto';

import sharp, { type Metadata } from 'sharp';

import { env } from '../config/env.js';
import {
  createImageMetadata,
  deleteImageObject,
  deleteImageRow,
  findImageById,
  uploadImageObject,
} from '../data/index.js';

import { NotFoundError, ValidationError } from './errors.js';
import { type ModelSuggestion, readModelSuggestion } from './image-suggestion.js';
import { validateImageUpload } from './image-upload.validation.js';

export interface UploadImageInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  /** Sugerencia del clasificador (solo cuando llega desde Inference). */
  suggestion?: ModelSuggestion | null;
}

export interface UploadImageResult {
  id: number;
  filename: string;
  storageKey: string;
  width: number;
  height: number;
  /** Toda imagen nueva entra al flujo de anotación como pendiente. */
  status: 'pending';
  suggestion: ModelSuggestion | null;
}

/**
 * Valida y guarda una imagen en el proveedor activo y sus metadatos en MariaDB.
 */
export async function uploadImage(input: UploadImageInput): Promise<UploadImageResult> {
  // Valida tipo MIME y tamaño.
  const validation = validateImageUpload(
    {
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    },
    env.MAX_UPLOAD_SIZE_BYTES,
  );

  if (!validation.success) {
    throw new ValidationError('La imagen no cumple con los requisitos de carga.');
  }

  // Sharp verifica que el contenido sea realmente una imagen.
  // Un buffer corrupto o con extensión falseada falla aquí.
  let metadata: Metadata;
  try {
    metadata = await sharp(input.buffer).metadata();
  } catch {
    throw new ValidationError('El archivo no es una imagen válida.');
  }

  if (!metadata.width || !metadata.height) {
    throw new ValidationError('No se pudieron obtener las dimensiones de la imagen.');
  }

  const suggestion = input.suggestion ?? null;

  // Genera una key única para evitar colisiones en el almacenamiento de objetos.
  const storageKey = `images/${randomUUID()}`;

  // Primero guarda el archivo real en el proveedor activo.
  await uploadImageObject(storageKey, input.buffer, input.mimeType);

  try {
    // Después registra los metadatos en MariaDB.
    const id = await createImageMetadata({
      filename: input.filename,
      storageKey,
      mimeType: input.mimeType,
      width: metadata.width,
      height: metadata.height,
      sizeBytes: input.sizeBytes,
      suggestedCategory: suggestion?.category ?? null,
      suggestedProbabilities: suggestion ? JSON.stringify(suggestion.probabilities) : null,
      suggestedModelVersion: suggestion?.modelVersion ?? null,
    });

    return {
      id,
      filename: input.filename,
      storageKey,
      width: metadata.width,
      height: metadata.height,
      status: 'pending',
      suggestion,
    };
  } catch (error) {
    // Si MariaDB falla, elimina el objeto para no dejar basura.
    await deleteImageObject(storageKey).catch(() => undefined);

    throw error;
  }
}

/** Metadatos de una imagen con la sugerencia del modelo, si la tiene. */
export async function getImageDetail(imageId: number) {
  const image = await findImageById(imageId);
  if (!image) {
    throw new NotFoundError('La imagen no existe.');
  }

  return { ...image, suggestion: readModelSuggestion(image) };
}

/**
 * Borra una imagen: su registro en MariaDB (con sus anotaciones, en
 * cascada) y su archivo real en el proveedor activo.
 */
export async function deleteImage(imageId: number): Promise<void> {
  const image = await findImageById(imageId);
  if (!image) {
    throw new NotFoundError('La imagen no existe.');
  }

  // Se borra primero la fila: si falla el binario, no queda un registro
  // apuntando a un archivo inexistente.
  await deleteImageRow(imageId);
  await deleteImageObject(image.storageKey).catch(() => undefined);
}
