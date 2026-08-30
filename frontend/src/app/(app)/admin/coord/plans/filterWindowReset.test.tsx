/**
 * Changing the server-side status filter must discard the previous window.
 *
 * `/plans` and `/spawn` both hold coord's answer in one `data` state, key
 * `loaded` off `data !== null`, and share `derivePlansHealth` — so both had the
 * same hole, and it is pinned once, here, for both.
 *
 * The `<Select>` value goes to coord as `?status=`, so changing it changes the
 * QUESTION. The rows already in `data` answer the previous one. Left in place
 * they keep `loaded` true across the change, and every read-state derivation on
 * the page then reports the old query while the new one is in flight:
 *
 *   - `<RecordList>` renders the previous filter's records instead of
 *     skeletons — the operator reads them as the new filter's answer;
 *   - the health strip describes the previous window;
 *   - a new fetch that FAILS lands on the STALE arm ("the last counts that
 *     landed") when nothing has ever landed for THIS query — the read-state
 *     equivalent of R6's `?? 0`, one level up from a count.
 *
 * Each assertion below is on the sentence or row an operator would actually
 * read, in both directions: the old answer is gone AND the honest one is there.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Let a resolved promise's continuation run, and React re-render, before
 * asserting that it changed nothing.
 *
 * A negative assertion needs this and `waitFor` cannot supply it: `waitFor`
 * invokes its callback synchronously on entry, so `expect(…).toBeNull()`
 * straight after a `resolve()` passes before the continuation has had a
 * chance to call `setData` — green whether or not the guard exists.
 */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const get = vi.fn();

// `<PlanRow>` opens the detail route from a `useRouter()`, which has no app
// router mounted under `render()`. The navigation is not what is under test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plans",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// `/spawn` gates its spawn button behind `<CoordAdminOnly>`; the gate is not
// what is under test, and an unmocked `useAuth` throws without a provider.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordPlansListPage from "./page";
import CoordSpawnPage from "../spawn/page";

/** A work unit that comes back only for the FIRST filter. */
const FIRST_WINDOW = {
  slug: "2026-08-16-a-plan-from-the-first-window",
  title: "A plan from the first window",
  status: "in_progress",
  created_at: "2026-08-16T09:00:00Z",
  updated_at: "2026-08-16T09:00:00Z",
};

/**
 * Both row components render the title inside the label as `— <title>`, so an
 * exact-string matcher would never hit it. The title is the part that
 * identifies WHICH window is on screen, which is what these tests turn on.
 */
const TITLE_RE = new RegExp(FIRST_WINDOW.title);

interface Surface {
  name: string;
  Page: () => React.JSX.Element;
  /** The status option the test switches TO, by its visible label. */
  toLabel: string;
  /** The `?status=` value that label must produce on the wire. */
  toValue: string;
  selectTestId: string;
  emptyTestId: string;
  unknownTestId: string;
  /** R6's third state: coord answered, a later read over the same window failed. */
  staleTestId: string;
  /** The refresh button — re-reads the SAME question, exactly as the poll does. */
  refreshTestId: string;
}

const SURFACES: Surface[] = [
  {
    name: "/admin/coord/plans",
    Page: CoordPlansListPage,
    toLabel: "Blocked",
    toValue: "blocked",
    selectTestId: "coord-plans-status-select",
    emptyTestId: "coord-plans-empty",
    unknownTestId: "coord-plans-unknown",
    staleTestId: "coord-plans-stale",
    refreshTestId: "coord-plans-refresh",
  },
  {
    name: "/admin/coord/spawn",
    Page: CoordSpawnPage,
    toLabel: "Blocked",
    toValue: "blocked",
    selectTestId: "coord-spawn-status-select",
    emptyTestId: "coord-spawn-plans-empty",
    unknownTestId: "coord-spawn-plans-unknown",
    staleTestId: "coord-spawn-plans-stale",
    refreshTestId: "coord-spawn-refresh",
  },
];

beforeEach(() => {
  get.mockReset();
});

