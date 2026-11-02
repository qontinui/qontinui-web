/**
 * `/admin/coord/overlord/flow` — coord's flow answer reaches the screen, a
 * `null` metric reaches it as a labelled "no data", and every shape of
 * not-knowing reaches it as UNKNOWN — never as a zero or an empty list.
 *
 * The derivations are pinned in `_lib/overlordFlowStatus.test.ts`; this file
 * proves the page WIRES them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FULL_FLOW,
  NULL_FLOW,
  PASS_DETAIL,
  PASS_LIST,
  RUNNERS_ALL_COVERED,
  RUNNERS_TWO_SHORT,
  SESSION_ID,
} from "./__fixtures__/flow";

// The page reads through the typed client; its request shape is pinned in
// `lib/api/operations/overlordFlow.test.ts`. The mock receives the query so
// the window assertions can read what the page asked for.
const fetchFlow = vi.fn();
const fetchPasses = vi.fn();
const fetchPass = vi.fn();
vi.mock("@/lib/api/operations/overlordFlow", () => ({
  fetchOverlordFlow: (query: string) => fetchFlow(query),
  fetchOverlordPasses: (query: string) => fetchPasses(query),
  fetchOverlordPass: (id: string) => fetchPass(id),
}));

import CoordOverlordFlowPage from "./page";

const B = "/api/v1/operations/coord/overlord/flow";

function rejection(status: number, body: unknown): Error {
  return new Error(
    `GET ${B}?window_hours=168 failed: ${status} - ${JSON.stringify(body)}`
  );
}

async function strip() {
  return screen.findByTestId("coord-overlord-flow-health");
}

beforeEach(() => {
  fetchFlow.mockReset();
  fetchPasses.mockReset();
  fetchPass.mockReset();
  window.localStorage.clear();
});

describe("/admin/coord/overlord/flow", () => {
  it("renders full data: tiles, unchanged list and the histogram", async () => {
    fetchFlow.mockResolvedValue(FULL_FLOW);
    render(<CoordOverlordFlowPage />);

    await waitFor(() =>
      expect(screen.getByTestId("overlord-flow-ttc-median")).toHaveTextContent(
        "median1h 30m"
      )
    );
    expect(fetchFlow).toHaveBeenCalledTimes(1);
    expect(fetchFlow).toHaveBeenCalledWith(
      "window_hours=168&unchanged_min_passes=3&group_by=overlord_version"
    );

    // Time to close: median, p90, count and the closed_by split.
    expect(screen.getByTestId("overlord-flow-ttc-p90")).toHaveTextContent(
      "p905h 33m"
    );
    expect(screen.getByTestId("overlord-flow-ttc-count")).toHaveTextContent(
      "closed4"
    );
    expect(screen.getByTestId("overlord-flow-ttc-triage")).toHaveTextContent(
      "by triage3"
    );
    expect(screen.getByTestId("overlord-flow-ttc-absent")).toHaveTextContent(
      "gone from a full pass1"
    );
    expect(
      screen.getByTestId("overlord-flow-ttc-absent-unproven")
    ).toHaveTextContent("gone across a rebuild2");
    expect(
      screen.getByTestId("overlord-flow-nudge-finish-unproven")
    ).toHaveTextContent("gone across a rebuild1");

    // Nudge rates with their counts and the unmeasured remainder.
    expect(
      screen.getByTestId("overlord-flow-nudge-progress-rate")
    ).toHaveTextContent("progressed40%");
    expect(screen.getByTestId("overlord-flow-nudge-counts")).toHaveTextContent(
      "of nudged4/10"
    );
    expect(
      screen.getByTestId("overlord-flow-nudge-unmeasured")
    ).toHaveTextContent("unmeasured3");
    expect(
      screen.getByTestId("overlord-flow-nudge-finish-rate")
    ).toHaveTextContent("finished20%");
    expect(
      screen.getByTestId("overlord-flow-nudge-finish-counts")
    ).toHaveTextContent("of nudged2/10");

    // UNKNOWN share is the LATEST pass's (5%), not the older one's (50%).
    expect(screen.getByTestId("overlord-flow-unknown-share")).toHaveTextContent(
      "unknown5%"
    );
    expect(screen.getByTestId("overlord-flow-unknown-rows")).toHaveTextContent(
      "of rows2/40"
    );

    // The strip: two sessions unchanged → amber, never green.
    const s = await strip();
    expect(s).toHaveAttribute("data-health-level", "amber");
    expect(s).toHaveTextContent("2 sessions have not moved");
    expect(s).toHaveTextContent("passes 3");
    expect(s).toHaveTextContent("full 2");
    expect(s).toHaveTextContent("unchanged 2");

    // The unchanged list: one row per session, the proven one linking to the
    // per-session console view, the unproven one showing its full terminal id.
    const rows = screen.getAllByTestId("overlord-flow-unchanged-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("STOPPED");
    expect(rows[0]).toHaveTextContent("1234 fix the flaky gate");
    expect(rows[0]).toHaveTextContent("×3");
    expect(rows[1]).toHaveTextContent("terminal term-9");

    await userEvent.click(within(rows[0]!).getByRole("button"));
    expect(screen.getByTestId("overlord-flow-unchanged-open")).toHaveAttribute(
      "href",
      `/sessions/${SESSION_ID}`
    );
    await userEvent.click(
      within(
        screen.getAllByTestId("overlord-flow-unchanged-row")[1]!
      ).getByRole("button")
    );
    expect(
      screen.getByTestId("overlord-flow-unchanged-no-session")
    ).toHaveTextContent("terminal term-9");
    expect(screen.queryByTestId("overlord-flow-unchanged-open")).toBeNull();

    // The histogram: one row per pass, oldest first, full breakdown.
    const passes = screen.getAllByTestId("overlord-flow-histogram-pass");
    expect(passes.map((p) => p.getAttribute("data-pass-id"))).toEqual([
      "p-old",
      "p-filtered",
      "p-new",
    ]);
    expect(passes[2]).toHaveTextContent(
      "BUSY 33, STOPPED 3, LIMITED 2, UNKNOWN 2"
    );
    expect(
      screen.getByTestId("overlord-flow-histogram-caption")
    ).toHaveTextContent("1 of the 3 passes were filtered");
  });

  it("renders null metrics as an explicit 'no data', never 0", async () => {
    fetchFlow.mockResolvedValue(NULL_FLOW);
    render(<CoordOverlordFlowPage />);

    const median = await screen.findByTestId("overlord-flow-ttc-median");
    await waitFor(() => expect(median).toHaveTextContent("medianno data"));
    expect(median).toHaveAttribute(
      "title",
      expect.stringMatching(/^no data — /)
    );
    expect(screen.getByTestId("overlord-flow-ttc-p90")).toHaveTextContent(
      "p90no data"
    );
    expect(
      screen.getByTestId("overlord-flow-nudge-progress-rate")
    ).toHaveTextContent("progressedno data");
    expect(
      screen.getByTestId("overlord-flow-nudge-finish-rate")
    ).toHaveTextContent("finishedno data");
    expect(screen.getByTestId("overlord-flow-unknown-share")).toHaveTextContent(
      "unknownno data"
    );
    // Counts coord DID measure stay numbers: zero closed is a real zero.
    expect(screen.getByTestId("overlord-flow-ttc-count")).toHaveTextContent(
      "closed0"
    );
    for (const id of [
      "overlord-flow-ttc-median",
      "overlord-flow-ttc-p90",
      "overlord-flow-nudge-progress-rate",
      "overlord-flow-nudge-finish-rate",
      "overlord-flow-unknown-share",
    ]) {
      expect(screen.getByTestId(id).textContent).not.toMatch(/0%|\b0s\b/);
    }
  });

  it("renders a 503 schema_migration_pending as UNKNOWN everywhere", async () => {
    fetchFlow.mockRejectedValue(
      rejection(503, { error: "schema_migration_pending", detail: "42P01" })
    );
    render(<CoordOverlordFlowPage />);

    const s = await strip();
    await waitFor(() => expect(s).toHaveTextContent("Session flow is unknown"));
    expect(s).toHaveAttribute("data-health-level", "amber");
    expect(s).toHaveTextContent("migration is pending");
    expect(s).toHaveTextContent("passes –");
    expect(s).toHaveTextContent("unchanged –");

    expect(screen.getByTestId("overlord-flow-unknown")).toHaveTextContent(
      "Unknown — coord's pass ledger is not provisioned"
    );
    for (const id of [
      "overlord-flow-ttc-median",
      "overlord-flow-ttc-count",
      "overlord-flow-nudge-progress-rate",
      "overlord-flow-unknown-share",
    ]) {
      const el = screen.getByTestId(id);
      expect(el).toHaveTextContent("–");
      expect(el.textContent).not.toMatch(/\d|no data/);
    }
    expect(
      screen.getByTestId("overlord-flow-unchanged-unknown")
    ).toHaveTextContent("This is not an empty list");
    expect(screen.queryByTestId("overlord-flow-unchanged-empty")).toBeNull();
    expect(
      screen.getByTestId("overlord-flow-histogram-unknown")
    ).toBeInTheDocument();
  });

  it("treats a body that is not a flow answer as UNKNOWN, not empty", async () => {
    fetchFlow.mockResolvedValue({ unexpected: true });
    render(<CoordOverlordFlowPage />);
    const s = await strip();
    await waitFor(() =>
      expect(s).toHaveTextContent("shape this page does not know")
    );
    expect(
      screen.getByTestId("overlord-flow-unchanged-unknown")
    ).toBeInTheDocument();
  });

  it("says an empty unchanged list is a measured empty, in words", async () => {
    fetchFlow.mockResolvedValue({
      ...FULL_FLOW,
      full_passes_by_runner: RUNNERS_ALL_COVERED,
      unchanged: [],
    });
    render(<CoordOverlordFlowPage />);
    const empty = await screen.findByTestId("overlord-flow-unchanged-empty");
    expect(empty).toHaveTextContent("in the last 7 days");
    expect(screen.queryAllByTestId("overlord-flow-unchanged-row")).toHaveLength(
      0
    );
    const s = await strip();
    expect(s).toHaveAttribute("data-health-level", "green");
    expect(s).toHaveTextContent("No session is stuck unchanged");
    expect(s).toHaveTextContent("unchanged 0");
  });

  it("says 'no data' for both latest-pass stats when no pass was recorded", async () => {
    fetchFlow.mockResolvedValue({ ...NULL_FLOW, unknown_share: [] });
    render(<CoordOverlordFlowPage />);
    const share = await screen.findByTestId("overlord-flow-unknown-share");
    await waitFor(() => expect(share).toHaveTextContent("unknownno data"));
    const rows = screen.getByTestId("overlord-flow-unknown-rows");
    expect(rows).toHaveTextContent("of rowsno data");
    expect(rows.textContent).not.toContain("–");
  });

  it.each([
    [
      "two runners with 2 full passes each (total 4)",
      { full_passes_considered: 4, full_passes_by_runner: RUNNERS_TWO_SHORT },
      "2 of 2 runners ran fewer than 3 full passes — their sessions cannot be judged unchanged",
    ],
    [
      "absent per-runner counts",
      { full_passes_considered: 9, full_passes_by_runner: undefined },
      "per-runner full-pass counts not served — unchanged cannot be confirmed",
    ],
  ])(
    "does not read an empty unchanged list over %s as an all-clear",
    async (_label, body, sentence) => {
      fetchFlow.mockResolvedValue({ ...FULL_FLOW, ...body, unchanged: [] });
      render(<CoordOverlordFlowPage />);
      const slot = await screen.findByTestId(
        "overlord-flow-unchanged-not-confirmed"
      );
      // One sentence, no doubled "so".
      expect(slot.textContent).toBe(
        `None listed, but ${sentence}. This is not an all-clear.`
      );
      expect(screen.queryByTestId("overlord-flow-unchanged-empty")).toBeNull();
      const s = await strip();
      expect(s).toHaveAttribute("data-health-level", "amber");
      expect(s).toHaveTextContent("Unchanged sessions cannot be confirmed");
      expect(s).toHaveTextContent(sentence);
      expect(s).not.toHaveTextContent("No session is stuck unchanged");
    }
  );

  it.each([
    [true, "coord capped the rows it read — unchanged cannot be confirmed"],
    [
      undefined,
      "coord did not say whether it capped the rows — unchanged cannot be confirmed",
    ],
  ])(
    "does not state an all-clear over a read whose truncation is %s, even with every runner covered",
    async (truncated, sentence) => {
      fetchFlow.mockResolvedValue({
        ...FULL_FLOW,
        full_passes_by_runner: RUNNERS_ALL_COVERED,
        truncated,
        unchanged: [],
      });
      render(<CoordOverlordFlowPage />);
      const slot = await screen.findByTestId(
        "overlord-flow-unchanged-not-confirmed"
      );
      expect(slot.textContent).toBe(
        `None listed, but ${sentence}. This is not an all-clear.`
      );
      expect(screen.queryByTestId("overlord-flow-unchanged-empty")).toBeNull();
      const s = await strip();
      expect(s).toHaveAttribute("data-health-level", "amber");
      expect(s).not.toHaveTextContent("No session is stuck unchanged");
    }
  );

  it("does not read an empty unchanged list over NO pass as an all-clear", async () => {
    fetchFlow.mockResolvedValue({
      ...NULL_FLOW,
      passes_considered: 0,
      full_passes_considered: 0,
      unknown_share: [],
      verdict_series: [],
    });
    render(<CoordOverlordFlowPage />);
    const noPass = await screen.findByTestId("overlord-flow-unchanged-no-pass");
    expect(noPass).toHaveTextContent(
      "No triage pass recorded in the last 7 days"
    );
    expect(noPass).toHaveTextContent("not an all-clear");
    expect(screen.queryByTestId("overlord-flow-unchanged-empty")).toBeNull();
  });

  it("renders a pass scope it does not know as unknown, not as full", async () => {
    fetchFlow.mockResolvedValue({
      ...FULL_FLOW,
      verdict_series: [
        {
          pass_id: "p-odd",
          started_at: "2026-10-23T20:00:00Z",
          scope: "partial",
          mode: "dry-run",
          histogram: { BUSY: 2 },
        },
      ],
    });
    render(<CoordOverlordFlowPage />);
    const [pass] = await screen.findAllByTestId("overlord-flow-histogram-pass");
    const cells = within(pass!).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("unknown");
    expect(cells[1]).toHaveTextContent("unknown");
    const caption = screen.getByTestId("overlord-flow-histogram-caption");
    expect(caption).toHaveTextContent(
      "1 of the 1 passes sent a scope this page does not know"
    );
    expect(caption).not.toHaveTextContent(
      "Every pass shown screened every terminal"
    );
  });

  it("asks for each window's hours and drops the old numbers on a switch", async () => {
    fetchFlow.mockResolvedValueOnce(FULL_FLOW);
    render(<CoordOverlordFlowPage />);
    await screen.findAllByTestId("overlord-flow-unchanged-row");

    fetchFlow.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await userEvent.click(screen.getByTestId("overlord-flow-window-24h"));
    await waitFor(() =>
      expect(fetchFlow).toHaveBeenLastCalledWith(
        "window_hours=24&unchanged_min_passes=3&group_by=overlord_version"
      )
    );
    // The 7d rows must not survive as the 24h answer: the new read failed
    // before any 24h answer, so it is UNKNOWN.
    await screen.findByTestId("overlord-flow-unchanged-unknown");
    expect(screen.queryAllByTestId("overlord-flow-unchanged-row")).toHaveLength(
      0
    );
    expect(screen.getByTestId("overlord-flow-unknown")).toHaveTextContent(
      "coord could not be reached"
    );

    fetchFlow.mockResolvedValueOnce(NULL_FLOW);
    await userEvent.click(screen.getByTestId("overlord-flow-window-30d"));
    await waitFor(() =>
      expect(fetchFlow).toHaveBeenLastCalledWith(
        "window_hours=720&unchanged_min_passes=3&group_by=overlord_version"
      )
    );
    // What renders for 30d is the 30d answer, in 30d words.
    expect(screen.getByTestId("overlord-flow-window-30d")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await waitFor(() =>
      expect(screen.getByTestId("overlord-flow-ttc-median")).toHaveTextContent(
        "medianno data"
      )
    );
    expect(screen.queryByTestId("overlord-flow-unknown")).toBeNull();
    // NULL_FLOW's one runner ran 2 full passes: too few to see one.
    expect(
      screen.getByTestId("overlord-flow-unchanged-not-confirmed")
    ).toHaveTextContent("1 of 1 runner ran fewer than 3 full passes");
    expect(screen.getByTestId("overlord-flow-histogram")).toHaveTextContent(
      "1 pass in the last 30 days"
    );
    expect(await strip()).toHaveTextContent(
      "Unchanged sessions cannot be confirmed"
    );
  });

  it("keeps the last good numbers on a failed refresh, and says they are stale", async () => {
    fetchFlow.mockResolvedValueOnce(FULL_FLOW);
    render(<CoordOverlordFlowPage />);
    await screen.findAllByTestId("overlord-flow-unchanged-row");

    fetchFlow.mockRejectedValueOnce(
      rejection(503, { error: "db_unavailable" })
    );
    await userEvent.click(screen.getByTestId("overlord-flow-refresh"));
    const s = await strip();
    await waitFor(() =>
      expect(s).toHaveTextContent("Session flow at the last good read")
    );
    expect(s).toHaveAttribute("data-health-level", "amber");
    expect(s).toHaveTextContent("Last refresh failed");
    expect(screen.getAllByTestId("overlord-flow-unchanged-row")).toHaveLength(
      2
    );
    expect(screen.getByTestId("overlord-flow-ttc-median")).toHaveTextContent(
      "1h 30m"
    );
  });

  it("never turns a not-confirmed empty list into a stale all-clear on a failed refresh", async () => {
    // The last good read was empty but NOT confirmed (runners short).
    fetchFlow.mockResolvedValueOnce({
      ...FULL_FLOW,
      full_passes_by_runner: RUNNERS_TWO_SHORT,
      unchanged: [],
    });
    render(<CoordOverlordFlowPage />);
    await screen.findByTestId("overlord-flow-unchanged-not-confirmed");

    fetchFlow.mockRejectedValueOnce(
      rejection(503, { error: "db_unavailable" })
    );
    await userEvent.click(screen.getByTestId("overlord-flow-refresh"));
    const s = await strip();
    await waitFor(() =>
      expect(s).toHaveTextContent("Session flow at the last good read")
    );
    const slot = screen.getByTestId("overlord-flow-unchanged-not-confirmed");
    expect(slot).toHaveTextContent("This is not an all-clear.");
    expect(slot).toHaveTextContent("the latest refresh failed");
    expect(
      screen.queryByTestId("overlord-flow-unchanged-stale-empty")
    ).toBeNull();
  });

  it("says a confirmed empty list is stale on a failed refresh", async () => {
    fetchFlow.mockResolvedValueOnce({
      ...FULL_FLOW,
      full_passes_by_runner: RUNNERS_ALL_COVERED,
      unchanged: [],
    });
    render(<CoordOverlordFlowPage />);
    await screen.findByTestId("overlord-flow-unchanged-empty");

    fetchFlow.mockRejectedValueOnce(
      rejection(503, { error: "db_unavailable" })
    );
    await userEvent.click(screen.getByTestId("overlord-flow-refresh"));
    expect(
      await screen.findByTestId("overlord-flow-unchanged-stale-empty")
    ).toHaveTextContent("None at the last good read");
    expect(screen.queryByTestId("overlord-flow-unchanged-empty")).toBeNull();
  });

  describe("what the first read left unread", () => {
    async function openPanel(testId: string, name: RegExp) {
      const user = userEvent.setup();
      const panel = await screen.findByTestId(testId);
      await user.click(within(panel).getByRole("button", { name }));
      return { user, panel };
    }

    it("traces the time-to-close tile to its sessions, newest close first", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      render(<CoordOverlordFlowPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId("overlord-flow-closed-summary")
        ).toHaveTextContent("4 in the last 7 days")
      );
      const { user } = await openPanel(
        "overlord-flow-closed",
        /closed sessions/i
      );
      const rows = screen.getAllByTestId("overlord-flow-closed-row");
      expect(rows[0]).toHaveTextContent("terminal term-3");
      expect(rows[0]).toHaveTextContent("30m");
      await user.click(within(rows[0]).getByRole("button"));
      expect(
        screen.getByTestId("overlord-flow-closed-no-session")
      ).toBeInTheDocument();
      await user.click(within(rows[1]).getByRole("button"));
      expect(screen.getByTestId("overlord-flow-closed-open")).toHaveAttribute(
        "href",
        `/sessions/${SESSION_ID}`
      );
      expect(
        screen.getByTestId("overlord-flow-closed-later-stop")
      ).toHaveTextContent("it may not have been stopped for all of this time");
      expect(
        screen.getByTestId("overlord-flow-closed-caption")
      ).toHaveTextContent("first stop seen in this window");
    });

    it("says a cut closed list is cut, and how many the tile counted", async () => {
      fetchFlow.mockResolvedValue({
        ...FULL_FLOW,
        time_to_close: {
          ...FULL_FLOW.time_to_close,
          count: 10,
          sessions_truncated: true,
        },
      });
      render(<CoordOverlordFlowPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId("overlord-flow-closed-summary")
        ).toHaveTextContent("4+ in")
      );
      await openPanel("overlord-flow-closed", /closed sessions/i);
      expect(screen.getByTestId("overlord-flow-closed-cut")).toHaveTextContent(
        "The 4 that first stopped most recently, of 10 closed sessions"
      );
    });

    it("renders an unreadable closed list as unknown, not empty", async () => {
      fetchFlow.mockResolvedValue({
        ...FULL_FLOW,
        time_to_close: { ...FULL_FLOW.time_to_close, sessions: [{}] },
      });
      render(<CoordOverlordFlowPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId("overlord-flow-closed-summary")
        ).toHaveTextContent("not read — unknown")
      );
      await openPanel("overlord-flow-closed", /closed sessions/i);
      expect(
        screen.getByTestId("overlord-flow-closed-unknown")
      ).toBeInTheDocument();
    });

    it("compares the numbers per overlord version from the one payload", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      render(<CoordOverlordFlowPage />);
      const rows = await screen.findAllByTestId("overlord-flow-versions-row");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("2d0c39d0d5");
      expect(rows[0]).toHaveTextContent("no data");
      expect(rows[1]).toHaveTextContent("none recorded");
      expect(rows[1]).toHaveTextContent("1h 30m");
      expect(fetchFlow).toHaveBeenCalledTimes(1);
    });

    it("renders absent groups as unknown, not as no versions", async () => {
      fetchFlow.mockResolvedValue({ ...FULL_FLOW, groups: null });
      render(<CoordOverlordFlowPage />);
      expect(
        await screen.findByTestId("overlord-flow-versions-unknown")
      ).toBeInTheDocument();
    });

    it("says no nudge was sent only when none was", async () => {
      fetchFlow.mockResolvedValue({
        ...NULL_FLOW,
        nudge: { ...NULL_FLOW.nudge, nudged: 3, unmeasured_progress: 3 },
      });
      render(<CoordOverlordFlowPage />);
      const rate = await screen.findByTestId(
        "overlord-flow-nudge-progress-rate"
      );
      await waitFor(() => expect(rate).toHaveTextContent("no data"));
      expect(rate.getAttribute("title")).toBe(
        "no data — no nudge in this window has a progress measurement yet"
      );
    });

    it("shows nudges still awaiting a later pass", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      render(<CoordOverlordFlowPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId("overlord-flow-nudge-pending")
        ).toHaveTextContent("1")
      );
    });

    it("says reading, not unreadable, while the first read is in flight", async () => {
      fetchFlow.mockReturnValue(new Promise(() => {}));
      render(<CoordOverlordFlowPage />);
      expect(
        await screen.findByTestId("overlord-flow-versions-reading")
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("overlord-flow-versions-unknown")
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("overlord-flow-histogram-reading")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("overlord-flow-closed-summary")
      ).toHaveTextContent("reading…");
    });

    it("says unreadable once a first read has failed", async () => {
      fetchFlow.mockRejectedValue(rejection(503, { error: "db_unavailable" }));
      render(<CoordOverlordFlowPage />);
      expect(
        await screen.findByTestId("overlord-flow-versions-unknown")
      ).toBeInTheDocument();
    });

    it("carries a capped read's caveat into every list derived from it", async () => {
      fetchFlow.mockResolvedValue({ ...FULL_FLOW, truncated: true });
      render(<CoordOverlordFlowPage />);
      expect(
        await screen.findByTestId("overlord-flow-versions-capped")
      ).toHaveTextContent("capped the passes");
      expect(
        screen.getByTestId("overlord-flow-histogram-caption")
      ).toHaveTextContent("capped the passes");
      await openPanel("overlord-flow-closed", /closed sessions/i);
      expect(
        screen.getByTestId("overlord-flow-closed-capped")
      ).toBeInTheDocument();
    });

    it("marks a version's cut unchanged count as a floor", async () => {
      fetchFlow.mockResolvedValue({
        ...FULL_FLOW,
        groups: [{ ...FULL_FLOW.groups[1], unchanged_truncated: true }],
      });
      render(<CoordOverlordFlowPage />);
      const [row] = await screen.findAllByTestId("overlord-flow-versions-row");
      expect(row).toHaveTextContent("1+");
    });

    it("does not read a version too short to show one as zero unchanged", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      render(<CoordOverlordFlowPage />);
      const [short, long] = await screen.findAllByTestId(
        "overlord-flow-versions-row"
      );
      const cells = (row: HTMLElement) =>
        Array.from(row.children).map((c) => c.textContent);
      // census 1, threshold 3: `unchanged` is the second-last column.
      expect(cells(short).at(-2)).toBe("no data");
      expect(cells(long).at(-2)).toBe("1");
    });

    it("keeps a version's zero unknown when its census count did not arrive", async () => {
      const { census_passes_considered: _gone, ...group } = FULL_FLOW.groups[0];
      fetchFlow.mockResolvedValue({ ...FULL_FLOW, groups: [group] });
      render(<CoordOverlordFlowPage />);
      const [row] = await screen.findAllByTestId("overlord-flow-versions-row");
      expect(Array.from(row.children).at(-2)?.textContent).toBe("–");
    });

    it("marks the closed count a floor when coord did not say the list is whole", async () => {
      const { sessions_truncated: _gone, ...ttc } = FULL_FLOW.time_to_close;
      fetchFlow.mockResolvedValue({ ...FULL_FLOW, time_to_close: ttc });
      render(<CoordOverlordFlowPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId("overlord-flow-closed-summary")
        ).toHaveTextContent("4+ in")
      );
    });

    it("says it does not know whether an unchanged list with rows was cut", async () => {
      const body = { ...FULL_FLOW } as Record<string, unknown>;
      delete body.unchanged_truncated;
      fetchFlow.mockResolvedValue(body);
      render(<CoordOverlordFlowPage />);
      expect(
        await screen.findByTestId("overlord-flow-unchanged-cut-unknown")
      ).toBeInTheDocument();
    });

    it("does not call an unreadable list cut down to zero", async () => {
      fetchFlow.mockResolvedValue({
        ...FULL_FLOW,
        unchanged: [{}],
        unchanged_truncated: true,
      });
      render(<CoordOverlordFlowPage />);
      expect(
        await screen.findByTestId("overlord-flow-unchanged-absent")
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("overlord-flow-unchanged-cut")
      ).not.toBeInTheDocument();
    });

    it("says a cut unchanged list is cut", async () => {
      fetchFlow.mockResolvedValue({ ...FULL_FLOW, unchanged_truncated: true });
      render(<CoordOverlordFlowPage />);
      expect(
        await screen.findByTestId("overlord-flow-unchanged-cut")
      ).toHaveTextContent("these 2 held longest");
    });

    it("says a cut verdict series is cut", async () => {
      fetchFlow.mockResolvedValue({
        ...FULL_FLOW,
        verdict_series_truncated: true,
      });
      render(<CoordOverlordFlowPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId("overlord-flow-histogram-caption")
        ).toHaveTextContent("only the newest 3 passes are drawn")
      );
    });

    it("reads passes only on opening, then a pass's rows on opening it", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockResolvedValue(PASS_LIST);
      fetchPass.mockResolvedValue(PASS_DETAIL);
      render(<CoordOverlordFlowPage />);
      await screen.findAllByTestId("overlord-flow-versions-row");
      expect(fetchPasses).not.toHaveBeenCalled();

      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      await waitFor(() => expect(fetchPasses).toHaveBeenCalledTimes(1));
      expect(fetchPasses.mock.calls[0][0]).toMatch(/^since=.*&limit=200$/);
      const passes = await screen.findAllByTestId("overlord-flow-pass");
      expect(passes).toHaveLength(2);
      expect(passes[0]).toHaveTextContent("3 rows");
      expect(fetchPass).not.toHaveBeenCalled();

      await user.click(within(passes[0]).getByRole("button"));
      await waitFor(() => expect(fetchPass).toHaveBeenCalledWith("p-new"));
      const rows = await screen.findAllByTestId("overlord-flow-pass-row");
      // The terminals the pass could not read lead.
      expect(rows[0]).toHaveTextContent("UNKNOWN");
      expect(rows[0]).toHaveTextContent("terminal term-2");
      const busy = rows.find((r) => r.textContent?.includes("BUSY"));
      expect(within(busy as HTMLElement).getByRole("link")).toHaveAttribute(
        "href",
        `/sessions/${SESSION_ID}`
      );
      expect(busy).toHaveTextContent("input prompt not found on screen");
      const nudged = rows.find((r) => r.textContent?.includes("STOPPED"));
      expect(nudged).toHaveTextContent("nudge (sent_unconfirmed)");
    });

    it("renders a failed pass list as unknown, and leaves the strip alone", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockRejectedValue(
        rejection(503, { error: "db_unavailable" })
      );
      render(<CoordOverlordFlowPage />);
      const s = await strip();
      await waitFor(() =>
        expect(s).toHaveTextContent("2 sessions have not moved")
      );
      await openPanel("overlord-flow-passes", /passes/i);
      expect(
        await screen.findByTestId("overlord-flow-passes-unknown")
      ).toHaveTextContent("This is not an empty list");
      expect(s).toHaveTextContent("2 sessions have not moved");
    });

    it("keeps the last good pass list on a failed refresh, and says so", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockResolvedValueOnce(PASS_LIST);
      fetchPasses.mockRejectedValueOnce(
        rejection(503, { error: "db_unavailable" })
      );
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      await screen.findAllByTestId("overlord-flow-pass");
      await user.click(screen.getByTestId("overlord-flow-refresh"));
      expect(
        await screen.findByTestId("overlord-flow-passes-stale")
      ).toHaveTextContent("last good read");
      expect(screen.getAllByTestId("overlord-flow-pass")).toHaveLength(2);
    });

    it("drops a pass list from the old window when it lands late", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      let landOld: (v: unknown) => void = () => {};
      fetchPasses.mockReturnValueOnce(
        new Promise((resolve) => {
          landOld = resolve;
        })
      );
      fetchPasses.mockResolvedValueOnce({
        ...PASS_LIST,
        passes: [PASS_LIST.passes[1]],
        total_matching: 1,
      });
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      await waitFor(() => expect(fetchPasses).toHaveBeenCalledTimes(1));
      await user.click(screen.getByTestId("overlord-flow-window-24h"));
      await waitFor(() =>
        expect(screen.getAllByTestId("overlord-flow-pass")).toHaveLength(1)
      );
      landOld(PASS_LIST);
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getAllByTestId("overlord-flow-pass")).toHaveLength(1);
    });

    it("drops a pass's rows when they land after it was closed", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockResolvedValue(PASS_LIST);
      let land: (v: unknown) => void = () => {};
      fetchPass.mockReturnValueOnce(
        new Promise((resolve) => {
          land = resolve;
        })
      );
      fetchPass.mockReturnValueOnce(new Promise(() => {}));
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      const [first] = await screen.findAllByTestId("overlord-flow-pass");
      const toggle = within(first).getAllByRole("button")[0];
      await user.click(toggle);
      await waitFor(() => expect(fetchPass).toHaveBeenCalledTimes(1));
      await user.click(toggle);
      await user.click(toggle);
      await waitFor(() => expect(fetchPass).toHaveBeenCalledTimes(2));
      land(PASS_DETAIL);
      await new Promise((r) => setTimeout(r, 0));
      expect(
        screen.queryByTestId("overlord-flow-pass-row")
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("overlord-flow-pass-reading")
      ).toBeInTheDocument();
    });

    it("keeps the newer pass list when an older refresh lands after it", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      let landOlder: (v: unknown) => void = () => {};
      fetchPasses.mockReturnValueOnce(
        new Promise((resolve) => {
          landOlder = resolve;
        })
      );
      fetchPasses.mockResolvedValueOnce(PASS_LIST);
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      await waitFor(() => expect(fetchPasses).toHaveBeenCalledTimes(1));
      await user.click(screen.getByTestId("overlord-flow-refresh"));
      await waitFor(() =>
        expect(screen.getAllByTestId("overlord-flow-pass")).toHaveLength(2)
      );
      landOlder({ ...PASS_LIST, passes: [PASS_LIST.passes[1]] });
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getAllByTestId("overlord-flow-pass")).toHaveLength(2);
    });

    it("keeps an open pass's newer rows when an older refresh lands after them", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockResolvedValue(PASS_LIST);
      let landOlder: (v: unknown) => void = () => {};
      fetchPass.mockReturnValueOnce(
        new Promise((resolve) => {
          landOlder = resolve;
        })
      );
      fetchPass.mockResolvedValueOnce(PASS_DETAIL);
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      const [first] = await screen.findAllByTestId("overlord-flow-pass");
      await user.click(within(first).getAllByRole("button")[0]);
      await waitFor(() => expect(fetchPass).toHaveBeenCalledTimes(1));
      await user.click(screen.getByTestId("overlord-flow-refresh"));
      expect(
        await screen.findAllByTestId("overlord-flow-pass-row")
      ).toHaveLength(3);
      landOlder({
        ok: true,
        pass: { ...PASS_DETAIL.pass, rows: PASS_DETAIL.pass.rows.slice(0, 1) },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getAllByTestId("overlord-flow-pass-row")).toHaveLength(3);
    });

    it("lets a refresh recover an open pass that failed to read", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockResolvedValue(PASS_LIST);
      fetchPass.mockRejectedValueOnce(
        rejection(503, { error: "db_unavailable" })
      );
      fetchPass.mockResolvedValueOnce(PASS_DETAIL);
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      const [first] = await screen.findAllByTestId("overlord-flow-pass");
      await user.click(within(first).getAllByRole("button")[0]);
      await screen.findByTestId("overlord-flow-pass-unknown");
      await user.click(screen.getByTestId("overlord-flow-refresh"));
      expect(
        await screen.findAllByTestId("overlord-flow-pass-row")
      ).toHaveLength(3);
      expect(
        screen.queryByTestId("overlord-flow-pass-unknown")
      ).not.toBeInTheDocument();
    });

    it("keeps an open pass's last good rows on a failed refresh, and says so", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockResolvedValue(PASS_LIST);
      fetchPass.mockResolvedValueOnce(PASS_DETAIL);
      fetchPass.mockRejectedValueOnce(
        rejection(503, { error: "db_unavailable" })
      );
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      const [first] = await screen.findAllByTestId("overlord-flow-pass");
      await user.click(within(first).getAllByRole("button")[0]);
      await screen.findAllByTestId("overlord-flow-pass-row");
      await user.click(screen.getByTestId("overlord-flow-refresh"));
      expect(
        await screen.findByTestId("overlord-flow-pass-stale")
      ).toHaveTextContent("last good read");
      expect(screen.getAllByTestId("overlord-flow-pass-row")).toHaveLength(3);
    });

    it("renders a failed read of one pass as unknown, not as no rows", async () => {
      fetchFlow.mockResolvedValue(FULL_FLOW);
      fetchPasses.mockResolvedValue(PASS_LIST);
      fetchPass.mockRejectedValue(rejection(404, { error: "pass_not_found" }));
      render(<CoordOverlordFlowPage />);
      const { user } = await openPanel("overlord-flow-passes", /passes/i);
      const passes = await screen.findAllByTestId("overlord-flow-pass");
      await user.click(within(passes[0]).getByRole("button"));
      expect(
        await screen.findByTestId("overlord-flow-pass-unknown")
      ).toHaveTextContent("which is not the same as it having none");
    });
  });
});
