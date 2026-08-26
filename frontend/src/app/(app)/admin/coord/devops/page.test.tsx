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
import { render, screen, waitFor, within } from "@testing-library/react";

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
}

function mockRoutes(fixture: Fixture) {
  httpGet.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("resource-samples")) {
      return Promise.resolve({ latest: fixture.samples, history: [] });
    }
    if (u.includes("fleet/health")) {
      return Promise.resolve({ devices: fixture.devices });
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

  it("reintroduces no SATURATED_AT / WARN_AT-shaped threshold constant", () => {
    // `fleetResources.ts` deleted those deliberately and says why: the floors
    // coord admits on are byte floors on columns the pressure ratio does not
    // divide by, so a "threshold equivalent" is a number nobody can compute
    // without inventing it. This asserts the module's exported surface, so a
    // reintroduction fails here rather than in review.
    const offenders = Object.keys(fleetResources).filter((k) =>
      /SATURAT|WARN_AT|THRESHOLD/i.test(k)
    );
    expect(offenders).toEqual([]);
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
