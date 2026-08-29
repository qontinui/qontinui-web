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
