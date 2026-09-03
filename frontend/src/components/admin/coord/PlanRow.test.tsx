/**
 * PlanRow render tests — the status tag as it actually reaches the DOM, plus
 * the two contracts the Wave 1 migration had to hold.
 *
 * Ported from `PlanCard.test.tsx`, which was DELETED in Wave 2 along with the
 * card itself once `/history` — its last renderer — moved onto `<PlanRow>`.
 * Every case it held is reproduced below. The pure-function coverage lives in
 * `planStatus.test.ts`; this asserts the ROW wires it through, because the
 * original defect was a rendering one: `shipped` and `in_progress` both
 * resolved to `variant="default"` and so painted identically on screen.
 *
 * The two new contracts:
 *   - **D4a** — every `data-testid` `PlanCard` authored is still emitted, on
 *     the equivalent new element. `coord-plan-card-dates`,
 *     `coord-plan-card-link` and `coord-plan-card-spawn-btn` moved INTO the
 *     expanded detail, so they are asserted with the row expanded.
 *   - **R5** — a collapsed row shows the status and nothing else; the fields
 *     appear on expansion. A row that renders its detail while collapsed has
 *     not actually been migrated.
 *
 * Plus the date contract from plan
 * `2026-09-02-coord-work-units-carry-no-authoring-date`: the row's time is
 * shipped → authored → ingested and NEVER `updated_at` (a scanner touch every
 * ~68 s, which had every plan reading "Updated 1m ago"); the detail names each
 * date by what it is; an absent authoring date is said, not filled in.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanRow } from "./PlanRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function renderRow(
  plan: Parameters<typeof PlanRow>[0]["plan"],
  expanded = false
) {
  return render(
    <PlanRow plan={plan} expanded={expanded} onToggle={() => {}} />
  );
}

describe("PlanRow status tag", () => {
  it("renders SHIPPED in green, and not as the raw enum", () => {
    renderRow({ slug: "p-1", status: "shipped" });
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("Shipped");
    expect(tag.firstElementChild?.className).toContain("green");
    expect(tag).toHaveAttribute("data-tone", "shipped");
  });

  it("renders in-progress visually DISTINCT from shipped", () => {
    const { unmount } = renderRow({ slug: "p-1", status: "shipped" });
    const shippedClass =
      screen.getByTestId("coord-plan-status-tag").firstElementChild?.className;
    unmount();

    renderRow({ slug: "p-2", status: "in_progress" });
    const activeClass =
      screen.getByTestId("coord-plan-status-tag").firstElementChild?.className;

    expect(activeClass).not.toBe(shippedClass);
    expect(screen.getByTestId("coord-plan-status-tag")).toHaveTextContent(
      "In progress"
    );
  });

  it("shows an unknown status verbatim and marks it unrecognised", () => {
    renderRow({ slug: "p-3", status: "weird_new_state" });
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("weird_new_state");
    expect(tag).toHaveAttribute("data-recognised", "false");
    expect(tag).toHaveAttribute("data-tone", "unknown");
  });

  it("renders a tag even when coord sent no status at all", () => {
    // Previously the badge was omitted entirely, so "no status" and "not
    // loaded yet" looked the same.
    renderRow({ slug: "p-4" });
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("No status");
    expect(tag).toHaveAttribute("data-recognised", "false");
  });
});

/** The row's own time cell — the ONE `row-time` outside the detail panel. */
function rowTimeCell(): HTMLElement {
  const [cell] = screen.getAllByTestId("row-time");
  return cell;
}

