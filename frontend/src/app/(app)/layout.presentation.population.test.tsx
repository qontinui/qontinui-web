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
 * The shell's own controls are rendered, not mocked away (review round 2 found
 * write controls there the mocks hid): the composed build's beta banner (its
 * real slot wrapper, filled with a stand-in offering the banner's two
 * buttons), the offline sync queue (a stand-in with its "Sync now"), and the
 * REAL co-pilot banner in its active state — the hooks behind it faked to "a
 * relayed command just landed". The whole shell is checked the way a lens
 * page is in `layout.presentation-controls.population.test.tsx`, which needs
 * the phase's own helpers to do it; the session-expiry dialog and the
 * recording indicator are checked whole in their own tests
 * (`session-timeout-warning.test.tsx`, `RecordingIndicator.test.tsx`), since
 * each needs a world of its own to show at all.
 *
 * This file imports nothing the phase added, so without the phase it fails on
 * its assertions (the shell shows the presenter's email and "New project"),
 * not on an import. A case that needs a phase helper goes in the controls
 * file, never here.
 */

import { lazy, type ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attributesNaming } from "@/test/attributesNaming";

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
    OWN_PROJECT: "Acme Corp rollout",
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
    user: {
      email: fx.EMAIL,
      username: "presenter",
      tenant_slug: "acme-corp-rollout",
    },
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
      {
        id: "tenant-4b2a-own",
        name: fx.OWN_PROJECT,
        slug: "acme-corp-rollout",
      },
      {
        id: "tenant-8e6d-other",
        name: fx.OTHER_PROJECT,
        slug: "partner-portal",
      },
    ],
    activeTenantId: "tenant-4b2a-own",
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
vi.mock("@/components/helper-portal/HelperRedirectGate", () => ({
  HelperRedirectGate: () => null,
}));
// The queue's own controls, as it renders them with uploads queued.
vi.mock("@/components/offline/SyncQueueViewer", () => ({
  SyncQueueViewer: () => (
    <button type="button" data-testid="sync-queue-sync-now">
      Sync now
    </button>
  ),
}));
vi.mock("@/components/session-timeout-warning", () => ({
  SessionTimeoutWarning: () => null,
}));
vi.mock("@/components/ui-bridge/RecordingIndicator", () => ({
  RecordingIndicator: () => null,
}));
// The co-pilot banner is REAL; what it reads is "the relay issued a command
// in the last 30 s" for a signed-in account that opted in.
vi.mock("@/hooks/useCoPilotPreference", () => ({
  useCoPilotPreference: () => ({ enabled: true, mutate: vi.fn() }),
}));
vi.mock("@/hooks/useCoPilotSessionConsent", () => ({
  useCoPilotSessionConsent: () => ({ state: "granted", revoke: vi.fn() }),
}));
vi.mock("@/hooks/useCoPilotActivity", () => ({
  useCoPilotActivity: () => ({ isActive: true, lastActionAt: Date.now() }),
}));
vi.mock("@/lib/ui-bridge/co-pilot-gates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ui-bridge/co-pilot-gates")>()),
  // Not loopback dev, so the account-wide opt-out is offered at all.
  useIsLoopbackDev: () => false,
}));
// The composed build fills the beta-banner slot; its stand-in offers the
// cloud banner's two buttons ("Give Feedback" opens a form that POSTs).
vi.mock("@/lib/extension-slots", () => ({
  useSlotComponent: (name: string) =>
    name === "betaBanner"
      ? () => (
          <div data-testid="beta-banner">
            <button type="button">Give Feedback</button>
            <button type="button">Dismiss</button>
          </div>
        )
      : undefined,
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

/** How long the lazily loaded sidebar may take to arrive on a busy machine. */
const LAZY_MS = 15_000;

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

    // The sidebar loads lazily, as in the browser — a large chunk, so the
    // wait is sized for a loaded machine rather than the 1 s default.
    expect(
      await screen.findByText("Runner: Machine A", {}, { timeout: LAZY_MS })
    ).toBeTruthy();
    // Every shell surface that names the project — the sidebar's selector
    // and the phone-width top bar — withholds it the way the home page's
    // tenant strip does ("Project"): not in the text, not in any attribute.
    expect(container).toHaveTextContent("Active project: Project");
    for (const name of [
      fx.OWN_PROJECT,
      fx.OTHER_PROJECT,
      // A slug or id identifies a project as surely as its name.
      "acme-corp-rollout",
      "partner-portal",
      "tenant-4b2a-own",
      "tenant-8e6d-other",
    ]) {
      expect(document.body.textContent).not.toContain(name);
      expect(attributesNaming(document.body, name)).toEqual([]);
    }
    // The account menu names the tenant's slug inside its dropdown, which mounts
    // only when opened; so the operator-only gate is what keeps the slug off a
    // presented page, and the gate is observed directly: no trigger renders
    // (the expanded one; the collapsed trigger carries no marker).
    expect(
      document.querySelector('[data-tutorial-id="sidebar-user-menu"]')
    ).toBeNull();
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
    expect(
      await screen.findByText(
        `Runner: ${fx.RUNNER_NAME}`,
        {},
        { timeout: LAZY_MS }
      )
    ).toBeTruthy();
    expect(container.innerHTML).toContain(fx.EMAIL);
    expect(container).toHaveTextContent(fx.OWN_PROJECT);
    expect(screen.getByTitle("New project")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();
    // The operator's controls are all there.
    expect(screen.getByTestId("beta-banner")).toBeTruthy();
    expect(
      await screen.findByTestId("sync-queue-sync-now", {}, { timeout: LAZY_MS })
    ).toBeTruthy();
    expect(
      await screen.findByTestId(
        "co-pilot-active-banner-disable-account",
        {},
        { timeout: LAZY_MS }
      )
    ).toBeTruthy();
  });
});
