/**
 * `/admin/coord/operator-touches` — the payload reaches the screen, and every
 * shape of not-knowing reaches it as unknown.
 *
 * The derivations are pinned in `_lib/operatorTouchStatus.test.ts`; this file
 * proves the page WIRES them: one read feeds the strip, the aggregate and the
 * feed (R1 — asserted by counting reads), an empty store says "Not yet
 * measured" in all three places, and coord's typed 503 reads as unknown rather
 * than as an empty store.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => httpGet(...args) },
}));

import CoordOperatorTouchesPage from "./page";

const VERDICT = {
  verdict: "operator",
  reason: "4 operator-reaching touch(es) in the last 7 days",
  inputs: {},
  unknown_inputs: [
    "emission_gap: dropped_unacked is not published to coord (Plan B §2g)",
  ],
  computed_at: "2026-09-27T12:00:00Z",
};

const EMPTY = {
  aggregate_included: true,
  measurement: "not_yet_measured",
  window_days: 7,
  measured_since: null,
  covered_days: null,
  totals: { touches: 0, operator_reaching: 0, agent_dispatchable: 0, unknown: 0 },
  agent_absorbed_rate: null,
  unknown_share: null,
  policy_authorized_split: { yes: 0, no: 0, unknown: 0 },
  reason_classes: [],
  touches: [],
  next_cursor: null,
  constraint_verdict: { ...VERDICT, verdict: "unknown" },
};

function touch(id: string, over: Record<string, unknown> = {}) {
  return {
    touch_id: id,
    kind: "question",
    source: "runner_hook",
    reason_code: "design_fork",
    policy_authorized: "yes",
    disposition: "operator_reaching",
    emitted_at: new Date(Date.now() - 3_600_000).toISOString(),
    resolved_at: null,
    resolution: null,
    work_unit_id: null,
    gate_id: null,
    answer_via: { kind: "question", id: `q-${id}`, state: "pending" },
    ...over,
  };
}

const MEASURED = {
  ...EMPTY,
  measurement: "measured",
  measured_since: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  covered_days: 3,
  totals: { touches: 10, operator_reaching: 4, agent_dispatchable: 5, unknown: 1 },
  agent_absorbed_rate: 0.5,
  unknown_share: 0.1,
  policy_authorized_split: { yes: 4, no: 5, unknown: 1 },
  reason_classes: [
    {
      reason_code: "design_fork",
      count: 3,
      share: 0.3,
      operator_reaching: 3,
      agent_dispatchable: 0,
      unknown: 0,
    },
    {
      reason_code: "question_policy_already_answers",
      count: 7,
      share: 0.7,
      operator_reaching: 1,
      agent_dispatchable: 5,
      unknown: 1,
    },
  ],
  touches: [touch("t1"), touch("t2", { disposition: "agent_dispatchable" })],
  next_cursor: "2026-09-27T11:00:00.000000Z_t2",
  constraint_verdict: VERDICT,
};

beforeEach(() => {
  httpGet.mockReset();
});

describe("/admin/coord/operator-touches", () => {
  it("renders an empty store as Not yet measured — strip, aggregate and feed", async () => {
    httpGet.mockResolvedValue(EMPTY);
    render(<CoordOperatorTouchesPage />);

    const strip = await screen.findByTestId("coord-operator-touches-health");
    await waitFor(() =>
      expect(strip).toHaveTextContent(
        "Not yet measured — the touch emitter has not run"
      )
    );
    expect(strip).toHaveAttribute("data-health-level", "amber");
    expect(strip).toHaveTextContent("touches –");
    expect(
      screen.getByTestId("operator-touches-not-measured")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("operator-touches-empty-not-measured")
    ).toBeInTheDocument();
    // Tab counts are dashes, not zeros, while nothing is measured (R6).
    expect(screen.getByTestId("operator-touches-filter-all")).toHaveTextContent(
      "–"
    );
    // R1: one read fed the strip, the aggregate and the feed.
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(String(httpGet.mock.calls[0]?.[0])).toContain(
      "/api/v1/operations/coord/operator-touches?window_days=7"
    );
  });

  it("ranks the reason classes by share and keeps wire words off the rows", async () => {
    httpGet.mockResolvedValue(MEASURED);
    render(<CoordOperatorTouchesPage />);

    const list = await screen.findByTestId("operator-touches-reason-classes");
    const lines = within(list).getAllByRole("listitem");
    expect(lines.map((l) => l.getAttribute("data-share-key"))).toEqual([
      "question_policy_already_answers",
      "design_fork",
    ]);
    expect(lines[0]).toHaveTextContent("Asked what policy already answers");
    expect(lines[0]).toHaveTextContent("70.0%");

    const rows = screen.getAllByTestId("operator-touch-row");
    expect(rows).toHaveLength(2);
    // R8: the collapsed row carries human words, never coord's vocabulary.
    for (const row of rows) {
      expect(row.textContent ?? "").not.toMatch(
        /design_fork|operator_reaching|agent_dispatchable|policy_authorized/
      );
    }
    expect(rows[0]).toHaveTextContent("Reached you");
    expect(rows[1]).toHaveTextContent("Agent can handle");

    // The strip states the verdict calmly with the ask in words.
    const strip = screen.getByTestId("coord-operator-touches-health");
    expect(strip).toHaveAttribute("data-health-level", "green");
    expect(strip).toHaveTextContent(/You are the constraint — 4 reached you/);
    expect(screen.getByTestId("operator-touches-filter-operator_reaching"))
      .toHaveTextContent("4");
  });

  it("shows the machine vocabulary only in the expanded detail (R5)", async () => {
    httpGet.mockResolvedValue(MEASURED);
    const user = userEvent.setup();
    render(<CoordOperatorTouchesPage />);

    const rows = await screen.findAllByTestId("operator-touch-row");
    await user.click(within(rows[0]!).getAllByRole("button")[0]!);
    const raw = await screen.findByTestId("operator-touch-raw");
    expect(raw).toHaveTextContent("reason_code: design_fork");
    expect(raw).toHaveTextContent("disposition: operator_reaching");
    expect(screen.getByTestId("operator-touch-open-question")).toHaveAttribute(
      "href",
      "/admin/coord/questions/q-t1"
    );
  });

  it("pages older touches with coord's cursor and keeps the aggregate", async () => {
    httpGet
      .mockResolvedValueOnce(MEASURED)
      .mockResolvedValueOnce({
        aggregate_included: false,
        measurement: null,
        totals: null,
        reason_classes: null,
        constraint_verdict: null,
        touches: [touch("t3")],
        next_cursor: null,
      });
    const user = userEvent.setup();
    render(<CoordOperatorTouchesPage />);

    await user.click(await screen.findByTestId("operator-touches-older"));
    await waitFor(() =>
      expect(screen.getAllByTestId("operator-touch-row")).toHaveLength(3)
    );
    expect(String(httpGet.mock.calls[1]?.[0])).toContain(
      "before=2026-09-27T11%3A00%3A00.000000Z_t2"
    );
    // The page-2 payload carried no aggregate; the strip still reads page 1's.
    expect(screen.getByTestId("coord-operator-touches-health")).toHaveTextContent(
      "touches 10"
    );
    expect(screen.queryByTestId("operator-touches-older")).toBeNull();
  });

  it("renders coord's 503 as unknown — never as an empty store", async () => {
    httpGet.mockRejectedValue(
      new Error(
        'GET /api/v1/operations/coord/operator-touches?window_days=7 failed: 503 - {"error":"db_unavailable","detail":"pool"}'
      )
    );
    render(<CoordOperatorTouchesPage />);

    const unknown = await screen.findByTestId("operator-touches-unknown");
    expect(unknown).toHaveTextContent("database did not answer");
    expect(unknown).toHaveTextContent("This is not an empty store");
    const strip = screen.getByTestId("coord-operator-touches-health");
    expect(strip).toHaveTextContent("Operator touches could not be read");
    expect(strip).toHaveTextContent("touches –");
    expect(screen.queryByTestId("operator-touches-empty")).toBeNull();
  });

  it("sends the disposition filter and keeps the tab counts from the aggregate", async () => {
    httpGet.mockResolvedValue(MEASURED);
    const user = userEvent.setup();
    render(<CoordOperatorTouchesPage />);
    await screen.findAllByTestId("operator-touch-row");

    await user.click(screen.getByTestId("operator-touches-filter-agent_dispatchable"));
    await waitFor(() => expect(httpGet).toHaveBeenCalledTimes(2));
    expect(String(httpGet.mock.calls[1]?.[0])).toContain(
      "disposition=agent_dispatchable"
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("operator-touches-filter-operator_reaching")
      ).toHaveTextContent("4")
    );
  });

  it("does not claim 'no match' for a scan-bounded empty page with a cursor", async () => {
    httpGet.mockResolvedValue({
      ...MEASURED,
      touches: [],
      next_cursor: "2026-09-20T00:00:00.000000Z_scan",
    });
    render(<CoordOperatorTouchesPage />);
    expect(
      await screen.findByTestId("operator-touches-empty-scan-bounded")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("operator-touches-empty")).toBeNull();
    expect(screen.getByTestId("operator-touches-older")).toBeEnabled();
  });

  it("never splices an older page fetched before a refresh onto the new page 1", async () => {
    let releaseOlder: (v: unknown) => void = () => {};
    httpGet
      .mockResolvedValueOnce(MEASURED)
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseOlder = resolve))
      )
      .mockResolvedValueOnce({ ...MEASURED, touches: [touch("fresh")], next_cursor: null });
    const user = userEvent.setup();
    render(<CoordOperatorTouchesPage />);

    await user.click(await screen.findByTestId("operator-touches-older"));
    await user.click(screen.getByTestId("operator-touches-refresh"));
    await waitFor(() =>
      expect(screen.getAllByTestId("operator-touch-row")).toHaveLength(1)
    );
    // The stale older page lands AFTER the refresh; it must be discarded.
    releaseOlder({ aggregate_included: false, touches: [touch("stale")], next_cursor: "x" });
    await new Promise((r) => setTimeout(r, 20));
    const rows = screen.getAllByTestId("operator-touch-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-row-key")).toBe("fresh");
    expect(screen.queryByTestId("operator-touches-older")).toBeNull();
  });

  it("names a failed older-page read without dropping the rows already shown", async () => {
    httpGet
      .mockResolvedValueOnce(MEASURED)
      .mockRejectedValueOnce(
        new Error('GET /x failed: 503 - {"error":"db_unavailable","detail":"p"}')
      );
    const user = userEvent.setup();
    render(<CoordOperatorTouchesPage />);
    await user.click(await screen.findByTestId("operator-touches-older"));
    expect(
      await screen.findByText(/Older touches could not be read — .*database did not answer/)
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("operator-touch-row")).toHaveLength(2);
    expect(screen.getByTestId("operator-touches-older")).toBeEnabled();
  });

  it("keeps a valid older page when the refresh racing it fails", async () => {
    let releaseOlder: (v: unknown) => void = () => {};
    httpGet
      .mockResolvedValueOnce(MEASURED)
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseOlder = resolve))
      )
      .mockRejectedValueOnce(new Error("GET /x failed: 503 - {\"error\":\"db_unavailable\"}"));
    const user = userEvent.setup();
    render(<CoordOperatorTouchesPage />);

    await user.click(await screen.findByTestId("operator-touches-older"));
    await user.click(screen.getByTestId("operator-touches-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("coord-operator-touches-health")).toHaveTextContent(
        "These numbers stopped updating"
      )
    );
    releaseOlder({ aggregate_included: false, touches: [touch("t3")], next_cursor: null });
    await waitFor(() =>
      expect(screen.getAllByTestId("operator-touch-row")).toHaveLength(3)
    );
  });
});
