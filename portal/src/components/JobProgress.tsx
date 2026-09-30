"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TrainingJobResponse } from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { isTerminal, POLL_INTERVAL_MS, STATUS_LABELS } from "@/lib/ui/jobs";
import { StateMessage } from "./StateMessage";

/** Progreso de un job: consulta GET /api/training/jobs/[id] hasta que termina. */
export function JobProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<TrainingJobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const next = await fetchJson<TrainingJobResponse>(
          `/api/training/jobs/${encodeURIComponent(jobId)}`,
        );
        if (cancelled) return;
        setJob(next);
        setError(null);
        if (isTerminal(next.status)) return;
      } catch (err) {
        if (cancelled) return;
        setError(errorMessage(err)); // error transitorio: se sigue consultando
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  return (
    <section className="card" aria-live="polite">
      <h2>3. Progreso</h2>
      <p>
        Job <code>{jobId}</code>
      </p>
      {error ? (
        <StateMessage kind="error" message={`No se pudo consultar el job: ${error}`} />
      ) : null}
      {!job && !error ? <StateMessage kind="loading" message="Consultando el job…" /> : null}
      {job ? (
        <>
          <p>
            Estado:{" "}
            <span className={`badge status-${job.status}`}>{STATUS_LABELS[job.status]}</span>
            {isTerminal(job.status) ? null : " · se actualiza cada 3 s"}
          </p>
          {job.runId ? (
            <p>
              Run de MLflow: <code>{job.runId}</code> ·{" "}
              <Link href={`/experiments?run=${encodeURIComponent(job.runId)}`}>
                ver curvas en Experiments
              </Link>
            </p>
          ) : null}
          {job.error ? <p className="error-text">{job.error}</p> : null}
          <h3>Logs</h3>
          {job.logs.length === 0 ? (
            <StateMessage kind="empty" message="El worker todavía no ha escrito logs." />
          ) : (
            <pre className="logs">
              {job.logs
                .map((l) => `${l.ts}  ${l.level.toUpperCase().padEnd(5)}  ${l.message}`)
                .join("\n")}
            </pre>
          )}
        </>
      ) : null}
    </section>
  );
}
