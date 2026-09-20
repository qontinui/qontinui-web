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
  it("keeps every class INCLUDING the zeros, in cascade order", () => {
    // D3's whole point: "no rows of class X" is a stated fact. Iterating the
    // served object's keys would drop exactly the classes an operator most
    // wants to see read zero.
    const rows = classRows({ AGREE_OPEN: 3 });
    expect(rows).toHaveLength(RECONCILIATION_CLASS_ORDER.length);
    expect(rows.map((r) => r.name)).toEqual([...RECONCILIATION_CLASS_ORDER]);
    expect(rows.find((r) => r.name === "UNKNOWN_NO_UNIT")?.count).toBe(0);
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

  it("an un-computed row says so rather than reporting nothing found", () => {
    // Axis C is per-page; an off-page row is UNKNOWN, not undelivered.
    expect(axisCSentence(axisC({ computed: false }))).toContain(
      "outside the page"
    );
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

  it("raises the blind-spot banner when the corpus read is incomplete", () => {
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

  it("has NO banner when the read really was whole", () => {
    // The mutation partner of the test above: without this, a banner that
    // always rendered would pass it and say nothing.
    mount(response());
    expect(
      screen.queryByTestId("reconciliation-blind-spots")
    ).not.toBeInTheDocument();
  });

  it("an unavailable work-unit population is unknown for EVERY row", () => {
    mount(
      response({
        work_unit_population_state: "unavailable",
        work_unit_population_reason: "coord 503",
      })
    );
    const banner = screen.getByTestId("reconciliation-blind-spots");
    expect(banner).toHaveTextContent("unknown for EVERY row");
    expect(banner).toHaveTextContent("coord 503");
  });

  it("a degraded coord read is stated above the counts", () => {
    mount(response({ coord_available: false }));
    expect(screen.getByTestId("reconciliation-blind-spots")).toHaveTextContent(
      "coord read degraded"
    );
  });

  it("an incomplete document layer names both halves of the split", () => {
    mount(
      response({
        document_axis_complete: false,
        document_present_count: 18,
        document_missing_count: 1482,
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

  it("warns that a document-only read is never agreement", () => {
    mount(response(), { includeCoord: false });
    expect(
      screen.getByTestId("reconciliation-document-only")
    ).toHaveTextContent("never agreement");
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
