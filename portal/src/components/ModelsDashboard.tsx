"use client";

import { useCallback, useEffect, useState } from "react";
import type { ListModelsResponse, ModelVersionInfo } from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { ModelCard } from "./ModelCard";
import { ModelsTable } from "./ModelsTable";
import { StateMessage } from "./StateMessage";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; models: ModelVersionInfo[] };

export function ModelsDashboard({
  initialVersion = null,
}: {
  initialVersion?: string | null;
} = {}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(initialVersion);

  const fetchModels = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const data = await fetchJson<ListModelsResponse>("/api/models");
      setLoad({ state: "ready", models: data.models });
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const models = load.state === "ready" ? load.models : [];
  const shown = models.find((m) => m.version === selected) ?? models[0] ?? null;

  return (
    <div className="stack">
      <section className="card">
        <div className="row">
          <h2>Versiones publicadas</h2>
          <button type="button" onClick={fetchModels} disabled={load.state === "loading"}>
            Actualizar
          </button>
        </div>
        {load.state === "loading" ? (
          <StateMessage kind="loading" message="Consultando versiones y verificando S3…" />
        ) : null}
        {load.state === "error" ? (
          <StateMessage kind="error" message={load.message} onRetry={fetchModels} />
        ) : null}
        {load.state === "ready" && models.length === 0 ? (
          <StateMessage
            kind="empty"
            message="Todavía no hay versiones publicadas. Publica el run ganador con publish_model.py (T10)."
          />
        ) : null}
        {load.state === "ready" && models.length > 0 ? (
          <ModelsTable
            models={models}
            selectedVersion={shown?.version ?? null}
            onSelect={setSelected}
          />
        ) : null}
      </section>

      {shown ? (
        <section className="card">
          <h2>
            Versión <code>{shown.version}</code>
          </h2>
          <ModelCard key={shown.version} model={shown} />
        </section>
      ) : null}
    </div>
  );
}
