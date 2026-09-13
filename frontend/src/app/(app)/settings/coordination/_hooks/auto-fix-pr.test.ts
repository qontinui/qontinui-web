import { describe, expect, it } from "vitest";
import {
  choiceFromTenant,
  effectiveSummary,
  readAutoFixPr,
  tenantFromChoice,
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

describe("effectiveSummary", () => {
  it("names the layer that decided", () => {
    expect(
      effectiveSummary({ tenant: null, effective: true, source: "default" })
    ).toEqual({ value: "On", tone: "on", from: "the default (on)" });
    expect(
      effectiveSummary({ tenant: false, effective: false, source: "tenant" })
    ).toEqual({ value: "Off", tone: "off", from: "this tenant's setting" });
    // Tenant On, but a repo's explicit false wins — coord says so via `repo`.
    expect(
      effectiveSummary({ tenant: true, effective: false, source: "repo" })
    ).toEqual({
      value: "Off",
      tone: "off",
      from: "a repo's .qontinui/config.yml",
    });
  });

  it("renders unknown as treated-as-off", () => {
    expect(
      effectiveSummary({ tenant: null, effective: false, source: "unknown" })
    ).toEqual({
      value: "Unknown (treated as off)",
      tone: "unknown",
      from: "coord could not read this preference",
    });
  });
});
