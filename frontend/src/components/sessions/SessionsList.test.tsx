import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SessionRow } from "./types";

/**
 * SessionsList — render + scope-toggle tests for Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`, updated for
 * `2026-05-28-cross-org-tenant-membership-and-session-filter-split.md`
 * (the session-state vs tenant-breadth axis split).
 *
 * The list polls `GET /api/v1/operations/sessions` every 5s. Tests
 * disable polling and inject a mock fetcher to avoid the timer.
 *
 * `useTenant` is mocked rather than mounting the real provider —
 * `TenantProvider` does a live `listTenants()` fetch on mount, which
 * is the wrong shape for these unit tests (and the source of the
 * pre-mock "useTenant must be used inside <TenantProvider>" failures
 * that blocked PR #302). Tests that need multi-tenant behavior flip
 * the mock per `setTenantMock` below.
 */

const tenantMock = {
  tenants: [
    { id: "tenant-1", slug: "personal", name: "Personal" },
  ] as Array<{ id: string; slug: string; name: string }>,
  activeTenantId: "tenant-1" as string | null,
  isMultiTenant: false,
  loading: false,
  error: null as string | null,
  setActiveTenantId: vi.fn(),
};

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => tenantMock,
}));

function setTenantMock(patch: Partial<typeof tenantMock>) {
  Object.assign(tenantMock, patch);
}

// Plain top-level import is fine: vitest hoists vi.mock above all
// non-hoisted imports, so SessionsList's useTenant resolves to the
// mock declared above.
// eslint-disable-next-line import/first
import { SessionsList } from "./SessionsList";

function mockSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "tenant-1",
    device_id: "84c02292-32cb-4983-be85-d00f868b7003",
    session_kind: "agentic",
    intent: {
      purpose: "Phase 5 smoke test",
      repo: "qontinui-web",
      branch: "main",
    },
    state: "active",
    started_at: new Date(Date.now() - 60_000).toISOString(),
    last_heartbeat_at: new Date(Date.now() - 5_000).toISOString(),
    closed_at: null,
    parent_session_id: null,
    repo: "qontinui-web",
    branch: "main",
    ...overrides,
  };
}

function renderList(
  sessions: SessionRow[],
  opts: { scope?: string; throwError?: boolean } = {}
) {
  const fetcher = vi.fn(async () => {
    if (opts.throwError) {
      throw new Error("network down");
    }
    return {
      count: sessions.length,
      scope: opts.scope ?? "active",
      sessions,
    };
  });
  const utils = render(
    <TooltipProvider>
      <SessionsList pollEnabled={false} fetcher={fetcher} />
    </TooltipProvider>
  );
  return { ...utils, fetcher };
}

