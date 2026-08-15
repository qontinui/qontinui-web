/**
 * /admin/coord/alerts — the rebuilt Alerts tab.
 *
 * Component-level proof of the three contracts the plan
 * `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md` makes hard rules
 * (the derivation itself is covered in `alertStatus.test.ts`):
 *
 *   1. NO UUID in the default view — not the `alert_key`, not a sliced device
 *      id, not a UUID smuggled in through coord's own summary string.
 *   2. The hoisted unresolved-critical count comes from the API's
 *      `total_count`, and a MISSING `total_count` renders as `≥N`, never
 *      silently as the truth.
 *   3. Expanding a row shows why / what to do; collapsing UNMOUNTS it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => httpGet(...args) },
}));

import CoordAlertsPage from "./page";

const DEVICE = "c79a07d5-7e40-49b4-87fa-554c749f9644";
/** Mirrors `POLL_INTERVAL_MS` in page.tsx (not exported — it is page-private). */
const POLL_MS = 10_000;

/** A live 2026-08-14 `stale_primary_tree` row, UUIDs and all. */
const STALE_TREE = {
  id: 11,
  alert_key: `stale-tree:${DEVICE}:qontinui-runner-wt-mtobs`,
  severity: "critical",
  kind: "stale_primary_tree",
  device_id: DEVICE,
  summary: `primary tree ${DEVICE}/qontinui/qontinui-web is stale (behind) — branch=main`,
  first_seen_at: "2026-08-14T20:00:00Z",
  last_seen_at: "2026-08-14T21:41:00Z",
  occurrences: 42,
  resolved_at: null,
  detail: {
    device_id: DEVICE,
    repo: "qontinui/qontinui-web",
    branch: "main",
    default_branch: "main",
    behind_default_count: 298,
    tree_clean: false,
    untracked_count: 3,
  },
};

/** Route the page read and the separate critical-total read. */
function mockApi(page: unknown, criticalTotal: unknown) {
  httpGet.mockImplementation((url: unknown) =>
    Promise.resolve(
      String(url).includes("severity=critical") ? criticalTotal : page
    )
  );
}

describe("CoordAlertsPage", () => {
  beforeEach(() => {
    httpGet.mockReset();
    mockApi(
      {
        alerts: [STALE_TREE],
        count: 1,
        total_count: 1643,
        next_cursor: null,
        kinds: ["stale_primary_tree", "stale_wip", "red_main"],
      },
      { alerts: [], total_count: 637 }
    );
  });

  it("renders NO UUID in the default view", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    // `innerHTML`, NOT `textContent`: the latter excludes attribute values, so
    // a UUID smuggled into a `title=` (this page sets several from the same
    // derived strings) would sail straight through the assertion.
    const html = document.body.innerHTML;
    expect(html).not.toContain(DEVICE);
    // And specifically not the dedup identity, sliced or whole.
    expect(html).not.toContain("stale-tree:");
    expect(html).not.toContain(DEVICE.slice(0, 8));
  });

  it("identifies the row by repo and branch, and states one plain-language status", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    expect(screen.getByTestId("coord-alert-subject")).toHaveTextContent(
      "qontinui/qontinui-web · main"
    );
    const badge = screen.getByTestId("coord-alert-row").querySelector(
      "[data-status-kind]"
    );
    expect(badge).toHaveAttribute("data-status-kind", "stale-tree");
    expect(badge).toHaveTextContent("Checkout is stale");
    expect(screen.getByTestId("coord-alert-reason")).toHaveTextContent(
      "298 commits behind main"
    );
  });

  it("renders timestamps through the RowTime idiom, never a raw ISO string", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    expect(screen.getAllByTestId("row-time").length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(
      "2026-08-14T21:41:00Z"
    );
  });

  it("hoists the unresolved-critical count from total_count, not alerts.length", async () => {
    render(<CoordAlertsPage />);

    const count = await screen.findByTestId("coord-alerts-critical-count");
    await waitFor(() => expect(count).toHaveTextContent("637 critical"));
    expect(count.textContent).not.toContain("≥");
    expect(count).toHaveAttribute("data-total-known", "true");
    // The bug this replaces: one row is served, so `alerts.length` would say 1.
    expect(count.textContent).not.toContain("1 critical");
  });

  it("degrades a missing total_count to ≥, over the CRITICAL subset only", async () => {
    // An un-upgraded coord reads only `include_resolved` and `source`, so it
    // drops BOTH `severity` and `limit` and answers every request with the
    // same unfiltered, mixed-severity window. Counting that array's LENGTH and
    // labelling it "critical" is the truncated-sample bug this page exists to
    // kill, reintroduced in the fallback — a tenant with 1 critical and 3
    // warnings must read ≥1, never ≥4.
    const mixedWindow = {
      alerts: [
        STALE_TREE, // critical
        { ...STALE_TREE, id: 12, alert_key: "stale-wip:a", severity: "warning" },
        { ...STALE_TREE, id: 13, alert_key: "stale-wip:b", severity: "warning" },
        { ...STALE_TREE, id: 14, alert_key: "stale-wip:c", severity: "info" },
      ],
    };
    mockApi(mixedWindow, mixedWindow);
    render(<CoordAlertsPage />);

    const count = await screen.findByTestId("coord-alerts-critical-count");
    await waitFor(() => expect(count.textContent).toContain("≥1 critical"));
    expect(count.textContent).not.toContain("≥4");
    expect(count).toHaveAttribute("data-total-known", "false");

    const match = screen.getByTestId("coord-alerts-match-count");
    expect(match).toHaveAttribute("data-total-known", "false");
    expect(match.textContent).toContain("≥");
  });

  it("does not paint red when the degraded window holds no critical", async () => {
    const warningsOnly = {
      alerts: [{ ...STALE_TREE, severity: "warning" }],
    };
    mockApi(warningsOnly, warningsOnly);
    render(<CoordAlertsPage />);

    const count = await screen.findByTestId("coord-alerts-critical-count");
    await waitFor(() => expect(count.textContent).toContain("≥0 critical"));
    expect(count.className).not.toContain("text-red-200");
  });

  it("says 'no alerts matched' only when a read actually answered", async () => {
    // A failed first load leaves the list empty for a reason that is UNKNOWN,
    // not "nothing matched".
    httpGet.mockReset();
    httpGet.mockRejectedValue(new Error("gateway timeout"));
    render(<CoordAlertsPage />);

    await screen.findByText(/Failed to load/);
    expect(screen.queryByText(/No alerts matching filters/)).toBeNull();
  });

  it("asks for the new paging vocabulary", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    const pageCall = httpGet.mock.calls
      .map((c) => String(c[0]))
      .find((u) => !u.includes("severity=critical"));
    expect(pageCall).toContain("limit=");
    expect(pageCall).toContain("include_resolved=false");
  });

  it("expands to why / what to do, and collapsing UNMOUNTS the detail", async () => {
    render(<CoordAlertsPage />);
    const row = await screen.findByTestId("coord-alert-row");

    // Collapsed by default: the detail is not merely hidden, it is absent.
    expect(screen.queryByTestId("coord-alert-guidance")).not.toBeInTheDocument();

    const trigger = row.querySelector("button");
    fireEvent.click(trigger!);
    expect(await screen.findByTestId("coord-alert-why")).toHaveTextContent(
      "298 commits behind main"
    );
    expect(screen.getByTestId("coord-alert-guidance")).toHaveTextContent(
      /Pull the checkout/
    );
    // The one admissible UUID — expanded, labelled, actionable.
    expect(screen.getByTestId("coord-alert-device-id")).toHaveTextContent(
      DEVICE
    );

    fireEvent.click(trigger!);
    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-alert-guidance")
      ).not.toBeInTheDocument()
    );
  });
});

