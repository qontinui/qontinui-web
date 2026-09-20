/**
 * `/admin/coord/plans` — the repointed plan-corpus page, end to end.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store`, Phases 1
 * and 2. The derivations are pinned over the pure module in
 * `components/admin/coord/planReconciliationStatus.test.ts`; what is pinned
 * HERE is that the page actually reaches the screen with them — above all the
 * exit criterion's second, equally binding half:
 *
 * > On a read where coord's work-unit population arm is `unavailable`, the
 * > page must tell the operator that axis A is UNKNOWN for every row and must
 * > NOT claim the document layer is complete.
 *
 * Both arms are fixtures below, taken from the plan's Phase 0 reading of eight
 * live probes on 2026-09-20 — five of which were the degraded one.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ReconciliationResponse,
  ReconciliationRowData,
} from "@/components/admin/coord/planReconciliationStatus";
import type { CaptureHealthResponse } from "@/components/admin/coord/captureHealthStatus";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plans",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

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

function row(over: Partial<ReconciliationRowData> = {}): ReconciliationRowData {
  return {
    slug: "2026-09-05-every-bounded-read-is-a-page",
    title: "Every bounded read is a page that reads as a corpus",
    document_state: "present",
    document_axis_complete: true,
    axis_a: { readable: true, present: true, status: "vetted" },
    axis_b: {
      readable: true,
      present: true,
      status: "vetted",
      classification: "ok",
      document_state: "present",
      complete: true,
    },
    axis_c: { readable: true, present: true, computed: false },
    classification: "UNKNOWN_AXIS_UNREADABLE",
    verdict: "unknown",
    reason: "axis C was not computed for this row",
    ...over,
  };
}

/** The GOOD arm — coord's population was read. 3 of 8 probes, 2026-09-20. */
function healthy(
  over: Partial<ReconciliationResponse> = {}
): ReconciliationResponse {
  return {
    items: [row()],
    total: 1991,
    offset: 0,
    limit: 25,
    ordering: "slug_asc",
    document_axis_source: "artifact_store",
    document_axis_complete: false,
    document_present_count: 1887,
    document_missing_count: 104,
    coord_available: true,
    work_unit_population_state: "included",
    work_unit_population_reason: null,
    axis_c_scope: "page",
    axis_c_computed_count: 25,
    facets: {
      denominator: 1991,
      by_class: { UNKNOWN_AXIS_UNREADABLE: 1969, AGREE_TERMINAL: 18 },
      by_verdict: { agree: 19, disagree: 0, unknown: 1972 },
      corpus_complete: false,
      corpus_incomplete_reasons: [
        "axis C was derived for 25 of 1991 rows — the page — and the rest classify UNKNOWN_AXIS_UNREADABLE",
      ],
    },
    ...over,
  };
}

/**
 * The DEGRADED arm — 5 of 8 probes, and the MORE optimistic one:
 * `document_axis_complete: true`, `document_missing_count: 0`, over a
 * population that collapsed to the artifact store.
 */
function degraded(
  over: Partial<ReconciliationResponse> = {}
): ReconciliationResponse {
  return {
    ...healthy(),
    total: 1887,
    document_axis_complete: true,
    document_present_count: 1887,
    document_missing_count: 0,
    coord_available: false,
    work_unit_population_state: "unavailable",
    work_unit_population_reason: "coord returned 504: non-JSON body (25 bytes)",
    axis_c_computed_count: 0,
    facets: {
      denominator: 1887,
      by_class: { UNKNOWN_AXIS_UNREADABLE: 1887 },
      by_verdict: { agree: 0, disagree: 0, unknown: 1887 },
      corpus_complete: false,
      corpus_incomplete_reasons: [
        "coord's work-unit list could not be read, so axis A is UNKNOWN for every row",
      ],
    },
    ...over,
  };
}

function contractRefusal(violations: string[]): Error {
  return new Error(
    "GET /api/v1/plan-library/reconciliation?offset=0&limit=25 failed: 500 - " +
      JSON.stringify({
        detail: { error: "reconciliation_contract_violated", violations },
      })
  );
}

beforeEach(() => {
  get.mockReset();
});

