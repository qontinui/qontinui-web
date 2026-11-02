import { describe, expect, it } from "vitest";
import { NO_CONNECTION_MESSAGE } from "@/services/http-client";
import {
  autoFixPrAbsence,
  choiceFromTenant,
  dialChoice,
  isUnconfirmedFailure,
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
    ).toEqual({
      tenant: true,
      effective: false,
      source: "unknown",
      offContract: true,
    });
  });

  it("reads a missing resolved bool as unknown, not as off-by-default", () => {
    expect(
      readAutoFixPr({ auto_fix_pr_tenant: null, auto_fix_pr_source: "default" })
    ).toEqual({
      tenant: null,
      effective: false,
      source: "unknown",
      offContract: true,
    });
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

describe("isUnconfirmedFailure", () => {
  // The shape the browser actually receives. The web proxy raises
  // HTTPException(detail=<coord body text>). The backend's error handler wraps
  // that as {error, message, timestamp, path}, and HttpClient throws
  // `PATCH <url> failed: <status> - <envelope text>`.
  const thrown = (status: number, coordBody: object) =>
    new Error(
      `PATCH /api/v1/operations/pr-merge/settings failed: ${status} - ${JSON.stringify(
        {
          error: "service_unavailable",
          message: JSON.stringify(coordBody),
          timestamp: 0,
          path: "/api/v1/operations/pr-merge/settings",
        }
      )}`
    );

  it("written: null (commit_unconfirmed) is UNCONFIRMED", () => {
    expect(
      isUnconfirmedFailure(
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
      isUnconfirmedFailure(
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
      isUnconfirmedFailure(
        thrown(503, { cause: "commit_unconfirmed", written: false })
      )
    ).toBe(false);
    expect(isUnconfirmedFailure(thrown(503, { written: true }))).toBe(false);
  });

  it("a timeout may have been processed: 504 and the client abort are UNCONFIRMED", () => {
    expect(
      isUnconfirmedFailure(
        new Error(
          'PATCH /api/v1/operations/pr-merge/settings failed: 504 - {"error":"gateway_timeout","message":"timeout waiting for coord"}'
        )
      )
    ).toBe(true);
    expect(
      isUnconfirmedFailure(
        new Error(
          "Request timeout - backend may be starting up. Please try again."
        )
      )
    ).toBe(true);
  });

  it("the proxy's own 502 (coord unreachable, nothing sent) and a 4xx are plain failures", () => {
    expect(
      isUnconfirmedFailure(
        new Error(
          'PATCH /api/v1/operations/pr-merge/settings failed: 502 - {"error":"bad_gateway","message":"coord is not reachable"}'
        )
      )
    ).toBe(false);
    expect(
      isUnconfirmedFailure(new Error("PATCH /x failed: 400 - unknown field"))
    ).toBe(false);
    expect(isUnconfirmedFailure(new Error("PUT /x failed: 403 - no"))).toBe(
      false
    );
  });

  it("a 5xx that proves nothing is UNCONFIRMED: 500, a 503 with no written field, any other 502", () => {
    expect(isUnconfirmedFailure(thrown(500, { error: "boom" }))).toBe(true);
    expect(isUnconfirmedFailure(thrown(503, { error: "busy" }))).toBe(true);
    expect(
      isUnconfirmedFailure(new Error("PUT /x failed: 502 - <html>bad</html>"))
    ).toBe(true);
    expect(isUnconfirmedFailure(thrown(502, { error: "upstream" }))).toBe(true);
  });

  it("reads a failure the server did not answer as unconfirmed: the request may have gone out", () => {
    expect(isUnconfirmedFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isUnconfirmedFailure(new Error("network down"))).toBe(true);
    // A 2xx whose body could not be parsed: answered, and not read.
    expect(isUnconfirmedFailure(new SyntaxError("Unexpected token <"))).toBe(
      true
    );
    expect(isUnconfirmedFailure("something else entirely")).toBe(true);
  });

  it("reads an offline browser as a refusal", () => {
    expect(isUnconfirmedFailure(new Error(NO_CONNECTION_MESSAGE))).toBe(false);
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

describe("dialChoice", () => {
  it("is the position coord's answer holds, and none while the source is unknown", () => {
    expect(
      dialChoice({ tenant: null, effective: true, source: "default" })
    ).toBe("default");
    expect(
      dialChoice({ tenant: false, effective: false, source: "tenant" })
    ).toBe("off");
    // `tenant: null` is "not readable" here, not "follow the default".
    expect(
      dialChoice({ tenant: null, effective: false, source: "unknown" })
    ).toBeNull();
    expect(dialChoice(null)).toBeNull();
  });
});

describe("autoFixPrAbsence", () => {
  it("tells a dial coord does not serve from one it served in another shape", () => {
    expect(autoFixPrAbsence(null)).toBe("no_profile");
    expect(autoFixPrAbsence({ auto_merge_enabled: true })).toBe("not_served");
    expect(
      autoFixPrAbsence({
        auto_fix_pr_tenant: "false",
        auto_fix_pr: false,
        auto_fix_pr_source: "tenant",
      })
    ).toBe("malformed");
  });
});

describe("tenantSummary", () => {
  it("names the layer that decided, deriving the default from coord", () => {
    expect(
      tenantSummary({ tenant: null, effective: true, source: "default" })
    ).toEqual({ value: "On", tone: "on", detail: "from the default (on)" });
    expect(
      tenantSummary({ tenant: null, effective: false, source: "default" })
    ).toEqual({ value: "Off", tone: "off", detail: "from the default (off)" });
    expect(
      tenantSummary({ tenant: false, effective: false, source: "tenant" })
    ).toEqual({
      value: "Off",
      tone: "off",
      detail: "from this tenant's setting",
    });
    expect(
      tenantSummary({ tenant: true, effective: false, source: "repo" })
    ).toEqual({
      value: "Off",
      tone: "off",
      detail: "from a repo's .qontinui/config.yml",
    });
  });

  it("renders coord's own unknown as Unknown, claiming nothing about how it is treated", () => {
    expect(
      tenantSummary({ tenant: null, effective: false, source: "unknown" })
    ).toEqual({
      value: "Unknown",
      tone: "unknown",
      detail: "coord could not read this preference",
    });
  });

  it("does not say coord could not read it when the unknown is this page's", () => {
    expect(
      tenantSummary({
        tenant: true,
        effective: false,
        source: "unknown",
        offContract: true,
      })
    ).toEqual({
      value: "Unknown",
      tone: "unknown",
      detail:
        "coord's answer for this preference is not one this page can read",
    });
  });
});
