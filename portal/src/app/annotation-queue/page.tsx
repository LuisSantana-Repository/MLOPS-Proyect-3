import "../t13.css";
import { AnnotationQueueDashboard } from "@/components/AnnotationQueueDashboard";

export const metadata = { title: "Cola de anotación · Portal MLOps" };

export default function AnnotationQueuePage() {
  return (
    <main className="container">
      <h1>Cola de anotación</h1>
      <p className="muted">
        Imágenes enviadas desde Inference para que un anotador confirme o corrija la clase sugerida
        por el modelo (equivale a las imágenes pendientes del portal del Proyecto 2).
      </p>
      <AnnotationQueueDashboard />
    </main>
  );
}
