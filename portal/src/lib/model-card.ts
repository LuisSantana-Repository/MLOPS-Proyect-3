import type { ModelCardResponse, ModelMetrics } from "@/contracts";
import type { PublishedModelRow } from "@/lib/db/schema";
import { notFound } from "@/lib/http";
import { getObjectBytes, MODEL_CARD_FILE, modelKey, type S3Store } from "@/lib/s3";

/**
 * Tarjeta del modelo (T13).
 *
 * Si el paquete publicado trae `model_card.md` (T15) se muestra tal cual. Mientras
 * no exista, se genera una desde `summary.json`, que T10 publica como tarjeta del
 * paquete; así la página nunca muestra datos que no vengan del artefacto publicado.
 */

interface SummaryFile {
  best_epoch?: number;
  stopped_epoch?: number;
  stop_reason?: string;
  early_stopping?: { monitor?: string; patience?: number; min_delta?: number };
  best_metrics?: Record<string, number>;
  seeds?: Record<string, number>;
  data?: {
    manifest_sha256?: string;
    classes?: string[];
    counts?: Record<string, Record<string, number>>;
  };
  model?: {
    arch?: {
      backbone?: string;
      hidden_layers?: number[];
      dropout?: number;
      trainable_backbone?: string;
    };
    pretrained_weights?: { source?: string };
    trainable_params?: number;
    total_params?: number;
  };
}

const fmt = (value: number | null | undefined, digits = 4) =>
  typeof value === "number" ? value.toFixed(digits) : "—";

const pct = (value: number | null | undefined) =>
  typeof value === "number" ? `${(value * 100).toFixed(2)} %` : "—";

/** Tarjeta en Markdown a partir de summary.json, la fila publicada y las métricas del run. */
export function summaryToMarkdown(
  row: Pick<PublishedModelRow, "name" | "version" | "runId" | "dvcRelease" | "sha256" | "s3Key">,
  summary: SummaryFile,
  metrics: ModelMetrics,
): string {
  const classes = summary.data?.classes ?? [];
  const arch = summary.model?.arch ?? {};
  const counts = summary.data?.counts ?? {};
  const countRows = classes.map(
    (c) => `| ${c} | ${counts.train?.[c] ?? "—"} | ${counts.val?.[c] ?? "—"} |`,
  );
  const es = summary.early_stopping ?? {};
  return [
    `# ${row.name} ${row.version}`,
    "",
    "> Tarjeta generada desde `summary.json` del paquete publicado. La tarjeta completa",
    "> (`model_card.md`) la agrega T15.",
    "",
    "## Propósito",
    "",
    `Clasificador de recortes de objetos (${classes.join(", ") || "clases no declaradas"}) obtenidos de cajas COCO.`,
    "",
    "## Origen",
    "",
    `- Run de MLflow: \`${row.runId}\``,
    `- Release DVC del dataset: \`${row.dvcRelease ?? "—"}\``,
    `- Manifiesto 70/20/10 (SHA-256): \`${summary.data?.manifest_sha256 ?? "—"}\``,
    `- Paquete: \`${row.s3Key}\` · pesos SHA-256 \`${row.sha256}\``,
    "",
    "## Arquitectura",
    "",
    `- Backbone: ${arch.backbone ?? "—"} (${summary.model?.pretrained_weights?.source ?? "—"}), capas entrenables: ${arch.trainable_backbone ?? "—"}`,
    `- Cabeza: capas ocultas ${JSON.stringify(arch.hidden_layers ?? [])}, dropout ${arch.dropout ?? "—"}`,
    `- Parámetros entrenables: ${summary.model?.trainable_params ?? "—"} de ${summary.model?.total_params ?? "—"}`,
    "",
    "## Entrenamiento",
    "",
    `- Mejor época ${summary.best_epoch ?? "—"}; paró en la ${summary.stopped_epoch ?? "—"} por ${summary.stop_reason ?? "—"}`,
    `- Early stopping: ${es.monitor ?? "—"}, patience ${es.patience ?? "—"}, min_delta ${es.min_delta ?? "—"}`,
    `- Semillas: ${
      Object.entries(summary.seeds ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "—"
    }`,
    "",
    "| Clase | Recortes train | Recortes val |",
    "|---|---:|---:|",
    ...countRows,
    "",
    "## Desempeño",
    "",
    "| Métrica | Valor |",
    "|---|---:|",
    `| best_val_loss (validación) | ${fmt(metrics.bestValLoss)} |`,
    `| best_val_acc (validación) | ${pct(metrics.bestValAcc)} |`,
    `| Accuracy top-1 (test) | ${pct(metrics.testAccuracy)} |`,
    `| F1 macro (test) | ${pct(metrics.testF1Macro)} |`,
    "",
  ].join("\n");
}

export async function getModelCard(
  store: S3Store,
  row: PublishedModelRow,
  metrics: ModelMetrics,
): Promise<ModelCardResponse> {
  const card = await getObjectBytes(store, modelKey(row.version, MODEL_CARD_FILE, row.name));
  if (card) {
    return {
      version: row.version,
      source: MODEL_CARD_FILE,
      markdown: new TextDecoder().decode(card),
    };
  }
  const summary = await getObjectBytes(store, modelKey(row.version, "summary.json", row.name));
  if (!summary) {
    throw notFound(
      `La versión ${row.version} no tiene model_card.md ni summary.json en ${store.label}`,
    );
  }
  return {
    version: row.version,
    source: "summary.json",
    markdown: summaryToMarkdown(row, JSON.parse(new TextDecoder().decode(summary)), metrics),
  };
}
