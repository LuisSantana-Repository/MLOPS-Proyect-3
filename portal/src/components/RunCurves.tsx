"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunMetricsResponse } from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { MetricsChart } from "./MetricsChart";
import { StateMessage } from "./StateMessage";

const KEYS = ["train_loss", "val_loss", "train_acc", "val_acc"];

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: RunMetricsResponse };

/** Curvas train/val por época del run elegido. */
export function RunCurves({ runId }: { runId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchMetrics = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const data = await fetchJson<RunMetricsResponse>(
        `/api/experiments/${encodeURIComponent(runId)}/metrics?keys=${KEYS.join(",")}`,
      );
      setLoad({ state: "ready", data });
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err) });
    }
  }, [runId]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  if (load.state === "loading") return <StateMessage kind="loading" message="Cargando curvas…" />;
  if (load.state === "error")
    return <StateMessage kind="error" message={load.message} onRetry={fetchMetrics} />;

  const m = load.data.metrics;
  const series = (keys: string[]) => keys.map((k) => ({ name: k, points: m[k] ?? [] }));
  return (
    <div className="charts">
      <MetricsChart
        title="Pérdida por época"
        yLabel="loss"
        series={series(["train_loss", "val_loss"])}
      />
      <MetricsChart
        title="Accuracy por época"
        yLabel="accuracy"
        series={series(["train_acc", "val_acc"])}
      />
    </div>
  );
}
