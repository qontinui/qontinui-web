import { describe, expect, it } from "vitest";
import {
  AGREEMENT_INSUFFICIENT_TEXT,
  NO_VERIFICATIONS_TEXT,
  OPERATOR_LABELS_PER_WEEK,
  couldNotLookReason,
  interval,
  isoWeekKey,
  ratePct,
  deriveTrustView,
  deriveVerificationHealth,
  deriveVerifierAgreement,
  laneView,
  operatorLabelOutcome,
  parseVerificationMetrics,
  refutedUnitFromFinding,
  refutedUnitsInWindow,
  sampleForOperatorLabel,
  unknownsLine,
  verificationIdOf,
  type VerificationMetrics,
} from "./verificationMetrics";
import {
  NOW,
  REFUTATION_FINDING,
  REFUTATION_VERIFICATION_ID,
  degraded,
  freshLane,
  judgeAgreement,
  noVerifications,
  populated,
} from "./verificationMetrics.fixture";

describe("parseVerificationMetrics", () => {
  it("accepts coord's populated and degraded bodies", () => {
    expect(parseVerificationMetrics(populated()).degraded).toBe(false);
    expect(parseVerificationMetrics(degraded()).degraded).toBe(true);
  });

  it("refuses a body it cannot read rather than half-reading it into zeros", () => {
    expect(() => parseVerificationMetrics({})).toThrow(/does not recognise/);
    expect(() => parseVerificationMetrics(null)).toThrow();
    const { series: _series, ...noSeries } = populated();
    expect(() => parseVerificationMetrics(noSeries)).toThrow(/missing a block/);
  });
});

describe("deriveTrustView", () => {
  it("populated: throughput and calibration side by side, with the interval and n", () => {
    const v = deriveTrustView(
      { status: "ok", metrics: populated() },
      null,
      NOW
    );
    expect(v.state).toBe("populated");
    if (v.state !== "populated") return;
    expect(v.throughputLine).toBe("52 landed · 91% held up (84–95), n=20");
    expect(v.calibrationLine).toContain("91% (84–95)");
    expect(v.coverageLine).toBe("38% of 52 landed units independently checked");
    expect(v.unknownsLine).toBe(
      "12 unverifiable · 3 author unknown · 9 waiting"
    );
    expect(v.refuted).toBe(2);
  });

  it("n=0 is words — never 0% and never 100%", () => {
    const v = deriveTrustView(
      { status: "ok", metrics: noVerifications() },
      null,
      NOW
    );
    expect(v.state).toBe("no_verifications");
    if (v.state !== "no_verifications") return;
    expect(v.throughputLine).toBe(`52 landed · ${NO_VERIFICATIONS_TEXT}`);
    expect(v.throughputLine).not.toMatch(/\d+%/);
  });

  it("degraded is could-not-look with coord's reason and the last good stamp", () => {
    const v = deriveTrustView(
      { status: "ok", metrics: degraded() },
      "2026-09-29T08:00:00Z",
      NOW
    );
    expect(v).toMatchObject({
      state: "could_not_look",
      reason: expect.stringContaining("work_unit_verifications is absent"),
      lastGood: "2026-09-29T08:00:00Z",
    });
  });

  it("an unreachable door is the same could-not-look shape", () => {
    const v = deriveTrustView(
      { status: "error", reason: "HTTP 502: coord is not reachable" },
      null,
      NOW
    );
    expect(v).toMatchObject({ state: "could_not_look", lastGood: null });
    if (v.state === "could_not_look") expect(v.lane.attention).toBe(true);
  });
});

describe("unknownsLine", () => {
  it("renders an unknown pending count as unknown, never 0", () => {
    const u = { ...populated().unknowns, selected_not_yet_verified: null };
    expect(unknownsLine(u)).toBe(
      "12 unverifiable · 3 author unknown · waiting: unknown"
    );
  });
});