describe("SessionsList", () => {
  beforeEach(() => {
    // Clean localStorage state between tests so the scope toggle
    // tests start from a known default.
    localStorage.clear();
    // Reset the tenant mock to single-tenant default so tests that
    // toggle isMultiTenant don't leak into each other.
    setTenantMock({
      tenants: [{ id: "tenant-1", slug: "personal", name: "Personal" }],
      activeTenantId: "tenant-1",
      isMultiTenant: false,
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows a loading state while the first fetch is in flight", () => {
    renderList([], { throwError: false });
    expect(
      document.querySelector("[data-ui-bridge-id='sessions.loading']")
    ).not.toBeNull();
  });

  it("renders one card per session row after fetch resolves", async () => {
    renderList([
      mockSession({ id: "aaa", state: "active" }),
      mockSession({ id: "bbb", state: "closed" }),
    ]);
    await waitFor(() => {
      const cards = document.querySelectorAll(
        "[data-ui-bridge-id='sessions.card']"
      );
      expect(cards.length).toBe(2);
    });
  });

  it("sorts active sessions before closed ones", async () => {
    renderList([
      mockSession({ id: "closed-1", state: "closed" }),
      mockSession({ id: "active-1", state: "active" }),
    ]);
    await waitFor(() => {
      const links = Array.from(
        document.querySelectorAll(
          "[data-ui-bridge-id='sessions.card-link']"
        )
      );
      expect(links.length).toBe(2);
      // Active first.
      expect(links[0]!.getAttribute("data-session-id")).toBe("active-1");
      expect(links[1]!.getAttribute("data-session-id")).toBe("closed-1");
    });
  });

  it("renders an empty-state when the fetch returns zero sessions", async () => {
    renderList([]);
    await waitFor(() => {
      expect(
        document.querySelector("[data-ui-bridge-id='sessions.empty']")
      ).not.toBeNull();
    });
  });

  it("renders an error state when the fetch throws", async () => {
    renderList([], { throwError: true });
    await waitFor(() => {
      expect(
        document.querySelector("[data-ui-bridge-id='sessions.error-state']")
      ).not.toBeNull();
    });
  });

  it("persists the session-state scope toggle in localStorage", async () => {
    // Post-axis-split: the state tabs read "Active" / "All sessions"
    // (the old "Active tenant only" / "All my tenants" labels migrated
    // to the separate tenant-breadth tab list — see the multi-tenant
    // test below). Storage key is unchanged: qontinui.sessions.scope.
    const user = userEvent.setup();
    renderList([]);
    await waitFor(() => {
      expect(
        document.querySelector("[data-ui-bridge-id='sessions.empty']")
      ).not.toBeNull();
    });

    // Click "All sessions" — the state-axis toggle. Radix Tabs needs
    // real pointer events (userEvent), not raw fireEvent.click.
    const allTab = screen.getByRole("tab", { name: /^all sessions$/i });
    await user.click(allTab);
    await waitFor(() => {
      expect(localStorage.getItem("qontinui.sessions.scope")).toBe("all");
    });

    // Then back to "Active". Anchor to the data-ui-bridge-id to
    // disambiguate from any future tab also labeled "Active" (the
    // tenant-breadth tab would be, when isMultiTenant).
    const activeTab = document.querySelector(
      "[data-ui-bridge-id='sessions.scope-active']"
    ) as HTMLElement;
    expect(activeTab).not.toBeNull();
    await user.click(activeTab);
    await waitFor(() => {
      expect(localStorage.getItem("qontinui.sessions.scope")).toBe("active");
    });
  });

  it("does not render the tenant-breadth tabs for single-tenant operators", async () => {
    // isMultiTenant=false (the default mock state); the tenant-breadth
    // tab list must be structurally absent. Single-tenant operators see
    // zero added UI per the plan.
    renderList([]);
    await waitFor(() => {
      expect(
        document.querySelector("[data-ui-bridge-id='sessions.empty']")
      ).not.toBeNull();
    });
    expect(
      document.querySelector("[data-ui-bridge-id='sessions.tenant-scope-tabs']")
    ).toBeNull();
  });

  it("renders + persists the tenant-breadth toggle for multi-tenant operators", async () => {
    setTenantMock({
      tenants: [
        { id: "tenant-1", slug: "personal", name: "Personal" },
        { id: "tenant-2", slug: "team", name: "Team" },
      ],
      isMultiTenant: true,
    });
    const user = userEvent.setup();
    renderList([]);
    await waitFor(() => {
      expect(
        document.querySelector("[data-ui-bridge-id='sessions.empty']")
      ).not.toBeNull();
    });
    expect(
      document.querySelector("[data-ui-bridge-id='sessions.tenant-scope-tabs']")
    ).not.toBeNull();

    // Toggle to "All my tenants" via the explicit ui-bridge-id so the
    // selector can't be confused with the state-axis tabs.
    const allMine = document.querySelector(
      "[data-ui-bridge-id='sessions.tenant-scope-all']"
    ) as HTMLElement;
    expect(allMine).not.toBeNull();
    await user.click(allMine);
    await waitFor(() => {
      expect(localStorage.getItem("qontinui.sessions.tenant_scope")).toBe(
        "all"
      );
    });

    const activeOnly = document.querySelector(
      "[data-ui-bridge-id='sessions.tenant-scope-active']"
    ) as HTMLElement;
    await user.click(activeOnly);
    await waitFor(() => {
      expect(localStorage.getItem("qontinui.sessions.tenant_scope")).toBe(
        "active"
      );
    });
  });

  it("uses hostnameFor to resolve device_id to hostname on the card", async () => {
    const session = mockSession({ device_id: "uuid-abc" });
    render(
      <TooltipProvider>
        <SessionsList
          pollEnabled={false}
          fetcher={async () => ({
            count: 1,
            scope: "active",
            sessions: [session],
          })}
          hostnameFor={(id) => (id === "uuid-abc" ? "msi-laptop" : undefined)}
        />
      </TooltipProvider>
    );
    await waitFor(() => {
      const host = document.querySelector(
        "[data-ui-bridge-id='sessions.card-host']"
      );
      expect(host?.textContent).toContain("msi-laptop");
    });
  });
});
