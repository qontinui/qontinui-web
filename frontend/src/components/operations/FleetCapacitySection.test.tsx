/**
 * `FleetCapacitySection` — the Dev Ops Capacity panel (plan
 * `2026-11-05-one-free-resource-model-places-sessions-builds-and-ci`
 * Phase 11).
 *
 * The load-bearing property: an UNKNOWN renders as the word UNKNOWN with
 * coord's reason, never as `0` — a machine coord could not measure is not a
 * machine with no room. Also pinned: units and age on free capacity, the
 * binding resource, slots per class with basis, the misplaced-wait share as
 * UNKNOWN, and the D9 dial's read, its editor, and its write body.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapacityModelView } from "@/lib/api/operations/coordFleet";
import { renderInPresentationMode } from "@/test/presentation";
import { FleetCapacitySection } from "./FleetCapacitySection";
import { parseFleetCapacity } from "./fleetCapacity";
import { capacityBody, capacityDevice } from "./fleetCapacity.fixture";
import type { UseFleetCapacityResult } from "./useFleetCapacity";

const putCapacityModel = vi.fn();
vi.mock("@/lib/api/operations/coordFleet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/operations/coordFleet")>()),
  putCapacityModel: (...args: unknown[]) => putCapacityModel(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const CONSUMERS = [
  "agent_placement",
  "spawn_admission",
  "worktree_budget",
  "post_merge_followups",
  "local_builds",
  "ci_placement",
  "ci_converge",
  "merge_train",
];

function dialView(over: Partial<CapacityModelView> = {}): CapacityModelView {
  return {
    dial: {
      mode: "enforce",
      mode_source: "default",
      off_consumers: [],
      ignored_off_consumers: [],
      permitted_consumers: CONSUMERS,
      consumers: CONSUMERS,
    },
    unknown_reason: null,
    can_edit: true,
    ...over,
  };
}

function read(
  body: unknown,
  over: Partial<UseFleetCapacityResult> = {}
): UseFleetCapacityResult {
  return {
    capacity: parseFleetCapacity(body),
    capacityError: null,
    fetchedAtMs: Date.parse("2026-11-22T10:02:00Z"),
    loading: false,
    dial: dialView(),
    dialError: null,
    refresh: vi.fn(),
    refreshDial: vi.fn(),
    ...over,
  };
}

const UNMEASURED = capacityDevice({
  device_id: "d0d0d0d0-0000-4000-8000-000000000002",
  machine_key: "nawa",
  label: "nawa",
  sample_age_s: null,
  free_cpu_cores: {
    state: "unknown",
    reason: "no runner sample in the lookback",
  },
  free_mem_bytes: {
    state: "unknown",
    reason: "no runner sample in the lookback",
  },
  binding: { S: null, C3: null, C1: null, C2: null, B: null },
  slots: Object.fromEntries(
    ["S", "C3", "C1", "C2", "B"].map((c) => [
      c,
      { state: "unknown", reason: "no runner sample in the lookback" },
    ])
  ),
  unknown_reason: ["no runner sample in the lookback"],
});

function rowFor(label: string): HTMLElement {
  const row = screen
    .getAllByTestId("fleet-capacity-row")
    .find((r) => r.textContent?.includes(label));
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

beforeEach(() => {
  putCapacityModel.mockReset();
  window.localStorage.clear();
});

describe("FleetCapacitySection — a measured machine", () => {
  it("shows free CPU and RAM with units and age, the binding resource, and slots per class with basis", () => {
    render(
      <FleetCapacitySection capacity={read(capacityBody([capacityDevice()]))} />
    );
    const row = rowFor("nilan");
    expect(row).toHaveAttribute("data-capacity-state", "known");
    expect(
      within(row).getByTestId("fleet-capacity-free-cpu")
    ).toHaveTextContent("6.5 cores");
    expect(
      within(row).getByTestId("fleet-capacity-free-ram")
    ).toHaveTextContent("12.0 GiB");
    expect(within(row).getByTestId("fleet-capacity-age")).toHaveTextContent(
      "42s ago"
    );
    expect(within(row).getByTestId("fleet-capacity-binding")).toHaveTextContent(
      "cpu"
    );
    const slots = within(row).getByTestId("fleet-capacity-slots");
    const s = slots.querySelector('[data-work-class="S"]');
    expect(s).toHaveTextContent("S 3");
    expect(s).toHaveTextContent("bound by cpu");
    expect(s).toHaveTextContent("this machine's p90");
    expect(slots.querySelector('[data-work-class="C1"]')).toHaveTextContent(
      "seed"
    );
    expect(within(row).queryByTestId("fleet-capacity-unknown")).toBeNull();
  });

  it("summarises and lists the legacy-versus-model parity readout", () => {
    render(
      <FleetCapacitySection capacity={read(capacityBody([capacityDevice()]))} />
    );
    const detail = within(rowFor("nilan")).getByTestId("fleet-capacity-detail");
    expect(detail).toHaveTextContent(
      "Parity (3 legacy deciders: 1 known, 1 runner local, 1 unknown)"
    );
  });
});

describe("FleetCapacitySection — UNKNOWN renders as UNKNOWN, never 0", () => {
  it("renders every unmeasured value as UNKNOWN with coord's reason", () => {
    render(
      <FleetCapacitySection
        capacity={read(capacityBody([capacityDevice(), UNMEASURED]))}
      />
    );
    const row = rowFor("nawa");
    expect(row).toHaveAttribute("data-capacity-state", "unknown");
    for (const id of [
      "fleet-capacity-free-cpu",
      "fleet-capacity-free-ram",
      "fleet-capacity-age",
      "fleet-capacity-binding",
    ]) {
      const cell = within(row).getByTestId(id);
      expect(cell).toHaveTextContent("UNKNOWN");
      expect(cell).not.toHaveTextContent(/\b0\b/);
    }
    const slots = within(row).getByTestId("fleet-capacity-slots");
    for (const cls of ["S", "C3", "C1", "C2", "B"]) {
      const li = slots.querySelector(`[data-work-class="${cls}"]`)!;
      expect(li).toHaveTextContent(`${cls} UNKNOWN`);
      expect(
        li.querySelector('[data-testid="fleet-capacity-unknown"]')
      ).toHaveAttribute(
        "data-unknown-reason",
        "no runner sample in the lookback"
      );
    }
    expect(
      within(row).getByTestId("fleet-capacity-unknown-reasons")
    ).toHaveTextContent("no runner sample in the lookback");
    expect(
      screen.getByTestId("fleet-capacity-unknown-badge")
    ).toHaveTextContent("1 with UNKNOWN values");
  });

  it("renders the misplaced-wait share as UNKNOWN, since coord serves none", () => {
    render(
      <FleetCapacitySection capacity={read(capacityBody([capacityDevice()]))} />
    );
    const line = screen.getByTestId("fleet-capacity-misplaced-share");
    expect(line).toHaveTextContent("UNKNOWN");
    expect(line).toHaveTextContent("capacity_misplaced_share_7d");
    expect(line).not.toHaveTextContent("%");
  });

  it("says an unreadable body is UNKNOWN rather than an empty fleet", () => {
    render(<FleetCapacitySection capacity={read({})} />);
    expect(screen.getByTestId("fleet-capacity-unreadable")).toHaveTextContent(
      "UNKNOWN"
    );
    expect(screen.queryByText(/lists no machines/)).toBeNull();
  });

  it("says coord has no plan yet in coord's own words", () => {
    render(
      <FleetCapacitySection
        capacity={read({
          state: "no_plan_yet",
          note: "the worker has not run",
          devices: null,
        })}
      />
    );
    expect(screen.getByTestId("fleet-capacity-no-plan")).toHaveTextContent(
      "the worker has not run"
    );
  });

  it("renders an unread dial as UNKNOWN and offers no editor", () => {
    render(
      <FleetCapacitySection
        capacity={read(capacityBody([capacityDevice()]), {
          dial: dialView({
            dial: null,
            unknown_reason:
              "coord's controls read did not project the capacity-model columns",
          }),
        })}
      />
    );
    const dial = screen.getByTestId("fleet-capacity-dial");
    expect(dial).toHaveTextContent("UNKNOWN");
    expect(dial).toHaveTextContent(
      "did not project the capacity-model columns"
    );
    expect(dial).not.toHaveTextContent("enforce");
    expect(screen.queryByTestId("fleet-capacity-dial-editor")).toBeNull();
  });
});

describe("FleetCapacitySection — the D9 dial", () => {
  it("shows the resolved dial and where its mode came from", () => {
    render(
      <FleetCapacitySection capacity={read(capacityBody([capacityDevice()]))} />
    );
    expect(screen.getByTestId("fleet-capacity-dial-mode")).toHaveTextContent(
      "enforce"
    );
    expect(screen.getByTestId("fleet-capacity-dial")).toHaveTextContent(
      "default: nothing stored"
    );
  });

  it("writes the mode and the off list, then re-reads the dial", async () => {
    putCapacityModel.mockResolvedValue({
      ok: true,
      version: 4,
      versioned: true,
      effective: dialView(),
      readback_error: null,
    });
    const r = read(capacityBody([capacityDevice()]));
    render(<FleetCapacitySection capacity={r} />);
    const save = screen.getByTestId("fleet-capacity-dial-save");
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByTestId("fleet-capacity-dial-off-merge_train"));
    fireEvent.click(
      screen.getByTestId("fleet-capacity-dial-off-agent_placement")
    );
    fireEvent.click(save);
    await waitFor(() => expect(putCapacityModel).toHaveBeenCalledTimes(1));
    expect(putCapacityModel).toHaveBeenCalledWith({
      mode: "enforce",
      // In the vocabulary's order, whatever order they were ticked in.
      off_consumers: ["agent_placement", "merge_train"],
      change_note: null,
    });
    await waitFor(() => expect(r.refreshDial).toHaveBeenCalled());
  });

  it("shows coord's refusal and does not claim the write landed", async () => {
    putCapacityModel.mockRejectedValue(
      new Error(
        "PUT /api/v1/operations/fleet/capacity-model failed: 403 - admin_required"
      )
    );
    const r = read(capacityBody([capacityDevice()]));
    render(<FleetCapacitySection capacity={r} />);
    fireEvent.click(screen.getByTestId("fleet-capacity-dial-off-merge_train"));
    fireEvent.click(screen.getByTestId("fleet-capacity-dial-save"));
    expect(
      await screen.findByTestId("fleet-capacity-dial-refusal")
    ).toBeInTheDocument();
    expect(r.refreshDial).not.toHaveBeenCalled();
  });

  it("offers no editor to an operator who is not a tenant admin", () => {
    render(
      <FleetCapacitySection
        capacity={read(capacityBody([capacityDevice()]), {
          dial: dialView({ can_edit: false }),
        })}
      />
    );
    expect(screen.queryByTestId("fleet-capacity-dial-editor")).toBeNull();
    expect(
      screen.getByText("Only a tenant admin can change the dial.")
    ).toBeInTheDocument();
  });
});

describe("FleetCapacitySection — presentation mode", () => {
  it("unmounts the dial editor and withholds coord's free-text reasons", () => {
    renderInPresentationMode(
      <FleetCapacitySection
        capacity={read(capacityBody([capacityDevice(), UNMEASURED]))}
      />
    );
    expect(screen.queryByTestId("fleet-capacity-dial-editor")).toBeNull();
    expect(screen.queryByText("no runner sample in the lookback")).toBeNull();
    expect(screen.queryByText("nawa")).toBeNull();
  });
});

describe("FleetCapacitySection — review round 2", () => {
  it("keeps an operator's unsaved edits across a poll that re-reads the same dial", () => {
    const r = read(capacityBody([capacityDevice()]));
    const { rerender } = render(<FleetCapacitySection capacity={r} />);
    const box = screen.getByTestId("fleet-capacity-dial-off-merge_train");
    fireEvent.click(box);
    expect(box).toHaveAttribute("data-state", "checked");
    // A poll parses a NEW object with the SAME content.
    rerender(<FleetCapacitySection capacity={{ ...r, dial: dialView() }} />);
    expect(
      screen.getByTestId("fleet-capacity-dial-off-merge_train")
    ).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("fleet-capacity-dial-save")).toBeEnabled();
  });

  it("resets the form when the dial itself changed", () => {
    const r = read(capacityBody([capacityDevice()]));
    const { rerender } = render(<FleetCapacitySection capacity={r} />);
    fireEvent.click(screen.getByTestId("fleet-capacity-dial-off-merge_train"));
    const changed = dialView();
    changed.dial = { ...changed.dial!, off_consumers: ["local_builds"] };
    rerender(<FleetCapacitySection capacity={{ ...r, dial: changed }} />);
    expect(
      screen.getByTestId("fleet-capacity-dial-off-merge_train")
    ).toHaveAttribute("data-state", "unchecked");
    expect(
      screen.getByTestId("fleet-capacity-dial-off-local_builds")
    ).toHaveAttribute("data-state", "checked");
  });

  it("says a save clears stored names this coord does not know", () => {
    const v = dialView();
    v.dial = { ...v.dial!, ignored_off_consumers: ["future_consumer"] };
    render(
      <FleetCapacitySection
        capacity={read(capacityBody([capacityDevice()]), { dial: v })}
      />
    );
    expect(
      screen.getByTestId("fleet-capacity-dial-ignored-note")
    ).toHaveTextContent("future_consumer");
  });

  it("renders a missing plan age as UNKNOWN", () => {
    const body = capacityBody([capacityDevice()]);
    body.plan = { id: 7, computed_at: null, age_secs: null };
    render(<FleetCapacitySection capacity={read(body)} />);
    expect(screen.getByTestId("fleet-capacity-plan-age")).toHaveTextContent(
      "UNKNOWN"
    );
  });

  it("withholds coord's no-plan note and the query name in presentation mode", () => {
    renderInPresentationMode(
      <FleetCapacitySection
        capacity={read({
          state: "no_plan_yet",
          note: "worker on host-alpha",
          devices: null,
        })}
      />
    );
    expect(screen.getByTestId("fleet-capacity-no-plan")).not.toHaveTextContent(
      "host-alpha"
    );
    expect(
      screen.getByTestId("fleet-capacity-misplaced-share")
    ).not.toHaveTextContent("capacity_misplaced_share_7d");
  });
});
