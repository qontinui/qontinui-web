/**
 * The Roles panel's rows in presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3.3): coord's machine key names the
 * device or the host, so a presented row is keyed by an alias of it. An alias,
 * not a position: this read polls, and a key by position would hand the open
 * row's key to the next machine when one leaves the list, so the detail on
 * screen would silently become another machine's.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

const roles = vi.hoisted(() => ({ read: null as unknown }));
vi.mock("./useFleetDispatchRoles", () => ({
  useFleetDispatchRoles: () => ({
    read: roles.read,
    asOfMs: Date.parse("2026-11-02T10:00:00Z"),
    refresh: vi.fn(),
  }),
}));

import { FixedPresentationMode } from "@/components/presentation";
import { parseDispatchRoles } from "./fleetDispatchRoles";
import { FleetRolesSection } from "./FleetRolesSection";

const DEVICE_A = "3e7e4b04-75de-4efb-b718-c8ce8fcf7b17";
const DEVICE_B = "95a536af-6fa3-496b-97c7-1bce45b3217a";
const DEVICE_C = "c1a6e5d0-1234-4abc-8def-0123456789ab";

const lane = {
  effective: "open",
  role: "open",
  drain: { state: "none", total_devices: 1 },
};
const machine = (device: string, reason: string) => ({
  kind: "workstation",
  machine_key: `device:${device}`,
  device_id: device,
  ci_host_name: null,
  name: `box-${device.slice(0, 4)}`,
  registration: "registered",
  assignment: "assigned",
  role: {
    dispatch_role: "bench",
    reason,
    version: 1,
    updated_by: "op@example.com",
    updated_at: "2026-10-08T10:00:00Z",
  },
  behaves_as: "bench",
  suggestion: null,
  lanes: { agent: lane, ci: lane },
  pre_change_sessions: { state: "not_applicable" },
});

const RAW = [
  machine(DEVICE_A, "a"),
  machine(DEVICE_B, "b"),
  machine(DEVICE_C, "c"),
];
const readOf = (machines: typeof RAW, extra: Record<string, unknown> = {}) =>
  parseDispatchRoles({
    state: "known",
    roles_table: "present",
    machines,
    ...extra,
  });

const panel = () => (
  <FixedPresentationMode presenting>
    <FleetRolesSection />
  </FixedPresentationMode>
);

const toggle = (row: HTMLElement) =>
  row.querySelector<HTMLElement>("button[aria-expanded]")!;
const shownRows = () => screen.getAllByTestId("fleet-roles-row");
/** A row's machine, by its alias: an alias stays with its machine. */
const aliasOf = (row: HTMLElement) =>
  toggle(row).textContent?.match(/Machine [A-Z]+/)?.[0];
const openRows = () =>
  shownRows()
    .filter((row) => toggle(row).getAttribute("aria-expanded") === "true")
    .map(aliasOf);

beforeEach(() => {
  roles.read = readOf(RAW);
});

describe("FleetRolesSection?present=1 — a row is keyed by an alias of its machine", () => {
  it("keeps the machine's id out of `data-row-key`", () => {
    render(panel());
    const keys = shownRows().map((row) => row.getAttribute("data-row-key"));
    expect(keys).toHaveLength(RAW.length);
    expect(new Set(keys).size).toBe(RAW.length);
    for (const device of [DEVICE_A, DEVICE_B, DEVICE_C]) {
      expect(document.body.innerHTML).not.toContain(device);
    }
  });

  it("keeps the open row on its machine when a poll removes the row above it", () => {
    const view = render(panel());
    const opened = aliasOf(shownRows()[1]!);
    expect(opened).toBeTruthy();
    fireEvent.click(toggle(shownRows()[1]!));
    expect(openRows()).toEqual([opened]);

    // The machine listed first leaves, so the next one moves into the place
    // that was open.
    const listed = (roles.read as { machines: { key: string }[] }).machines;
    roles.read = readOf(RAW.filter((m) => m.machine_key !== listed[0]!.key));
    view.rerender(panel());

    expect(shownRows()).toHaveLength(RAW.length - 1);
    expect(openRows()).toEqual([opened]);
  });
});

describe("FleetRolesSection?present=1 — coord's own words stay with the operator", () => {
  it("says there is a note, in fixed words, never coord's text", () => {
    roles.read = readOf(RAW, {
      detail:
        "coord.machine_dispatch_roles is not provisioned on this database",
      roles_table: "absent",
    });
    render(panel());
    const notice = screen.getByTestId("fleet-roles-notice");
    expect(notice).toHaveTextContent(
      "Coord added a note about this list, withheld in presentation mode."
    );
    expect(document.body.textContent).not.toMatch(/machine_dispatch_roles/);
    expect(document.body.textContent).not.toMatch(/not provisioned/);
  });

  it("says a role was not recognised without quoting coord's token, row and detail alike", () => {
    const [first, ...rest] = RAW;
    roles.read = readOf([
      {
        ...first!,
        role: { ...first!.role, dispatch_role: "mystery_lane_v9" },
      },
      ...rest,
    ]);
    render(panel());
    const row = shownRows().find((r) =>
      r.textContent?.includes("Role not recognised")
    );
    expect(row).toBeTruthy();
    fireEvent.click(toggle(row!));
    expect(document.body.innerHTML).not.toContain("mystery_lane_v9");
  });
});
