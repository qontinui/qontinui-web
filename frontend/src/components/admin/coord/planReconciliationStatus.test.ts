/**
 * The three readings a reconciliation renderer gets backwards by default.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store`, Phases 1
 * and 2. Each `describe` below pins one clause the route's own schema states
 * and which is invisible in the rendered output when it is wrong — which is
 * exactly why they are asserted here, over the pure module, rather than only
 * through the page.
 */

import { describe, expect, it } from "vitest";
import {
  deriveDisclosure,
  deriveReconciliationHealth,
  describeAxisA,
  describeAxisB,
  describeAxisC,
  describeVerdict,
  describeWindow,
  documentAxisAdmissible,
  isDivergent,
  parseContractViolation,
  type ReconciliationAxisB,
  type ReconciliationAxisC,
  type ReconciliationResponse,
  type ReconciliationRowData,
} from "./planReconciliationStatus";

function axisC(over: Partial<ReconciliationAxisC> = {}): ReconciliationAxisC {
  return { readable: true, present: true, computed: true, ...over };
}

function axisB(over: Partial<ReconciliationAxisB> = {}): ReconciliationAxisB {
  return {
    readable: true,
    present: true,
    document_state: "present",
    complete: true,
    ...over,
  };
}

function row(over: Partial<ReconciliationRowData> = {}): ReconciliationRowData {
  return {
    slug: "2026-09-05-a-plan",
    document_state: "present",
    document_axis_complete: true,
    axis_a: { readable: true, present: true, status: "shipped" },
    axis_b: axisB(),
    axis_c: axisC(),
    classification: "AGREE_TERMINAL",
    verdict: "agree",
    reason: "coord says shipped and the document agrees",
    ...over,
  };
}

describe("axis C — `computed: false` is 'not asked', never 'not delivered'", () => {
  it("reads an off-page row as not asked, and says so as UNKNOWN", () => {
    const reading = describeAxisC(axisC({ computed: false, shipped: false }));
    expect(reading.kind).toBe("not-asked");
    expect(reading.unknown).toBe(true);
    expect(reading.label).toBe("delivery not asked");
    expect(reading.label).not.toMatch(/not delivered/);
  });

  it("treats an ABSENT `computed` the same way — absence is not 'asked'", () => {
    // A backend predating the field, or a row the route did not annotate.
    const reading = describeAxisC({ readable: true, present: true });
    expect(reading.kind).toBe("not-asked");
    expect(reading.unknown).toBe(true);
  });

  it("does not let a not-asked row reach the delivered arm either", () => {
    const reading = describeAxisC(axisC({ computed: false, shipped: true }));
    expect(reading.kind).toBe("not-asked");
  });
});

describe("axis C — `evidence_complete` is read BEFORE `shipped`", () => {
  it("reads shipped:false under incomplete evidence as UNKNOWN", () => {
    const reading = describeAxisC(
      axisC({ shipped: false, evidence_complete: false })
    );
    expect(reading.kind).toBe("evidence-incomplete");
    expect(reading.unknown).toBe(true);
    expect(reading.label).not.toBe("not delivered");
  });

  it("reads an ABSENT evidence_complete as UNKNOWN, not as undelivered", () => {
    const reading = describeAxisC(axisC({ shipped: false }));
    expect(reading.kind).toBe("evidence-incomplete");
    expect(reading.unknown).toBe(true);
  });

  it("only says 'not delivered' when the evidence read was complete", () => {
    const reading = describeAxisC(
      axisC({ shipped: false, evidence_complete: true })
    );
    expect(reading.kind).toBe("not-delivered");
    expect(reading.unknown).toBe(false);
  });

  it("says delivered only under complete evidence", () => {
    expect(
      describeAxisC(axisC({ shipped: true, evidence_complete: true })).kind
    ).toBe("delivered");
    // shipped:true under INCOMPLETE evidence is still unknown — the cascade
    // runs the evidence arm first in both directions.
    expect(
      describeAxisC(axisC({ shipped: true, evidence_complete: false })).kind
    ).toBe("evidence-incomplete");
  });

  it("carries evidence_gaps VERBATIM, never as a count or a boolean", () => {
    const gaps = [
      "no citations captured for this unit",
      "a cited PR is not merged",
    ];
    const reading = describeAxisC(
      axisC({ shipped: false, evidence_complete: false, evidence_gaps: gaps })
    );
    expect(reading.gaps).toEqual(gaps);
  });

  it("keeps the gaps on an off-page row too — they are coord's words", () => {
    const reading = describeAxisC(
      axisC({ computed: false, evidence_gaps: ["stale citation"] })
    );
    expect(reading.gaps).toEqual(["stale citation"]);
  });
});

