/**
 * /admin/coord/devops — the Dev Ops Overview.
 *
 * Plan `2026-08-25-coord-console-intent-and-devops-sections` Phase 1. The
 * assertions here are the ones the phase exists to hold, and each is a
 * regression guard rather than a snapshot:
 *
 *  1. **Exactly ONE machine list.** The page merges `HealthSummaryCard` and
 *     `FleetOverview`; two lists with two notions of "healthy" on one page is
 *     a correctness defect, so the merge is asserted structurally.
 *  2. **A coord device that appears in no runner inventory renders `unknown`
 *     and does not vanish.** Never `healthy`, never a row of zeroes.
 *  3. **Row tone comes from coord's `headroom` verdict**, never from a
 *     client-side threshold constant.
 *  4. **The page-locals really were extracted**, not copied: the pipeline
 *     page no longer declares them.
 *
 * Phase 2 adds the CI-capacity join (verification items 4 and 5). Its rules
 * are asserted at the bottom of this file: a linked device gets the collapsed
 * disclosure, an unlinked one gets an explanation and a way out — never a
 * disabled toggle — and a machine with no coord device link does not appear
 * here at all, which the page states in prose rather than leaving to be
 * noticed. The disclosure's own behaviour (one shared panel, one shared pair
 * of API calls, consent UX unchanged) is asserted in
 * `components/operations/CiCapacityDisclosure.test.tsx`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const httpGet = vi.fn();
const httpFetch = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    fetch: (...args: unknown[]) => httpFetch(...args),
  },
}));

// The two live streams `FleetOverview` holds are out of scope here (they have
// their own tests) and one of them opens a WebSocket. Stubbed to a seeded,
// empty stream so the machine list under test is built from the fleet payload
// and coord's device list alone.
vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({
    byHostname: new Map(),
    connected: false,
    error: null,
    seeded: true,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/operations/useSymbolClaimsStream", () => ({
  useSymbolClaimsStream: () => ({
    byMachine: new Map(),
    error: null,
    refetch: vi.fn(),
  }),
}));

// The severity badges navigate (`HealthBadge` carries `onClick`, not `href`),
// so the page holds a router. Only `useRouter` is stubbed — nothing else in
// this tree reads `next/navigation`, and `routerPush` is referenced lazily,
// inside the returned function, so the hoisted factory never touches its TDZ.
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => routerPush(...args) }),
}));

import CoordDevOpsPage from "./page";
import * as fleetResources from "@/components/operations/fleetResources";
import {
  DeviceCrossLinks,
  deviceStateBadgeVariant,
} from "@/components/operations/FleetHealthSummary";
import { useFleetHealth } from "@/components/operations/useFleetHealth";

/** Coord wire shape — mirrors `DeviceHealthSnapshot` (fleet_health.rs). */
function coordDevice(id: string, hostname: string, state?: string) {
  return { device_id: id, hostname, state };
}

/** A runner row as `GET /operations/fleet` serves it. */
function runner(hostname: string) {
  return {
    id: `r-${hostname}`,
    name: `runner-${hostname}`,
    hostname,
    port: 9876,
    os: "linux",
    derivedStatus: "healthy",
    lastHeartbeat: new Date().toISOString(),
  };
}

/** A devenv machine row as `GET /devenv/machines` serves it. */
function devenvMachine(id: string, name: string, coordDeviceId: string | null) {
  return {
    id,
    name,
    hostname: name,
    description: null,
    key_prefix: "mk_abc",
    enrolled: true,
    last_seen_at: null,
    revoked: false,
    environment_id: null,
    coord_device_id: coordDeviceId,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };
}

function hostSample(
  deviceId: string,
  headroom: "ok" | "warn" | "breach" | "unknown"
) {
  return {
    device_id: deviceId,
    lane: "host",
    lane_instance: null,
    sampled_at: new Date().toISOString(),
    age_secs: 15,
    cpu_cores: 16,
    load_1m: null,
    mem_total_bytes: 1,
    mem_available_bytes: 1,
    commit_total_bytes: 1,
    commit_available_bytes: 1,
    swap_total_bytes: null,
    swap_used_bytes: null,
    disk_total_bytes: 1,
    disk_free_bytes: 1,
    disk_mount: "/",
    build_slots_total: 4,
    build_slots_busy: 1,
    build_queue_depth: 0,
    ci_jobs_running: null,
    source: "supervisor",
    // A LOW ratio with a breaching verdict, on purpose: any surviving
    // client-side band over the ratio would render this row calm.
    pressure: { ratio: 0.12, basis: "commit" },
    floor: {
      basis: "commit_available",
      bytes: 4 * 1024 ** 3,
      source: "default",
      verdict: "defer",
    },
    headroom,
  };
}

interface Fixture {
  devices: ReturnType<typeof coordDevice>[];
  runners: ReturnType<typeof runner>[];
  samples: unknown[];
  /** The devenv machine roster backing the Phase 2 CI-capacity join. */
  machines?: ReturnType<typeof devenvMachine>[];
  /**
   * The rest of the `/fleet/health` body beside `devices` — coord's alert
   * severity rollup (`alerts`, `alerts_scrape_up`) and `pageout`. Spread
   * verbatim, so a fixture can serve a coord that predates any of them.
   */
  healthExtras?: Record<string, unknown>;
}

