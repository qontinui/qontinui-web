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
  ReportPackageRequest,
} from "@/types/code-packages";

/**
 * Backend API response types
 * These match the FastAPI Pydantic schemas
 */
interface BackendPackageSearchResult {
  id: number;
  name: string;
  slug: string;
  description: string;
  author_id: string;
  category_id: number;
  category_name: string | null;
  license: string;
  tags: string[];
  is_verified: boolean;
  total_downloads: number;
  avg_rating: number | null;
  latest_version: string | null;
  created_at: string;
}

interface BackendPackageListResponse {
  packages: BackendPackageSearchResult[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

interface BackendPackageDetailRead {
  id: number;
  name: string;
  slug: string;
  description: string;
  long_description: string | null;
  author_id: string;
  category_id: number;
  license: string;
  tags: string[];
  is_verified: boolean;
  total_downloads: number;
  avg_rating: number | null;
  created_at: string;
  updated_at: string;
  category: any;
  latest_version: any;
  total_versions: number;
  total_ratings: number;
}

interface BackendVersionRead {
  id: number;
  package_id: number;
  version: string;
  code_content: string;
  readme: string | null;
  changelog: string | null;
  security_scan_status: string;
  security_scan_result: any;
  created_at: string;
  downloads: number;
}

interface BackendInstallResponse {
  id: number;
  package_id: number;
  version_id: number;
  project_id: string;
  status: string;
  installed_at: string;
  package_name: string;
  package_version: string;
}

interface BackendInstalledPackageRead {
  id: number;
  package_id: number;
  version_id: number;
  package_name: string;
  package_slug: string;
  package_description: string;
  version: string;
  status: string;
  installed_at: string;
  updated_at: string;
}

interface BackendProjectPackagesResponse {
  packages: BackendInstalledPackageRead[];
  total: number;
}

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

interface BackendPopularPackageResponse {
  packages: BackendPackageSearchResult[];
  period: string;
}

/**
 * Service for managing code packages in the Community Code Marketplace
 */
export class CodePackageService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  /**
   * Search and filter packages
   */
  async searchPackages(filters?: SearchFilters): Promise<PackageSearchResult> {
    const params = new URLSearchParams();

    if (filters?.query) params.append("query", filters.query);
    if (filters?.category) params.append("category", filters.category);
    if (filters?.tags) filters.tags.forEach((tag) => params.append("tags", tag));
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
      `${this.apiUrl}/api/v1/marketplace/packages?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error("Failed to search packages");
    }

    const data: BackendPackageListResponse = await response.json();

    // Transform backend response to frontend format
    return {
      packages: data.packages.map(this.transformBackendPackageToFrontend),
      total: data.total,
      page,
      limit: data.limit,
      total_pages: Math.ceil(data.total / data.limit),
    };
  }

  /**
   * Get a single package by ID
   */
  async getPackage(id: string): Promise<CodePackage> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages/${id}`
    );

    if (!response.ok) {
      throw new Error("Package not found");
    }

    const data: BackendPackageDetailRead = await response.json();
    return this.transformBackendDetailToFrontend(data);
  }

  /**
   * Get popular packages
   */
  async getPopularPackages(): Promise<CodePackage[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages/popular`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch popular packages");
    }

    const data: BackendPopularPackageResponse = await response.json();
    return data.packages.map(this.transformBackendPackageToFrontend);
  }

  /**
   * Get packages published by the current user
   */
  async getMyPackages(): Promise<CodePackage[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/users/me/packages`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch user packages");
    }

