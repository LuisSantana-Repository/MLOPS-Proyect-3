"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AnnotationQueueItem,
  type CropInfo,
  INFERENCE_LIMITS,
  type InferenceResponse,
  type ListModelsResponse,
  type ModelVersionInfo,
} from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import {
  type InferenceSource,
  pickVersion,
  shortHash,
  usableVersions,
  validateImageFile,
} from "@/lib/ui/models";
import { CropPicker } from "./CropPicker";
import { ProbabilityBars } from "./ProbabilityBars";
import { StateMessage } from "./StateMessage";

type Models =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; models: ModelVersionInfo[] };

type Prediction =
  | { state: "idle" }
  | { state: "running" }
  | { state: "error"; message: string }
  | { state: "done"; result: InferenceResponse; previewUrl: string };

type Send =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "error"; message: string }
  | { state: "sent"; item: AnnotationQueueItem };

const SOURCE_LABELS: Record<InferenceSource, string> = {
  upload: "Subir imagen nueva",
  crop: "Elegir recorte del portal",
};

export function InferenceDashboard({ requestedVersion }: { requestedVersion: string | null }) {
  const [models, setModels] = useState<Models>({ state: "loading" });
  const [version, setVersion] = useState<string | null>(null);
  const [source, setSource] = useState<InferenceSource>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropInfo | null>(null);
  const [prediction, setPrediction] = useState<Prediction>({ state: "idle" });
  const [send, setSend] = useState<Send>({ state: "idle" });

  const fetchModels = useCallback(async () => {
    setModels({ state: "loading" });
    try {
      const data = await fetchJson<ListModelsResponse>("/api/models");
      setModels({ state: "ready", models: data.models });
      setVersion((current) => current ?? pickVersion(data.models, requestedVersion));
    } catch (err) {
      setModels({ state: "error", message: errorMessage(err) });
    }
  }, [requestedVersion]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Libera la vista previa local (blob:) al reemplazarla; las de recortes son URLs del portal.
  useEffect(() => {
    return () => {
      if (prediction.state === "done" && prediction.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(prediction.previewUrl);
      }
    };
  }, [prediction]);

  function reset() {
    setPrediction({ state: "idle" });
    setSend({ state: "idle" });
  }

  function onFileChange(next: File | null) {
    setFile(next);
    setFileError(next ? validateImageFile(next) : null);
    reset();
  }

  const ready = source === "upload" ? !!file && !fileError : !!crop;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!version) return;
    const form = new FormData();
    form.set("version", version);
    let previewUrl: string;
    if (source === "upload") {
      const problem = validateImageFile(file);
      if (problem || !file) {
        setFileError(problem);
        return;
      }
      form.set("file", file);
      previewUrl = URL.createObjectURL(file);
    } else {
      if (!crop) return;
      form.set("cropPath", crop.cropPath);
      previewUrl = crop.url;
    }
    setPrediction({ state: "running" });
    setSend({ state: "idle" });
    try {
      const result = await fetchJson<InferenceResponse>("/api/inference", {
        method: "POST",
        body: form,
      });
      setPrediction({ state: "done", result, previewUrl });
    } catch (err) {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setPrediction({ state: "error", message: errorMessage(err) });
    }
  }

  async function sendToAnnotation(result: InferenceResponse) {
    setSend({ state: "sending" });
    try {
      const item = await fetchJson<AnnotationQueueItem>("/api/annotation-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: result.image,
          modelVersion: result.version,
          suggestedClass: result.predictedClass,
          probabilities: Object.fromEntries(
            result.probabilities.map((p) => [p.className, p.probability]),
          ),
        }),
      });
      setSend({ state: "sent", item });
    } catch (err) {
      setSend({ state: "error", message: errorMessage(err) });
    }
  }

  const usable = models.state === "ready" ? usableVersions(models.models) : [];
  const result = prediction.state === "done" ? prediction.result : null;

  return (
    <div className="stack">
      <section className="card">
        <h2>Clasificar una imagen</h2>
        {models.state === "loading" ? (
          <StateMessage kind="loading" message="Cargando versiones publicadas…" />
        ) : null}
        {models.state === "error" ? (
          <StateMessage kind="error" message={models.message} onRetry={fetchModels} />
        ) : null}
        {models.state === "ready" && usable.length === 0 ? (
          <StateMessage
            kind="empty"
            message="No hay versiones publicadas y verificadas en S3. Revisa la página Models."
          />
        ) : null}
        {models.state === "ready" && usable.length > 0 ? (
          <form className="stack" onSubmit={onSubmit} noValidate>
            <label className="field">
              Versión de modelo
              <select
                value={version ?? ""}
                onChange={(e) => {
                  setVersion(e.target.value);
                  reset();
                }}
              >
                {usable.map((m) => (
                  <option key={m.version} value={m.version}>
                    {m.version} · run {shortHash(m.runId, 8)} · {m.dvcRelease ?? "release ?"}
                  </option>
                ))}
              </select>
            </label>

            <div className="mode-tabs" role="tablist" aria-label="Origen de la imagen">
              {(Object.keys(SOURCE_LABELS) as InferenceSource[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={s === source}
                  onClick={() => {
                    setSource(s);
                    reset();
                  }}
                >
                  {SOURCE_LABELS[s]}
                </button>
              ))}
            </div>

            {source === "upload" ? (
              <label className={`field${fileError ? " invalid" : ""}`}>
                Imagen nueva (JPEG o PNG, máx. {INFERENCE_LIMITS.maxBytes / (1024 * 1024)} MB)
                <input
                  type="file"
                  accept={INFERENCE_LIMITS.mimeTypes.join(",")}
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                />
                {fileError ? <small>{fileError}</small> : null}
              </label>
            ) : (
              <CropPicker
                selected={crop}
                onSelect={(c) => {
                  setCrop(c);
                  reset();
                }}
              />
            )}

            <div className="actions">
              <button type="submit" disabled={!ready || prediction.state === "running"}>
                {prediction.state === "running" ? "Clasificando…" : "Clasificar"}
              </button>
              {source === "crop" && crop ? (
                <span className="muted">
                  Recorte <code>{crop.cropPath}</code> · etiqueta {crop.className} · {crop.split}
                </span>
              ) : null}
            </div>
          </form>
        ) : null}
      </section>

      {prediction.state === "running" ? (
        <StateMessage
          kind="loading"
          message="El servicio descarga el modelo de S3 (la primera vez) y clasifica…"
        />
      ) : null}
      {prediction.state === "error" ? (
        <StateMessage kind="error" message={prediction.message} />
      ) : null}
      {prediction.state === "done" && result ? (
        <section className="card">
          <h2>Resultado</h2>
          <div className="inference-result">
            {/* biome-ignore lint/performance/noImgElement: vista previa local o recorte del portal */}
            <img src={prediction.previewUrl} alt="Imagen clasificada" className="thumb-lg" />
            <div className="stack">
              <p>
                Clase predicha: <strong>{result.predictedClass}</strong>
              </p>
              <ProbabilityBars
                probabilities={result.probabilities}
                predictedClass={result.predictedClass}
              />
              <p className="muted">
                Modelo <code>{result.version}</code> · pesos SHA-256{" "}
                <code>{shortHash(result.weightsSha256, 16)}</code> ·{" "}
                {result.image.kind === "upload" ? (
                  <>
                    imagen <code>{shortHash(result.image.sha256, 12)}</code>
                  </>
                ) : (
                  <>
                    recorte <code>{result.image.cropPath}</code>
                  </>
                )}
              </p>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => sendToAnnotation(result)}
                  disabled={send.state === "sending" || send.state === "sent"}
                >
                  {send.state === "sending" ? "Enviando…" : "Enviar a anotación"}
                </button>
              </div>
              {send.state === "error" ? <StateMessage kind="error" message={send.message} /> : null}
              {send.state === "sent" ? (
                <p role="status">
                  Agregada a la cola como <code>{send.item.id}</code> (pendiente).{" "}
                  <Link href="/annotation-queue">Ver cola de anotación</Link>
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
