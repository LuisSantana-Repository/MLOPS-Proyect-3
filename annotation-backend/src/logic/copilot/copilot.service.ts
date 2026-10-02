import type { CopilotTool, ToolOutput } from './tools.js';

/**
 * SPEC-COPILOT-002 — Dataset Copilot.
 *
 * El agente decide qué herramientas de solo lectura invocar, las ejecuta y
 * redacta la respuesta. Si hay un proveedor de LLM configurado, lo usa para
 * redactar citando los resultados; si no hay proveedor o el proveedor falla,
 * cae al modo "anclado": una respuesta determinista construida únicamente
 * con las cifras que devolvieron las tools. Nunca inventa un número.
 */

export interface CopilotToolCall extends ToolOutput {
  name: string;
  arguments: Record<string, unknown>;
}

export interface CopilotProvider {
  name: string;
  complete: (input: {
    question: string;
    toolResults: CopilotToolCall[];
    datasetVersion: string | null;
  }) => Promise<string>;
}

export interface CopilotAnswer {
  question: string;
  answer: string;
  grounded: boolean;
  datasetVersion: string | null;
  toolsUsed: string[];
  toolCalls: CopilotToolCall[];
  provider: string;
}

interface RouteRule {
  patterns: RegExp;
  tool: string;
}

const ROUTES: RouteRule[] = [
  { patterns: /peque[nñ]|small/i, tool: 'get_small_objects' },
  { patterns: /duplicad|near|pHash/i, tool: 'get_duplicates' },
  { patterns: /inv[aá]lid|degenerad/i, tool: 'get_invalid_boxes' },
  { patterns: /reanot|cola|corregir/i, tool: 'get_reannotation_queue' },
  { patterns: /split|partici|fuga|leakage|semilla|seed/i, tool: 'get_splits' },
  { patterns: /versi[oó]n|versiones|release|dev|prod/i, tool: 'get_versions' },
  {
    patterns: /balance|desbalance|ratio|distribuci[oó]n|por clase|clases/i,
    tool: 'get_class_distribution',
  },
  {
    // `cajas` sin más es del resumen; "cajas inválidas" ya tiene su propia herramienta
    // y no debe arrastrar también las cifras generales.
    patterns:
      /resumen|total|im[aá]genes|cajas(?!\s+inv[aá]lid)|categor[ií]as|gate|compuerta|estado/i,
    tool: 'get_dataset_overview',
  },
];

export const COPILOT_OUT_OF_SCOPE =
  'No tengo una herramienta para responder eso con el dataset. Puedo hablar de imágenes, ' +
  'clases, objetos pequeños, duplicados, cajas inválidas, splits, versiones y de la cola ' +
  'de reanotación.';

export function selectToolsForQuestion(question: string): string[] {
  const matched = ROUTES.filter((route) => route.patterns.test(question)).map(
    (route) => route.tool,
  );
  return [...new Set(matched)];
}

interface OverviewData {
  totals: { images: number; annotations: number; categories: number };
  gate: { overallStatus: string; failCount: number; warnCount: number; passCount: number };
}

interface ClassDistributionData {
  classImbalance: {
    distributions: Array<{ category_id: number; distinct_image_count: number }>;
    ratio: number | null;
  };
}

interface SmallObjectsData {
  small_count: number;
  total_annotations: number;
  small_percent: number;
  threshold_px: number;
}

interface DuplicatesData {
  duplicate_groups: number[][];
  pairs: unknown[];
}

interface InvalidBoxesData {
  invalid_count: number;
  total_annotations: number;
}

interface SplitsData {
  seed: number;
  distribution: Array<{ split: string; total_images: number }>;
  leakage: { cross_split_duplicate_pairs: number; id_intersection_size: number };
}

interface VersionsData {
  versions: Array<{ version: string }>;
}

interface DiffData {
  from: string;
  to: string;
  imagesAdded: number;
  annotationsAdded: number;
  classesThatLeftMinimum: number[];
}

