import { NextResponse } from "next/server";
import { type ListExperimentsResponse, listExperimentsQuerySchema } from "@/contracts";
import { env } from "@/lib/env";
import { handleRouteError, notFound, parseOrThrow } from "@/lib/http";
import { getExperimentIdByName, searchRuns } from "@/lib/mlflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/experiments
 * Lista los runs de un experimento desde la REST API de MLflow, con sus
 * parámetros y métricas finales. `experiment` por defecto es el del proyecto.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const query = parseOrThrow(
      listExperimentsQuerySchema,
      Object.fromEntries(url.searchParams),
      "query",
    );

    const experiment = query.experiment ?? env.MLFLOW_EXPERIMENT;
    const experimentId = await getExperimentIdByName(experiment);
    if (experimentId === null) {
      throw notFound(`No existe el experimento "${experiment}" en MLflow`);
    }

    // Por defecto solo runs de selección (T06/T07): del sweep y FINISHED,
    // ordenados por best_val_loss ascendente (métrica de selección acordada).
    // Nota: el descarte de "smoke" NO va en el filtro de MLflow. Un `tags.smoke
    // != 'true'` excluye también los runs que no tienen el tag (semántica de
    // MLflow), así que se filtra del lado del cliente tras la búsqueda.
    const filter = query.onlySelected
      ? [`tags.sweep = '${query.sweep}'`, "attributes.status = 'FINISHED'"].join(" and ")
      : undefined;
    const orderBy = query.onlySelected
      ? ["metrics.best_val_loss ASC"]
      : ["attributes.start_time DESC"];

    const { runs, nextPageToken } = await searchRuns({
      experimentIds: [experimentId],
      maxResults: query.maxResults,
      pageToken: query.pageToken,
      filter,
      orderBy,
    });

    // Descarta runs de humo (smoke=true) cuando se piden solo los de selección.
    const selectedRuns = query.onlySelected
      ? runs.filter((run) => run.tags.smoke !== "true")
      : runs;

    const body: ListExperimentsResponse = {
      experiment,
      runs: selectedRuns,
      nextPageToken,
      selection: {
        onlySelected: query.onlySelected,
        sweep: query.onlySelected ? query.sweep : null,
        orderedBy: query.onlySelected ? "best_val_loss ASC" : "start_time DESC",
      },
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
