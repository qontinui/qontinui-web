import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";
import type {
  CodePackage,
  SearchFilters,
  PackageSearchResult,
  PackageInstallation,
  PackageRating,
  CreatePackageRequest,
  UpdatePackageRequest,
  PublishVersionRequest,
  InstallPackageRequest,
  RatePackageRequest,
  PackageLicense,
  PackageCategory,
  PackageVersion,
  PackageScan,
  PackageScanIssue,
  PackageScanIssueSeverity,
} from "@/types/code-packages";
import { UNKNOWN_SCAN, isServedScanStatus } from "@/types/code-packages";
import type { components } from "@/lib/api-client/generated-types";

/**
 * The one served prefix for every code-package route. The backend mounts the
 * router at `/api/v1/code-packages` (`backend/app/api/v1/api.py`); no route is
 * served under `/api/v1/marketplace`.
 */
const CODE_PACKAGES = `${ApiConfig.API_BASE_URL}/api/v1/code-packages`;

/**
 * Backend API response types. The package, version and installation payloads
 * are the generated OpenAPI types, so a backend schema change is a type error
 * here rather than a silent drift.
 */
type Schemas = components["schemas"];
type BackendPackageSearchResult = Schemas["PackageSearchResult"];
type BackendPackageListResponse = Schemas["PackageListResponse"];
type BackendPopularPackageResponse = Schemas["PopularPackageResponse"];
type PackageRead = Schemas["PackageRead"];
type PackageDetailRead = Schemas["PackageDetailRead"];
type VersionRead = Schemas["VersionRead"];
type BackendInstallResponse = Schemas["InstallResponse"];
type BackendInstalledPackageRead = Schemas["InstalledPackageRead"];
type BackendProjectPackagesResponse = Schemas["ProjectPackagesResponse"];

interface BackendRatingRead {
  id: number;
  package_id: number;
  user_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  updated_at: string;
}

interface BackendRatingWithUser extends BackendRatingRead {
  user_email: string;
  user_username: string;
}

/**
 * Service for managing code packages in the Community Code Marketplace
 */
export class CodePackageService {
  private httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Search and filter packages
   */
  async searchPackages(filters?: SearchFilters): Promise<PackageSearchResult> {
    const params = new URLSearchParams();

    if (filters?.query) params.append("query", filters.query);
    if (filters?.category) params.append("category", filters.category);
    if (filters?.tags)
      filters.tags.forEach((tag) => params.append("tags", tag));
    if (filters?.verified_only) params.append("verified_only", "true");
    if (filters?.min_rating !== undefined)
      params.append("min_rating", filters.min_rating.toString());
    if (filters?.limit) params.append("limit", filters.limit.toString());

    // Calculate offset from page and limit
    const limit = filters?.limit || 20;
    const page = filters?.page || 1;
    const offset = (page - 1) * limit;
    params.append("offset", offset.toString());

    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error("Failed to search packages");
    }

    const data: BackendPackageListResponse = await response.json();

