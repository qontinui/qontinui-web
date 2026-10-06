/**
 * `/admin/coord/plan-library/artifacts` — the all-kinds artifact list keeps
 * every non-plan kind browsable now that `/admin/coord/plans` reads plans
 * only. The list owns its own test; this pins that it is here and linked.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../_components/PlanLibraryList", () => ({
  PlanLibraryList: () => <div data-testid="stub-artifact-list" />,
}));

import PlanLibraryArtifactsPage from "./page";

describe("/admin/coord/plan-library/artifacts", () => {
  it("renders the all-kinds list and links to plans and settings", () => {
    render(<PlanLibraryArtifactsPage />);
    expect(screen.getByTestId("stub-artifact-list")).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-library-artifacts-plans-link")
    ).toHaveAttribute("href", "/admin/coord/plans");
    expect(
      screen.getByTestId("plan-library-artifacts-settings-link")
    ).toHaveAttribute("href", "/admin/coord/plan-library/settings");
  });
});
