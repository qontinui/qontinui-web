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
    const failRow = rowOf(TEXTS[1]!);
    expect(failRow.querySelector(".lucide-circle-x")).not.toBeNull();
    // A screen reader hears the verdict the cross shows.
    expect(within(failRow).getByText("Fail").classList).toContain("sr-only");
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
    expect(
      missingRow.querySelector(".lucide-circle-question-mark")
    ).not.toBeNull();
    expect(missingRow.querySelector(".lucide-circle-check")).toBeNull();
    expect(missingRow.querySelector(".lucide-circle-x")).toBeNull();
    // The control: a reported pass does draw the check, so the absence of one
    // on the missing row is real.
    const passRow = rowOf(TEXTS[0]!);
    expect(passRow.querySelector(".lucide-circle-check")).not.toBeNull();
    // A screen reader hears the verdict the check shows.
    expect(within(passRow).getByText("Pass").classList).toContain("sr-only");
  });

  it("lists each missing condition once, even when coord also served it as a result or named it twice", async () => {
    await showRuns(
      wireRun({
        coverage: {
          expected: 3,
          reported: 1,
          unknown: 2,
          missing: ["c2", "c3", "c3"],
        },
        results: [
          { condition_id: "c1", verdict: "pass", evidence: "ok" },
          { condition_id: "c2", verdict: "unknown" },
        ],
      })
    );
    expect(screen.getAllByText(TEXTS[1]!)).toHaveLength(1);
    expect(screen.getAllByText(TEXTS[2]!)).toHaveLength(1);
    expect(screen.getAllByText("No verdict reported")).toHaveLength(1);
  });

  it("ignores a coverage.missing that is not an array", async () => {
    await showRuns(
      wireRun({
        coverage: {
          expected: 1,
          reported: 0,
          unknown: 1,
          missing: { c1: true },
        },
      })
    );
    expect(
      screen.getByText("0 of 1 condition reported · 1 unknown")
    ).toBeTruthy();
    expect(screen.queryByText("No verdict reported")).toBeNull();
    expect(
      screen.getByText("No per-condition results recorded for this run.")
    ).toBeTruthy();
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
    const run = wireRun({
      unknown_reason: "capability_unavailable_in_build",
      unknown_detail: "no_secret_capable_runner",
    });
    const { container } = render(
      <RunHistory
        groupId="g1"
        conditions={CONDITIONS}
        listRuns={async () => [run]}
        getRun={async () => run}
        refreshKey={0}
      />
    );
    await waitFor(() =>
      expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe(
        "Unknown — No runner can type this group's credentials yet. Update " +
          "a runner to a build that substitutes secrets."
      )
    );
  });

  it("reads its header and footer from the same run snapshot as the expanded body", async () => {
    // The list row was read while the run was still running, so it carries no
    // results and no finish time; expanding it fetches the run as it is now.
    const listed = wireRun({
      status: "running",
      results: null,
      finished_at: null,
    });
    const fetched = wireRun({
      unknown_reason: "no_event_before_timeout",
      unknown_detail: "no_report_within_deadline",
    });
    const started = new Date("2026-11-06T10:00:00Z").toLocaleString();
    const finished = new Date("2026-11-06T10:01:00Z").toLocaleString();
    const { container } = render(
      <RunHistory
        groupId="g1"
        conditions={CONDITIONS}
        listRuns={async () => [listed]}
        getRun={async () => fetched}
        refreshKey={0}
      />
    );
    const badgeText = () =>
      container.querySelector('[data-slot="badge"]')?.textContent;
    const headerTiming = () =>
      container.querySelector("button[aria-expanded] .ml-auto")?.textContent;
    await waitFor(() => expect(badgeText()).toBe("Running"));
    expect(headerTiming()).toBe(started);
    await userEvent.click(
      container.querySelector<HTMLElement>("button[aria-expanded]")!
    );
    await waitFor(() =>
      expect(badgeText()).toBe(
        "Unknown — The check agent sent no report before the run's " +
          "deadline. Check that the runner paired to this project is " +
          "online, then run the group again."
      )
    );
    // The fetched run has ended: the header shows its duration and the footer
    // its finish time, not the list row's.
    expect(headerTiming()).toBe(`${started} · 1m 0s`);
    expect(screen.getByText(`Finished: ${finished}`)).toBeTruthy();
  });

  it("shows a neutral placeholder for a verdict whose condition the report did not name", async () => {
    await showRuns(
      wireRun({
        results: [
          { condition_id: null, verdict: "fail", evidence: "no price" },
        ],
      })
    );
    const placeholder = screen.getByText("Condition not named in the report");
    expect(placeholder.classList.contains("text-muted-foreground")).toBe(true);
    // The verdict itself still renders, evidence included.
    expect(placeholder.closest("li")?.textContent).toContain("no price");
  });
});
