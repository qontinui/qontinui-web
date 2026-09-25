/**
 * The agent-authored predicate (plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`, Phase 4).
 *
 * This is a FILTER OVER AN AUDIT SURFACE, so both failure directions are
 * expensive and they are not symmetric:
 *
 * * a false NEGATIVE hides an agent's edit from the one page that exists to
 *   show it;
 * * a false POSITIVE files a human's edit under "what agents changed", which
 *   is worse — it manufactures evidence of agent activity that never happened.
 *
 * Every case below is a spelling coord actually produces. The tenant's live
 * corpus was read to build this list rather than the shapes being guessed;
 * `josh@qontinui.io` in particular is the real `updated_by` of
 * `policy/escalation-bar` on this tenant, and it is exactly the value that
 * breaks the tempting "agent = not `operator:`" rule.
 */

import { describe, it, expect } from "vitest";
import {
  classifyWriteAuthor,
  isAgentAuthored,
  isSelfDecided,
  selfDecidedOrUnknown,
  tallyAuthors,
} from "./authorship";

describe("classifyWriteAuthor", () => {
  it("recognises every shape the agent write path stamps", () => {
    // `mcp::tools::authorship_actor`, in its own precedence order.
    expect(
      classifyWriteAuthor("session:f1b444bd-6aff-4e9f-b000-c20d31f3216d")
    ).toBe("agent");
    expect(
      classifyWriteAuthor("agent:2b8a6237-63f9-4a11-a849-cf281f081414")
    ).toBe("agent");
    expect(
      classifyWriteAuthor("device:c79a07d5-7e40-49b4-87fa-554c749f9644")
    ).toBe("agent");
    // An agent write coord could not attribute is still an agent write.
    expect(classifyWriteAuthor("agent:unattributed")).toBe("agent");
    // The compound device+agent key stays on the `device:` prefix.
    expect(
      classifyWriteAuthor(
        "device:c79a07d5-7e40-49b4-87fa-554c749f9644:agent:2b8a6237-63f9-4a11-a849-cf281f081414"
      )
    ).toBe("agent");
  });

  it("recognises BOTH operator spellings — three-segment and two", () => {
    // `session_compliance::operator_actor`.
    expect(
      classifyWriteAuthor(
        "operator:fb7bf946-cb46-4c38-9a1d-c7081c493b04:jspinak@gmail.com"
      )
    ).toBe("operator");
    // `policy_proposals::decide` builds a two-segment key instead.
    expect(classifyWriteAuthor("operator:jspin@example.com")).toBe("operator");
  });

  it("keeps coord's shipped seed out of both sides", () => {
    // 20 of this tenant's 32 documents read `system:seed`. Filing those under
    // agents would swamp the answer to "what have agents changed".
    expect(classifyWriteAuthor("system:seed")).toBe("system");
  });

  it("calls a LEGACY BARE EMAIL unknown, not agent", () => {
    // The case that decides the whole design. `policy/escalation-bar` carries
    // this verbatim — an operator edit written before coord prefixed its actor
    // labels. "Not `operator:`-prefixed" would file a human's edit under
    // agents, which is the misattribution this feed exists to prevent.
    expect(classifyWriteAuthor("josh@qontinui.io")).toBe("unknown");
    expect(isAgentAuthored({ edited_by: "josh@qontinui.io" })).toBe(false);
  });

  it("treats absent, empty and whitespace authors as unknown", () => {
    expect(classifyWriteAuthor(null)).toBe("unknown");
    expect(classifyWriteAuthor(undefined)).toBe("unknown");
    expect(classifyWriteAuthor("")).toBe("unknown");
    expect(classifyWriteAuthor("   ")).toBe("unknown");
  });

  it("does not claim a spelling it has never seen", () => {
    // A tokenised service caller (`caller_principal_label`) and the merge
    // train's own colon-less label. Neither is an agent session; both must be
    // reported as unrecognised rather than assigned a side.
    expect(classifyWriteAuthor("service:coord-worker")).toBe("unknown");
    expect(classifyWriteAuthor("merge-train")).toBe("unknown");
  });

  it("anchors the prefix — a label that merely CONTAINS one is not a match", () => {
    // Guards against a substring rule: an operator whose email happens to
    // carry the word must not be promoted into the agent bucket.
    expect(classifyWriteAuthor("operator:x:agent:smith@example.com")).toBe(
      "operator"
    );
    expect(classifyWriteAuthor("someone-session:1234")).toBe("unknown");
  });
});

describe("tallyAuthors", () => {
  it("counts every row into exactly one class", () => {
    const tally = tallyAuthors([
      { edited_by: "session:1" },
      { edited_by: "device:2" },
      { edited_by: "operator:3:a@b.c" },
      { edited_by: "system:seed" },
      { edited_by: "josh@qontinui.io" },
      { edited_by: null },
    ]);
    expect(tally).toEqual({ agent: 2, operator: 1, system: 1, unknown: 2 });
    // The invariant the "hiding N writes" note depends on: nothing is dropped,
    // so hidden + shown always equals the input.
    const total = tally.agent + tally.operator + tally.system + tally.unknown;
    expect(total).toBe(6);
  });
});

/**
 * Plan `2026-09-13-policy-proposals-agent-decidable-dial-driven-self-retiring`.
 *
 * Ownership stopped being a criterion for DECIDING a proposal, so this module
 * gained the one question the console now has to answer about a decision: was
 * the decider the proposer? It is stated as information — which only works if
 * the answer is right, and the two ways to get it wrong are both quiet.
 */
