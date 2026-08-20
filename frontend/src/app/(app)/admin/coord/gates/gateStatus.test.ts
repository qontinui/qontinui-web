/**
 * R3's audit for the gate palette, plus the judgements
 * `paletteDisagreements` cannot make (style guide §4.2 clause 4).
 *
 * Three judgements are pinned, all three invisible to the palette audit:
 *
 * 1. **`withdrawn` is calm.** It was destructive red, on the stated reasoning
 *    that it "tones like failed". A registrant cancelling its own request is a
 *    CHOICE with no cost, and red on it spends the hue's credibility.
 * 2. **`stale` is red, and it is a KIND.** It used to be a red word beside a
 *    grey verdict badge, so an open gate the sweep had abandoned rendered
 *    calm-plus-ornament.
 * 3. **`pending` stays calm.** The reach for amber here is strong and wrong:
 *    a pending gate is the NORMAL state of a healthy gate, and painting the
 *    majority of the page amber destroys the signal.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import {
  deriveGateStatus,
  GATE_ATTENTION_BY_KIND,
  GATE_AUTHOR_GLYPH_KINDS,
  GATE_KIND_CLASS,
  isTerminalGateVerdict,
  type GateKind,
} from "./gateStatus";

const ALL = Object.keys(GATE_ATTENTION_BY_KIND) as GateKind[];

const gate = (over: Partial<Parameters<typeof deriveGateStatus>[0]> = {}) => ({
  verdict: "pending",
  verdict_reason: null,
  stale: false,
  ...over,
});

describe("gate palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(GATE_ATTENTION_BY_KIND, {
        badgeClass: GATE_KIND_CLASS,
        authorGlyphKinds: GATE_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("is total over the kind union in both directions", () => {
    for (const k of ALL) expect(GATE_KIND_CLASS[k]).toBeTruthy();
    expect(Object.keys(GATE_KIND_CLASS).sort()).toEqual([...ALL].sort());
  });

  it("carries ✕ on exactly the two author kinds", () => {
    expect([...GATE_AUTHOR_GLYPH_KINDS].sort()).toEqual(["failed", "stale"]);
  });
});

describe("the readings the palette audit cannot make", () => {
  it("keeps `withdrawn` CALM — a cancelled request costs nobody anything", () => {
    const s = deriveGateStatus(gate({ verdict: "withdrawn" }));
    expect(s.kind).toBe("withdrawn");
    expect(s.attention).toBe("none");
    expect(/\bbg-red-/.test(GATE_KIND_CLASS.withdrawn)).toBe(false);
    // …and it keeps coord's own word, so it stays visually distinct from
    // `cleared` without borrowing `failed`'s hue.
    expect(s.label).toBe("withdrawn");
  });

  it("makes `stale` a KIND that WINS over the calm ones, and paints it red", () => {
    const s = deriveGateStatus(gate({ verdict: "pending", stale: true }));
    expect(s.kind).toBe("stale");
    expect(s.attention).toBe("author");
    expect(/\bbg-red-/.test(GATE_KIND_CLASS.stale)).toBe(true);
    expect(s.reason).toMatch(/not re-evaluated this gate recently/);
  });

  it("does NOT let staleness overwrite a terminal verdict", () => {
    // A gate that already failed has nothing left to re-evaluate, so `stale`
    // on it is bookkeeping. Letting it win would relabel a failure.
    expect(deriveGateStatus(gate({ verdict: "failed", stale: true })).kind).toBe(
      "failed"
    );
    expect(
      deriveGateStatus(gate({ verdict: "cleared", stale: true })).kind
    ).toBe("cleared");
    expect(
      deriveGateStatus(gate({ verdict: "withdrawn", stale: true })).kind
    ).toBe("withdrawn");
  });

  it("keeps `pending` CALM — it is the normal state of a healthy gate", () => {
    const s = deriveGateStatus(gate({ verdict: "pending" }));
    expect(s.kind).toBe("pending");
    expect(s.attention).toBe("none");
    expect(/\bbg-amber-/.test(GATE_KIND_CLASS.pending)).toBe(false);
  });

  it("floors an unreadable verdict at amber, never calm", () => {
    const s = deriveGateStatus(gate({ verdict: "quorum_split" }));
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("waiting");
    expect(GATE_KIND_CLASS.unknown).toBe(UNKNOWN_AMBER);
    // The operator still gets told what coord actually said.
    expect(s.reason).toContain("quorum_split");
  });
});

describe("verdict normalisation", () => {
  it("reads coord's synonym sets", () => {
    for (const v of ["pass", "passed", "cleared", "ready", "OK"]) {
      expect(deriveGateStatus(gate({ verdict: v })).kind).toBe("cleared");
    }
    for (const v of ["fail", "failed", "error", "veto", "rejected"]) {
      expect(deriveGateStatus(gate({ verdict: v })).kind).toBe("failed");
    }
    for (const v of ["evaluating", "running"]) {
      expect(deriveGateStatus(gate({ verdict: v })).kind).toBe("evaluating");
    }
  });

  it("names the terminal set the same way the derivation does", () => {
    expect(isTerminalGateVerdict("Cleared")).toBe(true);
    expect(isTerminalGateVerdict("withdrawn")).toBe(true);
    expect(isTerminalGateVerdict("pending")).toBe(false);
    expect(isTerminalGateVerdict("quorum_split")).toBe(false);
  });

  it("passes coord's verdict_reason through as the row's reason", () => {
    expect(
      deriveGateStatus(gate({ verdict: "failed", verdict_reason: "2 of 3 checks red" }))
        .reason
    ).toBe("2 of 3 checks red");
  });
});
