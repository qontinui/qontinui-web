import { describe, expect, it } from "vitest";
import {
  EMPTY_ATTEST,
  attestationViews,
  buildAttestRequest,
  describeCitation,
  describePhaseEvidence,
  describeResolution,
  isManualCitation,
  phaseEvidenceState,
  validateAttest,
  validateCitation,
} from "./evidence";

const FINDING = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";

describe("attestationViews", () => {
  it("joins who and when by row, checked on phase and kind", () => {
    const v = attestationViews({
      phase_attestations: [
        { phase_index: 2, evidence_kind: "finding", evidence_ref: FINDING, resolution: "resolved" },
      ],
      phases_attested_detail: [
        {
          phase_index: 2,
          evidence_kind: "finding",
          resolution: "resolved",
          attested_at: "2026-11-20T10:00:00Z",
          attested_by: "operator:ops@example.com",
        },
      ],
    });
    expect(v[0]).toMatchObject({
      detailKnown: true,
      attested_by: "operator:ops@example.com",
      attested_at: "2026-11-20T10:00:00Z",
    });
  });

  it("says detail is unknown when coord serves none, never invents a date", () => {
    const v = attestationViews({
      phase_attestations: [
        { phase_index: 2, evidence_kind: "finding", evidence_ref: FINDING, resolution: "resolved" },
      ],
    });
    expect(v[0].detailKnown).toBe(false);
    expect(v[0].attested_at).toBeNull();
    expect(v[0].attested_by).toBeNull();
  });

  it("does not pair a row with another phase's detail", () => {
    const v = attestationViews({
      phase_attestations: [
        { phase_index: 2, evidence_kind: "finding", evidence_ref: FINDING, resolution: "resolved" },
      ],
      phases_attested_detail: [
        { phase_index: 3, evidence_kind: "finding", resolution: "resolved", attested_by: "someone" },
      ],
    });
    expect(v[0].detailKnown).toBe(false);
    expect(v[0].attested_by).toBeNull();
  });

  it("reads a missing delivery view as no rows", () => {
    expect(attestationViews(null)).toEqual([]);
    expect(attestationViews(undefined)).toEqual([]);
  });
});

describe("phase evidence wording", () => {
  const d = { phases_delivered: [1], phases_attested: [2] };
  it("delivered beats attested; absence is not confirmed, never planned", () => {
    expect(phaseEvidenceState(d, 1)).toBe("delivered");
    expect(phaseEvidenceState(d, 2)).toBe("attested");
    expect(phaseEvidenceState(d, 3)).toBe("not_confirmed");
    expect(phaseEvidenceState(null, 1)).toBe("not_confirmed");
    expect(describePhaseEvidence("not_confirmed")).toBe("Not confirmed");
  });

  it("names every resolution a person can meet", () => {
    expect(describeResolution("resolved")).toBe("In effect");
    expect(describeResolution("retracted")).toBe("Retracted");
    expect(describeResolution("vanished")).toBe("Evidence gone");
    expect(describeResolution("unreadable")).toBe("Could not be checked");
  });
});

describe("citations", () => {
  it("only manual citations are removable", () => {
    expect(isManualCitation({ repo: "a/b", pr_number: 1, sources: ["manual_backfill"] })).toBe(true);
    expect(isManualCitation({ repo: "a/b", pr_number: 1, sources: ["webhook"] })).toBe(false);
    expect(isManualCitation({ repo: "a/b", pr_number: 1, sources: "manual_backfill,webhook" })).toBe(true);
    expect(isManualCitation({ repo: "a/b", pr_number: 1 })).toBe(false);
  });

  it("says what coord observed, not what was hoped", () => {
    expect(describeCitation({ repo: "a/b", pr_number: 1, merged: true })).toBe("Landed");
    expect(describeCitation({ repo: "a/b", pr_number: 1, merged: false, closed_unmerged: true })).toBe(
      "Closed without landing"
    );
    expect(describeCitation({ repo: "a/b", pr_number: 1, merged: null, observed: false })).toBe(
      "Not yet observed by coord"
    );
    expect(describeCitation({ repo: "a/b", pr_number: 1 })).toBe("State unknown");
  });
});

describe("drafts", () => {
  it("validates the attestation draft", () => {
    expect(validateAttest(EMPTY_ATTEST)).not.toEqual([]);
    const ok = { ...EMPTY_ATTEST, phase: "2", ref: FINDING };
    expect(validateAttest(ok)).toEqual([]);
    expect(
      validateAttest({ ...ok, minVersion: "3" }).join(" ")
    ).toMatch(/prompt document only/);
    expect(
      validateAttest({ ...ok, kind: "prompt_document", minVersion: "x" }).join(" ")
    ).toMatch(/whole number/);
  });

  it("builds a closed request", () => {
    expect(
      buildAttestRequest({ phase: "2", kind: "finding", ref: ` ${FINDING} `, minVersion: "", note: " why " })
    ).toEqual({
      phase_index: 2,
      evidence_kind: "finding",
      evidence_ref: FINDING,
      note: "why",
    });
    expect(
      buildAttestRequest({ phase: "1", kind: "prompt_document", ref: FINDING, minVersion: "4", note: "" })
    ).toMatchObject({ evidence_min_version: 4 });
  });

  it("validates a citation", () => {
    expect(validateCitation("acme/widgets", "12")).toEqual([]);
    expect(validateCitation("widgets", "12")).not.toEqual([]);
    expect(validateCitation("acme/widgets", "0")).not.toEqual([]);
  });
});
