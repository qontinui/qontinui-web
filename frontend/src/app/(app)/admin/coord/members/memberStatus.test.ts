/**
 * R3's audit for the member-access palette, plus the judgements
 * `paletteDisagreements` cannot make (style guide §4.2 clause 4).
 *
 * Two judgements are pinned:
 *
 * 1. **`no-access` is CALM, and says the ask in words.** The reach for amber
 *    here is strong — the member cannot do anything — and it is wrong for R3's
 *    third-case reason: nothing is blocked, nothing decays, and nothing but an
 *    administrator's decision clears it.
 * 2. **`admin` outranks `operator`.** coord's roles are additive grants, so a
 *    member holding both must render as what they can DO, not as whichever
 *    string came first.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  deriveMemberStatus,
  MEMBER_ATTENTION_BY_KIND,
  MEMBER_AUTHOR_GLYPH_KINDS,
  MEMBER_KIND_CLASS,
  NO_ACCESS_EXPLANATION,
  type MemberAccessKind,
} from "./memberStatus";

const ALL = Object.keys(MEMBER_ATTENTION_BY_KIND) as MemberAccessKind[];

describe("member access palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(MEMBER_ATTENTION_BY_KIND, {
        badgeClass: MEMBER_KIND_CLASS,
        authorGlyphKinds: MEMBER_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("is total over the kind union in both directions", () => {
    for (const k of ALL) expect(MEMBER_KIND_CLASS[k]).toBeTruthy();
    expect(Object.keys(MEMBER_KIND_CLASS).sort()).toEqual([...ALL].sort());
  });

  it("mints no red and no amber — an access level is a CHOICE, not an incident", () => {
    for (const k of ALL) {
      expect(MEMBER_ATTENTION_BY_KIND[k]).toBe("none");
      expect(/\bbg-red-/.test(MEMBER_KIND_CLASS[k])).toBe(false);
      expect(/\bbg-amber-/.test(MEMBER_KIND_CLASS[k])).toBe(false);
    }
    expect(MEMBER_AUTHOR_GLYPH_KINDS.size).toBe(0);
  });
});

describe("the readings the palette audit cannot make", () => {
  it("keeps a role-less member CALM and states the ask in words", () => {
    const s = deriveMemberStatus([]);
    expect(s.kind).toBe("no-access");
    expect(s.attention).toBe("none");
    expect(s.reason).toBe(NO_ACCESS_EXPLANATION);
    expect(s.reason).toMatch(/grants a tier/);
  });

  it("treats an absent role array the same as an empty one", () => {
    expect(deriveMemberStatus(null).kind).toBe("no-access");
    expect(deriveMemberStatus(undefined).kind).toBe("no-access");
  });

  it("lets admin outrank operator regardless of array order", () => {
    expect(deriveMemberStatus(["admin", "operator"]).kind).toBe(
      "administrator"
    );
    expect(deriveMemberStatus(["operator", "admin"]).kind).toBe(
      "administrator"
    );
  });

  it("names the two real tiers and owes them no explanation", () => {
    const dev = deriveMemberStatus(["operator"]);
    expect(dev.kind).toBe("developer");
    expect(dev.label).toBe("Developer");
    expect(dev.reason).toBeUndefined();
    expect(deriveMemberStatus(["admin"]).label).toBe("Administrator");
  });

  it("calls an UNKNOWN role access, not no-access", () => {
    // Reporting "no access" about somebody who demonstrably holds a grant is
    // the more damaging of the two possible errors, so an unrecognised role
    // lands on the weaker real tier rather than on the empty state.
    const s = deriveMemberStatus(["auditor"]);
    expect(s.kind).toBe("developer");
    expect(s.reason).toBeUndefined();
  });
});