describe("axis A and axis B report ignorance as ignorance", () => {
  it("reads an unreadable axis A as unknown, with coord's reason", () => {
    const reading = describeAxisA({
      readable: false,
      present: false,
      unreadable_reason: "coord returned 504",
    });
    expect(reading.unknown).toBe(true);
    expect(reading.detail).toContain("coord returned 504");
  });

  it("distinguishes 'no work unit' (a fact) from 'unreadable' (ignorance)", () => {
    const absent = describeAxisA({ readable: true, present: false });
    expect(absent.kind).toBe("absent");
    expect(absent.unknown).toBe(false);
  });

  it("renders coord's opaque status verbatim", () => {
    expect(
      describeAxisA({
        readable: true,
        present: true,
        status: "tier3_dispatched",
      }).label
    ).toBe("tier3_dispatched");
  });

  it("reads a missing document as UNKNOWN, not as a disagreement", () => {
    const reading = describeAxisB(
      axisB({ present: false, document_state: "absent", complete: false })
    );
    expect(reading.kind).toBe("absent");
    expect(reading.unknown).toBe(true);
  });

  it("reads an unsynced document as UNKNOWN", () => {
    expect(
      describeAxisB(axisB({ document_state: "unsynced", complete: false }))
        .unknown
    ).toBe(true);
  });
});

describe("divergent document copies are surfaced, not collapsed silently", () => {
  it("flags variant_count > 1", () => {
    expect(isDivergent(row({ axis_b: axisB({ variant_count: 3 }) }))).toBe(
      true
    );
  });

  it("treats a missing variant_count as one copy", () => {
    expect(isDivergent(row())).toBe(false);
  });
});

describe("the verdict badge carries the route's verdict, never a re-derivation", () => {
  it("maps the three verdicts onto the audited attentions", () => {
    expect(
      describeVerdict({ verdict: "disagree", classification: "X" }).attention
    ).toBe("author");
    expect(
      describeVerdict({ verdict: "unknown", classification: "X" }).attention
    ).toBe("waiting");
    expect(
      describeVerdict({ verdict: "agree", classification: "X" }).attention
    ).toBe("none");
  });

  it("floors an unrecognised verdict at unknown, never at agree", () => {
    const status = describeVerdict({
      verdict: "something_new" as never,
      classification: "X",
    });
    expect(status.kind).toBe("unknown");
    expect(status.attention).toBe("waiting");
  });
});

describe("the window is a measurement", () => {
  const res: ReconciliationResponse = {
    items: [row({ slug: "2026-01-01-a" }), row({ slug: "2026-02-02-b" })],
    total: 1991,
    offset: 50,
    limit: 25,
    ordering: "slug_asc",
  };

  it("states total, offset, limit, ordering and both boundary stems", () => {
    const w = describeWindow(res);
    expect(w).toMatchObject({
      total: 1991,
      offset: 50,
      limit: 25,
      shown: 2,
      ordering: "slug_asc",
      firstStem: "2026-01-01-a",
      lastStem: "2026-02-02-b",
    });
  });

  it("marks the total INADMISSIBLE on the degraded population arm", () => {
    // The same `1887` the health strip dashes. It is a real number over a
    // denominator that silently moved — the artifact store rather than the
    // corpus — and it is the MORE optimistic of the two arms.
    const w = describeWindow({
      items: [],
      total: 1887,
      work_unit_population_state: "unavailable",
    });
    expect(w.total).toBe(1887);
    expect(w.totalAdmissible).toBe(false);
  });

  it("marks it admissible only when the population arm actually ran", () => {
    expect(
      describeWindow({ total: 1991, work_unit_population_state: "included" })
        .totalAdmissible
    ).toBe(true);
    // ABSENT reads the same way as `unavailable` — absence is UNKNOWN.
    expect(describeWindow({ total: 1991 }).totalAdmissible).toBe(false);
  });

  it("reports an absent total as UNKNOWN rather than as items.length", () => {
    const w = describeWindow({ ...res, total: undefined });
    expect(w.total).toBeNull();
  });

  it("infers 'more' from a full page when the total is unknown", () => {
    expect(
      describeWindow({ items: [row(), row()], limit: 2, offset: 0 }).hasMore
    ).toBe(true);
    expect(
      describeWindow({ items: [row()], limit: 2, offset: 0 }).hasMore
    ).toBe(false);
  });
});

