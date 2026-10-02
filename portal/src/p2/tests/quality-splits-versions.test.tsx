// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  splits: {} as { status: string; data?: unknown; message?: string },
  versions: {} as { status: string; data?: unknown; message?: string },
  diff: {} as { status: string; data?: unknown; message?: string },
}));

vi.mock("../hooks/quality/useQualitySplits", () => ({
  useQualitySplits: () => ({ ...mocks.splits, reload: vi.fn() }),
}));
vi.mock("../hooks/quality/useQualityVersions", () => ({
  useQualityVersions: () => ({ ...mocks.versions, reload: vi.fn() }),
}));
vi.mock("../hooks/quality/useVersionDiff", () => ({
  useVersionDiff: () => ({ ...mocks.diff, reload: vi.fn() }),
}));

import { SplitsPage } from "../pages/quality/SplitsPage";
import { VersionsPage } from "../pages/quality/VersionsPage";

const SPLITS_FIXTURE = {
  datasetVersion: "v1.0.0-demo",
  seed: 42,
  proportions: { train: 0.7, val: 0.15, test: 0.15 },
  assignment: { train: [1, 2, 5, 10, 11, 12], val: [4, 6, 8], test: [3, 7, 9] },
  distribution: [
    { split: "train", total_images: 6, category_counts: { "1": 4, "2": 3, "3": 1 } },
    { split: "val", total_images: 3, category_counts: { "1": 1, "2": 1, "3": 1 } },
    { split: "test", total_images: 3, category_counts: { "1": 1, "2": 1, "3": 1 } },
  ],
  leakage: {
    id_intersection_size: 0,
    cross_split_duplicate_pairs: 0,
    duplicate_groups_within_one_split: 1,
    leaked_image_ids: [],
    all_classes_in_val: true,
    all_classes_in_test: true,
  },
  classCounts: [
    { category_id: 1, distinct_images_before: 6, distinct_images_after: 5 },
    { category_id: 2, distinct_images_before: 5, distinct_images_after: 4 },
    { category_id: 3, distinct_images_before: 3, distinct_images_after: 3 },
  ],
  categories: [
    { id: 1, name: "person" },
    { id: 2, name: "car" },
    { id: 3, name: "dog" },
  ],
};

const VERSIONS_FIXTURE = {
  minimumImagesPerClass: 300,
  versions: [
    {
      version: "v1.0.0",
      createdAt: "2026-09-10T12:00:00+00:00",
      commit: "abc1234",
      dvcRevision: "d3f1a0c9",
      parentVersion: null,
      environments: {
        dev: { status: "pushed", contentHash: "d3f1a0c9" },
        prod: { status: "not_pushed", contentHash: null },
      },
      totals: { images: 3020, annotations: 28100, categories: 3 },
      metrics: {
        smallObjectsPercent: 41.2,
        classImbalanceRatio: 1.08,
        duplicateGroups: 6,
        invalidBoxes: 0,
      },
      classCounts: [
        { categoryId: 1, distinctImages: 1400 },
        { categoryId: 2, distinctImages: 1300 },
        { categoryId: 3, distinctImages: 320 },
      ],
    },
    {
      version: "v1.1.0",
      createdAt: "2026-09-16T12:00:00+00:00",
      commit: "def5678",
      dvcRevision: "aa99be71",
      parentVersion: "v1.0.0",
      environments: {
        dev: { status: "pushed", contentHash: "aa99be71" },
        prod: { status: "pushed", contentHash: "aa99be71" },
      },
      totals: { images: 3390, annotations: 30500, categories: 3 },
      metrics: {
        smallObjectsPercent: 38.6,
        classImbalanceRatio: 1.07,
        duplicateGroups: 4,
        invalidBoxes: 0,
      },
      classCounts: [
        { categoryId: 1, distinctImages: 1600 },
        { categoryId: 2, distinctImages: 1500 },
        { categoryId: 3, distinctImages: 290 },
      ],
    },
  ],
};

