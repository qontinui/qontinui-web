/**
 * `/admin/coord/gates` is the ONE gates surface — Verification 9 of plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 4.
 *
 * Three separate claims, each of which fails differently:
 *
 *  1. **Pre-condition, not a new capability.** Every action the deleted
 *     `components/operations/GatesPanel` offered was already reachable here,
 *     and this page holds a strict superset. Asserted at the source, against
 *     `GateActions.tsx`, so a regression that quietly drops one of those verbs
 *     is caught — that is the whole reason the panel could be deleted without
 *     porting anything.
 *  2. **The loss is stated where the toggle was.** `exclude_orphans` is
 *     unportable (coord's `/coord/dev-overview` has no such param, and the
 *     filter needs repo state `GateOverviewRow` does not carry), so the page
 *     says orphaned residue is visible rather than dropping the filter in
 *     silence.
 *  3. **One list read survives.** No non-test module imports `useGatesStream`
 *     or `gatesListUrl`, and the operations barrel no longer exports
 *     `GatesPanel`. Grep-level, because that is the level the duplication
 *     lived at.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const getOverview = vi.fn();

vi.mock("@/services/admin-dev-service", () => ({
  adminDevService: {
    getOverview: (...args: unknown[]) => getOverview(...args),
  },
}));
vi.mock("./_components/SummaryCards", () => ({ SummaryCards: () => null }));
vi.mock("./_components/GatesTable", () => ({ GatesTable: () => null }));
vi.mock("./_components/RolloutPanel", () => ({ RolloutPanel: () => null }));
vi.mock("./_components/ShadowReap", () => ({ ShadowReapGroups: () => null }));

import CoordGatesPage from "./page";

const SRC_DIR = join(__dirname, "..", "..", "..", "..", "..");
const GATE_ACTIONS = readFileSync(
  join(__dirname, "_components", "GateActions.tsx"),
  "utf8"
);

function emptyOverview() {
  return {
    generated_at: "2026-08-25T12:00:00+00:00",
    gates: [],
    counts: {
      total: 0,
      open: 0,
      cleared: 0,
      cleared_today: 0,
      failed: 0,
      stale: 0,
      muted: 0,
      snoozed: 0,
      archived: 0,
      would_reap: 0,
    },
    rollouts: {
      auto_merge: { enabled: [], disabled: [] },
      auto_merge_enabled: true,
      features: [],
    },
  };
}

describe("the surviving gates surface", () => {
  beforeEach(() => {
    getOverview.mockReset();
    getOverview.mockResolvedValue(emptyOverview());
  });

  it("still offers every verb the deleted panel had, plus the four it never had", () => {
    // The panel's set. If one of these disappears from GateActions, the
    // consolidation stopped being lossless and this catches it.
    for (const url of [
      "gateApproveUrl",
      "gateReopenUrl",
      "gateMuteUrl",
      "gateUnmuteUrl",
      "gateSnoozeUrl",
    ]) {
      expect(GATE_ACTIONS).toContain(url);
    }
    // The page-only superset — the reason this side won.
    for (const url of [
      "gateRejectUrl",
      "gateForceClearUrl",
      "gateContinuationCancelUrl",
      "gateAudienceUrl",
    ]) {
      expect(GATE_ACTIONS).toContain(url);
    }
  });

  it("says the exclude_orphans filter is gone, where the toggle used to be", async () => {
    render(<CoordGatesPage />);

    const note = await screen.findByTestId("gates-orphans-note");
    // The claim has to be legible without the docblock: what is shown, and
    // that the filter is gone rather than merely unbuilt.
    expect(note.textContent).toMatch(/orphaned gates are shown/i);
    expect(note.textContent).toContain("exclude_orphans");
    // In the filter-control row, beside Archived / Would-reap — not in a
    // footnote at the bottom of the page.
    const archived = screen.getByTestId("gates-archived-toggle");
    expect(note.parentElement).toBe(archived.parentElement);
  });

  it("carries the content anchors the deleted panel owned", async () => {
    render(<CoordGatesPage />);

    await waitFor(() =>
      expect(screen.getByTestId("gates-empty")).toBeInTheDocument()
    );
    expect(
      document.querySelector('[data-content-id="heading-gates"]')
    ).not.toBeNull();
    expect(
      document.querySelector('[data-content-id="gates-empty-state"]')
    ).not.toBeNull();
  });
});

describe("exactly one gates LIST read remains", () => {
  /** Every `.ts`/`.tsx` under `src/`, tests excluded. */
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        sourceFiles(full, out);
      } else if (
        (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
        !entry.includes(".test.")
      ) {
        out.push(full);
      }
    }
    return out;
  }

  const files = sourceFiles(SRC_DIR);

  /**
   * Source with comments removed.
   *
   * `operations/utils.ts` NAMES both deleted symbols in a docblock explaining
   * why they are gone and forbidding a second list read. That note is the
   * point of the delete, not a violation of it — a grep that failed on it
   * would push the next author to remove the explanation.
   */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("finds the src tree it is asserting over", () => {
    // Without this the two greps below would pass vacuously on an empty list.
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(
      join(SRC_DIR, "components", "operations", "utils.ts")
    );
  });

  it("has no module left that reads /operations/gates/list", () => {
    const offenders = files.filter((f) => {
      const src = code(f);
      return (
        /\bfrom\s+["'][^"']*useGatesStream["']/.test(src) ||
        /\bgatesListUrl\b/.test(src) ||
        /\bGATES_LIST_API\b/.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("deleted the panel, its test, and its stream hook outright", () => {
    for (const gone of [
      join(SRC_DIR, "components", "operations", "GatesPanel.tsx"),
      join(SRC_DIR, "components", "operations", "GatesPanel.test.tsx"),
      join(SRC_DIR, "components", "operations", "useGatesStream.ts"),
    ]) {
      expect(existsSync(gone)).toBe(false);
    }
  });

  it("no longer exports GatesPanel from the operations barrel", () => {
    const barrel = readFileSync(
      join(SRC_DIR, "components", "operations", "index.ts"),
      "utf8"
    );
    expect(barrel).not.toContain("GatesPanel");
  });
});
