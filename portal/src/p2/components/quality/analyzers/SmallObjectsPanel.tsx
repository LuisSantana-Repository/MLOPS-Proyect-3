import type { CategoryRef, SmallObjectsReport } from "../../../api/quality";
import { CategoryBarChart, type CategoryBarDatum } from "../CategoryBarChart";
import { QualityStat } from "../QualityStat";
import { type SampleRef, SamplesList } from "../SamplesList";

export function SmallObjectsPanel({
  report,
  categories,
}: {
  report: SmallObjectsReport;
  categories: CategoryRef[];
}) {
  const names = new Map(categories.map((category) => [category.id, category.name]));

  const chartData: CategoryBarDatum[] = Object.entries(report.percent_by_category).map(
    ([categoryId, value]) => ({
      name: names.get(Number(categoryId)) ?? `#${categoryId}`,
      value,
    }),
  );

  const mostAffected =
    report.most_affected_category_id === null
      ? "—"
      : (names.get(report.most_affected_category_id) ?? `#${report.most_affected_category_id}`);

  const samples: SampleRef[] = report.offending_samples.map((sample) => ({
    id: sample.annotation_id,
    imageId: sample.image_id,
    caption: `${sample.width}×${sample.height}px`,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <QualityStat
          label="Objetos pequeños"
          value={`${report.small_count} de ${report.total_annotations}`}
        />
        <QualityStat label="Porcentaje" value={`${report.small_percent.toFixed(2)}%`} />
        <QualityStat label="Umbral" value={`${report.threshold_px} px`} />
        <QualityStat label="Severidad" value={report.severity} />
        <QualityStat label="Clase más afectada" value={mostAffected} />
      </div>

      <CategoryBarChart data={chartData} valueLabel="% de objetos pequeños por categoría" />
      <SamplesList title="Muestras ofensoras" samples={samples} />
    </div>
  );
}
