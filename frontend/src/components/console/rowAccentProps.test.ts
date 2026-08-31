/**
 * `rowAccentProps` — R4's accent and its machine-readable twin, from one call.
 *
 * The colour is the operator's channel; `data-attention` is the same fact in a
 * channel a stylesheet rule, a Spec-CI selector or a `/visual-audit` assertion
 * can address. Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 4 step 1 writes rules keyed on `[data-attention="author"]`, and its own
 * blocker note is the reason this function exists rather than two call sites:
 *
 *   > a rule with a live evaluator and a dead selector reports PASS
 *
 * The same hazard applies one level down. Two calls — `rowAccentClass(a)` for
 * the class and `a.attention` for the attribute — can drift: a caller can paint
 * the accent and forget the attribute (selector dead, rule green), or derive
 * the two from different statuses (selector live, rule green, DOM lying). One
 * call cannot. These tests assert that property directly rather than trusting
 * the callers, which is the same move `claimBannerBorder`'s test made.
 */

import { describe, expect, it } from "vitest";
import { rowAccentClass, rowAccentProps } from "./statusRow";
import { ATTENTION_RANK } from "./attention";
import type { Attention } from "./attention";

/**
 * Derived from `ATTENTION_RANK`, not hand-listed.
 *
 * `ATTENTION_RANK` is a `Record<Attention, number>`, so TypeScript makes it
 * total over the union: a fourth attention value cannot be added without
 * appearing here. A literal array would have compiled fine and quietly left
 * the new value untested by every "for every value" case below — the same
 * shape of gap as a palette table that forgets a kind.
 */
const ALL = Object.keys(ATTENTION_RANK) as Attention[];

describe("rowAccentProps", () => {
  it("returns the SHARED accent byte for byte, never a second spelling", () => {
    // §4.1: nothing outside `statusRow` may mint a red or an amber. If this
    // ever stops delegating, a tint drift here would be invisible to
    // `paletteDisagreements`, which only inspects a kind→class table.
    for (const attention of ALL) {
      expect(rowAccentProps({ attention }).className).toBe(
        rowAccentClass({ attention })
      );
    }
  });

  it("declares the attention the accent was derived from, for every value", () => {
    for (const attention of ALL) {
      expect(rowAccentProps({ attention })["data-attention"]).toBe(attention);
    }
  });

  it("emits `none` rather than omitting it — a calm row is still classified", () => {
    // The absent case belongs to `<RecordRow>`'s optional prop ("this surface
    // has no severity model"). Reaching THIS function means the surface does
    // classify, and it classified this row as calm — which an audit needs to
    // be able to see, or it cannot tell a calm row from an unclassified one.
    const props = rowAccentProps({ attention: "none" });
    expect(props["data-attention"]).toBe("none");
    expect(props.className).toBe("");
  });

  it("puts the caller's classes in front of the accent, as one className", () => {
    const props = rowAccentProps({ attention: "author" }, "cursor-pointer");
    expect(props.className).toBe(
      `cursor-pointer ${rowAccentClass({ attention: "author" })}`
    );
    // The attribute is unaffected by the caller's classes.
    expect(props["data-attention"]).toBe("author");
  });

  it("leaves no stray separator when there is no accent and no extra", () => {
    // A `" "`-joined empty pair would put a leading space on every calm row's
    // className — harmless to render, and enough to break an exact-match
    // assertion in a spec or a style gate.
    expect(rowAccentProps({ attention: "none" }).className).toBe("");
    expect(rowAccentProps({ attention: "none" }, "x").className).toBe("x");
    expect(rowAccentProps({ attention: "author" }).className).not.toMatch(
      /^\s|\s$/
    );
  });
});