describe("the route's 500 refusal is recognised as its own state", () => {
  const body = JSON.stringify({
    detail: {
      error: "reconciliation_contract_violated",
      violations: ["by_class does not sum to the denominator"],
    },
  });

  it("recovers the violations from httpClient's message", () => {
    expect(
      parseContractViolation(
        new Error(
          `GET /api/v1/plan-library/reconciliation failed: 500 - ${body}`
        )
      )
    ).toEqual(["by_class does not sum to the denominator"]);
  });

  it("recovers them when a proxy re-encoded detail as a string", () => {
    const nested = JSON.stringify({
      detail: JSON.stringify({
        error: "reconciliation_contract_violated",
        violations: ["x"],
      }),
    });
    expect(
      parseContractViolation(new Error(`GET /x failed: 500 - ${nested}`))
    ).toEqual(["x"]);
  });

  it("returns an empty list — not null — for a refusal naming no violation", () => {
    const bare = JSON.stringify({
      detail: { error: "reconciliation_contract_violated" },
    });
    expect(
      parseContractViolation(new Error(`GET /x failed: 500 - ${bare}`))
    ).toEqual([]);
  });

  it("is null for every other failure, so an ordinary 500 is not mislabelled", () => {
    expect(
      parseContractViolation(new Error("GET /x failed: 500 - boom"))
    ).toBeNull();
    expect(
      parseContractViolation(new Error("GET /x failed: 503 - x"))
    ).toBeNull();
    expect(
      parseContractViolation(new Error("Network request failed"))
    ).toBeNull();
    expect(
      parseContractViolation(
        new Error(
          `GET /x failed: 500 - ${JSON.stringify({ detail: { error: "other" } })}`
        )
      )
    ).toBeNull();
  });
});

describe("the population state gates every flag derived from the population", () => {
  /** The degraded arm, as measured 2026-09-20 — 5 of 8 live probes. */
  const degraded: ReconciliationResponse = {
    items: [],
    total: 1887,
    offset: 0,
    limit: 25,
    ordering: "slug_asc",
    document_axis_source: "artifact_store",
    document_axis_complete: true,
    document_present_count: 1887,
    document_missing_count: 0,
    coord_available: false,
    work_unit_population_state: "unavailable",
    work_unit_population_reason: "coord returned 504: non-JSON body (25 bytes)",
    axis_c_scope: "page",
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
  };

  /** The good arm — 3 of 8. Note it is the LESS optimistic one. */
  const healthy: ReconciliationResponse = {
    ...degraded,
    total: 1991,
    document_axis_complete: false,
    document_present_count: 1887,
    document_missing_count: 104,
    coord_available: true,
    work_unit_population_state: "included",
    work_unit_population_reason: null,
    axis_c_computed_count: 25,
    facets: {
      denominator: 1991,
      by_class: { UNKNOWN_AXIS_UNREADABLE: 1969, AGREE_TERMINAL: 18 },
      by_verdict: { agree: 19, disagree: 0, unknown: 1972 },
      corpus_complete: false,
      corpus_incomplete_reasons: [
        "axis C was derived for 25 of 1991 rows — the page",
      ],
    },
  };

  it("refuses the document-completeness claim on the degraded arm", () => {
    expect(documentAxisAdmissible(degraded)).toBe(false);
    const d = deriveDisclosure(degraded);
    expect(d.populationRead).toBe(false);
    expect(d.documentAxisAdmissible).toBe(false);
    expect(d.facetsAdmissible).toBe(false);
    const text = d.lines.map((l) => l.text).join(" ");
    expect(text).not.toMatch(/Every row in the denominator has a document/);
    expect(text).toMatch(/SUPPRESSED/);
  });

  it("puts the population line FIRST, before anything derived from it", () => {
    const d = deriveDisclosure(degraded);
    expect(d.lines[0]?.key).toBe("population");
    expect(d.lines[0]?.level).toBe("critical");
    const documentLine = d.lines.findIndex((l) =>
      l.key.startsWith("document-axis")
    );
    expect(documentLine).toBeGreaterThan(0);
  });

  it("quotes work_unit_population_reason VERBATIM", () => {
    expect(deriveDisclosure(degraded).lines[0]?.items).toEqual([
      "coord returned 504: non-JSON body (25 bytes)",
    ]);
  });

  it("says axis A is unknown for EVERY row, not that coord has no work units", () => {
    const text = deriveDisclosure(degraded).lines[0]?.text ?? "";
    expect(text).toMatch(/UNKNOWN for EVERY row/);
    // And it says so by NAMING the misreading it is ruling out, rather than
    // leaving the reader to supply it: `unavailable` is the one state an
    // operator reads as "coord holds no work units".
    expect(text).toMatch(/never 'coord has no work units'/);
  });

  it("reads an ABSENT population state the same way — absence is UNKNOWN", () => {
    const silent = { ...degraded, work_unit_population_state: undefined };
    expect(documentAxisAdmissible(silent)).toBe(false);
    expect(deriveDisclosure(silent).lines[0]?.level).toBe("critical");
  });

  it("publishes the document claim on the good arm, and names the store", () => {
    const d = deriveDisclosure(healthy);
    expect(d.documentAxisAdmissible).toBe(true);
    const line = d.lines.find((l) => l.key === "document-axis");
    expect(line?.text).toMatch(/1887 of 1991/);
    expect(line?.text).toMatch(/INCOMPLETE/);
    expect(line?.text).toMatch(/artifact store/);
    expect(line?.text).toMatch(/not against origin\/main/);
  });

  it("states coord_available: false as its own line", () => {
    expect(
      deriveDisclosure(degraded).lines.some((l) => l.key === "coord-available")
    ).toBe(true);
    expect(
      deriveDisclosure(healthy).lines.some((l) => l.key === "coord-available")
    ).toBe(false);
  });

  it("gives axis C its OWN denominator, separate from the document one", () => {
    const line = deriveDisclosure(healthy).lines.find(
      (l) => l.key === "axis-c-scope"
    );
    expect(line?.text).toMatch(/Delivery was asked for 25 of 1991 rows/);
    expect(line?.text).toMatch(/not 'not delivered'/);
  });

  it("renders facets.corpus_incomplete_reasons verbatim as a list", () => {
    const line = deriveDisclosure(healthy).lines.find(
      (l) => l.key === "corpus-incomplete"
    );
    expect(line?.items).toEqual([
      "axis C was derived for 25 of 1991 rows — the page",
    ]);
  });
});