function mockRoutes(fixture: Fixture) {
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("resource-samples")) {
      return Promise.resolve({ latest: fixture.samples, history: [] });
    }
    if (u.includes("fleet/health")) {
      return Promise.resolve({
        devices: fixture.devices,
        ...(fixture.healthExtras ?? {}),
      });
    }
    return Promise.reject(new Error(`unexpected GET ${u}`));
  });
  httpFetch.mockImplementation((url: unknown) => {
    const u = String(url);
    const json = u.includes("/devenv/machines")
      ? (fixture.machines ?? [])
      : u.includes("/fleet/tasks")
        ? { task_runs: [], total: 0 }
        : u.includes("/fleet/volumes")
          ? { devices: [] }
          : u.endsWith("/fleet")
            ? {
                runners: fixture.runners,
                claude_sessions: {},
                total_runners: fixture.runners.length,
                total_healthy: fixture.runners.length,
                total_running_tasks: 0,
                total_claude_sessions: 0,
              }
            : {};
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(json),
    });
  });
}

describe("/admin/coord/devops", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    routerPush.mockReset();
    window.localStorage.clear();
  });

  it("renders exactly ONE machine list", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("coord-devops-machines")).toBeInTheDocument()
    );
    expect(screen.getAllByTestId("coord-devops-machines")).toHaveLength(1);
    // One row per machine, not one per source.
    expect(
      document.querySelectorAll("[data-operations-machine-card]")
    ).toHaveLength(1);
    // And the second list this page's merge replaced is NOT mounted here.
    // `HealthSummaryCard` rendered it; Phase 4 deleted the component outright
    // once its last mount (the pipeline page's drawer) went, so these ids
    // cannot appear anywhere in the app any more.
    expect(screen.queryByTestId("coord-fleet-health")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("coord-fleet-health-row")).toHaveLength(0);
  });

  it("joins coord's DeviceState onto the machine row", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "degraded")],
      runners: [runner("msi")],
      samples: [],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="msi"]')).not.toBeNull()
    );
    const card = document.querySelector('[data-hostname="msi"]') as HTMLElement;
    // Coord's verdict, verbatim, beside the runner facts — not folded into
    // them, and not a second list.
    expect(card.querySelector('[data-coord-state="degraded"]')).not.toBeNull();
    expect(card).toHaveAttribute("data-runner-inventory", "present");
    // The cross-links the deleted `HealthSummaryCard` carried per device came
    // across with the merge.
    expect(within(card).getByText("trees")).toBeInTheDocument();
    expect(within(card).getByText("claims")).toBeInTheDocument();
    expect(within(card).getByText("sessions")).toBeInTheDocument();
  });

  it("renders a device present only in /fleet/health as unknown, and does not drop it", async () => {
    // `ghost` reports to coord as HEALTHY but appears in no runner inventory.
    // The row must exist, and its runner-side state must be `unknown` — the
    // coord verdict must not be borrowed to fill a fact nothing measured.
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy"),
        coordDevice("d-2", "ghost", "healthy"),
      ],
      runners: [runner("msi")],
      samples: [],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="ghost"]')).not.toBeNull()
    );
    const ghost = document.querySelector(
      '[data-hostname="ghost"]'
    ) as HTMLElement;
    expect(ghost).toHaveAttribute("data-runner-inventory", "absent");
    expect(
      ghost.querySelector('[data-operations-machine-health="unknown"]')
    ).not.toBeNull();
    // Never "healthy", and never a fabricated zero.
    expect(
      ghost.querySelector('[data-operations-machine-health="healthy"]')
    ).toBeNull();
    expect(
      ghost.querySelector('[data-operations-machine-counts="unknown"]')
    ).not.toBeNull();
    expect(ghost).not.toHaveTextContent("0 of 0 healthy");
    // The runner and session sections are suppressed rather than rendered as
    // "Runners (0)" — a fabricated zero about a machine nothing measured.
    expect(ghost).not.toHaveTextContent("Runners (0)");
    expect(ghost).not.toHaveTextContent("No active sessions");
    expect(
      ghost.querySelector("[data-operations-machine-inventory-unknown]")
    ).not.toBeNull();
    // …and the machine that IS in both is unaffected.
    expect(
      document
        .querySelector('[data-hostname="msi"]')
        ?.getAttribute("data-runner-inventory")
    ).toBe("present");
  });

  it("renders a machine coord's health read does not name as unknown too", async () => {
    // The other direction of the same join: the runner inventory knows a host
    // coord's device list does not. Unknown, with a reason — not healthy.
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi"), runner("orphan")],
      samples: [],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="orphan"]')).not.toBeNull()
    );
    const orphan = document.querySelector(
      '[data-hostname="orphan"]'
    ) as HTMLElement;
    expect(orphan.querySelector('[data-coord-state="unknown"]')).not.toBeNull();
  });

  it("takes resource row tone from coord's headroom, not from a client-side band", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [hostSample("d-1", "breach")],
    });

    render(<CoordDevOpsPage />);

    // The admission cell carries the SERVER's verdict, and the strip's alarm
    // badge counts from it — with a pressure ratio of 0.12, which no
    // saturation band would have flagged.
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="fleet-resource-admission"]')
      ).not.toBeNull()
    );
    expect(
      document.querySelector('[data-testid="fleet-resource-admission"]')
    ).toHaveAttribute("data-headroom", "breach");
    expect(screen.getByTestId("fleet-resource-breach-badge")).toHaveTextContent(
      "1 refusing work"
    );
  });

  it("keeps the CI occupancy panel, and its statement of what it cannot show", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [hostSample("d-1", "ok")],
    });

    render(<CoordDevOpsPage />);

    expect(await screen.findByTestId("ci-run-panel")).toBeInTheDocument();
    // Coord exposes no read route for `coord.ci_dispatches`, so per-job queue
    // wait and duration are unreachable. The panel says so; nothing on this
    // page fills those columns from something else.
    const gap = await screen.findByTestId("ci-run-missing-columns");
    expect(gap).toHaveTextContent("queue wait");
    expect(gap).toHaveTextContent("duration");
  });

  it("reintroduces no client-side threshold constant, on ANY axis", () => {
    // `fleetResources.ts` deleted `SATURATED_AT` / `WARN_AT` deliberately and
    // says why: the thresholds coord admits on live on columns and ratios this
    // page does not own, so a "threshold equivalent" is a number nobody can
    // compute without inventing it. This asserts the module's exported
    // surface, so a reintroduction fails here rather than in review.
    expect(
      Object.keys(fleetResources).filter(
        (k) => /^(SATURATED_AT|WARN_AT)$/.test(k) || /THRESHOLD/i.test(k)
      )
    ).toEqual([]);

    // The name check alone is no longer sufficient, and saying why matters:
    // the saturation axis added helpers whose names legitimately contain
    // "saturation" (`classifySaturation`, `formatSaturationCounts`, …), so a
    // `/SATURAT/i` sweep would now be a false-positive machine that the next
    // author deletes rather than fixes. What the guard actually cares about is
    // the SHAPE of the defect — a number decided here — so it asserts that
    // instead, against an explicit allow-list.
    //
    // The two survivors are FRESHNESS bounds, not admission thresholds: they
    // decide when a sample has stopped being true, which is this client's own
    // question and coord's `age_secs` is the input. Coord's `saturation_floor`
    // of 0.80 must never appear beside them.
    const numeric = Object.entries(fleetResources)
      .filter(([, v]) => typeof v === "number")
      .map(([k]) => k)
      .sort();
    expect(numeric).toEqual(["EXPIRED_AFTER_SECS", "STALE_AFTER_SECS"]);
  });

  it("issues exactly two reads: fleet health, and one resource-samples poll", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [hostSample("d-1", "ok")],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(
        httpGet.mock.calls.filter((c) =>
          String(c[0]).includes("resource-samples")
        ).length
      ).toBe(1)
    );
    // The strip and the CI panel share ONE poll of the samples route — two
    // would be two chances to disagree about the fleet right now.
    expect(
      httpGet.mock.calls.filter((c) => String(c[0]).includes("fleet/health"))
    ).toHaveLength(1);
  });

  it("says the fleet-health read failed rather than showing an empty fleet", async () => {
    httpGet.mockImplementation((url: unknown) =>
      String(url).includes("resource-samples")
        ? Promise.resolve({ latest: [], history: [] })
        : Promise.reject(new Error("502 Bad Gateway"))
    );
    httpFetch.mockImplementation((url: unknown) => {
      const u = String(url);
      const json = u.includes("/fleet/tasks")
        ? { task_runs: [], total: 0 }
        : u.includes("/fleet/volumes")
          ? { devices: [] }
          : {
              runners: [],
              claude_sessions: {},
              total_runners: 0,
              total_healthy: 0,
              total_running_tasks: 0,
              total_claude_sessions: 0,
            };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(json),
      });
    });

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-health-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent("Fleet health unavailable")
    );
    // Amber, not green and not red: the failure is about the read.
    expect(strip).toHaveAttribute("data-health-level", "amber");
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — "would /admin/coord/devops have shown the 2026-08-27 incident?"
// ---------------------------------------------------------------------------

