/**
 * RegisteredDevicesList — the per-runner credential panel on the `/runners`
 * Devices tab (plan
 * `2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web`
 * Phases 1, 2.4 and 4).
 *
 * What this pins, on the NEW surface rather than on the devops page:
 *
 * 1. A device with no coord `device_status` row (never reported, or pruned
 *    after an hour) renders `credential unknown` — never live/authenticated.
 *    Same for a row past its staleness bound, and for a row under the same
 *    hostname that belongs to a different device.
 * 2. Authenticate calls the path-scoped authorize route and then says
 *    PENDING, never success — a 202 records an authorization, it does not
 *    observe the runner re-authenticating.
 * 3. Revoke goes through a confirmation and calls the revoke route for that
 *    device; its copy says "renews automatically until revoked".
 * 4. An absent overview row reads the machine key as UNKNOWN, not "none".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RegisteredDevice } from "@/types/runner";
import type { DeviceStatus } from "@/components/operations/types";
import type { DeviceCredentialOverviewRow } from "@/lib/api/device_credentials";

const getRunnersMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  runnerService: {
    getRunners: (...args: unknown[]) => getRunnersMock(...args),
  },
}));

let statusRows = new Map<string, DeviceStatus>();
vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({ byHostname: statusRows }),
}));

const overviewMock = vi.fn();
const authorizeMock = vi.fn();
const revokeMock = vi.fn();
vi.mock("@/lib/api/device_credentials", () => ({
  getDeviceCredentialOverview: (...a: unknown[]) => overviewMock(...a),
  authorizeDeviceRedeem: (...a: unknown[]) => authorizeMock(...a),
  revokeDeviceMachineCredential: (...a: unknown[]) => revokeMock(...a),
}));

vi.mock("@/hooks/useRealtimeConnections", () => ({
  useRealtimeConnections: () => ({ runners: [] }),
}));
vi.mock("@/hooks/useRunners", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useRunners")>(
      "@/hooks/useRunners"
    );
  return {
    ...actual,
    useDeleteRunner: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});
vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
// jsdom cannot produce a trusted click; the synthetic-click gate is covered by
// destructive-button.test.tsx. Here we test the route the confirm calls.
vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import { RegisteredDevicesList } from "./RegisteredDevicesList";

const DEVICE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const DEVICE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

function device(id: string, hostname: string): RegisteredDevice {
  return {
    id,
    userId: "33333333-3333-3333-3333-333333333333",
    name: `runner-${hostname}`,
    hostname,
    port: 9876,
    capabilities: [],
    derivedStatus: "offline",
    lastHeartbeat: null,
    wsConnected: false,
    createdAt: "2026-09-01T00:00:00Z",
    instances: [],
    tenant_bindings: null,
  } as RegisteredDevice;
}

function statusRow(
  deviceId: string,
  hostname: string,
  bag: Record<string, unknown>,
  updatedAt: string
): DeviceStatus {
  return {
    device_id: deviceId,
    hostname,
    current_task: null,
    current_repo: null,
    current_branch: null,
    free_text: null,
    details: { coord_credential: bag },
    tenant_id: null,
    updated_at: updatedAt,
  };
}

function overviewRow(
  deviceId: string,
  over: Partial<DeviceCredentialOverviewRow> = {}
): DeviceCredentialOverviewRow {
  return {
    device_id: deviceId,
    hostname: null,
    machine_key: { present: false, expires_at: null, revoked_at: null },
    credential_revoked_at: null,
    pending_redeem: null,
    ...over,
  };
}

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegisteredDevicesList showOnlyOnline={false} />
    </QueryClientProvider>
  );
}

async function panelFor(deviceId: string): Promise<HTMLElement> {
  const panels = await screen.findAllByTestId("device-credential-panel");
  const panel = panels.find(
    (p) => p.getAttribute("data-device-id") === deviceId
  );
  if (!panel) throw new Error(`no panel for ${deviceId}`);
  return panel;
}

function postureOf(panel: HTMLElement): HTMLElement {
  return within(panel).getByTestId("device-credential-posture");
}

describe("RegisteredDevicesList credential panel", () => {
  beforeEach(() => {
    getRunnersMock.mockReset();
    overviewMock.mockReset();
    authorizeMock.mockReset();
    revokeMock.mockReset();
    statusRows = new Map();
  });

  it("renders UNKNOWN — never live — when a device has no posture row", async () => {
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({ devices: [overviewRow(DEVICE_A)] });

    renderList();
    const panel = await panelFor(DEVICE_A);
    const posture = postureOf(panel);

    expect(posture).toHaveAttribute("data-posture-kind", "unknown");
    expect(posture).toHaveAttribute("data-posture-measured", "false");
    expect(posture).toHaveTextContent("credential unknown");
    expect(posture).not.toHaveTextContent(/live|authenticated/i);
    expect(
      within(panel).getByTestId("device-credential-last-observed")
    ).toHaveTextContent("no posture report on record");
    // Not live ⇒ the Authenticate control is offered.
    expect(
      within(panel).getByTestId("device-authenticate-button")
    ).toBeInTheDocument();
  });

  it("renders UNKNOWN for a stale row and for a hostname row owned by another device", async () => {
    const stale = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const fresh = new Date().toISOString();
    statusRows = new Map([
      [
        "box-a",
        statusRow(DEVICE_A, "box-a", { ok: true, posture: "live" }, stale),
      ],
      // A re-paired box: the row under "box-b" belongs to a different device.
      [
        "box-b",
        statusRow(DEVICE_A, "box-b", { ok: true, posture: "live" }, fresh),
      ],
    ]);
    getRunnersMock.mockResolvedValue([
      device(DEVICE_A, "box-a"),
      device(DEVICE_B, "box-b"),
    ]);
    overviewMock.mockResolvedValue({ devices: [] });

    renderList();
    expect(postureOf(await panelFor(DEVICE_A))).toHaveAttribute(
      "data-posture-kind",
      "unknown"
    );
    expect(postureOf(await panelFor(DEVICE_B))).toHaveAttribute(
      "data-posture-kind",
      "unknown"
    );
    // No overview row ⇒ the machine key is UNKNOWN, not "none".
    expect(
      within(await panelFor(DEVICE_B)).getByTestId("device-machine-key")
    ).toHaveAttribute("data-machine-key-state", "unknown");
  });

  it("renders live from a fresh report and offers no Authenticate", async () => {
    statusRows = new Map([
      [
        "box-a",
        statusRow(
          DEVICE_A,
          "box-a",
          { ok: true, posture: "live" },
          new Date().toISOString()
        ),
      ],
    ]);
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({ devices: [overviewRow(DEVICE_A)] });

    renderList();
    const panel = await panelFor(DEVICE_A);
    expect(postureOf(panel)).toHaveAttribute("data-posture-kind", "live");
    expect(
      within(panel).queryByTestId("device-authenticate-button")
    ).toBeNull();
  });

  it("Authenticate calls the path-scoped route and shows pending, not success", async () => {
    const user = userEvent.setup();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({ devices: [overviewRow(DEVICE_A)] });
    authorizeMock.mockResolvedValue({
      device_id: DEVICE_A,
      expires_at: expiresAt,
    });

    renderList();
    const panel = await panelFor(DEVICE_A);
    expect(
      within(panel).queryByTestId("device-authenticate-pending")
    ).toBeNull();

    await user.click(within(panel).getByTestId("device-authenticate-button"));

    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(authorizeMock).toHaveBeenCalledWith(DEVICE_A);
    const pending = await within(panel).findByTestId(
      "device-authenticate-pending"
    );
    expect(pending).toHaveTextContent(
      "Authorization pending — any revocation on this runner is lifted now; it collects its new credential at its next check-in (≤5 min)"
    );
    expect(pending).not.toHaveTextContent(/success|authenticated|done/i);
    // The posture badge still says what coord reports — unknown — not live.
    expect(postureOf(panel)).toHaveAttribute("data-posture-kind", "unknown");
  });

  it("shows a server-side pending authorization after a reload", async () => {
    const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({
      devices: [
        overviewRow(DEVICE_A, { pending_redeem: { expires_at: expiresAt } }),
      ],
    });

    renderList();
    const panel = await panelFor(DEVICE_A);
    expect(
      await within(panel).findByTestId("device-authenticate-pending")
    ).toBeInTheDocument();
  });

  it("Revoke confirms, then calls the revoke route for that device", async () => {
    const user = userEvent.setup();
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({
      devices: [
        overviewRow(DEVICE_A, {
          machine_key: {
            present: true,
            expires_at: new Date(Date.now() + 50 * 86_400_000).toISOString(),
            revoked_at: null,
          },
        }),
      ],
    });
    revokeMock.mockResolvedValue({
      device_id: DEVICE_A,
      revoked_at: new Date().toISOString(),
    });

    renderList();
    const panel = await panelFor(DEVICE_A);
    await waitFor(() =>
      expect(within(panel).getByTestId("device-machine-key")).toHaveAttribute(
        "data-machine-key-state",
        "held"
      )
    );
    expect(within(panel).getByTestId("device-machine-key")).toHaveTextContent(
      "renews automatically until revoked"
    );

    await user.click(within(panel).getByTestId("device-revoke-button"));
    // Nothing is sent until the operator confirms.
    expect(revokeMock).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId("device-revoke-dialog");
    expect(dialog).toHaveTextContent("renews automatically until revoked");
    expect(dialog).not.toHaveTextContent(/forever/i);

    await user.click(screen.getByTestId("device-revoke-dialog-confirm"));
    expect(revokeMock).toHaveBeenCalledTimes(1);
    expect(revokeMock).toHaveBeenCalledWith(DEVICE_A);
  });

  it("offers no Revoke once the device-scoped deny is set", async () => {
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({
      devices: [
        overviewRow(DEVICE_A, {
          machine_key: {
            present: true,
            expires_at: null,
            revoked_at: "2026-09-29T00:00:00Z",
          },
          credential_revoked_at: "2026-09-29T00:00:00Z",
        }),
      ],
    });

    renderList();
    const panel = await panelFor(DEVICE_A);
    await within(panel).findByTestId("device-credential-revoked");
    expect(within(panel).queryByTestId("device-revoke-button")).toBeNull();
    expect(within(panel).getByTestId("device-machine-key")).toHaveAttribute(
      "data-machine-key-state",
      "revoked"
    );
    // Truthful copy: renewal is blocked; no claim about which service refuses.
    const revoked = within(panel).getByTestId("device-credential-revoked");
    expect(revoked).toHaveTextContent(
      "this runner's credentials can no longer be renewed until you authenticate it again"
    );
    expect(revoked).not.toHaveTextContent(/coord refuses/i);
  });

  it("offers Revoke with no machine key held, without implying a key", async () => {
    const user = userEvent.setup();
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({ devices: [overviewRow(DEVICE_A)] });
    revokeMock.mockResolvedValue({
      device_id: DEVICE_A,
      revoked_at: new Date().toISOString(),
    });

    renderList();
    const panel = await panelFor(DEVICE_A);
    const button = await within(panel).findByTestId("device-revoke-button");
    expect(button).toHaveTextContent("Revoke credentials");
    expect(button).not.toHaveTextContent(/machine key/i);

    await user.click(button);
    const dialog = await screen.findByTestId("device-revoke-dialog");
    expect(dialog).toHaveTextContent("This runner holds no machine key.");
    expect(dialog).not.toHaveTextContent(/withdraws the key/i);

    await user.click(screen.getByTestId("device-revoke-dialog-confirm"));
    expect(revokeMock).toHaveBeenCalledWith(DEVICE_A);
  });

  it("offers no Revoke when the overview has no row (deny state unknown)", async () => {
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({ devices: [] });

    renderList();
    const panel = await panelFor(DEVICE_A);
    await waitFor(() =>
      expect(within(panel).getByTestId("device-machine-key")).toHaveAttribute(
        "data-machine-key-state",
        "unknown"
      )
    );
    expect(within(panel).queryByTestId("device-revoke-button")).toBeNull();
  });

  it("offers Authenticate for a revoked device whose posture still reads live", async () => {
    statusRows = new Map([
      [
        "box-a",
        statusRow(
          DEVICE_A,
          "box-a",
          { ok: true, posture: "live" },
          new Date().toISOString()
        ),
      ],
    ]);
    getRunnersMock.mockResolvedValue([device(DEVICE_A, "box-a")]);
    overviewMock.mockResolvedValue({
      devices: [
        overviewRow(DEVICE_A, {
          credential_revoked_at: new Date().toISOString(),
        }),
      ],
    });

    renderList();
    const panel = await panelFor(DEVICE_A);
    expect(postureOf(panel)).toHaveAttribute("data-posture-kind", "live");
    expect(
      await within(panel).findByTestId("device-authenticate-button")
    ).toBeInTheDocument();
  });
});
