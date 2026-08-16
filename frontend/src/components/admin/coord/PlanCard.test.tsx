/**
 * PlanCard render tests — the status tag as it actually reaches the DOM.
 *
 * The pure-function coverage lives in `planStatus.test.ts`; this asserts the
 * card wires it through, because the defect being fixed was a *rendering* one:
 * `shipped` and `in_progress` both resolved to `variant="default"` and so
 * painted identically on screen.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanCard } from "./PlanCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("PlanCard status tag", () => {
  it("renders SHIPPED in green, and not as the raw enum", () => {
    render(<PlanCard plan={{ slug: "p-1", status: "shipped" }} />);
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("Shipped");
    expect(tag.className).toContain("green");
    expect(tag).toHaveAttribute("data-tone", "shipped");
  });

  it("renders in-progress visually DISTINCT from shipped", () => {
    const { unmount } = render(
      <PlanCard plan={{ slug: "p-1", status: "shipped" }} />
    );
    const shippedClass = screen.getByTestId("coord-plan-status-tag").className;
    unmount();

    render(<PlanCard plan={{ slug: "p-2", status: "in_progress" }} />);
    const activeClass = screen.getByTestId("coord-plan-status-tag").className;

    expect(activeClass).not.toBe(shippedClass);
    expect(screen.getByTestId("coord-plan-status-tag")).toHaveTextContent(
      "In progress"
    );
  });

  it("shows an unknown status verbatim and marks it unrecognised", () => {
    render(<PlanCard plan={{ slug: "p-3", status: "weird_new_state" }} />);
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("weird_new_state");
    expect(tag).toHaveAttribute("data-recognised", "false");
    expect(tag).toHaveAttribute("data-tone", "unknown");
  });

  it("renders a tag even when coord sent no status at all", () => {
    // Previously the badge was omitted entirely, so "no status" and "not
    // loaded yet" looked the same.
    render(<PlanCard plan={{ slug: "p-4" }} />);
    const tag = screen.getByTestId("coord-plan-status-tag");
    expect(tag).toHaveTextContent("No status");
    expect(tag).toHaveAttribute("data-recognised", "false");
  });

  it("surfaces the creation date", () => {
    render(
      <PlanCard
        plan={{
          slug: "p-5",
          status: "draft",
          created_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
          updated_at: new Date(Date.now() - 3600_000).toISOString(),
        }}
      />
    );
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/created 3d ago/);
    expect(dates).toHaveTextContent(/updated 1h ago/);
  });

  it("prefers shipped-at over updated-at when present", () => {
    render(
      <PlanCard
        plan={{
          slug: "p-6",
          status: "shipped",
          created_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
          updated_at: new Date(Date.now() - 3600_000).toISOString(),
          shipped_at: new Date(Date.now() - 7200_000).toISOString(),
        }}
      />
    );
    const dates = screen.getByTestId("coord-plan-card-dates");
    expect(dates).toHaveTextContent(/shipped 2h ago/);
    expect(dates).not.toHaveTextContent(/updated/);
  });
});
