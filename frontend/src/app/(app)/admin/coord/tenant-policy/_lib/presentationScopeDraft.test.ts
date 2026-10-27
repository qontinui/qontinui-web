/**
 * The presentation scope form's draft (plan
 * `2026-10-23-console-presentation-spaces` D3.3): seeded from the STORED
 * half, split into the write the backend validates, and compared the way the
 * backend stores each list.
 */

import { describe, expect, it } from "vitest";
import { PresentationScopeConflict } from "@/lib/api/presentationScope";
import { BackendError } from "@/lib/errors/backend-error-message";
import {
  baseOf,
  draftChangesStored,
  draftFromConfigured,
  editIsFor,
  parseOwners,
  parseTerms,
  saveFailureOf,
  unknownOwnersReason,
  writeFromEdit,
  type EditBase,
} from "./presentationScopeDraft";

const TENANT = "00000000-0000-0000-0000-00000000000a";
const BASE: EditBase = { tenantId: TENANT, version: 7 };

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

describe("writeFromEdit", () => {
  it("is the compare-and-set on the project and the version the edit was made against", () => {
    expect(
      writeFromEdit({
        draft: {
          ownersMode: "list",
          ownersText: "qontinui",
          termsText: "Acme",
        },
        base: BASE,
      })
    ).toEqual({
      first_party_owners: ["qontinui"],
      confidential_terms: ["Acme"],
      expected_version: 7,
      expected_tenant_id: TENANT,
    });
  });

  it("sends null owners for the registered repositories, whatever the text holds", () => {
    expect(
      writeFromEdit({
        draft: { ownersMode: "registered", ownersText: "stale", termsText: "" },
        base: BASE,
      }).first_party_owners
    ).toBeNull();
  });

  it("sends an empty owner list when the list is chosen and empty", () => {
    expect(
      writeFromEdit({
        draft: { ownersMode: "list", ownersText: "", termsText: "" },
        base: BASE,
      }).first_party_owners
    ).toEqual([]);
  });
});

describe("baseOf / editIsFor", () => {
  const record = {
    tenant_id: TENANT,
    first_party_owners: ["qontinui"],
    first_party_owners_source: "configured" as const,
    first_party_owners_unknown_reason: null,
    confidential_terms: [],
    configured: { ...STORED },
    defaults: {
      registered_repo_owners: [],
      registered_repo_owners_unknown_reason: null,
      viewer_other_tenant_names: [],
    },
    can_edit: true,
  };

  it("binds an edit to the record's project and stored version", () => {
    expect(baseOf(record)).toEqual(BASE);
  });

  it("is for the project the edit was made against, whatever the version", () => {
    const draft = draftFromConfigured(STORED);
    expect(editIsFor({ draft, base: { ...BASE, version: 1 } }, record)).toBe(
      true
    );
    expect(
      editIsFor(
        { draft, base: { ...BASE, tenantId: "another-project" } },
        record
      )
    ).toBe(false);
  });
});

describe("saveFailureOf", () => {
  const reading = { kind: "unstructured" as const, sentence: "why" };

  it.each<[string, unknown, string]>([
    [
      "a version conflict",
      new PresentationScopeConflict(reading, "version"),
      "conflict",
    ],
    [
      "a project conflict",
      new PresentationScopeConflict(reading, "tenant"),
      "tenant-moved",
    ],
    ["a 409 from elsewhere", new BackendError(reading, 409), "conflict"],
    ["a refusal (403)", new BackendError(reading, 403), "refused"],
    ["an invalid list (422)", new BackendError(reading, 422), "refused"],
    ["a server error (500)", new BackendError(reading, 500), "unknown"],
    ["a gateway timeout (504)", new BackendError(reading, 504), "unknown"],
    [
      "a client timeout",
      new Error("Request timeout - backend may be starting up."),
      "unknown",
    ],
    ["a lost connection", new TypeError("Failed to fetch"), "unknown"],
    ["a non-error throw", "boom", "unknown"],
  ])("%s is %s", (_name, err, kind) => {
    expect(saveFailureOf(err).kind).toBe(kind);
  });

  it("never calls an unknown outcome refused, and says why it is unknown", () => {
    const failure = saveFailureOf(new Error("Request timeout - backend"));
    expect(failure).toEqual({
      kind: "unknown",
      message: "The save's outcome is unknown (Request timeout - backend).",
    });
  });

  it("names a 403 as the admin refusal it is", () => {
    const failure = saveFailureOf(new BackendError(reading, 403));
    expect(failure.kind === "refused" && failure.message).toContain(
      "only an admin of this project"
    );
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
