/**
 * Pins the blast-radius contract directly: the 200-body parser that stands
 * between backend `_BlastRadius` and the delete dialog, and the cause line a
 * failed PREVIEW read renders.
 *
 * `page.cognitoGroupDelete.test.tsx` already drives malformed verdicts through
 * the whole page. This suite is the cheap, direct pin on the pure module: a
 * parser that let a missing `*_total` through would fabricate the all-clear the
 * dialog exists to refuse.
 */

import { describe, expect, it } from "vitest";
import type { BlastRadiusVerdict } from "@/lib/api/operations/cognitoGroups";
import { blastRadiusReadCause, parseBlastRadiusVerdict } from "./blastRadius";

const FULL_VERDICT: BlastRadiusVerdict = {
  group_name: "qontinui-admins",
  mapped_total: 3,
  mapped_own_tenant: ["acme", "acme-labs"],
  mapped_other_tenant_rows: 1,
  mapped_unmaterialized_rows: 0,
  strands_total: 2,
  strands_own_tenant: ["acme"],
  strands_other_tenant_count: 1,
};

describe("parseBlastRadiusVerdict", () => {
  it("parses a full verdict into exactly its eight fields", () => {
    // An extra key on the wire is dropped, not carried into the verdict.
    expect(
      parseBlastRadiusVerdict({ ...FULL_VERDICT, unexpected: "extra" })
    ).toEqual(FULL_VERDICT);
  });

  it.each(["mapped_total", "strands_total"] as const)(
    "rejects a verdict missing %s",
    (field) => {
      const body: Record<string, unknown> = { ...FULL_VERDICT };
      delete body[field];
      expect(parseBlastRadiusVerdict(body)).toBeNull();
    }
  );

  it.each(["mapped_own_tenant", "strands_own_tenant"] as const)(
    "rejects a non-string slug in %s",
    (field) => {
      expect(
        parseBlastRadiusVerdict({ ...FULL_VERDICT, [field]: ["acme", 7] })
      ).toBeNull();
    }
  );
});

describe("blastRadiusReadCause", () => {
  it("maps mapping_check_unavailable to the code and coord's status", () => {
    const body = JSON.stringify({
      detail: {
        error: "mapping_check_unavailable",
        coord_status: 404,
        message: "Nothing was deleted.",
      },
    });
    expect(blastRadiusReadCause(body, 502)).toBe(
      "mapping_check_unavailable, coord answered 404"
    );
  });

  it("maps mapping_check_unreadable to the code and its reason", () => {
    // The production envelope: the dict detail spliced to the top level.
    const body = JSON.stringify({
      error: "mapping_check_unreadable",
      reason: "verdict names another group",
      message: "Nothing was deleted.",
    });
    expect(blastRadiusReadCause(body, 502)).toBe(
      "mapping_check_unreadable: verdict names another group"
    );
  });
});