describe.each(SURFACES)(
  "$name — a filter change resets the window",
  ({
    Page,
    toLabel,
    toValue,
    selectTestId,
    emptyTestId,
    unknownTestId,
    staleTestId,
    refreshTestId,
  }) => {
    /**
     * Route by URL, never by call ORDER.
     *
     * Order-keyed mocks would pass every test below against a page that reset
     * `data` correctly and then never sent `?status=` at all — and, worse,
     * they cannot express the ordering that actually breaks this feature: an
     * OLD-filter read landing after the new one. Keying on the URL means each
     * scenario says which QUESTION it is answering, which is the thing under
     * test.
     */
    function routeByStatus(handlers: {
      first: () => unknown;
      switched: () => unknown;
    }) {
      get.mockImplementation(async (url: string) => {
        const answer = url.includes(`status=${toValue}`)
          ? handlers.switched
          : handlers.first;
        return answer();
      });
    }

    /** Pick `toLabel` from the status Select. */
    async function switchFilter(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByTestId(selectTestId));
      await user.click(await screen.findByRole("option", { name: toLabel }));
    }

    it("asks coord the new question, and shows no answer until it lands", async () => {
      // The switched read is held open, so the render under test is exactly
      // the in-flight window — the one the retained rows used to occupy.
      let releaseSwitchedRead: ((body: unknown) => void) | undefined;
      routeByStatus({
        first: () => ({ work_units: [FIRST_WINDOW] }),
        switched: () =>
          new Promise((resolve) => {
            releaseSwitchedRead = resolve;
          }),
      });
      const user = userEvent.setup();
      render(<Page />);

      await screen.findByText(TITLE_RE);
      await switchFilter(user);

      // The new question was actually asked. Without this the rest of the file
      // would pass on a page that discarded the window and re-asked the old
      // one.
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith(
          expect.stringContaining(`status=${toValue}`)
        )
      );
      await waitFor(() => expect(screen.queryByText(TITLE_RE)).toBeNull());
      // ...and skeletons, not an empty-state claim about a query still in
      // flight. `<RecordList>` renders one or the other, never both.
      expect(screen.queryByTestId(emptyTestId)).toBeNull();
      expect(screen.queryByTestId(unknownTestId)).toBeNull();

      // Settle the held read before the test ends. A promise left pending
      // keeps the vitest worker from closing ("something prevents Vite server
      // from exiting"), which reads as an infrastructure flake in CI rather
      // than as this test's own doing.
      releaseSwitchedRead?.({ work_units: [] });
      await screen.findByTestId(emptyTestId);
    });

    it("calls a first read that FAILS under the new filter unknown, not stale", async () => {
      // The subtler half. With the previous window retained, `loaded` stays
      // true across the change, so `readIsUnknown` returns false and the page
      // reports counts as merely out of date — for a query nothing has ever
      // answered.
      routeByStatus({
        first: () => ({ work_units: [FIRST_WINDOW] }),
        switched: () => {
          throw new Error("coord unreachable");
        },
      });
      const user = userEvent.setup();
      render(<Page />);

      await screen.findByText(TITLE_RE);
      await switchFilter(user);

      const unknown = await screen.findByTestId(unknownTestId);
      expect(unknown).toHaveTextContent(/unknown, not none/i);
      expect(screen.queryByTestId(emptyTestId)).toBeNull();
      expect(screen.queryByText(TITLE_RE)).toBeNull();
    });

    it("still reports a genuinely empty answer under the new filter as empty", async () => {
      // The other half of the pin: the reset must not turn a real empty answer
      // into an unknown one, or the fix would be indistinguishable from
      // breaking the empty state.
      routeByStatus({
        first: () => ({ work_units: [FIRST_WINDOW] }),
        switched: () => ({ work_units: [] }),
      });
      const user = userEvent.setup();
      render(<Page />);

      await screen.findByText(TITLE_RE);
      await switchFilter(user);

      const empty = await screen.findByTestId(emptyTestId);
      expect(within(empty).queryByText(/unknown/i)).toBeNull();
      expect(screen.queryByTestId(unknownTestId)).toBeNull();
    });

    it("dates the empty copy once a later read over the same window fails", async () => {
      // R6's third state, in the slot where the absence claim is made in
      // words. A poll deliberately does not blank a loaded page, so `data`
      // stays non-null and `plansUnknown` is false — which left the plain
      // present-tense "No plans matching status=X." on screen while the read
      // was currently failing. The style guide rule this change adds says
      // three arms, not two, and these two pages are the first place it has to
      // hold.
      let call = 0;
      get.mockImplementation(async () => {
        call += 1;
        if (call === 1) return { work_units: [] };
        throw new Error("coord unreachable");
      });
      const user = userEvent.setup();
      render(<Page />);

      await screen.findByTestId(emptyTestId);
      await user.click(screen.getByTestId(refreshTestId));

      const stale = await screen.findByTestId(staleTestId);
      expect(stale).toHaveTextContent(/at the last good read/i);
      expect(screen.queryByTestId(emptyTestId)).toBeNull();
      expect(screen.queryByTestId(unknownTestId)).toBeNull();
    });

    /**
     * The ordering the reset alone does not survive.
     *
     * Discarding the window narrows the bug rather than closing it: the read
     * issued under the PREVIOUS filter is still live and still lands on
     * `setData`/`setError`. Both tests below switch the filter while the FIRST
     * read is still in flight — the ordinary case, not a corner — which is
     * precisely what the three tests above cannot reach, since each waits for
     * the first read to settle before switching.
     */
    describe("a superseded read may not speak", () => {
      it("does not repaint the discarded window when the old read lands late", async () => {
        let releaseFirstRead: ((body: unknown) => void) | undefined;
        routeByStatus({
          first: () =>
            new Promise((resolve) => {
              releaseFirstRead = resolve;
            }),
          switched: () => ({ work_units: [] }),
        });
        const user = userEvent.setup();
        render(<Page />);

        // Switch WHILE the first read is still out.
        await switchFilter(user);
        const empty = await screen.findByTestId(emptyTestId);
        expect(empty).toBeInTheDocument();

        // Now the superseded read lands, with rows.
        releaseFirstRead?.({ work_units: [FIRST_WINDOW] });
        // Flush explicitly. `waitFor` runs its callback synchronously on
        // entry, so asserting straight after the resolve would pass before
        // the continuation had a chance to call `setData` — a green that
        // proves nothing.
        await flushMicrotasks();

        expect(screen.queryByText(TITLE_RE)).toBeNull();
        expect(screen.getByTestId(emptyTestId)).toBeInTheDocument();
      });

      it("does not clear a real error when the old read lands late and succeeds", async () => {
        // The worse arm. A superseded SUCCESS running `setError(null)` wipes
        // the banner and flips `loaded` true, so the previous window is stated
        // as a confident answer to a question that errored — the fabricated
        // answer this whole change exists to prevent, in a race window.
        let releaseFirstRead: ((body: unknown) => void) | undefined;
        routeByStatus({
          first: () =>
            new Promise((resolve) => {
              releaseFirstRead = resolve;
            }),
          switched: () => {
            throw new Error("coord unreachable");
          },
        });
        const user = userEvent.setup();
        render(<Page />);

        await switchFilter(user);
        await screen.findByTestId(unknownTestId);

        releaseFirstRead?.({ work_units: [FIRST_WINDOW] });
        await flushMicrotasks();

        expect(screen.queryByText(TITLE_RE)).toBeNull();
        expect(screen.getByTestId(unknownTestId)).toBeInTheDocument();
        expect(screen.queryByTestId(emptyTestId)).toBeNull();
      });

      it("still reports a failure when a NEWER read of the same question overtook it", async () => {
        // Superseding must be scoped to the QUESTION, not the request — which
        // is why there are two counters and not one.
        //
        // With a single per-request counter, a read is superseded by the next
        // one whenever latency exceeds the gap between them, and it is then
        // silenced in all three arms at once: no data, no error, and no
        // `setLoading(false)`. The arithmetic makes that the normal case under
        // a sick backend rather than a corner — `httpClient`'s request timeout
        // is 60s and a retried 5xx spends ~7s in backoff, against a 10s poll —
        // so the page sits on skeletons and "Waiting for coord…" with the
        // failure never surfaced. That is precisely the state `readFailed`
        // exists to prevent, re-created by the fix for a different bug.
        //
        // Here: the first read is still out when the refresh button issues a
        // second, which lands first. The first then FAILS. Its failure is live
        // information about the filter still on screen, so it must be
        // reported — the deliberate asymmetry `/questions` also takes, because
        // over-reporting trouble fails safe and silencing it does not.
        let rejectFirstRead: ((err: Error) => void) | undefined;
        let call = 0;
        get.mockImplementation(async () => {
          call += 1;
          if (call === 1) {
            return new Promise((_resolve, reject) => {
              rejectFirstRead = reject;
            });
          }
          return { work_units: [] };
        });
        const user = userEvent.setup();
        render(<Page />);

        // The refresh button calls `fetchData` directly, exactly as the poll
        // does, and without touching `status`.
        await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
        await user.click(screen.getByTestId(refreshTestId));
        // The second read lands first and answers the page.
        await screen.findByTestId(emptyTestId);

        rejectFirstRead?.(new Error("coord unreachable"));

        await screen.findByText(/Failed to load/i);
      });
    });
  }
);
