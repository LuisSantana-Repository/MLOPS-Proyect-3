import type { TestEvaluation } from "@/contracts";

/** Precisión, recall, F1 y soporte por clase. */
export function ClassMetricsTable({ test }: { test: TestEvaluation }) {
  return (
    <table className="table compact">
      <caption className="muted">Métricas por clase (test)</caption>
      <thead>
        <tr>
          <th scope="col">Clase</th>
          <th scope="col" className="num">
            Precisión
          </th>
          <th scope="col" className="num">
            Recall
          </th>
          <th scope="col" className="num">
            F1
          </th>
          <th scope="col" className="num">
            Soporte
          </th>
        </tr>
      </thead>
      <tbody>
        {test.classes.map((cls) => {
          const m = test.perClass[cls];
          return (
            <tr key={cls}>
              <th scope="row">{cls}</th>
              <td className="num">{m.precision.toFixed(4)}</td>
              <td className="num">{m.recall.toFixed(4)}</td>
              <td className="num">{m.f1.toFixed(4)}</td>
              <td className="num">{m.support}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
