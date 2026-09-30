import { TrainingDashboard } from "@/components/TrainingDashboard";

export const metadata = { title: "Training · Portal MLOps" };

export default function TrainingPage() {
  return (
    <main className="container">
      <h1>Training</h1>
      <p className="muted">
        Elige el release aprobado, ajusta los parámetros y lanza un job. El worker lo entrena y lo
        registra en MLflow.
      </p>
      <TrainingDashboard />
    </main>
  );
}
