/**
 * D3.3's free-text rule (plan `2026-10-23-console-presentation-spaces`):
 * shown only when every repository is first-party AND no confidential term
 * appears — and withheld on every arm that cannot prove it.
 *
 * Fixture names are placeholders ("Acme Corp", "Partner A"), never a real
 * customer or partner.
 */

import { describe, expect, it } from "vitest";
import type { PresentationScopeState } from "./presentationScope";
import {
  WITHHELD,
  containsConfidentialTerm,
  describeRedacted,
  normalizeForMatch,
  redactionVerdict,
  repoOwnerOf,
} from "./redaction";

const READY: PresentationScopeState = {
  status: "ready",
  scope: {
    firstPartyOwners: ["Qontinui", "@tenant-labs"],
    confidentialTerms: [
      "Acme Corp",
      "Partner A",
      "Exämple GmbH",
      "株式会社サンプル",
    ],
  },
};

describe("repoOwnerOf", () => {
  it("reads the owner of every spelling a repository arrives in", () => {
    expect(repoOwnerOf("qontinui/qontinui-web")).toBe("qontinui");
    expect(repoOwnerOf("Qontinui/qontinui-web#123")).toBe("qontinui");
    expect(repoOwnerOf("https://github.com/qontinui/qontinui-web")).toBe(
      "qontinui"
    );
    expect(repoOwnerOf("git@github.com:qontinui/qontinui-web.git")).toBe(
      "qontinui"
    );
  });

  it("finds no owner where there is none to read", () => {
    for (const bare of [
      null,
      undefined,
      "",
      "   ",
      "qontinui-web",
      "/leading-slash",
    ]) {
      expect(repoOwnerOf(bare), String(bare)).toBeNull();
    }
  });
});

describe("confidential-term matching", () => {
  it("ignores case, accents, spacing and punctuation", () => {
    const terms = ["Acme Corp", "Exämple GmbH"];
    for (const text of [
      "Fix the ACME-corp login",
      "acmecorp sync",
      "acme_corp.portal",
      "Examples? no — example gmbh rollout",
      "EXÄMPLE GMBH",
    ]) {
      expect(containsConfidentialTerm(text, terms), text).toBe(true);
    }
  });

  it("matches in any script", () => {
    expect(
      containsConfidentialTerm("導入: 株式会社サンプル 向け", [
        "株式会社サンプル",
      ])
    ).toBe(true);
  });

  it("does not match a partial word of a multi-word term", () => {
    expect(containsConfidentialTerm("Acme integration", ["Acme Corp"])).toBe(
      false
    );
  });

  it("skips a term with no letters or digits", () => {
    expect(
      containsConfidentialTerm("anything at all", ["  ", "--", "!!"])
    ).toBe(false);
  });

  it("folds text to letters and digits only", () => {
    expect(normalizeForMatch("Café — São Paulo, №1")).toBe("cafesaopaulono1");
  });
});

describe("redactionVerdict", () => {
  const firstParty = {
    text: "Ship the presentation lens",
    repo: "qontinui/qontinui-web",
  };

  it("withholds while the scope is unknown, loading or failed — fail closed", () => {
    expect(redactionVerdict(firstParty, { status: "unknown" })).toEqual({
      show: false,
      reason: "scope-unknown",
    });
    expect(redactionVerdict(firstParty, { status: "loading" })).toEqual({
      show: false,
      reason: "scope-loading",
    });
    expect(
      redactionVerdict(firstParty, { status: "error", reason: "503" })
    ).toEqual({ show: false, reason: "scope-error" });
  });

  it("shows first-party text that names no confidential term", () => {
    expect(redactionVerdict(firstParty, READY)).toEqual({ show: true });
    expect(
      redactionVerdict({ text: "x", repo: "tenant-labs/tools" }, READY)
    ).toEqual({ show: true });
  });

  it("withholds an item that names no repository, or one whose owner cannot be read", () => {
    for (const repo of [null, undefined, "", [], ["  "], "qontinui-web"]) {
      expect(
        redactionVerdict({ text: "Ship it", repo }, READY),
        JSON.stringify(repo)
      ).toEqual({ show: false, reason: "no-repo" });
    }
  });

  it("withholds a repository whose owner is not first-party", () => {
    expect(
      redactionVerdict({ text: "Ship it", repo: "client-org/portal" }, READY)
    ).toEqual({ show: false, reason: "foreign-owner" });
  });

  it("withholds an item spanning ANY foreign repository", () => {
    expect(
      redactionVerdict(
        {
          text: "Ship it",
          repo: ["qontinui/qontinui-web", "client-org/portal"],
        },
        READY
      )
    ).toEqual({ show: false, reason: "foreign-owner" });
  });

  it("withholds first-party text that names a confidential term", () => {
    expect(
      redactionVerdict(
        { text: "Prepare the Partner A demo", repo: "qontinui/qontinui-web" },
        READY
      )
    ).toEqual({ show: false, reason: "confidential-term" });
  });

  it("withholds when the repository's own name carries a confidential term", () => {
    expect(
      redactionVerdict(
        { text: "Ship it", repo: "qontinui/acme-corp-portal" },
        READY
      )
    ).toEqual({ show: false, reason: "confidential-term" });
  });

  it("matches first-party owners case-insensitively and without a leading @", () => {
    expect(
      redactionVerdict({ text: "x", repo: "QONTINUI/qontinui-web" }, READY).show
    ).toBe(true);
  });
});

describe("describeRedacted", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const at = "2026-10-20T12:00:00Z";

  it("renders kind · area · status · age", () => {
    expect(
      describeRedacted(
        { kind: "Plan", area: "operator-console", status: "in progress", at },
        READY,
        { now }
      )
    ).toBe("Plan · operator-console · in progress · 3d ago");
  });

  it("says what is unknown rather than leaving a gap", () => {
    expect(describeRedacted({ kind: "Session" }, READY, { now })).toBe(
      "Session · area unknown · status unknown · age unknown"
    );
  });

  it("withholds the area while the scope cannot check it", () => {
    expect(
      describeRedacted(
        { kind: "Plan", area: "acme-corp-integration", status: "draft", at },
        { status: "unknown" },
        { now }
      )
    ).toBe(`Plan · area ${WITHHELD} · draft · 3d ago`);
  });

  it("withholds any field that names a confidential term", () => {
    expect(
      describeRedacted(
        {
          kind: "Plan",
          area: "acme-corp-integration",
          status: "Partner A review",
          at,
        },
        READY,
        { now }
      )
    ).toBe(`Plan · area ${WITHHELD} · ${WITHHELD} · 3d ago`);
  });
});
