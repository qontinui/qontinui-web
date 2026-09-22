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
  act,
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

// The two live streams are out of scope here (they have their own tests) and
// one of them opens a WebSocket. The device-status stream is subscribed by the
// PAGE and handed to `FleetOverview` and the strip's credential rollup; the
// symbol-claims stream is held inside `FleetOverview`. Both are stubbed to a
// seeded, empty stream so the machine list under test is built from the fleet
// payload and coord's device list alone.
//
// The device-status half is seedable rather than permanently empty: its rows
// carry the runner's own `details` bag, which is where the credential posture
// of plan `2026-09-12-runner-loads-with-an-expired-coord-credential-and-…`
// arrives. Tests that do not seed it get exactly the empty stream this stub
// always was.
//
// `deviceStatusStream.byHostname` is swappable: the real hook REPLACES its Map
// on every update, and a test that needs to prove the page re-derives on a new
// identity assigns a fresh Map here and re-renders.
// `error` and `seeded` are settable too, for the tests that prove a failed or
// pending stream read is named as its own cause rather than as the runners'
// silence.
const deviceStatusRows = new Map<string, unknown>();
const deviceStatusStream: {
  byHostname: Map<string, unknown>;
  error: string | null;
  seeded: boolean;
  everSeeded: boolean;
} = {
  byHostname: deviceStatusRows,
  error: null,
  seeded: true,
  everSeeded: true,
};
vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({
    byHostname: deviceStatusStream.byHostname,
    connected: false,
    error: deviceStatusStream.error,
    seeded: deviceStatusStream.seeded,
    everSeeded: deviceStatusStream.everSeeded,
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

// The per-row Drain lever is admin-gated (`CoordAdminOnly` -> `useAuth`), and
// this page mounts no `AuthProvider`. Stubbed to an admin so the control that
// Phase 4b adds is the one under test; the non-admin arm is asserted in
// `components/operations/DeviceDrainControl.test.tsx`.
const authState = { isCoordAdmin: true };
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

// Toasts are a drain write's only other output; nothing here asserts on them,
// but sonner's real module mounts a portal this page has no business holding.
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import CoordDevOpsPage from "./page";
import * as fleetResources from "@/components/operations/fleetResources";
import {
  DeviceCrossLinks,
  deviceStateBadgeVariant,
} from "@/components/operations/FleetHealthSummary";
import { useFleetHealth } from "@/components/operations/useFleetHealth";

/**
 * Coord wire shape — mirrors `DeviceHealthSnapshot` (fleet_health.rs).
 *
 * `extra` carries the fields a given test is about (today: `credential_dark`),
 * spread verbatim so a fixture can also serve a coord that omits them — which
 * is the UNKNOWN case, and the one the credential tests below turn on.
 */
function coordDevice(
  id: string,
  hostname: string,
  state?: string,
  extra?: Record<string, unknown>
) {
  return { device_id: id, hostname, state, ...(extra ?? {}) };
}

/**
 * One `coord.device_status` row as the stream serves it, carrying the runner's
 * open `details` bag. Only the fields `MachineCard` reads are populated.
 */
function deviceStatusRow(
  deviceId: string,
  hostname: string,
  details: Record<string, unknown>
) {
  return {
    device_id: deviceId,
    hostname,
    current_task: null,
    current_repo: null,
    current_branch: null,
    free_text: null,
    details,
    tenant_id: null,
    updated_at: new Date().toISOString(),
  };
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
   * The rest of the `/fleet/health` body beside `devices` — coord's
   * `conditions` rollup and `credential_dark_scrape_up`. Spread verbatim, so
   * a fixture can serve a coord that predates any of them.
   */
  healthExtras?: Record<string, unknown>;
  /**
   * What `GET /operations/fleet/drain` answers with. `undefined` means the
   * route is NOT served — the shape of a coord that predates the plan's Phase
   * 4a read route, which every row must render as UNKNOWN rather than calm.
   */
  drain?: unknown;
  /**
   * What `GET /operations/fleet/worktree-slots` answers with (Phase 3).
   * `undefined` defaults to a zero-device payload — benign for every test
   * that predates this section; the Worktree-slots describe block below
   * overrides it per case.
   */
  worktreeSlots?: unknown;
}

function mockRoutes(fixture: Fixture) {
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("resource-samples")) {
      return Promise.resolve({ latest: fixture.samples, history: [] });
    }
    if (u.includes("worktree-slots")) {
      return Promise.resolve(
        fixture.worktreeSlots ?? {
          tenant_id: "t-1",
          device_count: 0,
          truncated: false,
          device_cap: 100,
          census_window_secs: 900,
          devices: [],
        }
      );
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
    if (u.includes("/fleet/drain")) {
      if (fixture.drain === undefined) {
        // A coord that serves no drain read. NOT an empty drain map — the
        // console must say UNKNOWN, which is what makes the deploy window
        // safe.
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve("not found"),
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(fixture.drain),
      });
    }
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
    deviceStatusRows.clear();
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
    // Card-wide, MINUS the drain block. Phase 4b of
    // `2026-09-01-device-drain-does-not-reach-agent-session-spawning` renders a
    // DISABLED drain button with a stated reason when the row's drain state
    // could not be read — that is a rule the plan requires and
    // `DeviceDrainControl.test.tsx` asserts, and it is about the READ rather
    // than about the machine. The rule THIS test guards is narrower and
    // unchanged: nothing in the CI-capacity area may render as a dead toggle,
    // because a dead toggle there IS a claim about the machine.
    const deadControls = Array.from(
      ghost.querySelectorAll("[disabled]")
    ).filter((el) => el.closest('[data-testid="device-drain"]') === null);
    expect(deadControls).toEqual([]);
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
// The Conditions panel — plan
// `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
// Phase 8.
// ---------------------------------------------------------------------------

/**
 * The panel replaced the alert-severity badges, both links into the deleted
 * `/admin/coord/alerts` page and the pageout-sink note. What it is allowed to
 * SAY is the whole contract (the derivation's own cases are in
 * `components/operations/fleetConditions.test.ts`):
 *
 *  1. "Nothing unhandled" only on a MEASURED zero (`scrape_up` and
 *     `unclaimed == 0`).
 *  2. An absent `conditions` block is "Unknown — coord does not report
 *     conditions yet", never zero.
 *  3. `scrape_up: false` is "Unknown — health query failed".
 *  4. "Waiting on you" leads to the operator question queue.
 *  5. No alerts-page link, no severity badges, no pageout note, and no read.
 */
describe("/admin/coord/devops — the Conditions panel", () => {
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

  function conditions(overrides: Record<string, unknown> = {}) {
    return {
      open: 0,
      claimed: 0,
      unclaimed: 0,
      unclaimed_oldest_age_secs: null,
      unclaimed_by_domain: {
        merge_train: 0,
        dev_ops: 0,
        cleanup: 0,
        return_to_main: 0,
        pr_fix: 0,
        red_main_fix: 0,
        gate_owner: 0,
        plan_owner: 0,
      },
      awaiting_operator: 0,
      awaiting_operator_question_ids: [],
      awaiting_operator_alerts: 0,
      awaiting_operator_unasked: 0,
      awaiting_operator_answered_uncleared: 0,
      settings_in_effect: [],
      settings_in_effect_count: 0,
      scrape_up: true,
      ...overrides,
    };
  }

  it("says 'Nothing unhandled' only on a measured zero", async () => {
    healthyFleet({ conditions: conditions({ open: 4, claimed: 4 }) });
    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-conditions-strip");
    await waitFor(() => expect(strip).toHaveTextContent("Nothing unhandled"));
    expect(strip).toHaveAttribute("data-health-level", "green");
    expect(
      within(strip).getByTestId("coord-devops-conditions-unclaimed-badge")
    ).toHaveTextContent("unclaimed 0");
    expect(
      screen.getByTestId("coord-devops-conditions-no-settings")
    ).toBeInTheDocument();
  });

  it("shows the unclaimed count, the oldest age and the per-owner breakdown", async () => {
    healthyFleet({
      conditions: conditions({
        open: 9,
        claimed: 2,
        unclaimed: 7,
        unclaimed_oldest_age_secs: 3 * 3600 + 5 * 60,
        unclaimed_by_domain: {
          merge_train: 5,
          dev_ops: 2,
          cleanup: 0,
          return_to_main: 0,
          pr_fix: 0,
          red_main_fix: 0,
          gate_owner: 0,
          plan_owner: 0,
        },
      }),
    });
    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-conditions-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent("7 conditions no agent is handling")
    );
    expect(strip).not.toHaveTextContent("Nothing unhandled");
    expect(
      within(strip).getByTestId("coord-devops-conditions-oldest-badge")
    ).toHaveTextContent("oldest 3h 5m");
    const domains = screen.getByTestId("coord-devops-conditions-domains");
    expect(
      within(domains).getByTestId("coord-devops-conditions-domain-merge_train")
    ).toHaveTextContent("merge train 5");
    expect(
      within(domains).getByTestId("coord-devops-conditions-domain-dev_ops")
    ).toHaveTextContent("dev ops 2");
    // A zero domain is not listed.
    expect(
      within(domains).queryByTestId("coord-devops-conditions-domain-cleanup")
    ).toBeNull();
  });

  it("renders an absent conditions block as UNKNOWN, never as zero", async () => {
    // A coord that predates the rollup: no `conditions` key at all.
    healthyFleet();
    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-conditions-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent(
        "Unknown — coord does not report conditions yet"
      )
    );
    expect(strip).not.toHaveTextContent("Nothing unhandled");
    expect(strip).toHaveAttribute("data-health-level", "amber");
    // No count badge claims a number coord never served.
    expect(
      within(strip).queryByTestId("coord-devops-conditions-unclaimed-badge")
    ).toBeNull();
  });

  it("renders scrape_up: false as 'health query failed', with no counts", async () => {
    healthyFleet({
      conditions: conditions({
        open: null,
        claimed: null,
        unclaimed: null,
        awaiting_operator: null,
        scrape_up: false,
      }),
    });
    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-conditions-strip");
    await waitFor(() =>
      expect(strip).toHaveTextContent("Unknown — health query failed")
    );
    expect(strip).not.toHaveTextContent("Nothing unhandled");
    expect(
      within(strip).queryByTestId("coord-devops-conditions-unclaimed-badge")
    ).toBeNull();
  });

  it("links 'waiting on you' to the question that is waiting", async () => {
    healthyFleet({
      conditions: conditions({
        awaiting_operator: 1,
        awaiting_operator_question_ids: [
          "11111111-2222-3333-4444-555555555555",
        ],
      }),
    });
    render(<CoordDevOpsPage />);

    const badge = await screen.findByTestId(
      "coord-devops-conditions-awaiting-badge"
    );
    expect(badge).toHaveTextContent("waiting on you 1");
    expect(screen.getByTestId("coord-devops-conditions-strip")).toHaveAttribute(
      "data-health-level",
      "red"
    );
    fireEvent.click(badge);
    expect(routerPush).toHaveBeenCalledWith(
      "/admin/coord/questions/11111111-2222-3333-4444-555555555555"
    );
  });

  it("links several waiting questions to the queue", async () => {
    healthyFleet({
      conditions: conditions({
        awaiting_operator: 2,
        awaiting_operator_question_ids: ["q-1", "q-2"],
      }),
    });
    render(<CoordDevOpsPage />);

    const badge = await screen.findByTestId(
      "coord-devops-conditions-awaiting-badge"
    );
    fireEvent.click(badge);
    expect(routerPush).toHaveBeenCalledWith("/admin/coord/questions");
  });

  it("lists the deliberate settings in effect, by name", async () => {
    healthyFleet({
      conditions: conditions({
        settings_in_effect: [
          {
            alert_id: 11,
            kind: "kill_switch_fired",
            since: "2026-09-18T09:00:00Z",
          },
          {
            alert_id: 12,
            kind: "fleet_device_drained",
            since: "2026-09-18T10:00:00Z",
          },
          {
            alert_id: 13,
            kind: "fleet_device_drained",
            since: "2026-09-18T10:30:00Z",
          },
        ],
        settings_in_effect_count: 3,
      }),
    });
    render(<CoordDevOpsPage />);

    const settings = await screen.findByTestId(
      "coord-devops-conditions-settings"
    );
    expect(
      within(settings).getByTestId("coord-devops-conditions-setting-11")
    ).toHaveTextContent("merge kill switch on");
    // Two drains are two settings: keyed on the row id, not the kind.
    expect(
      within(settings).getByTestId("coord-devops-conditions-setting-12")
    ).toHaveTextContent("machine drained");
    expect(
      within(settings).getByTestId("coord-devops-conditions-setting-13")
    ).toHaveTextContent("machine drained");
    // A setting is context, not a fault: the verdict stays calm.
    expect(screen.getByTestId("coord-devops-conditions-strip")).toHaveAttribute(
      "data-health-level",
      "green"
    );
  });

  it("reads 'not yet asked' from coord's exact count, and does not go green", async () => {
    healthyFleet({
      conditions: conditions({
        awaiting_operator: 0,
        awaiting_operator_alerts: 2,
        awaiting_operator_unasked: 2,
        awaiting_operator_answered_uncleared: 0,
      }),
    });
    render(<CoordDevOpsPage />);

    const badge = await screen.findByTestId(
      "coord-devops-conditions-unasked-badge"
    );
    expect(badge).toHaveTextContent("not yet asked 2");
    const strip = screen.getByTestId("coord-devops-conditions-strip");
    expect(strip).toHaveAttribute("data-health-level", "amber");
    expect(strip).toHaveTextContent("2 operator alerts not yet asked");
    expect(strip).not.toHaveTextContent("Nothing unhandled");
  });

  it("does not call an answered, uncleared alert unasked", async () => {
    healthyFleet({
      conditions: conditions({
        awaiting_operator: 0,
        awaiting_operator_alerts: 1,
        awaiting_operator_unasked: 0,
        awaiting_operator_answered_uncleared: 1,
      }),
    });
    render(<CoordDevOpsPage />);

    const badge = await screen.findByTestId(
      "coord-devops-conditions-answered-uncleared-badge"
    );
    expect(badge).toHaveTextContent("answered, not clear 1");
    expect(
      screen.queryByTestId("coord-devops-conditions-unasked-badge")
    ).toBeNull();
    const strip = screen.getByTestId("coord-devops-conditions-strip");
    expect(strip).toHaveTextContent(
      "1 answered, waiting for coord to see it clear"
    );
    expect(strip).not.toHaveTextContent("not yet asked");
  });

  it("uses neutral wording, and never green, on a coord without the exact counts", async () => {
    healthyFleet({
      conditions: conditions({
        awaiting_operator: 0,
        awaiting_operator_alerts: 2,
        awaiting_operator_unasked: undefined,
        awaiting_operator_answered_uncleared: undefined,
      }),
    });
    render(<CoordDevOpsPage />);

    const badge = await screen.findByTestId(
      "coord-devops-conditions-beyond-questions-badge"
    );
    expect(badge).toHaveTextContent("open beyond questions 2");
    const strip = screen.getByTestId("coord-devops-conditions-strip");
    expect(strip).toHaveAttribute("data-health-level", "amber");
    expect(strip).toHaveTextContent(
      "2 operator alerts open beyond the questions waiting on you"
    );
    expect(strip).not.toHaveTextContent("not yet asked");
    expect(strip).not.toHaveTextContent("Nothing unhandled");
  });

  it("says which read failed when coord reports scrape_up: false", async () => {
    healthyFleet({
      conditions: { scrape_up: false, unavailable_reason: "agent_work" },
    });
    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId("coord-devops-conditions-strip");
    await waitFor(() => expect(strip).toHaveTextContent("agent_work"));
  });

  it("names the settings coord's capped list left out", async () => {
    healthyFleet({
      conditions: conditions({
        settings_in_effect: [
          {
            alert_id: 7,
            kind: "fleet_device_drained",
            since: "2026-09-18T10:00:00Z",
            summary: "Device msi drained by operator",
          },
        ],
        settings_in_effect_count: 4,
      }),
    });
    render(<CoordDevOpsPage />);

    expect(
      await screen.findByTestId("coord-devops-conditions-settings-more")
    ).toHaveTextContent("+3 more");
    expect(
      screen
        .getByTestId("coord-devops-conditions-setting-7")
        .getAttribute("title")
    ).toContain("Device msi drained by operator");
  });

  it("says the settings count is unknown rather than hiding a possible cap", async () => {
    healthyFleet({
      conditions: conditions({
        settings_in_effect: [
          {
            alert_id: 9,
            kind: "kill_switch_fired",
            since: "2026-09-18T10:00:00Z",
          },
        ],
        settings_in_effect_count: null,
      }),
    });
    render(<CoordDevOpsPage />);

    expect(
      await screen.findByTestId(
        "coord-devops-conditions-settings-count-unknown"
      )
    ).toHaveTextContent("(count unknown)");
    expect(
      screen.queryByTestId("coord-devops-conditions-settings-more")
    ).toBeNull();
  });

  it("renders no severity badges, no pageout note and no alerts-page link", async () => {
    healthyFleet({
      conditions: conditions(),
      // A coord still serving the old rollup and pageout posture: neither is
      // rendered any more.
      alerts: { critical: 170, warning: 2302, info: 55 },
      alerts_scrape_up: true,
      pageout: { sink_configured: false },
    });
    const { container } = render(<CoordDevOpsPage />);

    await screen.findByTestId("coord-devops-conditions-panel");
    for (const id of [
      "coord-devops-critical-badge",
      "coord-devops-warning-badge",
      "coord-devops-info-badge",
      "coord-devops-alerts-unknown-badge",
      "coord-devops-pageout-note",
      "coord-devops-pageout-alerts-link",
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(container.querySelector('a[href="/admin/coord/alerts"]')).toBeNull();
  });

  it("adds NO read: the panel rides the fleet-health poll already made", async () => {
    healthyFleet({ conditions: conditions() });

    render(<CoordDevOpsPage />);

    await screen.findByTestId("coord-devops-conditions-unclaimed-badge");
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

/**
 * The Drain / Undrain lever — plan
 * `2026-09-01-device-drain-does-not-reach-agent-session-spawning` Phase 4b.
 *
 * These assert the WIRING the phase is about, end to end through the page: the
 * drain read reaching every row, the coord device id being the key each row
 * acts on, and every failure of that read rendering UNKNOWN rather than a calm
 * "not drained". The control's own behaviour is asserted in
 * `components/operations/DeviceDrainControl.test.tsx`.
 */
describe("/admin/coord/devops — machine drain", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    routerPush.mockReset();
    authState.isCoordAdmin = true;
    window.localStorage.clear();
  });

  const DEVICE = "11111111-2222-3333-4444-555555555555";
  const CI_DEVICE = "99999999-8888-7777-6666-555555555555";

  /** A drain map as coord's `GET /coord/fleet/drain` serves it. */
  function drainMap(deviceId: string, until: string) {
    return {
      drained: {
        [deviceId]: {
          until,
          reason: "rebuilding the runner",
          drained_by: "jspinak@gmail.com",
          drained_at: "2026-08-31T10:00:00Z",
        },
      },
    };
  }

  function drainBlock(hostname: string): HTMLElement {
    const card = document.querySelector(
      `[data-hostname="${hostname}"]`
    ) as HTMLElement;
    expect(card).not.toBeNull();
    const block = card.querySelector(
      '[data-testid="device-drain"]'
    ) as HTMLElement;
    expect(block).not.toBeNull();
    return block;
  }

  it("labels each row with the coord device id it will actually drain", async () => {
    // The plan's Risks section: `spaceship` and `gh-runner-spaceship-wsl` are
    // SEPARATE coord registrations of one box, and draining the wrong one gets
    // no effect and no error. Two rows, two ids, each named on its own row.
    mockRoutes({
      devices: [
        coordDevice(DEVICE, "spaceship", "healthy"),
        coordDevice(CI_DEVICE, "gh-runner-spaceship-wsl", "healthy"),
      ],
      runners: [runner("spaceship")],
      samples: [],
      drain: { drained: {} },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(
        document.querySelector('[data-hostname="spaceship"]')
      ).not.toBeNull()
    );
    const workstation = within(drainBlock("spaceship")).getByTestId(
      "device-drain-target"
    );
    const ciRunner = within(drainBlock("gh-runner-spaceship-wsl")).getByTestId(
      "device-drain-target"
    );
    expect(workstation).toHaveAttribute("data-device-id", DEVICE);
    expect(ciRunner).toHaveAttribute("data-device-id", CI_DEVICE);
    // The identity is coord's, spelled out in full on the row rather than
    // abbreviated — it is the field that tells the two registrations apart.
    expect(workstation.textContent).toContain(DEVICE);
    expect(ciRunner.textContent).toContain("gh-runner-spaceship-wsl");
  });

  it("renders a drained row with until, by and reason", async () => {
    mockRoutes({
      devices: [coordDevice(DEVICE, "spaceship", "healthy")],
      runners: [runner("spaceship")],
      samples: [],
      // Far enough out that the assertion cannot race the clock.
      drain: drainMap(DEVICE, "2099-01-01T00:00:00Z"),
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(drainBlock("spaceship")).toHaveAttribute(
        "data-device-drain",
        "drained"
      )
    );
    const block = drainBlock("spaceship");
    expect(block.textContent).toContain("Drained until");
    expect(block.textContent).toContain("jspinak@gmail.com");
    expect(block.textContent).toContain("rebuilding the runner");
    // …and the lever offered is the release, not a second drain.
    expect(
      within(block).getByTestId("device-drain-undrain")
    ).toBeInTheDocument();
  });

  it("renders UNKNOWN — never 'not drained' — when coord serves no drain read", async () => {
    // The deploy window: this console is ahead of coord's Phase 4a route, so
    // the read 404s. `[policy: unknown-must-not-render-as-a-default]`.
    mockRoutes({
      devices: [coordDevice(DEVICE, "spaceship", "healthy")],
      runners: [runner("spaceship")],
      samples: [],
      drain: undefined,
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(drainBlock("spaceship")).toHaveAttribute(
        "data-device-drain",
        "unknown"
      )
    );
    const block = drainBlock("spaceship");
    expect(block.textContent).toContain("Drain state unknown");
    expect(block.textContent).not.toContain("Not drained");
    // A control that cannot read the state does not offer to change it.
    expect(within(block).getByTestId("device-drain-open")).toBeDisabled();
    expect(
      within(block).getByTestId("device-drain-disabled-reason").textContent
    ).toContain("404");
  });

  it("disables the lever, with a reason, on a row coord names no device for", async () => {
    // A host that reached the list through the runner inventory alone. The
    // drain map is keyed by device UUID and this row has none, so there is
    // nothing it could drain — and an enabled control here would be silently
    // inert, which is the failure the plan's keying note exists to prevent.
    mockRoutes({
      devices: [],
      runners: [runner("orphan")],
      samples: [],
      drain: { drained: {} },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="orphan"]')).not.toBeNull()
    );
    const block = drainBlock("orphan");
    expect(block).toHaveAttribute("data-device-drain", "no_device");
    expect(within(block).getByTestId("device-drain-open")).toBeDisabled();
    expect(
      within(block).getByTestId("device-drain-disabled-reason").textContent
    ).toContain("no device row for this host");
    // Nothing claims a target it cannot act on.
    expect(
      within(block).queryByTestId("device-drain-target")
    ).not.toBeInTheDocument();
  });

  it("reads the drain map ONCE for the whole list, never once per row", async () => {
    mockRoutes({
      devices: [
        coordDevice(DEVICE, "spaceship", "healthy"),
        coordDevice("22222222-2222-3333-4444-555555555555", "msi", "healthy"),
        coordDevice("33333333-2222-3333-4444-555555555555", "ghost", "healthy"),
      ],
      runners: [runner("spaceship"), runner("msi")],
      samples: [],
      drain: { drained: {} },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector('[data-hostname="ghost"]')).not.toBeNull()
    );
    expect(
      httpFetch.mock.calls.filter((c) => String(c[0]).includes("/fleet/drain"))
    ).toHaveLength(1);
  });

  it("keeps the drain state readable for a non-admin, who gets no lever", async () => {
    // Hiding a mutation control must never hide the FACT that a machine is out
    // of the fleet — that fact is why an idle-looking row is idle.
    authState.isCoordAdmin = false;
    mockRoutes({
      devices: [coordDevice(DEVICE, "spaceship", "healthy")],
      runners: [runner("spaceship")],
      samples: [],
      drain: drainMap(DEVICE, "2099-01-01T00:00:00Z"),
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(drainBlock("spaceship")).toHaveAttribute(
        "data-device-drain",
        "drained"
      )
    );
    const block = drainBlock("spaceship");
    expect(block.textContent).toContain("Drained until");
    expect(
      within(block).queryByTestId("device-drain-undrain")
    ).not.toBeInTheDocument();
  });
});

/**
 * **Can each machine still reach coord?** — plan
 * `2026-09-12-runner-loads-with-an-expired-coord-credential-and-tells-nobody`
 * Phase 5.
 *
 * The incident: a runner restored an EXPIRED coord device JWT at boot, could
 * not self-refresh, and told nobody. It answered every probe, so coord read it
 * `healthy`; its 164 session rows carried 5 `claudeCodeSessionId`s, and a
 * device whose sessions are all unbound is otherwise invisible in this console
 * — its absence read as "no sessions", not as "a machine that cannot reach us".
 *
 * The assertion that matters most is the THIRD one. A device on a runner or a
 * coord that reports no credential at all must render UNKNOWN and must not be
 * worded or coloured as if it were `live`; getting that wrong reproduces the
 * exact defect this phase exists to close, on a page built to report it.
 */
describe("/admin/coord/devops — the coord-credential axis", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    routerPush.mockReset();
    deviceStatusRows.clear();
    deviceStatusStream.byHostname = deviceStatusRows;
    deviceStatusStream.error = null;
    deviceStatusStream.seeded = true;
    deviceStatusStream.everSeeded = true;
    window.localStorage.clear();
  });

  it.each([
    ["has failed", "HTTP 500", true, "HTTP 500"],
    ["has not seeded yet", null, false, "not loaded yet"],
  ])(
    "names a device-status stream that %s (no full read ever succeeded) as its own cause, not as the runners' silence",
    async (_name, error, seeded, cause) => {
      deviceStatusStream.error = error;
      deviceStatusStream.seeded = seeded;
      deviceStatusStream.everSeeded = false;
      mockRoutes({
        devices: [
          coordDevice("d-1", "msi", "healthy", {
            credential_dark: { dark: false },
          }),
        ],
        runners: [runner("msi")],
        samples: [],
        healthExtras: { credential_dark_scrape_up: true },
      });

      render(<CoordDevOpsPage />);

      const strip = await screen.findByTestId(
        "coord-devops-credential-unknown-badge"
      );
      // The count stands — the machine really is unmeasured on this read…
      expect(strip).toHaveTextContent("credential unknown 1");
      // …but the tooltip says the READ failed, not that the runner was silent.
      const title = strip.getAttribute("title") ?? "";
      expect(title).toContain(
        `No full device-status read has succeeded yet (${cause}); runner reports that arrived since may be incomplete`
      );
      expect(title).not.toMatch(/Neither coord's dark scan nor/);
      expect(title).not.toMatch(/may be stale/);
    }
  );

  it("says a stream that WAS fed but whose latest read failed may be stale, not unreadable", async () => {
    // Rows are being served from an earlier read; one re-seed then failed.
    // `msi` still reports nothing of its own, so it stays counted unknown —
    // but "no full read has succeeded" would be false, because one did.
    deviceStatusRows.set(
      "msi",
      deviceStatusRow("d-1", "msi", { current_task: "x" })
    );
    deviceStatusStream.error = "HTTP 502";
    deviceStatusStream.seeded = true;
    deviceStatusStream.everSeeded = true;
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy", {
          credential_dark: { dark: false },
        }),
      ],
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId(
      "coord-devops-credential-unknown-badge"
    );
    expect(strip).toHaveTextContent("credential unknown 1");
    const title = strip.getAttribute("title") ?? "";
    expect(title).toContain(
      "The last device-status read failed (HTTP 502); runner reports may be stale"
    );
    expect(title).not.toMatch(/No full device-status read/);
  });

  /** The credential badge on one machine's row, or null. */
  function credentialBadge(hostname: string): HTMLElement | null {
    return (
      document
        .querySelector(`[data-hostname="${hostname}"]`)
        ?.querySelector("[data-operations-coord-credential]") ?? null
    );
  }

  it("renders a device that REPORTED a healthy credential as live", async () => {
    // The runner published `coord_credential.ok = true` on its heartbeat, so
    // something actually measured this machine. That — not coord's roster
    // stamp — is what earns the calm badge.
    deviceStatusRows.set(
      "msi",
      deviceStatusRow("d-1", "msi", { coord_credential: { ok: true } })
    );
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy", {
          credential_dark: { dark: false },
        }),
      ],
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(credentialBadge("msi")).toHaveAttribute(
        "data-operations-coord-credential",
        "live"
      )
    );
    const badge = credentialBadge("msi") as HTMLElement;
    expect(badge).toHaveAttribute(
      "data-operations-coord-credential-measured",
      "true"
    );
    expect(badge).toHaveTextContent("credential live");
    // Calm: no red, no ✕, and no dark count on the strip.
    expect(badge.innerHTML).not.toMatch(/bg-red-/);
    expect(badge).not.toHaveTextContent("✕");
    expect(
      screen.queryByTestId("coord-devops-credential-dark-badge")
    ).not.toBeInTheDocument();
    // …and the strip AGREES with the row: the rollup resolves `msi` from the
    // same heartbeat bag, so it is counted measured-and-ok — not `credential
    // unknown 1`, which is what the strip said while it could see coord's join
    // alone.
    expect(
      screen.queryByTestId("coord-devops-credential-unknown-badge")
    ).not.toBeInTheDocument();
  });

  // A report goes stale by TIME alone, and the runner that stopped reporting is
  // the one that sends no frame. So the strip must re-resolve on the page's own
  // clock: here the stream stays silent and fleet-health starts failing (which
  // pins `devices`), and the only thing that moves is time.
  it("flips a healthy report to UNKNOWN once it ages past its bound, with no new data", async () => {
    // `setTimeout` stays real so `waitFor`'s timeout still fires. Faking
    // `setInterval` stops `waitFor`'s own polling, so every `waitFor` below
    // settles through its MutationObserver: only wait on DOM changes here.
    vi.useFakeTimers({
      toFake: ["Date", "setInterval", "clearInterval"],
    });
    try {
      vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
      deviceStatusRows.set(
        "msi",
        deviceStatusRow("d-1", "msi", { coord_credential: { ok: true } })
      );
      mockRoutes({
        devices: [
          coordDevice("d-1", "msi", "healthy", {
            credential_dark: { dark: false },
          }),
        ],
        runners: [runner("msi")],
        samples: [],
        healthExtras: { credential_dark_scrape_up: true },
      });

      render(<CoordDevOpsPage />);

      await waitFor(() =>
        expect(credentialBadge("msi")).toHaveAttribute(
          "data-operations-coord-credential",
          "live"
        )
      );
      expect(
        screen.queryByTestId("coord-devops-credential-unknown-badge")
      ).not.toBeInTheDocument();

      // Coord's health read goes down: `devices` keeps its last identity.
      httpGet.mockImplementation((url: unknown) =>
        String(url).includes("fleet/health")
          ? Promise.reject(new Error("HTTP 503"))
          : Promise.resolve({ latest: [], history: [] })
      );

      // Past the 900 s fallback bound, by the page's 15 s tick.
      await act(async () => {
        vi.advanceTimersByTime(915_000);
      });

      await waitFor(() =>
        expect(
          screen.getByTestId("coord-devops-credential-unknown-badge")
        ).toHaveTextContent("credential unknown 1")
      );
      expect(credentialBadge("msi")).toHaveAttribute(
        "data-operations-coord-credential",
        "unknown"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // C5. Coord's `{dark: false}` is a roster stamp, not a measurement:
  // `join_credential_dark` writes it onto every device its
  // `coord_credential.ok = 'false'` scan did not select, which includes every
  // device whose runner published no credential at all. Rendering one of those
  // `credential live` on a calm badge is this plan's own incident, committed
  // by the page built to report it.
  it("renders a device coord merely did not name as UNKNOWN, not live", async () => {
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy", {
          // The scan RAN and this device was not in its result set — which
          // says nothing whatever about its credential.
          credential_dark: { dark: false },
        }),
      ],
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() => expect(credentialBadge("msi")).not.toBeNull());
    const badge = credentialBadge("msi") as HTMLElement;
    expect(badge).toHaveAttribute(
      "data-operations-coord-credential",
      "unknown"
    );
    expect(badge).toHaveAttribute(
      "data-operations-coord-credential-measured",
      "false"
    );
    expect(badge).not.toHaveTextContent("credential live");
    expect(badge.innerHTML).toMatch(/bg-amber-/);
    // And the strip counts it as unmeasured rather than as an all-clear.
    expect(
      screen.getByTestId("coord-devops-credential-unknown-badge")
    ).toHaveTextContent("credential unknown 1");
    expect(
      screen.queryByTestId("coord-devops-credential-dark-badge")
    ).not.toBeInTheDocument();
  });

  it("renders a dark device in red, names the runner's reason, and counts it on the strip", async () => {
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy", {
          credential_dark: {
            dark: true,
            reason:
              "device-JWT re-mint failed (coord non-2xx or persist error) and the existing JWT is expired",
          },
        }),
      ],
      // Coord still reads this box HEALTHY — the whole point. The two axes
      // must be able to disagree on one row.
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() => expect(credentialBadge("msi")).not.toBeNull());
    const badge = credentialBadge("msi") as HTMLElement;
    expect(badge).toHaveAttribute("data-operations-coord-credential", "dark");
    // R3: red, because a person must act — and the colourblind-safe glyph.
    expect(badge.innerHTML).toMatch(/bg-red-/);
    expect(badge).toHaveTextContent("✕");
    // The runner's own reason is one hover away, not a trip to the alert row.
    expect(
      badge.querySelector("[data-status-kind='dark']")?.getAttribute("title")
    ).toContain("re-mint failed");
    // Liveness is untouched: coord still reaches this machine.
    expect(
      document
        .querySelector('[data-hostname="msi"]')
        ?.querySelector('[data-coord-state="healthy"]')
    ).not.toBeNull();
    // And the strip carries the count, in red, linking to the question queue
    // where coord asks the operator about each dark credential (the alerts
    // page it used to open is deleted).
    const strip = screen.getByTestId("coord-devops-credential-dark-badge");
    expect(strip).toHaveTextContent("credential dark 1");
    fireEvent.click(strip);
    expect(routerPush).toHaveBeenCalledWith("/admin/coord/questions");
  });

  it("renders a device whose report carries NO credential as UNKNOWN, never as healthy", async () => {
    // The coord this fixture serves predates the join (or its read failed):
    // no `credential_dark` on the device, and no flag on the body. This is the
    // shape every device had before the plan, and the shape a device on an
    // older runner build keeps having afterwards.
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
    });

    render(<CoordDevOpsPage />);

    await waitFor(() => expect(credentialBadge("msi")).not.toBeNull());
    const badge = credentialBadge("msi") as HTMLElement;
    expect(badge).toHaveAttribute(
      "data-operations-coord-credential",
      "unknown"
    );
    expect(badge).toHaveAttribute(
      "data-operations-coord-credential-measured",
      "false"
    );
    expect(badge).toHaveTextContent("credential unknown");
    // The load-bearing negative: NOT live, and not painted calm. Amber is the
    // ignorance floor — a statement about our knowledge, not about the box.
    expect(badge).not.toHaveTextContent("credential live");
    expect(badge.innerHTML).toMatch(/bg-amber-/);
    expect(
      badge.querySelector("[data-status-kind='unknown']")?.getAttribute("title")
    ).toMatch(/UNKNOWN, not healthy/);
    // …and the strip says so too, as a count of unmeasured machines rather
    // than a zero.
    expect(
      screen.getByTestId("coord-devops-credential-unknown-badge")
    ).toHaveTextContent("credential unknown 1");
    expect(
      screen.queryByTestId("coord-devops-credential-dark-badge")
    ).not.toBeInTheDocument();
  });

  it("says so differently when coord tells us its credential join did not run", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      // Coord served the flag and it is FALSE: its own read failed, so the
      // null beside it is coord's gap rather than a fact about the machine.
      healthExtras: { credential_dark_scrape_up: false },
    });

    render(<CoordDevOpsPage />);

    const strip = await screen.findByTestId(
      "coord-devops-credential-unknown-badge"
    );
    // "Coord could not read it" and "nobody has reported one" are different
    // facts and the badge words them differently — same discipline the
    // Conditions panel's unknown states follow.
    expect(strip.getAttribute("title")).toMatch(/could not read/);
    expect(strip.getAttribute("title")).not.toMatch(/never reported/);
  });

  it("reports the finer posture, and its `since`, once a runner publishes one", async () => {
    // Forward compatibility, and the arm the boolean wire cannot reach: the
    // runner's own `details.coord_credential` bag (plan Phase 1, landing in
    // qontinui-runner) distinguishes `unrefreshable` — every automatic rung
    // has failed — from a generic dark, and is the only source of `since`.
    deviceStatusRows.set(
      "msi",
      deviceStatusRow("d-1", "msi", {
        coord_credential: {
          ok: false,
          posture: "unrefreshable",
          since: "2026-09-12T03:54:26Z",
          reason: "slot JWT is expired/opaque — cannot self-refresh",
        },
      })
    );
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy", {
          // Coord's coarser join says dark; the runner's own report is finer
          // and wins, without contradicting it.
          credential_dark: { dark: true },
        }),
      ],
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() => expect(credentialBadge("msi")).not.toBeNull());
    const badge = credentialBadge("msi") as HTMLElement;
    expect(badge).toHaveAttribute(
      "data-operations-coord-credential",
      "unrefreshable"
    );
    expect(badge).toHaveTextContent("credential unrefreshable");
    expect(badge.innerHTML).toMatch(/bg-red-/);
    // `since <ts>`, rendered only because a producer published one.
    expect(
      badge.querySelector("[data-operations-coord-credential-since]")
    ).not.toBeNull();
    expect(badge).toHaveTextContent(/since /);
  });

  it("renders the credential axis on EVERY row, including a coord-only device", async () => {
    // A device that reaches this page through coord's health read alone is
    // exactly the population the incident hid in. It gets the badge too.
    deviceStatusRows.set(
      "msi",
      deviceStatusRow("d-1", "msi", { coord_credential: { ok: true } })
    );
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy", {
          credential_dark: { dark: false },
        }),
        coordDevice("d-2", "ghost", "healthy"),
      ],
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() => expect(credentialBadge("ghost")).not.toBeNull());
    expect(credentialBadge("ghost")).toHaveAttribute(
      "data-operations-coord-credential",
      "unknown"
    );
    expect(credentialBadge("msi")).toHaveAttribute(
      "data-operations-coord-credential",
      "live"
    );
    // The strip and the rows AGREE. The page owns the one device-status
    // subscription and hands it to both, so the rollup sees `msi`'s
    // affirmative report exactly as its row does: `msi` is measured (ok), and
    // only `ghost` — which nothing measured — is counted unknown. This used to
    // read `credential unknown 2`, the strip under-claiming a machine its own
    // row showed live.
    expect(
      screen.getByTestId("coord-devops-credential-unknown-badge")
    ).toHaveTextContent("credential unknown 1");
    expect(
      screen.queryByTestId("coord-devops-credential-dark-badge")
    ).not.toBeInTheDocument();
  });

  it("re-derives the strip when the stream delivers a NEW map after mount", async () => {
    // The hook replaces its Map on every update. The strip's rollup is a
    // `useMemo` keyed on that identity, so a report that arrives AFTER the
    // first render must move the count — the fleet-health read has not
    // changed, and a memo that ignored `byHostname` would stay stale here.
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy", {
          credential_dark: { dark: false },
        }),
      ],
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    const { rerender } = render(<CoordDevOpsPage />);

    expect(
      await screen.findByTestId("coord-devops-credential-unknown-badge")
    ).toHaveTextContent("credential unknown 1");

    deviceStatusStream.byHostname = new Map<string, unknown>([
      [
        "msi",
        deviceStatusRow("d-1", "msi", { coord_credential: { ok: true } }),
      ],
    ]);
    rerender(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-devops-credential-unknown-badge")
      ).not.toBeInTheDocument()
    );
    expect(credentialBadge("msi")).toHaveAttribute(
      "data-operations-coord-credential",
      "live"
    );
    expect(
      screen.queryByTestId("coord-devops-credential-dark-badge")
    ).not.toBeInTheDocument();
  });

  it("does not let a row borrow the report of a different device sharing its hostname", async () => {
    // A re-paired box: coord holds `d-new` and `d-old`, both `msi`. The stream
    // row under `msi` is `d-new`'s, and it reports healthy. The machine row's
    // coord join is last-writer-wins, so with this order it shows `d-old` —
    // which published nothing, and must not wear `d-new`'s `live`.
    deviceStatusRows.set(
      "msi",
      deviceStatusRow("d-new", "msi", { coord_credential: { ok: true } })
    );
    mockRoutes({
      devices: [
        coordDevice("d-new", "msi", "healthy", {
          credential_dark: { dark: false },
        }),
        coordDevice("d-old", "msi", "healthy", {
          credential_dark: { dark: false },
        }),
      ],
      runners: [runner("msi")],
      samples: [],
      healthExtras: { credential_dark_scrape_up: true },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() => expect(credentialBadge("msi")).not.toBeNull());
    expect(credentialBadge("msi")).toHaveAttribute(
      "data-operations-coord-credential",
      "unknown"
    );
    // The strip counts both devices: `d-new` measured, `d-old` not.
    expect(
      screen.getByTestId("coord-devops-credential-unknown-badge")
    ).toHaveTextContent("credential unknown 1");
  });
});

