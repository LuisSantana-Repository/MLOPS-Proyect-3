import type { OverviewView } from "../../api/quality";
import { StatCard } from "../../components/dashboard/StatCard";
import { CheckList } from "../../components/quality/CheckList";
import { QualityEmptyState } from "../../components/quality/QualityEmptyState";
import { QualityPageShell } from "../../components/quality/QualityPageShell";
import { QualityStatusBadge } from "../../components/quality/QualityStatusBadge";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useQualityOverview } from "../../hooks/quality/useQualityOverview";

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

function gateDisplayStatus(gate: OverviewView["gate"]): "pass" | "warn" | "fail" {
  if (gate.failCount > 0 || gate.overallStatus === "fail") return "fail";
  if (gate.warnCount > 0) return "warn";
  return "pass";
}

function OverviewContent({ data }: { data: OverviewView }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-card">
        <span className="text-xs uppercase tracking-wide text-ink-faint">Versión consultada</span>
        <span className="font-mono text-sm font-medium text-ink">{data.datasetVersion}</span>
        <span className="text-xs text-ink-faint">Generado {data.generatedAt}</span>
        <span className="ml-auto flex items-center gap-2">
          <span data-testid="gate-status">
            <QualityStatusBadge status={gateDisplayStatus(data.gate)} />
          </span>
          <span className="text-xs text-ink-muted">
            {data.gate.passCount} pass · {data.gate.warnCount} warn · {data.gate.failCount} fail
          </span>
        </span>
      </div>

      <div
        data-testid="overview-totals"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard label="Fotografías" value={data.totals.images} accent="lilac" />
        <StatCard label="Cajas" value={data.totals.annotations} accent="blue" />
        <StatCard label="Categorías" value={data.totals.categories} accent="mint" />
        <StatCard label="Checks fallidos" value={data.gate.failCount} accent="peach" />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink">Compuerta de calidad</h2>
        <CheckList checks={data.checks} />
      </div>
    </div>
  );
}

export function OverviewPage() {
  const resource = useQualityOverview();

  return (
    <QualityPageShell
      title="Resumen"
      subtitle="Estado del dataset y de la compuerta de calidad, leído del pipeline."
    >
      {resource.status === "loading" && <OverviewSkeleton />}

      {resource.status === "empty" && (
        <QualityEmptyState
          message={resource.message ?? "El pipeline todavía no publicó artefactos de calidad."}
        />
      )}

      {resource.status === "error" && (
        <ErrorState
          title="No se pudo cargar el resumen."
          message={resource.message ?? "Error desconocido."}
          onRetry={resource.reload}
        />
      )}

      {resource.status === "success" && resource.data && <OverviewContent data={resource.data} />}
    </QualityPageShell>
  );
}
