/**
 * `CodePackageService` reaches the served `/api/v1/code-packages` routes and
 * maps their bodies.
 *
 * Phase 1 of plan `2026-11-07-the-marketplace-shows-the-security-scan-the-api-serves`.
 * The service is driven through its public methods over a stub `HttpClient`
 * whose responses are bodies typed against the generated OpenAPI client, so a
 * backend schema change reds `type-check` here rather than drifting.
 *
 * Mutation: restoring an unbound `.map(this.transformBackendPackageToFrontend)`
 * makes `this` undefined inside the transform (it calls
 * `this.mapCategoryIdToName`), so `searchPackages` and `getPopularPackages`
 * reject and these cases red.
 *
 * Phase 2: the scan status each version carries is the one the API served.
 * `getPackage` and `getPackageVersions` read `security_scan_status` /
 * `security_scan_result` from `VersionRead`; payloads that carry no scan
 * (installations, install responses) read `unknown`.
 *
 * Mutation: restoring a `{ status: "passed" }` literal in `toPackageVersion`
 * reds the `failed` and `pending` cases below.
 */

import { describe, expect, it, vi } from "vitest";

import type { components } from "@/lib/api-client/generated-types";

import { ApiConfig } from "./api-config";
import { CodePackageService } from "./code-package-service";
import type { HttpClient } from "./http-client";

type PackageListResponse = components["schemas"]["PackageListResponse"];
type PackageSearchResult = components["schemas"]["PackageSearchResult"];
type PopularPackageResponse = components["schemas"]["PopularPackageResponse"];
type PackageDetailRead = components["schemas"]["PackageDetailRead"];
type VersionRead = components["schemas"]["VersionRead"];
type ProjectPackagesResponse = components["schemas"]["ProjectPackagesResponse"];
type InstallResponse = components["schemas"]["InstallResponse"];
type PackageRead = components["schemas"]["PackageRead"];

const PREFIX = `${ApiConfig.API_BASE_URL}/api/v1/code-packages`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubClient(body: unknown, status = 200) {
  const fetch = vi.fn(async () => jsonResponse(body, status));
  const client = { fetch } as unknown as HttpClient;
  return { fetch, service: new CodePackageService(client) };
}

const searchResult: PackageSearchResult = {
  id: 7,
  name: "Data Extractor",
  slug: "data-extractor",
  description: "Extracts data",
  author_id: "4f1c2a9e-0000-4000-8000-000000000001",
  category_id: 7,
  category_name: "Data Processing",
  license: "MIT",
  tags: ["extract", "csv"],
  is_verified: true,
  total_downloads: 42,
  avg_rating: 4.5,
  latest_version: "1.2.0",
  created_at: "2026-11-01T10:00:00Z",
};

