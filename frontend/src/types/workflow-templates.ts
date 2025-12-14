/**
 * TypeScript types for the Workflow Templates Marketplace
 *
 * Defines all data structures for browsing, publishing, and using
 * community workflow templates.
 */

import type { Workflow } from "@/lib/action-schema/action-types";

// ============================================================================
// Category Types
// ============================================================================

export type MarketplaceTemplateCategory =
  | "basic"
  | "control-flow"
  | "data-processing"
  | "automation"
  | "advanced";

export interface TemplateCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  display_order: number;
  created_at: string;
}

// ============================================================================
// Author Types
// ============================================================================

export interface TemplateAuthor {
  id: string;
  email: string;
  username: string | null;
}

// ============================================================================
// Template Types
// ============================================================================

export interface MarketplaceTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  long_description: string | null;
  author_id: string;
  category_id: number | null;
  action_count: number;
  tags: string[];
  license: string | null;
  is_published: boolean;
  is_featured: boolean;
  is_verified: boolean;
  total_downloads: number;
  total_forks: number;
  avg_rating: number | null;
  created_at: string;
  updated_at: string;
  category: TemplateCategory | null;
}

export interface MarketplaceTemplateDetail extends MarketplaceTemplate {
  workflow_json: Workflow;
  workflow_version: string | null;
  preview_svg: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  total_ratings: number;
}

export interface MarketplaceTemplateWithAuthor extends MarketplaceTemplate {
  author: TemplateAuthor | null;
}

// ============================================================================
// Search Types
// ============================================================================

export interface TemplateSearchFilters {
  query?: string;
  category_id?: number;
  tags?: string[];
  verified_only?: boolean;
  featured_only?: boolean;
  min_rating?: number;
  min_action_count?: number;
  max_action_count?: number;
}

export interface TemplateSearchResult {
  id: number;
  name: string;
  slug: string;
  description: string;
  author_id: string;
  category_id: number | null;
  category_name: string | null;
  category_icon: string | null;
  action_count: number;
  tags: string[];
  license: string | null;
  is_published: boolean;
  is_featured: boolean;
  is_verified: boolean;
  total_downloads: number;
  total_forks: number;
  avg_rating: number | null;
  preview_svg: string | null;
  created_at: string;
}

export interface TemplateListResponse {
  templates: TemplateSearchResult[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface FeaturedTemplateResponse {
  templates: TemplateSearchResult[];
}

export interface PopularTemplateResponse {
  templates: TemplateSearchResult[];
  period: "day" | "week" | "month" | "all";
}

export interface TrendingTemplateResponse {
  templates: TemplateSearchResult[];
  days: number;
}

// ============================================================================
// Rating Types
// ============================================================================

export interface TemplateRating {
  id: number;
  template_id: number;
  user_id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateRatingWithUser extends TemplateRating {
  user_email: string;
  user_username: string | null;
}

export interface TemplateRatingCreate {
  rating: number;
  review_text?: string;
}

// ============================================================================
// Fork Types
// ============================================================================

export interface TemplateFork {
  id: number;
  original_template_id: number | null;
  forked_template_id: number | null;
  forked_by_user_id: string;
  forked_at: string;
}

export interface TemplateForkCreate {
  new_name?: string;
}

// ============================================================================
// Create/Update Types
// ============================================================================

export interface TemplateCreateRequest {
  name: string;
  description: string;
  long_description?: string;
  category_id?: number;
  tags?: string[];
  license?: string;
  workflow_json: Workflow;
  preview_svg?: string;
}

export interface TemplateUpdateRequest {
  name?: string;
  description?: string;
  long_description?: string;
  category_id?: number;
  tags?: string[];
  license?: string;
  workflow_json?: Workflow;
  preview_svg?: string;
}

// ============================================================================
// Download Response
// ============================================================================

export interface TemplateDownloadResponse {
  id: number;
  name: string;
  workflow_json: Workflow;
  action_count: number;
  version: string | null;
  license: string | null;
}

// ============================================================================
// User Templates
// ============================================================================

export interface UserTemplateStats {
  published_templates: number;
  draft_templates: number;
  total_downloads: number;
  total_forks: number;
  total_ratings: number;
  average_rating: number | null;
}

export interface UserTemplatesResponse {
  templates: MarketplaceTemplate[];
  stats: UserTemplateStats;
}

// ============================================================================
// Marketplace Stats
// ============================================================================

export interface TemplateMarketplaceStats {
  total_templates: number;
  total_downloads: number;
  total_forks: number;
  verified_templates: number;
  featured_templates: number;
  categories_count: number;
}

// ============================================================================
// Sort Types
// ============================================================================

export type TemplateSortBy =
  | "downloads"
  | "rating"
  | "recent"
  | "name"
  | "forks"
  | "action_count";

export type TemplateSortOrder = "asc" | "desc";

// ============================================================================
// Helper Functions
// ============================================================================

export function getCategoryIcon(
  category: MarketplaceTemplateCategory | string
): string {
  const icons: Record<string, string> = {
    basic: "box",
    "control-flow": "git-branch",
    "data-processing": "database",
    automation: "zap",
    advanced: "settings",
  };
  return icons[category] || "box";
}

export function getCategoryLabel(
  category: MarketplaceTemplateCategory | string
): string {
  const labels: Record<string, string> = {
    basic: "Basic",
    "control-flow": "Control Flow",
    "data-processing": "Data Processing",
    automation: "Automation",
    advanced: "Advanced",
  };
  return labels[category] || category;
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

export function formatRating(rating: number | null): string {
  if (rating === null) return "—";
  return rating.toFixed(1);
}

export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}
