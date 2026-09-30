/**
 * /admin/coord/computers and /admin/coord/computers/[computerId] — rendered.
 *
 * Plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
 * has-no-resource-model` Phase 5. What is pinned, and why each would go red:
 *
 * 1. **A coord that predates the route (404) is an UNKNOWN banner**, never an
 *    error page and never the "no computers" empty state.
 * 2. **`schema_pending` is the same UNKNOWN**, in both its error and 2xx shapes.
 * 3. **A stale computer reads STALE** on its freshness badge, its lanes say
 *    "last known", and its services say `last known: …` rather than a current
 *    green/red.
 * 4. **A never-measured field renders `unknown`; `not_supported` renders as
 *    such** — in the rendered lane table, not only in the helper.
 * 5. **A detail 404 carrying `computer_not_found` says "Not found"**, while a
 *    bare 404 says UNKNOWN.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const COMPUTER_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

vi.mock("next/navigation", () => ({
  useParams: () => ({ computerId: COMPUTER_ID }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...a: unknown[]) => httpGet(...a) },
}));

import CoordComputersPage from "./page";
import CoordComputerDetailPage from "./[computerId]/page";

function rejection(status: number, body: string): Error {
  return new Error(
    `GET /api/v1/operations/computers failed: ${status} - ${body}`
  );
}

const nowIso = () => new Date(Date.now() - 30_000).toISOString();

function freshComputer(over: Record<string, unknown> = {}) {
  return {
    computer_id: COMPUTER_ID,
    hostname: "merytshost",
    kind: "host",
    os: "linux",
    cpu_cores: 48,
    memory_total_bytes: 64 * 1024 ** 3,
    swap_total_bytes: null,
    freshness: { last_report_at: nowIso(), age_secs: 30, state: "fresh" },
    services_failed: 0,
    lanes: [
      {
        lane: "host",
        sampled_at: nowIso(),
        age_secs: 10,
        headroom: "ok",
        pressure: { ratio: 0.42, basis: "swap" },
        load_1m: 1.5,
        load_5m: null,
        load_15m: 7,
        psi_memory_some_avg60: 3.25,
        measured: { load_15m: "not_supported" },
      },
    ],
    devices: [],
    ci_runners: [],
    ...over,
  };
}

beforeEach(() => {
  httpGet.mockReset();
});

describe("/admin/coord/computers", () => {
  it("renders a coord 404 as an UNKNOWN banner, not an error page or an empty fleet", async () => {
    httpGet.mockRejectedValue(rejection(404, ""));
    render(<CoordComputersPage />);
    const banner = await screen.findByTestId("coord-computers-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("route_unavailable");
    expect(banner.textContent).toContain("UNKNOWN — ");
    expect(banner.textContent).toContain("not an empty fleet");
    expect(screen.queryByTestId("coord-computers-list-empty")).toBeNull();
    expect(screen.getByTestId("coord-computers-list-unknown")).toBeTruthy();
    expect(screen.getByTestId("coord-computers-count-badge").textContent).toBe(
      "computers –"
    );
  });

  it("renders a 503 schema_pending the same way", async () => {
    httpGet.mockRejectedValue(rejection(503, '{"error":"schema_pending"}'));
    render(<CoordComputersPage />);
    const banner = await screen.findByTestId("coord-computers-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("schema_pending");
  });

  it("renders a 2xx schema_pending body as UNKNOWN rather than an empty list", async () => {
    httpGet.mockResolvedValue({ schema_pending: true, computers: [] });
    render(<CoordComputersPage />);
    const banner = await screen.findByTestId("coord-computers-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("schema_pending");
    expect(screen.queryByTestId("coord-computers-list-empty")).toBeNull();
  });

  it("renders a stale computer as STALE, never as healthy", async () => {
    httpGet.mockResolvedValue({
      computers: [
        freshComputer({
          hostname: "msi-wsl",
          services_failed: 1,
          freshness: {
            last_report_at: "2026-09-30T01:00:00Z",
            age_secs: 9000,
            state: "stale",
          },
        }),
      ],
      unattributed_ci_runners: [],
    });
    render(<CoordComputersPage />);
    const row = await screen.findByTestId("coord-computer-row");
    expect(
      within(row).getByTestId("coord-computer-freshness").textContent
    ).toBe("STALE");
    expect(
      within(row)
        .getByTestId("coord-computer-status")
        .getAttribute("data-status")
    ).toBe("stale");
    expect(screen.getByTestId("coord-computers-stale-badge").textContent).toBe(
      "stale 1"
    );
    expect(screen.queryByTestId("coord-computers-failed-badge")).toBeNull();
  });

  it("lists unattributed CI runners instead of dropping them", async () => {
    httpGet.mockResolvedValue({
      computers: [freshComputer()],
      unattributed_ci_runners: [
        { runner_name: "orphan-1", repo: "qontinui-web" },
      ],
    });
    render(<CoordComputersPage />);
    const rows = await screen.findAllByTestId(
      "coord-computers-unattributed-row"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("orphan-1");
    expect(
      screen.getByTestId("coord-computers-unattributed-badge").textContent
    ).toBe("unattributed CI runners 1");
  });
});

describe("/admin/coord/computers/[computerId]", () => {
  it("renders unknown and not-supported readings as words in the lane table", async () => {
    httpGet.mockResolvedValue({
      ...freshComputer(),
      services: [],
      events: [],
      history: [],
      divergence: [],
    });
    render(<CoordComputerDetailPage />);
    const load = await screen.findByTestId("coord-computer-lane-load");
    expect(load.textContent).toBe("1.50 / unknown / not supported");
    expect(screen.getByTestId("coord-computer-lane-psi").textContent).toBe(
      "3.3% / unknown / unknown"
    );
    expect(
      screen.getByTestId("coord-computer-lane-freshness").textContent
    ).toBe("fresh");
    // `swap_total_bytes: null` and no swap sample: unknown, never 0 B.
    expect(screen.getByTestId("coord-computer-lane-swap").textContent).toBe(
      "unknown"
    );
  });

  it("shows a stale computer's lanes as last known and its services as `last known: …`", async () => {
    httpGet.mockResolvedValue({
      ...freshComputer({
        freshness: {
          last_report_at: "2026-09-30T01:00:00Z",
          age_secs: 9000,
          state: "stale",
        },
      }),
      services: [
        {
          unit: "actions.runner.qontinui-web.merytshost-1.service",
          kind: "gh_actions_runner",
          active_state: "failed",
          result: "oom-kill",
          oom_policy: "continue",
        },
      ],
      events: [],
      history: [],
      divergence: [],
    });
    render(<CoordComputerDetailPage />);
    const status = await screen.findByTestId("coord-computer-service-status");
    expect(status.getAttribute("data-status")).toBe("unknown");
    expect(status.textContent).toBe("last known: failed");
    expect(
      screen.getByTestId("coord-computer-lane-freshness").textContent
    ).toBe("STALE");
    expect(screen.getByTestId("coord-computer-lane-last-known")).toBeTruthy();
  });

  it("renders a fresh failed unit red, with its OOM policy in the detail", async () => {
    httpGet.mockResolvedValue({
      ...freshComputer({ services_failed: 1 }),
      services: [
        {
          unit: "actions.runner.qontinui-web.merytshost-1.service",
          kind: "gh_actions_runner",
          active_state: "failed",
          result: "oom-kill",
          oom_policy: "continue",
          memory_peak: null,
        },
      ],
      events: [],
      history: [],
      divergence: [],
    });
    render(<CoordComputerDetailPage />);
    const status = await screen.findByTestId("coord-computer-service-status");
    expect(status.getAttribute("data-status")).toBe("failed");
    expect(status.textContent).toBe("✕ failed");
  });

  it("says Not found for coord's computer_not_found, and UNKNOWN for a bare 404", async () => {
    httpGet.mockRejectedValue(rejection(404, '{"error":"computer_not_found"}'));
    const { unmount } = render(<CoordComputerDetailPage />);
    const nf = await screen.findByTestId("coord-computer-unknown-banner");
    expect(nf.getAttribute("data-issue")).toBe("not_found");
    expect(nf.textContent).toContain("Not found — ");
    unmount();

    httpGet.mockRejectedValue(rejection(404, ""));
    render(<CoordComputerDetailPage />);
    const unknown = await screen.findByTestId("coord-computer-unknown-banner");
    expect(unknown.getAttribute("data-issue")).toBe("route_unavailable");
    expect(unknown.textContent).toContain("UNKNOWN — ");
  });

  it("renders omitted device and CI-runner lists as unknown, not as none attached", async () => {
    const body: Record<string, unknown> = {
      ...freshComputer(),
      services: [],
      events: [],
      divergence: [],
    };
    delete body.devices;
    delete body.ci_runners;
    httpGet.mockResolvedValue(body);
    render(<CoordComputerDetailPage />);
    expect(
      await screen.findByTestId("coord-computer-devices-unknown")
    ).toBeTruthy();
    expect(
      screen.getByTestId("coord-computer-ci-runners-unknown")
    ).toBeTruthy();
    expect(screen.queryByTestId("coord-computer-devices-none")).toBeNull();
  });

  it("renders an omitted service list as unknown, not as no services", async () => {
    httpGet.mockResolvedValue({
      ...freshComputer(),
      events: [],
      divergence: [],
    });
    render(<CoordComputerDetailPage />);
    expect(
      await screen.findByTestId("coord-computer-services-unknown")
    ).toBeTruthy();
    expect(screen.queryByTestId("coord-computer-services-none")).toBeNull();
  });
});
