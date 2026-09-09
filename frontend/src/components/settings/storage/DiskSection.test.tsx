import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

/**
 * DiskSection — the rendered half of the honesty contract.
 *
 * `diskSurvey.test.ts` pins the parse/aggregate rules; these pin that the
 * component actually SHOWS the difference. Phase 1's review caught two
 * honesty violations in rendering code specifically, so the render is worth
 * asserting on rather than trusting the pure layer to imply.
 */

const runnerFetch = vi.fn();
const httpFetch = vi.fn();
const useDeviceInfo = vi.fn();

class MockRunnerApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "RunnerApiError";
  }
}

vi.mock("@/lib/runner-api", () => ({
  runnerFetch: (...args: unknown[]) => runnerFetch(...args),
  RunnerApiError: MockRunnerApiError,
  useDeviceInfo: () => useDeviceInfo(),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));

const { DiskSection } = await import("./DiskSection");

const DEVICE = "11111111-1111-1111-1111-111111111111";

/**
 * A report-only root IN THE ONLY SHAPE THE RUNNER CAN EMIT ONE.
 *
 * `in-repo-canonical` never arrives `reclaimable`: the reaper's
 * `boundary_verdict` returns `Err(SkipReason::ReportOnly)` unconditionally for
 * a verbless class and `disk_survey.rs` maps every `Err` to `blocked`. The
 * fixtures here used to say `status: "reclaimable"`, so every report-only
 * assertion passed against a payload that cannot exist — which is why the tile
 * rendering `0 B` over 1.67 TB shipped with a green suite.
 */
function reportOnlyRoot(over: Record<string, unknown> = {}) {
  return {
    id: "r",
    path: "D:/repo/target",
    class: "in-repo-canonical",
    status: "blocked",
    reason: "report-only",
    reason_detail:
      "Inside a canonical repo checkout. Measured and reported, but v1 has " +
      "no cleanup verb for this class.",
    verb: null,
    ...over,
  };
}

/**
 * A root ANOTHER ENGINE owns, in the shape `render_item` actually produces:
 * `<wt>/target` is the canonical build-dir name the worktree reclaim engine
 * owns, so the reaper refuses it — and because that refusal is
 * `SkipReason::owned_elsewhere()`, the verb is STRIPPED. Its class is still
 * `sibling-worktree`, the same class whose `target-<slug>` roots carry a verb.
 */
function ownedElsewhereRoot(over: Record<string, unknown> = {}) {
  return {
    id: "o",
    path: "D:/wt/target",
    class: "sibling-worktree",
    status: "blocked",
    reason: "owned-by-worktree-reclaim",
    reason_detail:
      "`target` is the canonical build-dir name the worktree reclaim engine " +
      "owns.",
    verb: null,
    ...over,
  };
}

/**
 * The runner's measured-empty answer. `summary.reclaimable_bytes: 0` is the
 * MEASUREMENT; without the key the page may not claim "nothing to reclaim"
 * (absence is unknown), so the default fixture has to carry it explicitly —
 * and `scan` has to say the walk finished, which is why a completed census
 * always carries the block.
 */
const EMPTY_MEASURED = {
  items: [],
  summary: { reclaimable_bytes: 0, report_only_bytes: 0 },
  scan: { dirs_visited: 1200, truncated: false, read_errors: [] },
  census_status: "fresh",
};

function volumesResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDeviceInfo.mockReturnValue({
    data: { device_id: DEVICE },
    isLoading: false,
  });
  httpFetch.mockResolvedValue(
    volumesResponse({ device_id: DEVICE, volumes: [] })
  );
  runnerFetch.mockResolvedValue(EMPTY_MEASURED);
});

