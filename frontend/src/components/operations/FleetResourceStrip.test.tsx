/**
 * FleetResourceStrip — the §C3 honesty rules as RENDERED output.
 *
 * `fleetResources.test.ts` pins the predicates; this pins that the table
 * actually shows what they decide. The three that matter most are the states
 * this surface will spend most of its life in before the publishers land:
 * `schema_pending`, no-sample, and stale.
 *
 * The poll is injected (the strip takes its `resources` as a prop, as
 * `DeviceStatusTile` takes its stream), so no network is involved.
 */

import { describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { FleetResourceStrip } from "./FleetResourceStrip";
import type {
  ResourceSampleRow,
  ResourceSamplesResponse,
} from "./fleetResources";
import type { UseFleetResourceSamplesResult } from "./useFleetResourceSamples";

const GIB = 1024 ** 3;
const DEV = "11111111-1111-1111-1111-111111111111";

function sample(overrides: Partial<ResourceSampleRow> = {}): ResourceSampleRow {
  return {
    device_id: DEV,
    lane: "host",
    lane_instance: null,
    sampled_at: "2026-08-06T12:00:00Z",
    age_secs: 15,
    cpu_cores: 16,
    load_1m: null,
    mem_total_bytes: 32 * GIB,
    mem_available_bytes: 4 * GIB,
    commit_total_bytes: 64 * GIB,
    commit_available_bytes: 13 * GIB,
    swap_total_bytes: null,
    swap_used_bytes: null,
    disk_total_bytes: 1000 * GIB,
    disk_free_bytes: 100 * GIB,
    disk_mount: "D:",
    build_slots_total: 4,
    build_slots_busy: 1,
    build_queue_depth: 0,
    ci_jobs_running: null,
    source: "supervisor",
    pressure: { ratio: 0.8, basis: "commit" },
    floor: {
      basis: "commit_available",
      bytes: 5 * GIB,
      source: "default",
      verdict: "defer",
      // Two enforcers on one column: the supervisor defers at 5 GiB, the
      // runner's ci_node rejects at 4 GiB — lower on purpose.
      reject_bytes: 4 * GIB,
      reject_source: "policy",
    },
    disk_floor: {
      basis: "disk_free",
      bytes: 30 * GIB,
      source: "policy",
      verdict: "reject",
      reject_bytes: 30 * GIB,
      reject_source: "policy",
    },
    headroom: "ok",
    // Windows host lane: byte floors, no pressure ceiling.
    pressure_floor: null,
    ...overrides,
  };
}

/**
 * A row as an un-upgraded coord sends it: no `floor`, no `disk_floor`, no
 * `headroom`. The state the whole fleet is in until the sibling coord PR
 * deploys, so it is a fixture rather than an afterthought.
 */
function preFloorSample(
  overrides: Partial<ResourceSampleRow> = {}
): ResourceSampleRow {
  const row = sample(overrides);
  delete row.floor;
  delete row.disk_floor;
  delete row.pressure_floor;
  delete row.headroom;
  return row;
}

function renderStrip(
  data: ResourceSamplesResponse | null,
  {
    devices = [{ device_id: DEV, hostname: "msi" }],
    error = null,
  }: {
    devices?: { device_id: string; hostname?: string }[];
    error?: string | null;
  } = {}
) {
  const resources: UseFleetResourceSamplesResult = {
    data,
    loading: false,
    error,
    fetchedAtMs: Date.now(),
    refresh: vi.fn(),
  };
  return render(<FleetResourceStrip devices={devices} resources={resources} />);
}

describe("§C3 — no recent sample renders unknown, never healthy", () => {
  it("renders the machine with an explicit unknown lead column", () => {
    renderStrip({ latest: [], history: [] });
    const rows = screen.getAllByTestId("fleet-resource-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-freshness")).toBe("unknown");
    expect(
      within(rows[0]).getByTestId("fleet-resource-pressure-unknown")
    ).toBeTruthy();
    // The word "healthy" must not appear anywhere on an unmeasured machine.
    expect(rows[0].textContent).not.toMatch(/healthy/i);
  });

  it("says so when coord reports schema_pending, rather than showing an idle fleet", () => {
    renderStrip({ latest: [], history: [], schema_pending: true });
    const banner = screen.getByTestId("fleet-resource-schema-pending");
    expect(banner.textContent).toMatch(/unknown/);
    expect(banner.textContent).toMatch(/not the same as/i);
  });

  it("warns that rows are last-known when the proxy itself failed", () => {
    renderStrip({ latest: [sample()], history: [] }, { error: "502" });
    expect(screen.getByTestId("fleet-resource-error").textContent).toMatch(
      /last-known, not\s+current/i
    );
  });

  it("renders unknown — not 0 and not green — when the server has no pressure opinion", () => {
    renderStrip({ latest: [sample({ pressure: null })], history: [] });
    expect(
      screen.getByTestId("fleet-resource-pressure-no-opinion")
    ).toBeTruthy();
    expect(screen.queryByTestId("fleet-resource-pressure")).toBeNull();
  });
});

