/**
 * The domain cost words (plan
 * `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8): each readout-table verdict maps to its "what the fleet does"
 * sentence, and every `null` is "unknown — <reason>".
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console";
import {
  DOMAIN_COST_VERDICT_ATTENTION_BY_KIND,
  DOMAIN_COST_VERDICT_PALETTE,
} from "@/components/operations/domainCostStatus";
import {
  VERDICT_SENTENCE,
  dimensionValueText,
  isDomainCostPayload,
  ratioText,
  resolveVerdict,
  unknownText,
  type DomainCostComparison,
} from "./domainCost";
import compounded from "../../../../../test-fixtures/domain-cost/compounded.json";

const comparison = (verdict: string): DomainCostComparison => ({
  numerator: "operations",
  denominator: "ux",
  source: "file_order",
  coverage_floor: 0.6,
  dimensions: {},
  agreement: null,
  agreement_reason: "no_attribution_agreement_record",
  verdict,
  verdict_reason: "because",
});

describe("verdict palette", () => {
  it("agrees with its audit table", () => {
    expect(
      paletteDisagreements(
        DOMAIN_COST_VERDICT_ATTENTION_BY_KIND,
        DOMAIN_COST_VERDICT_PALETTE
      )
    ).toEqual([]);
  });
});

describe("resolveVerdict", () => {
  it.each([
    ["COMPOUNDED", "compounded", "none"],
    ["INCONCLUSIVE", "inconclusive", "none"],
    ["DID_NOT_COMPOUND", "did_not_compound", "author"],
    ["UNFALSIFIABLE_AS_MEASURED", "unfalsifiable", "waiting"],
  ] as const)("%s → %s (%s)", (wire, kind, attention) => {
    const v = resolveVerdict(comparison(wire));
    expect(v.kind).toBe(kind);
    expect(v.attention).toBe(attention);
    expect(v.sentence).toBe(VERDICT_SENTENCE[kind]);
    expect(v.why).toBe("because");
  });

  it("an unknown wire verdict is unknown, amber, and named", () => {
    const v = resolveVerdict(comparison("MAYBE"));
    expect(v.kind).toBe("unknown");
    expect(v.attention).toBe("waiting");
    expect(v.sentence).toContain('"MAYBE"');
  });
});

describe("null renders unknown — <reason>", () => {
  it("dimensions", () => {
    expect(
      dimensionValueText("tokens", {
        value: null,
        coverage_n: 0,
        population_n: 5,
        basis: "",
        reason: "no_producer",
      })
    ).toBe("unknown — no_producer");
    expect(dimensionValueText("prs", undefined)).toBe("unknown — not served");
    expect(
      dimensionValueText("wall_clock_secs", {
        value: 7200,
        coverage_n: 1,
        population_n: 1,
        basis: "",
      })
    ).toBe("2h");
  });

  it("ratios and blanks", () => {
    expect(
      ratioText({
        R: null,
        reason: "coverage",
        numerator_value: 1,
        denominator_value: 2,
        numerator_coverage: 0.2,
        denominator_coverage: 0.9,
      })
    ).toBe("unknown — coverage");
    expect(unknownText(null)).toBe("unknown — no reason given");
  });
});

describe("isDomainCostPayload", () => {
  it("accepts a ledger, and a roster-null ledger, and refuses other shapes", () => {
    expect(isDomainCostPayload(compounded)).toBe(true);
    expect(
      isDomainCostPayload({ ...compounded, domains: null, roster: null })
    ).toBe(true);
    expect(isDomainCostPayload({})).toBe(false);
    expect(isDomainCostPayload({ ...compounded, domains: {} })).toBe(false);
  });
});
