/**
 * RunHistory renders what coord serves about a run as it is: an unknown or
 * unrecognised verdict with a neutral mark (never the fail cross), evidence
 * given as a string or as `{note, observed}`, the coverage line and each
 * condition that got no verdict, the agent's claimed status only where it
 * disagrees, and the run's unknown reason in its badge (plan
 * `2026-11-06-a-regression-test-run-is-judged-by-what-it-covered-and-a-silent-run-reads-unknown`
 * Phase 1).
 */

import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RunHistory } from "./RunHistory";
import type { Condition, ConditionRun } from "../types";

const TEXTS = [
  "The menu lists no item twice",
  "Every pizza shows a price",
  "The cart total adds up",
  "The checkout button is enabled",
  "The footer names the shop",
];
const CONDITIONS: Condition[] = TEXTS.map((text, i) => ({
  condition_id: `c${i + 1}`,
  group_id: "g1",
  text,
  position: i,
  enabled: true,
}));

/**
 * A run as the wire may carry it. The web proxy passes coord's JSON through
 * unchecked, so a test may hand the page words its types do not list.
 */
function wireRun(fields: Record<string, unknown>): ConditionRun {
  return {
    run_id: "r1",
    status: "unknown",
    trigger: "manual",
    started_at: "2026-11-06T10:00:00Z",
    finished_at: "2026-11-06T10:01:00Z",
    results: [],
    ...fields,
  } as ConditionRun;
}

/** Render the history with these runs, expand every row, and return it. */
async function showRuns(...runs: ConditionRun[]): Promise<HTMLElement> {
  const { container } = render(
    <RunHistory
      groupId="g1"
      conditions={CONDITIONS}
      listRuns={async () => runs}
      getRun={async (id) => runs.find((r) => r.run_id === id) ?? null}
      refreshKey={0}
    />
  );
  const toggles = () =>
    Array.from(
      container.querySelectorAll<HTMLElement>("button[aria-expanded]")
    );
  await waitFor(() => expect(toggles()).toHaveLength(runs.length));
  for (const toggle of toggles()) await userEvent.click(toggle);
  return container;
}

/** The verdict row naming this condition. */
function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("li");
  if (!row) throw new Error(`no row for "${text}"`);
  return row;
}

describe("RunHistory", () => {
  it("draws an unknown verdict with a neutral mark, never XCircle", async () => {
    await showRuns(
      wireRun({
        results: [
          { condition_id: "c1", verdict: "unknown", evidence: "no menu" },
          { condition_id: "c2", verdict: "fail", evidence: "no price" },
        ],
      })
    );
    const unknownRow = rowOf(TEXTS[0]!);
    expect(unknownRow.querySelector(".lucide-circle-x")).toBeNull();
    expect(
      unknownRow.querySelector(".lucide-circle-question-mark")
    ).not.toBeNull();
    expect(within(unknownRow).getByText("Unknown")).toBeTruthy();
    // The control: a fail still draws the cross, so the absence above is real.
    expect(rowOf(TEXTS[1]!).querySelector(".lucide-circle-x")).not.toBeNull();
  });

  it("draws a verdict word it does not recognise neutrally, and names it", async () => {
    await showRuns(
      wireRun({ results: [{ condition_id: "c1", verdict: "skipped" }] })
    );
    const row = rowOf(TEXTS[0]!);
    expect(row.querySelector(".lucide-circle-x")).toBeNull();
    expect(row.querySelector(".lucide-circle-check")).toBeNull();
    expect(within(row).getByText("skipped")).toBeTruthy();
  });

  it("renders evidence given as a string or as {note, observed}", async () => {
    await showRuns(
      wireRun({
        status: "fail",
        results: [
          {
            condition_id: "c1",
            verdict: "pass",
            evidence: "each item appears once",
          },
          {
            condition_id: "c2",
            verdict: "fail",
            evidence: {
              observed: "the margherita shows no price",
              note: "checked on the mobile layout",
            },
          },
        ],
      })
    );
    expect(screen.getByText("each item appears once")).toBeTruthy();
    expect(
      screen.getByText("Observed: the margherita shows no price")
    ).toBeTruthy();
    expect(screen.getByText("Note: checked on the mobile layout")).toBeTruthy();
  });

  it("shows the coverage line and lists each condition that got no verdict", async () => {
    await showRuns(
      wireRun({
        coverage: { expected: 5, reported: 4, unknown: 1, missing: ["c5"] },
        results: [
          { condition_id: "c1", verdict: "pass", evidence: "ok" },
          { condition_id: "c2", verdict: "pass", evidence: "ok" },
          { condition_id: "c3", verdict: "pass", evidence: "ok" },
          { condition_id: "c4", verdict: "pass", evidence: "ok" },
        ],
      })
    );
    expect(
      screen.getByText("4 of 5 conditions reported · 1 unknown")
    ).toBeTruthy();
    const missingRow = rowOf(TEXTS[4]!);
    expect(within(missingRow).getByText("No verdict reported")).toBeTruthy();
    expect(missingRow.querySelector(".lucide-circle-x")).toBeNull();
  });

  it("lists a missing condition once when coord also served it as a result", async () => {
    await showRuns(
      wireRun({
        coverage: { expected: 2, reported: 1, unknown: 1, missing: ["c2"] },
        results: [
          { condition_id: "c1", verdict: "pass", evidence: "ok" },
          { condition_id: "c2", verdict: "unknown" },
        ],
      })
    );
    expect(screen.getAllByText(TEXTS[1]!)).toHaveLength(1);
    expect(screen.queryByText("No verdict reported")).toBeNull();
  });

  it("shows the agent's claimed status only where it differs from the run's", async () => {
    await showRuns(
      wireRun({ run_id: "r1", status: "unknown", claimed_status: "pass" }),
      wireRun({ run_id: "r2", status: "fail", claimed_status: "fail" })
    );
    expect(screen.getByText("Agent claimed: pass")).toBeTruthy();
    expect(screen.queryByText("Agent claimed: fail")).toBeNull();
  });

  it("passes the run's unknown reason and detail to its badge", async () => {
    const container = await showRuns(
      wireRun({
        unknown_reason: "capability_unavailable_in_build",
        unknown_detail: "no_secret_capable_runner",
      })
    );
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe(
      "Unknown — No runner can type this group's credentials yet. Update a " +
        "runner to a build that substitutes secrets."
    );
  });
});
