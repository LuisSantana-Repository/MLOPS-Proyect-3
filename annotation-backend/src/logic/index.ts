/**
 * Punto de entrada de la capa LOGIC.
 *
 * Responsabilidad: reglas de negocio, validaciones y (en fases
 * posteriores) procesamiento de imágenes/anotaciones.
 *
 * Regla de arquitectura: es la única capa que puede importar de `data`.
 * No debe contener código específico de UI (Express, HTTP, etc.).
 */

export type { AnnotationBoxInput } from './annotation.service.js';
export {
  createAnnotationForImage,
  deleteAnnotation,
  getAnnotationsForImage,
  updateAnnotation,
} from './annotation.service.js';
// Esquemas de la frontera HTTP (SPEC-VALID-001): la UI los usa para validar
// route params y query params antes de invocar a los servicios de arriba.
export type { ImageSearchInput } from './annotation.validation.js';
export { idParamSchema, imageSearchSchema } from './annotation.validation.js';
export { getCategories } from './category.service.js';
// Exportación COCO (SPEC-COCO-001)
export type {
  CocoAnnotation,
  CocoCategory,
  CocoDataset,
  CocoImage,
  CocoSourceData,
} from './coco-export.builder.js';
export { buildCocoDataset } from './coco-export.builder.js';
export { exportCocoDataset } from './coco-export.service.js';
// Frente 3 — Dataset Copilot y MCP (SPEC-COPILOT-001..004)
export type {
  CopilotAnswer,
  CopilotProvider,
  CopilotToolCall,
} from './copilot/copilot.service.js';
export { askCopilot, selectToolsForQuestion } from './copilot/copilot.service.js';
export { buildProvider } from './copilot/provider.js';
export type { CopilotTool, ToolOutput } from './copilot/tools.js';
export { buildQualityTools } from './copilot/tools.js';
// Dashboard (SPEC-DASH-001)
export type {
  AnnotationProgress,
  DashboardSourceData,
  DashboardSummary,
  ObjectPerClass,
  RecentUpload,
} from './dashboard.builder.js';
export { buildDashboardSummary, buildThumbnailUrl } from './dashboard.builder.js';
export { getDashboardSummary } from './dashboard.service.js';
// Errores tipados: la capa UI los mapea a códigos HTTP (SPEC-VALID-001).
export { NotFoundError, ValidationError } from './errors.js';
export type { HealthStatus } from './health.service.js';
export { checkHealth } from './health.service.js';
export type { ImageFile } from './image-file.service.js';
export { getImageFile } from './image-file.service.js';
export type {
  ImageSearchItem,
  SearchImagesInput,
  SearchImagesResult,
  SearchResultCategory,
} from './image-search.service.js';
export { searchImages } from './image-search.service.js';
export { setImageStatus } from './image-status.service.js';
export { deleteImage, uploadImage } from './image-upload.service.js';
export type {
  AnalyzersBundle,
  CategoryRef,
  CheckConfig,
  CheckResult,
  CheckStatus,
  ClassCountComparison,
  DatasetTotals,
  EmbeddingBundle,
  EmbeddingPoint,
  LeakageReport,
  QualityConfig,
  QualityGate,
  ReannotationQueueItem,
  ReleaseBundle,
  Severity,
  SplitConfig,
  SplitDistribution,
  VersionEntry,
  VersionsFile,
} from './quality/contracts.js';
export {
  parseEmbeddings,
  parseQualityConfig,
  parseReleaseBundle,
  parseVersions,
} from './quality/contracts.js';
// Frente 3 — artefactos del pipeline de calidad (SPEC-QUALITY-API-001..007)
export type {
  AnalyzersView,
  EmbeddingsView,
  GateSummary,
  OverviewView,
  SplitsView,
  VersionDiff,
} from './quality/quality.service.js';
export {
  buildAnalyzers,
  buildEmbeddingsView,
  buildOverview,
  buildSplits,
  diffVersions,
} from './quality/quality.service.js';
export {
  getAnalyzers,
  getEmbeddings,
  getOverview,
  getReannotationQueue,
  getSplits,
  getVersionDiff,
  getVersions,
} from './quality/quality-artifacts.service.js';
export {
  getQualitySettings,
  updateQualitySettings,
} from './quality/quality-settings.service.js';
// Parser de operadores de búsqueda (SPEC-SEARCH-001)
export type { ParsedSearchQuery, SearchOperator } from './search-query.parser.js';
export { parseSearchQuery } from './search-query.parser.js';
export { initializeApplication } from './startup.service.js';
