/**
 * "Remove from this tenant…"'s UI Bridge registration (plan
 * `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3): read from what the control hands `useUIElement`, not from a DOM
 * attribute. The action is declared `destructive` (an autonomous walk must
 * exclude it), says what it removes, and its handler only OPENS the dialog —
 * it sends nothing, because the confirm needs a real click.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RegisteredElement } from "@qontinui/ui-bridge";

const registered = new Map<string, RegisteredElement>();
vi.mock("@qontinui/ui-bridge/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@qontinui/ui-bridge/react")>()),
  useUIElement: (config: RegisteredElement & { id: string }) => {
    registered.set(config.id, config);
    return { ref: () => {} };
  },
}));

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

import { FleetRolesSection } from "./FleetRolesSection";

const CI = "ci-box-4410";
const DEV_1 = "c3c3c3c3-0000-4000-8000-00000000000c";
const DEV_2 = "c3c3c3c3-0000-4000-8000-0000000000c2";
const lane = { effective: "open", role: "open", drain: { state: "none" } };

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  registered.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    json(200, {
      state: "known",
      roles_table: "present",
      roster_truncated: false,
      machines: [
        {
          kind: "ci_host",
          machine_key: `host:${CI}`,
          device_id: null,
          ci_host_name: CI,
          name: CI,
          registration: "registered",
          role: null,
          suggestion: null,
          heartbeat_fresh: false,
          device_ids: [DEV_1, DEV_2],
          last_seen_at: "2026-11-12T09:30:00Z",
          lanes: { agent: lane, ci: lane },
          pre_change_sessions: { state: "not_applicable" },
        },
      ],
    })
  );
});

describe("the remove-from-tenant control's UI Bridge registration", () => {
  it("declares a destructive action that names its effect and only opens the dialog", async () => {
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText(CI));
    const id = `fleet-roles-remove:host:${CI}`;
    const el = registered.get(id);
    expect(el?.type).toBe("button");
    expect(el?.label).toBe(`Remove ${CI} from this tenant`);
    const action = el?.customActions?.["remove-from-tenant"];
    expect(action?.effect).toBe("destructive");
    expect(action?.description).toContain(
      "removes this tenant's binding of 2 devices"
    );

    const before = fetchMock.mock.calls.length;
    let resolved: unknown;
    await act(async () => {
      resolved = await action!.handler(undefined);
    });
    expect(resolved).toEqual({
      opened: true,
      effect: "removes this tenant's binding of 2 devices",
    });
    expect(screen.getByTestId("fleet-roles-remove-dialog")).toBeTruthy();
    // Opening sent nothing: no POST, only (at most) the roster's own poll.
    const posts = fetchMock.mock.calls
      .slice(before)
      .filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST"
      );
    expect(posts).toEqual([]);
  });
});
