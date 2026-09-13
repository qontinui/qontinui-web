import { describe, expect, it } from "vitest";
import {
  choiceFromTenant,
  isUnconfirmedWrite,
  readAutoFixPr,
  tenantFromChoice,
  tenantSummary,
} from "./auto-fix-pr";

describe("readAutoFixPr", () => {
  it("returns null when the coord build does not serve the fields", () => {
    expect(readAutoFixPr({ auto_merge_enabled: true })).toBeNull();
    expect(readAutoFixPr(null)).toBeNull();
    expect(readAutoFixPr(undefined)).toBeNull();
    expect(readAutoFixPr("nope")).toBeNull();
  });

  it("reads all three tenant column values", () => {
    expect(
      readAutoFixPr({
        auto_fix_pr_tenant: null,
        auto_fix_pr: true,
        auto_fix_pr_source: "default",
      })
    ).toEqual({ tenant: null, effective: true, source: "default" });
    expect(
      readAutoFixPr({
        auto_fix_pr_tenant: true,
        auto_fix_pr: true,
        auto_fix_pr_source: "tenant",
      })
    ).toEqual({ tenant: true, effective: true, source: "tenant" });
    expect(
      readAutoFixPr({
        auto_fix_pr_tenant: false,
        auto_fix_pr: false,
        auto_fix_pr_source: "tenant",
      })
    ).toEqual({ tenant: false, effective: false, source: "tenant" });
  });

  it("never renders an unknown source as on, whatever the bool says", () => {
    expect(
      readAutoFixPr({
        auto_fix_pr_tenant: null,
        auto_fix_pr: true,
        auto_fix_pr_source: "unknown",
      })
    ).toEqual({ tenant: null, effective: false, source: "unknown" });
  });

  it("reads a source outside the contract as unknown", () => {
    expect(
      readAutoFixPr({
        auto_fix_pr_tenant: true,
        auto_fix_pr: true,
        auto_fix_pr_source: "fleet",
      })
    ).toEqual({ tenant: true, effective: false, source: "unknown" });
  });

  it("reads a missing resolved bool as unknown, not as off-by-default", () => {
    expect(
      readAutoFixPr({ auto_fix_pr_tenant: null, auto_fix_pr_source: "default" })
    ).toEqual({ tenant: null, effective: false, source: "unknown" });
  });

  it("refuses a malformed tenant value rather than showing it as Default", () => {
    expect(
      readAutoFixPr({
        auto_fix_pr_tenant: "false",
        auto_fix_pr: false,
        auto_fix_pr_source: "tenant",
      })
    ).toBeNull();
  });
});

describe("isUnconfirmedWrite", () => {
  // The shape the web proxy throws: HttpClient wraps the proxy's JSON error,
  // whose `detail` is coord's refusal body as text.
  const thrown = (coordBody: object) =>
    `PATCH /api/v1/operations/pr-merge/settings failed: 503 - ${JSON.stringify({
      detail: JSON.stringify(coordBody),
    })}`;

  it("written: null (commit_unconfirmed) is UNCONFIRMED", () => {
    expect(
      isUnconfirmedWrite(
        thrown({
          error: "auto_fix_pr_column_unavailable",
          cause: "commit_unconfirmed",
          written: null,
        })
      )
    ).toBe(true);
  });

  it.each([
    "not_yet_added",
    "dropped_while_read",
    "unprobed_and_unreadable",
    "write_failed",
  ])("written: false (%s) is a clean failure, not unconfirmed", (cause) => {
    expect(
      isUnconfirmedWrite(
        thrown({
          error: "auto_fix_pr_column_unavailable",
          cause,
          written: false,
        })
      )
    ).toBe(false);
  });

  it("an explicit written: false wins over the cause text", () => {
    expect(
      isUnconfirmedWrite(
        thrown({ cause: "commit_unconfirmed", written: false })
      )
    ).toBe(false);
  });

  it("unrelated errors are plain failures", () => {
    expect(isUnconfirmedWrite("PATCH failed: 400 - unknown field")).toBe(false);
    expect(isUnconfirmedWrite("network down")).toBe(false);
  });
});

describe("choice <-> tenant column", () => {
  it("maps each of the three positions to exactly one column value", () => {
    expect(tenantFromChoice("default")).toBeNull();
    expect(tenantFromChoice("on")).toBe(true);
    expect(tenantFromChoice("off")).toBe(false);
    expect(choiceFromTenant(null)).toBe("default");
    expect(choiceFromTenant(true)).toBe("on");
    expect(choiceFromTenant(false)).toBe("off");
  });
});

describe("tenantSummary", () => {
  it("names the layer that decided, deriving the default from coord", () => {
    expect(
      tenantSummary({ tenant: null, effective: true, source: "default" })
    ).toEqual({ value: "On", tone: "on", from: "the default (on)" });
    expect(
      tenantSummary({ tenant: null, effective: false, source: "default" })
    ).toEqual({ value: "Off", tone: "off", from: "the default (off)" });
    expect(
      tenantSummary({ tenant: false, effective: false, source: "tenant" })
    ).toEqual({ value: "Off", tone: "off", from: "this tenant's setting" });
    expect(
      tenantSummary({ tenant: true, effective: false, source: "repo" })
    ).toEqual({
      value: "Off",
      tone: "off",
      from: "a repo's .qontinui/config.yml",
    });
  });

  it("renders unknown as treated-as-off", () => {
    expect(
      tenantSummary({ tenant: null, effective: false, source: "unknown" })
    ).toEqual({
      value: "Unknown (treated as off)",
      tone: "unknown",
      from: "coord could not read this preference",
    });
  });
});
