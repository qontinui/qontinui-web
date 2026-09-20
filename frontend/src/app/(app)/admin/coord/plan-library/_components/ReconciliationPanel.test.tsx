/**
 * ReconciliationPanel — the ways "we could not tell" becomes "they agree".
 *
 * The backend spends a whole cascade making one thing impossible: an unread
 * axis falling through into agreement. Every one of those guarantees is
 * reachable again in a presentation layer — a `?? 0` on a missing class, a
 * bare `shipped` badge, an empty blind-spot list rendered as a clean bill of
 * health — and an operator would then read confident agreement off a response
 * that refused to state it.
 *
 * So each test pins one rule, by MUTATION where a mutation exists: flip the
 * one field the rule keys on and the copy must change. Fixtures are shapes the
 * ROUTE can actually emit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const useReconciliationMock = vi.fn();
vi.mock("../_hooks/usePlanLibrary", () => ({
  useReconciliation: () => useReconciliationMock(),
}));

import {
  ReconciliationPanel,
  axisASentence,
  axisBSentence,
  axisCSentence,
  classRows,
} from "./ReconciliationPanel";
import type {
  ReconciliationAxisA,
  ReconciliationAxisB,
  ReconciliationAxisC,
  ReconciliationResponse,
  ReconciliationRow,
} from "../types";
import { RECONCILIATION_CLASS_ORDER } from "../types";

function axisA(
  overrides: Partial<ReconciliationAxisA> = {}
): ReconciliationAxisA {
  return {
    readable: true,
    present: true,
    status: "in_progress",
    unreadable_reason: null,
    ...overrides,
  };
}

function axisB(
  overrides: Partial<ReconciliationAxisB> = {}
): ReconciliationAxisB {
  return {
    source: "artifact_store",
    readable: true,
    present: true,
    status: "in_progress",
    classification: "ok",
    adapter_readable: true,
    document_state: "present",
    complete: true,
    unreadable_reason: null,
    variant_count: 1,
    ...overrides,
  };
}

function axisC(
  overrides: Partial<ReconciliationAxisC> = {}
): ReconciliationAxisC {
  return {
    readable: true,
    present: true,
    shipped: false,
    evidence_complete: true,
    evidence_gaps: [],
    citation_count: 2,
    unreadable_reason: null,
    computed: true,
    ...overrides,
  };
}

function row(overrides: Partial<ReconciliationRow> = {}): ReconciliationRow {
  return {
    slug: "2026-09-15-a-plan",
    title: "A plan",
    artifact_id: "00000000-0000-4000-8000-000000000001",
    source_repo: "qontinui-dev-notes/plans",
    source_path: "plans/2026-09-15-a-plan.md",
    document_state: "present",
    document_axis_complete: true,
    axis_a: axisA(),
    axis_b: axisB(),
    axis_c: axisC(),
    classification: "AGREE_OPEN",
    verdict: "agree",
    reason: "Every axis was read and they agree the work is open.",
    ...overrides,
  };
}

/** Every class at zero — the shape the panel must still render in full. */
function zeroClasses(): Record<string, number> {
  return Object.fromEntries(RECONCILIATION_CLASS_ORDER.map((c) => [c, 0]));
}

function response(
  overrides: Partial<ReconciliationResponse> = {}
): ReconciliationResponse {
  return {
    items: [row()],
    total: 1,
    offset: 0,
    limit: 25,
    ordering: "slug_asc",
    document_axis_source: "artifact_store",
    document_axis_complete: true,
    document_present_count: 1,
    document_missing_count: 0,
    coord_available: true,
    work_unit_population_state: "included",
    work_unit_population_reason: null,
    axis_c_scope: "page",
    axis_c_computed_count: 1,
    facets: {
      denominator: 1,
      by_class: { ...zeroClasses(), AGREE_OPEN: 1 },
      by_verdict: { agree: 1, disagree: 0, unknown: 0 },
      corpus_complete: true,
      corpus_incomplete_reasons: [],
    },
    ...overrides,
  };
}

