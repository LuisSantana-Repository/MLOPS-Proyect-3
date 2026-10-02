import type { CategoryRef, ClassImbalanceReport } from "../../../api/quality";
import { CategoryBarChart, type CategoryBarDatum } from "../CategoryBarChart";
import { QualityStat } from "../QualityStat";

export function ClassImbalancePanel({
  report,
  categories,
}: {
  report: ClassImbalanceReport;
  categories: CategoryRef[];
}) {
  const names = new Map(categories.map((category) => [category.id, category.name]));

  const chartData: CategoryBarDatum[] = report.distributions.map((distribution) => ({
    name: names.get(distribution.category_id) ?? `#${distribution.category_id}`,
    value: distribution.distinct_image_count,
  }));

  const label = (categoryId: number | null): string =>
    categoryId === null ? "—" : (names.get(categoryId) ?? `#${categoryId}`);

  const belowMinimum =
    report.classes_below_min_images.length === 0
      ? "Ninguna"
      : report.classes_below_min_images.map(label).join(", ");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <QualityStat
          label="Ratio mayoritaria / minoritaria"
          value={report.ratio === null ? "—" : report.ratio.toFixed(2)}
        />
        <QualityStat label="Umbral de ratio" value={report.threshold} />
        <QualityStat label="Severidad" value={report.severity} />
        <QualityStat label="Clase mayoritaria" value={label(report.majority_category_id)} />
        <QualityStat label="Clase minoritaria" value={label(report.minority_category_id)} />
        <QualityStat label="Clases bajo el mínimo" value={belowMinimum} />
      </div>

      <CategoryBarChart
        data={chartData}
        valueLabel="Imágenes distintas por categoría"
        color="#2FAF87"
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-sidebar text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-4 py-2.5 font-medium">Categoría</th>
              <th className="px-4 py-2.5 font-medium">Imágenes distintas</th>
              <th className="px-4 py-2.5 font-medium">Cajas</th>
            </tr>
          </thead>
          <tbody>
            {report.distributions.map((distribution) => (
              <tr key={distribution.category_id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5 font-medium text-ink">
                  {names.get(distribution.category_id) ?? `#${distribution.category_id}`}
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{distribution.distinct_image_count}</td>
                <td className="px-4 py-2.5 text-ink-muted">{distribution.box_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