describe("§C3 — a stale sample renders as stale", () => {
  it("badges the row stale and strikes the value rather than showing it as current", () => {
    renderStrip({ latest: [sample({ age_secs: 600 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("stale");
    expect(
      within(row).getByTestId("fleet-resource-stale-badge").textContent
    ).toMatch(/stale/);
    // The lead column keeps the unknown dot tone, not a green one.
    const value = within(row).getByTestId("fleet-resource-pressure");
    expect(value.querySelector(".line-through")).toBeTruthy();
  });
});

describe("§C1 — the lead column says which metric it is", () => {
  it("labels a host row commit and a wsl row swap, on the same table", () => {
    renderStrip({
      latest: [
        sample(),
        sample({
          lane: "wsl",
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 2 * GIB,
          commit_total_bytes: null,
          commit_available_bytes: null,
          pressure: { ratio: 0.25, basis: "swap" },
        }),
      ],
      history: [],
    });
    expect(screen.getByText("commit used")).toBeTruthy();
    expect(screen.getByText("swap used")).toBeTruthy();
  });

  it("never prints a swap figure on a host row", () => {
    // A publisher bug: swap columns present on a Windows host row. The strip
    // must still not render them — on Windows they are the commit counters
    // printed a second time.
    renderStrip({
      latest: [
        sample({ swap_total_bytes: 40 * GIB, swap_used_bytes: 31 * GIB }),
      ],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-lane")).toBe("host");
    expect(row.textContent).not.toMatch(/swap/i);
  });
});

describe("§C3 — the WSL lane's headroom is shown coupled to the host", () => {
  it("shows the spendable figure, host-bound, in the literal 2026-08-02 state", () => {
    renderStrip({
      latest: [
        // Host at 900 MB free commit.
        sample({ commit_available_bytes: 900 * 1024 * 1024 }),
        // WSL claiming 9 GB free.
        sample({
          lane: "wsl",
          mem_total_bytes: 16 * GIB,
          mem_available_bytes: 9 * GIB,
          commit_total_bytes: null,
          commit_available_bytes: null,
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 6 * GIB,
          pressure: { ratio: 0.75, basis: "swap" },
        }),
      ],
      history: [],
    });
    const coupled = screen.getByTestId("fleet-resource-coupled-headroom");
    expect(coupled.textContent).toMatch(/900 MB/);
    expect(coupled.textContent).toMatch(/host-bound/);
  });

  it("says the coupled figure is unknown when no host lane reported", () => {
    renderStrip({
      latest: [
        sample({
          lane: "wsl",
          mem_available_bytes: 9 * GIB,
          commit_total_bytes: null,
          commit_available_bytes: null,
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 1 * GIB,
          pressure: { ratio: 0.125, basis: "swap" },
        }),
      ],
      history: [],
    });
    expect(
      screen.getByTestId("fleet-resource-coupled-headroom").textContent
    ).toMatch(/coupled: unknown/);
  });
});

describe("§C3 — the effective floor, as coord reports it", () => {
  it("shows the floor's value, its provenance, and whether the lane defers or rejects", () => {
    renderStrip({ latest: [sample()], history: [] });
    const admission = screen.getByTestId("fleet-resource-admission");
    // The value AND the column it is measured on — the column is why it
    // cannot be restated as a pressure threshold.
    expect(admission.textContent).toMatch(/5\.0 GB free commit/);
    expect(admission.textContent).toMatch(/30\.0 GB free disk/);
    // reject vs defer are materially different and both are shown.
    expect(admission.textContent).toMatch(/defers/);
    expect(admission.textContent).toMatch(/rejects/);
    // …and whether an operator set the number or coord defaulted it.
    expect(admission.textContent).toMatch(/policy/);
    expect(admission.textContent).toMatch(/default/);
  });

  it("shows BOTH enforcers on a doubly-guarded column, with their verbs", () => {
    // §C3 is only really satisfied once both thresholds are on screen: the
    // deferring one (work waits) and the rejecting one below it (work fails).
    renderStrip({ latest: [sample()], history: [] });
    const admission = screen.getByTestId("fleet-resource-admission");
    expect(admission.textContent).toMatch(/defers/);
    expect(admission.textContent).toMatch(/5\.0 GB free commit/);
    expect(admission.textContent).toMatch(/rejects/);
    expect(admission.textContent).toMatch(/4\.0 GB free commit/);
  });

  it("prints a self-rejecting floor once, not twice", () => {
    renderStrip({ latest: [sample()], history: [] });
    const admission = screen.getByTestId("fleet-resource-admission");
    // The disk floor rejects at its own value; "30.0 GB free disk" appears
    // exactly once, under one verdict badge.
    const hits = admission.textContent?.match(/30\.0 GB free disk/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("says 'no reject threshold' rather than falling back to the defer number", () => {
    renderStrip({
      latest: [
        sample({
          floor: {
            basis: "mem_available",
            bytes: 4 * GIB,
            source: "default",
            verdict: "defer",
            reject_bytes: null,
            reject_source: null,
          },
        }),
      ],
      history: [],
    });
    const none = screen.getAllByTestId("fleet-resource-reject-floor-none");
    expect(none.length).toBeGreaterThan(0);
    expect(none[0].textContent).toMatch(/no reject threshold/);
    // Not zero, and not the deferring number wearing the reject label.
    expect(none[0].textContent).not.toMatch(/0 B|4\.0 GB/);
  });

  it("distinguishes 'coord never mentioned a rejecting enforcer' from 'there is none'", () => {
    const legacyFloor = {
      basis: "commit_available" as const,
      bytes: 5 * GIB,
      source: "default" as const,
      verdict: "defer" as const,
    };
    renderStrip({
      latest: [sample({ floor: legacyFloor, disk_floor: legacyFloor })],
      history: [],
    });
    expect(
      screen.getAllByTestId("fleet-resource-reject-floor-missing")[0]
        .textContent
    ).toMatch(/not reported/i);
    expect(screen.queryByTestId("fleet-resource-reject-floor-none")).toBeNull();
  });

  it("prints the amber margin coord sent, and says so when it sent none", () => {
    renderStrip({
      latest: [sample()],
      history: [],
      headroom_warn_margin: 1.5,
    });
    expect(
      screen.getByTestId("fleet-resource-warn-margin").textContent
    ).toMatch(/x1\.5/);
    cleanup();
    renderStrip({ latest: [sample()], history: [] });
    expect(
      screen.getByTestId("fleet-resource-warn-margin").textContent
    ).toMatch(/not reported/);
  });

  it("degrades an unrecognized verdict to unknown, not to the softer badge", () => {
    renderStrip({
      latest: [
        sample({
          floor: {
            basis: "commit_available",
            bytes: 5 * GIB,
            // The field's PREVIOUS spelling. A coord one version off must not
            // render a hard-refusing lane as one that merely waits.
            verdict: "rejects" as unknown as "reject",
            source: "inherited" as unknown as "policy",
            reject_bytes: 4 * GIB,
            reject_source: "default",
          },
        }),
      ],
      history: [],
    });
    const floor = screen.getAllByTestId("fleet-resource-floor")[0];
    expect(floor.textContent).toMatch(/verdict unknown/);
    expect(floor.textContent).toMatch(/rejects\)/);
    expect(floor.textContent).toMatch(/source unknown/);
  });

  it("counts a missing DISK floor in the legend, not only a missing memory one", () => {
    const memOnly = sample();
    delete memOnly.disk_floor;
    renderStrip({ latest: [memOnly], history: [] });
    expect(
      screen.getByTestId("fleet-resource-floors-missing").textContent
    ).toMatch(/reported no\s+floor/i);
  });

  it("says a floor is NOT REPORTED rather than implying the lane has none", () => {
    renderStrip({ latest: [preFloorSample()], history: [] });
    const missing = screen.getAllByTestId("fleet-resource-floor-missing");
    // The memory floor and the disk floor. NOT the pressure ceiling: this is
    // a host row, where §C1 keeps the swap axis off the row entirely.
    expect(missing).toHaveLength(2);
    expect(missing[0].textContent).toMatch(/not reported/i);
    expect(screen.queryByTestId("fleet-resource-floor")).toBeNull();
    // And the legend counts it rather than leaving the gap invisible.
    expect(
      screen.getByTestId("fleet-resource-floors-missing").textContent
    ).toMatch(/reported no\s+floor/i);
  });

  it("reports all three axes as unreported on a lane that has all three", () => {
    // The same older-coord payload on a Linux lane, where the pressure axis
    // IS published — so its silence is a real gap and says so.
    const legacy = preFloorSample({ lane: "wsl" });
    renderStrip({ latest: [legacy], history: [] });
    expect(screen.getAllByTestId("fleet-resource-floor-missing")).toHaveLength(
      3
    );
    expect(
      screen.getByTestId("fleet-resource-floors-missing").textContent
    ).toMatch(/reported no\s+floor/i);
  });

  it("the legend explains the vocabulary and states no numbers of its own", () => {
    renderStrip({ latest: [sample()], history: [] });
    const legend = screen.getByTestId("fleet-resource-floors");
    expect(legend.textContent).toMatch(/rejects/);
    expect(legend.textContent).toMatch(/defers/);
    expect(legend.textContent).toMatch(/keeps no\s+threshold of its own/i);
    // The old legend transcribed the publishers' constants. It must not.
    expect(legend.textContent).not.toMatch(/GiB/);
    expect(legend.textContent).not.toMatch(/\d+\s*GB/);
  });
});

/**
 * The defect this change fixes: the strip rendered its own opinion of red.
 * Every state below is coord's verdict, rendered verbatim.
 */
describe("§C3 — the pressure axis is rendered where the byte floor is null", () => {
  /** A Linux lane as coord now reports it: no byte floor, a swap ceiling. */
  function wslRow(overrides = {}) {
    return sample({
      lane: "wsl",
      swap_total_bytes: 8 * GIB,
      swap_used_bytes: 5 * GIB,
      commit_total_bytes: null,
      commit_available_bytes: null,
      pressure: { ratio: 0.6, basis: "swap" },
      floor: null,
      pressure_floor: {
        basis: "swap_ratio",
        ratio: 0.5,
        source: "default",
        verdict: "defer",
        reject_ratio: null,
        reject_source: null,
      },
      ...overrides,
    });
  }

  it("shows the swap ceiling with the direction running the OTHER way", () => {
    // A WSL row at swap 0.6 with a 0.5 defer ceiling: without this the row
    // would read "no guard acting" while the dispatcher had already stepped
    // back — the exact inversion this task removes.
    renderStrip({ latest: [wslRow({ headroom: "warn" })], history: [] });
    const admission = screen.getByTestId("fleet-resource-admission");
    expect(admission.textContent).toMatch(/defers/);
    expect(admission.textContent).toMatch(/at or above/);
    expect(admission.textContent).toMatch(/50% swap used/);
    // NOT the byte floor's preposition.
    expect(admission.textContent).not.toMatch(/below\s*50%/);
  });

  it("says 'no mem threshold' on that lane rather than 'not reported'", () => {
    // coord SAYS there is no byte floor here. That is a fact about the fleet;
    // silence would not be.
    renderStrip({ latest: [wslRow()], history: [] });
    const none = screen.getAllByTestId("fleet-resource-floor-none");
    expect(none.some((n) => /no mem threshold/.test(n.textContent ?? ""))).toBe(
      true
    );
    // …and it is NOT counted as a coord that failed to report.
    expect(screen.queryByTestId("fleet-resource-floors-missing")).toBeNull();
  });

  it("says NOTHING about swap on a Windows host row — §C1 outranks tidiness", () => {
    // The host lane's guards are byte-based and its "swap" is the commit
    // counters printed twice, so even the word is forbidden there. An empty
    // pressure axis on that lane is correct, not a gap.
    renderStrip({ latest: [sample()], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-lane")).toBe("host");
    expect(row.textContent).not.toMatch(/swap/i);
    expect(screen.queryByTestId("fleet-resource-floors-missing")).toBeNull();
  });

  it("still prints a host-lane ceiling coord actually asserts", () => {
    // A Linux `host` lane has a real swap device. Withholding a rule the
    // dispatcher enforces would be the inversion this column exists to stop,
    // so a REPORTED threshold prints even on a lane whose figures are hidden.
    renderStrip({
      latest: [
        sample({
          pressure_floor: {
            basis: "swap_ratio",
            ratio: 0.5,
            source: "policy",
            verdict: "reject",
            reject_ratio: 0.5,
            reject_source: "policy",
          },
        }),
      ],
      history: [],
    });
    const admission = screen.getByTestId("fleet-resource-admission");
    expect(admission.textContent).toMatch(/at or above\s*50% swap used/);
    expect(admission.textContent).toMatch(/rejects/);
  });

  it("keeps 'below' on the byte floor and 'at or above' on the ceiling, on one table", () => {
    renderStrip({ latest: [sample(), wslRow()], history: [] });
    const cells = screen.getAllByTestId("fleet-resource-admission");
    const host = cells[0].textContent ?? "";
    const wsl = cells[1].textContent ?? "";
    expect(host).toMatch(/below\s*5\.0 GB free commit/);
    expect(wsl).toMatch(/at or above\s*50% swap used/);
  });

  it("explains the two axes and what 'no threshold' means in the legend", () => {
    renderStrip({ latest: [sample()], history: [] });
    const axes = screen.getByTestId("fleet-resource-axes");
    expect(axes.textContent).toMatch(/opposite/i);
    expect(axes.textContent).toMatch(/unguarded/i);
    expect(axes.textContent).toMatch(/not the same as unmeasured/i);
  });
});

describe("§C3 — a threshold nothing enforces renders without a verb", () => {
  it("shows 'set, not enforced' and no direction word", () => {
    // min_free_mem_bytes_wsl: a shipped control with no consumer.
    renderStrip({
      latest: [
        sample({
          floor: {
            basis: "mem_available",
            bytes: 4 * GIB,
            source: "policy",
            verdict: null,
            reject_bytes: null,
            reject_source: null,
          },
        }),
      ],
      history: [],
    });
    const floor = screen.getAllByTestId("fleet-resource-floor")[0];
    expect(floor.textContent).toMatch(/set, not enforced/);
    expect(floor.textContent).toMatch(/4\.0 GB available memory/);
    // The number is shown; the behaviour is not claimed.
    expect(floor.textContent).not.toMatch(/defers|rejects/);
    expect(floor.textContent).not.toMatch(/below|at or above/);
  });

  it("still prints the preposition on a rejecting enforcer under an unenforced primary", () => {
    renderStrip({
      latest: [
        sample({
          lane: "wsl",
          pressure_floor: {
            basis: "swap_ratio",
            ratio: 0.5,
            // Nothing enforces the primary…
            verdict: null,
            // …but something rejects at 90%.
            reject_ratio: 0.9,
            reject_source: "policy",
            source: "policy",
          },
        }),
      ],
      history: [],
    });
    const admission = screen.getByTestId("fleet-resource-admission");
    expect(admission.textContent).toMatch(/set, not enforced/);
    expect(admission.textContent).toMatch(/rejects/);
    expect(admission.textContent).toMatch(/at or above\s*90% swap used/);
  });
});

describe("§C3 — the row is coloured from `headroom`, never from the ratio", () => {
  it("renders breach as the strongest state", () => {
    renderStrip({
      latest: [sample({ headroom: "breach" })],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-headroom")).toBe("breach");
    expect(row.getAttribute("data-tone")).toBe("critical");
    expect(
      within(row).getByTestId("fleet-resource-admission").textContent
    ).toMatch(/work refused/);
  });

  it("renders warn as the intermediate state", () => {
    renderStrip({ latest: [sample({ headroom: "warn" })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-tone")).toBe("warn");
    expect(
      within(row).getByTestId("fleet-resource-admission").textContent
    ).toMatch(/work waits/);
  });

  it("renders ok as normal", () => {
    renderStrip({ latest: [sample({ headroom: "ok" })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-tone")).toBe("ok");
    expect(
      within(row).getByTestId("fleet-resource-admission").textContent
    ).toMatch(/accepting work/);
  });

  it("renders unknown like a stale row — never green", () => {
    renderStrip({ latest: [sample({ headroom: "unknown" })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-tone")).toBe("unknown");
    // The SAME tone a machine that published nothing gets.
    expect(
      within(row).getByTestId("fleet-resource-admission").textContent
    ).toMatch(/unknown/);
  });

  it("falls back to unknown — not to a client band and not to green — when the fields are absent", () => {
    renderStrip({ latest: [preFloorSample()], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-headroom")).toBe("unknown");
    expect(row.getAttribute("data-tone")).toBe("unknown");
    // The pressure magnitude is still shown — it is a different question.
    expect(within(row).getByTestId("fleet-resource-pressure")).toBeTruthy();
  });

  it("does NOT go red on a high ratio coord is still electing", () => {
    // The literal disagreement the deleted constants produced: 0.99 was above
    // SATURATED_AT, so the strip painted red while the dispatcher kept
    // sending work.
    renderStrip({
      latest: [
        sample({ pressure: { ratio: 0.99, basis: "commit" }, headroom: "ok" }),
      ],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-tone")).toBe("ok");
    expect(
      within(row).getByTestId("fleet-resource-pressure").textContent
    ).toMatch(/99%/);
  });

  it("goes red on a LOW ratio when the floor is breached", () => {
    // The other direction, and the reason a floor cannot be restated as a
    // ratio: the floor is on a column the ratio never divides by.
    renderStrip({
      latest: [
        sample({
          lane: "wsl",
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 1 * GIB,
          commit_total_bytes: null,
          commit_available_bytes: null,
          pressure: { ratio: 0.02, basis: "swap" },
          floor: {
            basis: "mem_available",
            bytes: 4 * GIB,
            source: "policy",
            verdict: "reject",
          },
          headroom: "breach",
        }),
      ],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-tone")).toBe("critical");
    expect(
      within(row).getByTestId("fleet-resource-admission").textContent
    ).toMatch(/4\.0 GB available memory/);
  });

  it("withholds the floors entirely on an EXPIRED row", () => {
    // Past EXPIRED_AFTER_SECS the payload carries no information — including
    // about configuration that may since have changed.
    renderStrip({ latest: [sample({ age_secs: 40_000 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("unknown");
    expect(within(row).queryByTestId("fleet-resource-floor")).toBeNull();
    expect(
      within(row).queryByTestId("fleet-resource-floor-missing")
    ).toBeNull();
    expect(
      within(row).getByTestId("fleet-resource-admission").textContent
    ).toMatch(/unknown/);
  });

  it("demotes a STALE row's floors like every other value on that row", () => {
    renderStrip({ latest: [sample({ age_secs: 600 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    const floor = within(row).getAllByTestId("fleet-resource-floor")[0];
    // Still readable as last-known, but visibly not current.
    expect(floor.closest(".italic.opacity-60")).toBeTruthy();
  });

  it("says in WORDS whether the work fails or waits, not only in colour", () => {
    renderStrip({ latest: [sample({ headroom: "breach" })], history: [] });
    expect(
      screen.getByTestId("fleet-resource-admission-verb").textContent
    ).toBe("builds fail here");
    cleanup();
    renderStrip({ latest: [sample({ headroom: "warn" })], history: [] });
    expect(
      screen.getByTestId("fleet-resource-admission-verb").textContent
    ).toBe("builds wait");
  });

  it("forces a stale row's verdict to unknown, whatever coord last said", () => {
    renderStrip({
      latest: [sample({ age_secs: 600, headroom: "ok" })],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("stale");
    expect(row.getAttribute("data-headroom")).toBe("unknown");
    expect(row.getAttribute("data-tone")).toBe("unknown");
  });

  it("hoists a breaching lane onto the collapsed panel header", () => {
    renderStrip({ latest: [sample({ headroom: "breach" })], history: [] });
    expect(
      screen.getByTestId("fleet-resource-breach-badge").textContent
    ).toMatch(/1 refusing work/);
  });
});

describe("sparklines", () => {
  it("draws a trend when the window has usable points", () => {
    renderStrip({
      latest: [sample()],
      history: [
        {
          device_id: DEV,
          lane: "host",
          lane_instance: null,
          pressure_basis: "commit",
          points: [
            {
              sampled_at: "2026-08-06T11:59:00Z",
              pressure: 0.4,
              disk_free_bytes: null,
              disk_total_bytes: null,
              build_slots_busy: null,
              build_slots_total: null,
              ci_jobs_running: null,
            },
            {
              sampled_at: "2026-08-06T12:00:00Z",
              pressure: 0.8,
              disk_free_bytes: null,
              disk_total_bytes: null,
              build_slots_busy: null,
              build_slots_total: null,
              ci_jobs_running: null,
            },
          ],
        },
      ],
    });
    expect(screen.getByTestId("fleet-resource-sparkline")).toBeTruthy();
  });

  it("says 'no history' rather than drawing a chart from one point", () => {
    renderStrip({ latest: [sample()], history: [] });
    expect(screen.getByTestId("fleet-resource-sparkline-empty")).toBeTruthy();
  });
});

describe("§C3 — staleness applies to the WHOLE row, not just the lead column", () => {
  it("withholds disk / slots / CI jobs / memory on an unknown row", () => {
    // Older than EXPIRED_AFTER_SECS: the row is unknown, so no cell may print
    // a value as if it were current.
    renderStrip({ latest: [sample({ age_secs: 40_000 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("unknown");
    // The disk figure from the sample must not appear.
    expect(row.textContent).not.toMatch(/100 GB/);
    expect(row.textContent).not.toMatch(/1\/4/);
  });

  it("shows stale values demoted rather than withheld", () => {
    renderStrip({ latest: [sample({ age_secs: 600 })], history: [] });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-freshness")).toBe("stale");
    // Still readable as "last known"…
    expect(row.textContent).toMatch(/100 GB/);
    // …but visibly demoted.
    expect(row.querySelectorAll(".italic.opacity-60").length).toBeGreaterThan(
      0
    );
  });
});

describe("§C1 — a host row never prints swap counters, even if coord says swap", () => {
  it("suppresses the raw swap disclosure when the lane is host", () => {
    // A publisher/coord bug: basis=swap stamped on a host lane. The ratio is
    // still the server's, but the counters must not be printed a second time
    // under a swap label.
    renderStrip({
      latest: [
        sample({
          lane: "host",
          swap_total_bytes: 40 * GIB,
          swap_used_bytes: 31 * GIB,
          pressure: { ratio: 0.775, basis: "swap" },
        }),
      ],
      history: [],
    });
    const row = screen.getByTestId("fleet-resource-row");
    expect(row.getAttribute("data-lane")).toBe("host");
    // The visible label falls back to the honest instrument for this lane.
    expect(within(row).getByText("commit used")).toBeTruthy();
    expect(within(row).queryByText("swap used")).toBeNull();
  });
});

describe("§C1 — the coupled WSL figure carries its ceiling", () => {
  it("never prints a bare byte count for spendable headroom", () => {
    renderStrip({
      latest: [
        sample({ commit_available_bytes: 900 * 1024 * 1024 }),
        sample({
          lane: "wsl",
          mem_total_bytes: 16 * GIB,
          mem_available_bytes: 9 * GIB,
          commit_total_bytes: 64 * GIB,
          commit_available_bytes: null,
          swap_total_bytes: 8 * GIB,
          swap_used_bytes: 6 * GIB,
          pressure: { ratio: 0.75, basis: "swap" },
        }),
      ],
      history: [],
    });
    const coupled = screen.getByTestId("fleet-resource-coupled-headroom");
    // A denominator and a percentage, not "spendable: 900 MB" on its own.
    expect(coupled.textContent).toMatch(/\//);
    expect(coupled.textContent).toMatch(/%/);
    expect(coupled.textContent).toMatch(/host-bound/);
  });
});
