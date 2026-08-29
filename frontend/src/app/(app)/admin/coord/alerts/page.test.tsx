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

/**
 * The hoisted unresolved-critical read, told apart from the LIST read.
 *
 * Discriminated on `limit=1` — the probe's own page size — and NOT on
 * `severity=critical`, which both reads can now carry: the severity filter is
 * multi-select, so selecting the critical chip puts that string on the list
 * request too, and routing on it would answer the list with the probe's
 * payload for reasons unrelated to whatever the test is asserting.
 */
function isCriticalProbe(url: unknown): boolean {
  return new URLSearchParams(String(url).split("?")[1] ?? "").get("limit") === "1";
}

/** Route the page read and the separate critical-total read. */
function mockApi(page: unknown, criticalTotal: unknown) {
  httpGet.mockImplementation((url: unknown) =>
    Promise.resolve(isCriticalProbe(url) ? criticalTotal : page)
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
      .find((u) => !isCriticalProbe(u));
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
      if (isCriticalProbe(u)) {
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
      if (isCriticalProbe(u)) {
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

// ----------------------------------------------------------------------------
// Multi-select filters.
//
// `severity` and `kind` are REPEATABLE on `/operations/alerts` (the proxy
// declares them `list[str]`), and the first cut of this page put a
// single-select `<Select>` in front of them, so the multi-valued half of the
// endpoint was unreachable. These assert the wire shape, not the styling: what
// matters is that two selected values leave as TWO keys, and that "nothing
// selected" sends no key at all rather than an empty one.
// ----------------------------------------------------------------------------
describe("CoordAlertsPage filters", () => {
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

  /**
   * The most recent LIST read — everything that is not the hoisted-count probe
   * (see {@link isCriticalProbe}).
   *
   * THROWS rather than returning `""` when no list read has happened. Three of
   * the assertions below are negative (`not.toContain("severity=")`), and every
   * one of them passes vacuously against an empty string — so a silent `""`
   * would turn "the page sends no severity key" into "the page sent nothing at
   * all, and we did not notice".
   */
  function lastListUrl(): string {
    const urls = httpGet.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => !isCriticalProbe(u));
    if (urls.length === 0) throw new Error("no list read was made");
    return urls[urls.length - 1];
  }

  it("sends no severity or kind param while nothing is selected", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    const u = lastListUrl();
    // Not `severity=` either: an explicitly-blank param asks coord for the
    // rows whose severity is the empty string, which is why the proxy drops
    // blanks. The page must not send one in the first place.
    expect(u).not.toContain("severity=");
    expect(u).not.toContain("kind=");
    expect(screen.getByTestId("coord-alerts-severity-filter")).toHaveAttribute(
      "data-selected",
      ""
    );
  });

  it("sends each selected severity as its OWN repeated key", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    fireEvent.click(screen.getByTestId("coord-alerts-severity-filter-warning"));
    await waitFor(() => expect(lastListUrl()).toContain("severity=warning"));

    fireEvent.click(screen.getByTestId("coord-alerts-severity-filter-info"));
    await waitFor(() => {
      const u = lastListUrl();
      // Two keys, not one comma-joined value: `?severity=info&severity=warning`
      // is what httpx re-emits as repeated keys and what coord parses. A
      // `severity=info,warning` would match nothing, silently.
      expect(u).toContain("severity=info");
      expect(u).toContain("severity=warning");
      expect(u).not.toContain("severity=critical");
    });
    expect(screen.getByTestId("coord-alerts-severity-filter")).toHaveAttribute(
      "data-selected",
      "info,warning"
    );
  });

  it("multi-selects kinds from the API-served vocabulary", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    // The chips ARE the served list (`kinds` in the response), title-cased.
    expect(
      screen.getByTestId("coord-alerts-kind-filter-red_main")
    ).toHaveTextContent("Red Main");

    fireEvent.click(screen.getByTestId("coord-alerts-kind-filter-red_main"));
    fireEvent.click(screen.getByTestId("coord-alerts-kind-filter-stale_wip"));
    await waitFor(() => {
      const u = lastListUrl();
      expect(u).toContain("kind=red_main");
      expect(u).toContain("kind=stale_wip");
    });
  });

  it("de-selects on a second click, and the all chip clears everything", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    const warning = screen.getByTestId("coord-alerts-severity-filter-warning");
    fireEvent.click(warning);
    await waitFor(() => expect(lastListUrl()).toContain("severity=warning"));
    expect(warning).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(warning);
    await waitFor(() => expect(lastListUrl()).not.toContain("severity="));

    fireEvent.click(screen.getByTestId("coord-alerts-kind-filter-red_main"));
    await waitFor(() => expect(lastListUrl()).toContain("kind=red_main"));
    fireEvent.click(screen.getByTestId("coord-alerts-kind-filter-all"));
    await waitFor(() => expect(lastListUrl()).not.toContain("kind="));
  });

  it("keeps a filtered-on kind selectable after its last live row resolves", async () => {
    // Coord's served list is "kinds with a live row". Resolving the last
    // `red_main` row drops it from that list — but the filter is still ON, so
    // the chip has to survive or the page is filtering with no control saying
    // so. The selection is unioned into the options for exactly this.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (isCriticalProbe(u)) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      return Promise.resolve({
        alerts: u.includes("kind=red_main") ? [] : [STALE_TREE],
        total_count: u.includes("kind=red_main") ? 0 : 1643,
        next_cursor: null,
        // The served vocabulary no longer names red_main.
        kinds: u.includes("kind=red_main")
          ? ["stale_primary_tree"]
          : ["stale_primary_tree", "stale_wip", "red_main"],
      });
    });

    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");
    fireEvent.click(screen.getByTestId("coord-alerts-kind-filter-red_main"));

    // Wait for the SHRUNKEN vocabulary to have painted, not merely for the
    // request to have been made: `stale_wip` disappearing is the only proof
    // that the narrowed `kinds` response committed, and without it the
    // surviving `red_main` chip is evidence of nothing.
    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-alerts-kind-filter-stale_wip")
      ).toBeNull()
    );
    expect(lastListUrl()).toContain("kind=red_main");
    expect(
      screen.getByTestId("coord-alerts-kind-filter-red_main")
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps every kind ever seen selectable when coord serves no vocabulary", async () => {
    // The degraded path. With no served `kinds` the options come from the
    // rows — and the rows are ALREADY filtered by the selection, so a
    // per-response derivation collapses to the one selected kind and a second
    // can never be added. That would leave the multi-select unreachable on
    // exactly the deployments this page degrades for.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (isCriticalProbe(u)) {
        return Promise.resolve({ alerts: [] });
      }
      const filtered = u.includes("kind=");
      return Promise.resolve({
        // No `total_count`, no `next_cursor`, no `kinds` — the old shape.
        alerts: filtered
          ? [STALE_TREE]
          : [STALE_TREE, { ...STALE_TREE, id: 77, kind: "red_main" }],
      });
    });

    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alerts-kind-filter-red_main");

    fireEvent.click(
      screen.getByTestId("coord-alerts-kind-filter-stale_primary_tree")
    );
    // Wait for the FILTERED window to have committed — two rows unfiltered,
    // one filtered. Waiting on the request URL alone is satisfied at request
    // time, so `red_main` could still be on screen from the previous window
    // and the test would pass against the very per-window derivation it exists
    // to rule out.
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-alert-row")).toHaveLength(1)
    );
    expect(lastListUrl()).toContain("kind=stale_primary_tree");

    // The response no longer carries a red_main row, and its chip must still
    // be there to be added to the filter.
    const redMain = screen.getByTestId("coord-alerts-kind-filter-red_main");
    fireEvent.click(redMain);
    await waitFor(() => {
      const u = lastListUrl();
      expect(u).toContain("kind=red_main");
      expect(u).toContain("kind=stale_primary_tree");
    });
  });

  it("calls a SERVED but empty kind list an answer, not a missing one", async () => {
    // The three-state read. `kinds: []` is coord saying it looked and this
    // tenant has no alerts in scope — the state a healthy fleet is IN. Keyed
    // on length, that was indistinguishable from `kinds` absent, so the page
    // told an operator with nothing wrong that their coord build was old.
    httpGet.mockImplementation((url: unknown) => {
      if (isCriticalProbe(String(url))) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      return Promise.resolve({
        alerts: [],
        total_count: 0,
        next_cursor: null,
        kinds: [],
      });
    });

    render(<CoordAlertsPage />);
    // Wait for the RESPONSE to have committed, not merely for the count
    // element to exist: before the first answer it renders "counting…" and
    // `head` is still null, which is legitimately the not-served state. An
    // assertion that ran there would be testing the pre-fetch render.
    await waitFor(() =>
      expect(screen.getByTestId("coord-alerts-match-count")).toHaveTextContent(
        "showing 0 of 0"
      )
    );

    const all = screen.getByTestId("coord-alerts-kind-filter-all");
    expect(all).not.toHaveTextContent("list partial");
    expect(
      screen.getByTestId("coord-alerts-kind-filter")
    ).toHaveAttribute("title", expect.stringContaining("empty kind list"));
  });

  it("still calls an ABSENT kind list partial, without naming a cause", async () => {
    // The other side of the same predicate — and the title must not assert
    // "old build": coord also serves no list when its DISTINCT query fails.
    httpGet.mockImplementation((url: unknown) => {
      if (isCriticalProbe(String(url))) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      return Promise.resolve({ alerts: [STALE_TREE], total_count: 1 });
    });

    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    expect(
      screen.getByTestId("coord-alerts-kind-filter-all")
    ).toHaveTextContent("list partial");
    const title = screen
      .getByTestId("coord-alerts-kind-filter")
      .getAttribute("title");
    expect(title).toContain("vocabulary query failed");
  });

  it("names a selected kind coord says can never match", async () => {
    // `unknown_kinds` is served for this caller and was unread, so a filter
    // that CANNOT return a row rendered as a bare "No alerts matching
    // filters." — the cause sitting unparsed in the response.
    httpGet.mockImplementation((url: unknown) => {
      const u = String(url);
      if (isCriticalProbe(u)) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      const filtered = u.includes("kind=legacy_unregistered");
      return Promise.resolve({
        alerts: filtered ? [] : [STALE_TREE],
        total_count: filtered ? 0 : 1643,
        next_cursor: null,
        kinds: ["stale_primary_tree", "legacy_unregistered"],
        // A kind that is LIVE but outside coord's `alert_kind` registry —
        // coord's own `unmatched_kinds` tests use exactly this shape. It
        // vouches for the value while a row carries it; once the last one
        // resolves it is in neither the registry nor the table. (A merely
        // hyphenated name like `git_inv-2` would NOT qualify: the registry
        // covers the mixed-separator kinds too.)
        unknown_kinds: filtered ? ["legacy_unregistered"] : [],
      });
    });

    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");
    expect(screen.queryByTestId("coord-alerts-unknown-kinds")).toBeNull();

    fireEvent.click(
      screen.getByTestId("coord-alerts-kind-filter-legacy_unregistered")
    );

    const note = await screen.findByTestId("coord-alerts-unknown-kinds");
    expect(note).toHaveTextContent("legacy_unregistered");
    expect(note).toHaveTextContent("no known alert kind");
  });

  it("reports only the unmatchable kinds actually selected", async () => {
    // Coord answers for the whole request; a value the operator is no longer
    // filtering on must not be narrated back at them.
    httpGet.mockImplementation((url: unknown) => {
      if (isCriticalProbe(String(url))) {
        return Promise.resolve({ alerts: [], total_count: 0 });
      }
      return Promise.resolve({
        alerts: [STALE_TREE],
        total_count: 1,
        next_cursor: null,
        kinds: ["stale_primary_tree"],
        unknown_kinds: ["some_other_kind"],
      });
    });

    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");
    expect(screen.queryByTestId("coord-alerts-unknown-kinds")).toBeNull();
  });

  it("does not refetch when `all` is clicked and nothing is selected", async () => {
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    // `onClear` is a `setState([])` — a fresh array every call — so a no-op
    // click would invalidate the selection-keyed `query` and re-run the page-1
    // fetch, discarding anything the operator had paged into. The chip is
    // disabled while it is already the state, so the click cannot happen.
    const all = screen.getByTestId("coord-alerts-severity-filter-all");
    expect(all).toHaveAttribute("aria-disabled", "true");
    expect(all).toHaveAttribute("aria-pressed", "true");
    // Inert, but still reachable: `aria-disabled` rather than the attribute,
    // so activating it does not blur a keyboard operator to `<body>`.
    expect(all).not.toBeDisabled();

    const before = httpGet.mock.calls.length;
    fireEvent.click(all);
    expect(httpGet.mock.calls.length).toBe(before);

    // ...and it becomes live again the moment there is something to clear.
    fireEvent.click(screen.getByTestId("coord-alerts-severity-filter-warning"));
    await waitFor(() => expect(lastListUrl()).toContain("severity=warning"));
    expect(all).toHaveAttribute("aria-disabled", "false");
  });

  it("keeps the list read and the hoisted-count read apart when critical is selected", async () => {
    // `severity=critical` is no longer unique to the hoisted probe: the filter
    // is multi-select, so the LIST request carries it too. The page must still
    // read its rows from the list response and its badge from the probe.
    render(<CoordAlertsPage />);
    await screen.findByTestId("coord-alert-row");

    fireEvent.click(screen.getByTestId("coord-alerts-severity-filter-critical"));
    await waitFor(() => expect(lastListUrl()).toContain("severity=critical"));

    // The row is still the LIST payload's row, not the probe's empty array —
    // and `1643` is the list response's `total_count`, which can only have got
    // there from a committed list read (a `findByTestId` on the row alone is
    // satisfiable by the pre-click render).
    expect(await screen.findByTestId("coord-alert-row")).toBeInTheDocument();
    expect(screen.getByTestId("coord-alerts-match-count")).toHaveTextContent(
      "1643"
    );
    // ...and the hoisted count is still the probe's 637, not the list's 1643.
    expect(screen.getByTestId("coord-alerts-critical-count")).toHaveTextContent(
      "637 critical"
    );
  });
});
