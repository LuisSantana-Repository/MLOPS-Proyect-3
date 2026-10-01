"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ModelCardResponse, ModelVersionInfo } from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { downloadHref, formatDateTime, shortHash } from "@/lib/ui/models";
import { StateMessage } from "./StateMessage";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; card: ModelCardResponse };

/** Trazabilidad de una versión + su tarjeta (Markdown sin HTML crudo). */
export function ModelCard({ model }: { model: ModelVersionInfo }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchCard = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const card = await fetchJson<ModelCardResponse>(
        `/api/models/${encodeURIComponent(model.version)}/card`,
      );
      setLoad({ state: "ready", card });
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err) });
    }
  }, [model.version]);

  useEffect(() => {
    fetchCard();
  }, [fetchCard]);

  return (
    <div className="stack">
      <dl className="kv">
        <dt>Versión de modelo</dt>
        <dd>
          <code>
            {model.name} {model.version}
          </code>
        </dd>
        <dt>Run de MLflow</dt>
        <dd>
          {model.mlflowRunUrl ? (
            <a href={model.mlflowRunUrl} target="_blank" rel="noreferrer">
              <code>{model.runId}</code>
            </a>
          ) : (
            <code>{model.runId ?? "—"}</code>
          )}
        </dd>
        <dt>Release DVC del dataset</dt>
        <dd>
          <code>{model.dvcRelease ?? "—"}</code>
        </dd>
        <dt>Paquete en S3</dt>
        <dd>
          <code>{model.s3Uri ?? model.s3Key ?? "—"}</code>
        </dd>
        <dt>SHA-256 de weights.pt</dt>
        <dd>
          <code>{model.weightsSha256 ?? "—"}</code>
        </dd>
        <dt>Publicado</dt>
        <dd>{formatDateTime(model.publishedAt)}</dd>
        <dt>Verificado en S3</dt>
        <dd>
          {formatDateTime(model.publication.checkedAt)}
          {model.publication.message ? ` · ${model.publication.message}` : ""}
        </dd>
        <dt>Model Registry</dt>
        <dd>{model.status ? `${model.status}${model.stage ? ` · ${model.stage}` : ""}` : "—"}</dd>
      </dl>

      {model.files.length > 0 ? (
        <p>
          Descargas:{" "}
          {model.files.map((f, i) => (
            <span key={f}>
              {i > 0 ? " · " : ""}
              <a href={downloadHref(model.version, f)}>{f}</a>
            </span>
          ))}
        </p>
      ) : null}

      <h3>
        Tarjeta del modelo{" "}
        {load.state === "ready" ? (
          <span className="muted">
            · fuente <code>{load.card.source}</code>
          </span>
        ) : null}
      </h3>
      {load.state === "loading" ? (
        <StateMessage kind="loading" message="Cargando tarjeta…" />
      ) : null}
      {load.state === "error" ? (
        <StateMessage kind="error" message={load.message} onRetry={fetchCard} />
      ) : null}
      {load.state === "ready" ? (
        <article className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{load.card.markdown}</ReactMarkdown>
        </article>
      ) : null}
      <p className="muted">
        Pesos verificados por hash al cargar: <code>{shortHash(model.weightsSha256, 16)}</code>
      </p>
    </div>
  );
}
