/**
 * Mapa único de rutas del portal unificado (hallazgo P0-2): el portal de anotación y
 * calidad (Proyectos 1 y 2) y las cinco páginas del modelo (Proyecto 3) viven en la
 * misma aplicación Next.js y comparten el mismo menú.
 */
export interface PortalRoute {
  label: string;
  to: string;
}

/** Portal de anotación (Proyecto 1). */
// audit-ok: rutas del menú del portal, no datos
export const ANNOTATION_ROUTES: PortalRoute[] = [
  { label: "Tablero", to: "/dashboard" },
  { label: "Buscar", to: "/search" },
  { label: "Subir fotografías", to: "/upload" },
];

/** Calidad y versionado del dataset (Proyecto 2). */
// audit-ok: rutas del menú del portal, no datos
export const QUALITY_ROUTES: PortalRoute[] = [
  { label: "Resumen", to: "/overview" },
  { label: "Analizadores", to: "/analyzers" },
  { label: "Analítica", to: "/analytics" },
  { label: "Particiones", to: "/splits" },
  { label: "Versiones", to: "/versions" },
  { label: "Copilot", to: "/copilot" },
  { label: "Configuración", to: "/settings" },
];

/** Entrenamiento e inferencia del clasificador (Proyecto 3). */
// audit-ok: rutas del menú del portal, no datos
export const MODEL_ROUTES: PortalRoute[] = [
  { label: "Training", to: "/training" },
  { label: "Experiments", to: "/experiments" },
  { label: "Evaluation", to: "/evaluation" },
  { label: "Models", to: "/models" },
  { label: "Inference", to: "/inference" },
  { label: "Cola de anotación", to: "/annotation-queue" },
];

/** Pantalla completa de anotación: sin menú, con su propio botón "Volver". */
export const ANNOTATE_PREFIX = "/annotate";

const SPA_PATHS = [...ANNOTATION_ROUTES, ...QUALITY_ROUTES].map((route) => route.to);

/**
 * `true` si la ruta la dibuja la app del portal de anotación (que ya trae su propio
 * layout con el menú); `false` si es una página del modelo, a la que el shell le pone
 * el mismo menú alrededor.
 */
export function isAnnotationPortalPath(pathname: string): boolean {
  if (pathname === ANNOTATE_PREFIX || pathname.startsWith(`${ANNOTATE_PREFIX}/`)) return true;
  return SPA_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
