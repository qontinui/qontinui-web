/**
 * Workflow Templates Marketplace API Service
 *
 * Provides methods for:
 * - Browsing and searching community templates
 * - Publishing templates to the marketplace
 * - Rating and reviewing templates
 * - Forking templates
 * - Managing user's templates
 */

import { csrfService } from "@/services/csrf-service";
import { authService } from "@/services/service-factory";
import type {
  TemplateCategory,
  MarketplaceTemplateDetail,
  TemplateListResponse,
  FeaturedTemplateResponse,
  PopularTemplateResponse,
  TrendingTemplateResponse,
  TemplateRatingWithUser,
  TemplateRatingCreate,
  TemplateForkCreate,
  TemplateCreateRequest,
  TemplateUpdateRequest,
  TemplateDownloadResponse,
  UserTemplatesResponse,
  TemplateMarketplaceStats,
  TemplateSortBy,
  TemplateSortOrder,
} from "@/types/workflow-templates";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Workflow Templates API Client
 */
class WorkflowTemplatesApiClient {
  private async fetchWithAuth(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    // Add CSRF token for state-changing requests
    const csrfToken = csrfService.getToken();
    if (
      csrfToken &&
      ["POST", "PUT", "DELETE", "PATCH"].includes(options.method || "GET")
    ) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    const response = await fetch(`${API_BASE_URL}/api/v1${url}`, {
      ...options,
      headers,
      credentials: "include",
    });

    // Handle 401 - try to refresh token
    if (response.status === 401) {
      const refreshed = await authService.refreshAccessToken();
      if (refreshed) {
        // Retry the request
        return fetch(`${API_BASE_URL}/api/v1${url}`, {
          ...options,
          headers,
          credentials: "include",
        });
      }
    }

    return response;
  }

  // ==========================================================================
  // Categories
  // ==========================================================================

  /**
   * Get all template categories
   */
  async getCategories(): Promise<TemplateCategory[]> {
    const response = await this.fetchWithAuth("/workflow-templates/categories");
    if (!response.ok) {
      throw new Error("Failed to get template categories");
    }
    return response.json();
  }

  // ==========================================================================
  // Browse & Search
  // ==========================================================================

  /**
   * Search and list published templates
   */
  async searchTemplates(params?: {
    query?: string;
    category_id?: number;
    tags?: string[];
    verified_only?: boolean;
    featured_only?: boolean;
    min_rating?: number;
    min_action_count?: number;
    max_action_count?: number;
    sort_by?: TemplateSortBy;
    sort_order?: TemplateSortOrder;
    limit?: number;
    offset?: number;
  }): Promise<TemplateListResponse> {
    const queryParams = new URLSearchParams();

    if (params?.query) queryParams.append("query", params.query);
    if (params?.category_id)
      queryParams.append("category_id", params.category_id.toString());
    if (params?.tags && params.tags.length > 0) {
      params.tags.forEach((tag) => queryParams.append("tags", tag));
    }
    if (params?.verified_only)
      queryParams.append("verified_only", params.verified_only.toString());
    if (params?.featured_only)
      queryParams.append("featured_only", params.featured_only.toString());
    if (params?.min_rating)
      queryParams.append("min_rating", params.min_rating.toString());
    if (params?.min_action_count)
      queryParams.append("min_action_count", params.min_action_count.toString());
    if (params?.max_action_count)
      queryParams.append("max_action_count", params.max_action_count.toString());
    if (params?.sort_by) queryParams.append("sort_by", params.sort_by);
    if (params?.sort_order) queryParams.append("sort_order", params.sort_order);
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    if (params?.offset) queryParams.append("offset", params.offset.toString());

    const url = `/workflow-templates/templates${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to search templates");
    }
    return response.json();
  }

  /**
   * Get featured templates
   */
  async getFeaturedTemplates(limit?: number): Promise<FeaturedTemplateResponse> {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.append("limit", limit.toString());

    const url = `/workflow-templates/templates/featured${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to get featured templates");
    }
    return response.json();
  }

  /**
   * Get popular templates
   */
  async getPopularTemplates(
    period?: "day" | "week" | "month" | "all",
    limit?: number
  ): Promise<PopularTemplateResponse> {
    const queryParams = new URLSearchParams();
    if (period) queryParams.append("period", period);
    if (limit) queryParams.append("limit", limit.toString());

    const url = `/workflow-templates/templates/popular${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to get popular templates");
    }
    return response.json();
  }

  /**
   * Get trending templates
   */
  async getTrendingTemplates(
    days?: number,
    limit?: number
  ): Promise<TrendingTemplateResponse> {
    const queryParams = new URLSearchParams();
    if (days) queryParams.append("days", days.toString());
    if (limit) queryParams.append("limit", limit.toString());

    const url = `/workflow-templates/templates/trending${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to get trending templates");
    }
    return response.json();
  }

