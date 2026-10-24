/**
 * The app sidebar beside a lens page, in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3).
 *
 * The sidebar is the authenticated shell's, not a lens page's: review round 1
 * of Phase 1 found it outside every lens, so with `?present=1` on a console
 * URL it still offered "New project" (a tenant-creating write), a switcher
 * listing the viewer's other projects (the lens's default confidential
 * terms), the runner's real machine name and the presenter's email.
 * `PresentationShell` now gives it the page's mode; this renders the REAL
 * sidebar under the presentation helper and holds it to the same bar as a
 * lens page, with the operator view beside it for contrast.
 *
 * Only the contexts and data hooks are faked; every component of the sidebar
 * renders for real, and check (b) reads the real UI Bridge registry.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FixedPresentationMode,
  sessionMachineAliases,
} from "@/components/presentation";
import {
  findPresentationViolations,
  renderInPresentationMode,
} from "@/test/presentation";
import type { NavItem } from "./types";

const fx = vi.hoisted(() => {
  const DEVICE = "0b9d6a54-0000-4000-8000-0000000000aa";
  return {
    DEVICE,
    EMAIL: "presenter@example.test",
    OWN_PROJECT: "Qontinui Fleet",
    OTHER_PROJECT: "Partner Portal",
    RUNNER_NAME: "build-box-07",
    RUNNER_HOST: "build-box-07.lan",
    runner: {
      id: DEVICE,
      name: "build-box-07",
      hostname: "build-box-07.lan",
      capabilities: [],
      createdAt: "2026-10-01T00:00:00Z",
      derivedStatus: "online",
      instances: [],
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/coord/devops",
  useSearchParams: () => new URLSearchParams("present=1"),
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { email: fx.EMAIL, username: "presenter" },
    logout: vi.fn(),
  }),
}));
vi.mock("@/contexts/sidebar-context", () => ({
  useSidebar: () => ({
    preferredCollapsed: false,
    isCollapsed: false,
    setIsCollapsed: vi.fn(),
    layout: "desktop",
    drawerOpen: false,
    setDrawerOpen: vi.fn(),
    menuButtonRef: { current: null },
  }),
}));
vi.mock("@/contexts/product-mode-context", () => ({
  useProductMode: () => ({ mode: "ai", setMode: vi.fn() }),
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [
      { id: "t-own", name: fx.OWN_PROJECT, slug: "qontinui-fleet" },
      { id: "t-other", name: fx.OTHER_PROJECT, slug: "partner-portal" },
    ],
    activeTenantId: "t-own",
    setActiveTenantId: vi.fn(),
  }),
}));
vi.mock("@/contexts/active-runner-context", () => ({
  useActiveRunner: () => ({
    activeRunner: fx.runner,
    runners: [fx.runner],
    pin: null,
    listState: "loaded",
    localityById: new Map(),
    resolution: { status: "unavailable" },
  }),
}));
vi.mock("@/lib/extension-slots", () => ({
  useSlotComponent: () => undefined,
}));
vi.mock("@/components/admin/coord/CoordProjectCreateDialog", () => ({
  CoordProjectCreateDialog: () => null,
}));

const NAV: NavItem[] = [
  {
    id: "coord-home",
    label: "Overview",
    route: "/admin/coord/home",
    icon: <span />,
    color: "",
  },
  {
    id: "fleet",
    label: "Fleet",
    route: "/admin/coord/runners",
    icon: <span />,
    color: "",
    children: [
      {
        id: "fleet-runners",
        label: "Runners",
        route: "/admin/coord/runners",
        icon: <span />,
        color: "",
      },
      {
        id: "fleet-sessions",
        label: "Session repository",
        route: "/sessions/repository",
        icon: <span />,
        color: "",
      },
    ],
  },
  // Outside every lens tree: a page with no presentation mode at all.
  {
    id: "overview-costs",
    label: "Costs",
    route: "/overview/financials",
    icon: <span />,
    color: "",
  },
  {
    id: "outside",
    label: "Outside",
    route: "/settings",
    icon: <span />,
    color: "",
    children: [
      {
        id: "outside-account",
        label: "Account",
        route: "/settings/account",
        icon: <span />,
        color: "",
      },
    ],
  },
];
vi.mock("./_hooks/use-sidebar-navigation", () => ({
  useSidebarNavigation: () => ({
    mounted: true,
    visibleNavItems: NAV,
    isRouteActive: () => false,
    handleNavigation: vi.fn(),
    handleDocs: vi.fn(),
  }),
}));
vi.mock("./_hooks/use-sidebar-projects", () => ({
  useSidebarProjects: () => ({
    projectId: null,
    projects: [],
    currentProject: null,
    projectsLoading: false,
    handleProjectChange: vi.fn(),
    handleCreateProject: vi.fn(),
  }),
}));
vi.mock("./_hooks/use-sidebar-organizations", () => ({
  useSidebarOrganizations: () => ({
    loading: false,
    showCreateOrgDialog: false,
    setShowCreateOrgDialog: vi.fn(),
    switcherOrganizations: [],
    switcherCurrentOrg: null,
    handleOrganizationChange: vi.fn(),
    handleCreateOrganization: vi.fn(),
  }),
}));

import { UnifiedSidebar } from "./UnifiedSidebar";

beforeEach(() => {
  sessionMachineAliases.reset();
});

describe("UnifiedSidebar in presentation mode", () => {
  it("is safe to show: no enabled write control, no write registration, no cost", async () => {
    const view = renderInPresentationMode(<UnifiedSidebar />);
    await screen.findByTestId("coord-project-presented");
    expect(findPresentationViolations(view)).toEqual([]);
  });

  it("names the active project only: no switcher of the viewer's other projects, no New project", async () => {
    const { container } = renderInPresentationMode(<UnifiedSidebar />);
    const project = await screen.findByTestId("coord-project-presented");
    expect(project).toHaveTextContent(fx.OWN_PROJECT);
    expect(screen.queryByTestId("coord-project-new")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(container.innerHTML).not.toContain(fx.OTHER_PROJECT);
  });

  it("aliases the runner's machine and shows no account menu or email", async () => {
    const { container } = renderInPresentationMode(<UnifiedSidebar />);
    await screen.findByTestId("coord-project-presented");
    expect(container).toHaveTextContent("Runner: Machine A");
    // The resolver notice names the runner too ("showing …'s data").
    expect(container).toHaveTextContent("showing Machine A's data");
    for (const leak of [
      fx.RUNNER_NAME,
      fx.RUNNER_HOST,
      fx.DEVICE.slice(0, 8),
      fx.EMAIL,
    ]) {
      expect(container.innerHTML).not.toContain(leak);
    }
  });

  it("keeps every navigation entry live, a section's entries one disclosure down", async () => {
    renderInPresentationMode(<UnifiedSidebar />);
    const overview = await screen.findByRole("button", { name: "Overview" });
    expect(overview).toBeEnabled();
    expect(overview).toHaveAttribute("data-presentation-nav");
    const fleet = screen.getByRole("button", { name: "Fleet" });
    expect(fleet).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(fleet);
    const runners = await screen.findByRole("button", { name: "Runners" });
    expect(runners).toBeEnabled();
    expect(runners).toHaveAttribute("data-presentation-nav");
  });

  it("offers no way out of the lens: entries outside every lens tree are not shown", async () => {
    renderInPresentationMode(<UnifiedSidebar />);
    fireEvent.click(await screen.findByRole("button", { name: "Fleet" }));
    await screen.findByRole("button", { name: "Runners" });
    expect(screen.queryByRole("button", { name: "Costs" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Session repository" })
    ).toBeNull();
    // A section with no entry inside a lens tree goes altogether.
    expect(screen.queryByRole("button", { name: "Outside" })).toBeNull();
  });
});

describe("UnifiedSidebar in operator mode", () => {
  it("still gives the operator the switcher, New project, the runner's name and the account", async () => {
    const { container } = render(
      <FixedPresentationMode presenting={false}>
        <UnifiedSidebar />
      </FixedPresentationMode>
    );
    expect(await screen.findByTestId("coord-project-new")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(container).toHaveTextContent(`Runner: ${fx.RUNNER_NAME}`);
    expect(container.innerHTML).toContain(fx.EMAIL);
    expect(screen.getByRole("button", { name: "Costs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outside" })).toBeInTheDocument();
  });
});