function mount(data: ReconciliationResponse | null, extra = {}) {
  useReconciliationMock.mockReturnValue({
    data,
    fetchedAt: data ? new Date("2026-09-20T12:00:00Z") : null,
    loading: false,
    error: null,
    reload: vi.fn(),
    offset: 0,
    setOffset: vi.fn(),
    includeCoord: true,
    setIncludeCoord: vi.fn(),
    pageSize: 25,
    ...extra,
  });
  return render(<ReconciliationPanel />);
}

beforeEach(() => {
  useReconciliationMock.mockReset();
});

describe("classRows", () => {
  it("keeps every class INCLUDING the served zeros, in cascade order", () => {
    // D3's whole point: "no rows of class X" is a stated fact. Iterating the
    // served object's keys would drop exactly the classes an operator most
    // wants to see read zero.
    const rows = classRows({ ...zeroClasses(), AGREE_OPEN: 3 });
    expect(rows).toHaveLength(RECONCILIATION_CLASS_ORDER.length);
    expect(rows.map((r) => r.name)).toEqual([...RECONCILIATION_CLASS_ORDER]);
    expect(rows.find((r) => r.name === "UNKNOWN_NO_UNIT")?.count).toBe(0);
    expect(rows.find((r) => r.name === "AGREE_OPEN")?.count).toBe(3);
  });

  it("distinguishes a SERVED zero from a class the response omitted", () => {
    // The backend serves all twelve including the zeros, so a missing key is
    // "not served", not "none of these". `StatCluster` renders null as an em
    // dash and 0 as 0 — collapsing the two with `?? 0` would state a count
    // nobody measured, on the panel whose thesis is absence-is-not-zero.
    const rows = classRows({ AGREE_OPEN: 3 });
    expect(rows.find((r) => r.name === "UNKNOWN_NO_UNIT")?.count).toBeNull();
    expect(rows.find((r) => r.name === "AGREE_OPEN")?.count).toBe(3);
  });

  it("surfaces a class the backend added that this build does not know", () => {
    // A thirteenth member must become a visible row, not vanish because our
    // copy of the cascade is older than the server's.
    const rows = classRows({ ...zeroClasses(), BRAND_NEW_CLASS: 4 });
    expect(rows.at(-1)).toEqual({ name: "BRAND_NEW_CLASS", count: 4 });
  });
});

describe("axisCSentence — evidence_complete is read BEFORE shipped", () => {
  it("says UNKNOWN, never “did not ship”, when the evidence is incomplete", () => {
    const text = axisCSentence(
      axisC({
        shipped: false,
        evidence_complete: false,
        evidence_gaps: ["citation_unmerged", "no_pr_cited"],
      })
    );
    expect(text).toContain("could not establish delivery");
    expect(text).toContain("NOT");
    expect(text).not.toMatch(/has not shipped/);
    // Gaps VERBATIM, never collapsed to a count.
    expect(text).toContain("citation_unmerged");
    expect(text).toContain("no_pr_cited");
  });

  it("only says “has not shipped” when the evidence IS complete", () => {
    // The mutation that proves the rule above is load-bearing: same `shipped`,
    // one flipped flag, opposite sentence.
    expect(
      axisCSentence(axisC({ shipped: false, evidence_complete: true }))
    ).toContain("has not shipped");
  });

  it("an OFF-PAGE row says so, keyed on the reason and not on `computed`", () => {
    // The backend's off-page arm: readable=false with its own reason.
    expect(
      axisCSentence(
        axisC({
          computed: false,
          readable: false,
          present: false,
          unreadable_reason:
            "axis C (coord's derived delivery verdict) is computed only for the page being returned \u2014 coord's delivery door is per-unit. Page to this row to have it derived.",
        })
      )
    ).toContain("outside the page");
  });

  it("an ON-PAGE unreadable row prints its reason, NOT “outside the page”", () => {
    // `computed: false` fires on FOUR backend arms and only ONE is off-page.
    // Checking it first claimed three on-page rows were off-page, told the
    // operator to "page to it" (which can never help), and swallowed the
    // `unreadable_reason` entirely. With `include_coord=false` that was EVERY
    // row on screen.
    const text = axisCSentence(
      axisC({
        computed: false,
        readable: false,
        present: false,
        unreadable_reason: "coord could not be read",
      })
    );
    expect(text).toContain("coord could not be read");
    expect(text).not.toContain("outside the page");
    expect(text).toContain("unknown, not undelivered");
  });

  it("a row whose stem has no work unit is an absence, not an unread page", () => {
    // readable=true, present=false, computed=false — an OBSERVATION of
    // absence, which must not read as "we did not ask".
    const text = axisCSentence(
      axisC({ computed: false, readable: true, present: false })
    );
    expect(text).toContain("no delivery verdict");
    expect(text).not.toContain("outside the page");
  });

  it("`shipped: null` under COMPLETE evidence is unknown, never “has not shipped”", () => {
    // `shipped` is `boolean | null` and pinned nullable against both OpenAPI
    // snapshots. A ternary sent null into the falsy arm and announced a
    // definite negative delivery claim.
    const text = axisCSentence(
      axisC({ shipped: null, evidence_complete: true })
    );
    expect(text).toContain("unknown");
    expect(text).not.toContain("has not shipped");
  });

  it("a null evidence_complete is unreadable either way", () => {
    expect(axisCSentence(axisC({ evidence_complete: null }))).toContain(
      "cannot be read either way"
    );
  });
});

