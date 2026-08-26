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

describe("PlanRow detail (R5) and the frozen testids (D4a)", () => {
  const plan = {
    slug: "2026-08-16-p-5",
    status: "draft",
    title: "A plan with a title",
    created_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
    updated_at: new Date(Date.now() - 3600_000).toISOString(),
  };

  it("keeps the detail OUT of the DOM while collapsed", () => {
    renderRow(plan, false);
    expect(screen.getByTestId("coord-plan-card")).toBeInTheDocument();
    expect(screen.queryByTestId("coord-plan-card-dates")).toBeNull();
    expect(screen.queryByTestId("coord-plan-card-link")).toBeNull();
    expect(screen.queryByTestId("coord-plan-card-spawn-btn")).toBeNull();
  });

  it("surfaces the creation date once expanded", () => {
    renderRow(plan, true);
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/created 3d ago/);
    expect(dates).toHaveTextContent(/updated 1h ago/);
  });

  it("prefers shipped-at over updated-at when present", () => {
    renderRow(
      {
        slug: "2026-08-16-p-6",
        status: "shipped",
        created_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
        updated_at: new Date(Date.now() - 3600_000).toISOString(),
        shipped_at: new Date(Date.now() - 7200_000).toISOString(),
      },
      true
    );
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/shipped 2h ago/);
    expect(dates).not.toHaveTextContent(/updated/);
  });

  it("says so when coord recorded no creation date, rather than blanking", () => {
    renderRow({ slug: "p-7", status: "draft" }, true);
    expect(screen.getByTestId("coord-plan-card-dates")).toHaveTextContent(
      /created not recorded/
    );
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
