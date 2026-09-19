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
 *  - operator-only console pages stay hidden from a plain member
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
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { id: "u1", is_superuser: isSuperuser },
    loading: false,
  }),
}));

vi.mock("@/contexts/product-mode-context", () => ({
  useProductMode: () => ({ mode: "ai", setMode: vi.fn() }),
}));

vi.mock("@/contexts/advanced-automation-context", () => ({
  useAdvancedAutomation: () => ({ showAdvancedAutomation: false }),
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
  });

  it("opens with the Coord Console's sections, in order", () => {
    const top = menu().visibleNavItems;
    const sections = [...new Set(top.map((i) => i.group).filter(Boolean))];
    expect(sections.slice(0, 4)).toEqual([
      "Coord",
      "Sessions",
      "Fleet",
      "Access",
    ]);
    expect(
      top.filter((i) => i.group === "Coord").map((i) => i.label)
    ).toEqual([
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
    ).toEqual(["/sessions", "/sessions/repository", "/commits", "/admin/agent-claims"]);
    expect(
      top.filter((i) => i.group === "Fleet").map((i) => i.label)
    ).toEqual([
      "Runners",
      "Dev Ops",
      "Environments",
      "Digital Twin",
      "Download Runner",
    ]);
  });

  it("hides Home, the duplicate coordination entry, and the old console entry", () => {
    const ids = flatten(menu().visibleNavItems).map((i) => i.id);
    for (const hidden of ["prompt-home", "ai-dev-coordination", "admin-coord"]) {
      expect(ids).not.toContain(hidden);
    }
    const routes = flatten(menu().visibleNavItems).map((i) => i.route);
    expect(routes).not.toContain("/prompt-home");
    expect(routes).not.toContain("/admin/coord");
  });

  it("lists no leaf route twice", () => {
    isSuperuser = true;
    // A collapsible's own route is its first child's, so compare leaves only.
    const leaves = flatten(menu().visibleNavItems).filter(
      (i) => !i.children
    );
    const routes = leaves.map((i) => i.route);
    expect(routes.filter((r, i) => routes.indexOf(r) !== i)).toEqual([]);
  });

  it("moves Organizations and Billing to the visual menu", () => {
    const routes = flatten(menu().visibleNavItems).map((i) => i.route);
    expect(routes).not.toContain("/organizations");
    expect(routes).not.toContain("/billing");
  });

  it("shows a member only Overview under Dev Ops, and an operator all of it", () => {
    const devops = () =>
      menu().visibleNavItems.find((i) => i.id === "coord-group-devops");
    expect(devops()?.children?.map((c) => c.label)).toEqual(["Overview"]);

    isSuperuser = true;
    expect(devops()?.children?.map((c) => c.label)).toContain("Runner Drain");
    expect(devops()?.children).toHaveLength(13);
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
