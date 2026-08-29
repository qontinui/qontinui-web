/**
 * `/admin/coord/plans/[slug]` — a failed read is not a verdict about the
 * corpus, and the phase the deriver was already asking for reaches it.
 *
 * Post-merge follow-up to Phase 3 Wave 3 (qontinui-web#1035). Wave 3 gave this
 * route the shared status derivation and the `RecordList` history panel; what
 * it did not carry over was R6's clause that "not fetched" includes "fetched
 * and FAILED". Three consequences, pinned here:
 *
 *  - coord unreachable rendered the assertive "Plan <slug> not found." — a
 *    claim about whether the work unit EXISTS, made from a read that answered
 *    nothing;
 *  - the history endpoint failed into a bare `catch {}`, so the panel showed a
 *    `0` badge and "No status history yet." for a read that never landed;
 *  - the page's own `CoordWorkUnit` omitted `current_phase`, so
 *    `derivePlanStatus`'s "phase N" subtitle could never appear here even
 *    though `/plans` and `/spawn` show it for the same record.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const httpGet = vi.fn();
const httpPost = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    post: (...args: unknown[]) => httpPost(...args),
  },
}));

/**
 * Mutable so a test can change the ROUTE PARAM and re-render, which is the
 * only way to exercise the param-change reset honestly. Remounting with a new
 * React `key` would reset every hook by itself and the test would pass with
 * the reset deleted. Vitest hoists `vi.mock`, so the name must start with
 * `mock` for the factory to be allowed to close over it.
 */
let mockSlug = "2026-08-16-a-plan";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mockSlug }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: false }),
}));

import CoordPlanDetailPage from "./page";

const SLUG = "2026-08-16-a-plan";
const DETAIL_URL = `/api/v1/operations/plans/${SLUG}`;

/**
 * Route the page's two GETs independently. An `Error` value means that call
 * REJECTS — the failure mode the whole file is about, and the one a single
 * blanket `mockResolvedValue` cannot express.
 */
function routeGets(handlers: { detail: unknown; history: unknown }) {
  httpGet.mockImplementation((url: string) => {
    // Suffix, not the exact URL: one test changes the slug mid-flight.
    const v = url.endsWith("/history") ? handlers.history : handlers.detail;
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  });
}

