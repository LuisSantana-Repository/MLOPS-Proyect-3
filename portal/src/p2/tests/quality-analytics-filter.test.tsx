// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embeddings: {} as { status: string; data?: unknown; message?: string },
}));

vi.mock("../hooks/quality/useQualityEmbeddings", () => ({
  useQualityEmbeddings: () => ({ ...mocks.embeddings, reload: vi.fn() }),
}));

import { AnalyticsPage } from "../pages/quality/AnalyticsPage";

/**
 * Cada imagen tiene una combinación distinta de clases, a propósito: el filtro
 * se verifica por QUÉ puntos quedan y no por cuántos. Con solo un conteo, un
 * filtro invertido puede dar el mismo número (aquí: 2 y 2) y pasar sin que
 * nadie lo note.
 *
 *   imagen 1 -> person        imagen 3 -> person + car
 *   imagen 2 -> car           imagen 4 -> car
 */
const FIXTURE = {
  datasetVersion: "v1.0.0-demo",
  method: "pca",
  generatedAt: "2026-09-18T00:00:00+00:00",
  explainedVariance: [0.4, 0.25],
  categories: [
    { id: 1, name: "person" },
    { id: 2, name: "car" },
  ],
  points: [
    { image_id: 1, file_name: "a.jpg", x: -0.5, y: 0.2, category_ids: [1], box_count: 1 },
    { image_id: 2, file_name: "b.jpg", x: 0.3, y: -0.4, category_ids: [2], box_count: 1 },
    { image_id: 3, file_name: "c.jpg", x: 0.1, y: 0.6, category_ids: [1, 2], box_count: 2 },
    { image_id: 4, file_name: "d.jpg", x: -0.2, y: -0.7, category_ids: [2], box_count: 1 },
  ],
};

function visibleImageIds(): number[] {
  return screen
    .queryAllByTestId(/^embedding-point-/)
    .map((element) => Number(element.getAttribute("data-testid")?.replace("embedding-point-", "")))
    .sort((a, b) => a - b);
}

afterEach(cleanup);

beforeEach(() => {
  mocks.embeddings = { status: "success", data: FIXTURE };
  render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>,
  );
});

describe("Analytics — el filtro por clase deja exactamente los puntos de esa clase", () => {
  it("sin filtro muestra las cuatro imágenes", () => {
    expect(visibleImageIds()).toEqual([1, 2, 3, 4]);
  });

  it("person deja las imágenes 1 y 3, y quita la 2 y la 4", () => {
    fireEvent.click(screen.getByRole("button", { name: "person" }));

    expect(visibleImageIds()).toEqual([1, 3]);
  });

  it("car deja las imágenes 2, 3 y 4, y quita la 1", () => {
    fireEvent.click(screen.getByRole("button", { name: "car" }));

    expect(visibleImageIds()).toEqual([2, 3, 4]);
  });

  it("dos clases a la vez muestran la unión de ambas", () => {
    fireEvent.click(screen.getByRole("button", { name: "person" }));
    fireEvent.click(screen.getByRole("button", { name: "car" }));

    expect(visibleImageIds()).toEqual([1, 2, 3, 4]);
  });

  it("volver a pulsar la clase la quita del filtro y restaura todos los puntos", () => {
    fireEvent.click(screen.getByRole("button", { name: "person" }));
    fireEvent.click(screen.getByRole("button", { name: "person" }));

    expect(visibleImageIds()).toEqual([1, 2, 3, 4]);
  });
});
