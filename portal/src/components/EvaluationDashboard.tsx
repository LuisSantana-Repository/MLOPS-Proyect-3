"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  EvaluationResponse,
  ListModelsResponse,
  ModelVersionInfo,
  TestEvaluation,
} from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { modelKey, pickDefaultModel } from "@/lib/ui/evaluation";
import { ClassMetricsTable } from "./ClassMetricsTable";
import { ConfusionHeatmap } from "./ConfusionHeatmap";
import { ErrorGallery } from "./ErrorGallery";
import { MetricCards } from "./MetricCards";
import { StateMessage } from "./StateMessage";

type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

/** Coherencia entre lo calculado desde predictions.csv y las métricas test_ de MLflow. */
function ConsistencyNote({ test }: { test: TestEvaluation }) {
  const compared = test.checks.filter((c) => c.matches !== null);
  const mismatched = compared.filter((c) => c.matches === false);
  if (mismatched.length > 0) {
    return (
      <div className="state state-error" role="alert">
        <p>Las cifras de predictions.csv no coinciden con MLflow en:</p>
        <ul>
          {mismatched.map((c) => (
            <li key={c.metric}>
              <code>{c.metric}</code>: CSV {c.computed.toFixed(4)} · MLflow {c.logged?.toFixed(4)}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (compared.length === 0) return null;
  return (
    <p className="muted">
      ✓ Calculado desde predictions.csv; coincide con las {compared.length} métricas test_
      registradas en MLflow.
    </p>
  );
}

export function EvaluationDashboard({ initialModel }: { initialModel: string | null }) {
  const [models, setModels] = useState<Load<ModelVersionInfo[]>>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(initialModel);
  const [evaluation, setEvaluation] = useState<Load<EvaluationResponse> | null>(null);

  const fetchModels = useCallback(async () => {
    setModels({ state: "loading" });
    try {
      const { models: list } = await fetchJson<ListModelsResponse>("/api/models");
      setModels({ state: "ready", data: list });
      setSelected((current) => current ?? pickDefaultModel(list));
    } catch (err) {
      setModels({ state: "error", message: errorMessage(err) });
    }
  }, []);

  const fetchEvaluation = useCallback(async (key: string) => {
    setEvaluation({ state: "loading" });
    try {
      const data = await fetchJson<EvaluationResponse>(
        `/api/evaluation/${encodeURIComponent(key)}`,
      );
      setEvaluation({ state: "ready", data });
    } catch (err) {
      setEvaluation({ state: "error", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (selected) fetchEvaluation(selected);
  }, [selected, fetchEvaluation]);

  if (models.state === "loading")
    return <StateMessage kind="loading" message="Cargando modelos publicados…" />;
  if (models.state === "error")
    return <StateMessage kind="error" message={models.message} onRetry={fetchModels} />;
  if (models.data.length === 0) {
    return (
      <StateMessage
        kind="empty"
        message="Todavía no hay modelos publicados en el registry (T10)."
      />
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <label htmlFor="model">Versión del modelo</label>
        <select id="model" value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
          {models.data.map((m) => (
            <option key={modelKey(m)} value={modelKey(m)}>
              {modelKey(m)}
            </option>
          ))}
        </select>
      </section>

      {evaluation?.state === "loading" ? (
        <StateMessage kind="loading" message="Cargando evaluación…" />
      ) : null}
      {evaluation?.state === "error" ? (
        <StateMessage
          kind="error"
          message={evaluation.message}
          onRetry={() => selected && fetchEvaluation(selected)}
        />
      ) : null}
      {evaluation?.state === "ready" ? <EvaluationView data={evaluation.data} /> : null}
    </div>
  );
}

function EvaluationView({ data }: { data: EvaluationResponse }) {
  const { test } = data;
  return (
    <>
      <header className="card">
        <h2>
          {data.modelName}:{data.modelVersion}
        </h2>
        <p>
          Run de MLflow: <code>{data.runId ?? "—"}</code>
          {test ? (
            <span className="muted">
              {" "}
              · {test.nSamples} predicciones de{" "}
              {test.source === "mlflow"
                ? "test/predictions.csv del run"
                : "reports/t08/predictions.csv"}
            </span>
          ) : null}
        </p>
      </header>

      {test === null ? (
        <StateMessage
          kind="empty"
          message={`El run ${data.runId ?? ""} todavía no tiene evaluación de test. Se genera una sola vez con ml/evaluate_final.py (T08).`}
        />
      ) : (
        <>
          <MetricCards test={test} />
          <ConsistencyNote test={test} />
          <section className="card">
            <h2>Por clase</h2>
            <ClassMetricsTable test={test} />
          </section>
          <section className="card">
            <h2>Matriz de confusión</h2>
            <ConfusionHeatmap confusion={test.confusionMatrix} />
          </section>
          <section className="card">
            <h2>Errores</h2>
            <ErrorGallery errors={test.errors} classes={test.classes} />
          </section>
        </>
      )}
    </>
  );
}
