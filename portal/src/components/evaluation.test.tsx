import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TestEvaluation, TestPrediction } from "@/contracts";
import type { DefaultModelChoice } from "@/lib/ui/evaluation";
import { ClassMetricsTable } from "./ClassMetricsTable";
import { ConfusionHeatmap } from "./ConfusionHeatmap";
import {
  BaselineComparison,
  DatasetVersion,
  DefaultModelNotice,
  EvaluationDashboard,
  majorityBaseline,
  WinnerBadge,
} from "./EvaluationDashboard";
import { MetricCards } from "./MetricCards";
import {
  countOutcomes,
  filterPredictions,
  PAGE_SIZE,
  PredictionGallery,
  paginate,
} from "./PredictionGallery";

const test: TestEvaluation = {
  source: "mlflow",
  classes: ["person", "car"],
  nSamples: 135,
  accuracy: 0.9259,
  f1Macro: 0.9231,
  meetsTarget: true,
  target: 0.85,
  perClass: {
    person: { precision: 0.94, recall: 0.94, f1: 0.94, support: 81 },
    car: { precision: 0.907, recall: 0.907, f1: 0.907, support: 54 },
  },
  confusionMatrix: {
    labels: ["person", "car"],
    matrix: [
      [76, 5],
      [5, 49],
    ],
  },
  errors: [
    {
      cropPath: "crops/12_345.jpg",
      annId: "345",
      imageId: "12",
      yTrue: "car",
      yPred: "person",
      confidence: 0.91,
      probabilities: { person: 0.91, car: 0.09 },
    },
  ],
  checks: [{ metric: "test_accuracy", computed: 0.9259, logged: 0.9259, matches: true }],
};

describe("MetricCards", () => {
  it("accuracy con meta de 85% cumplida y F1 macro", () => {
    const html = renderToStaticMarkup(<MetricCards test={test} />);
    expect(html).toContain("92.6%");
    expect(html).toContain("Cumple la meta (≥ 85%)");
    expect(html).toContain("0.9231");
    expect(html).toContain("135");
  });

  it("avisa cuando no llega a la meta", () => {
    const html = renderToStaticMarkup(
      <MetricCards test={{ ...test, accuracy: 0.8, meetsTarget: false }} />,
    );
    expect(html).toContain("80.0%");
    expect(html).toContain("No llega a la meta (≥ 85%)");
  });
});

describe("ClassMetricsTable", () => {
  it("precisión, recall, F1 y soporte por clase", () => {
    const html = renderToStaticMarkup(<ClassMetricsTable test={test} />);
    for (const text of ["person", "car", "0.9400", "0.9070", ">81<", ">54<"])
      expect(html).toContain(text);
  });
});

describe("ConfusionHeatmap", () => {
  it("tabla accesible con el número en cada celda", () => {
    const html = renderToStaticMarkup(<ConfusionHeatmap confusion={test.confusionMatrix} />);
    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    for (const n of [">76<", ">5<", ">49<"]) expect(html).toContain(n);
    expect(html).toContain('aria-label="real person, predicha car: 5 (6.2% de person)"');
  });
});

/** 135 casos como el test real: 128 aciertos y 7 errores (car→person). */
function testSet(): TestPrediction[] {
  return Array.from({ length: 135 }, (_, i) => {
    const yTrue = i < 81 ? "person" : "car";
    const yPred = i >= 128 ? "person" : yTrue;
    return {
      cropPath: `crops/${i}_${1000 + i}.jpg`,
      annId: String(1000 + i),
      imageId: String(i),
      yTrue,
      yPred,
      confidence: 0.9,
      probabilities: { person: yPred === "person" ? 0.9 : 0.1, car: yPred === "car" ? 0.9 : 0.1 },
    };
  });
}

