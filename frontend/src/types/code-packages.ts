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

/**
 * The scan statuses the API serves on a version
 * (`backend/app/models/code_package.py` `SecurityScanStatus`).
 */
export const SERVED_SCAN_STATUSES = [
  "pending",
  "scanning",
  "passed",
  "failed",
  "skipped",
] as const;

export type ServedScanStatus = (typeof SERVED_SCAN_STATUSES)[number];

/**
 * A version's scan status: one the API served, or `unknown` when the payload
 * carries no status (search results, installations, install responses) or a
 * status string outside the served five. `unknown` is never a pass.
 */
export type PackageScanStatus = ServedScanStatus | "unknown";

/**
 * Severities the scanner emits (`backend/app/services/security/models.py`
 * `IssueSeverity`), plus `unknown` for a served severity outside them.
 */
export type PackageScanIssueSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "unknown";

export interface PackageScanIssue {
  severity: PackageScanIssueSeverity;
  /** The served issue's `message`. */
  description: string;
  line_number?: number;
}

export interface PackageScan {
  status: PackageScanStatus;
  /** From `security_scan_result.issues`; empty when none were served. */
  issues: PackageScanIssue[];
  scanned_at?: string;
}

/** The scan of a version whose payload carries no scan at all. */
export const UNKNOWN_SCAN: PackageScan = { status: "unknown", issues: [] };

export function isServedScanStatus(value: string): value is ServedScanStatus {
  return (SERVED_SCAN_STATUSES as readonly string[]).includes(value);
}

export type ScanTone = "success" | "warning" | "danger" | "neutral";

export interface ScanDisplay {
  status: PackageScanStatus;
  label: string;
  /** A second line under the label, or null when the label says it all. */
  detail: string | null;
  tone: ScanTone;
  /** True when this version must not be installed on the client's word. */
  blocksInstall: boolean;
}

/**
 * The one decision of how a version's scan renders. Every marketplace surface
 * (`InstallDialog`, `PackageSidebar`, `PackageHeader`) renders from it, so
 * distinct states never share an indicator and only a served `passed` shows
 * "Security scan passed".
 *
 * `failed` and `unknown` block install: `failed` because the server refuses
 * it, `unknown` because nothing was observed. `pending`, `scanning` and
 * `skipped` do not, mirroring the server, which refuses only `failed`.
 */
export function scanDisplay(scan: PackageScan): ScanDisplay {
  switch (scan.status) {
    case "failed":
      return {
        status: "failed",
        label: "Security issues detected",
        detail: null,
        tone: "danger",
        blocksInstall: true,
      };
    case "passed": {
      const warnings = scan.issues.length;
      if (warnings === 0) {
        return {
          status: "passed",
          label: "Security scan passed",
          detail: "No security issues detected",
          tone: "success",
          blocksInstall: false,
        };
      }
      return {
        status: "passed",
        label: `Passed with ${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
        detail: null,
        tone: "warning",
        blocksInstall: false,
      };
    }
    case "pending":
      return {
        status: "pending",
        label: "Scan pending",
        detail: "The security scan has not run yet",
        tone: "neutral",
        blocksInstall: false,
      };
    case "scanning":
      return {
        status: "scanning",
        label: "Scan in progress",
        detail: null,
        tone: "neutral",
        blocksInstall: false,
      };
    case "skipped":
      return {
        status: "skipped",
        label: "Scan skipped",
        detail: "No security scan was run on this version",
        tone: "neutral",
        blocksInstall: false,
      };
    default:
      return {
        status: "unknown",
        label: "Scan status unavailable",
        detail: "The scan result could not be read",
        tone: "neutral",
        blocksInstall: true,
      };
  }
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
  security_scan: PackageScan;
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
  /**
   * The served latest version record. `null` when the API served the package
   * with no published version; absent when the payload carries no version
   * record (search results, installations). The version list is loaded
   * separately (`usePackageVersions`).
   */
  latest_version?: PackageVersion | null;
  /**
   * The latest version's number as served. `null` when the package has no
   * published version; absent when the payload does not say.
   */
  latest_version_number?: string | null;

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
  configuration?: Record<string, unknown>; // Custom config per installation
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
  configuration?: Record<string, unknown>;
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