/**
 * The GiB the floors are expressed in. Not a threshold: the numbers below are
 * echoes of what coord SENDS on the wire, which is the point — this page owns
 * no threshold, so a fixture is the only place a floor value may appear.
 */
const GIB = 1024 ** 3;

/**
 * **The literal 2026-08-27 incident row**, serialized exactly as coord PR
 * #1676 serializes it (`device_resource_samples.rs` → `ResourceSampleRow`).
 *
 * `qontinui-canonical-coord` at **190,840 PIDs** against a
 * `/proc/sys/kernel/threads-max` of **192,146** — 99.3%, and no process in the
 * VM able to `fork()`. At that same instant the host lane had **73.3 GB of
 * 125.6 GB free commit**, WSL sat at ~21% of its ceiling, and there had been
 * zero Resource-Exhaustion-Detector events in three days. Every memory
 * instrument read healthy and every reading was ACCURATE.
 *
 * The saturation fields are coord's, not this fixture's arithmetic:
 *
 * * `saturation: { ratio: 190840/192146, basis: "threads" }` — `lane_saturation`
 * * `saturation_floor: { basis: "thread_ratio", ratio: 0.80, verdict: "defer" }`
 *   — `saturation_floor()`, whose 0.80 is `DEFAULT_THREAD_SATURATION_DEFER_RATIO`
 *   and lives in coord because the client keeps no threshold of its own.
 * * `headroom: "warn"` — `sample_verdict`'s worst-of over THREE axes. Disk and
 *   memory both grade `ok` here; the whole verdict comes from the third axis.
 *
 * `saturation_source: "cgroup"` is the real provenance: 190,840 came from
 * cgroup `pids.current` via `docker stats`, compared against a HOST-WIDE
 * kernel ceiling because `docker inspect` showed `PidsLimit=<nil>` — nothing
 * bounded the cgroup, so the host ceiling was the binding one.
 */