describe("CoordPlanDetailPage — a failed read is not an absence", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPost.mockReset();
    mockSlug = SLUG;
  });

  it("says the plan is UNKNOWN, not missing, when the read never lands", async () => {
    // A transport failure — no status code, because nothing answered.
    routeGets({
      detail: new Error("Failed to fetch"),
      history: new Error("Failed to fetch"),
    });
    render(<CoordPlanDetailPage />);

    expect(
      await screen.findByTestId("coord-plan-detail-unknown")
    ).toHaveTextContent(/unknown, not no/i);
    // The load-bearing half: the assertive sentence must be GONE, not merely
    // accompanied by a red error line further up the page.
    expect(
      screen.queryByTestId("coord-plan-detail-missing")
    ).not.toBeInTheDocument();
  });

  it("still says 'not found' on coord's own 404 — the answer, not the absence of one", async () => {
    // THE arm that makes the split worth having, and the one an earlier cut of
    // this change got backwards. `httpClient.get` throws on every non-2xx
    // (`http-client.ts:546-549`), so a 404 — the most definitive answer coord
    // gives — arrives through the SAME `catch` as a dead socket. Treating "an
    // error exists" as "we could not read" reports every mistyped slug, and
    // every soft-deleted memory on the sibling route, as an outage.
    routeGets({
      detail: new Error(
        `GET ${DETAIL_URL} failed: 404 - {"error":"work_unit_not_found"}`
      ),
      history: { history: [] },
    });
    render(<CoordPlanDetailPage />);

    expect(
      await screen.findByTestId("coord-plan-detail-missing")
    ).toHaveTextContent(/not found/i);
    expect(
      screen.queryByTestId("coord-plan-detail-unknown")
    ).not.toBeInTheDocument();
  });

  it("dashes the history count instead of printing 0 when that read fails", async () => {
    routeGets({
      detail: { work_unit: { slug: SLUG, status: "in_progress" } },
      history: new Error("history endpoint down"),
    });
    render(<CoordPlanDetailPage />);

    const panel = await screen.findByTestId("coord-plan-history");
    // `0` here would be a count nobody fetched, asserted as a fact about a
    // plan that may well have transitioned a dozen times.
    await waitFor(() => expect(panel).toHaveTextContent("–"));
    expect(
      await screen.findByTestId("coord-plan-history-unknown")
    ).toHaveTextContent(/unknown, not none/i);
    expect(
      screen.queryByTestId("coord-plan-history-empty")
    ).not.toBeInTheDocument();
  });

  it("keeps 'No status history yet' when coord confirms an empty history", async () => {
    routeGets({
      detail: { work_unit: { slug: SLUG, status: "in_progress" } },
      history: { history: [] },
    });
    render(<CoordPlanDetailPage />);

    expect(
      await screen.findByTestId("coord-plan-history-empty")
    ).toHaveTextContent(/No status history yet/i);
    expect(
      screen.queryByTestId("coord-plan-history-unknown")
    ).not.toBeInTheDocument();
  });

  it("keeps a plan's genuine ZERO transitions when only /history fails", async () => {
    // The envelope carried `recent_history: []` — coord ANSWERED, and the
    // answer was "none". A `history.length === 0` predicate would dash that
    // fetched zero the moment the supplementary endpoint blipped, reporting a
    // real answer as ignorance. The signal is the KEY's presence, not the
    // array's length.
    routeGets({
      detail: {
        work_unit: { slug: SLUG, status: "in_progress" },
        recent_history: [],
      },
      history: new Error("history endpoint down"),
    });
    render(<CoordPlanDetailPage />);

    expect(
      await screen.findByTestId("coord-plan-history-empty")
    ).toHaveTextContent(/No status history yet/i);
    expect(
      screen.queryByTestId("coord-plan-history-unknown")
    ).not.toBeInTheDocument();
    const panel = screen.getByTestId("coord-plan-history");
    expect(panel).toHaveTextContent("0");
    expect(panel).not.toHaveTextContent("–");
  });

  it("does not render the previous plan under a new slug that 404s", async () => {
    // Both arms above live behind `plan === null`, and the catch never nulls
    // it — so without the param-change reset a mistyped slug shows the LAST
    // plan's detail under the new breadcrumb and neither arm is reachable.
    routeGets({
      detail: { work_unit: { slug: SLUG, title: "The first plan" } },
      history: { history: [] },
    });
    const { rerender } = render(<CoordPlanDetailPage />);
    expect(await screen.findByTestId("coord-plan-meta")).toHaveTextContent(
      "The first plan"
    );

    routeGets({
      detail: new Error(
        'GET /api/v1/operations/plans/typo failed: 404 - {"error":"work_unit_not_found"}'
      ),
      history: { history: [] },
    });
    // Change the ROUTE PARAM and re-render the SAME element — no new `key`, so
    // React keeps the component mounted and its state alive. That is what the
    // reset has to survive; a remount would reset everything on its own and
    // this test would pass with the reset deleted.
    mockSlug = "2026-08-16-a-typo";
    rerender(<CoordPlanDetailPage />);

    expect(
      await screen.findByTestId("coord-plan-detail-missing")
    ).toHaveTextContent(/not found/i);
    expect(screen.queryByText("The first plan")).not.toBeInTheDocument();
  });

  it("shows the phase, which the page's own type used to throw away", async () => {
    routeGets({
      detail: {
        work_unit: { slug: SLUG, status: "in_progress", current_phase: "3" },
      },
      history: { history: [] },
    });
    render(<CoordPlanDetailPage />);

    // `derivePlanStatus` reads `current_phase` and nothing else for its
    // `reason`; dropping the field from `CoordWorkUnit` disarmed it silently,
    // with every test green.
    //
    // `<StatusBadge>` puts `reason` in the `title` (`statusRow.tsx:231,248`),
    // not in the text, so this asserts where the string actually lands — a
    // `toHaveTextContent` here would fail against a working badge.
    const meta = await screen.findByTestId("coord-plan-meta");
    const badge = meta.querySelector("[data-status-kind]");
    expect(badge).toHaveAttribute("title", expect.stringContaining("phase 3"));
  });
});