describe("coord's self-retirement actor", () => {
  it("classifies as `system`, not as an agent and not as an operator", () => {
    // DEFENSIVE — no caller today. `classifyWriteAuthor` is called from exactly
    // one place (`LandedWriteFeed.tsx`, on a landed write's `edited_by`), and
    // the retired section classifies no author at all: it renders coord's
    // decision note directly. This is pinned anyway because the day a surface
    // DOES classify a proposal's `decided_by`, the answer must already be
    // right — a future re-spelling of the allowlist must not be able to refile
    // a machine decision as a human one without a red test.
    expect(classifyWriteAuthor("system:proposal-staleness")).toBe("system");
    expect(isAgentAuthored({ edited_by: "system:proposal-staleness" })).toBe(
      false
    );
  });
});

describe("isSelfDecided", () => {
  const base = { proposed_by: "session:aaaa" };

  it("is true when the same identity proposed and decided", () => {
    expect(isSelfDecided({ ...base, decided_by: "session:aaaa" })).toBe(true);
  });

  it("is false for a different decider, coord's retirement included", () => {
    expect(
      isSelfDecided({ ...base, decided_by: "operator:josh@qontinui.io" })
    ).toBe(false);
    // The retirement actor is never the proposer, so a self-retired proposal is
    // not a self-decided one.
    expect(
      isSelfDecided({ ...base, decided_by: "system:proposal-staleness" })
    ).toBe(false);
  });

  it("the server's field is the contract, even where it disagrees with the strings", () => {
    // Today's coord derives `self_decided` as exactly `decided_by ==
    // proposed_by`, so these two fixtures are shapes it cannot currently
    // produce — which is the point. The precedence is pinned against the
    // CONTRACT, not against the current derivation: if coord ever normalizes
    // identities (one principal under two spellings) or stops deriving this at
    // all, the console must report the server's answer rather than a second
    // one computed here.
    expect(
      isSelfDecided({ ...base, decided_by: "agent:bbbb", self_decided: true })
    ).toBe(true);
    expect(
      isSelfDecided({
        ...base,
        decided_by: "session:aaaa",
        self_decided: false,
      })
    ).toBe(false);
  });

  it("never asserts self-decision from a blank or missing side", () => {
    // UNKNOWN must not render as a claim about who decided what.
    expect(isSelfDecided({ ...base })).toBe(false);
    expect(isSelfDecided({ ...base, decided_by: null })).toBe(false);
    expect(isSelfDecided({ ...base, decided_by: "   " })).toBe(false);
    expect(isSelfDecided({ proposed_by: "", decided_by: "" })).toBe(false);
  });
});

/**
 * `isSelfDecided` folds UNKNOWN into `false`, which is right for a SENTENCE —
 * there is nothing to say about an unanswerable case. It is wrong for an
 * attribute, where `false` is an assertion. `selfDecidedOrUnknown` is the
 * three-answer version the `data-self-decided` attribute is rendered from.
 */
describe("selfDecidedOrUnknown", () => {
  const base = { proposed_by: "session:aaaa" };

  it("answers null — not false — when the question cannot be answered", () => {
    expect(selfDecidedOrUnknown({ ...base })).toBeNull();
    expect(selfDecidedOrUnknown({ ...base, decided_by: null })).toBeNull();
    expect(selfDecidedOrUnknown({ ...base, decided_by: "   " })).toBeNull();
    expect(
      selfDecidedOrUnknown({ proposed_by: "", decided_by: "operator:a@b.c" })
    ).toBeNull();
  });

  it("answers false only when the identities were both present and differed", () => {
    // The distinction the attribute exists for: this `false` is a claim, and
    // the nulls above are not.
    expect(
      selfDecidedOrUnknown({ ...base, decided_by: "operator:josh@qontinui.io" })
    ).toBe(false);
    expect(
      selfDecidedOrUnknown({ ...base, decided_by: "system:proposal-staleness" })
    ).toBe(false);
  });

  it("answers true on a match, and defers to coord's field over both", () => {
    expect(selfDecidedOrUnknown({ ...base, decided_by: "session:aaaa" })).toBe(
      true
    );
    // Coord's answer wins even where it would be unanswerable from the strings.
    expect(selfDecidedOrUnknown({ ...base, self_decided: true })).toBe(true);
    expect(
      selfDecidedOrUnknown({
        ...base,
        decided_by: "session:aaaa",
        self_decided: false,
      })
    ).toBe(false);
  });

  it("agrees with `isSelfDecided` everywhere except on UNKNOWN", () => {
    // Pins the relationship rather than leaving two predicates to drift: the
    // boolean one is exactly this one with null collapsed to false.
    const cases = [
      { ...base, decided_by: "session:aaaa" },
      { ...base, decided_by: "operator:josh@qontinui.io" },
      { ...base },
      { ...base, decided_by: "  " },
      { ...base, decided_by: "agent:bbbb", self_decided: true },
    ];
    for (const c of cases) {
      expect(isSelfDecided(c)).toBe(selfDecidedOrUnknown(c) === true);
    }
    // And the collapse is real — at least one case genuinely differs.
    expect(selfDecidedOrUnknown({ ...base })).toBeNull();
    expect(isSelfDecided({ ...base })).toBe(false);
  });
});
