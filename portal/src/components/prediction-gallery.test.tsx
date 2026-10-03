// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TestPrediction } from "@/contracts";
import { PredictionGallery } from "./PredictionGallery";

/**
 * Actividad B (4.4) — correcciones de la revisión del PR #27:
 *  - una imagen que no carga (falta `dvc pull`) no se queda como imagen rota;
 *  - si la API solo entregó los errores, la galería lo dice y no presume "0 aciertos".
 */

const prediction = (annId: string, yTrue: string, yPred: string): TestPrediction => ({
  cropPath: `crops/1_${annId}.jpg`,
  annId,
  imageId: "1",
  yTrue,
  yPred,
  confidence: 0.9,
  probabilities: { person: 0.9, car: 0.1 },
});

afterEach(cleanup);

describe("PredictionGallery: imágenes que no cargan", () => {
  it("reemplaza la imagen rota por un aviso con la causa probable", () => {
    render(
      <PredictionGallery
        predictions={[prediction("1", "person", "person"), prediction("2", "car", "person")]}
        classes={["person", "car"]}
      />,
    );
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);

    fireEvent.error(images[0]);

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText(/Imagen no disponible/)).toBeInTheDocument();
    expect(screen.getByText(/dvc pull/)).toBeInTheDocument();
    // La tarjeta sigue mostrando el caso: clase real, predicha y probabilidad.
    expect(screen.getByText("ann 1")).toBeInTheDocument();
  });
});

describe("PredictionGallery: solo errores", () => {
  const errors = [prediction("1", "car", "person"), prediction("2", "person", "car")];

  it("avisa que faltan los aciertos y no dice '0 aciertos'", () => {
    render(<PredictionGallery predictions={errors} classes={["person", "car"]} errorsOnly />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Solo se recibieron los 2 errores; los aciertos no están disponibles",
    );
    expect(screen.queryByText(/0 aciertos/)).not.toBeInTheDocument();
  });

  it("no ofrece el filtro de aciertos cuando no los hay", () => {
    render(<PredictionGallery predictions={errors} classes={["person", "car"]} errorsOnly />);
    expect(screen.queryByLabelText("Resultado")).not.toBeInTheDocument();
  });

  it("con todas las predicciones sigue mostrando el conteo y el filtro", () => {
    render(
      <PredictionGallery
        predictions={[prediction("1", "person", "person"), ...errors.slice(1)]}
        classes={["person", "car"]}
      />,
    );
    expect(screen.getByText(/2 casos de test: 1 aciertos y 1 errores/)).toBeInTheDocument();
    expect(screen.getByLabelText("Resultado")).toBeInTheDocument();
  });
});