describe("/admin/coord/plans reads the reconciliation route", () => {
  it("asks /plan-library/reconciliation, not the work-unit proxy", async () => {
    get.mockResolvedValue(healthy());
    render(<CoordPlansListPage />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    const url = String(get.mock.calls[0]?.[0]);
    expect(url).toContain("/api/v1/plan-library/reconciliation");
    expect(url).toContain("offset=0");
    expect(url).toContain("limit=25");
    expect(url).not.toContain("/operations/plans");
  });

  it("renders the stem, the three axes, the class, the verdict and the reason", async () => {
    get.mockResolvedValue(healthy());
    render(<CoordPlansListPage />);

    const row0 = await screen.findByTestId("coord-plan-reconciliation-row");
    expect(row0).toHaveTextContent("every-bounded-read-is-a-page");
    expect(within(row0).getByTestId("coord-plan-axis-a")).toHaveTextContent(
      "vetted"
    );
    expect(within(row0).getByTestId("coord-plan-axis-b")).toHaveTextContent(
      "vetted"
    );
    const verdict = within(row0).getByTestId("coord-plan-verdict");
    expect(verdict).toHaveAttribute("data-verdict", "unknown");
    expect(verdict).toHaveAttribute(
      "data-classification",
      "UNKNOWN_AXIS_UNREADABLE"
    );
    expect(row0).toHaveTextContent("axis C was not computed for this row");
  });

  it("renders an off-page row's axis C as 'delivery not asked'", async () => {
    get.mockResolvedValue(healthy());
    render(<CoordPlansListPage />);

    const cell = await screen.findByTestId("coord-plan-axis-c");
    expect(cell).toHaveAttribute("data-axis-kind", "not-asked");
    expect(cell).toHaveAttribute("data-unknown", "true");
    expect(cell).toHaveTextContent("delivery not asked");
    expect(cell).not.toHaveTextContent("not delivered");
  });

  it("renders shipped:false under incomplete evidence as UNKNOWN, with the gaps", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(
      healthy({
        items: [
          row({
            axis_c: {
              readable: true,
              present: true,
              computed: true,
              shipped: false,
              evidence_complete: false,
              evidence_gaps: ["no citations captured for this unit"],
            },
          }),
        ],
      })
    );
    render(<CoordPlansListPage />);

    const cell = await screen.findByTestId("coord-plan-axis-c");
    expect(cell).toHaveAttribute("data-axis-kind", "evidence-incomplete");
    expect(cell).toHaveTextContent("evidence incomplete");

    // The row line is the toggle — `<RecordRow>` renders it as the button
    // that owns `data-console-row`.
    await user.click(
      within(
        await screen.findByTestId("coord-plan-reconciliation-row")
      ).getByRole("button")
    );
    expect(
      await screen.findByTestId("coord-plan-evidence-gaps")
    ).toHaveTextContent("no citations captured for this unit");
  });

  it("surfaces a divergent document copy rather than collapsing it silently", async () => {
    get.mockResolvedValue(
      healthy({
        items: [
          row({
            axis_b: {
              readable: true,
              present: true,
              status: "vetted",
              document_state: "present",
              complete: true,
              variant_count: 3,
            },
          }),
        ],
      })
    );
    render(<CoordPlansListPage />);

    const marker = await screen.findByTestId("coord-plan-divergent");
    expect(marker).toHaveAttribute("data-variant-count", "3");
    expect(marker).toHaveTextContent("3 copies");
  });

  it("gives that marker somewhere to go (Phase 4b)", async () => {
    // Until `/admin/coord/plan-forks` existed the marker was a notice, not a
    // route to the answer: `/plan-library/divergent` had zero consumers.
    const user = userEvent.setup();
    get.mockResolvedValue(
      healthy({
        items: [
          row({
            axis_b: {
              readable: true,
              present: true,
              status: "vetted",
              document_state: "present",
              complete: true,
              variant_count: 3,
            },
          }),
        ],
      })
    );
    render(<CoordPlansListPage />);

    expect(await screen.findByTestId("coord-plan-divergent")).toHaveAttribute(
      "href",
      "/admin/coord/plan-forks"
    );
    await user.click(
      within(
        await screen.findByTestId("coord-plan-reconciliation-row")
      ).getByRole("button")
    );
    expect(
      await screen.findByTestId("coord-plan-divergent-link")
    ).toHaveAttribute("href", "/admin/coord/plan-forks");
  });
});