function incidentSample(deviceId: string) {
  return {
    device_id: deviceId,
    lane: "host",
    lane_instance: null,
    sampled_at: new Date().toISOString(),
    age_secs: 15,
    cpu_cores: 16,
    load_1m: null,
    mem_total_bytes: 137_000_000_000,
    // Healthy on every memory instrument — that is the whole point.
    mem_available_bytes: 38_400_000_000,
    commit_total_bytes: 125_600_000_000,
    commit_available_bytes: 73_300_000_000,
    swap_total_bytes: null,
    swap_used_bytes: null,
    disk_total_bytes: 2_000_000_000_000,
    disk_free_bytes: 900_000_000_000,
    disk_mount: "D:",
    build_slots_total: 4,
    build_slots_busy: 1,
    build_queue_depth: 0,
    ci_jobs_running: null,
    threads_max: 192146,
    threads_used: 190840,
    pids_max: null,
    pids_used: null,
    saturation_source: "cgroup",
    source: "runner",
    pressure: { ratio: 1 - 73_300_000_000 / 125_600_000_000, basis: "commit" },
    saturation: { ratio: 190840 / 192146, basis: "threads" },
    floor: {
      basis: "commit_available",
      bytes: 8 * GIB,
      source: "default",
      verdict: "defer",
      reject_bytes: 4 * GIB,
      reject_source: "default",
    },
    disk_floor: {
      basis: "disk_free",
      bytes: 30 * GIB,
      source: "default",
      verdict: "reject",
      reject_bytes: null,
      reject_source: null,
    },
    pressure_floor: null,
    saturation_floor: {
      basis: "thread_ratio",
      ratio: 0.8,
      source: "default",
      verdict: "defer",
      reject_ratio: null,
      reject_source: null,
    },
    headroom: "warn",
  };
}

/**
 * The **pre-Phase-3 activation window**: the same machine, published by a
 * runner built before the saturation probe.
 *
 * Every saturation column is NULL — never 0 — and coord therefore SKIPS
 * grading the axis (`SaturationInputs::is_unmeasured`) rather than pinning the
 * row to `unknown`. So `saturation: null` beside `headroom: "ok"` is a
 * correct, expected pair, and it is what every machine in the fleet looks like
 * until its own runner is next rebuilt (which `runner-lifecycle` forbids
 * forcing).
 *
 * `saturation_floor` is still present: coord reports the rule on every lane
 * whether or not a publisher can measure against it.
 */
function preSaturationSample(deviceId: string) {
  return {
    ...incidentSample(deviceId),
    threads_max: null,
    threads_used: null,
    pids_max: null,
    pids_used: null,
    saturation_source: null,
    saturation: null,
    headroom: "ok",
  };
}

