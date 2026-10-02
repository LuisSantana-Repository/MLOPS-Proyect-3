import type { SplitsView } from "../../api/quality";
import { QualityEmptyState } from "../../components/quality/QualityEmptyState";
import { QualityPageShell } from "../../components/quality/QualityPageShell";
import { QualityStat } from "../../components/quality/QualityStat";
import { QualityStatusBadge } from "../../components/quality/QualityStatusBadge";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useQualitySplits } from "../../hooks/quality/useQualitySplits";

function SplitsContent({ data }: { data: SplitsView }) {
  const names = new Map(data.categories.map((category) => [category.id, category.name]));
  const clean =
    data.leakage.id_intersection_size === 0 && data.leakage.cross_split_duplicate_pairs === 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QualityStat
          label="Semilla (seed)"
          value={<span data-testid="splits-seed">{data.seed}</span>}
        />
        <QualityStat label="train" value={`${(data.proportions.train ?? 0) * 100}%`} />
        <QualityStat label="val" value={`${(data.proportions.val ?? 0) * 100}%`} />
        <QualityStat label="test" value={`${(data.proportions.test ?? 0) * 100}%`} />
      </div>

      <div
        data-testid="splits-leakage"
        className={`rounded-2xl border p-5 shadow-card ${
          clean ? "border-accent-mint/40 bg-accent-mint-soft/40" : "border-red-200 bg-red-50"
        }`}
      >
        <div className="flex items-center gap-2">
          <QualityStatusBadge status={clean ? "pass" : "fail"} />
          <h2 className="text-sm font-semibold text-ink">
            {clean ? "Sin fuga entre particiones" : "Se detectó fuga entre particiones"}
          </h2>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-ink-faint">Intersección de IDs</dt>
            <dd className="font-medium text-ink">{data.leakage.id_intersection_size}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Pares duplicados cruzados</dt>
            <dd className="font-medium text-ink">{data.leakage.cross_split_duplicate_pairs}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Todas las clases en val</dt>
            <dd className="font-medium text-ink">
              {data.leakage.all_classes_in_val ? "sí" : "no"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Todas las clases en test</dt>
            <dd className="font-medium text-ink">
              {data.leakage.all_classes_in_test ? "sí" : "no"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="border-b border-border bg-sidebar px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Distribución de imágenes por clase y split
        </div>
        <table data-testid="splits-distribution" className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2 font-medium">Split</th>
              <th className="px-4 py-2 font-medium">Total</th>
              {data.categories.map((category) => (
                <th key={category.id} className="px-4 py-2 font-medium">
                  {category.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.distribution.map((row) => (
              <tr key={row.split} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2 font-medium text-ink">{row.split}</td>
                <td className="px-4 py-2 text-ink-muted">{row.total_images}</td>
                {data.categories.map((category) => (
                  <td key={category.id} className="px-4 py-2 text-ink-muted">
                    {row.category_counts[String(category.id)] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div className="border-b border-border bg-sidebar px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Imágenes distintas antes / después de colapsar duplicados
        </div>
        <table data-testid="splits-class-counts" className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2 font-medium">Categoría</th>
              <th className="px-4 py-2 font-medium">Antes</th>
              <th className="px-4 py-2 font-medium">Después</th>
            </tr>
          </thead>
          <tbody>
            {data.classCounts.map((row) => (
              <tr
                key={row.category_id}
                data-testid={`class-count-${row.category_id}`}
                className="border-b border-border last:border-b-0"
              >
                <td className="px-4 py-2 font-medium text-ink">
                  {names.get(row.category_id) ?? `#${row.category_id}`}
                </td>
                <td className="px-4 py-2 text-ink-muted">{row.distinct_images_before}</td>
                <td className="px-4 py-2 text-ink-muted">{row.distinct_images_after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SplitsPage() {
  const resource = useQualitySplits();

  return (
    <QualityPageShell
      title="Particiones"
      subtitle="Distribución estratificada, reproducibilidad por semilla y verificación de fuga."
    >
      {resource.status === "loading" && <Skeleton className="h-96" />}

      {resource.status === "empty" && (
        <QualityEmptyState
          message={resource.message ?? "El pipeline todavía no publicó las particiones."}
        />
      )}

      {resource.status === "error" && (
        <ErrorState
          title="No se pudieron cargar las particiones."
          message={resource.message ?? "Error desconocido."}
          onRetry={resource.reload}
        />
      )}

      {resource.status === "success" && resource.data && <SplitsContent data={resource.data} />}
    </QualityPageShell>
  );
}