describe("DiskSection — free space", () => {
  it("consumes the per-device route (deviceVolumesUrl) for THIS device", async () => {
    render(<DiskSection />);
    await waitFor(() => expect(httpFetch).toHaveBeenCalled());
    expect(String(httpFetch.mock.calls[0][0])).toContain(
      `/operations/devices/${DEVICE}/volumes`
    );
  });

  it("renders a failed read as UNKNOWN with the reason, never as empty", async () => {
    httpFetch.mockResolvedValue(volumesResponse(null, false, 502));
    render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/HTTP 502/)).toBeInTheDocument()
    );
    expect(screen.getByText(/not an empty disk/i)).toBeInTheDocument();
  });

  it("distinguishes 'never reported' from a failed read", async () => {
    render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/never reported disk telemetry/i)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/absence of measurement/i)).toBeInTheDocument();
  });

  it("says the device could not be identified rather than showing zero", async () => {
    // The runner ANSWERED and named no device — the one case that supports a
    // statement about the machine rather than about the read.
    useDeviceInfo.mockReturnValue({
      data: { device_name: "box" },
      isLoading: false,
    });
    render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/answered without a coord device id/i)
      ).toBeInTheDocument()
    );
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("renders a reading with its free bytes", async () => {
    httpFetch.mockResolvedValue(
      volumesResponse({
        device_id: DEVICE,
        volumes: [
          {
            volume: "D:",
            total_bytes: 4 * 1024 ** 4,
            free_bytes: 1024 ** 4,
            observed_at: new Date().toISOString(),
          },
        ],
      })
    );
    render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/1.0 TiB free/)).toBeInTheDocument()
    );
  });
});