describe("laneView", () => {
  it("is calm only for a fresh, ok, passing, installed lane", () => {
    expect(laneView(freshLane(), NOW)).toEqual({
      line: "Checker: last verdict 3h ago · last cycle ok · canary passed",
      attention: false,
    });
  });

  it("flags a verdict older than 48h, a failed cycle, a failed canary, or unknown install", () => {
    const old = new Date(NOW - 72 * 3600_000).toISOString();
    expect(laneView(freshLane({ last_verdict_at: old }), NOW).attention).toBe(
      true
    );
    expect(
      laneView(freshLane({ last_cycle_outcome: "could_not_look" }), NOW)
        .attention
    ).toBe(true);
    expect(laneView(freshLane({ canary: "fail" }), NOW).attention).toBe(true);
    const unk = laneView(freshLane({ installed: "unknown" }), NOW);
    expect(unk.attention).toBe(true);
    expect(unk.line).toContain("installed: unknown");
  });
});

describe("couldNotLookReason", () => {
  it("unwraps FastAPI's detail and coord's error/message", () => {
    const err = new Error(
      'GET /api/v1/operations/coord/verification/metrics failed: 502 - {"detail":"coord refused the operator\'s credential on /coord/verification/metrics (HTTP 401): x"}'
    );
    expect(couldNotLookReason(err)).toBe(
      "HTTP 502: coord refused the operator's credential on /coord/verification/metrics (HTTP 401): x"
    );
    const inner = new Error(
      'GET /x failed: 503 - {"detail":"{\\"error\\":\\"store_unavailable\\",\\"message\\":\\"pool\\"}"}'
    );
    expect(couldNotLookReason(inner)).toBe("HTTP 503: store_unavailable: pool");
  });

  it("names a 404 as the door not answering", () => {
    expect(
      couldNotLookReason(
        new Error('GET /x failed: 404 - {"detail":"Not Found"}')
      )
    ).toMatch(/not answering \(HTTP 404\)/);
  });

  it("keeps a message it cannot parse", () => {
    expect(couldNotLookReason(new Error("No internet connection."))).toBe(
      "No internet connection."
    );
  });
});

describe("refuted units", () => {
  it("names the unit by its plan title and keeps the slug", () => {
    expect(refutedUnitFromFinding(REFUTATION_FINDING)).toEqual({
      findingId: REFUTATION_FINDING.finding_id,
      label: "Widgets export to CSV",
      slug: "2026-09-01-widget-export",
      createdAt: REFUTATION_FINDING.created_at,
      verificationId: REFUTATION_VERIFICATION_ID,
    });
  });

  it("reads the refuting verdict's id from artifact_refs, else from the body", () => {
    expect(verificationIdOf(REFUTATION_FINDING)).toBe(
      REFUTATION_VERIFICATION_ID
    );
    expect(verificationIdOf({ ...REFUTATION_FINDING, artifact_refs: {} })).toBe(
      REFUTATION_VERIFICATION_ID
    );
    expect(
      verificationIdOf({
        ...REFUTATION_FINDING,
        artifact_refs: { verification_id: "not-a-uuid" },
        body: "no id here",
      })
    ).toBeNull();
  });

  it("falls back to the slug from the title when the body carries no plan title", () => {
    expect(
      refutedUnitFromFinding({ ...REFUTATION_FINDING, body: "" }).label
    ).toBe("2026-09-01-widget-export");
  });

  it("keeps only findings inside the window", () => {
    const old = {
      ...REFUTATION_FINDING,
      finding_id: "old",
      created_at: "2026-01-01T00:00:00Z",
    };
    const units = refutedUnitsInWindow(
      [REFUTATION_FINDING, old],
      "2026-09-02T12:00:00Z"
    );
    expect(units.map((u) => u.findingId)).toEqual([
      REFUTATION_FINDING.finding_id,
    ]);
  });
});

describe("deriveVerificationHealth", () => {
  it("is green only when populated with a calm lane; never red", () => {
    const pop = deriveTrustView(
      { status: "ok", metrics: populated() },
      null,
      NOW
    );
    expect(deriveVerificationHealth(pop).level).toBe("green");
    const none = deriveTrustView(
      { status: "ok", metrics: noVerifications() },
      null,
      NOW
    );
    expect(deriveVerificationHealth(none).level).toBe("amber");
    const dg = deriveTrustView(
      { status: "ok", metrics: degraded() },
      null,
      NOW
    );
    const h = deriveVerificationHealth(dg);
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Could not look");
  });
});

