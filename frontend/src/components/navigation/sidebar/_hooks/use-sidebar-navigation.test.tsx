/**
 * The web sidebar menu, as the hook assembles it in AI Dev mode.
 *
 * Contracts under test:
 *  - the Coord Console's sections ARE the menu (Coord / Sessions / Fleet /
 *    Access), not one "Coord Console" entry leading to a second menu
 *  - hidden shared-registry items: Home (co-pilot), the duplicate
 *    "AI-Dev Coordination" entry, and the shared Runners/Sessions items that
 *    web-local ones replace — so no route is listed twice
 *  - Organizations and Billing (cloud items) belong to the visual menu
 *  - operator-only console pages stay hidden from a plain member, and
 *    coord-admin-only ones (Computers) show for a coord tenant admin too
 *  - console pages keep their section highlighted on detail routes
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavItem } from "../types";

let pathname = "/admin/coord/pipeline";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

let isSuperuser = false;
let coordIsAdmin = false;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", is_superuser: isSuperuser, coord_is_admin: coordIsAdmin },
    loading: false,
  }),
}));

type TenantRow = { id: string; slug: string; name: string; roles?: string[] };
let tenants: TenantRow[] = [];
let activeTenantId: string | null = null;
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ tenants, activeTenantId }),
}));

vi.mock("@/contexts/product-mode-context", () => ({
  useProductMode: () => ({ mode: "ai", setMode: vi.fn() }),
}));

let showAdvanced = false;
vi.mock("@/contexts/advanced-automation-context", () => ({
  useAdvancedAutomation: () => ({ showAdvancedAutomation: showAdvanced }),
}));

vi.mock("@cloud/nav-items", () => ({
  cloudNavItems: [
    {
      id: "cloud-organizations",
      label: "Organizations",
      icon: null,
      route: "/organizations",
      color: "#fff",
      group: "Account",
    },
    {
      id: "cloud-billing",
      label: "Billing",
      icon: null,
      route: "/billing",
      color: "#fff",
      group: "Account",
    },
  ],
}));

import { useSidebarNavigation } from "./use-sidebar-navigation";

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flatten(i.children ?? [])]);
}

function menu() {
  const { result } = renderHook(() => useSidebarNavigation());
  return result.current;
}

describe("useSidebarNavigation — AI Dev menu", () => {
  beforeEach(() => {
    pathname = "/admin/coord/pipeline";
    isSuperuser = false;
    coordIsAdmin = false;
    tenants = [];
    activeTenantId = null;
    showAdvanced = false;
  });

  it("opens with the Project Overview, then the Coord Console's sections", () => {
    const top = menu().visibleNavItems;
    const sections = [...new Set(top.map((i) => i.group).filter(Boolean))];
    expect(sections.slice(0, 5)).toEqual([
      "Overview",
      "Coord",
      "Sessions",
      "Fleet",
      "Access",
    ]);
    expect(top.filter((i) => i.group === "Coord").map((i) => i.label)).toEqual([
      "Pipeline",
      "Pull Requests",
      "Gates",
      "Notifications",
      "Work",
      "Merge",
      "Intent",
      "Regression Tests",
    ]);
    expect(
      top.filter((i) => i.group === "Sessions").map((i) => i.route)
    ).toEqual([
      "/sessions",
      "/sessions/repository",
      "/commits",
      "/admin/agent-claims",
    ]);
    expect(top.filter((i) => i.group === "Fleet").map((i) => i.label)).toEqual([
      "Runners",
      "Dev Ops",
      "Environments",
      "Digital Twin",
      "Download Runner",
    ]);
  });

  it("lists every overview page, Summary first", () => {
    const overview = menu().visibleNavItems.filter(
      (i) => i.group === "Overview"
    );
    expect(overview.map((i) => i.route)).toEqual([
      "/overview",
      "/overview/timeline",
      "/overview/financials",
      "/overview/team",
      "/overview/risks",
      "/overview/diagrams",
      "/overview/documents",
      "/overview/wiki",
      "/overview/slides",
    ]);
  });

  it("keeps the Overview first when advanced features reveal shared groups", () => {
    showAdvanced = true;
    const top = menu().visibleNavItems;
    expect(top[0].group).toBe("Overview");
    const firstNonOverview = top.findIndex((i) => i.group !== "Overview");
    expect(
      top.slice(firstNonOverview).some((i) => i.group === "Overview")
    ).toBe(false);
  });

  it("does not highlight Summary on the other overview pages", () => {
    pathname = "/overview/timeline";
    const { visibleNavItems, isRouteActive } = menu();
    const summary = visibleNavItems.find((i) => i.route === "/overview")!;
    const timeline = visibleNavItems.find(
      (i) => i.route === "/overview/timeline"
    )!;
    expect(isRouteActive(summary.route, summary)).toBe(false);
    expect(isRouteActive(timeline.route, timeline)).toBe(true);
  });

  it("hides Home, the duplicate coordination entry, and the old console entry", () => {
    const ids = flatten(menu().visibleNavItems).map((i) => i.id);
    for (const hidden of [
      "prompt-home",
      "ai-dev-coordination",
      "admin-coord",
    ]) {
      expect(ids).not.toContain(hidden);
    }
    const routes = flatten(menu().visibleNavItems).map((i) => i.route);
    expect(routes).not.toContain("/prompt-home");
    expect(routes).not.toContain("/admin/coord");
  });

  it("lists no leaf route twice", () => {
    isSuperuser = true;
    // A collapsible's own route is its first child's, so compare leaves only.
    const leaves = flatten(menu().visibleNavItems).filter((i) => !i.children);
    const routes = leaves.map((i) => i.route);
    expect(routes.filter((r, i) => routes.indexOf(r) !== i)).toEqual([]);
  });

  it("moves Organizations and Billing to the visual menu", () => {
    const routes = flatten(menu().visibleNavItems).map((i) => i.route);
    expect(routes).not.toContain("/organizations");
    expect(routes).not.toContain("/billing");
  });

  it("shows a member only Overview and CI under Dev Ops, and an operator all of it", () => {
    const devops = () =>
      menu().visibleNavItems.find((i) => i.id === "coord-group-devops");
    expect(devops()?.children?.map((c) => c.label)).toEqual(["Overview", "CI"]);

    isSuperuser = true;
    expect(devops()?.children?.map((c) => c.label)).toContain("Maintenance");
    expect(devops()?.children?.map((c) => c.label)).toContain("Computers");
    expect(devops()?.children).toHaveLength(15);
  });

  it("shows Computers to an admin of the ACTIVE tenant who is not staff, and nothing operator-only", () => {
    coordIsAdmin = true;
    tenants = [{ id: "t-a", slug: "a", name: "A", roles: ["admin"] }];
    activeTenantId = "t-a";
    const devops = menu().visibleNavItems.find(
      (i) => i.id === "coord-group-devops"
    );
    expect(devops?.children?.map((c) => c.label)).toEqual([
      "Overview",
      "CI",
      "Computers",
    ]);
  });

  it("hides Computers from an admin of tenant A while tenant B is active", () => {
    // `coord_is_admin` is the union across tenants, so it is true here — and
    // the proxies' `require_coord_tenant_admin` still refuses, because it
    // checks B's roles. The menu must follow the gate, not the union.
    coordIsAdmin = true;
    tenants = [
      { id: "t-a", slug: "a", name: "A", roles: ["admin"] },
      { id: "t-b", slug: "b", name: "B", roles: ["developer"] },
    ];
    activeTenantId = "t-b";
    const devops = menu().visibleNavItems.find(
      (i) => i.id === "coord-group-devops"
    );
    expect(devops?.children?.map((c) => c.label)).toEqual(["Overview", "CI"]);
  });

  it("keeps a console section active on its detail routes", () => {
    pathname = "/admin/coord/plans/some-plan";
    const { visibleNavItems, isRouteActive } = menu();
    const work = visibleNavItems.find((i) => i.id === "coord-group-work");
    const plans = work?.children?.find((c) => c.id === "coord-plans");
    if (!work || !plans) throw new Error("Work · Plans missing");
    expect(isRouteActive(work.route, work)).toBe(true);
    expect(isRouteActive(plans.route, plans)).toBe(true);
  });

  it("does not highlight Sessions on the Session Repository page", () => {
    pathname = "/sessions/repository";
    const { visibleNavItems, isRouteActive } = menu();
    const sessions = visibleNavItems.find((i) => i.id === "sessions");
    const repo = visibleNavItems.find((i) => i.id === "session-repository");
    if (!sessions || !repo) throw new Error("session items missing");
    expect(isRouteActive(sessions.route, sessions)).toBe(false);
    expect(isRouteActive(repo.route, repo)).toBe(true);
  });
});
