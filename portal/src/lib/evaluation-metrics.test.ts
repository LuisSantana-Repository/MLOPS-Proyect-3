import { describe, expect, it } from "vitest";
import { computeTestEvaluation, parsePredictionsCsv } from "./evaluation-metrics";

/**
 * Métricas de /evaluation calculadas SOLO desde predictions.csv de T08
 * (mismas definiciones que scikit-learn con zero_division=0).
 */

const HEADER = "crop_path,ann_id,image_id,y_true,y_pred,correct,prob_person,prob_car";
const row = (ann: number, yTrue: string, yPred: string, pPerson: number) =>
  `crops/${ann}_${ann}.jpg,${ann},${ann},${yTrue},${yPred},${yTrue === yPred ? 1 : 0},${pPerson.toFixed(6)},${(1 - pPerson).toFixed(6)}`;

// 3 person (1 mal: 3 -> car), 2 car (1 mal: 5 -> person)
const CSV = [
  HEADER,
  row(1, "person", "person", 0.9),
  row(2, "person", "person", 0.8),
  row(3, "person", "car", 0.3),
  row(4, "car", "car", 0.1),
  row(5, "car", "person", 0.95),
].join("\r\n");

describe("parsePredictionsCsv", () => {
  it("lee filas, clases en el orden de las columnas prob_ y la confianza de la predicha", () => {
    const { classes, rows } = parsePredictionsCsv(CSV);
    expect(classes).toEqual(["person", "car"]);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toEqual({
      cropPath: "crops/3_3.jpg",
      annId: "3",
      imageId: "3",
      yTrue: "person",
      yPred: "car",
      confidence: 0.7,
      probabilities: { person: 0.3, car: 0.7 },
    });
  });

  it("tolera salto de línea final y comillas del módulo csv", () => {
    const quoted = `${HEADER}\n"crops/1_1.jpg",1,1,person,person,1,0.9,0.1\n`;
    expect(parsePredictionsCsv(quoted).rows[0].cropPath).toBe("crops/1_1.jpg");
  });

  it("falla con mensaje claro si faltan columnas", () => {
    expect(() => parsePredictionsCsv("crop_path,y_true\ncrops/a.jpg,person")).toThrow(/y_pred/);
  });

  it("falla si no hay columnas de probabilidad", () => {
    expect(() => parsePredictionsCsv("crop_path,ann_id,image_id,y_true,y_pred\na,1,1,x,x")).toThrow(
      /prob_/,
    );
  });

  it("falla si y_pred no es el argmax de las probabilidades", () => {
    const bad = `${HEADER}\ncrops/1_1.jpg,1,1,person,car,0,0.9,0.1`;
    expect(() => parsePredictionsCsv(bad)).toThrow(/argmax/);
  });

  it("falla si está vacío", () => {
    expect(() => parsePredictionsCsv(HEADER)).toThrow(/vacío/);
  });
});

describe("computeTestEvaluation", () => {
  const { classes, rows } = parsePredictionsCsv(CSV);
  const ev = computeTestEvaluation(classes, rows, {}, "mlflow");

  it("accuracy y F1 macro", () => {
    expect(ev.nSamples).toBe(5);
    expect(ev.accuracy).toBeCloseTo(3 / 5);
    // person: P=2/3 R=2/3 F1=2/3 ; car: P=1/2 R=1/2 F1=1/2
    expect(ev.f1Macro).toBeCloseTo((2 / 3 + 1 / 2) / 2);
  });

  it("precisión, recall, F1 y soporte por clase", () => {
    expect(ev.perClass.person).toEqual({
      precision: expect.closeTo(2 / 3),
      recall: expect.closeTo(2 / 3),
      f1: expect.closeTo(2 / 3),
      support: 3,
    });
    expect(ev.perClass.car.support).toBe(2);
  });

  it("matriz de confusión: filas = real, columnas = predicha", () => {
    expect(ev.confusionMatrix).toEqual({
      labels: ["person", "car"],
      matrix: [
        [2, 1],
        [1, 1],
      ],
    });
  });

  it("errores ordenados del más seguro al menos seguro", () => {
    expect(ev.errors.map((e) => e.annId)).toEqual(["5", "3"]); // 0.95 antes que 0.70
  });

  it("marca la meta de 85%", () => {
    expect(ev.target).toBe(0.85);
    expect(ev.meetsTarget).toBe(false);
    const perfect = parsePredictionsCsv([HEADER, row(1, "person", "person", 0.9)].join("\n"));
    expect(computeTestEvaluation(perfect.classes, perfect.rows, {}, "repo").meetsTarget).toBe(true);
  });

  it("clase sin predicciones: precisión 0, sin dividir entre cero", () => {
    const allPerson = parsePredictionsCsv(
      [HEADER, row(1, "person", "person", 0.9), row(2, "car", "person", 0.6)].join("\n"),
    );
    const res = computeTestEvaluation(allPerson.classes, allPerson.rows, {}, "repo");
    expect(res.perClass.car).toEqual({ precision: 0, recall: 0, f1: 0, support: 1 });
    expect(Number.isFinite(res.f1Macro)).toBe(true);
  });

  it("compara con las métricas test_ registradas en MLflow por T08", () => {
    const logged = {
      test_accuracy: 0.6,
      test_f1_macro: (2 / 3 + 1 / 2) / 2,
      test_n_samples: 5,
      test_support_person: 3,
      test_precision_car: 0.9, // no coincide
    };
    const res = computeTestEvaluation(classes, rows, logged, "mlflow");
    const byMetric = Object.fromEntries(res.checks.map((c) => [c.metric, c]));
    expect(byMetric.test_accuracy.matches).toBe(true);
    expect(byMetric.test_f1_macro.matches).toBe(true);
    expect(byMetric.test_support_person.matches).toBe(true);
    expect(byMetric.test_precision_car).toMatchObject({
      matches: false,
      logged: 0.9,
      computed: 0.5,
    });
    expect(byMetric.test_recall_person).toMatchObject({ logged: null, matches: null });
  });
});