describe("review round 1", () => {
  it("never shows 100% with a refutation, nor 0% with a survivor", () => {
    expect(ratePct(0.996, { survived: 249, refuted: 1 })).toBe("≥99%");
    expect(ratePct(1, { survived: 20, refuted: 0 })).toBe("100%");
    expect(ratePct(0.004, { survived: 1, refuted: 249 })).toBe("≤1%");
    expect(ratePct(0, { survived: 0, refuted: 5 })).toBe("0%");
    expect(
      interval({ ci95_low: 0.97, ci95_high: 0.998, survived: 249, refuted: 1 })
    ).toBe("(97–99)");
    expect(
      interval({ ci95_low: 0.001, ci95_high: 0.02, survived: 1, refuted: 249 })
    ).toBe("(1–2)");
    const m = populated({
      trust_calibration: {
        ...populated().trust_calibration,
        value: 0.996,
        ci95_high: 0.999,
        survived: 249,
        refuted: 1,
        n: 250,
      },
    });
    const v = deriveTrustView({ status: "ok", metrics: m }, null, NOW);
    if (v.state !== "populated") throw new Error(v.state);
    expect(v.throughputLine).not.toContain("100");
    expect(v.throughputLine).toContain("≥99% held up");
  });

  it("a body without a readable window is could-not-look, not a render throw", () => {
    const { window: _w, ...noWindow } = populated();
    expect(() => parseVerificationMetrics(noWindow)).toThrow(/window/);
    expect(() =>
      parseVerificationMetrics({ ...populated(), window: { days: 28 } })
    ).toThrow(/window/);
  });

  it("keeps only findings whose topic is exactly verification-refuted", () => {
    const untopiced = { ...REFUTATION_FINDING, finding_id: "n", topic: null };
    const other = { ...REFUTATION_FINDING, finding_id: "o", topic: "other" };
    const units = refutedUnitsInWindow(
      [REFUTATION_FINDING, untopiced, other],
      "2026-09-02T12:00:00Z"
    );
    expect(units.map((u) => u.findingId)).toEqual([
      REFUTATION_FINDING.finding_id,
    ]);
  });
});

describe("deriveVerifierAgreement", () => {
  const ok = (metrics: VerificationMetrics) =>
    deriveVerifierAgreement({ status: "ok", metrics });

  it("populated: the seeded kappa with its binary n, and the operator n", () => {
    expect(ok(populated({ judge_agreement: judgeAgreement() }))).toEqual({
      state: "populated",
      text: "verifier agreement κ 0.71 (seeded n=24) · operator n=6",
    });
  });

  it("n<20: words, never a number", () => {
    const v = ok(
      populated({
        judge_agreement: judgeAgreement({
          n: 4,
          binary_n: 3,
          kappa: null,
          reason: "n<20",
        }),
      })
    );
    expect(v.state).toBe("insufficient");
    expect(v.text).toContain(AGREEMENT_INSUFFICIENT_TEXT);
    expect(v.text).not.toContain("κ");
  });

  it("undefined: says so, with the binary n", () => {
    const v = ok(
      populated({
        judge_agreement: judgeAgreement({
          binary_n: 24,
          kappa: null,
          reason: "undefined",
        }),
      })
    );
    expect(v).toEqual({
      state: "undefined",
      text: "verifier agreement undefined (n=24) · operator n=6",
    });
  });

  it("an older coord build that serves no judge_agreement is unknown, never zero", () => {
    const v = ok(populated());
    expect(v.state).toBe("unknown");
    expect(v.text).toMatch(/^verifier agreement unknown/);
    expect(v.text).not.toMatch(/\d/);
  });

  it("coord's judge_agreement_error is unknown and carries the error", () => {
    const v = ok(
      populated({
        judge_agreement: null,
        judge_agreement_error:
          "relation coord.verification_judge_cases does not exist",
      })
    );
    expect(v.state).toBe("unknown");
    expect(v.text).toContain("verification_judge_cases does not exist");
    expect(v.text).not.toContain("κ");
  });

  it("an unreachable door, a degraded body and a malformed block are unknown", () => {
    expect(
      deriveVerifierAgreement({ status: "error", reason: "HTTP 502" })
    ).toEqual({
      state: "unknown",
      text: "verifier agreement unknown — the metrics door did not answer",
    });
    expect(ok(degraded()).text).toBe(
      "verifier agreement unknown — coord could not look"
    );
    const malformed = {
      seeded: { n: "x" },
    } as unknown as VerificationMetrics["judge_agreement"];
    expect(ok(populated({ judge_agreement: malformed })).state).toBe("unknown");
    expect(deriveVerifierAgreement({ status: "loading" }).state).toBe(
      "loading"
    );
  });

  it("an unreadable operator block does not hide the seeded figure", () => {
    const ja = {
      ...judgeAgreement(),
      operator: null,
    } as unknown as VerificationMetrics["judge_agreement"];
    expect(ok(populated({ judge_agreement: ja })).text).toBe(
      "verifier agreement κ 0.71 (seeded n=24) · operator n unknown"
    );
  });
});