describe("DiskSection — reclaim survey", () => {
  it("renders a cold census as NOT READY, never as 'nothing to clean'", async () => {
    runnerFetch.mockResolvedValue({ items: [], census_status: "pending" });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/no census has completed yet/i)
      ).toBeInTheDocument()
    );
    // The positive claim is marked in the DOM, so this asserts on the CLAIM
    // rather than on prose that also appears inside disclaimers.
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("says a 404 means the runner CANNOT answer, not that there is nothing", async () => {
    runnerFetch.mockRejectedValue(new MockRunnerApiError(404, "not found"));
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        screen.getByText(/predates the disk-reclaim survey/i)
      ).toBeInTheDocument()
    );
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("only claims 'nothing to reclaim' for a completed, clean census", async () => {
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="measured"]')
      ).not.toBeNull()
    );
    expect(screen.getByText(/Nothing to reclaim/i)).toBeInTheDocument();
  });

  it("will NOT claim it when the runner sent no reclaimable_bytes at all", async () => {
    // W4: `fresh` + an empty list + no total is the runner not having told us.
    runnerFetch.mockResolvedValue({ items: [], census_status: "fresh" });
    const { container } = render(<DiskSection />);
    await waitFor(() => expect(runnerFetch).toHaveBeenCalled());
    await waitFor(() =>
      expect(container.querySelector("[data-disk-unknown]")).not.toBeNull()
    );
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("renders an empty list from a TRUNCATED walk as its own state", async () => {
    // W3: the 200k visit cap hit before the walk found any root. `fresh` +
    // `items: []` + `reclaimable_bytes: 0` is indistinguishable from a clean
    // machine unless `bytes_incomplete` / `scan.truncated` are consulted.
    runnerFetch.mockResolvedValue({
      items: [],
      summary: { reclaimable_bytes: 0, bytes_incomplete: true },
      scan: { dirs_visited: 200000, truncated: true, read_errors: [] },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="incomplete"]')
      ).not.toBeNull()
    );
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
    const panel = container.querySelector('[data-disk-empty="incomplete"]');
    expect(panel?.textContent).toMatch(/visit ceiling/i);
    expect(panel?.textContent).toMatch(/200[,.\s]?000 directories/);
    // It must not read as the generic "could not parse" copy either — the
    // operator needs "the walk stopped early", not "the answer was unreadable".
    expect(panel?.textContent).toMatch(/never reached/i);
  });

  it("names the DEPTH BOUND rather than blaming a cause that did not happen", async () => {
    // The shape a `paths.workspace_root` set one level too high produces: the
    // walk read every directory it opened and simply never reached deep enough.
    // `truncated: false`, `read_errors_total: 0` — so the clause's first two
    // arms are both falsy, and the fallback used to assert "a truncated walk,
    // or a subtree it could not read". NEITHER happened, on the one panel whose
    // job is never saying more than the payload carries. `census_note`, above
    // this panel, said the true thing at the same moment.
    runnerFetch.mockResolvedValue({
      items: [],
      summary: {
        reclaimable_bytes: null,
        bytes_incomplete: true,
        roots_unknown: true,
        by_class: [],
      },
      scan: {
        dirs_visited: 4102,
        truncated: false,
        read_errors: [],
        read_errors_total: 0,
        depth_limited_dirs: 118,
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="incomplete"]')
      ).not.toBeNull()
    );
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
    const panel = container.querySelector('[data-disk-empty="incomplete"]');
    expect(panel?.textContent).toMatch(/depth bound/i);
    expect(panel?.textContent).toMatch(/118/);
    // And it must NOT name either cause that did not occur.
    expect(panel?.textContent).not.toMatch(/visit ceiling/i);
    expect(panel?.textContent).not.toMatch(/could not be read/i);
    expect(panel?.textContent).not.toMatch(/truncated walk/i);
  });

  it("claims NO cause when the runner reports none, rather than picking one", async () => {
    // Non-vacuous companion to the test above: with every named shortfall
    // absent (an older runner that sends `bytes_incomplete` and nothing else),
    // the panel must still refuse to invent a reason.
    runnerFetch.mockResolvedValue({
      items: [],
      summary: { reclaimable_bytes: 0, bytes_incomplete: true },
      scan: { dirs_visited: 10, truncated: false, read_errors: [] },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="incomplete"]')
      ).not.toBeNull()
    );
    const panel = container.querySelector('[data-disk-empty="incomplete"]');
    expect(panel?.textContent).toMatch(/did not name/i);
    expect(panel?.textContent).not.toMatch(/visit ceiling/i);
    expect(panel?.textContent).not.toMatch(/depth bound/i);
  });

  it("names SKIPPED JUNCTIONS, a cause the payload carries and the page did not read", async () => {
    // `reparse_dirs_skipped` is folded into the runner's `incomplete()`, so it
    // raises `bytes_incomplete` and this state reaches the panel on every
    // runner build — no companion runner change needed. With the counter
    // unparsed, the panel said the shortfall had no named cause while the
    // payload named it and `census_note` spelled it out. The reachable shape:
    // a `paths.workspace_root` whose children are all junctions (`_wt` shared
    // checkouts, `.wt-targets` links) returns an empty list with NO read
    // errors at all.
    runnerFetch.mockResolvedValue({
      items: [],
      summary: { reclaimable_bytes: null, bytes_incomplete: true },
      scan: {
        dirs_visited: 61,
        truncated: false,
        read_errors: [],
        read_errors_total: 0,
        entry_errors: 0,
        reparse_dirs_skipped: 4,
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="incomplete"]')
      ).not.toBeNull()
    );
    const panel = container.querySelector('[data-disk-empty="incomplete"]');
    expect(panel?.textContent).toMatch(/4 junctions were not followed/);
    // And it must not fall back to refusing to name what it was told.
    expect(panel?.textContent).not.toMatch(/did not name/i);
    expect(panel?.textContent).not.toMatch(/visit ceiling/i);
    expect(panel?.textContent).not.toMatch(/could not be read/i);
  });

  it("names EVERY shortfall the walk reported, not just the loudest one", async () => {
    // The causes are not alternatives: one pass can hit the ceiling AND fail
    // reads AND skip junctions. Naming only the first-matching one drops the
    // rest, which understates the shortfall exactly as inventing a cause
    // overstates it. The runner's own `census_note` joins its gap list with
    // "; " for this reason; this panel is the page's mirror of that list.
    runnerFetch.mockResolvedValue({
      items: [],
      summary: { reclaimable_bytes: null, bytes_incomplete: true },
      scan: {
        dirs_visited: 200000,
        truncated: true,
        read_errors: [{ path: "D:\\locked", error: "denied" }],
        read_errors_total: 4137,
        entry_errors: 6,
        reparse_dirs_skipped: 3,
        depth_limited_dirs: 118,
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="incomplete"]')
      ).not.toBeNull()
    );
    const panel = container.querySelector('[data-disk-empty="incomplete"]');
    expect(panel?.textContent).toMatch(/visit ceiling/i);
    expect(panel?.textContent).toMatch(
      /4[,.\s]?137 directories could not be read/
    );
    expect(panel?.textContent).toMatch(/6 directories errored part-way/);
    expect(panel?.textContent).toMatch(/3 junctions were not followed/);
    expect(panel?.textContent).toMatch(/depth bound/i);
  });

  it("refuses 'nothing to reclaim' under a bitten DEPTH BOUND, with every other field clean", async () => {
    // The state the runner emits TODAY: `depth_limited_dirs` is kept out of
    // both `truncated` and `bytes_incomplete` on purpose, so every
    // machine-readable completeness field reads clean and only `census_note`
    // says the walk fell short. Without reading the counter here, the page
    // printed "this is a measured answer, not a missing one" directly beneath
    // a note saying it was not a certified "nothing to reclaim".
    runnerFetch.mockResolvedValue({
      items: [],
      summary: {
        reclaimable_bytes: 0,
        report_only_bytes: 0,
        bytes_incomplete: false,
        by_class: [],
      },
      scan: {
        dirs_visited: 4102,
        truncated: false,
        read_errors: [],
        read_errors_total: 0,
        entry_errors: 0,
        reparse_dirs_skipped: 0,
        depth_limited_dirs: 118,
        roots_with_unknown_bytes: 0,
        roots_with_partial_bytes: 0,
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="incomplete"]')
      ).not.toBeNull()
    );
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
    const panel = container.querySelector('[data-disk-empty="incomplete"]');
    expect(panel?.textContent).toMatch(/depth bound/i);
    expect(panel?.textContent).toMatch(/118/);
    expect(panel?.textContent).not.toMatch(/did not name/i);
  });

  it("NON-VACUOUS: the same payload with the bound unbitten IS the measured zero", async () => {
    // Without this, the test above would pass for a page that had simply
    // stopped being able to say "nothing to reclaim" at all.
    runnerFetch.mockResolvedValue({
      items: [],
      summary: {
        reclaimable_bytes: 0,
        report_only_bytes: 0,
        bytes_incomplete: false,
        by_class: [],
      },
      scan: {
        dirs_visited: 4102,
        truncated: false,
        read_errors: [],
        read_errors_total: 0,
        entry_errors: 0,
        reparse_dirs_skipped: 0,
        depth_limited_dirs: 0,
        roots_with_unknown_bytes: 0,
        roots_with_partial_bytes: 0,
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="measured"]')
      ).not.toBeNull()
    );
    expect(
      container.querySelector('[data-disk-empty="incomplete"]')
    ).toBeNull();
  });

  it("renders an empty list with bytes_incomplete but no scan block distinctly", async () => {
    // Permission-denied subtrees: the ONLY signal is `bytes_incomplete`.
    runnerFetch.mockResolvedValue({
      items: [],
      summary: { reclaimable_bytes: 0, bytes_incomplete: true },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="incomplete"]')
      ).not.toBeNull()
    );
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("separates the actionable bytes from the report-only ones, with the why", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "sibling-worktree",
          status: "reclaimable",
          bytes: 2 * 1024 ** 3,
        },
        reportOnlyRoot({ id: "b", bytes: 8 * 1024 ** 3 }),
      ],
      summary: {
        reclaimable_bytes: 2 * 1024 ** 3,
        report_only_bytes: 8 * 1024 ** 3,
      },
      census_status: "fresh",
      census_age_secs: 30,
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getAllByText("2.0 GiB").length).toBeGreaterThan(0)
    );
    // Each bucket tile carries its own total: 2 GiB actionable, 8 GiB
    // report-only. The split is the requirement — one merged "10 GiB
    // reclaimable" would overstate what the product can act on.
    const actionable = container.querySelector(
      '[data-disk-bucket="actionable"]'
    );
    const reportOnly = container.querySelector(
      '[data-disk-bucket="report-only"]'
    );
    expect(actionable?.textContent).toContain("2.0 GiB");
    expect(reportOnly?.textContent).toContain("8.0 GiB");
    expect(
      screen.getByText(/Why the report-only bytes have no button/i)
    ).toBeInTheDocument();
  });

  it("shows the report-only tile's REAL bytes, never a bare 0 B", async () => {
    // W1/W2 regression. Against the payload the runner actually emits, the
    // tile used to read "0 B · 0 target dirs" while 1.67 TB was relabelled
    // into the "Blocked by a guard" tile — whose copy claimed a live build, a
    // pin or a dirty tree was holding bytes that nothing is holding.
    runnerFetch.mockResolvedValue({
      items: [
        reportOnlyRoot({
          id: "a",
          path: "D:/one/target",
          bytes: 5 * 1024 ** 3,
        }),
        reportOnlyRoot({
          id: "b",
          path: "D:/two/target",
          bytes: 3 * 1024 ** 3,
        }),
      ],
      summary: { reclaimable_bytes: 0, report_only_bytes: 8 * 1024 ** 3 },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="report-only"]')
      ).not.toBeNull()
    );
    const reportOnly = container.querySelector(
      '[data-disk-bucket="report-only"]'
    );
    expect(reportOnly?.textContent).toContain("8.0 GiB");
    expect(reportOnly?.textContent).toContain("2 target dirs");
    expect(reportOnly?.textContent).not.toMatch(/\b0 B\b/);
    // Those same bytes must NOT also appear as guard-held.
    expect(
      container.querySelector('[data-disk-bucket="unrecognised"]')
    ).toBeNull();
    expect(container.textContent).not.toMatch(/a live build, a pin/i);
  });

  it("stops the report-only divergence Alert firing on an ordinary load", async () => {
    // W5. It used to render on EVERY real load (headline ~1.67 TB vs a derived
    // total that was structurally 0), training the operator to ignore the
    // honesty banners the whole feature is built out of.
    runnerFetch.mockResolvedValue({
      items: [
        reportOnlyRoot({ id: "a", bytes: 1024 ** 3 }),
        {
          id: "c",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 4096,
          verb: "orphan_target_reaper",
        },
      ],
      summary: { reclaimable_bytes: 4096, report_only_bytes: 1024 ** 3 },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="report-only"]')
      ).not.toBeNull()
    );
    expect(
      container.querySelector("[data-disk-report-only-mismatch]")
    ).toBeNull();
    expect(container.querySelector("[data-disk-disagreement]")).toBeNull();
  });

  it("says the LIST is a prefix separately from the totals being floors", async () => {
    // W6: `scan.truncated` and `summary.bytes_incomplete` are two different
    // shortfalls and get two different sentences.
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
        },
      ],
      summary: { bytes_incomplete: true },
      scan: {
        dirs_visited: 200000,
        truncated: true,
        read_errors: [{ path: "D:/x", error: "permission denied" }],
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector("[data-disk-scan-truncated]")
      ).not.toBeNull()
    );
    expect(
      container.querySelector("[data-disk-scan-truncated]")?.textContent
    ).toMatch(/PREFIX of the population/i);
    expect(
      container.querySelector("[data-disk-bytes-incomplete]")?.textContent
    ).toMatch(/1 directory failed to read/i);
  });

  it("does not print a partially-sized blocked root as an exact measurement", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "blocked",
          reason: "building",
          reason_detail: "a cargo build holds .cargo-lock",
          bytes: 1024,
          bytes_partial: true,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(container.querySelector("[data-disk-blocked-list]")).not.toBeNull()
    );
    const list = container.querySelector("[data-disk-blocked-list]");
    expect(list?.textContent).toMatch(/at least 1.0 KiB \(sized only partly\)/);
  });

  it("renders a missing byte count as 'at least', never as a zero total", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
        },
        {
          id: "b",
          path: "D:/wt2/target",
          class: "container",
          status: "reclaimable",
          bytes: null,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getAllByText(/at least/i).length).toBeGreaterThan(0)
    );
    const actionable = container.querySelector(
      '[data-disk-bucket="actionable"]'
    );
    // 1 KiB from the readable item, and an explicit lower-bound qualifier for
    // the one whose size never arrived — NOT "1.0 KiB" presented as exact and
    // NOT the unreadable item summed as 0.
    expect(actionable?.textContent).toContain("at least");
    expect(actionable?.textContent).toContain("1.0 KiB");
    expect(actionable?.textContent).toContain("1 of unknown size");
  });

  it("shows an absent bucket as ABSENT, never as a 0 B tile", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="actionable"]')
      ).not.toBeNull()
    );
    // Nothing in this payload was in-repo-canonical. A "0 B" report-only tile
    // would claim the runner scanned that class — which this page cannot know.
    expect(
      container.querySelector('[data-disk-bucket="report-only"]')
    ).toBeNull();
    expect(
      container.querySelector("[data-disk-absent-buckets]")?.textContent
    ).toMatch(/rather than as 0 B/i);
  });

  it("renders census_status 'unavailable' as a failure, with the runner's reason", async () => {
    runnerFetch.mockResolvedValue({
      items: [],
      census_status: "unavailable",
      census_note: "the workspace root could not be resolved",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/could not run/i)).toBeInTheDocument()
    );
    expect(
      screen.getByText(/workspace root could not be resolved/i)
    ).toBeInTheDocument();
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("renders a MEASURED zero when the runner sent a per-class rollup", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
          verb: "orphan_target_reaper",
        },
      ],
      summary: {
        by_class: [
          { class: "container", roots: 1, verb: "orphan_target_reaper" },
          { class: "in-repo-canonical", roots: 0, verb: null },
        ],
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="report-only"]')
      ).not.toBeNull()
    );
    // The runner emits a row per class, so 0 here IS a measurement — and the
    // "we cannot tell absent from zero" caveat must NOT appear.
    expect(
      container.querySelector('[data-disk-bucket="report-only"]')?.textContent
    ).toContain("0 B");
    expect(container.querySelector("[data-disk-absent-buckets]")).toBeNull();
  });

  it("says the totals are floors when the runner flags an incomplete walk", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
          bytes_partial: true,
        },
      ],
      summary: { bytes_incomplete: true },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector("[data-disk-bytes-incomplete]")
      ).not.toBeNull()
    );
    expect(
      container.querySelector('[data-disk-bucket="actionable"]')?.textContent
    ).toContain("sized only partly");
  });

  it("warns when candidates could not be read at all", async () => {
    runnerFetch.mockResolvedValue({
      items: [{ status: "???" }],
      census_status: "fresh",
    });
    render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/could not be read/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Nothing to reclaim/i)).not.toBeInTheDocument();
  });

  it("Preview stays enabled when EVERYTHING else has failed", async () => {
    // The requirement is that Preview is gated on nothing — no arming flag, no
    // config, no threshold, and not on the health of any other read. So the
    // worst case is the one worth asserting: no device id, and a survey route
    // that 404s.
    useDeviceInfo.mockReturnValue({ data: null, isLoading: false });
    runnerFetch.mockRejectedValue(new MockRunnerApiError(404, "not found"));
    render(<DiskSection />);
    const button = await screen.findByRole("button", { name: /preview/i });
    await waitFor(() =>
      expect(
        screen.getByText(/predates the disk-reclaim survey/i)
      ).toBeInTheDocument()
    );
    expect(button).not.toBeDisabled();
  });

  it("Preview disables only while its own request is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    render(<DiskSection />);
    const button = await screen.findByRole("button", { name: /preview/i });
    await waitFor(() => expect(button).not.toBeDisabled());

    runnerFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    release(EMPTY_MEASURED);
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("ships NO delete verb — Preview is the only button in the section", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "reclaimable",
          bytes: 1024,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="actionable"]')
      ).not.toBeNull()
    );
    const section = container.querySelector("[data-disk-section]");
    const buttons = within(section as HTMLElement).queryAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toMatch(/preview/i);
    expect(section?.textContent).not.toMatch(/delete|remove|clear/i);
  });

  it("renders an in-flight read as PENDING, not as a failed read", async () => {
    let release: (value: unknown) => void = () => {};
    runnerFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(container.querySelector("[data-disk-pending]")).not.toBeNull()
    );
    // A request that has not answered YET is not a request that failed.
    expect(
      screen.queryByText(/the reclaim survey could not be read/i)
    ).not.toBeInTheDocument();
    release(EMPTY_MEASURED);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-empty="measured"]')
      ).not.toBeNull()
    );
  });

  it("says the runner could not be ASKED when device-info itself failed", async () => {
    useDeviceInfo.mockReturnValue({
      data: null,
      isLoading: false,
      error: "Runner not connected",
    });
    render(<DiskSection />);
    await waitFor(() =>
      expect(screen.getByText(/could not be asked/i)).toBeInTheDocument()
    );
    // NOT "the runner answered without a device id" -- that is a determinate
    // negative drawn from a read that never answered.
    expect(
      screen.queryByText(/answered without a coord device id/i)
    ).not.toBeInTheDocument();
  });

  it("warns when SOME volume rows were unreadable but others survived", async () => {
    httpFetch.mockResolvedValue(
      volumesResponse({
        device_id: DEVICE,
        volumes: [
          {
            volume: "D:",
            total_bytes: 100,
            free_bytes: 7,
            observed_at: null,
          },
          {},
        ],
      })
    );
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector("[data-disk-volumes-partial]")
      ).not.toBeNull()
    );
    expect(screen.getByText(/list below is INCOMPLETE/i)).toBeInTheDocument();
  });

  it("refuses a measured zero when the rollup names roots the items omit", async () => {
    runnerFetch.mockResolvedValue({
      items: [],
      summary: {
        by_class: [
          { class: "container", roots: 40, verb: "orphan_target_reaper" },
          { class: "in-repo-canonical", roots: 0, verb: null },
        ],
      },
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector("[data-disk-rollup-mismatch]")
      ).not.toBeNull()
    );
    // The rollup says 40 roots. A "0 B / 0 target dirs" actionable tile, or a
    // "nothing to reclaim", would both be fabricated from a short item list.
    expect(
      container.querySelector('[data-disk-bucket="actionable"]')
    ).toBeNull();
    expect(container.querySelector('[data-disk-empty="measured"]')).toBeNull();
  });

  it("still shows a v1 class whose every root is BLOCKED", async () => {
    runnerFetch.mockResolvedValue({
      items: [
        {
          id: "a",
          path: "D:/wt/target",
          class: "container",
          status: "blocked",
          reason: "building",
          reason_detail: "a cargo build holds .cargo-lock",
          bytes: 4 * 1024 ** 3,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="actionable"]')
      ).not.toBeNull()
    );
    // "No candidates for the classes the cleanup verb covers" would be false:
    // it found one, and a guard is holding it.
    expect(
      container.querySelector("[data-disk-absent-buckets]")?.textContent ?? ""
    ).not.toMatch(/cleanup verb covers/i);
    expect(screen.getByText(/holds .cargo-lock/i)).toBeInTheDocument();
  });

  it("SHOWS the actionable tile for a class whose roots disagree about `verb`", async () => {
    // X1. `verb` is a per-ITEM verdict: `<wt>/target` is owned by the worktree
    // reclaim engine (verb stripped) while `<wt>/target-<slug>` in the SAME
    // class is this reaper's own (verb set). Read as class metadata, the
    // disagreement collapsed the class to "unrecognised" and hid the tile --
    // while the table below it listed a reclaimable root WITH a verb, and the
    // page printed "no candidates for the classes the cleanup verb covers".
    // A fabricated absence over the exact population this feature exists for.
    runnerFetch.mockResolvedValue({
      items: [
        ownedElsewhereRoot({ id: "a", bytes: 2 * 1024 ** 3 }),
        {
          id: "b",
          path: "D:/wt/target-slug",
          class: "sibling-worktree",
          status: "reclaimable",
          verb: "orphan-target-reaper",
          bytes: 5 * 1024 ** 3,
        },
      ],
      census_status: "fresh",
    });
    const { container } = render(<DiskSection />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-disk-bucket="actionable"]')
      ).not.toBeNull()
    );
    const actionable = container.querySelector(
      '[data-disk-bucket="actionable"]'
    );
    expect(actionable?.textContent).toContain("5.0 GiB");
    expect(actionable?.textContent).toContain("1 target dir");
    expect(actionable?.textContent).not.toMatch(/\b0 B\b/);
    // The owned-elsewhere root is held by another engine, so it is on the
    // blocked tile -- not folded into the actionable bytes, and not dropped.
    expect(container.textContent).toContain("2.0 GiB");
    // No "no candidates" sentence for the class that plainly HAS candidates.
    expect(
      container.querySelector("[data-disk-absent-buckets]")?.textContent ?? ""
    ).not.toMatch(/cleanup verb covers/i);
    // And no note telling the operator the runner contradicted itself.
    expect(container.textContent).not.toMatch(
      /conflicting answers|contradict/i
    );
    expect(container.textContent).not.toMatch(/unrecognised class/i);
  });

  it("does not kick a refresh walk on mount — only the button does", async () => {
    render(<DiskSection />);
    await waitFor(() => expect(runnerFetch).toHaveBeenCalled());
    expect(runnerFetch.mock.calls[0][0]).toBe("/disk/reclaimable");
  });
});