  // ==========================================================================
  // Template Details
  // ==========================================================================

  /**
   * Get template by ID
   */
  async getTemplateById(id: number): Promise<MarketplaceTemplateDetail> {
    const response = await this.fetchWithAuth(`/workflow-templates/templates/${id}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      throw new Error("Failed to get template");
    }
    return response.json();
  }

  /**
   * Get template by slug
   */
  async getTemplateBySlug(slug: string): Promise<MarketplaceTemplateDetail> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/by-slug/${slug}`
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      throw new Error("Failed to get template");
    }
    return response.json();
  }

  // ==========================================================================
  // Create & Update Templates
  // ==========================================================================

  /**
   * Create a new template (as draft)
   */
  async createTemplate(
    data: TemplateCreateRequest
  ): Promise<MarketplaceTemplateDetail> {
    const response = await this.fetchWithAuth("/workflow-templates/templates", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to create template");
    }
    return response.json();
  }

  /**
   * Update a template (owner only)
   */
  async updateTemplate(
    id: number,
    data: TemplateUpdateRequest
  ): Promise<MarketplaceTemplateDetail> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("You can only update your own templates");
      }
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to update template");
    }
    return response.json();
  }

  /**
   * Delete a template (owner only)
   */
  async deleteTemplate(id: number): Promise<void> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("You can only delete your own templates");
      }
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      throw new Error("Failed to delete template");
    }
  }

  /**
   * Publish a draft template
   */
  async publishTemplate(id: number): Promise<MarketplaceTemplateDetail> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}/publish`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("You can only publish your own templates");
      }
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to publish template");
    }
    return response.json();
  }

  /**
   * Unpublish a template
   */
  async unpublishTemplate(id: number): Promise<MarketplaceTemplateDetail> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}/unpublish`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("You can only unpublish your own templates");
      }
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      throw new Error("Failed to unpublish template");
    }
    return response.json();
  }

  // ==========================================================================
  // Download & Fork
  // ==========================================================================

  /**
   * Download a template (increments download counter)
   */
  async downloadTemplate(id: number): Promise<TemplateDownloadResponse> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}/download`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      throw new Error("Failed to download template");
    }
    return response.json();
  }

  /**
   * Fork a template to user's account
   */
  async forkTemplate(
    id: number,
    data?: TemplateForkCreate
  ): Promise<MarketplaceTemplateDetail> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}/fork`,
      {
        method: "POST",
        body: JSON.stringify(data || {}),
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to fork template");
    }
    return response.json();
  }

  // ==========================================================================
  // Ratings
  // ==========================================================================

  /**
   * Get ratings for a template
   */
  async getTemplateRatings(
    id: number,
    params?: { limit?: number; offset?: number }
  ): Promise<{ ratings: TemplateRatingWithUser[]; total: number }> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    if (params?.offset) queryParams.append("offset", params.offset.toString());

    const url = `/workflow-templates/templates/${id}/ratings${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to get template ratings");
    }
    return response.json();
  }

  /**
   * Rate a template (create or update rating)
   */
  async rateTemplate(
    id: number,
    data: TemplateRatingCreate
  ): Promise<TemplateRatingWithUser> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}/ratings`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      if (response.status === 400) {
        throw new Error("Cannot rate your own template");
      }
      if (response.status === 404) {
        throw new Error("Template not found");
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to rate template");
    }
    return response.json();
  }

  /**
   * Delete user's rating for a template
   */
  async deleteRating(id: number): Promise<void> {
    const response = await this.fetchWithAuth(
      `/workflow-templates/templates/${id}/ratings`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Rating not found");
      }
      throw new Error("Failed to delete rating");
    }
  }

  // ==========================================================================
  // User Templates
  // ==========================================================================

  /**
   * Get current user's templates
   */
  async getMyTemplates(params?: {
    include_drafts?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<UserTemplatesResponse> {
    const queryParams = new URLSearchParams();
    if (params?.include_drafts !== undefined)
      queryParams.append("include_drafts", params.include_drafts.toString());
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    if (params?.offset) queryParams.append("offset", params.offset.toString());

    const url = `/workflow-templates/users/me/templates${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to get user templates");
    }
    return response.json();
  }

  // ==========================================================================
  // Marketplace Stats
  // ==========================================================================

  /**
   * Get marketplace statistics
   */
  async getMarketplaceStats(): Promise<TemplateMarketplaceStats> {
    const response = await this.fetchWithAuth("/workflow-templates/stats");
    if (!response.ok) {
      throw new Error("Failed to get marketplace stats");
    }
    return response.json();
  }
}

// Export singleton instance
export const workflowTemplatesApi = new WorkflowTemplatesApiClient();
