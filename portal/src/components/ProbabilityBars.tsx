import type { ClassProbability } from "@/contracts";
import { formatPercent } from "@/lib/ui/models";

/** Una barra por clase; la predicha va resaltada. Accesible: valor también en texto. */
export function ProbabilityBars({
  probabilities,
  predictedClass,
}: {
  probabilities: ClassProbability[];
  predictedClass: string;
}) {
  return (
    <ul className="prob-bars">
      {probabilities.map((p) => (
        <li key={p.className} className={p.className === predictedClass ? "predicted" : undefined}>
          <span className="prob-label">{p.className}</span>
          {/* Barra decorativa: el valor accesible es el porcentaje en texto. */}
          <span className="prob-track" aria-hidden="true">
            <span className="prob-fill" style={{ width: `${(p.probability * 100).toFixed(1)}%` }} />
          </span>
          <span className="prob-value">{formatPercent(p.probability, 2)}</span>
        </li>
      ))}
    </ul>
  );
}
