/**
 * The presentation scope form's draft (plan
 * `2026-10-23-console-presentation-spaces` D3.3): seeded from the STORED
 * half, split into the write the backend validates, and compared the way the
 * backend stores each list.
 */

import { describe, expect, it } from "vitest";
import {
  draftChangesStored,
  draftFromConfigured,
  parseOwners,
  parseTerms,
  unknownOwnersReason,
  writeFromDraft,
} from "./presentationScopeDraft";

const STORED = {
  first_party_owners: ["qontinui", "qontinui-labs"],
  confidential_terms: ["Acme Corp", "Globex"],
  version: 7,
  updated_at: null,
  updated_by: null,
};

describe("draftFromConfigured", () => {
  it("lists stored owners and terms one per line", () => {
    expect(draftFromConfigured(STORED)).toEqual({
      ownersMode: "list",
      ownersText: "qontinui\nqontinui-labs",
      termsText: "Acme Corp\nGlobex",
    });
  });

  it("follows the registered repositories when no owners are stored", () => {
    expect(
      draftFromConfigured({ ...STORED, first_party_owners: null }).ownersMode
    ).toBe("registered");
  });
});

describe("parseOwners / parseTerms", () => {
  it("splits owners on commas, spaces and new lines", () => {
    expect(parseOwners(" qontinui, qontinui-labs\n\n@acme ")).toEqual([
      "qontinui",
      "qontinui-labs",
      "@acme",
    ]);
    expect(parseOwners("   ")).toEqual([]);
  });

  it("keeps a term's own spaces and commas, one term per line", () => {
    expect(parseTerms("Acme, Inc.\r\n\n  Partner A  \n")).toEqual([
      "Acme, Inc.",
      "Partner A",
    ]);
  });
});

describe("writeFromDraft", () => {
  it("is the stored version's compare-and-set", () => {
    expect(
      writeFromDraft(
        { ownersMode: "list", ownersText: "qontinui", termsText: "Acme" },
        7
      )
    ).toEqual({
      first_party_owners: ["qontinui"],
      confidential_terms: ["Acme"],
      expected_version: 7,
    });
  });

  it("sends null owners for the registered repositories, whatever the text holds", () => {
    expect(
      writeFromDraft(
        { ownersMode: "registered", ownersText: "stale", termsText: "" },
        0
      ).first_party_owners
    ).toBeNull();
  });

  it("sends an empty owner list when the list is chosen and empty", () => {
    expect(
      writeFromDraft({ ownersMode: "list", ownersText: "", termsText: "" }, 0)
        .first_party_owners
    ).toEqual([]);
  });
});

describe("draftChangesStored", () => {
  const same = draftFromConfigured(STORED);

  it("is false for the stored lists, however they are retyped", () => {
    expect(draftChangesStored(same, STORED)).toBe(false);
    expect(
      draftChangesStored(
        {
          ...same,
          ownersText: "@Qontinui, qontinui-labs qontinui",
          termsText: "Acme   Corp\nGlobex\n",
        },
        STORED
      )
    ).toBe(false);
  });

  it("is true for a changed list, order, or owners source", () => {
    expect(
      draftChangesStored({ ...same, termsText: "Acme Corp" }, STORED)
    ).toBe(true);
    expect(
      draftChangesStored({ ...same, termsText: "Globex\nAcme Corp" }, STORED)
    ).toBe(true);
    expect(
      draftChangesStored({ ...same, ownersMode: "registered" }, STORED)
    ).toBe(true);
    expect(
      draftChangesStored(
        { ...same, ownersMode: "list" },
        { ...STORED, first_party_owners: null }
      )
    ).toBe(true);
  });
});

describe("unknownOwnersReason", () => {
  it.each([
    ["tenant_scope_mismatch", "coord resolved a different project"],
    ["coord_unreachable", "coord could not be reached"],
    ["coord_refused", "coord refused the read"],
    ["coord_unreadable", "coord's answer could not be read"],
  ] as const)("%s", (reason, words) => {
    expect(unknownOwnersReason(reason)).toContain(words);
  });

  it("says when no reason was given", () => {
    expect(unknownOwnersReason(null)).toBe("no reason was given");
  });
});
