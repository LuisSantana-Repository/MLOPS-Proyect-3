import type { ModelSuggestion } from "@p2/api/schemas";
import { Sparkles } from "lucide-react";

function confidence(suggestion: ModelSuggestion): string | null {
  const value = suggestion.probabilities[suggestion.category];
  return typeof value === "number" ? `${(value * 100).toFixed(0)}%` : null;
}

/**
 * Sugerencia del clasificador para una imagen enviada desde Inference: la clase
 * que predijo el modelo, su confianza y la versión. Es solo una ayuda: quien
 * anota decide la categoría de cada caja.
 */
export function ModelSuggestionBadge({
  suggestion,
  detailed = false,
}: {
  suggestion: ModelSuggestion;
  detailed?: boolean;
}) {
  const percent = confidence(suggestion);
  return (
    <span
      data-testid="model-suggestion"
      title={`Sugerencia del modelo ${suggestion.modelVersion}`}
      className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-lilac-soft px-2 py-0.5 text-[11px] font-medium text-accent-lilac"
    >
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">
        {detailed ? "Sugerencia del modelo: " : "Sugerencia: "}
        <strong>{suggestion.category}</strong>
        {percent ? ` · ${percent}` : ""}
        {detailed ? ` · modelo ${suggestion.modelVersion}` : ""}
      </span>
    </span>
  );
}