describe("/admin/coord/devops — a CI-runner registration with the mirror down", () => {
  it("still names the drain's real scope, from coord's own capability read", async () => {
    // The CI-runner mirror GET is not mocked here, so it fails: the card must
    // not depend on it. Coord serves `ci_runner_status` as a string only for
    // a device carrying the `ci_runner` capability.
    const host = "gh-runner-msi-wsl@qontinui/qontinui-runner";
    mockRoutes({
      devices: [
        coordDevice("d-gh", host, "healthy", { ci_runner_status: "idle" }),
        coordDevice("d-ws", "msi", "healthy", { ci_runner_status: null }),
      ],
      runners: [runner("msi")],
      samples: [],
      drain: { drained: {} },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(document.querySelector(`[data-hostname="${host}"]`)).not.toBeNull()
    );
    const gh = document.querySelector(
      `[data-hostname="${host}"]`
    ) as HTMLElement;
    expect(
      gh.querySelector('[data-testid="ci-runner-drain-scope"]')
    ).not.toBeNull();
    const ws = document.querySelector('[data-hostname="msi"]') as HTMLElement;
    expect(
      ws.querySelector('[data-testid="ci-runner-drain-scope"]')
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Worktree slots — plan `2026-09-21-worktree-slots-devops-dashboard-view.md`
// Phase 3.
// ---------------------------------------------------------------------------

/**
 * One device row as `GET /operations/fleet/worktree-slots` serves it
 * (coord's `GET /coord/fleet/worktree-slots`, passed through untouched).
 */
function worktreeSlotDevice(
  deviceId: string,
  hostname: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    device_id: deviceId,
    hostname,
    active_worktrees: 0,
    max_worktrees: 8,
    census_recent_rows: 12,
    occupants: { shown: 0, total: 0, truncated: false, rows: [] },
    ...overrides,
  };
}

describe("/admin/coord/devops — Worktree slots (Phase 3)", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    window.localStorage.clear();
  });

  it("renders a device with occupants, expandable on demand", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      worktreeSlots: {
        tenant_id: "t-1",
        device_count: 1,
        truncated: false,
        device_cap: 100,
        census_window_secs: 900,
        devices: [
          worktreeSlotDevice("d-1", "msi", {
            active_worktrees: 3,
            occupants: {
              shown: 3,
              total: 3,
              truncated: false,
              rows: [
                {
                  repo: "qontinui-web",
                  worktree_path: "agent-worktrees/abc/qontinui-web",
                  age_secs: 412.5,
                },
              ],
            },
          }),
        ],
      },
    });

    render(<CoordDevOpsPage />);

    const row = await screen.findByTestId("fleet-worktree-slots-row");
    expect(row).toHaveAttribute("data-device-id", "d-1");
    expect(row).toHaveAttribute("data-worktree-slots-state", "known");
    expect(row).toHaveTextContent("3/8");
    // Collapsed by default — no occupant row text on screen yet.
    expect(row).not.toHaveTextContent("qontinui-web");

    const trigger = within(row).getByRole("button", {
      name: /Occupants \(3\)/i,
    });
    fireEvent.click(trigger);
    await waitFor(() => expect(row).toHaveTextContent("qontinui-web"));
    expect(row).toHaveTextContent("agent-worktrees/abc/qontinui-web");
  });

  it("renders a genuinely idle device as 0/8, not unknown", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      worktreeSlots: {
        tenant_id: "t-1",
        device_count: 1,
        truncated: false,
        device_cap: 100,
        census_window_secs: 900,
        devices: [worktreeSlotDevice("d-1", "msi")],
      },
    });

    render(<CoordDevOpsPage />);

    const row = await screen.findByTestId("fleet-worktree-slots-row");
    expect(row).toHaveAttribute("data-worktree-slots-state", "known");
    expect(row).toHaveTextContent("0/8");
    expect(
      within(row).queryByTestId("fleet-worktree-slots-unknown-cell")
    ).toBeNull();
  });

  it("renders census_recent_rows: 0 as unknown, never a healthy 0/8", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "stale-box", "healthy")],
      runners: [runner("stale-box")],
      samples: [],
      worktreeSlots: {
        tenant_id: "t-1",
        device_count: 1,
        truncated: false,
        device_cap: 100,
        census_window_secs: 900,
        devices: [
          worktreeSlotDevice("d-1", "stale-box", { census_recent_rows: 0 }),
        ],
      },
    });

    render(<CoordDevOpsPage />);

    const row = await screen.findByTestId("fleet-worktree-slots-row");
    expect(row).toHaveAttribute("data-worktree-slots-state", "unknown");
    const cell = within(row).getByTestId("fleet-worktree-slots-unknown-cell");
    expect(cell).toHaveTextContent("unknown");
    // Never the raw ratio, which would read as a healthy, idle machine.
    expect(row).not.toHaveTextContent("0/8");
    expect(
      screen.getByTestId("fleet-worktree-slots-unknown-badge")
    ).toHaveTextContent("1 unknown");
  });

  it("badges a device at cap, with no client-derived colour verdict", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      worktreeSlots: {
        tenant_id: "t-1",
        device_count: 1,
        truncated: false,
        device_cap: 100,
        census_window_secs: 900,
        devices: [
          worktreeSlotDevice("d-1", "msi", {
            active_worktrees: 8,
            occupants: { shown: 8, total: 8, truncated: false, rows: [] },
          }),
        ],
      },
    });

    render(<CoordDevOpsPage />);

    const row = await screen.findByTestId("fleet-worktree-slots-row");
    expect(row).toHaveTextContent("8/8");
    expect(
      within(row).getByTestId("fleet-worktree-slots-at-cap")
    ).toHaveTextContent("at cap");
    expect(
      screen.getByTestId("fleet-worktree-slots-at-cap-badge")
    ).toHaveTextContent("1 at cap");
  });

  it("renders a truncated occupants list with a +N more note", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
      worktreeSlots: {
        tenant_id: "t-1",
        device_count: 1,
        truncated: false,
        device_cap: 100,
        census_window_secs: 900,
        devices: [
          worktreeSlotDevice("d-1", "msi", {
            active_worktrees: 8,
            occupants: {
              shown: 5,
              total: 8,
              truncated: true,
              rows: Array.from({ length: 5 }, (_, i) => ({
                repo: `repo-${i}`,
                worktree_path: `agent-worktrees/x/repo-${i}`,
                age_secs: 60,
              })),
            },
          }),
        ],
      },
    });

    render(<CoordDevOpsPage />);

    const row = await screen.findByTestId("fleet-worktree-slots-row");
    fireEvent.click(
      within(row).getByRole("button", { name: /Occupants \(8\)/i })
    );
    await waitFor(() => expect(row).toHaveTextContent("repo-0"));
    expect(row).toHaveTextContent("+3 more (showing 5 of 8)");
  });

  it("keeps a device registered but absent from the payload as its own unknown row", async () => {
    // `d-2` is in coord's device list (the spine) but the worktree-slots
    // route names only `d-1` — truncated out by the cap, or simply never
    // observed. It must still get a row, never silently vanish.
    mockRoutes({
      devices: [
        coordDevice("d-1", "msi", "healthy"),
        coordDevice("d-2", "ghost", "healthy"),
      ],
      runners: [runner("msi"), runner("ghost")],
      samples: [],
      worktreeSlots: {
        tenant_id: "t-1",
        device_count: 1,
        truncated: false,
        device_cap: 100,
        census_window_secs: 900,
        devices: [worktreeSlotDevice("d-1", "msi")],
      },
    });

    render(<CoordDevOpsPage />);

    await waitFor(() =>
      expect(screen.getAllByTestId("fleet-worktree-slots-row")).toHaveLength(2)
    );
    const ghostRow = document.querySelector(
      '[data-testid="fleet-worktree-slots-row"][data-device-id="d-2"]'
    ) as HTMLElement;
    expect(ghostRow).not.toBeNull();
    expect(ghostRow).toHaveAttribute("data-worktree-slots-state", "unknown");
    expect(ghostRow).toHaveTextContent("not reported");
  });

  it("shows a friendly notice, not coord's raw body, when the coord route isn't deployed yet", async () => {
    // Phase 1 (coord's `GET /coord/fleet/worktree-slots`) ships in a
    // separate qontinui-coord PR and had not landed as of this PR — every
    // real read of this route legitimately 404s until it does. `httpClient`
    // formats that as `GET <url> failed: 404 - <coord's raw body>`; the
    // banner must show the friendly reading, never that raw string verbatim.
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
    });
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("worktree-slots")) {
        return Promise.reject(
          new Error(
            'GET /api/v1/operations/fleet/worktree-slots failed: 404 - {"error":"NOT_FOUND"}'
          )
        );
      }
      if (u.includes("resource-samples")) {
        return Promise.resolve({ latest: [], history: [] });
      }
      if (u.includes("fleet/health")) {
        return Promise.resolve({
          devices: [coordDevice("d-1", "msi", "healthy")],
        });
      }
      return Promise.reject(new Error(`unexpected GET ${u}`));
    });

    render(<CoordDevOpsPage />);

    const banner = await screen.findByTestId("fleet-worktree-slots-error");
    expect(banner).toHaveTextContent(
      "coord does not serve the fleet worktree-slots route yet"
    );
    // Never coord's raw, doubly-JSON-encoded transport string.
    expect(banner).not.toHaveTextContent("NOT_FOUND");
    expect(banner).not.toHaveTextContent("failed: 404");
    // The device list stays the spine even with no data — unknown, not gone.
    const row = await screen.findByTestId("fleet-worktree-slots-row");
    expect(row).toHaveAttribute("data-worktree-slots-state", "unknown");
  });

  it("still shows the transport detail for a genuine failure, not the route-unavailable notice", async () => {
    mockRoutes({
      devices: [coordDevice("d-1", "msi", "healthy")],
      runners: [runner("msi")],
      samples: [],
    });
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("worktree-slots")) {
        return Promise.reject(
          new Error(
            "GET /api/v1/operations/fleet/worktree-slots failed: 502 - coord is not reachable"
          )
        );
      }
      if (u.includes("resource-samples")) {
        return Promise.resolve({ latest: [], history: [] });
      }
      if (u.includes("fleet/health")) {
        return Promise.resolve({
          devices: [coordDevice("d-1", "msi", "healthy")],
        });
      }
      return Promise.reject(new Error(`unexpected GET ${u}`));
    });

    render(<CoordDevOpsPage />);

    const banner = await screen.findByTestId("fleet-worktree-slots-error");
    expect(banner).toHaveTextContent("coord is not reachable");
    expect(banner).not.toHaveTextContent("does not serve");
  });
});