describe("/admin/coord/plans says what the window is", () => {
  it("states total, offset, page size, ordering and both boundary stems", async () => {
    get.mockResolvedValue(
      healthy({
        items: [
          row({ slug: "2026-01-01-first" }),
          row({ slug: "2026-09-05-last" }),
        ],
        offset: 50,
      })
    );
    render(<CoordPlansListPage />);

    const window = await screen.findByTestId("coord-plans-window");
    expect(window).toHaveTextContent("Showing 2 of 1991 plan stems");
    expect(window).toHaveTextContent("2026-01-01-first");
    expect(window).toHaveTextContent("2026-09-05-last");
    expect(window).toHaveTextContent("offset 50");
    expect(
      within(window).getByTestId("coord-plans-window-ordering")
    ).toHaveTextContent("slug_asc");
  });

  it("says the total is UNKNOWN rather than substituting the page size", async () => {
    get.mockResolvedValue(healthy({ total: undefined }));
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId("coord-plans-window-total-unknown")
    ).toHaveTextContent("unknown total");
  });

  it("pages by offset, and the route's ceiling bounds the page size", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(healthy());
    render(<CoordPlansListPage />);

    await screen.findByTestId("coord-plans-window");
    expect(screen.getByTestId("coord-plans-page-prev")).toBeDisabled();

    await user.click(screen.getByTestId("coord-plans-page-next"));
    await waitFor(() =>
      expect(
        get.mock.calls.some((c) => String(c[0]).includes("offset=25"))
      ).toBe(true)
    );

    await user.click(screen.getByTestId("coord-plans-page-size-select"));
    await user.click(
      await screen.findByRole("option", { name: "100 per page" })
    );
    await waitFor(() =>
      expect(
        get.mock.calls.some((c) => String(c[0]).includes("limit=100"))
      ).toBe(true)
    );
    // Changing the page size returns to the first page — an offset computed
    // against the old size addresses a different window under the new one.
    expect(
      get.mock.calls.some(
        (c) =>
          String(c[0]).includes("limit=100") &&
          String(c[0]).includes("offset=0")
      )
    ).toBe(true);
  });
});

describe("the degraded population arm — the plan's exit criterion", () => {
  it("does NOT claim the document layer is complete", async () => {
    get.mockResolvedValue(degraded());
    render(<CoordPlansListPage />);

    const block = await screen.findByTestId("coord-plans-disclosure");
    expect(block).not.toHaveTextContent(
      "Every row in the denominator has a document"
    );
    expect(block).not.toHaveTextContent("1887 of 1887");
    expect(
      screen.queryByTestId("coord-plans-disclosure-document-axis")
    ).toBeNull();
    expect(
      screen.getByTestId("coord-plans-disclosure-document-axis-suppressed")
    ).toHaveTextContent("SUPPRESSED");
  });

  it("says axis A is UNKNOWN for every row, and quotes coord's reason verbatim", async () => {
    get.mockResolvedValue(degraded());
    render(<CoordPlansListPage />);

    const line = await screen.findByTestId("coord-plans-disclosure-population");
    expect(line).toHaveAttribute("data-level", "critical");
    expect(line).toHaveTextContent("UNKNOWN for EVERY row");
    expect(
      within(line).getByTestId("coord-plans-disclosure-population-items")
    ).toHaveTextContent("coord returned 504: non-JSON body (25 bytes)");
  });

  it("puts the population line ABOVE everything derived from the population", async () => {
    get.mockResolvedValue(degraded());
    render(<CoordPlansListPage />);

    const block = await screen.findByTestId("coord-plans-disclosure");
    const keys = Array.from(block.children).map((el) =>
      el.getAttribute("data-testid")
    );
    expect(keys[0]).toBe("coord-plans-disclosure-population");
    expect(
      keys.indexOf("coord-plans-disclosure-document-axis-suppressed")
    ).toBeGreaterThan(0);
  });

  it("dashes the verdict counts rather than publishing the collapsed histogram", async () => {
    get.mockResolvedValue(degraded());
    render(<CoordPlansListPage />);

    const strip = await screen.findByTestId("coord-plans-health");
    expect(strip).toHaveTextContent("plans –");
    expect(strip).toHaveTextContent("unknown –");
    expect(strip).not.toHaveTextContent("1887");
  });

  it("states coord_available: false", async () => {
    get.mockResolvedValue(degraded());
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId("coord-plans-disclosure-coord-available")
    ).toHaveTextContent("At least one coord read degraded");
  });

  it("names axis C's own denominator, separately from the document one", async () => {
    get.mockResolvedValue(healthy());
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId("coord-plans-disclosure-axis-c-scope")
    ).toHaveTextContent("Delivery was asked for 25 of 1991 rows");
  });

  it("renders corpus_incomplete_reasons verbatim as a list", async () => {
    get.mockResolvedValue(degraded());
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId(
        "coord-plans-disclosure-corpus-incomplete-items"
      )
    ).toHaveTextContent(
      "coord's work-unit list could not be read, so axis A is UNKNOWN for every row"
    );
  });

  it("names the artifact store on the good arm, so nobody infers origin/main", async () => {
    get.mockResolvedValue(healthy());
    render(<CoordPlansListPage />);

    const line = await screen.findByTestId(
      "coord-plans-disclosure-document-axis"
    );
    expect(line).toHaveTextContent("artifact store");
    expect(line).toHaveTextContent("not against origin/main");
    expect(line).toHaveTextContent("1887 of 1991");
  });
});

