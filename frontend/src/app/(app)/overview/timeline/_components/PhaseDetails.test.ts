import { describe, expect, it } from "vitest";
import { progressProblem } from "./PhaseDetails";

// Noon UTC on 3 Oct 2026: the 3rd in every timezone, so the test means the
// same thing wherever it runs.
const TODAY = new Date(Date.UTC(2026, 9, 3, 12, 0));

const form = (
  patch: Partial<Parameters<typeof progressProblem>[0]> = {}
): Parameters<typeof progressProblem>[0] => ({
  actual_start: "",
  actual_end: "",
  gate_status: "pending",
  gate_decided_at: "",
  gate_notes: "",
  ...patch,
});

describe("progressProblem — progress records what has happened", () => {
  it("accepts today and tomorrow (the server's one day of slack)", () => {
    expect(
      progressProblem(
        form({
          actual_start: "2026-10-03",
          actual_end: "2026-10-04",
          gate_status: "passed",
          gate_decided_at: "2026-10-04",
        }),
        TODAY
      )
    ).toBeNull();
  });

  it.each([
    ["actual_start", "The start date", { actual_start: "2026-10-05" }],
    [
      "actual_end",
      "The finish date",
      { actual_start: "2026-10-01", actual_end: "2026-10-05" },
    ],
    [
      "gate_decided_at",
      "The gate's decision date",
      { gate_status: "passed" as const, gate_decided_at: "2026-10-05" },
    ],
  ])("refuses %s later than tomorrow, naming it", (_field, label, patch) => {
    const problem = progressProblem(form(patch), TODAY);
    expect(problem).toBe(
      `${label} is 5 Oct 2026, which hasn’t happened yet — progress records what has happened, so it can be 4 Oct 2026 at the latest.`
    );
  });

  it("catches a year typo even when the rest is coherent", () => {
    expect(
      progressProblem(form({ actual_start: "2027-01-05" }), TODAY)
    ).toMatch(/^The start date is 5 Jan 2027, which hasn’t happened yet/);
  });

  it("checks the future before coherence, as the server does", () => {
    // Finished with no start AND in the future: the date is what is named.
    expect(progressProblem(form({ actual_end: "2026-12-01" }), TODAY)).toMatch(
      /^The finish date is 1 Dec 2026/
    );
  });

  it("still refuses incoherent progress", () => {
    expect(progressProblem(form({ actual_end: "2026-10-01" }), TODAY)).toMatch(
      /without having started/
    );
    expect(progressProblem(form({ gate_status: "waived" }), TODAY)).toBe(
      "Give the day the gate was decided."
    );
  });

  it("defaults today to the browser's clock", () => {
    expect(progressProblem(form({ actual_start: "2999-01-01" }))).toMatch(
      /hasn’t happened yet/
    );
    expect(progressProblem(form({ actual_start: "2000-01-01" }))).toBeNull();
  });
});

describe("progressProblem — the server's day, not the browser's", () => {
  // The server allows UTC today + 1. Whatever the browser's own calendar
  // says, the form must accept exactly that.
  it("late on the 3rd UTC (already the 4th east of UTC) refuses the 5th", () => {
    const now = new Date(Date.UTC(2026, 9, 3, 23, 30));
    expect(progressProblem(form({ actual_start: "2026-10-05" }), now)).toMatch(
      /can be 4 Oct 2026 at the latest/
    );
  });

  it("early on the 3rd UTC (still the 2nd west of UTC) accepts the 4th", () => {
    const now = new Date(Date.UTC(2026, 9, 3, 0, 30));
    expect(
      progressProblem(form({ actual_start: "2026-10-04" }), now)
    ).toBeNull();
  });
});