function summarize(call: CopilotToolCall): string {
  switch (call.name) {
    case 'get_dataset_overview': {
      const data = call.data as OverviewData;
      return `El dataset ${call.datasetVersion ?? ''} tiene ${data.totals.images} imágenes, ${data.totals.annotations} cajas y ${data.totals.categories} categorías. La compuerta está en estado ${data.gate.overallStatus} (${data.gate.failCount} fail, ${data.gate.warnCount} warn, ${data.gate.passCount} pass).`;
    }
    case 'get_class_distribution': {
      const data = call.data as ClassDistributionData;
      const perClass = data.classImbalance.distributions
        .map((row) => `#${row.category_id}: ${row.distinct_image_count} imágenes`)
        .join('; ');
      return `Distribución por clase: ${perClass}. Ratio mayoritaria/minoritaria: ${data.classImbalance.ratio ?? '—'}.`;
    }
    case 'get_small_objects': {
      const data = call.data as SmallObjectsData;
      return `${data.small_count} de ${data.total_annotations} objetos (${data.small_percent.toFixed(2)}%) están por debajo de ${data.threshold_px}px.`;
    }
    case 'get_duplicates': {
      const data = call.data as DuplicatesData;
      return `Hay ${data.duplicate_groups.length} grupos de duplicados (${data.pairs.length} pares).`;
    }
    case 'get_invalid_boxes': {
      const data = call.data as InvalidBoxesData;
      return `Hay ${data.invalid_count} cajas inválidas de ${data.total_annotations} anotaciones.`;
    }
    case 'get_splits': {
      const data = call.data as SplitsData;
      const distribution = data.distribution
        .map((row) => `${row.split} ${row.total_images}`)
        .join(', ');
      return `Splits con seed ${data.seed}: ${distribution}. Fuga: ${data.leakage.cross_split_duplicate_pairs} pares cruzados, intersección de IDs ${data.leakage.id_intersection_size}.`;
    }
    case 'get_versions': {
      const data = call.data as VersionsData;
      return `Hay ${data.versions.length} versiones: ${data.versions.map((entry) => entry.version).join(', ')}.`;
    }
    case 'compare_versions': {
      const data = call.data as DiffData;
      const left = data.classesThatLeftMinimum.length
        ? data.classesThatLeftMinimum.map((id) => `#${id}`).join(', ')
        : 'ninguna';
      return `Entre ${data.from} y ${data.to} se añadieron ${data.imagesAdded} imágenes y ${data.annotationsAdded} cajas; clases que salieron del mínimo: ${left}.`;
    }
    case 'get_reannotation_queue': {
      const data = call.data as unknown[];
      return `La cola de reanotación tiene ${Array.isArray(data) ? data.length : 0} muestras.`;
    }
    default:
      return `Resultado de ${call.name}.`;
  }
}

export async function askCopilot(
  question: string,
  tools: CopilotTool[],
  provider?: CopilotProvider,
): Promise<CopilotAnswer> {
  const toolNames = selectToolsForQuestion(question);

  if (toolNames.length === 0) {
    return {
      question,
      answer: COPILOT_OUT_OF_SCOPE,
      grounded: false,
      datasetVersion: null,
      toolsUsed: [],
      toolCalls: [],
      provider: provider?.name ?? 'none',
    };
  }

  const toolCalls: CopilotToolCall[] = [];
  const unavailable: string[] = [];

  for (const name of toolNames) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) {
      unavailable.push(name);
      continue;
    }
    try {
      const output = await tool.run({});
      toolCalls.push({ name: tool.name, arguments: {}, ...output });
    } catch {
      // Falta el artefacto o el contrato no cuadra: no tumbamos toda la
      // respuesta; seguimos con lo que sí esté disponible.
      unavailable.push(name);
    }
  }

  const providerName = provider?.name ?? 'none';

  if (toolCalls.length === 0) {
    return {
      question,
      answer: `No pude consultar el dataset porque faltan los artefactos de calidad (${unavailable.join(', ')}). Ejecuta el pipeline de calidad y vuelve a intentar.`,
      grounded: false,
      datasetVersion: null,
      toolsUsed: [],
      toolCalls: [],
      provider: providerName,
    };
  }

  const datasetVersion =
    toolCalls.map((call) => call.datasetVersion).find((value) => value !== null) ?? null;
  let answer = toolCalls.map(summarize).join(' ');

  if (provider) {
    try {
      answer = await provider.complete({ question, toolResults: toolCalls, datasetVersion });
    } catch {
      // El proveedor cayó: se responde en modo anclado, sin exponer el error.
    }
  }

  if (unavailable.length > 0) {
    answer = `${answer} (No pude consultar: ${unavailable.join(', ')}.)`;
  }

  return {
    question,
    answer,
    grounded: true,
    datasetVersion,
    toolsUsed: toolCalls.map((call) => call.name),
    toolCalls,
    provider: providerName,
  };
}
