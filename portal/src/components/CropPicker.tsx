"use client";

import { useCallback, useEffect, useState } from "react";
import type { CropInfo, ListCropsResponse } from "@/contracts";
import { errorMessage, fetchJson } from "@/lib/ui/api-client";
import { cropsQuery } from "@/lib/ui/models";
import { StateMessage } from "./StateMessage";

const PAGE = 24;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: ListCropsResponse };

/** Recortes de T03 (manifiesto de T04) para clasificar desde /inference. */
export function CropPicker({
  selected,
  onSelect,
}: {
  selected: CropInfo | null;
  onSelect: (crop: CropInfo) => void;
}) {
  const [className, setClassName] = useState<string | null>(null);
  const [split, setSplit] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchCrops = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const data = await fetchJson<ListCropsResponse>(
        `/api/crops?${cropsQuery({ className, split, offset, limit: PAGE })}`,
      );
      setLoad({ state: "ready", data });
    } catch (err) {
      setLoad({ state: "error", message: errorMessage(err) });
    }
  }, [className, split, offset]);

  useEffect(() => {
    fetchCrops();
  }, [fetchCrops]);

  const data = load.state === "ready" ? load.data : null;

  return (
    <div className="stack">
      <div className="actions-inline">
        <label className="field">
          Clase
          <select
            value={className ?? ""}
            onChange={(e) => {
              setClassName(e.target.value || null);
              setOffset(0);
            }}
          >
            <option value="">Todas</option>
            {data?.classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Split
          <select
            value={split ?? ""}
            onChange={(e) => {
              setSplit(e.target.value || null);
              setOffset(0);
            }}
          >
            <option value="">Todos</option>
            {data?.splits.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {load.state === "loading" ? (
        <StateMessage kind="loading" message="Cargando recortes…" />
      ) : null}
      {load.state === "error" ? (
        <StateMessage kind="error" message={load.message} onRetry={fetchCrops} />
      ) : null}
      {data && data.crops.length === 0 ? (
        <StateMessage kind="empty" message="No hay recortes con esos filtros." />
      ) : null}
      {data && data.crops.length > 0 ? (
        <>
          <ul className="crop-grid">
            {data.crops.map((crop) => (
              <li key={crop.cropPath}>
                <button
                  type="button"
                  className={crop.cropPath === selected?.cropPath ? "crop selected" : "crop"}
                  aria-pressed={crop.cropPath === selected?.cropPath}
                  onClick={() => onSelect(crop)}
                  title={`${crop.cropPath} · ${crop.className} · ${crop.split}`}
                >
                  {/* biome-ignore lint/performance/noImgElement: recorte servido por /api/crops (T12) */}
                  <img src={crop.url} alt={`${crop.className} (${crop.split})`} loading="lazy" />
                  <span>
                    {crop.className} · {crop.split}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="actions-inline">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}
            >
              Anteriores
            </button>
            <span className="muted">
              {offset + 1}–{Math.min(offset + PAGE, data.total)} de {data.total}
            </span>
            <button
              type="button"
              disabled={offset + PAGE >= data.total}
              onClick={() => setOffset(offset + PAGE)}
            >
              Siguientes
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