const DIFF_FIXTURE = {
  from: "v1.0.0",
  to: "v1.1.0",
  imagesAdded: 370,
  annotationsAdded: 2400,
  smallObjectsPercentDelta: -2.6,
  classImbalanceRatioDelta: -0.01,
  duplicateGroupsDelta: -2,
  invalidBoxesDelta: 0,
  classesThatLeftMinimum: [3],
  classesThatEnteredMinimum: [],
  classCountChanges: [
    { categoryId: 1, from: 1400, to: 1600, delta: 200 },
    { categoryId: 2, from: 1300, to: 1500, delta: 200 },
    { categoryId: 3, from: 320, to: 290, delta: -30 },
  ],
  totals: {
    from: { images: 3020, annotations: 28100, categories: 3 },
    to: { images: 3390, annotations: 30500, categories: 3 },
  },
};

afterEach(cleanup);

beforeEach(() => {
  mocks.splits = { status: "loading" };
  mocks.versions = { status: "loading" };
  mocks.diff = { status: "loading" };
});

/**
 * SPEC-QUALITY-UI-004 — Splits y Versions.
 */
describe("SPEC-QUALITY-UI-004 — Splits", () => {
  it("muestra la distribución por split y la seed usada", () => {
    mocks.splits = { status: "success", data: SPLITS_FIXTURE };
    render(
      <MemoryRouter>
        <SplitsPage />
      </MemoryRouter>,
    );

    const distribution = within(screen.getByTestId("splits-distribution"));
    expect(distribution.getByText("train")).toBeInTheDocument();
    expect(distribution.getByText("val")).toBeInTheDocument();
    expect(distribution.getByText("test")).toBeInTheDocument();
    expect(screen.getByTestId("splits-seed")).toHaveTextContent("42");
  });

  it("declara ausencia de fuga cuando no hay pares cruzados", () => {
    mocks.splits = { status: "success", data: SPLITS_FIXTURE };
    render(
      <MemoryRouter>
        <SplitsPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("splits-leakage")).toHaveTextContent(/sin fuga/i);
  });

  it("muestra el conteo antes/después de colapsar duplicados", () => {
    mocks.splits = { status: "success", data: SPLITS_FIXTURE };
    render(
      <MemoryRouter>
        <SplitsPage />
      </MemoryRouter>,
    );

    const counts = within(screen.getByTestId("splits-class-counts"));
    const personRow = counts.getByTestId("class-count-1");
    expect(personRow).toHaveTextContent("person");
    expect(personRow).toHaveTextContent("6");
    expect(personRow).toHaveTextContent("5");
  });
});

describe("SPEC-QUALITY-UI-005 — Versions", () => {
  it("muestra la línea de tiempo con estado DEV/PROD por versión", () => {
    mocks.versions = { status: "success", data: VERSIONS_FIXTURE };
    mocks.diff = { status: "success", data: DIFF_FIXTURE };
    render(
      <MemoryRouter>
        <VersionsPage />
      </MemoryRouter>,
    );

    const timeline = within(screen.getByTestId("versions-timeline"));
    expect(timeline.getByText("v1.0.0")).toBeInTheDocument();
    expect(timeline.getByText("v1.1.0")).toBeInTheDocument();
    expect(timeline.getAllByText(/prod/i).length).toBeGreaterThan(0);
  });

  it("muestra el diff entre dos versiones", () => {
    mocks.versions = { status: "success", data: VERSIONS_FIXTURE };
    mocks.diff = { status: "success", data: DIFF_FIXTURE };
    render(
      <MemoryRouter>
        <VersionsPage />
      </MemoryRouter>,
    );

    const diff = within(screen.getByTestId("version-diff"));
    expect(diff.getByText(/370/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("version-diff-left-minimum")).getByText("#3"),
    ).toBeInTheDocument();
  });

  it("compara el conteo por clase entre las dos versiones", () => {
    mocks.versions = { status: "success", data: VERSIONS_FIXTURE };
    mocks.diff = { status: "success", data: DIFF_FIXTURE };
    render(
      <MemoryRouter>
        <VersionsPage />
      </MemoryRouter>,
    );

    const classes = within(screen.getByTestId("version-diff-classes"));
    expect(classes.getByTestId("class-diff-1")).toHaveTextContent("#1");
    expect(classes.getByTestId("class-diff-1")).toHaveTextContent("+200");
    expect(classes.getByTestId("class-diff-3")).toHaveTextContent("-30");
  });
});
