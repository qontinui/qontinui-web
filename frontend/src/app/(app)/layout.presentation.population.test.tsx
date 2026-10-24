/**
 * The app shell around a lens page, entered the way its population enters it
 * (plan `2026-10-23-console-presentation-spaces` D3; review round 1 of Phase 1
 * found the sidebar outside every lens).
 *
 * The REAL authenticated layout (`app/(app)/layout.tsx`) renders the REAL
 * sidebar beside a page, on a lens URL carrying `?present=1`. What is faked is
 * who is signed in and what the shell's contexts hold — the providers become
 * pass-throughs and their hooks return fixtures — plus the sidebar's three data
 * hooks, the router, and the shell widgets that are not under test.
 * `next/dynamic` is `React.lazy`, so the sidebar loads as it does in the
 * browser, behind its Suspense boundary.
 *
 * The file imports nothing the phase added, so without the phase it fails on
 * its assertions (the shell shows the presenter's email and "New project"),
 * not on an import.
 */

import { lazy, type ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => {
  const DEVICE = "0b9d6a54-0000-4000-8000-0000000000aa";
  const runner = {
    id: DEVICE,
    name: "build-box-07",
    hostname: "build-box-07.lan",
    capabilities: [],
    createdAt: "2026-10-01T00:00:00Z",
    derivedStatus: "online",
    instances: [],
  };
  return {
    DEVICE,
    EMAIL: "presenter@example.test",
    OWN_PROJECT: "Qontinui Fleet",
    OTHER_PROJECT: "Partner Portal",
    RUNNER_NAME: "build-box-07",
    runner,
    path: "/admin/coord/devops",
    search: "present=1",
    /** A provider faked to render its children and nothing else. */
    passThrough: ({ children }: { children?: unknown }) => children ?? null,
  };
});

