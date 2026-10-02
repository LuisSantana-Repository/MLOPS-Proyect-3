import type { InvalidBoxesReport } from "../../../api/quality";
import { CategoryBarChart, type CategoryBarDatum } from "../CategoryBarChart";
import { QualityStat } from "../QualityStat";
import { type SampleRef, SamplesList } from "../SamplesList";

export function InvalidBoxesPanel({ report }: { report: InvalidBoxesReport }) {
  const samples: SampleRef[] = report.invalid_boxes.map((box) => ({
    id: box.annotation_id,
    imageId: box.image_id,
    caption: `bbox [${box.bbox.join(", ")}] · ${box.reasons.join(", ")}`,
  }));

  const reasonCounts = new Map<string, number>();
  for (const box of report.invalid_boxes) {
    for (const reason of box.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  const reasonData: CategoryBarDatum[] = [...reasonCounts.entries()].map(([name, value]) => ({
    name: name.replace(/_/g, " "),
    value,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <QualityStat
          label="Cajas inválidas"
          value={`${report.invalid_count} de ${report.total_annotations}`}
        />
        <QualityStat label="Umbral" value={report.threshold} />
        <QualityStat label="Severidad" value={report.severity} />
      </div>

      <CategoryBarChart data={reasonData} valueLabel="Cajas inválidas por motivo" color="#B08900" />

      <SamplesList title="Cajas inválidas" samples={samples} />
    </div>
  );
}
