/**
 * deriveQuestionEffect — which decision a question row mirrors.
 *
 * Plan `2026-09-12-one-decision-row-one-inbox-clause-model-is-the-home-for-proposed-policy`.
 * The pins that matter: an ordinary row (including every row from a coord build
 * that omits the columns) is `null`, so it renders exactly as before; each
 * known kind carries the answer vocabulary coord routes through the effect's
 * core; and an unrecognised kind is SURFACED rather than folded into "none".
 */

import { describe, expect, it } from "vitest";
import {
  GATE_DECISIONS,
  PROPOSAL_DECISIONS,
  deriveQuestionEffect,
  effectDecisionsFor,
} from "./questionEffect";

describe("deriveQuestionEffect — no effect", () => {
  it.each([
    ["absent (older coord)", {}],
    ["null", { effect_kind: null, effect_ref: null }],
    ["'none'", { effect_kind: "none", effect_ref: null }],
    ["empty string", { effect_kind: "", effect_ref: { id: "x" } }],
  ])("is null when effect_kind is %s", (_label, row) => {
    expect(deriveQuestionEffect(row)).toBeNull();
  });

  // The respond proxy classifies effect_kind EXACTLY and gates everything but
  // absent/null/""/"none" on tenant admin; the console must agree, or a
  // non-admin is offered a composer the server refuses.
  it.each([
    [1, "1"],
    [true, "true"],
    [{}, "{}"],
    [["gate"], '["gate"]'],
    [["proposal"], '["proposal"]'],
    [["clause"], '["clause"]'],
    [["none"], '["none"]'],
    [Number.NaN, "NaN"],
    // JSON.stringify returns undefined for a Symbol, not a throw.
    [Symbol("x"), "Symbol(x)"],
  ])(
    "treats the non-string effect_kind %j as an unknown effect with no decisions",
    (kind, shown) => {
      const e = deriveQuestionEffect({ effect_kind: kind as unknown as string });
      expect(e?.kind).toBe("unknown");
      expect(e?.decisions).toBeNull();
      expect(e?.rawKind).toBe(shown);
      expect(e?.label).toBe(`effect: ${shown}`);
    }
  );

  it("renders a function (JSON yields undefined) via String()", () => {
    function f() {}
    const e = deriveQuestionEffect({ effect_kind: f as unknown as string });
    expect(e?.kind).toBe("unknown");
    expect(e?.decisions).toBeNull();
    // The transpiler may reformat the body, so pin only the prefix.
    expect(e?.rawKind.startsWith("function f(")).toBe(true);
  });

  it("never throws on values JSON and String() cannot render", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const bare = Object.create(null) as Record<string, unknown>;
    bare.self = bare;
    const cases: [unknown, string][] = [
      [cyclic, "[object Object]"],
      [BigInt(10), "10"],
      [bare, "<object>"],
    ];
    for (const [kind, shown] of cases) {
      const e = deriveQuestionEffect({ effect_kind: kind as unknown as string });
      expect(e?.kind).toBe("unknown");
      expect(e?.decisions).toBeNull();
      expect(e?.rawKind).toBe(shown);
      expect(e?.label).toBe(`effect: ${shown}`);
    }
  });

  it("truncates a long label but keeps the full value in rawKind", () => {
    const kind = { a: "x".repeat(100) };
    const e = deriveQuestionEffect({ effect_kind: kind as unknown as string });
    const shown = JSON.stringify(kind);
    expect(e?.label).toBe(`effect: ${shown.slice(0, 39)}…`);
    expect(e?.rawKind).toBe(shown);
  });

  it("truncates at 41 characters", () => {
    const kind = { a: "x".repeat(33) };
    const shown = JSON.stringify(kind);
    expect(shown.length).toBe(41);
    const e = deriveQuestionEffect({ effect_kind: kind as unknown as string });
    expect(e?.label).toBe(`effect: ${shown.slice(0, 39)}…`);
  });

  it("truncates a long unknown STRING kind too, keeping it whole in rawKind", () => {
    const raw = "k".repeat(60);
    const e = deriveQuestionEffect({ effect_kind: raw });
    expect(e?.label).toBe(`effect: ${"k".repeat(39)}…`);
    expect(e?.rawKind).toBe(raw);
  });

  it("counts code points, not UTF-16 units, at the 40/41 boundary", () => {
    const forty = "😀".repeat(40);
    expect(deriveQuestionEffect({ effect_kind: forty })?.label).toBe(
      `effect: ${forty}`
    );
    const fortyOne = "😀".repeat(41);
    expect(deriveQuestionEffect({ effect_kind: fortyOne })?.label).toBe(
      `effect: ${"😀".repeat(39)}…`
    );
  });

  it("never splits a surrogate pair when truncating", () => {
    const raw = "😀".repeat(50);
    const e = deriveQuestionEffect({ effect_kind: raw });
    expect(e?.label).toBe(`effect: ${"😀".repeat(39)}…`);
  });

  it("leaves a label of exactly 40 characters untruncated", () => {
    const kind = { a: "x".repeat(32) };
    const shown = JSON.stringify(kind);
    expect(shown.length).toBe(40);
    const e = deriveQuestionEffect({ effect_kind: kind as unknown as string });
    expect(e?.label).toBe(`effect: ${shown}`);
  });

  it.each([[" none "], ["NONE"], ["none\n"]])(
    "treats %j as an effect, not as 'none'",
    (kind) => {
      expect(deriveQuestionEffect({ effect_kind: kind })).not.toBeNull();
    }
  );
});