vi.mock("next/dynamic", () => ({
  default: (load: () => Promise<{ default: ComponentType }>) => lazy(load),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => fx.path,
  useSearchParams: () => new URLSearchParams(fx.search),
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    user: { email: fx.EMAIL, username: "presenter" },
    loading: false,
    logout: vi.fn(),
  }),
}));
vi.mock("@/components/CloudProviders", () => ({
  CloudProviders: fx.passThrough,
}));
vi.mock("@/contexts/organization-context", () => ({
  OrganizationProvider: fx.passThrough,
}));
vi.mock("@/contexts/realtime-connections-context", () => ({
  RealtimeConnectionsProvider: fx.passThrough,
}));
vi.mock("@/contexts/active-runner-context", () => ({
  ActiveRunnerProvider: fx.passThrough,
  useActiveRunner: () => ({
    activeRunner: fx.runner,
    runners: [fx.runner],
    pin: null,
    listState: "loaded",
    localityById: new Map(),
    resolution: { status: "resolved", deviceId: fx.DEVICE },
  }),
}));
vi.mock("@/contexts/tenant-context", () => ({
  TenantProvider: fx.passThrough,
  useTenant: () => ({
    tenants: [
      { id: "t-own", name: fx.OWN_PROJECT, slug: "qontinui-fleet" },
      { id: "t-other", name: fx.OTHER_PROJECT, slug: "partner-portal" },
    ],
    activeTenantId: "t-own",
    setActiveTenantId: vi.fn(),
  }),
}));
vi.mock("@/contexts/sidebar-context", () => ({
  SidebarProvider: fx.passThrough,
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
  ProductModeProvider: fx.passThrough,
  useProductMode: () => ({ mode: "ai", setMode: vi.fn() }),
}));
vi.mock("@/contexts/advanced-automation-context", () => ({
  AdvancedAutomationProvider: fx.passThrough,
}));
vi.mock("@/contexts/automation-context/AutomationProviderV2", () => ({
  AutomationProvider: fx.passThrough,
}));
vi.mock("@/contexts/tab-state-context", () => ({
  TabStateProvider: fx.passThrough,
}));
vi.mock("@/components/offline/AppInitializer", () => ({
  AppInitializer: fx.passThrough,
}));
vi.mock("@/components/cloud-slots/BetaBannerSlot", () => ({
  BetaBannerSlot: () => null,
}));
vi.mock("@/components/helper-portal/HelperRedirectGate", () => ({
  HelperRedirectGate: () => null,
}));
vi.mock("@/components/offline/SyncQueueViewer", () => ({
  SyncQueueViewer: () => null,
}));
vi.mock("@/components/session-timeout-warning", () => ({
  SessionTimeoutWarning: () => null,
}));
vi.mock("@/components/ui-bridge/RecordingIndicator", () => ({
  RecordingIndicator: () => null,
}));
vi.mock("@/components/co-pilot/CoPilotActiveBanner", () => ({
  CoPilotActiveBanner: () => null,
}));
vi.mock("@/lib/extension-slots", () => ({
  useSlotComponent: () => undefined,
}));
vi.mock("@/components/admin/coord/CoordProjectCreateDialog", () => ({
  CoordProjectCreateDialog: () => null,
}));
vi.mock(
  "@/components/navigation/sidebar/_hooks/use-sidebar-navigation",
  () => ({
    useSidebarNavigation: () => ({
      mounted: true,
      visibleNavItems: [
        {
          id: "coord-devops",
          label: "Dev Ops",
          route: "/admin/coord/devops",
          icon: null,
          color: "",
        },
        {
          id: "overview-costs",
          label: "Costs",
          route: "/overview/financials",
          icon: null,
          color: "",
        },
      ],
      isRouteActive: () => false,
      handleNavigation: vi.fn(),
      handleDocs: vi.fn(),
    }),
  })
);
vi.mock("@/components/navigation/sidebar/_hooks/use-sidebar-projects", () => ({
  useSidebarProjects: () => ({
    projectId: null,
    projects: [],
    currentProject: null,
    projectsLoading: false,
    handleProjectChange: vi.fn(),
    handleCreateProject: vi.fn(),
  }),
}));
vi.mock(
  "@/components/navigation/sidebar/_hooks/use-sidebar-organizations",
  () => ({
    useSidebarOrganizations: () => ({
      loading: false,
      showCreateOrgDialog: false,
      setShowCreateOrgDialog: vi.fn(),
      switcherOrganizations: [],
      switcherCurrentOrg: null,
      handleOrganizationChange: vi.fn(),
      handleCreateOrganization: vi.fn(),
    }),
  })
);

import AppLayout from "./layout";

function visit(path: string, search: string) {
  fx.path = path;
  fx.search = search;
}

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  visit("/admin/coord/devops", "present=1");
});

describe("the app shell beside a lens page", () => {
  it("presents with the page on a lens URL carrying ?present=1: no account, no New project, no other project, the runner aliased", async () => {
    visit("/admin/coord/devops", "present=1");
    const { container } = render(
      <AppLayout>
        <p>Console page</p>
      </AppLayout>
    );

    // The sidebar loads lazily, as in the browser.
    expect(await screen.findByText("Runner: Machine A")).toBeTruthy();
    expect(container).toHaveTextContent(fx.OWN_PROJECT);
    expect(container.innerHTML).not.toContain(fx.EMAIL);
    expect(container.innerHTML).not.toContain(fx.OTHER_PROJECT);
    expect(container.innerHTML).not.toContain(fx.RUNNER_NAME);
    expect(screen.queryByTitle("New project")).toBeNull();
    // Only the way to other lens pages.
    expect(screen.getByRole("button", { name: "Dev Ops" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Costs" })).toBeNull();
  });

  it("is the operator's shell on a route outside every lens, whatever the URL asks", async () => {
    visit("/settings", "present=1");
    const { container } = render(
      <AppLayout>
        <p>Settings page</p>
      </AppLayout>
    );
    expect(await screen.findByText(`Runner: ${fx.RUNNER_NAME}`)).toBeTruthy();
    expect(container.innerHTML).toContain(fx.EMAIL);
    expect(screen.getByTitle("New project")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();
  });
});
