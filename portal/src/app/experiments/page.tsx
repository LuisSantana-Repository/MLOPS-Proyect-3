import { ExperimentsDashboard } from "@/components/ExperimentsDashboard";

export const metadata = { title: "Experiments · Portal MLOps" };

export default async function ExperimentsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  const { run } = await searchParams;
  const initialRunId = typeof run === "string" && run.trim() ? run.trim() : null;
  return (
    <main className="container">
      <h1>Experiments</h1>
      <p className="muted">
        Runs de MLflow con sus parámetros, curvas train/val y el candidato por validación.
      </p>
      <ExperimentsDashboard initialRunId={initialRunId} />
    </main>
  );
}
