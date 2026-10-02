"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApprovedRelease, ListReleasesResponse } from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { recoverJobId, rememberJobId, withJobParam } from "@/lib/ui/job-persistence";
import { JobProgress } from "./JobProgress";
import { ReleaseSelector } from "./ReleaseSelector";
import { StateMessage } from "./StateMessage";
import { TrainingForm } from "./TrainingForm";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; releases: ApprovedRelease[] };

export function TrainingDashboard() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [release, setRelease] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const fetchReleases = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const { releases } = await fetchJson<ListReleasesResponse>("/api/releases");
      setLoad({ state: "ready", releases });
      setRelease((current) => current ?? releases[0]?.tag ?? null);
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  // Al recargar la página se recupera el job de la URL (?job=) o de localStorage; su
  // progreso y sus logs los vuelve a pedir JobProgress a la API.
  useEffect(() => {
    const recovered = recoverJobId(window.location.search, window.localStorage);
    if (recovered) setJobId(recovered);
  }, []);

  const showJob = useCallback((id: string | null) => {
    setJobId(id);
    rememberJobId(id, window.localStorage);
    const url = withJobParam(window.location.pathname, window.location.search, id);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  if (load.state === "loading")
    return <StateMessage kind="loading" message="Cargando releases aprobados…" />;
  if (load.state === "error") {
    return <StateMessage kind="error" message={load.message} onRetry={fetchReleases} />;
  }
  if (load.releases.length === 0) {
    return <StateMessage kind="empty" message="No hay releases aprobados para entrenar." />;
  }

  return (
    <div className="stack">
      <ReleaseSelector releases={load.releases} selectedTag={release ?? ""} onChange={setRelease} />
      <TrainingForm release={release} onLaunched={(job) => showJob(job.id)} />
      {jobId ? (
        <>
          <JobProgress key={jobId} jobId={jobId} />
          <div className="actions">
            <button type="button" className="secondary" onClick={() => showJob(null)}>
              Dejar de seguir este job
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
