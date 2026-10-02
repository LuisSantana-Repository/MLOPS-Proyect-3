"use client";

import { useMemo, useState } from "react";
import type { TestPrediction } from "@/contracts";
import { cropUrl, formatPercent } from "@/lib/ui/evaluation";

/**
 * Galería de TODO el test (4.4): aciertos y errores, filtrables por resultado, clase
 * real y clase predicha, con paginación para recorrer los 135 casos. Cada tarjeta
 * muestra el recorte (servido por /api/crops), la clase real, la predicha y la
 * probabilidad que el modelo le dio a su predicción.
 */

export const PAGE_SIZE = 24;
export const OUTCOMES = ["all", "correct", "error"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const OUTCOME_LABELS: Record<Outcome, string> = {
  all: "Todos",
  correct: "Aciertos",
  error: "Errores",
};

export interface PredictionFilter {
  outcome: Outcome;
  yTrue: string;
  yPred: string;
}

export const isCorrect = (p: TestPrediction) => p.yTrue === p.yPred;

/** Filtra por resultado (acierto/error) y por clase real y predicha ("" = todas). */
export function filterPredictions(
  predictions: TestPrediction[],
  filter: PredictionFilter,
): TestPrediction[] {
  return predictions.filter(
    (p) =>
      (filter.outcome === "all" || (filter.outcome === "correct") === isCorrect(p)) &&
      (filter.yTrue === "" || p.yTrue === filter.yTrue) &&
      (filter.yPred === "" || p.yPred === filter.yPred),
  );
}

export function countOutcomes(predictions: TestPrediction[]): { correct: number; error: number } {
  const correct = predictions.filter(isCorrect).length;
  return { correct, error: predictions.length - correct };
}

/** Página `page` (desde 0) y total de páginas; la página se ajusta al rango válido. */
export function paginate<T>(
  items: T[],
  page: number,
  size = PAGE_SIZE,
): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(current * size, (current + 1) * size), page: current, pages };
}

export function PredictionGallery({
  predictions,
  classes,
}: {
  predictions: TestPrediction[];
  classes: string[];
}) {
  const [filter, setFilter] = useState<PredictionFilter>({ outcome: "all", yTrue: "", yPred: "" });
  const [page, setPage] = useState(0);
  const counts = useMemo(() => countOutcomes(predictions), [predictions]);
  const shown = useMemo(() => filterPredictions(predictions, filter), [predictions, filter]);
  const view = paginate(shown, page);

  const update = (next: Partial<PredictionFilter>) => {
    setFilter((f) => ({ ...f, ...next }));
    setPage(0);
  };

  const classSelect = (id: string, label: string, value: string, key: "yTrue" | "yPred") => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => update({ [key]: e.target.value })}>
        <option value="">Todas</option>
        {classes.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="stack">
      <p className="muted">
        {predictions.length} casos de test: {counts.correct} aciertos y {counts.error} errores.
      </p>
      <div className="row filters">
        <div className="field">
          <label htmlFor="filter-outcome">Resultado</label>
          <select
            id="filter-outcome"
            value={filter.outcome}
            onChange={(e) => update({ outcome: e.target.value as Outcome })}
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        {classSelect("filter-true", "Clase real", filter.yTrue, "yTrue")}
        {classSelect("filter-pred", "Clase predicha", filter.yPred, "yPred")}
        <p className="muted" aria-live="polite">
          {shown.length} de {predictions.length} casos
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="muted">Ningún caso con ese filtro.</p>
      ) : (
        <>
          <ul className="gallery">
            {view.items.map((p) => (
              <li key={p.annId} className="gallery-item">
                {/* biome-ignore lint/performance/noImgElement: recortes pequeños servidos por /api/crops; no necesitan next/image */}
                <img
                  src={cropUrl(p.cropPath)}
                  alt={`Recorte ${p.annId}: real ${p.yTrue}, predicho ${p.yPred}`}
                  loading="lazy"
                />
                <span className={`badge ${isCorrect(p) ? "status-succeeded" : "status-failed"}`}>
                  {isCorrect(p) ? "Acierto" : "Error"}
                </span>
                <dl className="kv">
                  <dt>Real</dt>
                  <dd>{p.yTrue}</dd>
                  <dt>Predicha</dt>
                  <dd>{p.yPred}</dd>
                  <dt>Probabilidad</dt>
                  <dd>{formatPercent(p.confidence)}</dd>
                </dl>
                <code className="muted">ann {p.annId}</code>
              </li>
            ))}
          </ul>
          <nav className="row" aria-label="Páginas de la galería">
            <button type="button" onClick={() => setPage(view.page - 1)} disabled={view.page === 0}>
              Anteriores
            </button>
            <span className="muted">
              Página {view.page + 1} de {view.pages} · casos {view.page * PAGE_SIZE + 1}–
              {view.page * PAGE_SIZE + view.items.length}
            </span>
            <button
              type="button"
              onClick={() => setPage(view.page + 1)}
              disabled={view.page >= view.pages - 1}
            >
              Siguientes
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
