import { EvaluationDashboard } from "@/components/EvaluationDashboard";

export const metadata = { title: "Evaluation · Portal MLOps" };

export default async function EvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string | string[] }>;
}) {
  const { model } = await searchParams;
  const initialModel = typeof model === "string" && model.trim() ? model.trim() : null;
  return (
    <main className="container">
      <h1>Evaluation</h1>
      <p className="muted">
        Evaluación final sobre el 10% de test del modelo publicado. Cada cifra se calcula desde
        predictions.csv del run ganador. <code>?model=nombre:versión</code> abre una versión
        específica.
      </p>
      <EvaluationDashboard initialModel={initialModel} />
    </main>
  );
}