describe("/admin/coord/devops — the saturation axis (Phase 5)", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    window.localStorage.clear();
  });

  it("does NOT render the 2026-08-27 incident row as ok, and says which axis", async () => {
    // The plan's definition of done, made executable: "if a machine at
    // 190,840 / 192,146 threads with 73.3 GB free commit would still render
    // green, the fix is wrong and this plan is not done."
    mockRoutes({
      devices: [coordDevice("d-1", "spaceship", "healthy")],
      runners: [runner("spaceship")],
      samples: [incidentSample("d-1")],
    });

    render(<CoordDevOpsPage />);

    const row = (await waitFor(() => {
      const el = document.querySelector('[data-testid="fleet-resource-row"]');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;

    // 1. NOT ok. Stated in the plan's own words, and against BOTH the verdict
    //    attribute and the tone the row is painted with.
    expect(row.getAttribute("data-headroom")).not.toBe("ok");
    expect(row.getAttribute("data-headroom")).toBe("warn");
    expect(row.getAttribute("data-tone")).not.toBe("ok");
    expect(row.getAttribute("data-freshness")).toBe("fresh");

    // 2. The saturation axis is ON SCREEN with the incident's own magnitude.
    //    Before this change there was no such column at all, which is the
    //    reason the row was green: the number existed nowhere on the page.
    const saturation = row.querySelector(
      '[data-testid="fleet-resource-saturation"]'
    ) as HTMLElement;
    expect(saturation).not.toBeNull();
    expect(saturation).toHaveAttribute("data-saturation-report", "measured");
    expect(saturation).toHaveTextContent("99%");
    expect(saturation).toHaveTextContent("tasks used");

    // 3. The RULE that makes 99% amber is on screen too, read off the wire.
    //    Without it an operator sees an amber row whose every visible floor is
    //    comfortably clear — the incident would still not be legible AS an
    //    incident, which is the failure mode the plan calls out by name.
    const admission = row.querySelector(
      '[data-testid="fleet-resource-admission"]'
    ) as HTMLElement;
    expect(admission).toHaveAttribute("data-headroom", "warn");
    expect(admission).toHaveTextContent("saturation");
    expect(admission).toHaveTextContent("80% of the task ceiling");
    // coord's verdict for that ceiling, not one this page picked.
    expect(admission).toHaveTextContent("defers");

    // 4. …while every MEMORY instrument on the same row reads healthy. This is
    //    the independence the axis exists for: a metric that co-varied with an
    //    existing one would add no coverage. 42% commit used is a figure no
    //    memory band would ever have flagged.
    const pressure = row.querySelector(
      '[data-testid="fleet-resource-pressure"]'
    ) as HTMLElement;
    expect(pressure).toHaveTextContent("42%");
    expect(pressure).toHaveTextContent("commit used");
    expect(admission).toHaveTextContent("8.0 GB free commit");

    // 5. And the panel header counts it, so it survives the panel being
    //    collapsed — a red fleet state must not hide behind a click.
    expect(
      screen.getByTestId("fleet-resource-near-floor-badge")
    ).toHaveTextContent("1 delaying work");
  });

  it("renders an all-NULL saturation row as unknown, never green, without destroying the other verdicts", async () => {
    // The activation window: every machine in the fleet publishes NULL
    // saturation until its own runner is rebuilt. That state must render
    // honestly on the new axis AND leave the memory and disk verdicts — which
    // are perfectly good — intact.
    mockRoutes({
      devices: [coordDevice("d-1", "spaceship", "healthy")],
      runners: [runner("spaceship")],
      samples: [preSaturationSample("d-1")],
    });

    render(<CoordDevOpsPage />);

    const row = (await waitFor(() => {
      const el = document.querySelector('[data-testid="fleet-resource-row"]');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;

    // Unknown on the saturation axis, and named as the RIGHT unknown: a
    // publisher that predates the probe, not a probe that failed.
    const cell = row.querySelector(
      '[data-testid="fleet-resource-saturation-unknown"]'
    ) as HTMLElement;
    expect(cell).not.toBeNull();
    expect(cell).toHaveAttribute("data-saturation-report", "unmeasured");
    expect(cell).toHaveTextContent("unknown");
    // Never a fabricated zero — a 0 here would rank an unmeasured machine
    // FIRST, and would read as an idle task table on a box nobody measured.
    expect(cell).not.toHaveTextContent("0%");
    // …and no measured cell was rendered beside it.
    expect(
      row.querySelector('[data-testid="fleet-resource-saturation"]')
    ).toBeNull();

    // The other two axes survive. Coord skipped GRADING the unmeasured axis
    // rather than pinning the row to unknown, so `ok` here is correct — and
    // the memory and disk floors are still on screen.
    expect(row.getAttribute("data-headroom")).toBe("ok");
    const admission = row.querySelector(
      '[data-testid="fleet-resource-admission"]'
    ) as HTMLElement;
    expect(admission).toHaveTextContent("8.0 GB free commit");
    expect(admission).toHaveTextContent("30.0 GB free disk");
    // The rule is still stated even though nothing can be measured against it
    // yet: a lane with no reported threshold reads as unconstrained, which is
    // the false-safe in the other direction.
    expect(admission).toHaveTextContent("80% of the task ceiling");

    // Nothing is counted as refusing or delaying work on this row.
    expect(screen.queryByTestId("fleet-resource-breach-badge")).toBeNull();
    expect(screen.queryByTestId("fleet-resource-near-floor-badge")).toBeNull();
  });

  it("renders coord's `stale` DeviceState apart from `partitioned`", async () => {
    // Phase 4's fifth DeviceState. `stale` = the device heartbeats fine and
    // its SAMPLER has gone quiet; `partitioned` = it stopped heartbeating at
    // all. The 2026-08-27 evidence was the first and not the second, so the
    // two must not paint the same.
    mockRoutes({
      devices: [
        coordDevice("d-1", "spaceship", "stale"),
        coordDevice("d-2", "gone", "partitioned"),
      ],
      runners: [runner("spaceship"), runner("gone")],
      samples: [],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(
        document.querySelector('[data-hostname="spaceship"]')
      ).not.toBeNull()
    );
    const stale = document.querySelector(
      '[data-coord-state="stale"]'
    ) as HTMLElement;
    const partitioned = document.querySelector(
      '[data-coord-state="partitioned"]'
    ) as HTMLElement;
    expect(stale).not.toBeNull();
    expect(partitioned).not.toBeNull();
    // Not the unknown fallback — coord OBSERVED this, it did not stay silent.
    expect(deviceStateBadgeVariant("stale")).not.toBe(
      deviceStateBadgeVariant(undefined)
    );
    // …and not the red reserved for "coord cannot reach it".
    expect(deviceStateBadgeVariant("stale")).not.toBe(
      deviceStateBadgeVariant("partitioned")
    );
    expect(deviceStateBadgeVariant("partitioned")).toBe("destructive");

    // The fleet strip carries its own count, apart from degraded and unknown.
    const strip = await screen.findByTestId("coord-devops-health-strip");
    expect(screen.getByTestId("coord-devops-stale-badge")).toHaveTextContent(
      "stale 1"
    );
    // A stale sampler is amber; a partitioned device is what makes it red.
    expect(strip).toHaveAttribute("data-health-level", "red");
    expect(
      screen.getByTestId("coord-devops-unreachable-badge")
    ).toHaveTextContent("unreachable 1");
  });
});

/**
 * Phase 1 §0 — the page-locals had to be lifted before anything else could be
 * written, and Phase 4 then took the last consumer off the pipeline page
 * entirely. Both halves still hold, in their Phase 4 form: the survivors are
 * importable from a shared module, and the pipeline page neither declares NOR
 * imports any of them (a copy would satisfy the first half alone, and drift).
 *
 * `HealthSummaryCard` is deliberately absent from this list. Phase 1 merged its
 * content into the ONE machine list asserted above rather than mounting it
 * here, so when Phase 4 deleted the pipeline drawer the component had no caller
 * left and was deleted rather than parked as an unmounted export.
 */
describe("the fleet page's page-locals were extracted, then outgrown", () => {
  const pipelinePage = readFileSync(
    join(__dirname, "..", "pipeline", "page.tsx"),
    "utf8"
  );

  it("exports the survivors from shared modules", () => {
    expect(typeof useFleetHealth).toBe("function");
    expect(typeof DeviceCrossLinks).toBe("function");
    expect(deviceStateBadgeVariant("healthy")).toBe("default");
    // The honesty rule the mapping carries: an absent state is not healthy.
    expect(deviceStateBadgeVariant(undefined)).toBe("outline");
    expect(deviceStateBadgeVariant("something-new")).toBe("outline");
  });

  it("leaves neither a declaration nor a mount behind on the pipeline page", () => {
    expect(pipelinePage).not.toMatch(/function\s+HealthSummaryCard/);
    expect(pipelinePage).not.toMatch(/function\s+useFleetHealth/);
    expect(pipelinePage).not.toMatch(/function\s+deviceStateBadgeVariant/);
    expect(pipelinePage).not.toMatch(/interface\s+HealthSummaryCardProps/);
    // Phase 4 goes further than Phase 1 did: the page does not import them
    // either. Machine liveness is not that page's subject any more.
    expect(pipelinePage).not.toMatch(/^import .*FleetHealthSummary/m);
    expect(pipelinePage).not.toMatch(/^import .*useFleetHealth/m);
  });
});

/**
 * Phase 2 — CI capacity, and the soft-pointer join it rides on.
 *
 * Verification items 4 and 5. The join is `Machine.coord_device_id`: nullable,
 * optional, and set by two different writers. Every way it can miss is a
 * different fact, and the page's job is to say which one — never to render an
 * absent control, and never a disabled toggle that reads as "CI is off".
 */
describe("/admin/coord/devops — CI capacity", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    window.localStorage.clear();
  });

  it("gives a linked device the disclosure, collapsed", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      machines: [devenvMachine("m-1", "msi", "d-1")],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="msi"]')).not.toBeNull()
    );
    const card = document.querySelector('[data-hostname="msi"]') as HTMLElement;
    await waitFor(() =>
      expect(card.querySelector('[data-ci-capacity="linked"]')).not.toBeNull()
    );
    expect(card.querySelector('[data-machine-id="m-1"]')).not.toBeNull();
    // Collapsed: the panel is not mounted, so the row costs no
    // `GET /machines/{id}/ci-node` until an operator opens it.
    expect(within(card).queryByTestId("ci-node-panel")).toBeNull();
    expect(
      httpFetch.mock.calls.filter((c) => String(c[0]).includes("/ci-node"))
    ).toHaveLength(0);
  });

  it("explains a coord device with no machine record, and links to Environments", async () => {
    // `ghost` is a coord device the tenant has no machine record for. The row
    // must say so and point at the place to fix it.
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy"),
        coordDevice("d-2", "ghost", "healthy"),
      ],
      runners: [runner("msi")],
      samples: [],
      machines: [devenvMachine("m-1", "msi", "d-1")],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="ghost"]')).not.toBeNull()
    );
    const ghost = document.querySelector(
      '[data-hostname="ghost"]'
    ) as HTMLElement;
    await waitFor(() =>
      expect(
        ghost.querySelector('[data-ci-capacity="no_machine"]')
      ).not.toBeNull()
    );
    const notice = ghost.querySelector(
      '[data-ci-capacity="no_machine"]'
    ) as HTMLElement;
    expect(notice.textContent).toMatch(/no machine record/i);
    expect(within(notice).getByRole("link")).toHaveAttribute(
      "href",
      "/environments/machines"
    );
    // NOT a disabled toggle: that reads as "CI is off on this machine", which
    // is a claim about the machine where the truth is a gap in the join.
    expect(within(ghost).queryByRole("switch")).toBeNull();
    expect(ghost.querySelector("[disabled]")).toBeNull();
    // ...and the linked machine on the same page is unaffected.
    expect(
      document
        .querySelector('[data-hostname="msi"]')
        ?.querySelector('[data-ci-capacity="linked"]')
    ).not.toBeNull();
  });

  it("does not show a machine that carries no coord device link, and says the list can be short", async () => {
    // The other direction, and the honest consequence of keying rows on coord
    // devices: `laptop` is enrolled under Environments with no
    // `coord_device_id`, so it is in neither read that builds this page.
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      machines: [
        devenvMachine("m-1", "msi", "d-1"),
        devenvMachine("m-2", "laptop", null),
      ],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="msi"]')).not.toBeNull()
    );
    expect(document.querySelector('[data-hostname="laptop"]')).toBeNull();
    expect(screen.queryByText("laptop")).toBeNull();
    expect(
      document.querySelectorAll("[data-operations-machine-card]")
    ).toHaveLength(1);

    // Stated once on the page, so a missing machine reads as "it is over
    // there" rather than "it does not exist".
    const note = screen.getByTestId("coord-devops-join-note");
    expect(note.textContent).toMatch(/does not appear here at all/i);
    expect(note.textContent).toMatch(/not a count of your machines/i);
    expect(screen.getByTestId("coord-devops-machines-link")).toHaveAttribute(
      "href",
      "/environments/machines"
    );
  });

  it("reports a failed machine read as unknown, not as 'no machine linked'", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
    });
    const routed = httpFetch.getMockImplementation()!;
    httpFetch.mockImplementation((url: unknown, init?: unknown) =>
      String(url).includes("/devenv/machines")
        ? Promise.resolve({
            ok: false,
            status: 502,
            json: () =>
              Promise.resolve({
                detail: { code: "upstream", message: "coord is not reachable" },
              }),
          })
        : routed(url, init)
    );

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(
        document.querySelector('[data-ci-capacity="unknown"]')
      ).not.toBeNull()
    );
    const notice = document.querySelector(
      '[data-ci-capacity="unknown"]'
    ) as HTMLElement;
    expect(notice.textContent).toMatch(/not that none is/i);
    // The read failed; nothing here may state that the tenant has no record.
    expect(
      document.querySelector('[data-ci-capacity="no_machine"]')
    ).toBeNull();
  });

  it("reads the machine roster once, and reads no CI config from the page", async () => {
    // The join is a page-level read; the CI config belongs to the panel inside
    // each disclosure and is not fetched until one is opened.
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      machines: [devenvMachine("m-1", "msi", "d-1")],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(
        httpFetch.mock.calls.filter((c) =>
          String(c[0]).includes("/devenv/machines")
        )
      ).toHaveLength(1)
    );
    expect(
      httpFetch.mock.calls.filter((c) => String(c[0]).includes("/ci-node"))
    ).toHaveLength(0);
  });
});
// ---------------------------------------------------------------------------
// The alert severity rollup — plan
// `2026-08-31-devops-surface-renders-no-alert-signal` Phase 4.
// ---------------------------------------------------------------------------

