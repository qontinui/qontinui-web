/**
 * `/admin/coord/plan-library/settings` — the two policy dials' stable,
 * linkable home (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Design
 * decision 4b). The panels own their own tests; this pins that both are here.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_components/CapturePolicyPanel", () => ({
  CapturePolicyPanel: () => <div data-testid="stub-capture-policy" />,
}));
vi.mock("../_components/CitationBackfillPolicyPanel", () => ({
  CitationBackfillPolicyPanel: () => <div data-testid="stub-backfill-policy" />,
}));

import PlanLibrarySettingsPage from "./page";

describe("/admin/coord/plan-library/settings", () => {
  it("renders both policy dials and links back to the plan browser", () => {
    render(<PlanLibrarySettingsPage />);
    expect(screen.getByTestId("stub-capture-policy")).toBeInTheDocument();
    expect(screen.getByTestId("stub-backfill-policy")).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-library-settings-plans-link")
    ).toHaveAttribute("href", "/admin/coord/plans");
    expect(
      screen.getByTestId("plan-library-settings-artifacts-link")
    ).toHaveAttribute("href", "/admin/coord/plan-library/artifacts");
  });
});
