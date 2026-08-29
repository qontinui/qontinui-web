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

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "2026-08-16-a-plan" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: false }),
}));

import CoordPlanDetailPage from "./page";

const SLUG = "2026-08-16-a-plan";
const DETAIL_URL = `/api/v1/operations/plans/${SLUG}`;
const HISTORY_URL = `${DETAIL_URL}/history`;

/**
 * Route the page's two GETs independently. An `Error` value means that call
 * REJECTS — the failure mode the whole file is about, and the one a single
 * blanket `mockResolvedValue` cannot express.
 */
function routeGets(handlers: { detail: unknown; history: unknown }) {
  httpGet.mockImplementation((url: string) => {
    const v = url === HISTORY_URL ? handlers.history : handlers.detail;
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  });
}

describe("CoordPlanDetailPage — a failed read is not an absence", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpPost.mockReset();
  });

  it("says the plan is UNKNOWN, not missing, when the detail read fails", async () => {
    routeGets({
      detail:new Error("coord unreachable"),
      history:new Error("coord unreachable"),
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

  it("still says 'not found' when coord answered and the plan really is absent", async () => {
    // The distinction only means something if the honest 404 survives it.
    routeGets({ detail: {}, history: { history: [] } });
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
      detail:({ work_unit: { slug: SLUG, status: "in_progress" } }),
      history:new Error("history endpoint down"),
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
      detail:({ work_unit: { slug: SLUG, status: "in_progress" } }),
      history:({ history: [] }),
    });
    render(<CoordPlanDetailPage />);

    expect(
      await screen.findByTestId("coord-plan-history-empty")
    ).toHaveTextContent(/No status history yet/i);
    expect(
      screen.queryByTestId("coord-plan-history-unknown")
    ).not.toBeInTheDocument();
  });

  it("shows the phase, which the page's own type used to throw away", async () => {
    routeGets({
      detail:({
        work_unit: {
          slug: SLUG,
          status: "in_progress",
          current_phase: "3",
        },
      }),
      history:({ history: [] }),
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
