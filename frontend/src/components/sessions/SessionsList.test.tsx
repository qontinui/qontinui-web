import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionsList } from "./SessionsList";
import type { SessionRow } from "./types";

/**
 * SessionsList — render + scope-toggle tests for Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * The list polls `GET /api/v1/operations/sessions` every 5s. Tests
 * disable polling and inject a mock fetcher to avoid the timer.
 */

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

  it("persists the scope toggle in localStorage", async () => {
    const user = userEvent.setup();
    renderList([]);
    await waitFor(() => {
      expect(
        document.querySelector("[data-ui-bridge-id='sessions.empty']")
      ).not.toBeNull();
    });

    // Click the "All my tenants" tab and confirm localStorage flips.
    // Radix Tabs requires pointer events — userEvent simulates them
    // properly; raw `fireEvent.click` does not flip the controlled
    // value.
    const allTab = screen.getByRole("tab", { name: /all my tenants/i });
    await user.click(allTab);
    await waitFor(() => {
      expect(localStorage.getItem("qontinui.sessions.scope")).toBe("all");
    });

    // Then back to "Active tenant only".
    const activeTab = screen.getByRole("tab", { name: /active tenant only/i });
    await user.click(activeTab);
    await waitFor(() => {
      expect(localStorage.getItem("qontinui.sessions.scope")).toBe("active");
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
