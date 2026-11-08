/**
 * `report-scorecard` on the Summary (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3,
 * D5): an accessible score table at the chosen stop, each score with its
 * change as a shape plus a word, an unmeasured score as "not measured" with
 * its reason, and the stop's source and as-of. Entered through
 * `IntentSection`, the way the Summary renders its description.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listResource: vi.fn(),
  fetchReportView: vi.fn(),
  fetchChangeLog: vi.fn(async () => ({ entries: [], truncated: false })),
}));
vi.mock("@/components/overview/editing/api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => null,
}));

import {
  InIntentSection,
  atAddress,
  fence,
  serveReports,
} from "./__fixtures__/render";
import { SLUG, reportView } from "./__fixtures__/reportView";

const SCORECARD = fence(
  "report-scorecard",
  `report: ${SLUG}`,
  "table: scorecard"
);

function cellAt(row: string, column: string) {
  return document.querySelector(
    `[data-ui-bridge-id="overview.report.${SLUG}.scorecard.scorecard.cell.${row}.${column}"]`
  ) as HTMLElement | null;
}

async function shown() {
  return screen.findByRole("table", { name: /Architecture scorecard/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  atAddress();
  serveReports(api, [reportView()]);
});

describe("report-scorecard", () => {
  it("renders the table with its headers, scores and scale, and the stop's source and as-of", async () => {
    render(<InIntentSection body={SCORECARD} />);
    const table = await shown();
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.firstChild?.textContent)
    ).toEqual(["Part", "Clarity", "Leanness"]);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((h) => h.firstChild?.textContent)
    ).toEqual(["Intake", "Billing", "Overall"]);
    expect(table.querySelector("caption")?.textContent).toMatch(
      /Scale 1 to 5, higher is better, target 5\./
    );
    // The newest stop: Re-review.
    expect(cellAt("intake", "clarity")?.textContent).toMatch(/^4/);
    expect(cellAt("overall", "clarity")?.textContent).toMatch(/^3\.5/);
    const block = table.closest("[data-overview-block]")!;
    expect(block.querySelector("[data-provenance]")?.textContent).toMatch(
      /^source: Full review: Independent architecture review · as of /
    );
    // Which report and which stop, so a block on its own says what it shows.
    expect(block.textContent).toMatch(
      /Platform review: progress · Re-review, 20 Nov 2026 · Full review/
    );
  });

  it("gives every score its change as a shape and a word, never colour alone", async () => {
    render(<InIntentSection body={SCORECARD} />);
    await shown();
    const up = cellAt("intake", "clarity")!.querySelector("[data-delta]")!;
    expect(up.getAttribute("data-delta")).toBe("up");
    expect(up.textContent).toMatch(
      /^↑up: up from 3 to 4 since Checkpoint 1 \(better\)$/
    );
    // A score that did not move says so.
    const same = cellAt("billing", "clarity")!.querySelector("[data-delta]")!;
    expect(same.getAttribute("data-delta")).toBe("same");
    expect(same.textContent).toMatch(/^=no change/);
    // Measured again after a stop that did not measure it: not up, not down.
    const back = cellAt("billing", "leanness")!.querySelector("[data-delta]")!;
    expect(back.getAttribute("data-delta")).toBe("unknown");
    expect(back.textContent).toMatch(
      /^\?unknown: not measured at Checkpoint 1/
    );
    // Every mark carries its word in a neutral tone: no colour class at all.
    for (const mark of document.querySelectorAll("[data-delta]")) {
      expect(mark.className).not.toMatch(/(red|green|emerald|amber)-/);
      expect(mark.textContent?.trim()).not.toBe(
        mark.querySelector("[aria-hidden]")?.textContent
      );
    }
  });

  it("says 'not measured' and why for a score the stop did not measure — never 0, a dash or a blank", async () => {
    atAddress(`?at.${SLUG}=2`);
    render(<InIntentSection body={SCORECARD} />);
    await shown();
    await waitFor(() =>
      expect(cellAt("intake", "clarity")?.textContent).toMatch(/^3/)
    );
    const cell = cellAt("billing", "leanness")!;
    const unmeasured = cell.querySelector("[data-not-measured]")!;
    expect(unmeasured.textContent).toBe(
      "not measured — not re-scored by a light check"
    );
    expect(unmeasured.getAttribute("title")).toBe(
      "not re-scored by a light check"
    );
    expect(cell.textContent).not.toMatch(/\b0\b|—\s*$|^\s*-\s*$/);
    expect(cell.textContent?.trim()).not.toBe("");
    // A score that stopped being measured is an unknown move, not a drop.
    expect(cell.querySelector("[data-delta]")?.getAttribute("data-delta")).toBe(
      "unknown"
    );
  });

  it("shows no changes on the first stop, and says why", async () => {
    atAddress(`?at.${SLUG}=1`);
    render(<InIntentSection body={SCORECARD} />);
    await shown();
    await waitFor(() =>
      expect(cellAt("intake", "clarity")?.textContent).toBe("2")
    );
    expect(document.querySelector("[data-delta]")).toBeNull();
    expect(
      screen.getByText(/first stop, so no changes are shown/)
    ).toBeTruthy();
  });

  it("says when the chosen stop has no such table", async () => {
    render(
      <InIntentSection
        body={fence(
          "report-scorecard",
          `report: ${SLUG}`,
          "table: no-such-table"
        )}
      />
    );
    expect(await screen.findByText(/This stop has no table/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when the report does not exist in this project", async () => {
    render(
      <InIntentSection
        body={fence(
          "report-scorecard",
          "report: no-such-report",
          "table: scorecard"
        )}
      />
    );
    expect(await screen.findByText(/No report named/)).toBeTruthy();
    expect(screen.getByText("no-such-report")).toBeTruthy();
  });

  it("says the report can't be read when the store answered without seeing its data — never that it is missing", async () => {
    api.listResource.mockResolvedValue({
      items: [],
      total: 0,
      can_edit: false,
      degraded: "the overview store is not ready",
    });
    render(<InIntentSection body={SCORECARD} />);
    expect(
      await screen.findByText("This report can't be read right now.")
    ).toBeTruthy();
    expect(screen.queryByText(/No report named/)).toBeNull();
  });
});
