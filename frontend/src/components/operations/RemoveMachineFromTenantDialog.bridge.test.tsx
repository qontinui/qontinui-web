/**
 * "Remove from this tenant…"'s UI Bridge registration (plan
 * `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3): read from what the control hands `useUIElement`, not from a DOM
 * attribute. The action is declared `destructive` (an autonomous walk must
 * exclude it), says what it removes, and its handler only OPENS the dialog —
 * it sends nothing, because the confirm needs a real click.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { RegisteredElement } from "@qontinui/ui-bridge";

/**
 * The LATEST config each id rendered with. The SDK (>= 0.54) runs the handler
 * of the latest committed declaration, so that is what a bridge call reaches;
 * the handler closes over its render's values with no latest-ref mirror. Read
 * it at the moment of the call, never from an earlier capture.
 */
const registered = new Map<string, RegisteredElement>();
vi.mock("@qontinui/ui-bridge/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@qontinui/ui-bridge/react")>()),
  useUIElement: (config: RegisteredElement & { id: string }) => {
    registered.set(config.id, config);
    return { ref: () => {} };
  },
}));
const removeAction = (id: string) =>
  registered.get(id)?.customActions?.["remove-from-tenant"];
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
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
    info: vi.fn(),
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

let deviceIds: string[];

beforeEach(() => {
  registered.clear();
  deviceIds = [DEV_1, DEV_2];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return json(200, {
        results: [DEV_1, DEV_2].map((device_id) => ({
          device_id,
          outcome: "unbound",
          status: 200,
          error: null,
          still_member_via_pointer: false,
        })),
        unbound: 2,
        already_absent: 0,
        unknown: 0,
        failed: 0,
        not_attempted: 0,
      });
    }
    void url;
    return json(200, {
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
          device_ids: deviceIds,
          last_seen_at: "2026-11-12T09:30:00Z",
          lanes: { agent: lane, ci: lane },
          pre_change_sessions: { state: "not_applicable" },
        },
      ],
    });
  });
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
    // The count is not baked into a registration that can outlive a read.
    expect(action?.description).toContain(
      "removes this tenant's binding of every device row the roster lists for this machine"
    );
    expect(action?.description).toContain(
      "Refused while a removal is in flight or any removal dialog is open."
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

  it("after a roster re-read, the bridge's handler opens the machine as the roster now reads it", async () => {
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText(CI));
    const id = `fleet-roles-remove:host:${CI}`;
    expect(removeAction(id)).toBeTruthy();

    // A removal re-reads the roster, which now lists one row for the host
    // (e.g. the registrar re-bound one of them).
    fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
    deviceIds = [DEV_1];
    fireEvent.click(screen.getByTestId("fleet-roles-remove-dialog-confirm"));
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    await waitFor(() =>
      expect(screen.getByTestId("fleet-roles-remove-open").title).toBe(
        "Opens a confirmation; removes this tenant's binding of 1 device."
      )
    );

    let result: unknown;
    await act(async () => {
      result = await removeAction(id)!.handler(undefined);
    });
    // Its result names the count as the roster reads now, not at first render.
    expect(result).toEqual({
      opened: true,
      effect: "removes this tenant's binding of 1 device",
    });
    const rows = screen.getAllByTestId("fleet-roles-remove-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain(DEV_1);
  });

  it("the handler refuses while a removal is in flight", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") await held;
      return base(url, init);
    });
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText(CI));
    fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
    fireEvent.click(screen.getByTestId("fleet-roles-remove-dialog-confirm"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === "POST"
        )
      ).toBe(true)
    );
    let resolved: unknown;
    await act(async () => {
      resolved = await removeAction(`fleet-roles-remove:host:${CI}`)!.handler(
        undefined
      );
    });
    expect(resolved).toEqual({
      opened: false,
      reason: "a removal is in flight",
    });
    await act(async () => {
      release();
    });
  });

  it("the handler refuses while another machine's dialog is open", async () => {
    const OTHER = "ci-box-9902";
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const res = await base(url, init);
      if (init?.method === "POST") return res;
      const body = (await res.json()) as {
        machines: Record<string, unknown>[];
      };
      body.machines.push({
        ...body.machines[0]!,
        machine_key: `host:${OTHER}`,
        ci_host_name: OTHER,
        name: OTHER,
        device_ids: ["e5e5e5e5-0000-4000-8000-00000000000e"],
      });
      return json(200, body);
    });
    render(<FleetRolesSection />);
    // Open CI's dialog.
    fireEvent.click(await screen.findByText(CI));
    fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
    expect(screen.getByTestId("fleet-roles-remove-dialog")).toBeTruthy();
    // OTHER's handler, while CI's dialog is open.
    fireEvent.click(screen.getByText(OTHER));
    const other = registered.get(`fleet-roles-remove:host:${OTHER}`)
      ?.customActions?.["remove-from-tenant"];
    expect(other).toBeTruthy();
    let resolved: unknown;
    await act(async () => {
      resolved = await other!.handler(undefined);
    });
    expect(resolved).toEqual({
      opened: false,
      reason: "another machine's removal dialog is open",
    });
    // The open dialog is still CI's.
    expect(
      screen.getByTestId("fleet-roles-remove-dialog").textContent
    ).toContain(`Remove ${CI} from this tenant?`);
  });

  it("the handler refuses while this machine's own dialog is open, keeping its retry scope", async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return base(url, init);
      return json(200, {
        results: [
          {
            device_id: DEV_1,
            outcome: "unbound",
            status: 200,
            error: null,
            still_member_via_pointer: false,
          },
          {
            device_id: DEV_2,
            outcome: "failed",
            status: 500,
            error: { error: "boom" },
            still_member_via_pointer: null,
          },
        ],
      });
    });
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText(CI));
    fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
    fireEvent.click(screen.getByTestId("fleet-roles-remove-dialog-confirm"));
    await waitFor(() =>
      expect(
        screen.getByTestId("fleet-roles-remove-dialog-confirm").textContent
      ).toBe("Retry the 1 device row not confirmed removed")
    );
    const action = registered.get(`fleet-roles-remove:host:${CI}`)
      ?.customActions?.["remove-from-tenant"];
    let resolved: unknown;
    await act(async () => {
      resolved = await action!.handler(undefined);
    });
    expect(resolved).toEqual({
      opened: false,
      reason: "this machine's removal dialog is already open",
    });
    // Not reopened, so the retry scope survives.
    expect(
      screen.getByTestId("fleet-roles-remove-dialog-confirm").textContent
    ).toBe("Retry the 1 device row not confirmed removed");
  });
});
