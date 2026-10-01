import Link from "next/link";
import type { ModelVersionInfo } from "@/contracts";
import { evaluationHref, experimentsRunHref } from "@/lib/ui/links";
import {
  downloadHref,
  formatDateTime,
  formatPercent,
  inferenceHref,
  PUBLICATION_LABELS,
  shortHash,
} from "@/lib/ui/models";

/**
 * Versiones publicadas con su trazabilidad. La versión del MODELO (semver) y el
 * release del DATASET (DVC) van en columnas separadas para no confundirlas.
 * Cada versión enlaza a su evaluación y a las curvas de su run (T16).
 */
export function ModelsTable({
  models,
  selectedVersion,
  onSelect,
}: {
  models: ModelVersionInfo[];
  selectedVersion: string | null;
  onSelect: (version: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Versión de modelo</th>
            <th>Estado en S3</th>
            <th>Run de origen</th>
            <th>Release DVC (dataset)</th>
            <th>Llave S3</th>
            <th>SHA-256 pesos</th>
            <th>Publicado</th>
            <th className="num">Acc. test</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => {
            const label = PUBLICATION_LABELS[m.publication.status];
            const usable = m.publication.status === "published";
            const curves = experimentsRunHref(m.runId);
            return (
              <tr
                key={m.version}
                className={m.version === selectedVersion ? "selected" : undefined}
              >
                <td>
                  <button type="button" className="link" onClick={() => onSelect(m.version)}>
                    <strong>{m.version}</strong>
                  </button>
                </td>
                <td>
                  <span className={`badge ${label.className}`} title={m.publication.message ?? ""}>
                    {label.text}
                  </span>
                </td>
                <td>
                  {m.mlflowRunUrl && m.runId ? (
                    <a href={m.mlflowRunUrl} target="_blank" rel="noreferrer">
                      <code>{shortHash(m.runId, 8)}</code>
                    </a>
                  ) : (
                    <code>{shortHash(m.runId, 8)}</code>
                  )}
                </td>
                <td>
                  <code>{m.dvcRelease ?? "—"}</code>
                </td>
                <td>
                  <code title={m.s3Uri ?? ""}>{m.s3Key ?? "—"}</code>
                </td>
                <td>
                  <code title={m.weightsSha256 ?? ""}>{shortHash(m.weightsSha256)}</code>
                </td>
                <td>{formatDateTime(m.publishedAt)}</td>
                <td className="num">{formatPercent(m.metrics.testAccuracy, 2)}</td>
                <td>
                  <div className="actions-inline">
                    <Link href={evaluationHref(m)}>Evaluación</Link>
                    {curves ? <Link href={curves}>Curvas</Link> : null}
                    {usable ? (
                      <>
                        <Link href={inferenceHref(m.version)}>Usar en Inference</Link>
                        <a href={downloadHref(m.version, "weights.pt")}>weights.pt</a>
                      </>
                    ) : (
                      <span className="muted">No disponible</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
