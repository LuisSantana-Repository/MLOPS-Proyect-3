import {
  type ClassMetrics,
  type MetricCheck,
  TEST_ACCURACY_TARGET,
  type TestEvaluation,
  type TestPrediction,
} from "@/contracts";
import { ApiError } from "@/lib/http";

/**
 * Métricas de test calculadas SOLO desde predictions.csv de T08, con las mismas
 * definiciones que scikit-learn (`zero_division=0`). Funciones puras.
 */

const REQUIRED_COLUMNS = ["crop_path", "ann_id", "image_id", "y_true", "y_pred"] as const;
const PROB_PREFIX = "prob_";
const TOLERANCE = 1e-6;

function invalid(message: string): ApiError {
  return new ApiError(500, "internal_error", `predictions.csv inválido: ${message}`);
}

function unquote(cell: string): string {
  const t = cell.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"')
    ? t.slice(1, -1).replace(/""/g, '"')
    : t;
}

/** predictions.csv → clases (orden de las columnas prob_) y filas. */
export function parsePredictionsCsv(text: string): { classes: string[]; rows: TestPrediction[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw invalid("está vacío");

  const header = lines[0].split(",").map(unquote);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw invalid(`faltan columnas: ${missing.join(", ")}`);
  const probColumns = header.filter((h) => h.startsWith(PROB_PREFIX));
  if (probColumns.length < 2)
    throw invalid("no tiene columnas prob_<clase> (se necesitan al menos 2)");
  const classes = probColumns.map((h) => h.slice(PROB_PREFIX.length));
  const col = (name: string) => header.indexOf(name);

  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split(",").map(unquote);
    const probabilities: Record<string, number> = {};
    for (const cls of classes) {
      const value = Number(cells[col(`${PROB_PREFIX}${cls}`)]);
      if (!Number.isFinite(value)) throw invalid(`probabilidad no numérica en la fila ${i + 2}`);
      probabilities[cls] = value;
    }
    const yPred = cells[col("y_pred")];
    const argmax = classes.reduce(
      (best, cls) => (probabilities[cls] > probabilities[best] ? cls : best),
      classes[0],
    );
    if (yPred !== argmax)
      throw invalid(`y_pred no es el argmax de las probabilidades en la fila ${i + 2}`);
    return {
      cropPath: cells[col("crop_path")],
      annId: cells[col("ann_id")],
      imageId: cells[col("image_id")],
      yTrue: cells[col("y_true")],
      yPred,
      confidence: probabilities[yPred],
      probabilities,
    };
  });
  if (rows.length === 0) throw invalid("está vacío (solo tiene encabezado)");
  return { classes, rows };
}

const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

/** Accuracy, F1 macro, métricas por clase, matriz de confusión, errores y comparación con MLflow. */
export function computeTestEvaluation(
  classes: string[],
  rows: TestPrediction[],
  logged: Record<string, number>,
  source: TestEvaluation["source"],
): TestEvaluation {
  const index = new Map(classes.map((c, i) => [c, i]));
  const matrix = classes.map(() => classes.map(() => 0));
  for (const r of rows) {
    const t = index.get(r.yTrue);
    const p = index.get(r.yPred);
    if (t === undefined) throw invalid(`clase real desconocida: ${r.yTrue}`);
    if (p === undefined) throw invalid(`clase predicha desconocida: ${r.yPred}`);
    matrix[t][p] += 1;
  }

  const perClass: Record<string, ClassMetrics> = {};
  classes.forEach((cls, i) => {
    const tp = matrix[i][i];
    const support = matrix[i].reduce((a, b) => a + b, 0);
    const predicted = matrix.reduce((a, row) => a + row[i], 0);
    const precision = safeDiv(tp, predicted);
    const recall = safeDiv(tp, support);
    perClass[cls] = {
      precision,
      recall,
      f1: safeDiv(2 * precision * recall, precision + recall),
      support,
    };
  });

  const correct = classes.reduce((a, _, i) => a + matrix[i][i], 0);
  const accuracy = safeDiv(correct, rows.length);
  const f1Macro = safeDiv(
    classes.reduce((a, c) => a + perClass[c].f1, 0),
    classes.length,
  );

  const computed: Record<string, number> = {
    test_accuracy: accuracy,
    test_f1_macro: f1Macro,
    test_n_samples: rows.length,
  };
  for (const cls of classes) {
    for (const key of ["precision", "recall", "f1", "support"] as const) {
      computed[`test_${key}_${cls}`] = perClass[cls][key];
    }
  }
  const checks: MetricCheck[] = Object.entries(computed).map(([metric, value]) => {
    const loggedValue = typeof logged[metric] === "number" ? logged[metric] : null;
    return {
      metric,
      computed: value,
      logged: loggedValue,
      matches: loggedValue === null ? null : Math.abs(loggedValue - value) <= TOLERANCE,
    };
  });

  return {
    source,
    classes,
    nSamples: rows.length,
    accuracy,
    f1Macro,
    meetsTarget: accuracy >= TEST_ACCURACY_TARGET,
    target: TEST_ACCURACY_TARGET,
    perClass,
    confusionMatrix: { labels: classes, matrix },
    errors: rows.filter((r) => r.yTrue !== r.yPred).sort((a, b) => b.confidence - a.confidence),
    checks,
  };
}
