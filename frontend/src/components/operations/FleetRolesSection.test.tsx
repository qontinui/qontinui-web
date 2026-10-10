/**
 * The Roles panel end to end against a mocked transport (plan
 * `2026-10-02-fleet-machine-roles-workhorse-bench-ci-node` Phase 6): the row
 * wording, the confirm sentence, the host-name assignment, and coord's typed
 * refusals rendered as sentences with Force offered only for
 * `last_open_lane`.
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

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
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
        dispatch_role: "testbed",
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
      // Coord serves `not_registered` lanes for a machine with no device row.
      lanes: {
        agent: lane("not_registered", "not_registered"),
        ci: lane("not_registered", "not_registered"),
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
      // Served under the PRE-RENAME spelling `bench` (a coord predating plan
      // Amendment 2026-10-10 A2): the panel must read it as Testbed.
      role: {
        dispatch_role: "bench",
        reason: "local box",
        version: 1,
        // A non-admin's read: coord redacts operator emails.
        updated_by: "[redacted]",
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
      "Testbed"
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
      "dell-2020 → CI node: still no sessions (no workstation runner); CI stays open."
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
          lanes: [
            {
              lane: "agent",
              capacity: "workstations",
              remaining: [],
              offline_only: false,
            },
          ],
        },
      }),
      json(200, { ok: true }),
    ];
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    fireEvent.click(screen.getByTestId("fleet-roles-set-testbed"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "rebuild" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    const refusal = await screen.findByTestId("fleet-roles-refusal");
    expect(refusal.getAttribute("data-refusal")).toBe("last_open_lane");
    expect(refusal.textContent).toContain(
      "no heartbeat-fresh workstation would take agent sessions"
    );
    // The renamed role goes on the wire under its new name.
    expect(puts[0].body.dispatch_role).toBe("testbed");
    fireEvent.click(screen.getByTestId("fleet-roles-force"));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].body.force).toBe(true);
    expect(puts[1].body.device_id).toBe("3e7e4b04-75de-4efb-b718-c8ce8fcf7b17");
  });

  it("no_agent_host renders a sentence and offers no Force", async () => {
    putAnswers = [json(422, { error: "no_agent_host" })];
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    fireEvent.click(screen.getByTestId("fleet-roles-set-testbed"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    const refusal = await screen.findByTestId("fleet-roles-refusal");
    expect(refusal.getAttribute("data-refusal")).toBe("no_agent_host");
    expect(screen.queryByTestId("fleet-roles-force")).toBeNull();
  });

  it("refuses to assign by host name a CI host already listed, but not a workstation's name", async () => {
    render(<FleetRolesSection />);
    await screen.findByText("Unassigned — behaves as Workhorse");
    fireEvent.change(screen.getByTestId("fleet-roles-host-input"), {
      target: { value: "DELL-2024" },
    });
    expect(
      (screen.getByTestId("fleet-roles-host-open") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(screen.getByTestId("fleet-roles-host-error").textContent).toContain(
      "already listed"
    );
    // A workstation named "monster" is a different machine to coord.
    fireEvent.change(screen.getByTestId("fleet-roles-host-input"), {
      target: { value: "monster" },
    });
    expect(
      (screen.getByTestId("fleet-roles-host-open") as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("warns only on a CI host row whose role closes CI; workstation lanes show role and drain apart", async () => {
    // nomad (a workstation, Testbed): no GitHub-runner warning on its row.
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("nomad"));
    expect(
      screen.queryByTestId("fleet-roles-github-runner-warning")
    ).toBeNull();
    // Role and drain shown separately: Testbed closes the lane AND it is drained.
    expect(screen.getByTestId("fleet-roles-lanes").textContent).toContain(
      "drained until"
    );
  });

  it("a registered Testbed CI host row carries the GitHub-runner warning; an unregistered one does not", async () => {
    const testbedHost = {
      ...MACHINES.machines[1],
      role: { ...MACHINES.machines[1].role!, dispatch_role: "testbed" },
    };
    fetchMock.mockImplementation(async () =>
      json(200, {
        ...MACHINES,
        machines: [
          testbedHost,
          {
            ...testbedHost,
            // Coord names a CI host by the bare runner name (no gh-runner-).
            machine_key: "/msi-wsl",
            ci_host_name: "msi-wsl",
            name: "msi-wsl",
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
    // Inside the lanes table: CI lane's role and "coord says" cells (the
    // sessions lane is n/a on a CI host).
    expect(
      within(screen.getByTestId("fleet-roles-lanes")).getAllByTestId(
        "fleet-roles-lane-not-registered"
      )
    ).toHaveLength(2);
    expect(screen.getByTestId("fleet-roles-lanes").textContent).not.toContain(
      "not drained"
    );
    fireEvent.click(screen.getByText("msi-wsl"));
    expect(
      screen.getByTestId("fleet-roles-github-runner-warning").textContent
    ).toContain("GitHub runner");
  });

  it("a manual retry after an unclear failure does not claim 'nothing changed'", async () => {
    putAnswers = [
      json(504, { detail: "timeout waiting for coord" }),
      json(200, { changed: false }),
    ];
    const { toast } = await import("sonner");
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    fireEvent.click(screen.getByTestId("fleet-roles-set-testbed"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    await screen.findByTestId("fleet-roles-refusal");
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    await waitFor(() => expect(puts).toHaveLength(2));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "monster is Testbed — the earlier attempt may have applied it."
      )
    );
  });

  it("a redacted operator email is shown as served", async () => {
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("nomad"));
    expect(screen.getByText(/by \[redacted\]: local box/)).toBeTruthy();
  });

  it("an unregistered row carries the not-registered badge", async () => {
    render(<FleetRolesSection />);
    await screen.findByText("dell-2024");
    // On the row itself, before it is expanded.
    expect(
      screen.getAllByTestId("fleet-roles-row-not-registered")
    ).toHaveLength(1);
    expect(screen.queryByTestId("fleet-roles-lane-not-registered")).toBeNull();
  });

  it("a truncated roster says the list is incomplete", async () => {
    fetchMock.mockImplementation(async () =>
      json(200, { ...MACHINES, roster_truncated: true })
    );
    render(<FleetRolesSection />);
    expect(
      (await screen.findByTestId("fleet-roles-truncated")).textContent
    ).toContain("incomplete");
  });

  it("a truncated roster marks the not-registered badge as uncertain", async () => {
    fetchMock.mockImplementation(async () =>
      json(200, { ...MACHINES, roster_truncated: true })
    );
    render(<FleetRolesSection />);
    await screen.findByTestId("fleet-roles-truncated");
    expect(
      screen.getByTestId("fleet-roles-row-not-registered").textContent
    ).toBe("not registered?");
    // The expanded lane table carries the same hedge.
    fireEvent.click(screen.getByText("dell-2024"));
    const cells = within(
      screen.getByTestId("fleet-roles-lanes")
    ).getAllByTestId("fleet-roles-lane-not-registered");
    expect(cells.map((c) => c.textContent)).toEqual([
      "not registered?",
      "not registered?",
    ]);
  });

  it("no truncation notice when coord says the roster is whole", async () => {
    fetchMock.mockImplementation(async () =>
      json(200, { ...MACHINES, roster_truncated: false })
    );
    render(<FleetRolesSection />);
    await screen.findByText("monster");
    expect(screen.queryByTestId("fleet-roles-truncated")).toBeNull();
    expect(
      screen.queryByTestId("fleet-roles-truncation-unreported")
    ).toBeNull();
    expect(
      screen.getByTestId("fleet-roles-row-not-registered").textContent
    ).toBe("not registered");
  });

  it("a host write's null live sessions read unknown, and what coord did not apply is named", async () => {
    putAnswers = [
      json(200, {
        changed: true,
        dispatch_role: "ci_node",
        live_sessions_on_machine: null,
        effects_not_applied: [
          { effect: "github_routing_labels", plan_phase: 4, detail: "x" },
          { effect: "ci_node_config_enabled", plan_phase: 5, detail: "y" },
        ],
      }),
    ];
    const { toast } = await import("sonner");
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    render(<FleetRolesSection />);
    await screen.findByText("monster");
    fireEvent.change(screen.getByTestId("fleet-roles-host-input"), {
      target: { value: "dell-2020" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-host-open"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "remote CI box" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [msg] = vi.mocked(toast.success).mock.calls[0] as [string];
    expect(msg).toContain("live sessions on it: unknown");
    expect(msg).not.toMatch(/\b0 live session/);
    const [warn, opts] = vi.mocked(toast.warning).mock.calls[0] as [
      string,
      { duration?: number } | undefined,
    ];
    expect(warn).toContain("GitHub routing labels");
    // Coord's own words are kept, and the warning does not time out.
    expect(warn).toContain("(coord: x)");
    expect(opts).toMatchObject({ duration: Infinity });
  });

  it("a host write never shows a count, even if coord sends 0", async () => {
    putAnswers = [
      json(200, {
        changed: true,
        dispatch_role: "ci_node",
        live_sessions_on_machine: 0,
        effects_not_applied: [],
      }),
    ];
    const { toast } = await import("sonner");
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    render(<FleetRolesSection />);
    await screen.findByText("monster");
    fireEvent.change(screen.getByTestId("fleet-roles-host-input"), {
      target: { value: "dell-2020" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-host-open"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "remote CI box" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [msg] = vi.mocked(toast.success).mock.calls[0] as [string];
    expect(msg).toContain("live sessions on it: unknown");
    expect(msg).not.toContain("0 live sessions");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a device write names linked_ci_host_fanout and a counted session", async () => {
    putAnswers = [
      json(200, {
        changed: true,
        dispatch_role: "testbed",
        live_sessions_on_machine: 2,
        effects_not_applied: [
          { effect: "linked_ci_host_fanout", plan_phase: 3, detail: "z" },
        ],
      }),
    ];
    const { toast } = await import("sonner");
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    fireEvent.click(screen.getByTestId("fleet-roles-set-testbed"));
    fireEvent.change(screen.getByTestId("fleet-roles-reason"), {
      target: { value: "rebuild" },
    });
    fireEvent.click(screen.getByTestId("fleet-roles-submit"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [msg] = vi.mocked(toast.success).mock.calls[0] as [string];
    expect(msg).toContain("2 live sessions on it now");
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain(
      "linked CI hosts"
    );
  });

  it("a role coord still serves as legacy `bench` reads as Testbed, marked legacy, and is current", async () => {
    // nomad's fixture row is stored under the pre-rename spelling (plan
    // Amendment 2026-10-10 A2/A6): it is Testbed, never "unrecognised".
    render(<FleetRolesSection />);
    expect(await screen.findByText('Testbed (legacy "bench")')).toBeTruthy();
    expect(screen.queryByText(/Unrecognised role/)).toBeNull();
    fireEvent.click(screen.getByText("nomad"));
    const current = screen.getByTestId(
      "fleet-roles-set-testbed"
    ) as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(current.title).toBe(
      "UI testing — takes no coord work (no CI, no sessions)."
    );
  });

  it("hides the write controls from a non-admin", async () => {
    authState.isCoordAdmin = false;
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText("monster"));
    expect(screen.queryByTestId("fleet-roles-set-testbed")).toBeNull();
    expect(screen.queryByTestId("fleet-roles-by-host")).toBeNull();
  });
});