describe("the health strip never publishes an inadmissible histogram", () => {
  const degraded: ReconciliationResponse = {
    items: [],
    total: 1887,
    work_unit_population_state: "unavailable",
    work_unit_population_reason: "coord returned 504",
    facets: { by_verdict: { agree: 0, disagree: 0, unknown: 1887 } },
  };

  it("dashes the counts on the degraded arm rather than showing 1887", () => {
    const h = deriveReconciliationHealth(degraded, true, false);
    const labels = h.badges.map((b) => b.label).join(" ");
    expect(labels).toContain("plans –");
    expect(labels).toContain("unknown –");
    expect(labels).not.toContain("1887");
    expect(h.headline).toMatch(/population was not read/);
  });

  it("does not paint green on the degraded arm", () => {
    expect(deriveReconciliationHealth(degraded, true, false).level).not.toBe(
      "green"
    );
  });

  it("dashes before coord has answered — `–`, never `0`", () => {
    const labels = deriveReconciliationHealth(null, false, false)
      .badges.map((b) => b.label)
      .join(" ");
    expect(labels).toContain("disagree –");
    expect(labels).not.toContain("disagree 0");
  });

  it("dashes, and says so, on the route's refusal", () => {
    const h = deriveReconciliationHealth(null, false, true, ["a violation"]);
    expect(h.level).toBe("red");
    expect(h.headline).toMatch(/refused/);
    expect(h.badges.map((b) => b.label).join(" ")).toContain("plans –");
  });

  it("does NOT claim 'no plan record disagrees' when no histogram was served", () => {
    // The badge was already honest (`disagree –`); the HEADLINE is the
    // largest text on the page, and it asserted a negative this read never
    // measured. An absent `by_verdict` is UNKNOWN, not zero.
    const h = deriveReconciliationHealth(
      { total: 1991, work_unit_population_state: "included" },
      true,
      false
    );
    expect(h.headline).not.toMatch(/No plan record disagrees/i);
    expect(h.headline).toMatch(/unknown/i);
    expect(h.level).not.toBe("green");
    expect(h.badges.map((b) => b.label).join(" ")).toContain("disagree –");
  });

  it("reads an EMPTY by_verdict the same way — the key is absent, not zero", () => {
    const h = deriveReconciliationHealth(
      { total: 1991, work_unit_population_state: "included", facets: {} },
      true,
      false
    );
    expect(h.headline).not.toMatch(/No plan record disagrees/i);
    expect(h.level).toBe("amber");
  });

  it("still says the negative when the route MEASURED zero disagreements", () => {
    const h = deriveReconciliationHealth(
      {
        total: 1991,
        work_unit_population_state: "included",
        facets: { by_verdict: { agree: 1991, disagree: 0, unknown: 0 } },
      },
      true,
      false
    );
    expect(h.headline).toBe("No plan record disagrees with reality");
    expect(h.level).toBe("green");
  });

  it("publishes the counts on the good arm", () => {
    const h = deriveReconciliationHealth(
      {
        total: 1991,
        work_unit_population_state: "included",
        facets: { by_verdict: { agree: 19, disagree: 2, unknown: 1970 } },
      },
      true,
      false
    );
    const labels = h.badges.map((b) => b.label).join(" ");
    expect(labels).toContain("plans 1991");
    expect(labels).toContain("disagree 2");
    expect(h.level).toBe("red");
  });
});
