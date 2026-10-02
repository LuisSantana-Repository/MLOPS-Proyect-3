// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ askCopilot: vi.fn() }));
vi.mock("../api/copilot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/copilot")>();
  return { ...actual, askCopilot: apiMocks.askCopilot };
});

vi.mock("../hooks/quality/useCopilotTools", () => ({
  useCopilotTools: () => ({
    status: "success",
    data: [
      { name: "get_dataset_overview", description: "Resumen del dataset.", inputSchema: {} },
      { name: "get_splits", description: "Particiones.", inputSchema: {} },
    ],
    reload: vi.fn(),
  }),
}));

import { CopilotPage } from "../pages/quality/CopilotPage";

const ANSWER_FIXTURE = {
  question: "¿cuántas imágenes?",
  answer: "El dataset tiene 12 imágenes, 15 cajas y 3 categorías.",
  grounded: true,
  datasetVersion: "v1.0.0-demo",
  toolsUsed: ["get_dataset_overview"],
  toolCalls: [
    {
      name: "get_dataset_overview",
      arguments: {},
      datasetVersion: "v1.0.0-demo",
      source: "release.json",
      data: { totals: { images: 12 } },
    },
  ],
  provider: "none",
};

afterEach(cleanup);

beforeEach(() => {
  apiMocks.askCopilot.mockReset();
});

/**
 * SPEC-QUALITY-UI-008 — Pantalla del Dataset Copilot.
 */
describe("SPEC-QUALITY-UI-008 — Copilot", () => {
  it("envía la pregunta y muestra la respuesta con sus tool calls", async () => {
    apiMocks.askCopilot.mockResolvedValue(ANSWER_FIXTURE);
    render(
      <MemoryRouter>
        <CopilotPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/pregunta/i), {
      target: { value: "¿cuántas imágenes?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preguntar/i }));

    await waitFor(() => expect(apiMocks.askCopilot).toHaveBeenCalledWith("¿cuántas imágenes?"));
    expect(await screen.findByText(/12 imágenes/)).toBeInTheDocument();
    expect(screen.getByTestId("copilot-tool-calls")).toHaveTextContent("get_dataset_overview");
    expect(screen.getByTestId("copilot-version")).toHaveTextContent("v1.0.0-demo");
  });

  it("marca la respuesta como sin evidencia cuando el dataset no puede contestar", async () => {
    apiMocks.askCopilot.mockResolvedValue({
      ...ANSWER_FIXTURE,
      answer: "No tengo una herramienta para responder eso.",
      grounded: false,
      datasetVersion: null,
      toolsUsed: [],
      toolCalls: [],
    });
    render(
      <MemoryRouter>
        <CopilotPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/pregunta/i), {
      target: { value: "¿capital de Francia?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preguntar/i }));

    expect(await screen.findByText(/sin evidencia/i)).toBeInTheDocument();
  });
});
