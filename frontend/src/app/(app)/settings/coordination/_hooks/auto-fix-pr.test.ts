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
  // The shape the browser actually receives. The web proxy raises
  // HTTPException(detail=<coord body text>). The backend's error handler wraps
  // that as {error, message, timestamp, path}, and HttpClient throws
  // `PATCH <url> failed: <status> - <envelope text>`.
  const thrown = (status: number, coordBody: object) =>
    `PATCH /api/v1/operations/pr-merge/settings failed: ${status} - ${JSON.stringify(
      {
        error: "service_unavailable",
        message: JSON.stringify(coordBody),
        timestamp: 0,
        path: "/api/v1/operations/pr-merge/settings",
      }
    )}`;

  it("written: null (commit_unconfirmed) is UNCONFIRMED", () => {
    expect(
      isUnconfirmedWrite(
        thrown(503, {
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
        thrown(503, {
          error: "auto_fix_pr_column_unavailable",
          cause,
          written: false,
        })
      )
    ).toBe(false);
  });

  it("an explicit written: false or true is definite, whatever the cause text", () => {
    expect(
      isUnconfirmedWrite(
        thrown(503, { cause: "commit_unconfirmed", written: false })
      )
    ).toBe(false);
    expect(isUnconfirmedWrite(thrown(503, { written: true }))).toBe(false);
  });

  it("a timeout may have been processed: 504 and the client abort are UNCONFIRMED", () => {
    expect(
      isUnconfirmedWrite(
        'PATCH /api/v1/operations/pr-merge/settings failed: 504 - {"error":"gateway_timeout","message":"timeout waiting for coord"}'
      )
    ).toBe(true);
    expect(
      isUnconfirmedWrite(
        "Request timeout - backend may be starting up. Please try again."
      )
    ).toBe(true);
  });

  it("502 (coord unreachable, nothing sent) and unrelated errors are plain failures", () => {
    expect(
      isUnconfirmedWrite(
        'PATCH /api/v1/operations/pr-merge/settings failed: 502 - {"error":"bad_gateway","message":"coord is not reachable"}'
      )
    ).toBe(false);
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
