/**
 * The package sidebar renders the latest version's served scan status (plan
 * `2026-11-07-the-marketplace-shows-the-security-scan-the-api-serves`
 * Phase 2): "Security scan passed" appears for a served `passed` only.
 *
 * Mutation: mapping `unknown` to the passed display in `scanDisplay` reds the
 * `unknown` row.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  CodePackage,
  PackageScanStatus,
  PackageVersion,
} from "@/types/code-packages";

import { PackageSidebar } from "./PackageSidebar";

function version(status: PackageScanStatus, issues = 0): PackageVersion {
  return {
    id: "11",
    version: "1.2.0",
    package_id: "7",
    code: "",
    dependencies: [],
    created_at: "2026-11-02T12:00:00Z",
    downloads: 0,
    compatibility: {},
    security_scan: {
      status,
      issues: Array.from({ length: issues }, (_, i) => ({
        severity: "medium" as const,
        description: `warning ${i}`,
      })),
    },
  };
}

function pkg(latest: PackageVersion | null): CodePackage {
  return {
    id: "7",
    slug: "data-extractor",
    name: "Data Extractor",
    description: "Extracts data",
    category: "data-processing",
    tags: [],
    author: { id: "a", username: "a", verified: false, staff: false },
    license: "MIT",
    visibility: "public",
    latest_version: latest,
    latest_version_number: latest?.version ?? null,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    total_downloads: 0,
    weekly_downloads: 0,
    average_rating: 0,
    rating_count: 0,
    fork_count: 0,
    star_count: 0,
    verified: false,
    featured: false,
    deprecated: false,
    function_name: "run",
  };
}

function scanElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-ui-bridge-id="marketplace.scan-status"]'
  );
}

describe("PackageSidebar scan status", () => {
  it.each([
    ["passed", true],
    ["pending", false],
    ["scanning", false],
    ["skipped", false],
    ["failed", false],
    ["unknown", false],
  ] as const)("%s: passed text shown=%s", (status, showsPassed) => {
    render(
      <PackageSidebar pkg={pkg(version(status))} onRetryScan={() => {}} />
    );

    expect(scanElement()?.dataset.scanStatus).toBe(status);
    expect(screen.queryByText("Security scan passed") !== null).toBe(
      showsPassed
    );
    expect(screen.queryByText("No security issues detected") !== null).toBe(
      showsPassed
    );
  });

  it("unknown offers a retry that re-reads the package", () => {
    const onRetryScan = vi.fn();
    render(
      <PackageSidebar pkg={pkg(version("unknown"))} onRetryScan={onRetryScan} />
    );

    expect(screen.getByText("Scan status unavailable")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetryScan).toHaveBeenCalledTimes(1);
  });

  it("passed with warnings lists them and is not a clean pass", () => {
    render(
      <PackageSidebar pkg={pkg(version("passed", 1))} onRetryScan={() => {}} />
    );

    expect(screen.getByText("Passed with 1 warning")).toBeInTheDocument();
    expect(screen.getByText("warning 0")).toBeInTheDocument();
    expect(screen.queryByText("Security scan passed")).toBeNull();
  });

  it("no published version shows no scan", () => {
    render(<PackageSidebar pkg={pkg(null)} onRetryScan={() => {}} />);

    expect(scanElement()).toBeNull();
    expect(screen.getAllByText("No published version").length).toBeGreaterThan(
      0
    );
    expect(screen.queryByText("Security scan passed")).toBeNull();
  });
});
