"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CandidateSelectionResponse,
  ExperimentRun,
  ListExperimentsResponse,
} from "@/contracts";
import { ApiClientError, errorMessage, fetchJson } from "@/lib/ui/api-client";
import { RunCurves } from "./RunCurves";
import { RunsTable } from "./RunsTable";
import { StateMessage } from "./StateMessage";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; runs: ExperimentRun[]; experiment: string };

export function ExperimentsDashboard({ initialRunId }: { initialRunId: string | null }) {
  // Por defecto se ven todos los runs para que aparezcan los lanzados desde /training;
  // "solo selección" aplica el filtro de T07 (sweep t07, FINISHED, sin smoke).
  const [onlySelected, setOnlySelected] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [candidate, setCandidate] = useState<CandidateSelectionResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);

  const fetchRuns = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const data = await fetchJson<ListExperimentsResponse>(
        `/api/experiments?onlySelected=${onlySelected}&maxResults=200`,
      );
      setLoad({ state: "ready", runs: data.runs, experiment: data.experiment });
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err) });
    }
  }, [onlySelected]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    fetchJson<CandidateSelectionResponse>("/api/experiments/selection")
      .then(setCandidate)
      .catch((err) => {
        // Sin candidato congelado todavía no es un error de la página.
        if (!(err instanceof ApiClientError && err.status === 404)) console.error(err);
      });
  }, []);

  const runs = load.state === "ready" ? load.runs : [];
  const shownRunId =
    selectedRunId ??
    (candidate && runs.some((r) => r.runId === candidate.runId) ? candidate.runId : null) ??
    runs[0]?.runId ??
    null;

  return (
    <div className="stack">
      <section className="card">
        <div className="row">
          <h2>Runs {load.state === "ready" ? `· ${load.experiment}` : ""}</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(e) => setOnlySelected(e.target.checked)}
            />
            Solo runs de selección (T07)
          </label>
        </div>
        {candidate ? (
          <p className="muted">
            ★ Candidato congelado: <code>{candidate.runName ?? candidate.runId}</code>
            {candidate.criterion
              ? ` · criterio ${candidate.criterion.mode} ${candidate.criterion.metric} en ${candidate.criterion.split}`
              : ""}
            {candidate.testSplitUsed ? "" : " · sin usar test"}
          </p>
        ) : null}

        {load.state === "loading" ? (
          <StateMessage kind="loading" message="Cargando runs desde MLflow…" />
        ) : null}
        {load.state === "error" ? (
          <StateMessage kind="error" message={load.message} onRetry={fetchRuns} />
        ) : null}
        {load.state === "ready" && runs.length === 0 ? (
          <StateMessage
            kind="empty"
            message={
              onlySelected
                ? "No hay runs de selección terminados. Desmarca el filtro para ver todos."
                : "Todavía no hay runs. Lanza uno desde Training."
            }
          />
        ) : null}
        {load.state === "ready" && runs.length > 0 ? (
          <RunsTable
            runs={runs}
            candidateRunId={candidate?.runId ?? null}
            selectedRunId={shownRunId}
            onSelect={setSelectedRunId}
          />
        ) : null}
      </section>

      {shownRunId && load.state === "ready" ? (
        <section className="card">
          <h2>
            Curvas train/val · <code>{shownRunId}</code>
          </h2>
          <RunCurves key={shownRunId} runId={shownRunId} />
        </section>
      ) : null}
    </div>
  );
}