describe("PredictionGallery (4.4)", () => {
  it("cuenta 128 aciertos y 7 errores y filtra por resultado y clases", () => {
    const all = testSet();
    expect(countOutcomes(all)).toEqual({ correct: 128, error: 7 });
    expect(filterPredictions(all, { outcome: "correct", yTrue: "", yPred: "" })).toHaveLength(128);
    expect(filterPredictions(all, { outcome: "error", yTrue: "", yPred: "" })).toHaveLength(7);
    expect(filterPredictions(all, { outcome: "all", yTrue: "car", yPred: "person" })).toHaveLength(
      7,
    );
    expect(filterPredictions(all, { outcome: "correct", yTrue: "car", yPred: "" })).toHaveLength(
      47,
    );
    expect(filterPredictions(all, { outcome: "error", yTrue: "person", yPred: "" })).toHaveLength(
      0,
    );
  });

  it("pagina los 135 casos sin perder ninguno", () => {
    const all = testSet();
    const pages = paginate(all, 0).pages;
    expect(pages).toBe(Math.ceil(135 / PAGE_SIZE));
    const seen = Array.from({ length: pages }, (_, i) => paginate(all, i).items).flat();
    expect(seen).toEqual(all);
    expect(paginate(all, 99).page).toBe(pages - 1); // se ajusta al rango
    expect(paginate([], 0)).toEqual({ items: [], page: 0, pages: 1 });
  });

  it("cada tarjeta muestra recorte, real, predicha, probabilidad y si es acierto o error", () => {
    const html = renderToStaticMarkup(
      <PredictionGallery predictions={testSet()} classes={["person", "car"]} />,
    );
    expect(html).toContain("135 casos de test: 128 aciertos y 7 errores.");
    expect(html).toContain('src="/api/crops/crops/0_1000.jpg"');
    expect(html).toContain('alt="Recorte 1000: real person, predicho person"');
    expect(html).toContain("Acierto");
    expect(html).toContain("90.0%");
    for (const id of ["filter-outcome", "filter-true", "filter-pred"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain(`Página 1 de ${Math.ceil(135 / PAGE_SIZE)}`);
    expect(html.match(/class="gallery-item"/g)).toHaveLength(PAGE_SIZE);
  });
});

describe("Versión del dataset y baseline (6.3, 4.4)", () => {
  it("muestra el release y los hashes DVC de los datos", () => {
    const html = renderToStaticMarkup(
      <DatasetVersion
        dataset={{
          release: "proyecto2 v1.1.0@dc9376e",
          rawDvcMd5: "1fdb1dcea3218ad2fb0edf985984a929.dir",
          annotationsMd5: "72e5f4025c4dbe7eb1e2420a9b4dbf9a",
          manifestDvcMd5: "e75a07ce3b75455514f044b23e0d1b29",
          manifestSha256: null,
        }}
      />,
    );
    expect(html).toContain("proyecto2 v1.1.0@dc9376e");
    expect(html).toContain("1fdb1dcea3218ad2fb0edf985984a929.dir");
    expect(html).toContain("e75a07ce3b75455514f044b23e0d1b29");
    expect(html).toContain(">—</code>"); // sin dato, no se inventa
  });

  it("baseline de clase mayoritaria: siempre person = 60 % y la mejora del modelo", () => {
    expect(majorityBaseline(test)).toEqual({ className: "person", accuracy: 81 / 135 });
    const html = renderToStaticMarkup(<BaselineComparison test={test} />);
    expect(html).toContain("<code>person</code>");
    expect(html).toContain("60.0%");
    expect(html).toContain("32.6 pp por encima");
  });
});

describe("Ganador (T07)", () => {
  const winnerChoice: DefaultModelChoice = {
    key: "clasificador:1",
    reason: "winner",
    winnerKey: "clasificador:1",
    newerNonWinnerKey: "clasificador:2",
  };

  it("WinnerBadge marca el ganador", () => {
    expect(renderToStaticMarkup(<WinnerBadge />)).toContain("Ganador (T07)");
  });

  it("avisa si hay una versión más reciente que no es la ganadora, con enlace a /experiments", () => {
    const html = renderToStaticMarkup(
      <DefaultModelNotice choice={winnerChoice} shownKey="clasificador:1" />,
    );
    expect(html).toContain("<code>clasificador:2</code>");
    expect(html).toContain("no es la ganadora y no tiene evaluación de test");
    expect(html).toContain('href="/experiments"');
  });

  it("no repite el aviso si ya se está viendo esa versión", () => {
    const html = renderToStaticMarkup(
      <DefaultModelNotice choice={winnerChoice} shownKey="clasificador:2" />,
    );
    expect(html).not.toContain("más reciente");
  });

  it("sin aviso cuando el ganador es la versión más reciente", () => {
    const html = renderToStaticMarkup(
      <DefaultModelNotice
        choice={{ ...winnerChoice, newerNonWinnerKey: null }}
        shownKey="clasificador:1"
      />,
    );
    expect(html).toBe("");
  });

  it("dice que no hay ganador congelado y que se usa la versión READY más reciente", () => {
    const choice: DefaultModelChoice = {
      key: "clasificador:2",
      reason: "latest-ready",
      winnerKey: null,
      newerNonWinnerKey: null,
    };
    const html = renderToStaticMarkup(
      <DefaultModelNotice choice={choice} shownKey="clasificador:2" />,
    );
    expect(html).toContain("reports/t07/selection.json");
    expect(html).toContain("READY más reciente");
  });
});

describe("EvaluationDashboard", () => {
  it("empieza cargando, sin datos inventados", () => {
    expect(renderToStaticMarkup(<EvaluationDashboard initialModel={null} />)).toContain(
      "Cargando modelos",
    );
  });
});
