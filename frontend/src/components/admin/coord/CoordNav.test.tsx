/**
 * CoordNav — grouped console navigation.
 *
 * Contracts under test (nav redesign):
 *  - four direct tabs; everything else inside persona dropdown groups
 *  - operator gating: the Infra group and operator-only items (Merge
 *    Settings) never render for a plain member
 *  - wayfinding crumb: the group trigger of the active page highlights and
 *    exposes `<testid>-active`
 *  - live Alerts badge from the unresolved-alerts rollup
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/admin/coord/fleet";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

let isSuperuser = false;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { is_superuser: isSuperuser } }),
}));

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
  },
}));

import CoordNav from "./CoordNav";

describe("CoordNav", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpGet.mockResolvedValue({ alerts: [] });
    pathname = "/admin/coord/fleet";
    isSuperuser = false;
  });

  it("renders four direct tabs and the member groups (no Infra)", () => {
    render(<CoordNav />);

    expect(screen.getByTestId("coord-nav-fleet")).toHaveTextContent(
      "Pipeline"
    );
    expect(screen.getByTestId("coord-nav-prs")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-gates")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-alerts")).toBeInTheDocument();

    expect(screen.getByTestId("coord-nav-group-work")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-group-merge")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-group-access")).toBeInTheDocument();
    // Operator-infra group hidden for members.
    expect(
      screen.queryByTestId("coord-nav-group-infra")
    ).not.toBeInTheDocument();
  });

  it("hides operator-only items inside member-visible groups", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-merge"));
    expect(await screen.findByTestId("coord-nav-policies")).toBeVisible();
    expect(screen.getByTestId("coord-nav-pull-decisions")).toBeVisible();
    expect(
      screen.queryByTestId("coord-nav-merge-settings")
    ).not.toBeInTheDocument();
  });

  it("shows the Infra group with its items for operators", async () => {
    isSuperuser = true;
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-infra"));
    expect(await screen.findByTestId("coord-nav-trees")).toBeVisible();
    expect(screen.getByTestId("coord-nav-git-ops")).toBeVisible();
    expect(screen.getByTestId("coord-nav-onboarding-status")).toBeVisible();
    // Runner releases dashboard lives beside Deploys in the operator-infra group.
    expect(screen.getByTestId("coord-nav-releases")).toBeVisible();
  });

  it("hides the Releases infra tab from a plain member", () => {
    render(<CoordNav />);
    expect(screen.queryByTestId("coord-nav-releases")).not.toBeInTheDocument();
  });

  it("surfaces the active page as a crumb on its group trigger", () => {
    pathname = "/admin/coord/lands";
    render(<CoordNav />);

    const trigger = screen.getByTestId("coord-nav-group-work");
    expect(trigger).toHaveTextContent("Work");
    const crumb = screen.getByTestId("coord-nav-lands-active");
    expect(crumb).toHaveTextContent("Lands");
    expect(trigger).toContainElement(crumb);
    // Sibling groups stay idle — no crumb.
    expect(screen.getByTestId("coord-nav-group-merge")).toHaveTextContent(
      /^Merge$/
    );
  });

  it("cross-links live in the Access group with external hrefs", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-access"));
    const claims = await screen.findByTestId("coord-nav-claims");
    expect(claims).toHaveAttribute("href", "/admin/agent-claims");
    expect(screen.getByTestId("coord-nav-sessions")).toHaveAttribute(
      "href",
      "/admin/agent-sessions"
    );
    expect(screen.getByTestId("coord-nav-members")).toHaveAttribute(
      "href",
      "/admin/coord/members"
    );
  });

  it("renders a live unresolved-alerts badge, red when critical", async () => {
    httpGet.mockResolvedValue({
      alerts: [{ severity: "critical" }, { severity: "warning" }],
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveTextContent("2");
    expect(badge.className).toContain("text-red-200");
    expect(httpGet).toHaveBeenCalledWith("/api/v1/operations/alerts");
  });

  it("renders no badge when the rollup is empty or unavailable", async () => {
    httpGet.mockRejectedValue(new Error("boom"));
    render(<CoordNav />);

    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect(
      screen.queryByTestId("coord-nav-alerts-badge")
    ).not.toBeInTheDocument();
  });
});
