/**
 * `scanDisplay` is the one decision of how a package version's security scan
 * renders (plan `2026-11-07-the-marketplace-shows-the-security-scan-the-api-serves`
 * D3). Every state has its own label, and only a served `passed` with no
 * issues reads "Security scan passed".
 *
 * Mutation: mapping `unknown` (the `default` arm) to the passed display reds
 * the `unknown` and unrecognized-string cases.
 */

import { describe, expect, it } from "vitest";

import { scanDisplay, UNKNOWN_SCAN } from "./code-packages";
import type { PackageScan, PackageScanStatus } from "./code-packages";

function scan(status: PackageScanStatus, issues = 0): PackageScan {
  return {
    status,
    issues: Array.from({ length: issues }, (_, i) => ({
      severity: "medium" as const,
      description: `issue ${i}`,
    })),
  };
}

describe("scanDisplay", () => {
  it("passed with no issues", () => {
    expect(scanDisplay(scan("passed"))).toEqual({
      status: "passed",
      label: "Security scan passed",
      detail: "No security issues detected",
      tone: "success",
      blocksInstall: false,
    });
  });

  it("passed with issues is a pass with warnings, not a clean pass", () => {
    expect(scanDisplay(scan("passed", 2))).toEqual({
      status: "passed",
      label: "Passed with 2 warnings",
      detail: null,
      tone: "warning",
      blocksInstall: false,
    });
    expect(scanDisplay(scan("passed", 1)).label).toBe("Passed with 1 warning");
  });

  it("failed blocks install", () => {
    expect(scanDisplay(scan("failed", 1))).toEqual({
      status: "failed",
      label: "Security issues detected",
      detail: null,
      tone: "danger",
      blocksInstall: true,
    });
  });

  it("pending", () => {
    expect(scanDisplay(scan("pending"))).toEqual({
      status: "pending",
      label: "Scan pending",
      detail: "The security scan has not run yet",
      tone: "neutral",
      blocksInstall: false,
    });
  });

  it("scanning", () => {
    expect(scanDisplay(scan("scanning"))).toEqual({
      status: "scanning",
      label: "Scan in progress",
      detail: null,
      tone: "neutral",
      blocksInstall: false,
    });
  });

  it("skipped", () => {
    expect(scanDisplay(scan("skipped"))).toEqual({
      status: "skipped",
      label: "Scan skipped",
      detail: "No security scan was run on this version",
      tone: "neutral",
      blocksInstall: false,
    });
  });

  const UNAVAILABLE = {
    status: "unknown",
    label: "Scan status unavailable",
    detail: "The scan result could not be read",
    tone: "neutral",
    blocksInstall: true,
  } as const;

  it("unknown blocks install and is never a pass", () => {
    expect(scanDisplay(UNKNOWN_SCAN)).toEqual(UNAVAILABLE);
  });

  it("an unrecognized status string reads as unknown", () => {
    expect(
      scanDisplay({
        status: "quarantined" as PackageScanStatus,
        issues: [],
      })
    ).toEqual(UNAVAILABLE);
  });

  it("only a served passed shows the passed label", () => {
    const statuses: PackageScanStatus[] = [
      "pending",
      "scanning",
      "passed",
      "failed",
      "skipped",
      "unknown",
    ];
    expect(
      statuses.filter(
        (s) => scanDisplay(scan(s)).label === "Security scan passed"
      )
    ).toEqual(["passed"]);
  });
});
