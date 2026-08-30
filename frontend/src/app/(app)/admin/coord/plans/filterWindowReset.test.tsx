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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  /** The status the page starts on, and the one the test switches to. */
  from: string;
  toLabel: string;
  selectTestId: string;
  emptyTestId: string;
  unknownTestId: string;
}

const SURFACES: Surface[] = [
  {
    name: "/admin/coord/plans",
    Page: CoordPlansListPage,
    from: "any",
    toLabel: "Blocked",
    selectTestId: "coord-plans-status-select",
    emptyTestId: "coord-plans-empty",
    unknownTestId: "coord-plans-unknown",
  },
  {
    name: "/admin/coord/spawn",
    Page: CoordSpawnPage,
    from: "in_progress",
    toLabel: "Blocked",
    selectTestId: "coord-spawn-status-select",
    emptyTestId: "coord-spawn-plans-empty",
    unknownTestId: "coord-spawn-plans-unknown",
  },
];

beforeEach(() => {
  get.mockReset();
});

describe.each(SURFACES)(
  "$name — a filter change resets the window",
  ({ Page, toLabel, selectTestId, emptyTestId, unknownTestId }) => {
    /** Pick `toLabel` from the status Select. */
    async function switchFilter(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByTestId(selectTestId));
      await user.click(await screen.findByRole("option", { name: toLabel }));
    }

    it("does not show the previous filter's rows as the new filter's answer", async () => {
      // The second query never resolves, so the render under test is exactly
      // the in-flight window — the one the retained rows used to occupy.
      let call = 0;
      let releaseSecondRead: ((body: unknown) => void) | undefined;
      get.mockImplementation(async () => {
        call += 1;
        if (call === 1) return { work_units: [FIRST_WINDOW] };
        return new Promise((resolve) => {
          releaseSecondRead = resolve;
        });
      });
      const user = userEvent.setup();
      render(<Page />);

      await screen.findByText(TITLE_RE);
      await switchFilter(user);

      await waitFor(() => expect(screen.queryByText(TITLE_RE)).toBeNull());
      // ...and skeletons, not an empty-state claim about a query still in
      // flight. `<RecordList>` renders one or the other, never both.
      expect(screen.queryByTestId(emptyTestId)).toBeNull();
      expect(screen.queryByTestId(unknownTestId)).toBeNull();

      // Settle the held read before the test ends. A promise left pending
      // keeps the vitest worker from closing ("something prevents Vite server
      // from exiting"), which reads as an infrastructure flake in CI rather
      // than as this test's own doing.
      releaseSecondRead?.({ work_units: [] });
      await screen.findByTestId(emptyTestId);
    });

    it("calls a first read that FAILS under the new filter unknown, not stale", async () => {
      // The subtler half. With the previous window retained, `loaded` stays
      // true across the change, so `readIsUnknown` returns false and the page
      // reports counts as merely out of date — for a query nothing has ever
      // answered.
      let call = 0;
      get.mockImplementation(async () => {
        call += 1;
        if (call === 1) return { work_units: [FIRST_WINDOW] };
        throw new Error("coord unreachable");
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
      let call = 0;
      get.mockImplementation(async () => {
        call += 1;
        if (call === 1) return { work_units: [FIRST_WINDOW] };
        return { work_units: [] };
      });
      const user = userEvent.setup();
      render(<Page />);

      await screen.findByText(TITLE_RE);
      await switchFilter(user);

      const empty = await screen.findByTestId(emptyTestId);
      expect(within(empty).queryByText(/unknown/i)).toBeNull();
      expect(screen.queryByTestId(unknownTestId)).toBeNull();
    });
  }
);
