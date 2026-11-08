/**
 * /sessions — the console's honesty fixes, entered where the operator enters:
 * through `SessionsPage`, not through `SessionsConsole` directly.
 *
 * Plan `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
 * (qontinui-dev-notes). The component tests beside `SessionsConsole` render the
 * console on its own; these two prove the page the population loads mounts the
 * console with the same behaviour — an amber, all-dash first paint inside a
 * container-query root, and the 500-row ceiling disclosed once the read lands.
 *
 * Only the page's data hooks and the one network read are stubbed; the page
 * and the console render for real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const listConsolidatedSessions = vi.fn();

vi.mock("@/lib/api/operations/sessions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/operations/sessions")>();
  return {
    ...actual,
    listConsolidatedSessions: (...args: unknown[]) =>
      listConsolidatedSessions(...args),
  };
});

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "op@example.com" } }),
}));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [],
    activeTenantId: null,
    loading: false,
    error: null,
    setActiveTenantId: () => {},
    refresh: async () => {},
  }),
}));

vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({
    byHostname: new Map(),
    connected: true,
    error: null,
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import SessionsPage from "./page";

function bound(shown: number) {
  return {
    available: true,
    bound_kind: shown >= 500 ? "unknown" : "complete",
    count: shown,
    enumerate_via: null,
    filter_narrowed: null,
    limit: 500,
    next_cursor: null,
    shown,
    total: null,
    truncated: shown >= 500 ? null : false,
  };
}

function row(n: number) {
  return {
    id: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`,
    device_id: "dev-a",
    row_class: "lifecycle_only",
    session_kind: "terminal_shell",
    provider: null,
    state: "active",
    started_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    intent: { purpose: `shell ${n}` },
    agent_session: null,
  };
}

beforeEach(() => {
  listConsolidatedSessions.mockReset();
});

describe("SessionsPage — the population's entry point", () => {
  it("paints an amber, all-dash 'Reading sessions…' strip inside a container root before the first read", () => {
    listConsolidatedSessions.mockImplementation(() => new Promise(() => {}));
    render(<SessionsPage />);

    const root = document.querySelector('[data-ui-bridge-id="sessions.console"]');
    expect(root).not.toBeNull();
    expect(root!.className).toMatch(/(^|\s)@container(\s|$)/);

    const health = screen.getByTestId("sessions-console-health");
    expect(health).toHaveAttribute("data-health-level", "amber");
    expect(health).toHaveTextContent(/Reading sessions/);
    expect(screen.queryByText(/No sessions match/i)).toBeNull();
    expect(screen.getByTestId("sessions-console-status-all")).toHaveTextContent("–");
  });

  it("discloses the 500-row ceiling once a capped read lands", async () => {
    const sessions = Array.from({ length: 3 }, (_, i) => row(i + 1));
    listConsolidatedSessions.mockResolvedValue({
      count: sessions.length,
      scope: "all",
      shape: "consolidated",
      sessions,
      row_class_counts: { linked: 0, lifecycle_only: 3, agent_only: 0, unknown: 0 },
      withheld_by_filter: 0,
      lifecycle_half: { read: "ok", bound: bound(500) },
      agent_half: { read: "ok", bound: bound(12) },
    });
    render(<SessionsPage />);

    const note = await screen.findByTestId("sessions-console-truncated");
    expect(note).toHaveTextContent(/500 most recently started lifecycle sessions/);
    expect(note).toHaveTextContent(/fleet totals may be higher/);
    // Only the capped half is named.
    expect(note).not.toHaveTextContent(/agent sessions/);
  });
});
