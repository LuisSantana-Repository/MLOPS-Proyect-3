import type { TestEvaluation } from "@/contracts";
import { formatPercent } from "@/lib/ui/evaluation";

/** Tarjetas de accuracy top-1 (con la meta) y F1 macro. */
export function MetricCards({ test }: { test: TestEvaluation }) {
  const target = formatPercent(test.target, 0);
  return (
    <div className="cards">
      <section className="card metric">
        <h2>Accuracy top-1</h2>
        <p className="metric-value">{formatPercent(test.accuracy)}</p>
        <p className={`badge ${test.meetsTarget ? "status-succeeded" : "status-failed"}`}>
          {test.meetsTarget ? `Cumple la meta (≥ ${target})` : `No llega a la meta (≥ ${target})`}
        </p>
        <p className="muted">{test.nSamples} recortes de test</p>
      </section>
      <section className="card metric">
        <h2>F1 macro</h2>
        <p className="metric-value">{test.f1Macro.toFixed(4)}</p>
        <p className="muted">Promedio simple del F1 de cada clase</p>
      </section>
    </div>
  );
}
