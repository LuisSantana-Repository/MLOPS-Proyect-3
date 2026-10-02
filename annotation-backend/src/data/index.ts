/**
 * Punto de entrada de la capa DATA.
 *
 * Maneja el acceso a MariaDB y al almacenamiento de archivos en MinIO.
 * Solo la capa Logic debe importar desde aquí.
 */
export { db, pool } from './db/client.js';
export type { Annotation, Category, Image } from './db/schema.js';
export * as schema from './db/schema.js';
export type { AnnotationWithCategory } from './repositories/annotation.repository.js';
export {
  countAnnotationsByImage,
  createAnnotationRow,
  deleteAnnotationRow,
  findAllAnnotationRows,
  findAnnotationById,
  listAnnotationsByImage,
  updateAnnotationRow,
} from './repositories/annotation.repository.js';
export { listCategories } from './repositories/category.repository.js';
export type {
  ClassSearch,
  FindImagesOptions,
  FindImagesResult,
} from './repositories/image.repository.js';
export {
  countAllAnnotations,
  countAllCategories,
  countAnnotationsByCategory,
  countAnnotationsForImages,
  countImagesByStatus,
  createImageMetadata,
  deleteImageRow,
  findAllImages,
  findCategoriesForImages,
  findImageById,
  findImages,
  findRecentImages,
  updateImageStatus,
} from './repositories/image.repository.js';
// Funciones de almacenamiento seleccionadas por ambiente (MinIO DEV o S3 PROD).
export {
  deleteImageObject,
  ensureObjectBucket,
  getImageObjectStream,
  uploadImageObject,
} from './storage/object.storage.js';
