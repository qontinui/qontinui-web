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
      latest_version: { version: "1.2.0", package_id: "7" },
    });
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
