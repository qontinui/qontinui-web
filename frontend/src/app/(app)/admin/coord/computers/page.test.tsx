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
 *    bare 404 says UNKNOWN — and a not-found AFTER a good read clears the
 *    retained lanes and services rather than showing them beside it.
 * 6. **A failed refresh keeps the rows, says so, and lets them go stale**:
 *    after 900 s with no good read, a computer coord last called fresh reads
 *    STALE by itself.
 * 7. **Each list row's GPUs render in its expanded capacity block** — model
 *    and VRAM per GPU, `none` for a measured `[]` — and only one row's block
 *    is open at a time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const COMPUTER_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

vi.mock("next/navigation", () => ({
  useParams: () => ({ computerId: COMPUTER_ID }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  // The computer reads go through `httpClient.fetch` (the typed client's
  // `fetchComputers` / `fetchComputer`). Every case here answers as `httpGet`'s
  // parsed body, so a fetch is served from it as a 200 Response, and a
  // rejection passes through exactly as `get`'s did.
  httpClient: {
    fetch: async (url: string, init?: unknown) =>
      new Response(JSON.stringify(await httpGet(url, init)), { status: 200 }),
  },
}));

import {
  computerFx,
  detailFx,
  DEVICE_ID,
  OTHER_COMPUTER_ID,
  laneFx,
  listFx,
  serviceFx,
} from "./__fixtures__/coordComputers";
import CoordComputersPage from "./page";
import CoordComputerDetailPage from "./[computerId]/page";

function rejection(status: number, body: string): Error {
  return new Error(
    `GET /api/v1/operations/computers failed: ${status} - ${body}`
  );
}

// Every body below is shaped by `__fixtures__/coordComputers.ts`, which
// mirrors coord's `computers.rs` serialization field for field.
beforeEach(() => {
  httpGet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
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

  it("renders coord's 503 schema_pending the same way", async () => {
    httpGet.mockRejectedValue(
      rejection(
        503,
        '{"error":"schema_pending","code":"computers_schema_pending","missing":"coord.computers"}'
      )
    );
    render(<CoordComputersPage />);
    const banner = await screen.findByTestId("coord-computers-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("schema_pending");
  });

  it("renders a stale computer as STALE, never as healthy", async () => {
    httpGet.mockResolvedValue(
      listFx([
        computerFx({
          hostname: "msi-wsl",
          services_failed: 1,
          report_age_secs: 9000,
        }),
      ])
    );
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

  it("keeps the rows after a failed refresh, says so, and lets them go stale after 900 s", async () => {
    // Only the interval and the clock are faked: testing-library's own
    // polling runs on real setTimeout.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    httpGet.mockResolvedValueOnce(listFx([computerFx()]));
    httpGet.mockRejectedValue(
      rejection(504, '{"detail":"timeout waiting for coord"}')
    );
    render(<CoordComputersPage />);
    const row = await screen.findByTestId("coord-computer-row");
    expect(
      within(row).getByTestId("coord-computer-freshness").textContent
    ).toBe("fresh");

    // The next poll (30 s) fails: the row stays, a banner says the read failed.
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    const banner = await screen.findByTestId("coord-computers-unknown-banner");
    expect(banner.textContent).toContain(
      "The figures below are from the last good read and are not current."
    );
    expect(screen.getAllByTestId("coord-computer-row")).toHaveLength(1);
    expect(
      screen.getByTestId("coord-computers-unattributed-none").textContent
    ).toContain("at the last good read");

    // 900 s later with no good read, coord's frozen `age_secs: 30` has aged
    // past its 900 s window, and the row says so without any new data.
    await act(async () => {
      vi.advanceTimersByTime(900_000);
    });
    const staleRow = screen.getByTestId("coord-computer-row");
    expect(
      within(staleRow).getByTestId("coord-computer-freshness").textContent
    ).toBe("STALE");
    expect(
      within(staleRow)
        .getByTestId("coord-computer-status")
        .getAttribute("data-status")
    ).toBe("stale");
  });

  it("lists live devices on no computer and labels the count as reporting computers", async () => {
    httpGet.mockResolvedValue(
      listFx([computerFx()], {
        unreported_devices: [
          {
            device_id: "bbbbbbbb-0000-4000-8000-000000000001",
            hostname: "merytshost",
            role: null,
            state: "healthy",
            last_seen_at: null,
            served_git_sha: "32952dc570f8aaaa",
            served_git_sha_at: null,
          },
          {
            device_id: "bbbbbbbb-0000-4000-8000-000000000002",
            hostname: "other",
            role: "build",
            state: "healthy",
            last_seen_at: null,
            served_git_sha: null,
            served_git_sha_at: null,
          },
        ],
      })
    );
    render(<CoordComputersPage />);
    const rows = await screen.findAllByTestId("coord-computers-unreported-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("merytshost");
    expect(rows[0].textContent).toContain("role not set");
    expect(rows[0].textContent).toContain("32952dc57");
    expect(rows[1].textContent).toContain("role build");
    expect(rows[1].textContent).toContain("build not published");
    expect(screen.getByTestId("coord-computers-count-label").textContent).toBe(
      "1 computers reporting · 2 live devices on no computer"
    );
  });

  it("renders no unreported devices as measured none", async () => {
    httpGet.mockResolvedValue(listFx([computerFx()]));
    render(<CoordComputersPage />);
    expect(
      await screen.findByTestId("coord-computers-unreported-none")
    ).toBeTruthy();
  });

  it("reads `unreported_read_ok: false` and an absent field as UNKNOWN, not none", async () => {
    httpGet.mockResolvedValue(
      listFx([computerFx()], {
        unreported_devices: null,
        unreported_read_ok: false,
      })
    );
    const { unmount: unmount2 } = render(<CoordComputersPage />);
    expect(
      await screen.findByTestId("coord-computers-unreported-unknown")
    ).toBeTruthy();
    expect(screen.queryByTestId("coord-computers-unreported-none")).toBeNull();
    expect(
      screen.getByTestId("coord-computers-count-label").textContent
    ).toContain("UNKNOWN");

    unmount2();
    // A list present without an explicit `unreported_read_ok: true` is not a measurement.
    httpGet.mockResolvedValue(
      listFx([computerFx()], {
        unreported_devices: [],
        unreported_read_ok: false,
      })
    );
    const { unmount: unmount3 } = render(<CoordComputersPage />);
    expect(
      await screen.findByTestId("coord-computers-unreported-unknown")
    ).toBeTruthy();
    unmount3();

    // An older coord that omits both fields: still UNKNOWN, never an empty section.
    const old = listFx([computerFx()]);
    delete old.unreported_devices;
    delete old.unreported_read_ok;
    httpGet.mockResolvedValue(old);
    render(<CoordComputersPage />);
    expect(
      await screen.findByTestId("coord-computers-unreported-unknown")
    ).toBeTruthy();
    expect(screen.queryByTestId("coord-computers-unreported-none")).toBeNull();
  });

  it("lists unattributed CI runners instead of dropping them", async () => {
    httpGet.mockResolvedValue(
      listFx([computerFx()], {
        unattributed_ci_runners: [
          {
            device_id: "aaaaaaaa-0000-4000-8000-000000000001",
            hostname: "gh-runner-orphan-1@qontinui/qontinui-web",
            runner_name: "orphan-1",
            host_key: "orphan-1",
            repo: "qontinui/qontinui-web",
            ci_runner_status: "offline",
            last_seen_at: null,
            registrar_fresh: true,
            service_unit: null,
            service_active_state: null,
          },
        ],
      })
    );
    render(<CoordComputersPage />);
    const rows = await screen.findAllByTestId(
      "coord-computers-unattributed-row"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("orphan-1");
    expect(rows[0].textContent).toContain("offline");
    expect(
      screen.getByTestId("coord-computers-unattributed-badge").textContent
    ).toBe("unattributed CI runners 1");
  });

  it("lists a runner two computers claim as ambiguous, naming every claimant", async () => {
    const a = computerFx({ hostname: "merytshost" });
    const b = computerFx({
      computer_id: OTHER_COMPUTER_ID,
      hostname: "msi-wsl",
    });
    httpGet.mockResolvedValue(
      listFx([a, b], {
        ambiguous_ci_runners: [
          {
            device_id: "aaaaaaaa-0000-4000-8000-000000000002",
            hostname: "gh-runner-clone-1@qontinui/qontinui-web",
            runner_name: "clone-1",
            host_key: "clone-1",
            repo: "qontinui/qontinui-web",
            ci_runner_status: "idle",
            last_seen_at: null,
            registrar_fresh: true,
            service_unit: null,
            service_active_state: null,
            claimed_by: [
              COMPUTER_ID,
              OTHER_COMPUTER_ID,
              "99999999-0000-4000-8000-000000000009",
            ],
          },
        ],
      })
    );
    render(<CoordComputersPage />);
    const row = await screen.findByTestId("coord-computers-ambiguous-row");
    expect(
      within(row).getByTestId("coord-computers-ambiguous-claimants").textContent
    ).toBe("claimed by merytshost, msi-wsl, computer 99999999");
    expect(
      screen.getByTestId("coord-computers-ambiguous-badge").textContent
    ).toBe("ambiguous CI runners 1");
  });

  it("reads coord's `registrar_read_ok: false` as unattributed UNKNOWN, not none", async () => {
    httpGet.mockResolvedValue(
      listFx([computerFx()], { registrar_read_ok: false })
    );
    render(<CoordComputersPage />);
    expect(
      await screen.findByTestId("coord-computers-unattributed-unknown")
    ).toBeTruthy();
    expect(
      screen.queryByTestId("coord-computers-unattributed-none")
    ).toBeNull();
    expect(
      screen.getByTestId("coord-computers-unattributed-badge").textContent
    ).toBe("unattributed CI runners –");
    expect(
      screen.getByTestId("coord-computers-ambiguous-unknown")
    ).toBeTruthy();
    expect(screen.queryByTestId("coord-computers-ambiguous-none")).toBeNull();
    expect(
      screen.getByTestId("coord-computers-ambiguous-badge").textContent
    ).toBe("ambiguous CI runners –");
  });
});

describe("/admin/coord/computers — the gpus capacity per row", () => {
  it("renders each row's GPUs, in the expanded row's capacity block", async () => {
    httpGet.mockResolvedValue(
      listFx([
        computerFx({
          hostname: "merytshost",
          capacity: {
            cpu_cores: 48,
            memory_total_bytes: 64 * 1024 ** 3,
            swap_total_bytes: 8 * 1024 ** 3,
            disk_total_bytes: 1024 ** 4,
            gpus: [
              {
                vendor: "nvidia",
                model: "NVIDIA GeForce RTX 4090",
                vram_bytes: 24 * 1024 ** 3,
                driver: "550.120",
                compute_capability: "8.9",
              },
            ],
          },
        }),
        computerFx({
          computer_id: OTHER_COMPUTER_ID,
          hostname: "msi-wsl",
          capacity: {
            cpu_cores: 16,
            memory_total_bytes: 32 * 1024 ** 3,
            swap_total_bytes: 0,
            disk_total_bytes: 1024 ** 4,
            gpus: [],
          },
        }),
      ])
    );
    render(<CoordComputersPage />);
    const rows = await screen.findAllByTestId("coord-computer-row");
    expect(rows).toHaveLength(2);
    // Collapsed rows render no detail, so no GPU is shown before a click.
    expect(screen.queryByTestId("coord-computer-capacity")).toBeNull();

    fireEvent.click(within(rows[0]).getByRole("button", { expanded: false }));
    const gpuCap = await screen.findByTestId("coord-computer-capacity");
    expect(within(gpuCap).getByTestId("coord-computer-gpu-0").textContent).toBe(
      "gpuNVIDIA GeForce RTX 4090 · 24.0 GB"
    );
    expect(
      screen.getByTestId("coord-computer-gpus-note").textContent
    ).toContain("another vendor's GPU may be present and unlisted");

    fireEvent.click(within(rows[1]).getByRole("button", { expanded: false }));
    // One row expands at a time: the second row's capacity replaces the first.
    const caps = screen.getAllByTestId("coord-computer-capacity");
    expect(caps).toHaveLength(1);
    expect(within(caps[0]).getByTestId("coord-computer-gpus").textContent).toBe(
      "gpusnone"
    );
    expect(within(caps[0]).queryByTestId("coord-computer-gpu-0")).toBeNull();
    expect(screen.getByTestId("coord-computer-gpus-note").textContent).toBe(
      "GPUs: measured none."
    );
  });
});

describe("/admin/coord/computers/[computerId] — the gpus capacity", () => {
  async function capacityOf(gpus: unknown) {
    httpGet.mockResolvedValue(
      detailFx({
        capacity: {
          cpu_cores: 48,
          memory_total_bytes: 64 * 1024 ** 3,
          swap_total_bytes: 8 * 1024 ** 3,
          disk_total_bytes: 1024 ** 4,
          gpus,
        },
      })
    );
    render(<CoordComputerDetailPage />);
    const cap = await screen.findByTestId("coord-computer-capacity");
    return { cap, note: screen.getByTestId("coord-computer-gpus-note") };
  }

  it("renders null gpus as unknown — not reported, never none or 0", async () => {
    const { cap, note } = await capacityOf(null);
    expect(within(cap).getByTestId("coord-computer-gpus").textContent).toBe(
      "gpusunknown"
    );
    expect(note.textContent).toBe("GPUs not reported — UNKNOWN, not none.");
  });

  it("renders a measured [] as none", async () => {
    const { cap, note } = await capacityOf([]);
    expect(within(cap).getByTestId("coord-computer-gpus").textContent).toBe(
      "gpusnone"
    );
    expect(note.textContent).toBe("GPUs: measured none.");
  });

  it("renders each GPU's model and VRAM", async () => {
    const { cap, note } = await capacityOf([
      {
        vendor: "nvidia",
        model: "Example GPU A",
        vram_bytes: 32 * 1024 ** 3,
        driver: "999.10",
        compute_capability: "12.0",
      },
      {
        vendor: "nvidia",
        model: "Example GPU B",
        vram_bytes: null,
        driver: null,
        compute_capability: null,
      },
    ]);
    expect(within(cap).queryByTestId("coord-computer-gpus")).toBeNull();
    expect(within(cap).getByTestId("coord-computer-gpu-0").textContent).toBe(
      "gpuExample GPU A · 32.0 GB"
    );
    expect(note.textContent).toContain(
      "gpu 0 (Example GPU A): vendor: nvidia · driver: 999.10 · compute capability: 12.0"
    );
    expect(note.textContent).toContain("gpu 1 (Example GPU B)");
    expect(note.textContent).toContain("may be present and unlisted");
    expect(within(cap).getByTestId("coord-computer-gpu-1").textContent).toBe(
      "gpuExample GPU B · VRAM unknown"
    );
  });

  it("renders identical GPUs as one grouped badge", async () => {
    const same = {
      vendor: "nvidia",
      model: "Example GPU A",
      vram_bytes: 32 * 1024 ** 3,
      driver: "999.10",
      compute_capability: "12.0",
    };
    const { cap, note } = await capacityOf([same, same, same, same]);
    expect(within(cap).getByTestId("coord-computer-gpu-0").textContent).toBe(
      "gpu4 × Example GPU A · 32.0 GB"
    );
    expect(within(cap).queryByTestId("coord-computer-gpu-1")).toBeNull();
    expect(note.textContent).toContain("gpus 0–3 (Example GPU A)");
    expect(note.textContent).not.toContain("gpu 1 ");
  });

  it("keeps a distinct GPU apart from a group, under its own index", async () => {
    const a = {
      vendor: "nvidia",
      model: "Example GPU A",
      vram_bytes: 32 * 1024 ** 3,
      driver: "999.10",
      compute_capability: "12.0",
    };
    const b = { ...a, model: "Example GPU B" };
    const { cap, note } = await capacityOf([a, a, b]);
    const group = within(cap).getByTestId("coord-computer-gpu-0");
    expect(group.textContent).toBe("gpu2 × Example GPU A · 32.0 GB");
    expect(group.getAttribute("title")).toContain("gpus 0, 1 · vendor: nvidia");
    expect(within(cap).queryByTestId("coord-computer-gpu-1")).toBeNull();
    expect(within(cap).getByTestId("coord-computer-gpu-2").textContent).toBe(
      "gpuExample GPU B · 32.0 GB"
    );
    expect(note.textContent).toContain("gpus 0, 1 (Example GPU A)");
    expect(note.textContent).toContain("; gpu 2 (Example GPU B)");
  });

  it("renders a gpus value it cannot read as unknown, not as a count", async () => {
    const { cap, note } = await capacityOf({ count: 1 });
    expect(within(cap).getByTestId("coord-computer-gpus").textContent).toBe(
      "gpusunknown"
    );
    // Told apart from null in words, and floored at amber (R3), not calm.
    expect(note.textContent).toContain("cannot read");
    expect(within(cap).getByTestId("coord-computer-gpus").className).toContain(
      "amber"
    );
  });
});

describe("/admin/coord/computers/[computerId]", () => {
  it("renders unknown and not-supported readings as words in the lane table", async () => {
    httpGet.mockResolvedValue(
      detailFx({
        lanes: [
          laneFx({
            load_1m: 1.5,
            load_5m: null,
            load_15m: 7,
            psi_memory_some_avg60: 3.25,
            psi_cpu_some_avg60: null,
            psi_io_some_avg60: null,
            swap_total_bytes: null,
            swap_used_bytes: null,
            swap_ratio: null,
            measured: { load_15m: "not_supported" },
          }),
        ],
      })
    );
    render(<CoordComputerDetailPage />);
    const load = await screen.findByTestId("coord-computer-lane-load");
    expect(load.textContent).toBe("1.50 / unknown / not supported");
    expect(screen.getByTestId("coord-computer-lane-psi").textContent).toBe(
      "3.3% / unknown / unknown"
    );
    expect(
      screen.getByTestId("coord-computer-lane-freshness").textContent
    ).toBe("fresh");
    // No swap total and no swap sample: unknown, never 0 B.
    expect(screen.getByTestId("coord-computer-lane-swap").textContent).toBe(
      "unknown"
    );
    // Coord's lane `pressure` is the {ratio, basis} object.
    expect(screen.getByTestId("coord-computer-lane-pressure").textContent).toBe(
      "13% · ok"
    );
  });

  it("draws a host lane's swap climb as the sparkline's second line, and none on a wsl lane", async () => {
    // Plan 2026-11-09-devops-swap-axis-did-not-surface-tmpfs-exhaustion-on-nilan
    // Phase 2 follow-up: this page draws the Dev Ops strip's sparkline and
    // gets its second (swap) line by the same rule (`sparklinePoints`).
    const point = (
      sampled_at: string,
      pressure: number,
      swap_ratio: number | null
    ) => ({
      sampled_at,
      load_1m: null,
      load_5m: null,
      load_15m: null,
      mem_available_bytes: null,
      swap_ratio,
      pressure,
      psi_memory_some_avg60: null,
      psi_cpu_some_avg60: null,
      psi_io_some_avg60: null,
    });
    const climb = [
      point("2026-11-09T18:00:00Z", 0.8, 0.62),
      point("2026-11-09T18:15:00Z", 0.81, 0.91),
      point("2026-11-09T18:30:00Z", 0.815, 0.9999),
    ];
    httpGet.mockResolvedValue(
      detailFx({
        lanes: [
          laneFx({ pressure: { ratio: 0.815, basis: "commit" } }),
          laneFx({ lane: "wsl", lane_instance: "Ubuntu" }),
        ],
        history: [
          {
            device_id: DEVICE_ID,
            lane: "host",
            lane_instance: null,
            points: climb,
          },
          {
            device_id: DEVICE_ID,
            lane: "wsl",
            lane_instance: "Ubuntu",
            points: climb,
          },
        ],
      })
    );
    render(<CoordComputerDetailPage />);
    const rows = await screen.findAllByTestId("coord-computer-lane-row");
    const chart = (lane: string) => {
      const row = rows.find((r) => r.getAttribute("data-lane") === lane);
      return within(row as HTMLElement).getByTestId(
        "coord-computer-lane-sparkline"
      );
    };
    expect(chart("host").getAttribute("data-swap-line")).toBe("drawn");
    expect(
      chart("host").querySelectorAll(
        "path.recharts-line-curve[stroke-dasharray]"
      )
    ).toHaveLength(1);
    expect(chart("host").getAttribute("data-pressure-name")).toBe(
      "commit used"
    );
    // A wsl lane's lead line already IS swap, so it gets no second one.
    expect(chart("wsl").getAttribute("data-swap-line")).toBe("absent");
  });

  it("renders all-lanes-silent as samples stale with the newest age, never an empty table", async () => {
    httpGet.mockResolvedValue(
      detailFx({ lanes: [], newest_sample_age_secs: 2400 })
    );
    render(<CoordComputerDetailPage />);
    const note = await screen.findByTestId("coord-computer-lanes-stale");
    expect(note.textContent).toBe(
      "Samples stale, newest 40m ago — no lane of a currently attached device is listed, so current usage is unknown (not idle)."
    );
    expect(screen.queryByTestId("coord-computer-lanes")).toBeNull();
    expect(screen.queryByTestId("coord-computer-lanes-unknown")).toBeNull();
  });

  it("renders a lane past its 90 s sample window as a STALE last-known row, listed not dropped", async () => {
    httpGet.mockResolvedValue(
      detailFx({
        lanes: [
          laneFx({ age_secs: 10 }),
          laneFx({ lane: "wsl", lane_instance: "Ubuntu", age_secs: 2400 }),
        ],
      })
    );
    render(<CoordComputerDetailPage />);
    const rows = await screen.findAllByTestId("coord-computer-lane-row");
    expect(rows.map((r) => r.getAttribute("data-freshness"))).toEqual([
      "fresh",
      "stale",
    ]);
    expect(
      within(rows[1]).getByTestId("coord-computer-lane-last-known").textContent
    ).toBe("last known, 40m ago");
    expect(screen.getByTestId("coord-computer-health").textContent).toContain(
      "lane stale"
    );
  });

  it("says when coord truncated the lane list, and the verdict is not healthy", async () => {
    httpGet.mockResolvedValue(detailFx({ lanes_truncated: true }));
    render(<CoordComputerDetailPage />);
    expect(
      (await screen.findByTestId("coord-computer-lanes-truncated")).textContent
    ).toBe("Lanes truncated — some lanes not shown, state not fully known.");
    expect(screen.getByTestId("coord-computer-lanes")).toBeTruthy();
    expect(screen.getByTestId("coord-computer-health").textContent).toContain(
      "samples not fully known"
    );
  });

  it("counts an old down row as down — its age is information only (contract A2)", async () => {
    httpGet.mockResolvedValue(
      detailFx({
        services: [
          serviceFx({ active_state: "failed", observed_age_secs: 3600 }),
        ],
      })
    );
    render(<CoordComputerDetailPage />);
    const status = await screen.findByTestId("coord-computer-service-status");
    expect(status.getAttribute("data-status")).toBe("down");
    expect(status.textContent).toBe("✕ failed");
    expect(
      screen.getByTestId("coord-computer-health-services").textContent
    ).toBe("services down 1");
    // Expand the row (RecordRow's whole line is one button).
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("coord-computer-service-row")).getAllByRole(
          "button"
        )[0]
      );
    });
    expect(
      (await screen.findByTestId("coord-computer-service-observed")).textContent
    ).toBe(
      "Recorded by coord 1h ago (an unchanged unit is re-recorded about every 5 min; currency is this computer's report freshness)"
    );
  });

  it("reads services_reported: false as unknown — never 'no watched service' or 0 down", async () => {
    httpGet.mockResolvedValue(detailFx({ services_reported: false }));
    render(<CoordComputerDetailPage />);
    expect(
      (await screen.findByTestId("coord-computer-services-unknown")).textContent
    ).toContain("unknown — not none");
    expect(screen.queryByTestId("coord-computer-services-none")).toBeNull();
    expect(
      screen.getByTestId("coord-computer-health-services").textContent
    ).toBe("services down –");
  });

  it("renders CI runners and divergence UNKNOWN when coord's registrar read failed", async () => {
    httpGet.mockResolvedValue(detailFx({ registrar_read_ok: false }));
    render(<CoordComputerDetailPage />);
    expect(
      await screen.findByTestId("coord-computer-divergence-unknown")
    ).toBeTruthy();
    expect(
      screen.getByTestId("coord-computer-ci-runners-unknown")
    ).toBeTruthy();
    expect(screen.queryByTestId("coord-computer-divergence-none")).toBeNull();
  });

  it("labels a declared-host CI runner, and only that one — runner_name and absent add nothing", async () => {
    const base = {
      device_id: DEVICE_ID,
      host_key: "merytshost",
      repo: "qontinui/qontinui-web",
      ci_runner_status: "idle",
      last_seen_at: null,
      registrar_fresh: true,
      service_active_state: null,
    };
    const runners = [
      {
        ...base,
        hostname: "gh-runner-declared@qontinui/qontinui-web",
        runner_name: "declared-1",
        service_unit: null,
        attributed_by: "declared_host" as const,
      },
      {
        ...base,
        hostname: "gh-runner-paired@qontinui/qontinui-web",
        runner_name: "paired-1",
        service_unit: "actions.runner.qontinui.paired-1.service",
        service_active_state: "active",
        attributed_by: "runner_name" as const,
      },
      {
        ...base,
        hostname: "gh-runner-older@qontinui/qontinui-web",
        runner_name: "older-coord-1",
        service_unit: null,
      },
    ];
    const fx = detailFx();
    httpGet.mockResolvedValue({
      ...fx,
      ci_runners: runners,
      workloads: { ...fx.workloads, ci_runners: runners },
    });
    render(<CoordComputerDetailPage />);
    const rows = await screen.findAllByTestId("coord-computer-ci-runner-row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0]).getByTestId("coord-computer-ci-runner-declared-host")
        .textContent
    ).toBe("placed on machine (declared host), unit unknown");
    expect(
      within(rows[1]).queryByTestId("coord-computer-ci-runner-declared-host")
    ).toBeNull();
    expect(
      within(rows[2]).queryByTestId("coord-computer-ci-runner-declared-host")
    ).toBeNull();
  });

  it("does not read as agreement for runners coord never compared — declared-host and older-coord rows alike", async () => {
    const base = {
      device_id: DEVICE_ID,
      host_key: "merytshost",
      repo: "qontinui/qontinui-web",
      ci_runner_status: "idle",
      last_seen_at: null,
      registrar_fresh: true,
      service_unit: null,
      service_active_state: null,
    };
    const runners = [
      {
        ...base,
        hostname: "gh-runner-declared-1@qontinui/qontinui-web",
        runner_name: "declared-1",
        attributed_by: "declared_host" as const,
      },
      {
        ...base,
        hostname: "gh-runner-declared-2@qontinui/qontinui-web",
        runner_name: "declared-2",
        attributed_by: "declared_host" as const,
      },
      {
        ...base,
        hostname: "gh-runner-older@qontinui/qontinui-web",
        runner_name: "older-coord-1",
      },
    ];
    const fx = detailFx();
    const withRunners = {
      ...fx,
      ci_runners: runners,
      workloads: { ...fx.workloads, ci_runners: runners },
    };

    // Empty divergence list: the none-message narrows to paired rows.
    httpGet.mockResolvedValue(withRunners);
    const { unmount } = render(<CoordComputerDetailPage />);
    expect(
      (await screen.findByTestId("coord-computer-divergence-none")).textContent
    ).toBe(
      "No disagreement found among fresh registrar rows paired with a unit. 3 CI runners with no paired unit are not compared."
    );
    unmount();

    // Non-empty divergence list: the same note sits beside it.
    httpGet.mockResolvedValue({
      ...withRunners,
      divergence: [
        {
          kind: "reported_down_registrar_online",
          unit: "actions.runner.qontinui.paired-1.service",
          runner_name: "paired-1",
          reported_active_state: "failed",
          registrar_status: "online",
          registrar_device_id: DEVICE_ID,
        },
      ],
    });
    render(<CoordComputerDetailPage />);
    expect(
      await screen.findByTestId("coord-computer-divergence-row")
    ).toBeTruthy();
    expect(
      screen.getByTestId("coord-computer-divergence-not-compared").textContent
    ).toBe("3 CI runners with no paired unit are not compared.");
    expect(screen.queryByTestId("coord-computer-divergence-none")).toBeNull();
  });

  it("says 'no disagreement found' — never 'agree' — when the registrar read succeeded", async () => {
    httpGet.mockResolvedValue(detailFx());
    render(<CoordComputerDetailPage />);
    expect(
      (await screen.findByTestId("coord-computer-divergence-none")).textContent
    ).toBe("No disagreement found among fresh registrar rows.");
  });

  it("shows a stale computer's lanes as last known and its services as `last known: …`", async () => {
    httpGet.mockResolvedValue(
      detailFx({
        report_age_secs: 9000,
        services: [serviceFx({ active_state: "failed", result: "oom-kill" })],
      })
    );
    render(<CoordComputerDetailPage />);
    const status = await screen.findByTestId("coord-computer-service-status");
    expect(status.getAttribute("data-status")).toBe("unknown");
    expect(status.textContent).toBe("last known: failed");
    expect(
      screen.getByTestId("coord-computer-lane-freshness").textContent
    ).toBe("STALE");
    expect(screen.getByTestId("coord-computer-lane-last-known")).toBeTruthy();
  });

  it("renders a fresh down unit red, with its OOM policy in the detail", async () => {
    httpGet.mockResolvedValue(
      detailFx({
        services: [
          serviceFx({
            active_state: "failed",
            result: "oom-kill",
            memory_peak: null,
          }),
        ],
      })
    );
    render(<CoordComputerDetailPage />);
    const status = await screen.findByTestId("coord-computer-service-status");
    expect(status.getAttribute("data-status")).toBe("down");
    expect(status.textContent).toBe("✕ failed");
  });

  it("names the divergence in operator words", async () => {
    httpGet.mockResolvedValue(
      detailFx({
        divergence: [
          {
            kind: "reported_down_registrar_online",
            unit: "actions.runner.qontinui-web.merytshost-1.service",
            runner_name: "merytshost-1",
            reported_active_state: "failed",
            registrar_status: "idle",
            registrar_device_id: "aaaaaaaa-0000-4000-8000-000000000001",
          },
        ],
      })
    );
    render(<CoordComputerDetailPage />);
    const row = await screen.findByTestId("coord-computer-divergence-row");
    expect(row.textContent).toContain(
      "the computer reports the runner down; GitHub lists it online"
    );
    expect(row.textContent).toContain("reported failed, registrar idle");
  });

  it("sums coord's per-device open sessions, and reads null as unknown", async () => {
    httpGet.mockResolvedValue(detailFx());
    const { unmount } = render(<CoordComputerDetailPage />);
    expect(
      (await screen.findByTestId("coord-computer-agent-sessions")).textContent
    ).toBe(
      "2 open agent sessions across 1 device with sessions, of 1 coord device on this computer."
    );
    unmount();

    const d = detailFx();
    httpGet.mockResolvedValue({
      ...d,
      workloads: { ...d.workloads, agent_sessions: null },
    });
    render(<CoordComputerDetailPage />);
    expect(
      (await screen.findByTestId("coord-computer-agent-sessions")).textContent
    ).toBe(
      "Coord could not read agent sessions for this computer — unknown, not none."
    );
  });

  it("clears the retained lanes and services when a later read says computer_not_found", async () => {
    httpGet.mockResolvedValueOnce(detailFx());
    httpGet.mockRejectedValue(rejection(404, '{"error":"computer_not_found"}'));
    render(<CoordComputerDetailPage />);
    expect(await screen.findByTestId("coord-computer-lanes")).toBeTruthy();
    expect(screen.getAllByTestId("coord-computer-service-row")).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-computer-refresh"));
    });
    const banner = await screen.findByTestId("coord-computer-unknown-banner");
    expect(banner.getAttribute("data-issue")).toBe("not_found");
    expect(screen.queryByTestId("coord-computer-lanes")).toBeNull();
    expect(screen.queryAllByTestId("coord-computer-service-row")).toHaveLength(
      0
    );
    expect(screen.getByTestId("coord-computer-health").textContent).toContain(
      "No such computer in this tenant"
    );
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
});