describe("PlanRow detail (R5) and the frozen testids (D4a)", () => {
  const plan = {
    slug: "2026-08-16-p-5",
    status: "draft",
    title: "A plan with a title",
    authored_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
    // Ingested a day after it was written; touched by the scanner an hour ago.
    created_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    updated_at: new Date(Date.now() - 3600_000).toISOString(),
  };

  it("keeps the detail OUT of the DOM while collapsed", () => {
    renderRow(plan, false);
    expect(screen.getByTestId("coord-plan-card")).toBeInTheDocument();
    expect(screen.queryByTestId("coord-plan-card-dates")).toBeNull();
    expect(screen.queryByTestId("coord-plan-card-link")).toBeNull();
    expect(screen.queryByTestId("coord-plan-card-spawn-btn")).toBeNull();
  });

  it("surfaces the authoring date once expanded, with the scanner touch labelled", () => {
    renderRow(plan, true);
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/authored 3d ago/);
    expect(dates).toHaveTextContent(/updated 1h ago/);
    // The ingest date is not the authoring date and is not shown under any
    // name once the authoring date is known; "created" is gone entirely.
    expect(dates).not.toHaveTextContent(/created/);
  });

  it("shows the AUTHORED time in the row, not the much newer scanner touch", () => {
    // The regression the plan fixes: `updated_at` is bumped every ~68 s by the
    // runner's scanner, so a row timed on it read "1h ago" for a plan written
    // three days earlier — for as long as the file existed.
    renderRow(plan, false);
    const cell = rowTimeCell();
    expect(cell).toHaveTextContent("3d ago");
    expect(cell).toHaveAttribute("title", expect.stringMatching(/^Authored /));
  });

  it("falls back to the INGEST date under its own name when no authoring date is recorded", () => {
    // A coord that predates `authored_at`, or an undated slug. `created_at`
    // is when coord first saw the row — true, so shown — but under
    // "ingested", never "created" and never "authored".
    const ingestOnly = {
      slug: "2026-08-16-p-5b",
      status: "draft",
      created_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
      updated_at: new Date(Date.now() - 3600_000).toISOString(),
    };
    renderRow(ingestOnly, true);
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/ingested 3d ago/);
    expect(dates).not.toHaveTextContent(/authored/);
    expect(dates).not.toHaveTextContent(/created/);
    const cell = rowTimeCell();
    expect(cell).toHaveTextContent("3d ago");
    expect(cell).toHaveAttribute("title", expect.stringMatching(/^Ingested /));
  });

  it("prefers first_shipped_at over everything else for the row time", () => {
    renderRow(
      {
        slug: "2026-08-16-p-6",
        status: "shipped",
        authored_at: new Date(Date.now() - 12 * 86400_000).toISOString(),
        created_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
        updated_at: new Date(Date.now() - 3600_000).toISOString(),
        first_shipped_at: new Date(Date.now() - 7200_000).toISOString(),
      },
      true
    );
    const cell = rowTimeCell();
    expect(cell).toHaveTextContent("2h ago");
    expect(cell).toHaveAttribute("title", expect.stringMatching(/^Shipped /));
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/shipped 2h ago/);
    // The detail panel is where `updated` is honest — it stays, labelled.
    expect(dates).toHaveTextContent(/authored 12d ago/);
    expect(dates).toHaveTextContent(/updated 1h ago/);
  });

  it("never times the row on `updated_at` alone", () => {
    // Nothing but a scanner touch: the row must say it has no date rather
    // than present the touch as one.
    renderRow(
      {
        slug: "p-6b",
        status: "draft",
        updated_at: new Date(Date.now() - 60_000).toISOString(),
      },
      true
    );
    const cell = rowTimeCell();
    expect(cell).toHaveTextContent("no date recorded");
    expect(cell).not.toHaveTextContent(/ago/);
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/authored not recorded/);
    expect(dates).toHaveTextContent(/updated 1m ago/);
  });

  it("says so when coord recorded no authoring date, rather than blanking", () => {
    renderRow({ slug: "p-7", status: "draft" }, true);
    expect(screen.getByTestId("coord-plan-card-dates")).toHaveTextContent(
      /authored not recorded/
    );
    expect(rowTimeCell()).toHaveTextContent("no date recorded");
  });

  it("carries the detail route as an explicit action, not a whole-row link (D1)", () => {
    renderRow(plan, true);
    const link = screen.getByTestId("coord-plan-card-link");
    expect(link).toHaveAttribute(
      "href",
      "/admin/coord/plans/2026-08-16-p-5"
    );
    expect(screen.getByTestId("coord-plan-card-spawn-btn")).toBeInTheDocument();
    // The row itself must NOT be an anchor any more — that is the whole point
    // of D1, and it is the one thing a testid check cannot see.
    expect(
      screen.getByTestId("coord-plan-card").querySelector("a")
    ).toBe(link);
  });
});
