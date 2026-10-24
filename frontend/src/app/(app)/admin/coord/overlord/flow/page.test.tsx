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
import { FULL_FLOW, NULL_FLOW, SESSION_ID } from "./__fixtures__/flow";

// The page reads through the typed client; its request shape is pinned in
// `lib/api/operations/overlordFlow.test.ts`. The mock receives the query so
// the window assertions can read what the page asked for.
const fetchFlow = vi.fn();
vi.mock("@/lib/api/operations/overlordFlow", () => ({
  fetchOverlordFlow: (query: string) => fetchFlow(query),
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
    expect(fetchFlow).toHaveBeenCalledWith("window_hours=168");

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
    fetchFlow.mockResolvedValue({ ...FULL_FLOW, unchanged: [] });
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

  it("asks for each window's hours and drops the old numbers on a switch", async () => {
    fetchFlow.mockResolvedValueOnce(FULL_FLOW);
    render(<CoordOverlordFlowPage />);
    await screen.findAllByTestId("overlord-flow-unchanged-row");

    fetchFlow.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await userEvent.click(screen.getByTestId("overlord-flow-window-24h"));
    await waitFor(() =>
      expect(fetchFlow).toHaveBeenLastCalledWith("window_hours=24")
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
      expect(fetchFlow).toHaveBeenLastCalledWith("window_hours=720")
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
});