describe("CodePackageService.searchPackages", () => {
  it("calls the served list route and maps every package", async () => {
    const served: PackageListResponse = {
      packages: [
        searchResult,
        { ...searchResult, id: 8, slug: "other", category_id: 2 },
      ],
      total: 2,
      limit: 20,
      offset: 0,
      has_more: false,
    };
    const { fetch, service } = stubClient(served);

    const result = await service.searchPackages({
      query: "extract",
      page: 1,
      limit: 20,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${PREFIX}/packages?query=extract&limit=20&offset=0`
    );
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.total_pages).toBe(1);
    expect(result.packages.map((p) => [p.id, p.slug, p.category])).toEqual([
      ["7", "data-extractor", "data-processing"],
      ["8", "other", "utilities"],
    ]);
    expect(result.packages[0]).toMatchObject({
      name: "Data Extractor",
      tags: ["extract", "csv"],
      verified: true,
      total_downloads: 42,
      average_rating: 4.5,
      latest_version_number: "1.2.0",
    });
    // A search result carries no version record, so none is made up.
    expect(result.packages[0].latest_version).toBeUndefined();
  });

  it("rejects when the route does not answer 2xx", async () => {
    const { service } = stubClient({ detail: "nope" }, 404);

    await expect(service.searchPackages()).rejects.toThrow(
      "Failed to search packages"
    );
  });
});

describe("CodePackageService.getPopularPackages", () => {
  it("calls the popular route and maps its packages", async () => {
    const served: PopularPackageResponse = {
      packages: [searchResult],
      period: "all",
    };
    const { fetch, service } = stubClient(served);

    const packages = await service.getPopularPackages();

    expect(fetch).toHaveBeenCalledWith(`${PREFIX}/packages/popular`);
    expect(packages.map((p) => p.slug)).toEqual(["data-extractor"]);
    expect(packages[0].category).toBe("data-processing");
  });
});

describe("CodePackageService.getPackage", () => {
  it("loads the package by its URL slug", async () => {
    const served: PackageDetailRead = {
      id: 7,
      name: "Data Extractor",
      slug: "data-extractor",
      description: "Extracts data",
      long_description: null,
      author_id: "4f1c2a9e-0000-4000-8000-000000000001",
      category_id: 7,
      license: "MIT",
      tags: [],
      is_verified: false,
      total_downloads: 0,
      avg_rating: null,
      created_at: "2026-11-01T10:00:00Z",
      updated_at: "2026-11-01T10:00:00Z",
      category: null,
      latest_version: null,
      total_versions: 0,
      total_ratings: 0,
    };
    const { fetch, service } = stubClient(served);

    const pkg = await service.getPackage("data-extractor");

    expect(fetch).toHaveBeenCalledWith(
      `${PREFIX}/packages/by-slug/data-extractor`
    );
    expect(pkg.slug).toBe("data-extractor");
    expect(pkg.id).toBe("7");
  });

  it("rejects on a 404 from the by-slug route", async () => {
    const { service } = stubClient({ detail: "Package not found" }, 404);

    await expect(service.getPackage("missing")).rejects.toThrow(
      "Package not found"
    );
  });
});

/**
 * A `SecurityScanResult` as the scanner's `model_dump()` stores it
 * (`backend/app/services/security/models.py`): WARNING status, which the
 * publishing service maps to a `passed` version.
 */
const warningScanResult: NonNullable<VersionRead["security_scan_result"]> = {
  status: "warning",
  issues: [
    {
      severity: "medium",
      issue_type: "file_operation",
      line_number: 3,
      column: 4,
      message: "File operation 'open' detected",
      code_snippet: "open('x')",
      suggestion: null,
    },
    {
      severity: "info",
      issue_type: "high_complexity",
      line_number: null,
      column: null,
      message: "Function is complex",
      code_snippet: null,
      suggestion: null,
    },
  ],
  risk_score: 30,
  recommendations: [],
  complexity_metrics: {},
  scanned_at: "2026-11-02T12:00:00Z",
};

function versionRead(overrides: Partial<VersionRead> = {}): VersionRead {
  return {
    id: 11,
    package_id: 7,
    version: "1.2.0",
    code_content: "def run():\n    return 1\n",
    function_name: "run",
    created_at: "2026-11-02T12:00:00Z",
    download_count: 5,
    changelog: "First release",
    dependencies: [{ name: "requests", version: ">=2.25.0" }],
    min_python_version: null,
    security_scan_status: "passed",
    security_scan_result: null,
    ...overrides,
  };
}

function detailRead(latest: VersionRead | null): PackageDetailRead {
  return {
    id: 7,
    name: "Data Extractor",
    slug: "data-extractor",
    description: "Extracts data",
    long_description: null,
    author_id: "4f1c2a9e-0000-4000-8000-000000000001",
    category_id: 7,
    license: "MIT",
    tags: [],
    is_verified: false,
    total_downloads: 0,
    avg_rating: null,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    category: null,
    latest_version: latest,
    total_versions: latest ? 1 : 0,
    total_ratings: 0,
  };
}

const SERVED = ["pending", "scanning", "passed", "failed", "skipped"] as const;

describe("CodePackageService.getPackage — the latest version's served scan", () => {
  it.each(SERVED)("%s maps through unchanged", async (status) => {
    const { service } = stubClient(
      detailRead(versionRead({ security_scan_status: status }))
    );

    const pkg = await service.getPackage("data-extractor");

    expect(pkg.latest_version?.security_scan.status).toBe(status);
    expect(pkg.latest_version?.security_scan.issues).toEqual([]);
  });

  it("builds latest_version from the served VersionRead", async () => {
    const { service } = stubClient(detailRead(versionRead()));

    const pkg = await service.getPackage("data-extractor");

    expect(pkg.latest_version).toEqual({
      id: "11",
      version: "1.2.0",
      package_id: "7",
      code: "def run():\n    return 1\n",
      changelog: "First release",
      dependencies: [
        {
          package_id: "requests",
          package_name: "requests",
          version_constraint: ">=2.25.0",
          optional: false,
        },
      ],
      created_at: "2026-11-02T12:00:00Z",
      downloads: 5,
      compatibility: {},
      security_scan: { status: "passed", issues: [] },
    });
    expect(pkg.latest_version_number).toBe("1.2.0");
  });

  it("an unrecognized status string reads unknown, never passed", async () => {
    const { service } = stubClient(
      detailRead(versionRead({ security_scan_status: "quarantined" }))
    );

    const pkg = await service.getPackage("data-extractor");

    expect(pkg.latest_version?.security_scan.status).toBe("unknown");
  });

  it("a WARNING scan result is passed with its issues listed", async () => {
    const { service } = stubClient(
      detailRead(
        versionRead({
          security_scan_status: "passed",
          security_scan_result: warningScanResult,
        })
      )
    );

    const pkg = await service.getPackage("data-extractor");

    expect(pkg.latest_version?.security_scan).toEqual({
      status: "passed",
      scanned_at: "2026-11-02T12:00:00Z",
      issues: [
        {
          severity: "medium",
          description: "File operation 'open' detected",
          line_number: 3,
        },
        { severity: "info", description: "Function is complex" },
      ],
    });
  });

  it("a null latest_version is no published version, not a made-up one", async () => {
    const { service } = stubClient(detailRead(null));

    const pkg = await service.getPackage("data-extractor");

    expect(pkg.latest_version).toBeNull();
    expect(pkg.latest_version_number).toBeNull();
  });
});

describe("CodePackageService.getPackageVersions", () => {
  it("calls the served versions route", async () => {
    const { fetch, service } = stubClient([] satisfies VersionRead[]);

    await service.getPackageVersions("7");

    expect(fetch).toHaveBeenCalledWith(`${PREFIX}/packages/7/versions`);
  });

  it("zero versions is an empty list", async () => {
    const { service } = stubClient([] satisfies VersionRead[]);

    expect(await service.getPackageVersions("7")).toEqual([]);
  });

  it("one version carries its served id and scan", async () => {
    const { service } = stubClient([
      versionRead({ id: 21, security_scan_status: "failed" }),
    ] satisfies VersionRead[]);

    const versions = await service.getPackageVersions("7");

    expect(versions.map((v) => [v.id, v.security_scan.status])).toEqual([
      ["21", "failed"],
    ]);
  });

  it("many versions keep the served order and each status", async () => {
    const served: VersionRead[] = [
      versionRead({
        id: 33,
        version: "1.3.0",
        security_scan_status: "pending",
      }),
      versionRead({
        id: 32,
        version: "1.2.0",
        security_scan_status: "passed",
        security_scan_result: warningScanResult,
      }),
      versionRead({ id: 31, version: "1.1.0", security_scan_status: "failed" }),
      versionRead({ id: 30, version: "1.0.0", security_scan_status: "bogus" }),
    ];
    const { service } = stubClient(served);

    const versions = await service.getPackageVersions("7");

    expect(
      versions.map((v) => [
        v.id,
        v.version,
        v.security_scan.status,
        v.security_scan.issues.length,
      ])
    ).toEqual([
      ["33", "1.3.0", "pending", 0],
      ["32", "1.2.0", "passed", 2],
      ["31", "1.1.0", "failed", 0],
      ["30", "1.0.0", "unknown", 0],
    ]);
  });

  it("rejects when the route does not answer 2xx", async () => {
    const { service } = stubClient({ detail: "nope" }, 500);

    await expect(service.getPackageVersions("7")).rejects.toThrow(
      "Failed to fetch package versions"
    );
  });
});

describe("payloads with no scan read unknown", () => {
  it("getInstalledPackages: the installed version's scan is unknown", async () => {
    const served: ProjectPackagesResponse = {
      packages: [
        {
          id: 1,
          package_id: 7,
          version_id: 11,
          package_name: "Data Extractor",
          package_slug: "data-extractor",
          package_description: "Extracts data",
          version: "1.2.0",
          status: "installed",
          installed_at: "2026-11-03T09:00:00Z",
          updated_at: "2026-11-03T09:00:00Z",
        },
      ],
      total: 1,
    };
    const { fetch, service } = stubClient(served);

    const [installation] = await service.getInstalledPackages("42");

    expect(fetch).toHaveBeenCalledWith(`${PREFIX}/projects/42/packages`);
    expect(installation.version).toMatchObject({
      id: "11",
      version: "1.2.0",
      security_scan: { status: "unknown", issues: [] },
    });
    expect(installation.package.latest_version).toBeUndefined();
    expect(installation.enabled).toBe(true);
    // The payload names no category, author, licence or download count, so
    // none is made up.
    expect(installation.package).not.toHaveProperty("category");
    expect(installation.package).not.toHaveProperty("author");
    expect(installation.package).not.toHaveProperty("total_downloads");
    expect(installation.package.license).toBeUndefined();
  });

  it("installPackage: the install response's scan is unknown", async () => {
    const served: InstallResponse = {
      id: 3,
      package_id: 7,
      version_id: 11,
      project_id: 42,
      status: "installed",
      installed_at: "2026-11-03T09:00:00Z",
      package_name: "Data Extractor",
      package_version: "1.2.0",
    };
    const { fetch, service } = stubClient(served);

    const installation = await service.installPackage({
      package_id: "7",
      version_id: "11",
      project_id: "42",
    });

    expect(fetch).toHaveBeenCalledWith(
      `${PREFIX}/packages/7/install`,
      expect.objectContaining({ method: "POST" })
    );
    expect(installation.version.security_scan).toEqual({
      status: "unknown",
      issues: [],
    });
    expect(installation.package.latest_version).toBeUndefined();
    expect(installation.project_id).toBe("42");
    expect(installation.package).not.toHaveProperty("category");
    expect(installation.package).not.toHaveProperty("author");
    expect(installation.package).not.toHaveProperty("total_downloads");
    expect(installation.package.license).toBeUndefined();
  });
});

/** The `PackageRead` the create and update routes serve. */
function packageRead(overrides: Partial<PackageRead> = {}): PackageRead {
  return {
    id: 9,
    name: "new-pkg",
    slug: "new-pkg",
    description: "A new package",
    author_id: "4f1c2a9e-0000-4000-8000-000000000001",
    category_id: 3,
    license: "Apache-2.0",
    tags: ["io"],
    is_verified: false,
    total_downloads: 0,
    avg_rating: null,
    created_at: "2026-11-04T10:00:00Z",
    updated_at: "2026-11-05T10:00:00Z",
    ...overrides,
  };
}

describe("create and update map the served PackageRead", () => {
  it("createPackage maps every served field and names no latest version", async () => {
    const { fetch, service } = stubClient(packageRead(), 201);

    const pkg = await service.createPackage({
      name: "new-pkg",
      description: "A new package",
      category: "integrations",
      tags: ["io"],
      license: "Apache-2.0",
      code: "",
      function_name: "run",
      visibility: "public",
    });

    expect(fetch).toHaveBeenCalledWith(
      `${PREFIX}/packages`,
      expect.objectContaining({ method: "POST" })
    );
    expect(pkg).toMatchObject({
      id: "9",
      slug: "new-pkg",
      category: "integrations",
      license: "Apache-2.0",
      tags: ["io"],
      created_at: "2026-11-04T10:00:00Z",
      updated_at: "2026-11-05T10:00:00Z",
    });
    // PackageRead carries no version, so neither "no published version"
    // (null) nor a made-up one is asserted.
    expect(pkg).not.toHaveProperty("latest_version");
    expect(pkg).not.toHaveProperty("latest_version_number");
  });

  it("updatePackage: no category_id leaves category absent, no licence stays absent", async () => {
    const served = packageRead({ license: null });
    delete served.category_id;
    const { fetch, service } = stubClient(served);

    const pkg = await service.updatePackage("9", { description: "changed" });

    expect(fetch).toHaveBeenCalledWith(
      `${PREFIX}/packages/9`,
      expect.objectContaining({ method: "PUT" })
    );
    expect(pkg).not.toHaveProperty("category");
    expect(pkg.license).toBeUndefined();
    expect(pkg).not.toHaveProperty("latest_version_number");
    expect(pkg.updated_at).toBe("2026-11-05T10:00:00Z");
  });
});