describe("the five read states", () => {
  it("renders the route's 500 refusal as a NAMED refusal with its violations", async () => {
    get.mockRejectedValue(
      contractRefusal([
        "by_class does not sum to the denominator",
        "corpus_complete is false but no blind spot was named",
      ])
    );
    render(<CoordPlansListPage />);

    const block = await screen.findByTestId("coord-plans-contract-violation");
    expect(block).toHaveTextContent("refused this read");
    expect(
      within(block).getByTestId("coord-plans-contract-violation-list")
    ).toHaveTextContent("by_class does not sum to the denominator");
    // Distinct from the unknown and stale arms.
    expect(screen.queryByTestId("coord-plans-unknown")).toBeNull();
    expect(screen.getByTestId("coord-plans-refused")).toBeInTheDocument();
    // ...and NOT rendered as a generic failure banner.
    expect(screen.queryByText(/^Failed to load:/)).toBeNull();
  });

  it("says a refusal naming no violation left the cause unknown", async () => {
    get.mockRejectedValue(contractRefusal([]));
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId("coord-plans-contract-violation-empty")
    ).toHaveTextContent("unknown");
  });

  it("renders an ordinary failure as UNKNOWN, not as an empty corpus", async () => {
    get.mockRejectedValue(new Error("GET /x failed: 503 - upstream"));
    render(<CoordPlansListPage />);

    expect(await screen.findByTestId("coord-plans-unknown")).toHaveTextContent(
      "unknown, not none"
    );
    expect(screen.queryByTestId("coord-plans-empty")).toBeNull();
  });

  it("renders a failed refresh over a loaded empty window as STALE", async () => {
    const user = userEvent.setup();
    get
      .mockResolvedValueOnce(healthy({ items: [] }))
      .mockRejectedValue(new Error("GET /x failed: 503 - upstream"));
    render(<CoordPlansListPage />);

    await screen.findByTestId("coord-plans-empty");
    await user.click(screen.getByTestId("coord-plans-refresh"));
    expect(await screen.findByTestId("coord-plans-stale")).toBeInTheDocument();
  });

  it("blames the status filter, not coord, when the filter empties the page", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(healthy());
    render(<CoordPlansListPage />);

    await screen.findByTestId("coord-plan-reconciliation-row");
    await user.click(screen.getByTestId("coord-plans-status-select"));
    await user.click(await screen.findByRole("option", { name: "Shipped" }));

    const empty = await screen.findByTestId(
      "coord-plans-status-filtered-empty"
    );
    expect(empty).toHaveTextContent("page-scoped");
    expect(screen.queryByTestId("coord-plans-empty")).toBeNull();
    // The filter is client-side, so it must not have re-asked the route.
    expect(get.mock.calls.every((c) => !String(c[0]).includes("status="))).toBe(
      true
    );
  });

  it("says a genuinely empty window is empty, once coord has answered", async () => {
    get.mockResolvedValue(healthy({ items: [] }));
    render(<CoordPlansListPage />);

    expect(await screen.findByTestId("coord-plans-empty")).toHaveTextContent(
      "No plan stems in this window"
    );
  });
});

/**
 * Phase 4a — the capture census, beside the document-axis line.
 *
 * `/plan-library/capture-health` had zero frontend consumers on `origin/main`
 * [policy: `capability-ships-enabled`], and it is the companion to Phase 0's
 * reading: that reading established the document layer is 94.8% complete and
 * left standing *by which door, and is that door still alive?*
 *
 * These tests pin the two honesty properties the route's own schema spells
 * out, and the one this plan adds on top of them.
 */

const CAPTURE: CaptureHealthResponse = {
  total: 1887,
  doors: [
    {
      captured_by: "runner_scan",
      count: 1880,
      known: true,
      first_at: "2026-06-01T00:00:00Z",
      last_touched_at: "2026-09-20T09:00:00Z",
    },
    // The finding. Zero, and it must reach the screen.
    { captured_by: "agent", count: 0, known: true },
    {
      captured_by: "operator",
      count: 7,
      known: true,
      first_at: "2026-08-01T00:00:00Z",
      last_touched_at: "2026-09-01T00:00:00Z",
    },
  ],
  newest_updated_at: "2026-09-20T09:00:00Z",
};