describe("axisASentence", () => {
  it("calls an empty stored status what it is — a detached unit", () => {
    expect(axisASentence(axisA({ status: "" }))).toContain("detaches the unit");
  });

  it("an unreadable axis is unknown, not absent", () => {
    expect(
      axisASentence(axisA({ readable: false, unreadable_reason: "timeout" }))
    ).toMatch(/unknown, not absent/);
  });
});

describe("axisBSentence", () => {
  it("an incomplete document axis is never agreement", () => {
    const text = axisBSentence(
      axisB({ complete: false, document_state: "absent" })
    );
    expect(text).toContain("nothing to compare");
    expect(text).toContain("never agreement");
  });

  it("names the adapter substitution only on an explicit false", () => {
    expect(axisBSentence(axisB({ adapter_readable: false }))).toContain(
      "substitutes"
    );
    // `null` is UNKNOWN and neutral — it must stay silent rather than accuse.
    expect(axisBSentence(axisB({ adapter_readable: null }))).not.toContain(
      "substitutes"
    );
  });

  it("makes a divergent copy visible rather than silently collapsing it", () => {
    expect(axisBSentence(axisB({ variant_count: 3 }))).toContain("3 artifact");
  });
});

describe("ReconciliationPanel", () => {
  it("renders every class including the zeros", () => {
    mount(response());
    for (const name of RECONCILIATION_CLASS_ORDER) {
      expect(
        screen.getByTestId(`reconciliation-class-${name}`)
      ).toBeInTheDocument();
    }
  });

  it("states the denominator as the whole population, not the page", () => {
    mount(
      response({
        items: [row()],
        total: 900,
        facets: { ...response().facets, denominator: 900 },
      })
    );
    expect(screen.getByTestId("reconciliation-denominator")).toHaveTextContent(
      /900 plan stems — the whole population, not this page/
    );
  });

  it("renders the SERVED blind-spot reasons", () => {
    mount(
      response({
        facets: {
          ...response().facets,
          corpus_complete: false,
          corpus_incomplete_reasons: ["the document layer is frozen"],
        },
      })
    );
    const banner = screen.getByTestId("reconciliation-blind-spots");
    expect(banner).toHaveTextContent("not whole, so it is not agreement");
    expect(banner).toHaveTextContent("the document layer is frozen");
  });

  it("raises the banner on `corpus_complete: false` even with NO reasons served", () => {
    // The critical one. `corpus_complete` is REQUIRED on the wire;
    // `corpus_incomplete_reasons` is defaulted and may be absent. Keying the
    // banner off the reasons array let an incomplete corpus render as a whole
    // one — the exact failure this panel exists to prevent, reachable through
    // the one field the wire marks optional.
    mount(
      response({
        facets: {
          ...response().facets,
          corpus_complete: false,
          corpus_incomplete_reasons: [],
        },
      })
    );
    const banner = screen.getByTestId("reconciliation-blind-spots");
    expect(banner).toHaveTextContent("not whole, so it is not agreement");
    expect(
      screen.getByTestId("reconciliation-blind-spots-unexplained")
    ).toHaveTextContent("named no blind spot");
  });

  it("does not throw when the defaulted reasons array is absent entirely", () => {
    // Deploy skew: the field is `default_factory=list` on the wire, so an
    // older/newer backend may omit it. A bare spread threw and took the route
    // segment down.
    const r = response();
    // @ts-expect-error — modelling a response that omits a defaulted field.
    delete r.facets.corpus_incomplete_reasons;
    r.facets.corpus_complete = false;
    mount(r);
    expect(
      screen.getByTestId("reconciliation-blind-spots")
    ).toBeInTheDocument();
  });

  it("has NO banner when the read really was whole", () => {
    // The mutation partner: without this, a banner that always rendered would
    // pass every test above and say nothing.
    mount(response());
    expect(
      screen.queryByTestId("reconciliation-blind-spots")
    ).not.toBeInTheDocument();
  });

  it("an unavailable work-unit population is unknown for EVERY row", () => {
    // ROUTABLE fixture: the route appends a reason and clears
    // `corpus_complete` for this condition, so a fixture that set the flag
    // alone taught a shape the backend cannot emit — and hid the fact that
    // the panel was printing every blind spot twice.
    mount(
      response({
        work_unit_population_state: "unavailable",
        work_unit_population_reason: "coord 503",
        facets: {
          ...response().facets,
          corpus_complete: false,
          corpus_incomplete_reasons: [
            "coord's work unit list could not be read",
          ],
        },
      })
    );
    const banner = screen.getByTestId("reconciliation-blind-spots");
    // The SERVED sentence is shown, and our local gloss is NOT added on top
    // of it — one blind spot, stated once.
    expect(banner).toHaveTextContent("work unit list could not be read");
    expect(banner).not.toHaveTextContent("unknown for EVERY row");
  });

  it("adds its own sentence only when the served reasons do not cover the flag", () => {
    // The other side of the de-duplication: a flag the served list says
    // nothing about must still be explained.
    mount(
      response({
        work_unit_population_state: "unavailable",
        work_unit_population_reason: "coord 503",
        facets: {
          ...response().facets,
          corpus_complete: false,
          corpus_incomplete_reasons: ["something unrelated"],
        },
      })
    );
    const banner = screen.getByTestId("reconciliation-blind-spots");
    expect(banner).toHaveTextContent("unknown for EVERY row");
    expect(banner).toHaveTextContent("coord 503");
  });

  it("a degraded coord read is stated", () => {
    mount(
      response({
        coord_available: false,
        facets: {
          ...response().facets,
          corpus_complete: false,
          corpus_incomplete_reasons: [],
        },
      })
    );
    expect(screen.getByTestId("reconciliation-blind-spots")).toHaveTextContent(
      "coord read degraded"
    );
  });

  it("an incomplete document layer is measured against the served denominator", () => {
    mount(
      response({
        document_axis_complete: false,
        document_present_count: 18,
        document_missing_count: 1482,
        total: 1500,
        facets: {
          ...response().facets,
          denominator: 1500,
          corpus_complete: false,
          corpus_incomplete_reasons: [],
        },
      })
    );
    expect(screen.getByTestId("reconciliation-blind-spots")).toHaveTextContent(
      "18 of 1500"
    );
  });

  it("says how many rows had the delivery verdict computed", () => {
    mount(
      response({
        total: 900,
        axis_c_computed_count: 25,
        facets: { ...response().facets, denominator: 900 },
      })
    );
    expect(screen.getByTestId("reconciliation-denominator")).toHaveTextContent(
      "computed for 25 of them"
    );
  });

  it("renders the three verdict groups including the zeros", () => {
    mount(response());
    expect(
      screen.getByTestId("reconciliation-verdict-agree")
    ).toHaveTextContent("1");
    expect(
      screen.getByTestId("reconciliation-verdict-disagree")
    ).toHaveTextContent("0");
    expect(
      screen.getByTestId("reconciliation-verdict-unknown")
    ).toHaveTextContent("0");
  });

  it("a verdict the response did not serve renders \u2013, never 0", () => {
    mount(
      response({
        facets: {
          ...response().facets,
          // `disagree` withheld entirely — absence, not zero.
          by_verdict: { agree: 1, unknown: 0 },
        },
      })
    );
    expect(
      screen.getByTestId("reconciliation-verdict-disagree")
    ).not.toHaveTextContent("0");
  });

  it("a verdict the backend ADDED is surfaced, not dropped from the strip", () => {
    mount(
      response({
        facets: {
          ...response().facets,
          by_verdict: { agree: 1, disagree: 0, unknown: 0, contested: 7 },
        },
      })
    );
    expect(
      screen.getByTestId("reconciliation-verdict-contested")
    ).toHaveTextContent("7");
  });

  it("warns that a document-only read is never agreement", () => {
    mount(response(), { includeCoord: false });
    expect(
      screen.getByTestId("reconciliation-document-only")
    ).toHaveTextContent("never agreement");
  });

  it("never prints an inverted range on a past-the-end page", () => {
    // The route echoes `offset` and `limit` verbatim with no clamping, so
    // `offset + limit` rendered "901-900 of 900".
    mount(
      response({
        items: [],
        total: 900,
        offset: 900,
        facets: { ...response().facets, denominator: 900 },
      })
    );
    return userEvent
      .click(screen.getByTestId("reconciliation-toggle-rows"))
      .then(() => {
        expect(screen.getByTestId("reconciliation-page")).not.toHaveTextContent(
          "901"
        );
        expect(screen.getByTestId("reconciliation-page")).toHaveTextContent(
          "of 900"
        );
      });
  });

  it("a partial last page counts the rows it actually has", async () => {
    mount(
      response({
        items: [row({ slug: "a" }), row({ slug: "b" })],
        total: 27,
        offset: 25,
        facets: { ...response().facets, denominator: 27 },
      })
    );
    await userEvent.click(screen.getByTestId("reconciliation-toggle-rows"));
    expect(screen.getByTestId("reconciliation-page")).toHaveTextContent(
      "26\u201327 of 27"
    );
  });

  it("an empty page is a position, not an empty corpus", () => {
    mount(
      response({
        items: [],
        total: 900,
        offset: 900,
        facets: { ...response().facets, denominator: 900 },
      })
    );
    return userEvent
      .click(screen.getByTestId("reconciliation-toggle-rows"))
      .then(() => {
        expect(
          screen.getByTestId("reconciliation-rows-empty")
        ).toHaveTextContent("not a statement that the corpus is empty");
      });
  });

  it("renders a row's three axes and its deciding reason", async () => {
    mount(response());
    await userEvent.click(screen.getByTestId("reconciliation-toggle-rows"));
    const slug = "2026-09-15-a-plan";
    expect(
      screen.getByTestId(`reconciliation-row-${slug}-reason`)
    ).toHaveTextContent("they agree the work is open");
    expect(
      screen.getByTestId(`reconciliation-row-${slug}-axis-a`)
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`reconciliation-row-${slug}-axis-b`)
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`reconciliation-row-${slug}-axis-c`)
    ).toBeInTheDocument();
  });

  it("a failed read with nothing behind it is unknown, not agreement", () => {
    useReconciliationMock.mockReturnValue({
      data: null,
      fetchedAt: null,
      loading: false,
      error: "boom",
      reload: vi.fn(),
      offset: 0,
      setOffset: vi.fn(),
      includeCoord: true,
      setIncludeCoord: vi.fn(),
      pageSize: 25,
    });
    render(<ReconciliationPanel />);
    expect(screen.getByTestId("reconciliation-error")).toHaveTextContent(
      "unknown, not agreement"
    );
  });
});
