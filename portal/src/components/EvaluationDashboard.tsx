"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type {
  CandidateSelectionResponse,
  EvaluationDataset,
  EvaluationResponse,
  ListModelsResponse,
  ModelVersionInfo,
  TestEvaluation,
} from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import {
  chooseDefaultModel,
  type DefaultModelChoice,
  formatPercent,
  isWinner,
  modelKey,
} from "@/lib/ui/evaluation";
import { experimentsRunHref, modelsHref, predictionsExportHref } from "@/lib/ui/links";
import { ClassMetricsTable } from "./ClassMetricsTable";
import { ConfusionHeatmap } from "./ConfusionHeatmap";
import { MetricCards } from "./MetricCards";
import { PredictionGallery } from "./PredictionGallery";
import { StateMessage } from "./StateMessage";

type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

interface ModelsData {
  list: ModelVersionInfo[];
  winnerRunId: string | null;
  choice: DefaultModelChoice;
}

/** Enlaces del encabezado: de la evaluación a su entrenamiento y a su versión publicada (T16). */
export function EvaluationLinks({
  runId,
  modelVersion,
}: {
  runId: string | null;
  modelVersion: string;
}) {
  const curves = experimentsRunHref(runId);
  return (
    <div className="actions">
      {curves ? <Link href={curves}>Ver curvas del run en Experiments</Link> : null}
      <Link href={modelsHref(modelVersion)}>Ver versión en Models</Link>
    </div>
  );
}

export function WinnerBadge() {
  return <span className="badge status-succeeded">Ganador (T07)</span>;
}

/** Avisos sobre qué versión se abrió por defecto y por qué (sin cargar métricas de otras versiones). */
export function DefaultModelNotice({
  choice,
  shownKey,
}: {
  choice: DefaultModelChoice;
  shownKey: string | null;
}) {
  const notes: ReactNode[] = [];
  if (choice.reason === "latest-ready") {
    notes.push(
      <p key="no-winner" className="state" role="status">
        No hay candidato congelado en <code>reports/t07/selection.json</code> o su run no está
        registrado como modelo; se muestra la versión READY más reciente (<code>{choice.key}</code>
        ).
      </p>,
    );
  }
  if (choice.newerNonWinnerKey && choice.newerNonWinnerKey !== shownKey) {
    notes.push(
      <p key="newer" className="state" role="status">
        Hay una versión más reciente (<code>{choice.newerNonWinnerKey}</code>) que no es la ganadora
        y no tiene evaluación de test; compárala en <Link href="/experiments">/experiments</Link>.
      </p>,
    );
  }
  return notes.length ? <div className="stack">{notes}</div> : null;
}

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

/** Run del candidato congelado por T07; null si no hay selección o no se pudo leer. */
async function fetchWinnerRunId(): Promise<string | null> {
  try {
    return (await fetchJson<CandidateSelectionResponse>("/api/experiments/selection")).runId;
  } catch {
    return null;
  }
}

