/**
 * Evaluación de test del modelo (T12), calculada desde `test/predictions.csv`
 * que escribe T08 (`ml/evaluate_final.py`) en el run ganador.
 *
 * Todas las cifras salen de ese CSV; `checks` las compara con las métricas
 * `test_*` que T08 registró en el mismo run de MLflow.
 */

/** Meta de accuracy top-1 del proyecto. */
export const TEST_ACCURACY_TARGET = 0.85;

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

/** Una fila de predictions.csv. */
export interface TestPrediction {
  cropPath: string;
  annId: string;
  imageId: string;
  yTrue: string;
  yPred: string;
  /** Probabilidad de la clase predicha. */
  confidence: number;
  probabilities: Record<string, number>;
}

/** Cifra calculada desde el CSV frente a la registrada en MLflow (`logged: null` si no existe). */
export interface MetricCheck {
  metric: string;
  computed: number;
  logged: number | null;
  matches: boolean | null;
}

export interface TestEvaluation {
  /** De dónde salió predictions.csv: artefacto del run o `reports/t08` del repo. */
  source: "mlflow" | "repo";
  classes: string[];
  nSamples: number;
  accuracy: number;
  f1Macro: number;
  meetsTarget: boolean;
  target: number;
  perClass: Record<string, ClassMetrics>;
  /** Filas = clase real, columnas = clase predicha, en el orden de `labels`. */
  confusionMatrix: { labels: string[]; matrix: number[][] };
  /** Predicciones incorrectas, de la más segura a la menos segura. */
  errors: TestPrediction[];
  /** Todas las predicciones del test (aciertos y errores), en el orden de predictions.csv (4.4). */
  predictions?: TestPrediction[];
  checks: MetricCheck[];
}
