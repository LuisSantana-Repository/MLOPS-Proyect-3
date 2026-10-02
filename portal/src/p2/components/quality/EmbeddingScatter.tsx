import { useState } from "react";
import { getImageFileUrl } from "../../lib/api/images";

export interface ScatterPoint {
  image_id: number;
  x: number;
  y: number;
  category_ids: number[];
}

/**
 * Scatter SVG de las coordenadas precomputadas. NO recalcula el embedding:
 * solo pinta los puntos que ya vienen en el artefacto y previsualiza la
 * imagen al hacer hover/focus, sin tocar la red.
 */
export function EmbeddingScatter({
  points,
  colorById,
}: {
  points: ScatterPoint[];
  colorById: Map<number, string>;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Las coordenadas vienen normalizadas a [-1, 1]; se mapean a [0, 100]%.
  const toPercent = (value: number): string => `${((value + 1) / 2) * 100}%`;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-canvas">
      {/* Ejes de referencia */}
      <span className="absolute left-1/2 top-0 h-full w-px bg-border" aria-hidden />
      <span className="absolute left-0 top-1/2 h-px w-full bg-border" aria-hidden />

      {points.map((point) => (
        <button
          key={point.image_id}
          type="button"
          data-testid={`embedding-point-${point.image_id}`}
          aria-label={`Punto imagen ${point.image_id}`}
          onMouseEnter={() => setHovered(point.image_id)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(point.image_id)}
          onBlur={() => setHovered(null)}
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-transform hover:scale-125 focus-visible:scale-125"
          style={{
            left: toPercent(point.x),
            top: toPercent(point.y),
            backgroundColor: colorById.get(point.category_ids[0] ?? -1) ?? "#7C6FEA",
          }}
        />
      ))}

      {hovered !== null && (
        <div
          data-testid="embedding-preview"
          className="pointer-events-none absolute left-1/2 top-3 z-10 w-40 -translate-x-1/2 rounded-xl border border-border bg-surface p-2 shadow-popover"
        >
          {/* biome-ignore lint/performance/noImgElement: imagen servida por el backend de anotación */}
          <img
            src={getImageFileUrl(hovered)}
            alt={`Imagen ${hovered}`}
            className="h-24 w-full rounded-lg bg-canvas object-cover"
          />
          <p className="mt-1 text-center text-[11px] text-ink-muted">Imagen #{hovered}</p>
        </div>
      )}

      {points.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
          No hay puntos con el filtro actual.
        </p>
      )}
    </div>
  );
}
