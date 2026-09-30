"use client";

import { useMemo, useState } from "react";
import type { TestPrediction } from "@/contracts";
import { cropUrl, filterErrors, formatPercent } from "@/lib/ui/evaluation";

/** Recortes mal clasificados, filtrables por clase real y predicha. */
export function ErrorGallery({ errors, classes }: { errors: TestPrediction[]; classes: string[] }) {
  const [yTrue, setYTrue] = useState("");
  const [yPred, setYPred] = useState("");
  const shown = useMemo(() => filterErrors(errors, { yTrue, yPred }), [errors, yTrue, yPred]);

  if (errors.length === 0) {
    return <p className="muted">No hay predicciones incorrectas en test.</p>;
  }

  const select = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
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
      <div className="row filters">
        {select("filter-true", "Clase real", yTrue, setYTrue)}
        {select("filter-pred", "Clase predicha", yPred, setYPred)}
        <p className="muted" aria-live="polite">
          {shown.length} de {errors.length} errores
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="muted">Ningún error con ese filtro.</p>
      ) : (
        <ul className="gallery">
          {shown.map((e) => (
            <li key={e.annId} className="gallery-item">
              {/* biome-ignore lint/performance/noImgElement: recortes pequeños servidos por /api/crops; no necesitan next/image */}
              <img
                src={cropUrl(e.cropPath)}
                alt={`Recorte ${e.annId}: real ${e.yTrue}, predicho ${e.yPred}`}
                loading="lazy"
              />
              <dl className="kv">
                <dt>Real</dt>
                <dd>{e.yTrue}</dd>
                <dt>Predicha</dt>
                <dd>{e.yPred}</dd>
                <dt>Probabilidad</dt>
                <dd>{formatPercent(e.confidence)}</dd>
              </dl>
              <code className="muted">ann {e.annId}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
