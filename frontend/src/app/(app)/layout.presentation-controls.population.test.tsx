/**
 * The app shell around a lens page shows no write control while presenting —
 * only the presenter's own safety controls (plan
 * `2026-10-23-console-presentation-spaces` D3.2; review round 2 of Phase 1
 * found write controls in the shell that its mocks hid).
 *
 * The same world as `layout.presentation.population.test.tsx`: the REAL
 * authenticated layout (`app/(app)/layout.tsx`) and the REAL sidebar beside a
 * page, on a lens URL carrying `?present=1`, with the shell's own controls
 * rendered rather than mocked away — the composed build's beta banner (its
 * real slot wrapper, filled with a stand-in offering the banner's two
 * buttons), the offline sync queue (a stand-in with its "Sync now"), and the
 * REAL co-pilot banner in its active state. The whole shell is then checked
 * the way a lens page is, with the shared page check
 * (`findPresentationViolations`, `src/test/presentation.tsx`).
 *
 * It lives in a file of its own because it imports the phase's helpers (the
 * presenter-safety attribute and the shared page check), so it cannot load
 * without the phase. The arming test beside it imports nothing the phase
 * added, so that one fails on its assertions without the phase, not on an
 * import. Keep the two apart.
 */

import { lazy, type ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESENTER_SAFETY_ATTRIBUTE } from "@/components/console/presenterSafety";
import { findPresentationViolations } from "@/test/presentation";

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

describe("the app shell beside a lens page, presenting", () => {
  it("shows no write control anywhere in the shell while presenting — only the presenter's own safety controls", async () => {
    visit("/admin/coord/devops", "present=1");
    render(
      <AppLayout>
        <p>Console page</p>
      </AppLayout>
    );
    await screen.findByText("Runner: Machine A", {}, { timeout: LAZY_MS });
    expect(
      await screen.findByTestId(
        "co-pilot-active-banner",
        {},
        { timeout: LAZY_MS }
      )
    ).toBeTruthy();

    // The co-pilot banner stays, and so does Stop — a listed safety control —
    // but not the account-wide opt-out, a durable preference write.
    expect(
      screen
        .getByTestId("co-pilot-active-banner-stop")
        .getAttribute(PRESENTER_SAFETY_ATTRIBUTE)
    ).toBe("co-pilot-stop");
    expect(
      screen.queryByTestId("co-pilot-active-banner-disable-account")
    ).toBeNull();
    // Neither the beta banner's buttons nor the sync queue's.
    expect(screen.queryByTestId("beta-banner")).toBeNull();
    expect(screen.queryByTestId("sync-queue-sync-now")).toBeNull();

    // The whole shell, every control on the page, checked as a lens page is.
    expect(
      findPresentationViolations(
        {
          baseElement: document.body,
          uiBridge: {
            unobservable:
              "the shell test fakes no UI Bridge provider; the shell's own controls are checked as DOM",
          },
        },
        { forbidden: [fx.EMAIL, fx.OTHER_PROJECT, fx.RUNNER_NAME] }
      )
    ).toEqual([]);
  });
});