describe("deriveQuestionEffect — gate", () => {
  it("shows the work unit and phase and links the gate", () => {
    const e = deriveQuestionEffect({
      effect_kind: "gate",
      effect_ref: {
        id: "gate-7",
        gate_id: "gate-7",
        work_unit_id: "wu-42",
        phase_name: "Phase 2",
      },
    });
    expect(e).not.toBeNull();
    expect(e?.kind).toBe("gate");
    expect(e?.id).toBe("gate-7");
    expect(e?.detail).toBe("wu-42 · Phase 2");
    expect(e?.href).toBe("/admin/coord/gates?gate=gate-7");
    expect(e?.decisions?.map((d) => d.value)).toEqual(["met", "not_met"]);
    expect(e?.decisions).toBe(GATE_DECISIONS);
  });

  it("tolerates a ref missing its display keys, or no ref at all", () => {
    const bare = deriveQuestionEffect({
      effect_kind: "gate",
      effect_ref: { gate_id: "g/1" },
    });
    expect(bare?.id).toBe("g/1");
    expect(bare?.detail).toBeNull();
    expect(bare?.href).toBe("/admin/coord/gates?gate=g%2F1");

    const noRef = deriveQuestionEffect({ effect_kind: "gate" });
    expect(noRef?.kind).toBe("gate");
    expect(noRef?.id).toBeNull();
    expect(noRef?.href).toBe("/admin/coord/gates");
    // Still decidable — coord owns resolving the gate from the row.
    expect(noRef?.decisions).toBe(GATE_DECISIONS);
  });

  it("ignores a malformed ref instead of throwing", () => {
    for (const effect_ref of ["gate-7", 7, ["gate-7"], { id: {} }]) {
      const e = deriveQuestionEffect({ effect_kind: "gate", effect_ref });
      expect(e?.kind).toBe("gate");
      expect(e?.id).toBeNull();
    }
  });
});

describe("deriveQuestionEffect — proposal", () => {
  it("links the proposal drill-down and offers approve / reject", () => {
    const e = deriveQuestionEffect({
      effect_kind: "proposal",
      effect_ref: { id: "p-1", proposal_id: "p-1" },
    });
    expect(e?.kind).toBe("proposal");
    expect(e?.href).toBe("/admin/coord/prompt-document-proposals?proposal=p-1");
    expect(e?.decisions).toBe(PROPOSAL_DECISIONS);
    expect(e?.decisions?.map((d) => d.value)).toEqual(["approve", "reject"]);
  });
});

describe("deriveQuestionEffect — clause (reserved) and unknown", () => {
  it("renders a clause as a plain, undecidable-here chip", () => {
    const e = deriveQuestionEffect({
      effect_kind: "clause",
      effect_ref: {
        id: "c-1",
        kind: "policy",
        name: "testing",
        clause_id: "c-1",
      },
    });
    expect(e?.kind).toBe("clause");
    expect(e?.detail).toBe("policy/testing");
    expect(e?.href).toBeNull();
    expect(e?.decisions).toBeNull();
  });

  it("surfaces a kind this build predates rather than hiding it", () => {
    const e = deriveQuestionEffect({
      effect_kind: "merge",
      effect_ref: { id: "m" },
    });
    expect(e?.kind).toBe("unknown");
    expect(e?.rawKind).toBe("merge");
    expect(e?.label).toBe("effect: merge");
    expect(e?.decisions).toBeNull();
  });
});

describe("effectDecisionsFor — buttons only for values the row itself lists", () => {
  const gate = deriveQuestionEffect({
    effect_kind: "gate",
    effect_ref: { id: "gate-7" },
  });
  const proposal = deriveQuestionEffect({
    effect_kind: "proposal",
    effect_ref: { id: "p-1" },
  });

  it("offers the decisions when the row's options match exactly", () => {
    const out = effectDecisionsFor(gate, ["not_met", "met"]);
    expect(out.mismatch).toBe(false);
    expect(out.decisions?.map((d) => d.value)).toEqual(["met", "not_met"]);
  });

  it("accepts {value, label} option objects", () => {
    const out = effectDecisionsFor(proposal, [
      { value: "approve", label: "Approve" },
      { value: "reject", label: "Reject" },
    ]);
    expect(out.mismatch).toBe(false);
    expect(out.decisions?.map((d) => d.value)).toEqual(["approve", "reject"]);
  });

  it.each([
    ["a renamed value", ["approve", "decline"]],
    ["an extra option", ["met", "not_met", "defer"]],
    ["a missing option", ["met"]],
    ["no options at all", null],
    ["a non-array", "met"],
  ])("falls back (mismatch) on %s", (_l, options) => {
    const eff =
      Array.isArray(options) && options.includes("approve") ? proposal : gate;
    const out = effectDecisionsFor(eff, options);
    expect(out.decisions).toBeNull();
    expect(out.mismatch).toBe(true);
  });

  it("is a plain no-decision (not a mismatch) for rows without a vocabulary", () => {
    expect(effectDecisionsFor(null, ["met"])).toEqual({
      decisions: null,
      mismatch: false,
    });
    const clause = deriveQuestionEffect({ effect_kind: "clause" });
    expect(effectDecisionsFor(clause, ["a"])).toEqual({
      decisions: null,
      mismatch: false,
    });
  });
});
