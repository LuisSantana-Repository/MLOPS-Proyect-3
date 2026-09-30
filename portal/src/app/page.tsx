import Link from "next/link";

export default function Home() {
  return (
    <main className="container">
      <h1>Portal MLOps — Proyecto 3</h1>
      <ul>
        <li>
          <Link href="/training">Training</Link>: elegir release, configurar parámetros y lanzar un
          job.
        </li>
        <li>
          <Link href="/experiments">Experiments</Link>: comparar runs, ver curvas y el candidato.
        </li>
        <li>
          <Link href="/evaluation">Evaluation</Link>: métricas de test, matriz de confusión y
          errores.
        </li>
      </ul>
    </main>
  );
}