/**
 * The defect this block guards is not a missing feature; it is a number coord
 * had been publishing on THIS page's own poll for months, discarded by a hook
 * type that declared only `devices`. The steward who read `by_state:
 * {healthy: 8}` — device liveness — concluded the fleet was fine while 170+
 * unresolved criticals stood.
 *
 * So the assertions are about what the page is allowed to SAY:
 *
 *  1. A measured rollup renders as numbers.
 *  2. A rollup coord says it could not read renders UNKNOWN — never `0`.
 *  3. No rollup at all renders UNKNOWN — never `0`. (Absence is not zero.)
 *  4. Counts with no `alerts_scrape_up` flag are MEASURED, not unknown: that
 *     is today's coord, and this page ships ahead of coord's half by design.
 *  5. `pageout.sink_configured: false` is a recorded operator decision, so it
 *     gets one muted line — and absence of the field gets nothing at all.
 */
describe("/admin/coord/devops — the alert severity rollup", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    routerPush.mockReset();
    window.localStorage.clear();
  });

  /** One healthy machine, so nothing in the LIVENESS half explains a badge. */
  function healthyFleet(healthExtras?: Record<string, unknown>) {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [hostSample("d-1", "ok")],
      healthExtras,
    });
  }

  it("renders the severity counts coord already serves", async () => {
    healthyFleet({
      alerts: { critical: 170, warning: 2302, info: 55 },
      alerts_scrape_up: true,
    });

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-health-strip");
    await waitFor(() =>
      expect(
        within(strip).getByTestId("coord-devops-critical-badge")
      ).toHaveTextContent("critical 170")
    );
    expect(
      within(strip).getByTestId("coord-devops-warning-badge")
    ).toHaveTextContent("warning 2302");
    expect(
      within(strip).getByTestId("coord-devops-info-badge")
    ).toHaveTextContent("info 55");
    // The liveness badge is still there and still says liveness: the two
    // rollups sit side by side precisely because they answer different
    // questions, and conflating them is the bug.
    expect(
      within(strip).getByTestId("coord-devops-machines-badge")
    ).toHaveTextContent("machines 1");
    expect(
      within(strip).queryByTestId("coord-devops-alerts-unknown-badge")
    ).toBeNull();
  });

  it("renders UNKNOWN, not 0, when coord says the rollup did not run", async () => {
    // `alerts_scrape_up: false` is coord admitting its query failed. The zeros
    // beside it are the shape of a failure, not a count of alerts.
    healthyFleet({
      alerts: { critical: 0, warning: 0, info: 0 },
      alerts_scrape_up: false,
    });

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-health-strip");
    await waitFor(() =>
      expect(
        within(strip).getByTestId("coord-devops-alerts-unknown-badge")
      ).toHaveTextContent("alerts unknown")
    );
    expect(
      within(strip).queryByTestId("coord-devops-critical-badge")
    ).toBeNull();
    expect(
      within(strip).queryByTestId("coord-devops-warning-badge")
    ).toBeNull();
    expect(within(strip).queryByTestId("coord-devops-info-badge")).toBeNull();
    // The literal failure mode this guards: a `?? 0` puts these on screen.
    expect(strip).not.toHaveTextContent("critical 0");
    expect(strip).not.toHaveTextContent("warning 0");
    expect(strip).not.toHaveTextContent("info 0");
  });

  it("renders UNKNOWN, not 0, when coord serves no rollup at all", async () => {
    // No `alerts` key: a coord that does not publish it, or a read that never
    // landed. Either way the page knows nothing, and must say so.
    healthyFleet();

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-health-strip");
    await waitFor(() =>
      expect(
        within(strip).getByTestId("coord-devops-alerts-unknown-badge")
      ).toHaveTextContent("alerts unknown")
    );
    expect(strip).not.toHaveTextContent("critical 0");
  });

  it("treats counts with no `alerts_scrape_up` flag as MEASURED, not unknown", async () => {
    // Today's coord: it serves the rollup and not the flag, because the flag
    // is the coord half of this plan and lands later. Reading the absent flag
    // as a failure would dash a real number across the whole pre-deploy
    // window — the window this page is REQUIRED to render correctly in.
    healthyFleet({ alerts: { critical: 3364, warning: 13723, info: 283 } });

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-health-strip");
    await waitFor(() =>
      expect(
        within(strip).getByTestId("coord-devops-critical-badge")
      ).toHaveTextContent("critical 3364")
    );
    expect(
      within(strip).queryByTestId("coord-devops-alerts-unknown-badge")
    ).toBeNull();
  });

  it("keeps a MEASURED zero out of the red tone, and still renders it", async () => {
    // A genuine all-clear is a real measurement and must stay on screen — a
    // hidden badge is indistinguishable from a page that cannot count. But
    // red says "somebody must act", and nobody must act on zero.
    healthyFleet({
      alerts: { critical: 0, warning: 0, info: 0 },
      alerts_scrape_up: true,
    });

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-health-strip");
    await waitFor(() =>
      expect(
        within(strip).getByTestId("coord-devops-critical-badge")
      ).toHaveTextContent("critical 0")
    );
    expect(
      within(strip).getByTestId("coord-devops-critical-badge").className
    ).not.toMatch(/red/);
  });

  it("navigates the badge to the alerts list with NO query string", async () => {
    // `/admin/coord/alerts` hydrates no filter from the URL, so a
    // `?severity=critical` badge would land on an unfiltered page under a
    // control that claimed to filter.
    healthyFleet({
      alerts: { critical: 12, warning: 3, info: 0 },
      alerts_scrape_up: true,
    });

    render(<CoordDevOpsPage />);

    const badge = await screen.findByTestId("coord-devops-critical-badge");
    fireEvent.click(badge);
    expect(routerPush).toHaveBeenCalledWith("/admin/coord/alerts");
    expect(String(routerPush.mock.calls[0][0])).not.toContain("?");
  });

  it("says nothing about the pageout sink when coord says nothing", async () => {
    // Absence is UNKNOWN. The page has no posture to report, so it reports no
    // posture — it neither guesses "configured" nor warns.
    healthyFleet({
      alerts: { critical: 1, warning: 0, info: 0 },
      alerts_scrape_up: true,
    });

    render(<CoordDevOpsPage />);

    await screen.findByTestId("coord-devops-health-strip");
    expect(screen.queryByTestId("coord-devops-pageout-note")).toBeNull();
  });

  it("states an unconfigured pageout sink as a decision, not an alarm", async () => {
    // Confirmed with the operator 2026-08-05 across three shipped plans:
    // in-app is the delivery surface and no Slack/email sink is wanted. One
    // muted line, no warning colour, no icon — an alarm on an intended state
    // is how a strip loses its credibility.
    healthyFleet({
      alerts: { critical: 1, warning: 0, info: 0 },
      alerts_scrape_up: true,
      pageout: { sink_configured: false },
    });

    render(<CoordDevOpsPage />);

    const note = await screen.findByTestId("coord-devops-pageout-note");
    expect(note).toHaveTextContent("in-app only");
    expect(note).toHaveTextContent("by decision");
    expect(note.className).toContain("text-muted-foreground");
    expect(note.className).not.toMatch(/red|amber|yellow/);
    expect(
      within(note).getByTestId("coord-devops-pageout-alerts-link")
    ).toHaveAttribute("href", "/admin/coord/alerts");
  });

  it("says nothing about the sink when it IS configured", async () => {
    healthyFleet({
      alerts: { critical: 1, warning: 0, info: 0 },
      alerts_scrape_up: true,
      pageout: { sink_configured: true },
    });

    render(<CoordDevOpsPage />);

    await screen.findByTestId("coord-devops-health-strip");
    expect(screen.queryByTestId("coord-devops-pageout-note")).toBeNull();
  });

  it("adds NO read: the rollup rides the fleet-health poll already made", async () => {
    healthyFleet({
      alerts: { critical: 1, warning: 0, info: 0 },
      alerts_scrape_up: true,
    });

    render(<CoordDevOpsPage />);

    await screen.findByTestId("coord-devops-critical-badge");
    expect(
      httpGet.mock.calls.filter((c) => String(c[0]).includes("fleet/health"))
    ).toHaveLength(1);
    expect(
      httpGet.mock.calls.filter((c) => String(c[0]).includes("/alerts"))
    ).toHaveLength(0);
    expect(
      httpFetch.mock.calls.filter((c) => String(c[0]).includes("/alerts"))
    ).toHaveLength(0);
  });
});
