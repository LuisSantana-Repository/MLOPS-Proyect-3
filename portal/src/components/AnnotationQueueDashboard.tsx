"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ANNOTATION_STATUSES,
  type AnnotationStatus,
  type ListAnnotationQueueResponse,
} from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { formatDateTime, formatPercent } from "@/lib/ui/models";
import { StateMessage } from "./StateMessage";

const STATUS_LABELS: Record<AnnotationStatus, string> = {
  pending: "Pendientes",
  annotated: "Anotadas",
  discarded: "Descartadas",
};

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: ListAnnotationQueueResponse };

/** Cola de anotación: imágenes enviadas desde Inference con la clase sugerida. */
export function AnnotationQueueDashboard() {
  const [status, setStatus] = useState<AnnotationStatus>("pending");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchQueue = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const data = await fetchJson<ListAnnotationQueueResponse>(
        `/api/annotation-queue?status=${status}&limit=200`,
      );
      setLoad({ state: "ready", data });
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err) });
    }
  }, [status]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  return (
    <section className="card">
      <div className="row">
        <h2>Cola de anotación</h2>
        <div className="actions-inline" role="tablist">
          {ANNOTATION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === status}
              className={s === status ? "active" : undefined}
              onClick={() => setStatus(s)}
            >
              {STATUS_LABELS[s]}
              {load.state === "ready" ? ` (${load.data.counts[s]})` : ""}
            </button>
          ))}
        </div>
      </div>
      {load.state === "loading" ? <StateMessage kind="loading" message="Cargando cola…" /> : null}
      {load.state === "error" ? (
        <StateMessage kind="error" message={load.message} onRetry={fetchQueue} />
      ) : null}
      {load.state === "ready" && load.data.items.length === 0 ? (
        <StateMessage
          kind="empty"
          message={`No hay imágenes ${STATUS_LABELS[status].toLowerCase()}. Envía una desde Inference.`}
        />
      ) : null}
      {load.state === "ready" && load.data.items.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Imagen</th>
                <th>Clase sugerida</th>
                <th className="num">Confianza</th>
                <th>Modelo</th>
                <th>Origen</th>
                <th>Enviada</th>
                <th>Id</th>
              </tr>
            </thead>
            <tbody>
              {load.data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {/* biome-ignore lint/performance/noImgElement: imagen servida por la API del portal */}
                    <img
                      src={item.imageUrl}
                      alt={`Sugerida: ${item.suggestedClass}`}
                      className="thumb"
                    />
                  </td>
                  <td>
                    <strong>{item.suggestedClass}</strong>
                  </td>
                  <td className="num">
                    {formatPercent(item.probabilities[item.suggestedClass] ?? null, 1)}
                  </td>
                  <td>
                    <code>{item.modelVersion}</code>
                  </td>
                  <td>
                    {item.image.kind === "upload" ? (
                      "Imagen subida"
                    ) : (
                      <code>{item.image.cropPath}</code>
                    )}
                  </td>
                  <td>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <code>{item.id.slice(0, 8)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
