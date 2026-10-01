import "../t13.css";
import { InferenceDashboard } from "@/components/InferenceDashboard";

export const metadata = { title: "Inference · Portal MLOps" };

export default async function InferencePage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const { version } = await searchParams;
  return (
    <main className="container">
      <h1>Inference</h1>
      <p className="muted">
        Clasifica una imagen con una versión publicada. El servicio de inferencia descarga el
        paquete de S3, verifica el SHA-256 de los pesos y aplica el mismo preprocesamiento de la
        evaluación. El resultado se puede enviar a la cola de anotación.
      </p>
      <InferenceDashboard requestedVersion={typeof version === "string" ? version : null} />
    </main>
  );
}
