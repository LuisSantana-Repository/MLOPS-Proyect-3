import type { CategoryRef, DuplicatesReport } from "../../../api/quality";
import { CategoryBarChart, type CategoryBarDatum } from "../CategoryBarChart";
import { QualityStat } from "../QualityStat";
import { SampleImage } from "../SampleImage";

export function DuplicatesPanel({
  report,
  categories,
}: {
  report: DuplicatesReport;
  categories: CategoryRef[];
}) {
  // `categories` se recibe por consistencia con los demás paneles; el
  // detalle de duplicados es entre imágenes, no por categoría.
  void categories;

  const distanceData: CategoryBarDatum[] = report.pairs.map((pair) => ({
    name: `#${pair.image_id_a}·#${pair.image_id_b}`,
    value: pair.distance,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QualityStat label="Grupos de duplicados" value={report.duplicate_groups.length} />
        <QualityStat label="Pares detectados" value={report.pairs.length} />
        <QualityStat label="Umbral de distancia" value={report.threshold} />
        <QualityStat label="Severidad" value={report.severity} />
      </div>

      <CategoryBarChart data={distanceData} valueLabel="Distancia pHash por par" color="#2FAF87" />

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Pares (pHash)</h3>
        {report.pairs.length === 0 ? (
          <p className="text-sm text-ink-faint">Sin pares de imágenes cercanas.</p>
        ) : (
          <ul className="space-y-2">
            {report.pairs.map((pair) => (
              <li
                key={`${pair.image_id_a}-${pair.image_id_b}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 text-sm"
              >
                <SampleImage imageId={pair.image_id_a} />
                <span className="text-ink-faint">↔</span>
                <SampleImage imageId={pair.image_id_b} />
                <span className="ml-auto text-ink-muted">
                  distancia {pair.distance} · {pair.similarity_percent.toFixed(1)}% similitud
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Grupos</h3>
        {report.duplicate_groups.length === 0 ? (
          <p className="text-sm text-ink-faint">Sin grupos de duplicados.</p>
        ) : (
          <ul className="space-y-3">
            {report.duplicate_groups.map((group) => (
              <li key={group.join("-")} className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-2 text-xs font-medium text-ink-muted">
                  {group.length} imágenes en el mismo split
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.map((imageId) => (
                    <SampleImage key={imageId} imageId={imageId} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