    // Transform backend response to frontend format
    return {
      packages: data.packages.map((p) =>
        this.transformBackendPackageToFrontend(p)
      ),
      total: data.total,
      page,
      limit: data.limit,
      total_pages: Math.ceil(data.total / data.limit),
    };
  }

  /**
   * Get a single package by its URL slug (the `/marketplace/[slug]` route)
   */
  async getPackage(slug: string): Promise<CodePackage> {
    return this.fetchPackageDetail(
      `${CODE_PACKAGES}/packages/by-slug/${encodeURIComponent(slug)}`
    );
  }

  /**
   * Get a single package by its numeric ID
   */
  private async getPackageById(id: string): Promise<CodePackage> {
    return this.fetchPackageDetail(
      `${CODE_PACKAGES}/packages/${encodeURIComponent(id)}`
    );
  }

  private async fetchPackageDetail(url: string): Promise<CodePackage> {
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Package not found");
    }

    const data: PackageDetailRead = await response.json();
    return this.transformBackendDetailToFrontend(data);
  }

  /**
   * Get every published version of a package, newest first, each with the
   * security scan status the API served for it
   */
  async getPackageVersions(packageId: string): Promise<PackageVersion[]> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${encodeURIComponent(packageId)}/versions`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch package versions");
    }

    const data: VersionRead[] = await response.json();
    return data.map((v) => toPackageVersion(v));
  }

  /**
   * Get popular packages
   */
  async getPopularPackages(): Promise<CodePackage[]> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/popular`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch popular packages");
    }

    const data: BackendPopularPackageResponse = await response.json();
    return data.packages.map((p) => this.transformBackendPackageToFrontend(p));
  }

  /**
   * Get packages published by the current user
   */
  async getMyPackages(): Promise<CodePackage[]> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/users/me/packages`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch user packages");
    }

    const data: BackendPackageSearchResult[] = await response.json();
    return data.map((p) => this.transformBackendPackageToFrontend(p));
  }

  /**
   * Get packages installed in a specific project
   */
  async getInstalledPackages(
    projectId: string
  ): Promise<PackageInstallation[]> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/projects/${projectId}/packages`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch installed packages");
    }

    const data: BackendProjectPackagesResponse = await response.json();
    return data.packages.map((i) =>
      this.transformBackendInstallationToFrontend(i)
    );
  }

  /**
   * Create a new package
   */
  async createPackage(data: CreatePackageRequest): Promise<CodePackage> {
    const response = await this.httpClient.fetch(`${CODE_PACKAGES}/packages`, {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        description: data.description,
        category_id: this.getCategoryId(data.category),
        tags: data.tags,
        license: data.license,
        visibility: data.visibility,
        repository_url: data.repository_url,
        homepage_url: data.homepage_url,
        documentation_url: data.documentation_url,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to create package");
    }

    const backendData: PackageRead = await response.json();
    return this.transformPackageReadToFrontend(backendData);
  }

  /**
   * Update an existing package
   */
  async updatePackage(
    id: string,
    data: UpdatePackageRequest
  ): Promise<CodePackage> {
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.category !== undefined)
      updateData.category_id = this.getCategoryId(data.category);
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.license !== undefined) updateData.license = data.license;
    if (data.visibility !== undefined) updateData.visibility = data.visibility;
    if (data.repository_url !== undefined)
      updateData.repository_url = data.repository_url;
    if (data.homepage_url !== undefined)
      updateData.homepage_url = data.homepage_url;
    if (data.documentation_url !== undefined)
      updateData.documentation_url = data.documentation_url;
    if (data.deprecated !== undefined) updateData.deprecated = data.deprecated;
    if (data.deprecated_reason !== undefined)
      updateData.deprecated_reason = data.deprecated_reason;

    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(updateData),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to update package");
    }

    const backendData: PackageRead = await response.json();
    return this.transformPackageReadToFrontend(backendData);
  }

  /**
   * Publish a new version of a package
   */
  async publishVersion(
    packageId: string,
    data: PublishVersionRequest
  ): Promise<CodePackage> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${packageId}/versions`,
      {
        method: "POST",
        body: JSON.stringify({
          version: data.version,
          code_content: data.code,
          readme: data.readme,
          changelog: data.changelog,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to publish version");
    }

    // After publishing version, fetch the updated package
    return this.getPackageById(packageId);
  }

  /**
   * Install a package to a project
   */
  async installPackage(
    data: InstallPackageRequest
  ): Promise<PackageInstallation> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${data.package_id}/install`,
      {
        method: "POST",
        body: JSON.stringify({
          package_id: data.project_id, // API expects project_id here (naming issue in backend)
          version_id: data.version_id,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to install package");
    }

    const backendData: BackendInstallResponse = await response.json();
    return this.transformBackendInstallResponseToFrontend(backendData);
  }

  /**
   * Uninstall a package from a project
   */
  async uninstallPackage(packageId: string, projectId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${packageId}/uninstall`,
      {
        method: "POST",
        body: JSON.stringify({
          package_id: projectId, // API expects project_id here (naming issue in backend)
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to uninstall package");
    }
  }

  /**
   * Get ratings for a package
   */
  async getRatings(packageId: string): Promise<PackageRating[]> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${packageId}/ratings`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch ratings");
    }

    const data: BackendRatingWithUser[] = await response.json();
    return data.map((r) => this.transformBackendRatingToFrontend(r));
  }

  /**
   * Rate a package
   */
  async ratePackage(data: RatePackageRequest): Promise<PackageRating> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${data.package_id}/ratings`,
      {
        method: "POST",
        body: JSON.stringify({
          rating: data.rating,
          review_text: data.review,
        }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to rate package");
    }

    const backendData: BackendRatingRead = await response.json();
    return this.transformBackendRatingToFrontend(backendData);
  }

  /**
   * Report a package for violations
   */
  async reportPackage(): Promise<void> {
    // Report endpoint not yet implemented in backend
    throw new Error("Report package endpoint not yet implemented");
  }

  /**
   * Delete a package
   */
  async deletePackage(id: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${CODE_PACKAGES}/packages/${id}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to delete package");
    }
  }

  /**
   * Transform backend package search result to frontend format
   */
  private transformBackendPackageToFrontend(
    pkg: BackendPackageSearchResult
  ): CodePackage {
    return {
      id: pkg.id.toString(),
      slug: pkg.slug,
      name: pkg.name,
      description: pkg.description,
      category: this.mapCategoryIdToName(pkg.category_id),
      tags: pkg.tags || [],
      author: {
        id: pkg.author_id,
        username: "Unknown", // Not provided in search results
        verified: pkg.is_verified,
        staff: false,
      },
      ...(pkg.license ? { license: pkg.license as PackageLicense } : {}),
      visibility: "public" as const,
      // A search result names the latest version but carries no version
      // record, so `latest_version` is left absent rather than made up.
      latest_version_number: pkg.latest_version,
      created_at: pkg.created_at,
      updated_at: pkg.created_at,
      total_downloads: pkg.total_downloads,
      weekly_downloads: 0,
      average_rating: pkg.avg_rating || 0,
      rating_count: 0,
      fork_count: 0,
      star_count: 0,
      verified: pkg.is_verified,
      featured: false,
      deprecated: false,
      function_name: "",
    };
  }

  /**
   * Transform the `PackageRead` the create and update routes serve. It names
   * no latest version, so `latest_version` and `latest_version_number` stay
   * absent and any scan read from it is `unknown`.
   */
  private transformPackageReadToFrontend(pkg: PackageRead): CodePackage {
    const basePackage = this.transformBackendPackageToFrontend({
      id: pkg.id,
      name: pkg.name,
      slug: pkg.slug,
      description: pkg.description,
      author_id: pkg.author_id,
      category_id: pkg.category_id ?? null,
      category_name: pkg.category?.name ?? null,
      license: pkg.license ?? null,
      tags: pkg.tags ?? [],
      is_verified: pkg.is_verified,
      total_downloads: pkg.total_downloads,
      avg_rating: pkg.avg_rating,
      latest_version: null,
      created_at: pkg.created_at,
    });
    // `null` would read "no published version"; the payload does not say.
    delete basePackage.latest_version_number;
    return { ...basePackage, updated_at: pkg.updated_at };
  }

  /**
   * Transform backend package detail to frontend format
   */
  private transformBackendDetailToFrontend(
    pkg: PackageDetailRead
  ): CodePackage {
    const latest = pkg.latest_version ?? null;
    const basePackage = this.transformBackendPackageToFrontend({
      id: pkg.id,
      name: pkg.name,
      slug: pkg.slug,
      description: pkg.description,
      author_id: pkg.author_id,
      category_id: pkg.category_id ?? null,
      category_name: pkg.category?.name ?? null,
      license: pkg.license ?? null,
      tags: pkg.tags ?? [],
      is_verified: pkg.is_verified,
      total_downloads: pkg.total_downloads,
      avg_rating: pkg.avg_rating,
      latest_version: latest?.version ?? null,
      created_at: pkg.created_at,
    });

    return {
      ...basePackage,
      latest_version: latest ? toPackageVersion(latest) : null,
      updated_at: pkg.updated_at,
      rating_count: pkg.total_ratings,
    };
  }

  /**
   * Transform backend installation to frontend format. An installation names
   * the installed version but carries no scan for it, so its scan is
   * `unknown`, and it carries no latest-version record for the package.
   */
  private transformBackendInstallationToFrontend(
    installation: BackendInstalledPackageRead
  ): PackageInstallation {
    const version = unscannedVersion({
      id: installation.version_id,
      version: installation.version,
      package_id: installation.package_id,
      created_at: installation.installed_at,
    });
    return {
      id: installation.id.toString(),
      package_id: installation.package_id.toString(),
      package: installedPackageShell(installation.package_id, {
        slug: installation.package_slug,
        name: installation.package_name,
        description: installation.package_description,
        created_at: installation.installed_at,
        updated_at: installation.updated_at,
      }),
      version_id: installation.version_id.toString(),
      version,
      project_id: "",
      user_id: "",
      installed_at: installation.installed_at,
      enabled: installation.status === "installed",
    };
  }

  /**
   * Transform backend install response to frontend format. Like an
   * installation, it carries no scan, so the installed version's scan is
   * `unknown`.
   */
  private transformBackendInstallResponseToFrontend(
    response: BackendInstallResponse
  ): PackageInstallation {
    const version = unscannedVersion({
      id: response.version_id,
      version: response.package_version,
      package_id: response.package_id,
      created_at: response.installed_at,
    });
    return {
      id: response.id.toString(),
      package_id: response.package_id.toString(),
      package: installedPackageShell(response.package_id, {
        slug: "",
        name: response.package_name,
        description: "",
        created_at: response.installed_at,
        updated_at: response.installed_at,
      }),
      version_id: response.version_id.toString(),
      version,
      project_id: String(response.project_id),
      user_id: "",
      installed_at: response.installed_at,
      enabled: response.status === "installed",
    };
  }

  /**
   * Transform backend rating to frontend format
   */
  private transformBackendRatingToFrontend(
    rating: BackendRatingRead | BackendRatingWithUser
  ): PackageRating {
    const userInfo =
      "user_username" in rating
        ? {
            username: rating.user_username,
            avatar_url: undefined,
          }
        : {
            username: "Unknown",
            avatar_url: undefined,
          };

    return {
      id: rating.id.toString(),
      package_id: rating.package_id.toString(),
      user_id: rating.user_id,
      rating: rating.rating,
      review: rating.review_text || undefined,
      created_at: rating.created_at,
      updated_at: rating.updated_at,
      user: userInfo,
    };
  }

  /**
   * Map category name to ID (temporary until backend provides proper mapping)
   */
  private getCategoryId(category: string): number {
    const categoryMap: Record<string, number> = {
      automation: 1,
      utilities: 2,
      integrations: 3,
      patterns: 4,
      workflows: 5,
      testing: 6,
      "data-processing": 7,
      "ai-ml": 8,
      "web-scraping": 9,
      other: 10,
    };
    return categoryMap[category] || 10;
  }

  /**
   * Map category ID to name
   */
  private mapCategoryIdToName(categoryId: number | null): PackageCategory {
    const idToName: Record<number, PackageCategory> = {
      1: "automation",
      2: "utilities",
      3: "integrations",
      4: "patterns",
      5: "workflows",
      6: "testing",
      7: "data-processing",
      8: "ai-ml",
      9: "web-scraping",
      10: "other",
    };
    return (categoryId !== null && idToName[categoryId]) || "other";
  }
}

/**
 * Read a served version's scan. Each of the five served statuses passes
 * through unchanged; a status string outside them reads `unknown`, never a
 * pass. Issues come from `security_scan_result.issues` (the scanner's
 * `SecurityScanResult`, `backend/app/services/security/models.py`).
 */
function readPackageScan(
  status: string,
  result: VersionRead["security_scan_result"]
): PackageScan {
  const scan: PackageScan = {
    status: isServedScanStatus(status) ? status : "unknown",
    issues: readScanIssues(result?.issues),
  };
  if (typeof result?.scanned_at === "string") {
    scan.scanned_at = result.scanned_at;
  }
  return scan;
}

const ISSUE_SEVERITIES: readonly PackageScanIssueSeverity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];

function readScanIssues(raw: unknown): PackageScanIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map((item) => {
      const severity = ISSUE_SEVERITIES.find((s) => s === item.severity);
      const issue: PackageScanIssue = {
        severity: severity ?? "unknown",
        description: typeof item.message === "string" ? item.message : "",
      };
      if (typeof item.line_number === "number") {
        issue.line_number = item.line_number;
      }
      return issue;
    });
}

/** Build a frontend version from a served `VersionRead`. */
function toPackageVersion(v: VersionRead): PackageVersion {
  const version: PackageVersion = {
    id: String(v.id),
    version: v.version,
    package_id: String(v.package_id),
    code: v.code_content,
    dependencies: (v.dependencies ?? []).map((dep) => ({
      package_id: dep.name ?? "",
      package_name: dep.name ?? "",
      version_constraint: dep.version ?? "",
      optional: false,
    })),
    created_at: v.created_at,
    downloads: v.download_count,
    compatibility: {},
    security_scan: readPackageScan(
      v.security_scan_status,
      v.security_scan_result
    ),
  };
  if (v.changelog) version.changelog = v.changelog;
  return version;
}

/**
 * A version named by an installation payload, which serves its id and number
 * but no code, downloads or scan — so the scan is `unknown`.
 */
function unscannedVersion(fields: {
  id: number;
  version: string;
  package_id: number;
  created_at: string;
}): PackageVersion {
  return {
    id: String(fields.id),
    version: fields.version,
    package_id: String(fields.package_id),
    code: "",
    dependencies: [],
    created_at: fields.created_at,
    downloads: 0,
    compatibility: {},
    security_scan: { ...UNKNOWN_SCAN, issues: [] },
  };
}

/**
 * The package an installation payload names. It carries no latest-version
 * record, so `latest_version` and `latest_version_number` stay absent; no
 * category, so it reads `other`; and no licence, so `license` stays absent.
 */
function installedPackageShell(
  packageId: number,
  fields: {
    slug: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
  }
): CodePackage {
  return {
    id: String(packageId),
    slug: fields.slug,
    name: fields.name,
    description: fields.description,
    category: "other",
    tags: [],
    author: { id: "", username: "", verified: false, staff: false },
    visibility: "public",
    created_at: fields.created_at,
    updated_at: fields.updated_at,
    total_downloads: 0,
    weekly_downloads: 0,
    average_rating: 0,
    rating_count: 0,
    fork_count: 0,
    star_count: 0,
    verified: false,
    featured: false,
    deprecated: false,
    function_name: "",
  };
}
