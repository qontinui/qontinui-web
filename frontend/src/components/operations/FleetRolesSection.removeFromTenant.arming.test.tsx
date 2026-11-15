/**
 * Arming tests for "Remove from this tenant…" (plan
 * `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3).
 *
 * Every module-level import here exists BEFORE the change, and the only mocks
 * are of modules that exist before it too (the HTTP client, the toast, the
 * auth context, the destructive button). So with the production change
 * reverted this file still compiles and each test goes RED for a behavioural
 * reason: the control, the dialog or the words are absent. The full matrix is
 * in `FleetRolesSection.removeFromTenant.test.tsx`.
 *
 * `DestructiveButton` is replaced by a plain button: jsdom cannot produce a
 * trusted click, and its synthetic-click guard is covered by
 * `components/ui/destructive-button.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toastMock) }));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import { absoluteTime } from "@/components/console";
import { FleetRolesSection } from "./FleetRolesSection";

const WORKSTATION_NAME = "hostname-alpha-7731";
const WORKSTATION_DEVICE = "a1a1a1a1-0000-4000-8000-00000000000a";
const CI_NAME = "ci-box-4410";
const DEV_CI = "c3c3c3c3-0000-4000-8000-00000000000c";
const DEV_CI_2 = "c3c3c3c3-0000-4000-8000-0000000000c2";
const DEV_CI_OTHER = "e5e5e5e5-0000-4000-8000-00000000000e";
const SEEN_CI = "2026-11-11T08:00:00Z";
const SEEN_CI_2 = "2026-11-12T09:30:00Z";

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const lane = { effective: "open", role: "open", drain: { state: "none" } };

/** One coord `MachineView` row, built inline. */
function machine(over: Record<string, unknown>) {
  return {
    kind: "workstation",
    registration: "registered",
    role: null,
    suggestion: null,
    lanes: { agent: lane, ci: lane },
    pre_change_sessions: { state: "not_applicable" },
    ...over,
  };
}

const ciHost = (over: Record<string, unknown> = {}) =>
  machine({
    kind: "ci_host",
    machine_key: `host:${CI_NAME}`,
    device_id: null,
    ci_host_name: CI_NAME,
    name: CI_NAME,
    heartbeat_fresh: false,
    device_ids: [DEV_CI, DEV_CI_2],
    last_seen_at: SEEN_CI_2,
    device_listings: [
      {
        device_id: DEV_CI,
        scope: "acme-partner/secret-repo",
        last_seen_at: SEEN_CI,
        registrar_listing: "not_listed",
        registrar_listing_detail: null,
      },
      {
        device_id: DEV_CI_2,
        scope: "acme-partner/other-repo",
        last_seen_at: SEEN_CI_2,
        registrar_listing: "not_listed",
        registrar_listing_detail: null,
      },
    ],
    ...over,
  });

const workstation = () =>
  machine({
    machine_key: `device:${WORKSTATION_DEVICE}`,
    device_id: WORKSTATION_DEVICE,
    ci_host_name: null,
    name: WORKSTATION_NAME,
    heartbeat_fresh: true,
    device_ids: [WORKSTATION_DEVICE],
    last_seen_at: "2026-11-15T09:00:00Z",
  });

let machines: Record<string, unknown>[];
let postAnswers: Array<ReturnType<typeof json>>;

beforeEach(() => {
  machines = [ciHost(), workstation()];
  postAnswers = [];
  toastMock.success.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/fleet/devices/unbind")) {
      return postAnswers.shift() ?? json(500, { detail: "unexpected" });
    }
    return json(200, { state: "known", roles_table: "present", machines });
  });
});

async function openRemoval(name: string) {
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
  return screen.getByTestId("fleet-roles-remove-dialog");
}

const confirmButton = () =>
  screen.getByTestId("fleet-roles-remove-dialog-confirm") as HTMLButtonElement;

describe("FleetRolesSection — remove from this tenant (arming)", () => {
  it("arming: the typed phrase enables the confirm only when it is the machine's name", async () => {
    machines = [workstation()];
    render(<FleetRolesSection />);
    const dialog = await openRemoval(WORKSTATION_NAME);
    const input = within(dialog).getByTestId(
      "fleet-roles-remove-dialog-phrase-input"
    );
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(input, {
      target: { value: WORKSTATION_NAME.slice(0, -1) },
    });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: WORKSTATION_NAME } });
    expect(confirmButton().disabled).toBe(false);
  });

  it("arming: warns when this is the tenant's last CI host, and not when another remains", async () => {
    const view = render(<FleetRolesSection />);
    let dialog = await openRemoval(CI_NAME);
    expect(
      within(dialog).getByTestId("fleet-roles-remove-last-ci-host").textContent
    ).toBe(
      "This is the tenant's last CI host. Removing it makes coord treat the tenant as having no CI fleet, so its merge cap falls back to the static value."
    );
    view.unmount();

    machines = [
      ciHost(),
      ciHost({
        machine_key: "host:other-ci",
        ci_host_name: "other-ci",
        name: "other-ci",
        device_ids: [DEV_CI_OTHER],
        device_listings: [],
      }),
    ];
    render(<FleetRolesSection />);
    dialog = await openRemoval(CI_NAME);
    expect(
      within(dialog).queryByTestId("fleet-roles-remove-last-ci-host")
    ).toBeNull();
  });

  it("arming: names each row with its own age, the full stamp in its title", async () => {
    render(<FleetRolesSection />);
    const dialog = await openRemoval(CI_NAME);
    const seen = within(dialog).getAllByTestId("fleet-roles-remove-row-seen");
    expect(seen.map((s) => s.getAttribute("title"))).toEqual([
      absoluteTime(SEEN_CI),
      absoluteTime(SEEN_CI_2),
    ]);
    expect(seen[0]!.textContent).toMatch(/ago$/);
    expect(dialog.textContent).toContain(DEV_CI);
    expect(dialog.textContent).toContain(DEV_CI_2);
  });

  it("arming: a partial removal says partial and never toasts", async () => {
    postAnswers = [
      json(200, {
        results: [
          {
            device_id: DEV_CI,
            outcome: "unbound",
            status: 200,
            error: null,
            still_member_via_pointer: false,
          },
          {
            device_id: DEV_CI_2,
            outcome: "failed",
            status: 503,
            error: {
              error: "tenant_devices_absent",
              detail: "coord.tenant_devices is not provisioned",
            },
            still_member_via_pointer: null,
          },
        ],
        unbound: 1,
        already_absent: 0,
        failed: 1,
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_NAME);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain("1 of 2 rows removed; 1 failed.");
    expect(result.textContent).toContain(
      "coord.tenant_devices is not provisioned"
    );
    await waitFor(() =>
      expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
        "1 of 2 rows removed; 1 failed."
      )
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("fleet-roles-remove-dialog")).toBeTruthy();
  });
});
