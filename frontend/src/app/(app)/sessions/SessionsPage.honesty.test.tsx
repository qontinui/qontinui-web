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
import { cappedLifecycleEnvelope } from "./__tests__/sessionsPageFixtures";

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

    // ALL-dash means every count, not one: each status tab, every stat, the
    // strip's badges and the work facet's two counts.
    const tabs = { all: "All", live: "Live", stale: "Stale", closed: "Closed" };
    for (const [id, label] of Object.entries(tabs)) {
      expect(
        screen.getByTestId(`sessions-console-status-${id}`)
      ).toHaveTextContent(new RegExp(`^${label}–$`));
    }
    expect(
      screen.getByTestId("sessions-console-stats").textContent
    ).not.toMatch(/\d/);
    expect(health.textContent).not.toMatch(/\b0\b/);
    expect(health).toHaveTextContent("needs a person –");
    expect(health).toHaveTextContent("active –");
    for (const value of ["finished", "unfinished"]) {
      expect(
        screen.getByTestId(`sessions-console-work-${value}`)
      ).toHaveTextContent("–");
    }
  });

  it("discloses the 500-row ceiling once a capped read lands", async () => {
    listConsolidatedSessions.mockResolvedValue(cappedLifecycleEnvelope());
    render(<SessionsPage />);

    const note = await screen.findByTestId("sessions-console-truncated");
    expect(note).toHaveTextContent(/500 most recently started lifecycle sessions/);
    expect(note).toHaveTextContent(/fleet totals may be higher/);
    // Only the capped half is named.
    expect(note).not.toHaveTextContent(/agent sessions/);
  });
});