/** Route by URL — the page makes two reads against two different stores. */
function routed(
  reconciliation: ReconciliationResponse | Error,
  capture: CaptureHealthResponse | Error
) {
  get.mockImplementation((url: unknown) => {
    const answer = String(url).includes("capture-health")
      ? capture
      : reconciliation;
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
}

describe("the capture census beside the document-axis line", () => {
  it("reads /plan-library/capture-health at all", async () => {
    routed(healthy(), CAPTURE);
    render(<CoordPlansListPage />);

    await waitFor(() =>
      expect(
        get.mock.calls.some((c) =>
          String(c[0]).includes("/api/v1/plan-library/capture-health")
        )
      ).toBe(true)
    );
  });

  it("RENDERS a door with zero artifacts — a zero is the finding", async () => {
    routed(healthy(), CAPTURE);
    render(<CoordPlansListPage />);

    const doors = await screen.findAllByTestId("coord-capture-door");
    // Three rows, not two: a door missing from the list would read as an
    // absent feature rather than an unused one.
    expect(doors).toHaveLength(3);
    const agent = doors.find((d) => d.getAttribute("data-door") === "agent");
    expect(agent).toBeDefined();
    expect(agent).toHaveAttribute("data-silent", "true");
    expect(
      within(agent as HTMLElement).getByTestId("coord-capture-door-silent")
    ).toHaveTextContent("written nothing");
  });

  it("says in words which door has written nothing", async () => {
    routed(healthy(), CAPTURE);
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId("coord-capture-health-silent-finding")
    ).toHaveTextContent("agent write door");
  });

  it("labels the timestamp last TOUCHED, never last captured", async () => {
    routed(healthy(), CAPTURE);
    render(<CoordPlansListPage />);

    await screen.findAllByTestId("coord-capture-door");
    expect(screen.getByTestId("coord-capture-health")).toHaveTextContent(
      "last touched"
    );
    expect(screen.getByTestId("coord-capture-health")).not.toHaveTextContent(
      "last captured,"
    );
  });

  it("renders a null newest_updated_at as UNKNOWN, not as fresh", async () => {
    routed(healthy(), { ...CAPTURE, newest_updated_at: null });
    render(<CoordPlansListPage />);

    const newest = await screen.findByTestId("coord-capture-health-newest");
    expect(newest).toHaveAttribute("data-unknown", "true");
    expect(newest).toHaveTextContent("unknown");
    expect(newest).not.toHaveTextContent("just now");
  });

  it("does NOT present itself as restoring a suppressed completeness claim", async () => {
    // The degraded population arm — 5 of 8 probes on 2026-09-20 — is the one
    // where `document_axis_complete` is vacuously true and the page suppresses
    // it. The census still renders (the artifact store answered) and must say
    // it repairs nothing.
    routed(degraded(), CAPTURE);
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId(
        "coord-plans-disclosure-document-axis-suppressed"
      )
    ).toBeInTheDocument();
    const secondRead = screen.getByTestId("coord-capture-health-second-read");
    expect(secondRead).toHaveTextContent("does NOT restore");
    expect(secondRead).toHaveTextContent("different moments");
    // And the census is still there — suppression is about the verdict, not
    // about refusing to show a store that answered.
    expect(await screen.findAllByTestId("coord-capture-door")).toHaveLength(3);
  });

  it("says only the timing caveat when nothing was suppressed", async () => {
    routed(healthy(), CAPTURE);
    render(<CoordPlansListPage />);

    const secondRead = await screen.findByTestId(
      "coord-capture-health-second-read"
    );
    expect(secondRead).toHaveTextContent("own timing");
    expect(secondRead).not.toHaveTextContent("does NOT restore");
  });

  it("renders a failed census read as UNKNOWN, never as no doors", async () => {
    routed(healthy(), new Error("GET /x failed: 503 - upstream"));
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId("coord-capture-health-unknown")
    ).toHaveTextContent("UNKNOWN");
    expect(screen.queryAllByTestId("coord-capture-door")).toHaveLength(0);
  });

  it("calls a response with no door list a shape it does not understand", async () => {
    routed(healthy(), { total: 0 });
    render(<CoordPlansListPage />);

    expect(
      await screen.findByTestId("coord-capture-health-doors-unstated")
    ).toHaveTextContent("not a corpus with no doors");
  });
});
