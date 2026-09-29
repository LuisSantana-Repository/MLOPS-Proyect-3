import { describe, expect, it } from "vitest";
import { JOB_STATUSES } from "@/contracts";
import { isTerminal, STATUS_LABELS } from "./jobs";

describe("isTerminal", () => {
  it("solo succeeded, failed y canceled detienen la consulta", () => {
    expect(JOB_STATUSES.filter(isTerminal)).toEqual(["succeeded", "failed", "canceled"]);
  });

  it("todos los estados tienen etiqueta", () => {
    for (const s of JOB_STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
  });
});
