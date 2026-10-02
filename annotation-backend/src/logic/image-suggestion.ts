import { z } from 'zod';

import { ValidationError } from './errors.js';

/**
 * Sugerencia del clasificador para una imagen enviada desde la página Inference
 * del portal: la clase que predijo el modelo, las probabilidades por clase y la
 * versión del modelo. Es metadato de ayuda para el anotador: la imagen entra al
 * flujo normal de anotación en estado `pending` y nunca se anota sola.
 */
export interface ModelSuggestion {
  category: string;
  probabilities: Record<string, number>;
  modelVersion: string;
}

const suggestionSchema = z
  .object({
    category: z.string().trim().min(1).max(150),
    probabilities: z
      .record(z.string().min(1).max(150), z.number().min(0).max(1))
      .refine((value) => Object.keys(value).length >= 2, {
        message: 'Se esperan probabilidades de al menos 2 clases.',
      }),
    modelVersion: z.string().trim().min(1).max(64),
  })
  .refine((value) => value.category in value.probabilities, {
    message: 'La clase sugerida debe estar entre las probabilidades.',
  });

function parseProbabilities(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('suggestedProbabilities debe ser un JSON válido.');
  }
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Lee la sugerencia del cuerpo multipart de `POST /images`.
 *
 * - Sin ninguno de los tres campos: `null` (subida manual de siempre).
 * - Con los tres campos válidos: la sugerencia.
 * - Incompleta o inválida: ValidationError → 400, y la imagen no se guarda.
 */
export function parseModelSuggestion(body: unknown): ModelSuggestion | null {
  const fields = (body ?? {}) as Record<string, unknown>;
  const { suggestedCategory, suggestedProbabilities, suggestedModelVersion } = fields;

  if (
    isBlank(suggestedCategory) &&
    isBlank(suggestedProbabilities) &&
    isBlank(suggestedModelVersion)
  ) {
    return null;
  }

  const parsed = suggestionSchema.safeParse({
    category: suggestedCategory,
    probabilities: parseProbabilities(suggestedProbabilities),
    modelVersion: suggestedModelVersion,
  });

  if (!parsed.success) {
    throw new ValidationError(
      `Sugerencia del modelo inválida: ${parsed.error.issues[0]?.message ?? 'revisa los campos.'}`,
    );
  }

  return parsed.data;
}

/** Columnas de `images` donde se guarda la sugerencia. */
export interface StoredSuggestion {
  suggestedCategory: string | null;
  suggestedProbabilities: string | null;
  suggestedModelVersion: string | null;
}

/** Reconstruye la sugerencia a partir de las columnas de la imagen. */
export function readModelSuggestion(image: StoredSuggestion): ModelSuggestion | null {
  if (!image.suggestedCategory || !image.suggestedModelVersion) return null;

  let probabilities: Record<string, number> = {};
  try {
    const raw: unknown = JSON.parse(image.suggestedProbabilities ?? '{}');
    if (raw && typeof raw === 'object') {
      probabilities = Object.fromEntries(
        Object.entries(raw).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number',
        ),
      );
    }
  } catch {
    // Probabilidades ilegibles: se conserva la clase sugerida.
  }

  return {
    category: image.suggestedCategory,
    probabilities,
    modelVersion: image.suggestedModelVersion,
  };
}
