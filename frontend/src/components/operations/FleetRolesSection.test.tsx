/**
 * The Roles panel end to end against a mocked transport (plan
 * `2026-10-02-fleet-machine-roles-workhorse-bench-ci-node` Phase 6): the row
 * wording, the confirm sentence, the host-name assignment, and coord's typed
 * refusals rendered as sentences with Force offered only for
 * `last_open_lane`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const authState = { isCoordAdmin: true };
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

import { FleetRolesSection } from "./FleetRolesSection";

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// Coord's `DispatchRolesResponse` / `MachineView` shape
// (qontinui-coord dispatch_role_routes.rs, plan Phase 3).
const lane = (effective: string, role: string, drain = "none") => ({
  effective,
  role,
  drain: { state: drain, total_devices: 1 },
});
const MACHINES = {
  state: "known",
  roles_table: "present",
  machines: [
    {
      kind: "workstation",
      machine_key: "device:3e7e4b04-75de-4efb-b718-c8ce8fcf7b17",
      device_id: "3e7e4b04-75de-4efb-b718-c8ce8fcf7b17",
      ci_host_name: null,
      name: "monster",
      registration: "registered",
      assignment: "unassigned",
      role: null,
      behaves_as: "workhorse",
      suggestion: {
        dispatch_role: "bench",
        mem_total_bytes: 33_000_000_000,
        sample_age_secs: 30,
      },
      lanes: { agent: lane("open", "open"), ci: lane("open", "open") },
      pre_change_sessions: { state: "not_applicable" },
    },
    {
      kind: "ci_host",
      machine_key: "host:dell-2024",
      device_id: null,
      ci_host_name: "dell-2024",
      name: "dell-2024",
      registration: "assigned_not_registered",
      assignment: "assigned",
      role: {
        dispatch_role: "ci_node",
        reason: "remote CI box",
        version: 1,
        updated_by: "op@example.com",
        updated_at: "2026-10-08T10:00:00Z",
      },
      behaves_as: "ci_node",
      suggestion: null,
      // Coord serves both lane keys even with no device rows.
      lanes: {
        agent: lane("unknown", "open"),
        ci: lane("unknown", "open"),
      },
      pre_change_sessions: { state: "not_applicable" },
    },
    {
      kind: "workstation",
      machine_key: "device:95a536af-6fa3-496b-97c7-1bce45b3217a",
      device_id: "95a536af-6fa3-496b-97c7-1bce45b3217a",
      ci_host_name: null,
      name: "nomad",
      registration: "registered",
      assignment: "assigned",
      role: {
        dispatch_role: "bench",
        reason: "local box",
        version: 1,
        updated_by: "op@example.com",
        updated_at: "2026-10-08T10:00:00Z",
      },
      behaves_as: "bench",
      suggestion: null,
      lanes: {
        agent: {
          effective: "closed_by_role",
          role: "closed",
          drain: {
            state: "drained",
            until: "2026-10-09T00:00:00Z",
            reason: "rebuild",
            total_devices: 1,
          },
        },
        ci: lane("closed_by_role", "closed"),
      },
      pre_change_sessions: { state: "known", count: 0 },
    },
  ],
};

type Put = { url: string; body: Record<string, unknown> };
let puts: Put[];
let putAnswers: Array<ReturnType<typeof json>>;

beforeEach(() => {
  authState.isCoordAdmin = true;
  puts = [];
  putAnswers = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push({ url, body: JSON.parse(String(init.body)) });
      return putAnswers.shift() ?? json(200, { ok: true });
    }
    return json(200, MACHINES);
  });
});

describe("FleetRolesSection", () => {
  it("renders unassigned with its behaviour, the suggestion chip, and an unregistered host row", async () => {
    render(<FleetRolesSection />);
    expect(
      await screen.findByText("Unassigned — behaves as Workhorse")
    ).toBeTruthy();
    expect(screen.getByTestId("fleet-roles-suggestion").textContent).toContain(
      "Bench"
    );
    expect(
      screen.getByText("CI node — assigned, not yet registered")
    ).toBeTruthy();
  });

  it("renders UNKNOWN on a 404, never an unassigned fleet", async () => {
    fetchMock.mockImplementation(async () => json(404, {}));
    render(<FleetRolesSection />);
    expect(await screen.findByTestId("fleet-roles-unknown")).toBeTruthy();
    expect(screen.queryByText(/Unassigned/)).toBeNull();
  });

  it("assigns a role by host name with a confirm sentence and required reason", async () => {
    render(<FleetRolesSection />);
    await screen.findByText("Unassigned — behaves as Workhorse");
    fireEvent.change(screen.getByTestId("fleet-roles-host-input"), {
      target: { value: "dell-2020" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-host-open"));
    expect(screen.getByTestId("fleet-roles-effect").textContent).toBe(
      "dell-2020 → CI node: still no sessions; CI stays open."
    );
    expect(
      screen.getByTestId("fleet-roles-not-yet-applied").textContent
    ).toContain("GitHub runner routing labels");
    const submit = screen.getByTestId(
      "fleet-roles-submit"
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "remote CI box" },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({
      dispatch_role: "ci_node",
      reason: "remote CI box",
      force: false,
      ci_host_name: "dell-2020",
    });
  });

  it("a workstation row's confirm names the operator's effect sentence", async () => {
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    fireEvent.click(screen.getByTestId("fleet-roles-set-ci_node"));
    expect(screen.getByTestId("fleet-roles-effect").textContent).toBe(
      "monster → CI node: coord will send no sessions here; CI stays open."
    );
  });

  it("last_open_lane renders a sentence and offers Force, which resends with force", async () => {
    putAnswers = [
      json(409, {
        detail: {
          error: "last_open_lane",
          detail: "pass `force: true` to apply it anyway",
          lanes: [{ lane: "agent", remaining: [], offline_only: false }],
        },
      }),
      json(200, { ok: true }),
    ];
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    fireEvent.click(screen.getByTestId("fleet-roles-set-bench"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "rebuild" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    const refusal = await screen.findByTestId("fleet-roles-refusal");
    expect(refusal.getAttribute("data-refusal")).toBe("last_open_lane");
    expect(refusal.textContent).toContain("agent sessions");
    fireEvent.click(screen.getByTestId("fleet-roles-force"));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body.force).toBe(true);
    expect(puts[1].body.device_id).toBe("3e7e4b04-75de-4efb-b718-c8ce8fcf7b17");
  });

  it("no_agent_host renders a sentence and offers no Force", async () => {
    putAnswers = [json(422, { error: "no_agent_host" })];
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    fireEvent.click(screen.getByTestId("fleet-roles-set-bench"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    const refusal = await screen.findByTestId("fleet-roles-refusal");
    expect(refusal.getAttribute("data-refusal")).toBe("no_agent_host");
    expect(screen.queryByTestId("fleet-roles-force")).toBeNull();
  });

  it("refuses to assign by host name a machine already listed", async () => {
    render(<FleetRolesSection />);
    await screen.findByText("Unassigned — behaves as Workhorse");
    fireEvent.change(screen.getByTestId("fleet-roles-host-input"), {
      target: { value: "MONSTER" },
    });
    expect(
      (screen.getByTestId("fleet-roles-host-open") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getByTestId("fleet-roles-host-error").textContent).toContain(
      "already listed"
    );
  });

  it("warns only on a CI host row whose role closes CI; workstation lanes show role and drain apart", async () => {
    // nomad (a workstation, Bench): no GitHub-runner warning on its row.
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("nomad"));
    expect(
      screen.queryByTestId("fleet-roles-github-runner-warning")
    ).toBeNull();
    // Role and drain shown separately: Bench closes the lane AND it is drained.
    expect(screen.getByTestId("fleet-roles-lanes").textContent).toContain(
      "drained until"
    );
  });

  it("a registered Bench CI host row carries the GitHub-runner warning; an unregistered one does not", async () => {
    const benchHost = {
      ...MACHINES.machines[1],
      role: { ...MACHINES.machines[1].role!, dispatch_role: "bench" },
    };
    fetchMock.mockImplementation(async () =>
      json(200, {
        ...MACHINES,
        machines: [
          benchHost,
          {
            ...benchHost,
            machine_key: "host:gh-runner-msi-wsl",
            ci_host_name: "gh-runner-msi-wsl",
            name: "gh-runner-msi-wsl",
            registration: "registered",
          },
        ],
      })
    );
    render(<FleetRolesSection />);
    // Unregistered (dell-2024): no runners exist, so no warning, and no lane
    // state rendered from an empty device list.
    fireEvent.click(await screen.findByText("dell-2024"));
    expect(
      screen.queryByTestId("fleet-roles-github-runner-warning")
    ).toBeNull();
    expect(screen.getByTestId("fleet-roles-lanes").textContent).toContain(
      "not served"
    );
    fireEvent.click(screen.getByText("gh-runner-msi-wsl"));
    expect(
      screen.getByTestId("fleet-roles-github-runner-warning").textContent
    ).toContain("GitHub runner");
  });

  it("hides the write controls from a non-admin", async () => {
    authState.isCoordAdmin = false;
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    expect(screen.queryByTestId("fleet-roles-set-bench")).toBeNull();
    expect(screen.queryByTestId("fleet-roles-by-host")).toBeNull();
  });
});