export function EvaluationDashboard({ initialModel }: { initialModel: string | null }) {
  const [models, setModels] = useState<Load<ModelsData>>({ state: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<Load<EvaluationResponse> | null>(null);

  const fetchModels = useCallback(async () => {
    setModels({ state: "loading" });
    try {
      const [{ models: list }, winnerRunId] = await Promise.all([
        fetchJson<ListModelsResponse>("/api/models"),
        fetchWinnerRunId(),
      ]);
      const choice = chooseDefaultModel(list, winnerRunId, initialModel);
      setModels({ state: "ready", data: { list, winnerRunId, choice } });
      setSelected((current) => current ?? choice.key);
    } catch (err) {
      setModels({ state: "error", message: errorMessage(err) });
    }
  }, [initialModel]);

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

  const { list, winnerRunId, choice } = models.data;
  if (list.length === 0) {
    return (
      <StateMessage
        kind="empty"
        message="Todavía no hay modelos publicados en el registry (T10)."
      />
    );
  }
  const keys = list.map(modelKey);
  const options = selected && !keys.includes(selected) ? [selected, ...keys] : keys;
  const winnerOf = new Map(list.map((m) => [modelKey(m), isWinner(m.runId, winnerRunId)]));

  return (
    <div className="stack">
      <section className="card">
        <label htmlFor="model">Versión del modelo</label>
        <select id="model" value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
          {selected === null ? <option value="">Elige una versión</option> : null}
          {options.map((key) => (
            <option key={key} value={key}>
              {key}
              {winnerOf.get(key) ? " · Ganador (T07)" : ""}
            </option>
          ))}
        </select>
      </section>

      <DefaultModelNotice choice={choice} shownKey={selected} />

      {selected === null ? (
        <StateMessage
          kind="empty"
          message="No hay un ganador (T07) registrado ni versiones en estado READY."
        />
      ) : null}
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
      {evaluation?.state === "ready" ? (
        <EvaluationView data={evaluation.data} winnerRunId={winnerRunId} />
      ) : null}
    </div>
  );
}

/** Versión de los DATOS evaluados: release del Proyecto 2 y hashes DVC (6.3). */
export function DatasetVersion({ dataset }: { dataset: EvaluationDataset }) {
  const rows: [string, string | null][] = [
    ["Release DVC (Proyecto 2)", dataset.release],
    ["md5 DVC de data/raw (imágenes)", dataset.rawDvcMd5],
    ["md5 DVC de las anotaciones COCO", dataset.annotationsMd5],
    ["md5 DVC del manifiesto 70/20/10", dataset.manifestDvcMd5],
    ["SHA-256 del manifiesto (run)", dataset.manifestSha256],
  ];
  return (
    <dl className="kv">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {/* Los hashes no tienen espacios: se parten en cualquier carácter para no desbordar. */}
            <code style={{ overflowWrap: "anywhere" }}>{value ?? "—"}</code>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Accuracy de predecir siempre la clase más frecuente del MISMO test (4.4). */
export function majorityBaseline(test: TestEvaluation): { className: string; accuracy: number } {
  const [className, support] = Object.entries(test.perClass)
    .map(([c, m]) => [c, m.support] as const)
    .sort((a, b) => b[1] - a[1])[0];
  return { className, accuracy: test.nSamples ? support / test.nSamples : 0 };
}

export function BaselineComparison({ test }: { test: TestEvaluation }) {
  const base = majorityBaseline(test);
  const gain = (test.accuracy - base.accuracy) * 100;
  return (
    <p className="muted">
      Baseline de clase mayoritaria (siempre <code>{base.className}</code>):{" "}
      <strong>{formatPercent(base.accuracy)}</strong>. El modelo está{" "}
      {gain >= 0 ? `${gain.toFixed(1)} pp por encima` : `${(-gain).toFixed(1)} pp por debajo`}.
    </p>
  );
}

/** De dónde salió la evaluación y enlace para exportar predictions.csv (P1-3). */
export function EvaluationSource({ data }: { data: EvaluationResponse }) {
  const { test } = data;
  return (
    <p className="muted">
      Fuente:{" "}
      {data.source === "mlflow" ? (
        <strong>MLflow</strong>
      ) : (
        <>
          <strong>repo verificado</strong> (reports/t08: mismo run y mismo SHA-256 de pesos que la
          versión publicada)
        </>
      )}
      {test ? (
        <>
          {" "}
          · {test.nSamples} predicciones de{" "}
          {test.source === "mlflow"
            ? "test/predictions.csv del run"
            : "reports/t08/predictions.csv"}{" "}
          ·{" "}
          <a href={predictionsExportHref({ name: data.modelName, version: data.modelVersion })}>
            Exportar predictions.csv
          </a>
        </>
      ) : null}
    </p>
  );
}

function EvaluationView({
  data,
  winnerRunId,
}: {
  data: EvaluationResponse;
  winnerRunId: string | null;
}) {
  const { test } = data;
  const winner = isWinner(data.runId, winnerRunId);
  return (
    <>
      <header className="card">
        <h2>
          {data.modelName}:{data.modelVersion} {winner ? <WinnerBadge /> : null}
        </h2>
        <p>
          Run de MLflow: <code>{data.runId ?? "—"}</code>
        </p>
        <EvaluationSource data={data} />
        <h3>Versión del dataset</h3>
        <DatasetVersion dataset={data.dataset} />
        <EvaluationLinks runId={data.runId} modelVersion={data.modelVersion} />
        {!winner && winnerRunId ? (
          <p className="muted">
            Esta versión no es la ganadora (T07). El test se evalúa una sola vez y solo en el run
            ganador; para comparar candidatos usa <Link href="/experiments">/experiments</Link>.
          </p>
        ) : null}
      </header>

      {test === null ? (
        <StateMessage
          kind="empty"
          message={`El run ${data.runId ?? ""} todavía no tiene evaluación de test. Se genera una sola vez con ml/evaluate_final.py (T08).`}
        />
      ) : (
        <>
          <MetricCards test={test} />
          <BaselineComparison test={test} />
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
            <h2>Aciertos y errores</h2>
            <PredictionGallery
              predictions={test.predictions ?? test.errors}
              classes={test.classes}
            />
          </section>
        </>
      )}
    </>
  );
}