describe("operator label sampling", () => {
  const ids = Array.from(
    { length: 12 },
    (_, i) => `9e000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`
  );

  it("isoWeekKey follows ISO-8601 (the week of the Thursday)", () => {
    expect(isoWeekKey(Date.parse("2026-11-01T12:00:00Z"))).toBe("2026-W44");
    expect(isoWeekKey(Date.parse("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekKey(Date.parse("2027-01-01T00:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2024-12-30T00:00:00Z"))).toBe("2025-W01");
  });

  it("draws at most three, the same three on every call in a week", () => {
    const a = sampleForOperatorLabel(ids, "2026-W44");
    expect(a).toHaveLength(OPERATOR_LABELS_PER_WEEK);
    expect(sampleForOperatorLabel([...ids].reverse(), "2026-W44")).toEqual(a);
    expect(sampleForOperatorLabel(ids, "2026-W44")).toEqual(a);
    for (const id of a) expect(ids).toContain(id);
  });

  it("a different week draws again", () => {
    const draws = ["2026-W44", "2026-W45", "2026-W46", "2026-W47"].map((w) =>
      sampleForOperatorLabel(ids, w).join()
    );
    expect(new Set(draws).size).toBeGreaterThan(1);
  });

  it("fewer than three verdicts are all drawn, once each", () => {
    const [a, b] = ids as [string, string];
    expect(sampleForOperatorLabel([a, a, b], "2026-W44").sort()).toEqual(
      [a, b].sort()
    );
    expect(sampleForOperatorLabel([], "2026-W44")).toEqual([]);
  });
});

describe("operatorLabelOutcome", () => {
  it("names each answer distinctly", () => {
    expect(
      operatorLabelOutcome({
        kind: "recorded",
        record: {
          id: "r",
          label_source: "operator",
          verification_id: REFUTATION_VERIFICATION_ID,
          seed_class: null,
          truth: "fails",
          verifier_verdict: "refuted",
          labelled_by: "operator:x",
          created_at: "2026-11-01T00:00:00Z",
        },
      })
    ).toEqual({
      text: "Recorded: did not hold up (verifier said refuted)",
      attention: false,
    });
    expect(
      operatorLabelOutcome({ kind: "already_labelled", existingId: "r" })
    ).toEqual({
      text: "Already labelled — this verdict carries an operator label",
      attention: false,
    });
    expect(
      operatorLabelOutcome({
        kind: "refused",
        code: "operator_principal_required",
        message: "m",
      })
    ).toEqual({
      text: "Not recorded — coord refused it (operator_principal_required): m",
      attention: true,
    });
    expect(
      operatorLabelOutcome({
        kind: "not_found",
        code: "verification_not_found",
        message: "m",
      }).text
    ).toBe("Not recorded — coord has no such verdict in this project");
    expect(
      operatorLabelOutcome({ kind: "not_found", code: null, message: "" }).text
    ).toMatch(/label door is not answering/);
    expect(
      operatorLabelOutcome({ kind: "failed", status: 504, message: "slow" })
    ).toEqual({
      text: "Not known to be recorded — HTTP 504: slow",
      attention: true,
    });
  });
});
