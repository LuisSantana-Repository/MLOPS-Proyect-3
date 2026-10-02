import { useState } from "react";
import type { EmbeddingsView } from "../../api/quality";
import { EmbeddingScatter } from "../../components/quality/EmbeddingScatter";
import { QualityEmptyState } from "../../components/quality/QualityEmptyState";
import { QualityPageShell } from "../../components/quality/QualityPageShell";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useQualityEmbeddings } from "../../hooks/quality/useQualityEmbeddings";

const PALETTE = ["#7C6FEA", "#2FAF87", "#B08900", "#4A6FE0", "#C2410C", "#9333EA"];

function AnalyticsContent({ data }: { data: EmbeddingsView }) {
  const [selected, setSelected] = useState<number[]>([]);

  const colorById = new Map(
    data.categories.map((category, index) => [
      category.id,
      PALETTE[index % PALETTE.length] ?? "#7C6FEA",
    ]),
  );

  const filtered =
    selected.length === 0
      ? data.points
      : data.points.filter((point) => point.category_ids.some((id) => selected.includes(id)));

  function toggle(categoryId: number): void {
    setSelected((previous) =>
      previous.includes(categoryId)
        ? previous.filter((id) => id !== categoryId)
        : [...previous, categoryId],
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
        <span className="font-mono text-xs text-ink-faint">
          {data.datasetVersion} · {data.method.toUpperCase()}
        </span>
        <div className="flex flex-wrap gap-2">
          {data.categories.map((category) => {
            const active = selected.includes(category.id);
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(category.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-accent-lilac bg-accent-lilac-soft text-accent-lilac"
                    : "border-border text-ink-muted hover:bg-sidebar hover:text-ink"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorById.get(category.id) }}
                  aria-hidden
                />
                {category.name}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected([])}
            className="ml-auto text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Limpiar filtro
          </button>
        )}
      </div>

      <p data-testid="explained-variance" className="text-xs text-ink-muted">
        Varianza explicada:{" "}
        {data.explainedVariance.map((value) => `${(value * 100).toFixed(1)}%`).join(" + ")}
      </p>

      <EmbeddingScatter points={filtered} colorById={colorById} />

      <p className="text-center text-xs text-ink-faint">
        {filtered.length} de {data.points.length} imágenes · generado {data.generatedAt}
      </p>
    </div>
  );
}

export function AnalyticsPage() {
  const resource = useQualityEmbeddings();

  return (
    <QualityPageShell
      title="Analítica"
      subtitle="Exploración 2D precomputada (offline): pasa el cursor por un punto para ver la imagen y filtra por clase sin recargar."
    >
      {resource.status === "loading" && <Skeleton className="h-96" />}

      {resource.status === "empty" && (
        <QualityEmptyState
          message={resource.message ?? "El pipeline todavía no precomputó las coordenadas."}
        />
      )}

      {resource.status === "error" && (
        <ErrorState
          title="No se pudo cargar la analítica exploratoria."
          message={resource.message ?? "Error desconocido."}
          onRetry={resource.reload}
        />
      )}

      {resource.status === "success" && resource.data && <AnalyticsContent data={resource.data} />}
    </QualityPageShell>
  );
}
