/**
 * The install dialog renders the served scan status of the selected version
 * (plan `2026-11-07-the-marketplace-shows-the-security-scan-the-api-serves`
 * Phase 2): "Security scan passed" appears for a served `passed` only, and a
 * `failed` or `unknown` version cannot be installed from it.
 *
 * Mutation: mapping `unknown` to the passed display in `scanDisplay` reds the
 * `unknown` rows and the version-list-failed case.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CodePackage,
  InstallStatus,
  PackageScanStatus,
  PackageVersion,
} from "@/types/code-packages";

type VersionsQuery = {
  data: PackageVersion[] | undefined;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

const state = vi.hoisted(() => ({
  versions: null as unknown as VersionsQuery,
}));

vi.mock("@/hooks/useCodePackages", () => ({
  usePackageVersions: () => state.versions,
}));

import { InstallDialog } from "./InstallDialog";

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

const pkg: CodePackage = {
  id: "7",
  slug: "data-extractor",
  name: "Data Extractor",
  description: "Extracts data",
  category: "data-processing",
  tags: [],
  author: { id: "a", username: "a", verified: false, staff: false },
  license: "MIT",
  visibility: "public",
  latest_version_number: "1.2.0",
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

function loaded(versions: PackageVersion[]): VersionsQuery {
  return {
    data: versions,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(async () => undefined),
  };
}

/** The progress the pages derive from the install status. */
function progressFor(installStatus: InstallStatus): number {
  return installStatus === "installing"
    ? 50
    : installStatus === "installed"
      ? 100
      : 0;
}

function renderDialog(error?: string, installStatus: InstallStatus = "idle") {
  return render(
    <InstallDialog
      open
      onOpenChange={() => {}}
      package={pkg}
      projects={[{ id: "p1", name: "Project" }]}
      onInstall={() => {}}
      installStatus={installStatus}
      installProgress={progressFor(installStatus)}
      error={error}
    />
  );
}

function installButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Install Package",
  }) as HTMLButtonElement;
}

function scanElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    '[data-ui-bridge-id="marketplace.scan-status"]'
  );
  if (!el) throw new Error("no scan status element");
  return el;
}

beforeEach(() => {
  state.versions = loaded([version("passed")]);
});

describe("InstallDialog scan status", () => {
  it.each([
    ["passed", true, false],
    ["pending", false, false],
    ["scanning", false, false],
    ["skipped", false, false],
    ["failed", false, true],
    ["unknown", false, true],
  ] as const)(
    "%s: passed text shown=%s, install blocked=%s",
    (status, showsPassed, blocked) => {
      state.versions = loaded([version(status)]);
      renderDialog();

      expect(scanElement().dataset.scanStatus).toBe(status);
      expect(screen.queryByText("Security scan passed") !== null).toBe(
        showsPassed
      );
      expect(screen.queryByText("No security issues detected") !== null).toBe(
        showsPassed
      );
      expect(installButton().disabled).toBe(blocked);
    }
  );

  it("a served unknown scan keeps its label and offers no retry", () => {
    state.versions = loaded([version("unknown")]);
    renderDialog();

    expect(scanElement().dataset.scanStatus).toBe("unknown");
    expect(screen.getByText("Scan status unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("passed with warnings lists them and does not read as a clean pass", () => {
    state.versions = loaded([version("passed", 2)]);
    renderDialog();

    expect(screen.getByText("Passed with 2 warnings")).toBeInTheDocument();
    expect(screen.getByText("warning 0")).toBeInTheDocument();
    expect(screen.queryByText("Security scan passed")).toBeNull();
    expect(screen.queryByText("No security issues detected")).toBeNull();
    expect(installButton().disabled).toBe(false);
  });

  it("a version list that failed to load reads unavailable, with a retry", () => {
    const refetch = vi.fn(async () => undefined);
    state.versions = {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      isFetching: false,
      refetch,
    };
    renderDialog();

    expect(scanElement().dataset.scanStatus).toBe("unknown");
    expect(screen.getByText("Scan status unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Security scan passed")).toBeNull();
    expect(installButton().disabled).toBe(true);
    screen.getByRole("button", { name: "Retry" }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("a failed background refetch keeps the cached list, with no error or retry", () => {
    state.versions = {
      ...loaded([version("passed")]),
      isError: true,
      isSuccess: false,
    };
    renderDialog();

    expect(scanElement().dataset.scanStatus).toBe("passed");
    expect(screen.getByText("Security scan passed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(installButton().disabled).toBe(false);
  });

  it("no published version disables install and shows no scan", () => {
    state.versions = loaded([]);
    renderDialog();

    expect(screen.getByText("No published version")).toBeInTheDocument();
    expect(
      document.querySelector('[data-ui-bridge-id="marketplace.scan-status"]')
    ).toBeNull();
    expect(installButton().disabled).toBe(true);
  });

  it("shows the install error it is given", () => {
    renderDialog("Package failed security scan", "failed");

    expect(
      screen.getByText("Package failed security scan")
    ).toBeInTheDocument();
  });
});