    const data: BackendPackageSearchResult[] = await response.json();
    return data.map(this.transformBackendPackageToFrontend);
  }

  /**
   * Get packages installed in a specific project
   */
  async getInstalledPackages(projectId: string): Promise<PackageInstallation[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/projects/${projectId}/packages`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch installed packages");
    }

    const data: BackendProjectPackagesResponse = await response.json();
    return data.packages.map(this.transformBackendInstallationToFrontend);
  }

  /**
   * Create a new package
   */
  async createPackage(data: CreatePackageRequest): Promise<CodePackage> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages`,
      {
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
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to create package");
    }

    const backendData = await response.json();
    return this.transformBackendPackageToFrontend(backendData);
  }

  /**
   * Update an existing package
   */
  async updatePackage(
    id: string,
    data: UpdatePackageRequest
  ): Promise<CodePackage> {
    const updateData: any = {};

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
      `${this.apiUrl}/api/v1/marketplace/packages/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(updateData),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to update package");
    }

    const backendData = await response.json();
    return this.transformBackendPackageToFrontend(backendData);
  }

  /**
   * Publish a new version of a package
   */
  async publishVersion(
    packageId: string,
    data: PublishVersionRequest
  ): Promise<CodePackage> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages/${packageId}/versions`,
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
    return this.getPackage(packageId);
  }

  /**
   * Install a package to a project
   */
  async installPackage(
    data: InstallPackageRequest
  ): Promise<PackageInstallation> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages/${data.package_id}/install`,
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
  async uninstallPackage(
    packageId: string,
    projectId: string
  ): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages/${packageId}/uninstall`,
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
      `${this.apiUrl}/api/v1/marketplace/packages/${packageId}/ratings`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch ratings");
    }

    const data: BackendRatingWithUser[] = await response.json();
    return data.map(this.transformBackendRatingToFrontend);
  }

  /**
   * Rate a package
   */
  async ratePackage(data: RatePackageRequest): Promise<PackageRating> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages/${data.package_id}/ratings`,
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
  async reportPackage(data: ReportPackageRequest): Promise<void> {
    // Report endpoint not yet implemented in backend
    throw new Error("Report package endpoint not yet implemented");
  }

  /**
   * Delete a package
   */
  async deletePackage(id: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/marketplace/packages/${id}`,
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
      license: pkg.license as any,
      visibility: "public" as const,
      latest_version: {
        id: "0",
        version: pkg.latest_version || "0.0.0",
        package_id: pkg.id.toString(),
        code: "",
        dependencies: [],
        created_at: pkg.created_at,
        downloads: pkg.total_downloads,
        compatibility: {},
        security_scan: {
          scanned: true,
          passed: true,
        },
      },
      versions: [],
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
   * Transform backend package detail to frontend format
   */
  private transformBackendDetailToFrontend(
    pkg: BackendPackageDetailRead
  ): CodePackage {
    const basePackage = this.transformBackendPackageToFrontend({
      id: pkg.id,
      name: pkg.name,
      slug: pkg.slug,
      description: pkg.description,
      author_id: pkg.author_id,
      category_id: pkg.category_id,
      category_name: pkg.category?.name || null,
      license: pkg.license,
      tags: pkg.tags,
      is_verified: pkg.is_verified,
      total_downloads: pkg.total_downloads,
      avg_rating: pkg.avg_rating,
      latest_version: pkg.latest_version?.version || null,
      created_at: pkg.created_at,
    });

    return {
      ...basePackage,
      updated_at: pkg.updated_at,
      rating_count: pkg.total_ratings,
    };
  }

  /**
   * Transform backend installation to frontend format
   */
  private transformBackendInstallationToFrontend(
    installation: BackendInstalledPackageRead
  ): PackageInstallation {
    return {
      id: installation.id.toString(),
      package_id: installation.package_id.toString(),
      package: {
        id: installation.package_id.toString(),
        slug: installation.package_slug,
        name: installation.package_name,
        description: installation.package_description,
        category: "utilities",
        tags: [],
        author: {
          id: "",
          username: "",
          verified: false,
          staff: false,
        },
        license: "MIT",
        visibility: "public",
        latest_version: {
          id: installation.version_id.toString(),
          version: installation.version,
          package_id: installation.package_id.toString(),
          code: "",
          dependencies: [],
          created_at: installation.installed_at,
          downloads: 0,
          compatibility: {},
          security_scan: { scanned: true, passed: true },
        },
        versions: [],
        created_at: installation.installed_at,
        updated_at: installation.updated_at,
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
      },
      version_id: installation.version_id.toString(),
      version: {
        id: installation.version_id.toString(),
        version: installation.version,
        package_id: installation.package_id.toString(),
        code: "",
        dependencies: [],
        created_at: installation.installed_at,
        downloads: 0,
        compatibility: {},
        security_scan: { scanned: true, passed: true },
      },
      project_id: "",
      user_id: "",
      installed_at: installation.installed_at,
      enabled: installation.status === "installed",
    };
  }

  /**
   * Transform backend install response to frontend format
   */
  private transformBackendInstallResponseToFrontend(
    response: BackendInstallResponse
  ): PackageInstallation {
    return {
      id: response.id.toString(),
      package_id: response.package_id.toString(),
      package: {
        id: response.package_id.toString(),
        slug: "",
        name: response.package_name,
        description: "",
        category: "utilities",
        tags: [],
        author: { id: "", username: "", verified: false, staff: false },
        license: "MIT",
        visibility: "public",
        latest_version: {
          id: response.version_id.toString(),
          version: response.package_version,
          package_id: response.package_id.toString(),
          code: "",
          dependencies: [],
          created_at: response.installed_at,
          downloads: 0,
          compatibility: {},
          security_scan: { scanned: true, passed: true },
        },
        versions: [],
        created_at: response.installed_at,
        updated_at: response.installed_at,
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
      },
      version_id: response.version_id.toString(),
      version: {
        id: response.version_id.toString(),
        version: response.package_version,
        package_id: response.package_id.toString(),
        code: "",
        dependencies: [],
        created_at: response.installed_at,
        downloads: 0,
        compatibility: {},
        security_scan: { scanned: true, passed: true },
      },
      project_id: response.project_id,
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
  private mapCategoryIdToName(categoryId: number): any {
    const idToName: Record<number, string> = {
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
    return idToName[categoryId] || "other";
  }
}
