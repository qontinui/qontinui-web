/**
 * TypeScript types for the Community Code Marketplace
 *
 * Defines all data structures for browsing, installing, and publishing
 * code packages created by the community.
 */

export type PackageCategory =
  | "automation"
  | "utilities"
  | "integrations"
  | "patterns"
  | "workflows"
  | "testing"
  | "data-processing"
  | "ai-ml"
  | "web-scraping"
  | "other";

export type PackageLicense =
  | "MIT"
  | "Apache-2.0"
  | "GPL-3.0"
  | "BSD-3-Clause"
  | "ISC"
  | "Creative Commons"
  | "Proprietary"
  | "Other";

export type InstallStatus =
  | "idle"
  | "installing"
  | "installed"
  | "failed"
  | "updating"
  | "uninstalling";

export type PackageVisibility = "public" | "private" | "unlisted";

export interface PackageAuthor {
  id: string;
  username: string;
  email?: string;
  avatar_url?: string;
  verified: boolean;
  staff: boolean;
}

export interface PackageDependency {
  package_id: string;
  package_name: string;
  version_constraint: string; // e.g., "^1.0.0", ">=2.0.0"
  optional: boolean;
}

export interface PackageVersion {
  id: string;
  version: string;
  package_id: string;
  code: string;
  readme?: string;
  changelog?: string;
  dependencies: PackageDependency[];
  created_at: string;
  downloads: number;
  compatibility: {
    min_qontinui_version?: string;
    max_qontinui_version?: string;
  };
  security_scan: {
    scanned: boolean;
    passed: boolean;
    issues?: Array<{
      severity: "low" | "medium" | "high" | "critical";
      description: string;
    }>;
    scanned_at?: string;
  };
}

export interface PackageRating {
  id: string;
  package_id: string;
  user_id: string;
  rating: number; // 1-5
  review?: string;
  created_at: string;
  updated_at: string;
  user: {
    username: string;
    avatar_url?: string;
  };
}

export interface CodePackage {
  id: string;
  slug: string; // URL-friendly identifier
  name: string;
  description: string;
  category: PackageCategory;
  tags: string[];
  author: PackageAuthor;
  license: PackageLicense;
  visibility: PackageVisibility;

  // Versions
  latest_version: PackageVersion;
  versions: PackageVersion[];

  // Metadata
  created_at: string;
  updated_at: string;
  published_at?: string;

  // Stats
  total_downloads: number;
  weekly_downloads: number;
  average_rating: number;
  rating_count: number;
  fork_count: number;
  star_count: number;

  // Flags
  verified: boolean; // Staff-approved
  featured: boolean;
  deprecated: boolean;
  deprecated_reason?: string;

  // Additional info
  repository_url?: string;
  homepage_url?: string;
  documentation_url?: string;
  demo_url?: string;
  screenshots?: string[];

  // Function metadata
  function_name: string;
  function_signature?: string;
  entry_point?: string;
}

export interface PackageInstallation {
  id: string;
  package_id: string;
  package: CodePackage;
  version_id: string;
  version: PackageVersion;
  project_id: string;
  user_id: string;
  installed_at: string;
  last_used_at?: string;
  enabled: boolean;
  configuration?: Record<string, any>; // Custom config per installation
}

export interface SearchFilters {
  query?: string;
  category?: PackageCategory;
  tags?: string[];
  verified_only?: boolean;
  min_rating?: number;
  license?: PackageLicense;
  sort_by?: "popular" | "recent" | "rating" | "name" | "downloads" | "updated";
  sort_order?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface PackageSearchResult {
  packages: CodePackage[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface CreatePackageRequest {
  name: string;
  description: string;
  category: PackageCategory;
  tags: string[];
  license: PackageLicense;
  code: string;
  readme?: string;
  function_name: string;
  dependencies?: PackageDependency[];
  repository_url?: string;
  homepage_url?: string;
  documentation_url?: string;
  visibility: PackageVisibility;
}

export interface UpdatePackageRequest {
  name?: string;
  description?: string;
  category?: PackageCategory;
  tags?: string[];
  license?: PackageLicense;
  repository_url?: string;
  homepage_url?: string;
  documentation_url?: string;
  visibility?: PackageVisibility;
  deprecated?: boolean;
  deprecated_reason?: string;
}

export interface PublishVersionRequest {
  version: string;
  code: string;
  readme?: string;
  changelog?: string;
  dependencies?: PackageDependency[];
}

export interface InstallPackageRequest {
  package_id: string;
  version_id?: string; // If not provided, uses latest
  project_id: string;
  configuration?: Record<string, any>;
}

export interface RatePackageRequest {
  package_id: string;
  rating: number; // 1-5
  review?: string;
}

export interface ReportPackageRequest {
  package_id: string;
  reason:
    | "malicious"
    | "copyright"
    | "spam"
    | "inappropriate"
    | "broken"
    | "other";
  description: string;
}

// Type guards
export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

export function isValidVersion(version: string): boolean {
  // Simple semver validation
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version);
}

// Helper functions
export function getCategoryIcon(category: PackageCategory): string {
  const icons: Record<PackageCategory, string> = {
    automation: "🤖",
    utilities: "🔧",
    integrations: "🔌",
    patterns: "🎨",
    workflows: "⚡",
    testing: "✅",
    "data-processing": "📊",
    "ai-ml": "🧠",
    "web-scraping": "🕷️",
    other: "📦",
  };
  return icons[category] || "📦";
}

export function getCategoryLabel(category: PackageCategory): string {
  const labels: Record<PackageCategory, string> = {
    automation: "Automation",
    utilities: "Utilities",
    integrations: "Integrations",
    patterns: "Patterns",
    workflows: "Workflows",
    testing: "Testing",
    "data-processing": "Data Processing",
    "ai-ml": "AI & ML",
    "web-scraping": "Web Scraping",
    other: "Other",
  };
  return labels[category] || "Other";
}

export function formatDownloads(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}
