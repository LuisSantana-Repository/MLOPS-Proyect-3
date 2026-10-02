// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { SentToAnnotation } from "@/components/InferenceDashboard";
import { imageSearchResponseSchema } from "../api/schemas";
import { ImageCard } from "../components/search/ImageCard";
import { imageDetailResponseSchema } from "../types/schemas";

/**
 * P0-3 — La imagen enviada desde Inference se ve en el flujo de anotación del portal:
 * pendiente, con la sugerencia del modelo, y con enlace a su pantalla de anotación.
 */

const SUGGESTION = {
  category: "car",
  probabilities: { car: 0.92, person: 0.08 },
  modelVersion: "1.0.0",
};

/** Lo que responde GET /images/search del portal de anotación para esa imagen. */
const SEARCH_RESPONSE = {
  data: [
    {
      id: 41,
      filename: "inference-bbbbbbbbbbbb.jpg",
      thumbnailUrl: "/images/41/file",
      width: 64,
      height: 48,
      status: "pending",
      annotationsCount: 0,
      categories: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      suggestion: SUGGESTION,
    },
  ],
  pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
};

afterEach(() => {
  cleanup();
});

describe("P0-3: sugerencia del modelo en el portal de anotación", () => {
  it("la búsqueda muestra la imagen pendiente con la clase sugerida y su confianza", () => {
    const [image] = imageSearchResponseSchema.parse(SEARCH_RESPONSE).data;
    render(
      <ImageCard image={image} isSelected={false} onClick={() => {}} onToggleSelect={() => {}} />,
    );

    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    const badge = screen.getByTestId("model-suggestion");
    expect(badge).toHaveTextContent("Sugerencia: car · 92%");
    expect(badge).toHaveAttribute("title", "Sugerencia del modelo 1.0.0");
  });

  it("una imagen subida a mano no muestra sugerencia", () => {
    const manual = { ...SEARCH_RESPONSE.data[0], suggestion: null };
    const [image] = imageSearchResponseSchema.parse({ ...SEARCH_RESPONSE, data: [manual] }).data;
    render(
      <ImageCard image={image} isSelected={false} onClick={() => {}} onToggleSelect={() => {}} />,
    );

    expect(screen.queryByTestId("model-suggestion")).not.toBeInTheDocument();
  });

  it("el detalle de la imagen (pantalla de anotación) acepta la sugerencia", () => {
    const detail = imageDetailResponseSchema.parse({
      id: 41,
      filename: "inference-bbbbbbbbbbbb.jpg",
      storageKey: "images/x",
      mimeType: "image/jpeg",
      width: 64,
      height: 48,
      sizeBytes: 1234,
      status: "pending",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      suggestion: SUGGESTION,
    });
    expect(detail.suggestion).toEqual(SUGGESTION);
  });

  it("Inference enlaza a la pantalla de anotación de la imagen y a los pendientes", () => {
    const html = renderToStaticMarkup(
      <SentToAnnotation
        item={{
          imageId: 41,
          filename: "inference-bbbbbbbbbbbb.jpg",
          status: "pending",
          modelVersion: "1.0.0",
          suggestedClass: "car",
          probabilities: SUGGESTION.probabilities,
          annotateUrl: "/annotate/41",
          pendingUrl: "/search?status=pending",
        }}
      />,
    );
    expect(html).toContain('href="/annotate/41"');
    expect(html).toContain('href="/search?status=pending"');
    expect(html).toContain("#41");
  });
});
