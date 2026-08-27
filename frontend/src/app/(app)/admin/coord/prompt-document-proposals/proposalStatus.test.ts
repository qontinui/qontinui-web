/**
 * R3's audit for the policy-edit proposal palette, plus the two judgements
 * `paletteDisagreements` cannot make for us (§4.2 clause 4: it proves the hue
 * matches the DECLARED attention, never that the declared attention was right).
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  PROPOSAL_ATTENTION_BY_KIND,
  PROPOSAL_AUTHOR_GLYPH_KINDS,
  PROPOSAL_KIND_CLASS,
  deriveProposalStatus,
  type ProposalKind,
} from "./proposalStatus";
import type { PromptDocumentProposal } from "./types";

const ALL: ProposalKind[] = [
  "loosening",
  "unclassifiable",
  "stale",
  "unrecognised",
];

function proposal(
  over: Partial<PromptDocumentProposal> = {}
): Pick<PromptDocumentProposal, "direction" | "base_version"> {
  return { direction: "loosening", base_version: 3, ...over } as Pick<
    PromptDocumentProposal,
    "direction" | "base_version"
  >;
}

describe("proposal palette", () => {
  it("agrees with the attention table — red iff author, amber iff waiting", () => {
    expect(
      paletteDisagreements(PROPOSAL_ATTENTION_BY_KIND, {
        badgeClass: PROPOSAL_KIND_CLASS,
        authorGlyphKinds: PROPOSAL_AUTHOR_GLYPH_KINDS,
      })
    ).toEqual([]);
  });

  it("is total over the kind union in both directions", () => {
    expect(Object.keys(PROPOSAL_ATTENTION_BY_KIND).sort()).toEqual(
      [...ALL].sort()
    );
    for (const k of ALL) expect(PROPOSAL_KIND_CLASS[k]).toBeTruthy();
  });
});

describe("the two judgements the palette audit cannot make", () => {
  it("keeps a merely-pending proposal CALM, including `unclassifiable`", () => {
    // The correction. This is a review QUEUE, not a gate: the edit did NOT
    // land, nothing is blocked, and nothing decays while it waits. Amber would
    // promise something else clears it; red would claim "act now". The card
    // painted `unclassifiable` red purely because the word is alarming, which
    // is the exact failure R3 exists to prevent.
    expect(PROPOSAL_ATTENTION_BY_KIND.loosening).toBe("none");
    expect(PROPOSAL_ATTENTION_BY_KIND.unclassifiable).toBe("none");
    expect(/\bbg-(red|amber)-/.test(PROPOSAL_KIND_CLASS.loosening)).toBe(false);
    expect(/\bbg-(red|amber)-/.test(PROPOSAL_KIND_CLASS.unclassifiable)).toBe(
      false
    );
    // ...and the ask is carried in WORDS instead, which is the other half of
    // the guide's third case. A calm row that says nothing is the failure.
    expect(deriveProposalStatus(proposal(), null).reason).toMatch(
      /held rather than applied/i
    );
  });

  it("files a STALE proposal as author-action — the premise expired", () => {
    const s = deriveProposalStatus(proposal({ base_version: 3 }), 7);
    expect(s.kind).toBe("stale");
    expect(s.attention).toBe("author");
    expect(s.reason).toContain("v7");
    // Staleness DOMINATES the direction: what the comparator concluded about
    // wording that is no longer deployed is not the operative fact.
    expect(
      deriveProposalStatus(
        proposal({ direction: "unclassifiable", base_version: 3 }),
        7
      ).kind
    ).toBe("stale");
  });

  it("never claims freshness from a version it could not read", () => {
    // `liveVersion === null` is UNKNOWN. A document version we failed to read
    // cannot prove a proposal is current, so it must not resolve to `stale`
    // NOR silently to "still the current version".
    const s = deriveProposalStatus(proposal({ base_version: 3 }), null);
    expect(s.kind).toBe("loosening");
  });

  it("floors an unrecognised direction at amber, not calm", () => {
    const s = deriveProposalStatus(
      proposal({ direction: "sideways" as PromptDocumentProposal["direction"] }),
      3
    );
    expect(s.kind).toBe("unrecognised");
    expect(s.attention).toBe("waiting");
    // The raw token is shown verbatim rather than guessed at.
    expect(s.label).toBe("sideways");
  });

  it("does not let a live version EQUAL to the base read as stale", () => {
    expect(deriveProposalStatus(proposal({ base_version: 4 }), 4).kind).toBe(
      "loosening"
    );
  });
});
