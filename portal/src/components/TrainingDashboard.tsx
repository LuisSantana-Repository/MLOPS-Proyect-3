"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApprovedRelease, ListReleasesResponse } from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
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
      <TrainingForm release={release} onLaunched={(job) => setJobId(job.id)} />
      {jobId ? <JobProgress key={jobId} jobId={jobId} /> : null}
    </div>
  );
}
