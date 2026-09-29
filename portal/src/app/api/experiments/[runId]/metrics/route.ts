import { NextResponse } from "next/server";
import { type MetricPoint, metricsQuerySchema, type RunMetricsResponse } from "@/contracts";
import { handleRouteError, notFound, parseOrThrow } from "@/lib/http";
import { getMetricHistory, getRun } from "@/lib/mlflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Métricas por época que se devuelven por defecto (contrato de tracking). */
const DEFAULT_METRICS = ["train_loss", "val_loss"];

/**
 * GET /api/experiments/[runId]/metrics
 * Historial por época de las curvas del run. Por defecto `train_loss` y
 * `val_loss`; se puede pedir otras con `?keys=train_acc,val_acc`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  try {
    const { runId } = await params;
    const url = new URL(request.url);
    const { keys } = parseOrThrow(
      metricsQuerySchema,
      Object.fromEntries(url.searchParams),
      "query",
    );

    // Confirma que el run existe para dar un 404 claro en vez de curvas vacías.
    const run = await getRun(runId);
    if (!run) throw notFound(`No existe el run "${runId}" en MLflow`);

    const requested = keys && keys.length > 0 ? keys : DEFAULT_METRICS;
    const metrics: Record<string, MetricPoint[]> = {};

    await Promise.all(
      requested.map(async (key) => {
        const history = await getMetricHistory(runId, key);
        metrics[key] = history
          .map((m) => ({ step: m.step, value: m.value, timestamp: m.timestamp }))
          .sort((a, b) => a.step - b.step);
      }),
    );

    const body: RunMetricsResponse = { runId, metrics };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