// ----------------------------------------------------------------------------
// Concurrency: a superseded response must never paint.
//
// Two live races, both closed by the generation counter in `page.tsx`.
// ----------------------------------------------------------------------------
describe("CoordAlertsPage concurrency", () => {
  const PAGE_2 = {
    ...STALE_TREE,
    id: 99,
    alert_key: "stale-wip:qontinui-web-wt-alerts",
    kind: "stale_wip",
    detail: { repo: "qontinui/qontinui-runner", branch: "feat/page-two" },
  };

  beforeEach(() => {
    httpGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not let an in-flight page-1 poll discard a just-loaded page 2", async () => {
    vi.useFakeTimers();
    let releaseStalePoll: (v: unknown) => void = () => {};
    const stalePoll = new Promise((resolve) => {
      releaseStalePoll = resolve;
    });
    let listReads = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("severity=critical")) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      if (u.includes("cursor=")) {
        return Promise.resolve({
          alerts: [PAGE_2],
          total_count: 2,
          next_cursor: null,
        });
      }
      listReads += 1;
      // The FIRST list read is the mount; the second is the 10s poller, and it
      // is the one we hold open across the operator's "Load more" click.
      return listReads === 1
        ? Promise.resolve({
            alerts: [STALE_TREE],
            total_count: 2,
            next_cursor: "c1",
          })
        : stalePoll;
    });

    render(<CoordAlertsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getAllByTestId("coord-alert-row")).toHaveLength(1);

    // The poller fires and hangs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(listReads).toBe(2);

    // The operator pages while that read is still open.
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-alerts-load-more"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getAllByTestId("coord-alert-row")).toHaveLength(2);

    // ...and the stale page-1 answer finally lands. Under the old code this
    // did `setPages([page1])` — page 2 vanished and the cursor rewound, so the
    // button looked broken, every 10s.
    await act(async () => {
      releaseStalePoll({
        alerts: [STALE_TREE],
        total_count: 2,
        next_cursor: "c1",
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getAllByTestId("coord-alert-row")).toHaveLength(2);
    expect(screen.getByTestId("coord-alerts-poll-paused")).toBeInTheDocument();
  });

  it("drops a slow response from a superseded filter", async () => {
    vi.useFakeTimers();
    let releaseSlow: (v: unknown) => void = () => {};
    const slow = new Promise((resolve) => {
      releaseSlow = resolve;
    });
    const STALE_FILTER_ROW = {
      ...STALE_TREE,
      id: 51,
      detail: { repo: "qontinui/SUPERSEDED", branch: "old-filter" },
    };
    let listReads = 0;
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("severity=critical")) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      listReads += 1;
      if (listReads === 1) {
        return Promise.resolve({
          alerts: [STALE_TREE],
          total_count: 1,
          next_cursor: null,
        });
      }
      // Read 2 = the first toggle (slow). Read 3 = the second toggle (fast).
      return listReads === 2
        ? slow
        : Promise.resolve({ alerts: [PAGE_2], total_count: 1, next_cursor: null });
    });

    render(<CoordAlertsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const toggle = screen.getByTestId("coord-alerts-include-resolved");
    await act(async () => {
      fireEvent.click(toggle); // include_resolved=true  → slow read
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fireEvent.click(toggle); // back to false          → fast read wins
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("coord-alert-subject")).toHaveTextContent(
      "qontinui/qontinui-runner"
    );

    // The superseded filter's answer lands last and must be discarded.
    await act(async () => {
      releaseSlow({
        alerts: [STALE_FILTER_ROW],
        total_count: 1,
        next_cursor: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.body.innerHTML).not.toContain("SUPERSEDED");
  });
});
