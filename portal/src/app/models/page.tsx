import "../t13.css";
import { ModelsDashboard } from "@/components/ModelsDashboard";

export const metadata = { title: "Models · Portal MLOps" };

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const { version } = await searchParams;
  const initialVersion = typeof version === "string" && version.trim() ? version.trim() : null;
  return (
    <main className="container">
      <h1>Models</h1>
      <p className="muted">
        Versiones del modelo publicadas en S3 (T10): run de origen en MLflow, release DVC del
        dataset, llave S3, hash de los pesos y tarjeta del modelo. Solo los paquetes verificados en
        S3 se pueden descargar o usar en Inference. <code>?version=</code> abre una versión.
      </p>
      <ModelsDashboard initialVersion={initialVersion} />
    </main>
  );
}
