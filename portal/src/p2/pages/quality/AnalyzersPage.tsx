import { useState } from "react";
import type { AnalyzersView } from "../../api/quality";
import { ClassImbalancePanel } from "../../components/quality/analyzers/ClassImbalancePanel";
import { DuplicatesPanel } from "../../components/quality/analyzers/DuplicatesPanel";
import { InvalidBoxesPanel } from "../../components/quality/analyzers/InvalidBoxesPanel";
import { SmallObjectsPanel } from "../../components/quality/analyzers/SmallObjectsPanel";
import { SpatialBiasPanel } from "../../components/quality/analyzers/SpatialBiasPanel";
import { QualityEmptyState } from "../../components/quality/QualityEmptyState";
import { QualityPageShell } from "../../components/quality/QualityPageShell";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useQualityAnalyzers } from "../../hooks/quality/useQualityAnalyzers";

type TabKey = "small" | "imbalance" | "duplicates" | "invalid" | "spatial";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "small", label: "Objetos pequeños" },
  { key: "imbalance", label: "Desbalance" },
  { key: "duplicates", label: "Duplicados" },
  { key: "invalid", label: "Cajas inválidas" },
  { key: "spatial", label: "Sesgo espacial" },
];

function AnalyzerContent({ data, active }: { data: AnalyzersView; active: TabKey }) {
  switch (active) {
    case "small":
      return <SmallObjectsPanel report={data.smallObjects} categories={data.categories} />;
    case "imbalance":
      return <ClassImbalancePanel report={data.classImbalance} categories={data.categories} />;
    case "duplicates":
      return <DuplicatesPanel report={data.duplicates} categories={data.categories} />;
    case "invalid":
      return <InvalidBoxesPanel report={data.invalidBoxes} />;
    case "spatial":
      return <SpatialBiasPanel report={data.spatialBias} categories={data.categories} />;
  }
}

export function AnalyzersPage() {
  const resource = useQualityAnalyzers();
  const [active, setActive] = useState<TabKey>("small");

  return (
    <QualityPageShell
      title="Analizadores"
      subtitle="Los cinco análisis de calidad con su valor observado, umbral y muestras ofensoras."
    >
      {resource.status === "loading" && <Skeleton className="h-96" />}

      {resource.status === "empty" && (
        <QualityEmptyState
          message={resource.message ?? "El pipeline todavía no publicó análisis."}
        />
      )}

      {resource.status === "error" && (
        <ErrorState
          title="No se pudieron cargar los analizadores."
          message={resource.message ?? "Error desconocido."}
          onRetry={resource.reload}
        />
      )}

      {resource.status === "success" && resource.data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs text-ink-faint">{resource.data.datasetVersion}</span>
          </div>

          <div
            role="tablist"
            aria-label="Analizadores de calidad"
            className="flex flex-wrap gap-1 rounded-2xl border border-border bg-surface p-1 shadow-card"
          >
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active === tab.key}
                onClick={() => setActive(tab.key)}
                className={`rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                  active === tab.key
                    ? "bg-accent-lilac-soft text-accent-lilac"
                    : "text-ink-muted hover:bg-sidebar hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div role="tabpanel">
            <AnalyzerContent data={resource.data} active={active} />
          </div>
        </div>
      )}
    </QualityPageShell>
  );
}
