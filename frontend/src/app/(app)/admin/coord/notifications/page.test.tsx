/**
 * Component test for /admin/coord/notifications.
 *
 * Plan `2026-08-05-coord-notifications-type-and-tab.md` Change 4. The
 * contracts pinned here are the ones the plan calls out as previously broken
 * or previously silent:
 *
 *  - counts come from the server's `total` / `unread_count` SCALARS, never
 *    from the returned page length (Acceptance 4's collision with Change 3)
 *  - the default view renders NO UUID; the id appears only once a row is
 *    expanded (Acceptance 3)
 *  - "Load more" walks `next_cursor` and appends without duplicating
 *    (Acceptance 2's paging, as far as a component test can observe it)
 *  - mark-read sends the documented body shape, per-row and mark-all
 *  - coord's `503 schema_migration_pending` degrades quietly, because the
 *    coord PR lands AFTER this one by design
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const httpGet = vi.fn();
const httpPost = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    post: (...args: unknown[]) => httpPost(...args),
  },
}));

import CoordNotificationsPage from "./page";

const UUID_A = "c79a07d5-7e40-49b4-87fa-554c749f9644";
const UUID_B = "0f4d1a2b-6c8e-4f10-9a33-2b7c5d8e1f90";

function notification(over: Record<string, unknown> = {}) {
  return {
    notification_id: UUID_A,
    kind: "policy_change",
    summary: "Policy `escalation-bar` was edited",
    detail: { document: "escalation-bar", version: 5 },
    repo: "qontinui/qontinui-web",
    pr_number: 742,
    actor: "merge-train-steward",
    occurred_at: new Date().toISOString(),
    read_at: null,
    ...over,
  };
}

describe("CoordNotificationsPage", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPost.mockReset();
    // The page reads `?ref=` from `window.location` once on mount, and the
    // `?ref=` block below sets it. Reset here rather than there so the URL is
    // known-clean for EVERY test in the file, not just the ones that follow a
    // block that remembered to clean up after itself.
    window.history.replaceState({}, "", "/");
  });

  it("reads total and unread_count from the envelope, not the page length", async () => {
    // Two rows on the page; 900 in the corpus, 137 unread. A count derived
    // from `notifications.length` would report 2 — the defect this plan
    // exists to prevent.
    httpGet.mockResolvedValue({
      notifications: [
        notification(),
        notification({ notification_id: UUID_B, summary: "PR #742 landed" }),
      ],
      next_cursor: null,
      total: 900,
      unread_count: 137,
    });
    render(<CoordNotificationsPage />);

    expect(
      await screen.findByTestId("coord-notifications-unread-count")
    ).toHaveTextContent("137 unread");
    expect(screen.getByTestId("coord-notifications-total")).toHaveTextContent(
      "900 total"
    );
    expect(await screen.findAllByTestId("coord-notification-row")).toHaveLength(
      2
    );
  });

  it("requests a bounded page and forwards the filters coord honours", async () => {
    httpGet.mockResolvedValue({ notifications: [], total: 0, unread_count: 0 });
    render(<CoordNotificationsPage />);

    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    const url = String(httpGet.mock.calls[0][0]);
    expect(url).toContain("/api/v1/operations/notifications?");
    expect(url).toContain("limit=50");
  });

  it("renders no UUID in the default view, and the id only once expanded", async () => {
    httpGet.mockResolvedValue({
      notifications: [notification()],
      next_cursor: null,
      total: 1,
      unread_count: 1,
    });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    const page = await screen.findByTestId("coord-notifications-page");
    // Acceptance 3, asserted over the WHOLE default view rather than one field.
    expect(page.textContent ?? "").not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    // ...and it still says what happened.
    expect(screen.getByTestId("coord-notification-summary")).toHaveTextContent(
      "Policy `escalation-bar` was edited"
    );

    await user.click(screen.getByTestId("coord-notification-summary"));
    const detail = await screen.findByTestId("coord-notification-detail");
    expect(detail).toHaveTextContent(UUID_A);
    expect(detail).toHaveTextContent("escalation-bar");
    expect(detail).toHaveTextContent("by merge-train-steward");
  });

  it("collapsing unmounts the detail panel", async () => {
    httpGet.mockResolvedValue({
      notifications: [notification()],
      next_cursor: null,
      total: 1,
      unread_count: 1,
    });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    const summary = await screen.findByTestId("coord-notification-summary");
    await user.click(summary);
    expect(
      await screen.findByTestId("coord-notification-detail")
    ).toBeInTheDocument();
    await user.click(summary);
    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-notification-detail")
      ).not.toBeInTheDocument()
    );
  });

  it("walks next_cursor on Load more and appends without duplicating", async () => {
    httpGet
      .mockResolvedValueOnce({
        notifications: [notification()],
        next_cursor: "cursor-1",
        total: 2,
        unread_count: 2,
      })
      .mockResolvedValueOnce({
        notifications: [
          notification({ notification_id: UUID_B, summary: "PR #742 landed" }),
        ],
        next_cursor: null,
        total: 2,
        unread_count: 2,
      });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    const more = await screen.findByTestId("coord-notifications-load-more");
    await user.click(more);

    await waitFor(() =>
      expect(screen.getAllByTestId("coord-notification-row")).toHaveLength(2)
    );
    expect(String(httpGet.mock.calls[1][0])).toContain("cursor=cursor-1");
    // The walk is over — no cursor, no button.
    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-notifications-load-more")
      ).not.toBeInTheDocument()
    );
  });

  it("marks a single row read with the documented body shape", async () => {
    httpGet.mockResolvedValue({
      notifications: [notification()],
      next_cursor: null,
      total: 1,
      unread_count: 1,
    });
    httpPost.mockResolvedValue({ marked: 1, unread_count: 0 });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    await user.click(await screen.findByTestId("coord-notification-mark-read"));

    await waitFor(() =>
      expect(httpPost).toHaveBeenCalledWith(
        "/api/v1/operations/notifications/mark-read",
        { notification_ids: [UUID_A] },
        expect.objectContaining({ noRetryStatuses: [503] })
      )
    );
    // snake_case, pinned: `notificationIds` is the natural TypeScript
    // spelling and coord answers 400 for it under `deny_unknown_fields`.
    expect(Object.keys(httpPost.mock.calls[0][1] as object)).toEqual([
      "notification_ids",
    ]);
    // The row flips to read locally and the unread count follows the SERVER's
    // scalar, not a local recount.
    //
    // It used to assert the badge DISAPPEARED. Since Phase 3 Wave 5 the count
    // lives in the page's `<HealthStrip>` and is always rendered, so the
    // assertion is now on its value — which is the stronger claim anyway, and
    // the one R6 asks for: `0` means *we looked and there is nothing*, where a
    // missing element says neither. `–` remains reserved for "coord has not
    // answered".
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-notifications-unread-count")
      ).toHaveTextContent("0 unread")
    );
  });

  it("marks everything read with an EXPLICIT {all: true}", async () => {
    // Never `{notification_ids: null}`. Coord treated an absent/null selection
    // as "mark the whole tenant read", which is how a camelCase typo destroyed
    // 90 days of read state; the overload is gone and this arm is explicit.
    httpGet.mockResolvedValue({
      notifications: [notification()],
      next_cursor: null,
      total: 1,
      unread_count: 1,
    });
    httpPost.mockResolvedValue({ marked: 1, unread_count: 0 });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    const button = await screen.findByTestId(
      "coord-notifications-mark-all-read"
    );
    expect(button).toHaveAttribute("data-mark-all-scope", "everything");
    expect(button).toHaveTextContent("Mark all read");
    await user.click(button);

    await waitFor(() =>
      expect(httpPost).toHaveBeenCalledWith(
        "/api/v1/operations/notifications/mark-read",
        { all: true },
        expect.objectContaining({ noRetryStatuses: [503] })
      )
    );
    // The dangerous legacy spelling must never appear on the wire.
    const body = httpPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("notification_ids");
    expect(Object.keys(body)).toEqual(["all"]);
  });

  it("scopes mark-all to the LOADED rows once a filter is active", async () => {
    // The trap: an operator filters, sees 4 rows, clicks a button labelled
    // "Mark all read" and irreversibly marks the several hundred unread events
    // they cannot see. Under any filter the request carries explicit ids.
    httpGet.mockResolvedValue({
      notifications: [
        notification(),
        notification({ notification_id: UUID_B, summary: "PR #742 landed" }),
      ],
      next_cursor: null,
      total: 900,
      unread_count: 137,
    });
    httpPost.mockResolvedValue({ marked: 2, unread_count: 135 });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    await screen.findAllByTestId("coord-notification-row");
    await user.click(screen.getByTestId("coord-notifications-unread-only"));

    const button = await screen.findByTestId(
      "coord-notifications-mark-all-read"
    );
    // The label states the scope BEFORE the click, not the toast after it.
    await waitFor(() =>
      expect(button).toHaveAttribute("data-mark-all-scope", "loaded")
    );
    expect(button).toHaveTextContent("Mark 2 shown read");
    await user.click(button);

    await waitFor(() =>
      expect(httpPost).toHaveBeenCalledWith(
        "/api/v1/operations/notifications/mark-read",
        { notification_ids: [UUID_A, UUID_B] },
        expect.objectContaining({ noRetryStatuses: [503] })
      )
    );
    for (const call of httpPost.mock.calls) {
      expect(call[1]).not.toHaveProperty("all");
    }
  });

  it("surfaces a rejected body as a real error, never as migration-pending", async () => {
    httpGet.mockResolvedValue({
      notifications: [notification()],
      next_cursor: null,
      total: 1,
      unread_count: 1,
    });
    httpPost.mockRejectedValue(
      new Error(
        "POST /api/v1/operations/notifications/mark-read failed: 400 - " +
          "Send `notification_ids: [...]` or `all: true`."
      )
    );
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    await user.click(await screen.findByTestId("coord-notification-mark-read"));

    expect(await screen.findByText(/client\/contract bug/)).toBeInTheDocument();
    // A 400 is not "coord has not deployed yet" — swallowing it there would
    // leave a button that silently does nothing forever.
    expect(
      screen.queryByTestId("coord-notifications-pending")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-notification-row")).toBeInTheDocument();
  });

  it("degrades quietly while the coord migration is pending", async () => {
    httpGet.mockRejectedValue(
      new Error(
        'GET /api/v1/operations/notifications failed: 503 - {"error":"schema_migration_pending"}'
      )
    );
    render(<CoordNotificationsPage />);

    expect(
      await screen.findByTestId("coord-notifications-pending")
    ).toHaveTextContent("not available yet");
    // Explicitly NOT an error surface — the coord PR lands after this one.
    expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
  });

  it("marks the counts STALE when a poll fails after a good first load", async () => {
    // The state a 10s poller spends most of its bad time in, and the one the
    // strip used to get wrong: `failed` was `error !== null && !loaded`, so a
    // good first load followed by failing polls kept a GREEN "137 unread
    // events" directly above the page's own "Failed to load…" line. The
    // numbers are real; what they are not is current.
    httpGet
      .mockResolvedValueOnce({
        notifications: [notification()],
        next_cursor: null,
        total: 900,
        unread_count: 137,
      })
      .mockRejectedValue(
        new Error("GET /api/v1/operations/notifications failed: 500 - boom")
      );
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    // The good load.
    expect(
      await screen.findByTestId("coord-notifications-unread-count")
    ).toHaveTextContent("137 unread");
    expect(screen.getByTestId("coord-notifications-health")).toHaveAttribute(
      "data-health-level",
      "green"
    );

    // Now a failing read. Driven through Refresh rather than the 10s poller:
    // it is the same `fetchHead(false)` call, without making the test depend
    // on fake timers.
    await user.click(screen.getByTestId("coord-notifications-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("coord-notifications-health")).toHaveAttribute(
        "data-health-level",
        "amber"
      )
    );
    expect(screen.getByTestId("coord-notifications-health")).toHaveTextContent(
      /stopped updating/
    );
    // …while still showing the real numbers it holds, and the rows it loaded.
    expect(
      screen.getByTestId("coord-notifications-unread-count")
    ).toHaveTextContent("137 unread");
    expect(screen.getByTestId("coord-notification-row")).toBeInTheDocument();
  });

  it("a failed MARK-READ does not make the counts look stale", async () => {
    // `error` is one line shared with mark-read, which is why the strip cannot
    // read it. A rejected POST says nothing about whether the feed is fresh,
    // and painting the counts stale for it would train the amber away.
    httpGet.mockResolvedValue({
      notifications: [notification()],
      next_cursor: null,
      total: 900,
      unread_count: 137,
    });
    httpPost.mockRejectedValue(new Error("mark-read failed: 500 - boom"));
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    await user.click(await screen.findByTestId("coord-notification-mark-read"));
    expect(await screen.findByText(/Could not mark read/)).toBeInTheDocument();
    expect(screen.getByTestId("coord-notifications-health")).toHaveAttribute(
      "data-health-level",
      "green"
    );
  });

  it("still reports a genuine failure as an error", async () => {
    httpGet.mockRejectedValue(
      new Error("GET /api/v1/operations/notifications failed: 500 - boom")
    );
    render(<CoordNotificationsPage />);

    expect(await screen.findByText(/Failed to load/)).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-notifications-pending")
    ).not.toBeInTheDocument();
  });

  it("drops a response that lands after the filter changed", async () => {
    // Without a generation guard, the in-flight reply for filter A prepends
    // A's rows into B's list AND installs A's cursor, so the next "Load more"
    // pages through the wrong query.
    let releaseStale: ((v: unknown) => void) | null = null;
    httpGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStale = resolve;
        })
    );
    httpGet.mockResolvedValue({
      notifications: [
        notification({ notification_id: UUID_B, summary: "FRESH row" }),
      ],
      next_cursor: null,
      total: 1,
      unread_count: 1,
    });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    // Switch filters while the first request is still open.
    await user.click(screen.getByTestId("coord-notifications-unread-only"));
    await screen.findByText("FRESH row");

    // Now let the stale request answer, with rows AND a cursor.
    releaseStale!({
      notifications: [notification({ summary: "STALE row" })],
      next_cursor: "STALE-CURSOR",
      total: 999,
      unread_count: 999,
    });

    await waitFor(() =>
      expect(screen.getAllByTestId("coord-notification-row")).toHaveLength(1)
    );
    expect(screen.queryByText("STALE row")).not.toBeInTheDocument();
    // The stale cursor must not become the page's paging state.
    expect(
      screen.queryByTestId("coord-notifications-load-more")
    ).not.toBeInTheDocument();
    // Nor may its scalars overwrite the current query's.
    expect(screen.getByTestId("coord-notifications-total")).toHaveTextContent(
      "1 total"
    );
  });

  it("ends the page walk on an empty page even if a cursor comes back", async () => {
    // A fully-deduped page would otherwise leave an enabled button that does
    // nothing when clicked.
    httpGet
      .mockResolvedValueOnce({
        notifications: [notification()],
        next_cursor: "cursor-1",
        total: 1,
        unread_count: 1,
      })
      .mockResolvedValueOnce({
        notifications: [],
        next_cursor: "cursor-2",
        total: 1,
        unread_count: 1,
      });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    await user.click(
      await screen.findByTestId("coord-notifications-load-more")
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("coord-notifications-load-more")
      ).not.toBeInTheDocument()
    );
  });

  it("renders the device id and a readable time in the expanded panel", async () => {
    const DEVICE = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    httpGet.mockResolvedValue({
      notifications: [
        notification({ device_id: DEVICE, occurred_at: null, detail: null }),
      ],
      next_cursor: null,
      total: 1,
      unread_count: 1,
    });
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    // A notification is an event that by definition HAPPENED, so a missing
    // timestamp is UNKNOWN — never "never" (which also disagreed with the
    // tooltip on the same element).
    const time = await screen.findByTestId("row-time");
    expect(time).toHaveTextContent("time unknown");
    expect(time).toHaveAttribute("title", "time unknown");

    await user.click(screen.getByTestId("coord-notification-summary"));
    const detail = await screen.findByTestId("coord-notification-detail");
    // device_id is a first-class column precisely so it can surface HERE.
    expect(
      screen.getByTestId("coord-notification-device-id")
    ).toHaveTextContent(DEVICE);
    // The principal id is kept, not scrubbed — it is the paste target.
    expect(detail).toHaveTextContent("merge-train-steward");
  });

  it("a failed first read does not let the LIST claim there is nothing", async () => {
    // The half of R6 the strip's own fix left behind. `loading` is cleared in a
    // `finally`, so a first read that throws settles with `rows === []` and
    // `RecordList`'s `loaded` prop true — which renders the `empty` node. The
    // page therefore said "Could not read the feed" in the strip and, two
    // elements below, "No notifications matching filters.": the fabricated
    // absence the strip was just fixed to stop making, still being made in
    // words.
    httpGet.mockRejectedValue(
      new Error("GET /api/v1/operations/notifications failed: 500 - boom")
    );
    render(<CoordNotificationsPage />);

    expect(
      await screen.findByTestId("coord-notifications-unknown")
    ).toHaveTextContent(/unknown, not none/);
    expect(
      screen.queryByText("No notifications matching filters.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing unread.")).not.toBeInTheDocument();
    // …and the strip agrees, because both now read the same predicate.
    expect(screen.getByTestId("coord-notifications-health")).toHaveTextContent(
      /Could not read the feed/
    );
  });

  it("a genuinely empty answer still says nothing matches", async () => {
    // The other direction: the unknown arm must not swallow the honest empty
    // state. coord answered, and the answer was zero rows.
    httpGet.mockResolvedValue({
      notifications: [],
      next_cursor: null,
      total: 0,
      unread_count: 0,
    });
    render(<CoordNotificationsPage />);

    expect(
      await screen.findByText("No notifications matching filters.")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-notifications-unknown")
    ).not.toBeInTheDocument();
  });

  it("a blipped poll on an empty window does not flip the list to unknown", async () => {
    // Why the slot is keyed on `loaded` and not on `rows.length` — the reason
    // `readIsUnknown` states, asserted at the surface that would show it. coord
    // has CONFIRMED this window empty; a single failing poll must not restate
    // that as "unknown" and back again on the next tick.
    httpGet
      .mockResolvedValueOnce({
        notifications: [],
        next_cursor: null,
        total: 0,
        unread_count: 0,
      })
      .mockRejectedValue(
        new Error("GET /api/v1/operations/notifications failed: 500 - boom")
      );
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    await screen.findByText("No notifications matching filters.");
    await user.click(screen.getByTestId("coord-notifications-refresh"));

    // The strip goes amber-stale — that IS its job — while the list holds the
    // answer coord actually gave.
    await waitFor(() =>
      expect(screen.getByTestId("coord-notifications-health")).toHaveTextContent(
        /stopped updating/
      )
    );
    expect(
      screen.queryByTestId("coord-notifications-unknown")
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("No notifications matching filters.")
    ).toBeInTheDocument();
  });

  it("a filter change whose read fails does not inherit the old filter's answer", async () => {
    // The state that re-opened the same bug one step over. `loaded` is
    // page-lifetime — never set back to false — so a success under "all kinds"
    // used to license "No notifications matching filters." about a DIFFERENT
    // filter that had never been read at all. `readIsUnknown`'s premise is
    // "coord has CONFIRMED this window empty"; the confirmation has to be
    // about the window being described.
    httpGet
      .mockResolvedValueOnce({
        notifications: [notification()],
        next_cursor: null,
        total: 900,
        unread_count: 137,
      })
      .mockRejectedValue(
        new Error("GET /api/v1/operations/notifications failed: 500 - boom")
      );
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);
    await screen.findByTestId("coord-notification-row");

    // Change the filter — rows are cleared, and the new query's read throws.
    await user.click(screen.getByTestId("coord-notifications-unread-only"));

    expect(
      await screen.findByTestId("coord-notifications-unknown")
    ).toBeInTheDocument();
    // Neither honest-empty sentence may appear: coord has said nothing about
    // this filter at all.
    expect(
      screen.queryByText("No notifications matching filters.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing unread.")).not.toBeInTheDocument();
  });

  it("does not promise a stale number in front of the irreversible button", async () => {
    // The fourth consumer of the same failed poll. The strip says the count
    // stopped updating; the mark-all tooltip must not spend it as a fact,
    // because that arm marks EVERY unread row for the principal and there is
    // no mark-unread in the API.
    httpGet
      .mockResolvedValueOnce({
        notifications: [notification()],
        next_cursor: null,
        total: 900,
        unread_count: 137,
      })
      .mockRejectedValue(
        new Error("GET /api/v1/operations/notifications failed: 500 - boom")
      );
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    expect(
      await screen.findByTestId("coord-notifications-mark-all-read")
    ).toHaveAttribute("title", expect.stringContaining("ALL 137 unread"));

    await user.click(screen.getByTestId("coord-notifications-refresh"));
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-notifications-mark-all-read")
      ).not.toHaveAttribute("title", expect.stringContaining("137"))
    );
    // The warning survives; only the figure is withdrawn.
    expect(
      screen.getByTestId("coord-notifications-mark-all-read")
    ).toHaveAttribute("title", expect.stringContaining("cannot be undone"));
  });

  it("does not promise a count the strip is calling unknown", async () => {
    // The same fourth consumer, one state over. `migrationPending` after a good
    // read leaves `unread_count` standing with `readFailed` FALSE, so a guard
    // spelled `readFailed` let the tooltip say "Marks ALL 137 unread… cannot be
    // undone" while the strip beside it rendered both badges as `–`.
    httpGet
      .mockResolvedValueOnce({
        notifications: [notification()],
        next_cursor: null,
        total: 900,
        unread_count: 137,
      })
      .mockRejectedValue(
        new Error(
          'GET /api/v1/operations/notifications failed: 503 - {"error":"schema_migration_pending"}'
        )
      );
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    expect(
      await screen.findByTestId("coord-notifications-mark-all-read")
    ).toHaveAttribute("title", expect.stringContaining("ALL 137 unread"));

    await user.click(screen.getByTestId("coord-notifications-refresh"));
    await screen.findByTestId("coord-notifications-pending");

    const button = screen.getByTestId("coord-notifications-mark-all-read");
    expect(button).not.toHaveAttribute(
      "title",
      expect.stringContaining("137")
    );
    // The warning survives the figure, exactly as it does on the stale arm.
    expect(button).toHaveAttribute(
      "title",
      expect.stringContaining("cannot be undone")
    );
  });

  it("does not leave mark-all live when there is no table to mark", async () => {
    // The POST is a guaranteed 503 that this page swallows as the quiet
    // degrade, so the click is a silent no-op — the outcome the contract-error
    // arm exists to prevent one branch over.
    httpGet
      .mockResolvedValueOnce({
        notifications: [notification()],
        next_cursor: null,
        total: 900,
        unread_count: 137,
      })
      .mockRejectedValue(
        new Error(
          'GET /api/v1/operations/notifications failed: 503 - {"error":"schema_migration_pending"}'
        )
      );
    const user = userEvent.setup();
    render(<CoordNotificationsPage />);

    expect(
      await screen.findByTestId("coord-notifications-mark-all-read")
    ).toBeEnabled();

    await user.click(screen.getByTestId("coord-notifications-refresh"));
    await screen.findByTestId("coord-notifications-pending");

    expect(
      screen.getByTestId("coord-notifications-mark-all-read")
    ).toBeDisabled();
    // Refresh stays live — it is the recovery path, not a write.
    expect(screen.getByTestId("coord-notifications-refresh")).toBeEnabled();
    // Clicked, not merely inspected: `userEvent` does not dispatch on a
    // disabled control, so this asserts the guard actually blocks the POST
    // rather than asserting that a test which never clicks did not post.
    await user.click(screen.getByTestId("coord-notifications-mark-all-read"));
    expect(httpPost).not.toHaveBeenCalled();
  });

  describe("the ?ref= banner", () => {
    // The banner reads `window.location` once on mount. The outer `beforeEach`
    // puts the URL back to `/` for every test in the file, so this leaves no
    // residue for whatever is added after it.
    function withRef(ref: string) {
      window.history.replaceState(
        {},
        "",
        `/admin/coord/notifications?ref=${ref}`
      );
    }

    it("blames the feed only when the FEED failed, not when mark-read did", async () => {
      // `error` is the page's one error line and mark-read writes to it, so
      // consulting it here made a rejected POST report "the feed above failed
      // to load" about a feed that had loaded perfectly well — and told the
      // operator the wrong thing to go and fix.
      httpGet.mockResolvedValue({
        notifications: [notification()],
        next_cursor: null,
        total: 900,
        unread_count: 137,
      });
      httpPost.mockRejectedValue(new Error("mark-read failed: 500 - boom"));
      withRef(UUID_B);
      const user = userEvent.setup();
      render(<CoordNotificationsPage />);

      // UUID_B is not on the page, so the banner starts on its last arm.
      expect(
        await screen.findByTestId("coord-notifications-linked-ref")
      ).toHaveTextContent(/not on the page that is loaded/);

      await user.click(screen.getByTestId("coord-notification-mark-read"));
      await screen.findByText(/Could not mark read/);
      expect(
        screen.getByTestId("coord-notifications-linked-ref")
      ).toHaveTextContent(/not on the page that is loaded/);
      expect(
        screen.getByTestId("coord-notifications-linked-ref")
      ).not.toHaveTextContent(/feed above failed to load/);
    });

    it("does not send the operator to a Load more that just failed", async () => {
      // The banner's fallback arm ends "…clear them or load more". A failed
      // PAGE leaves the head counts fresh — so the strip must NOT go stale —
      // while making that exact instruction the wrong one.
      httpGet
        .mockResolvedValueOnce({
          notifications: [notification()],
          next_cursor: "cursor-1",
          total: 900,
          unread_count: 137,
        })
        .mockRejectedValue(new Error("GET …/notifications failed: 500 - boom"));
      withRef(UUID_B);
      const user = userEvent.setup();
      render(<CoordNotificationsPage />);

      await screen.findByTestId("coord-notification-row");
      await user.click(screen.getByTestId("coord-notifications-load-more"));

      // The sentence has to name the BUTTON. This assertion used to read
      // `/could not be looked up/`, which is the shared head-failure arm — so
      // it passed while the banner said "the feed above failed to load" about a
      // feed the strip was painting green, one element up.
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-notifications-linked-ref")
        ).toHaveTextContent(/loading more failed/)
      );
      expect(
        screen.getByTestId("coord-notifications-linked-ref")
      ).not.toHaveTextContent(/feed above failed to load/);
      // …and the strip stays green: the head read never failed.
      expect(screen.getByTestId("coord-notifications-health")).toHaveAttribute(
        "data-health-level",
        "green"
      );
    });

    it("stops blaming a Load more that a Refresh has since discarded", async () => {
      // `fetchHead(false)` restarts the walk, so the old walk's failure goes
      // with it. Only the filter effect used to reset `pagingFailed`; Refresh
      // calls the same function and did not — and when the new head answers
      // with no cursor the Load more button is gone, leaving the banner telling
      // the operator to press a button that is not there.
      httpGet
        .mockResolvedValueOnce({
          notifications: [notification()],
          next_cursor: "cursor-1",
          total: 900,
          unread_count: 137,
        })
        .mockRejectedValueOnce(
          new Error("GET …/notifications failed: 500 - boom")
        )
        .mockResolvedValue({
          notifications: [notification()],
          next_cursor: null,
          total: 900,
          unread_count: 137,
        });
      withRef(UUID_B);
      const user = userEvent.setup();
      render(<CoordNotificationsPage />);

      await screen.findByTestId("coord-notification-row");
      await user.click(screen.getByTestId("coord-notifications-load-more"));
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-notifications-linked-ref")
        ).toHaveTextContent(/loading more failed/)
      );

      await user.click(screen.getByTestId("coord-notifications-refresh"));

      await waitFor(() =>
        expect(
          screen.getByTestId("coord-notifications-linked-ref")
        ).not.toHaveTextContent(/loading more failed/)
      );
      // The new head carries no cursor, so there is no button to point at.
      expect(
        screen.queryByTestId("coord-notifications-load-more")
      ).not.toBeInTheDocument();
      // Back to the honest fallback: not on this page, and why.
      expect(
        screen.getByTestId("coord-notifications-linked-ref")
      ).toHaveTextContent(/not on the page that is loaded/);
    });

    it("reports the migration, not a missing event, while the table is absent", async () => {
      // With no table there is no page for the event to be absent FROM, so
      // "not on the page that is loaded — clear the filters" would report a
      // deployment state as a fact about this event.
      httpGet.mockRejectedValue(
        new Error("GET …/notifications failed: 503 - schema_migration_pending")
      );
      withRef(UUID_B);
      render(<CoordNotificationsPage />);

      expect(
        await screen.findByTestId("coord-notifications-linked-ref")
      ).toHaveTextContent(/deployment state, not a missing event/);
    });

    it("still blames the feed when the feed is what failed", async () => {
      httpGet.mockRejectedValue(
        new Error("GET /api/v1/operations/notifications failed: 500 - boom")
      );
      withRef(UUID_B);
      render(<CoordNotificationsPage />);

      expect(
        await screen.findByTestId("coord-notifications-linked-ref")
      ).toHaveTextContent(/feed above failed to load/);
    });
  });
});
