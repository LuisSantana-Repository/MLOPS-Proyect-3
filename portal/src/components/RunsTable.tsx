"use client";

import { useMemo, useState } from "react";
import type { ExperimentRun } from "@/contracts";
import {
  cellValue,
  formatCell,
  nextSort,
  RUN_COLUMNS,
  type RunColumnKey,
  type SortDirection,
  sortRuns,
} from "@/lib/ui/runs";

/** Tabla ordenable de runs; el candidato congelado lleva ★. Cada run muestra su release DVC. */
export function RunsTable({
  runs,
  candidateRunId,
  selectedRunId,
  onSelect,
}: {
  runs: ExperimentRun[];
  candidateRunId: string | null;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  const [sort, setSort] = useState<{ key: RunColumnKey; dir: SortDirection }>({
    key: "metric:best_val_loss",
    dir: "asc",
  });
  const sorted = useMemo(() => sortRuns(runs, sort.key, sort.dir), [runs, sort]);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {RUN_COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={
                  sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                <button
                  type="button"
                  className="sort"
                  onClick={() => setSort((s) => nextSort(s, c.key))}
                >
                  {c.label}
                  {sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
            <th scope="col">Curvas</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((run) => (
            <tr key={run.runId} className={run.runId === selectedRunId ? "selected" : undefined}>
              {RUN_COLUMNS.map((c) => (
                <td key={c.key} className={c.key === "runName" ? undefined : "num"}>
                  {c.key === "runName" ? (
                    <>
                      {run.runId === candidateRunId ? (
                        <span className="star" title="Candidato congelado por validación (T07)">
                          ★{" "}
                        </span>
                      ) : null}
                      {formatCell(cellValue(run, c.key), c.key)}
                      <br />
                      <code className="muted">{run.runId.slice(0, 8)}</code>
                      {run.tags.dvc_release ? (
                        <>
                          <br />
                          <span
                            className="muted"
                            title="Release DVC del dataset con que se entrenó"
                          >
                            {run.tags.dvc_release}
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    formatCell(cellValue(run, c.key), c.key)
                  )}
                </td>
              ))}
              <td>
                <button
                  type="button"
                  className="link"
                  aria-pressed={run.runId === selectedRunId}
                  onClick={() => onSelect(run.runId)}
                >
                  Ver
                </button>
                {run.mlflowRunUrl ? (
                  <>
                    {" · "}
                    <a href={run.mlflowRunUrl} target="_blank" rel="noreferrer">
                      MLflow ↗
                    </a>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
