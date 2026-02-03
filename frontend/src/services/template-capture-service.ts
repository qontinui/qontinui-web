/**
 * Template Capture Service
 *
 * API client for the template capture system (click-to-template).
 * Handles candidate management, profile CRUD, and tuning operations.
 */

import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

// Types matching qontinui-schemas
export type CandidateStatus = "pending" | "approved" | "rejected" | "modified";
export type ElementType =
  | "button"
  | "icon"
  | "text"
  | "image"
  | "panel"
  | "menu"
  | "unknown";
export type DetectionStrategyType =
  | "contour"
  | "edge"
  | "color_segmentation"
  | "flood_fill"
  | "gradient";

export interface CandidateBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  strategy: DetectionStrategyType;
}

export interface TemplateCandidate {
  id: string;
  session_id: string;
  project_id?: string;
  click_x: number;
  click_y: number;
  click_button: string;
  timestamp: number;
  frame_number: number;
  primary_boundary: CandidateBoundingBox;
  alternative_boundaries?: CandidateBoundingBox[];
  detection_strategies?: DetectionStrategyType[];
  pixel_data_url?: string;
  thumbnail_url?: string;
  mask_url?: string;
  status: CandidateStatus;
  adjusted_boundary?: CandidateBoundingBox;
  confidence_score: number;
  element_type: ElementType;
  application_name?: string;
  created_at: string;
  reviewed_at?: string;
  // User-defined metadata
  user_metadata?: {
    state_hint?: string;
    name?: string;
  };
}

export interface TemplateCandidateCreate {
  session_id: string;
  project_id?: string;
  click_x: number;
  click_y: number;
  click_button?: string;
  timestamp: number;
  frame_number: number;
  primary_boundary: CandidateBoundingBox;
  alternative_boundaries?: CandidateBoundingBox[];
  detection_strategies?: DetectionStrategyType[];
  pixel_data_base64?: string;
  mask_base64?: string;
  confidence_score?: number;
  element_type?: ElementType;
  application_name?: string;
}

export interface TuningMetrics {
  samples_analyzed: number;
  avg_boundary_accuracy: number;
  strategy_success_rates: Record<string, number>;
  optimal_edge_thresholds: [number, number];
  optimal_color_tolerance: number;
  element_size_distribution: {
    min: [number, number];
    max: [number, number];
    avg: [number, number];
  };
}

export interface ApplicationProfile {
  id: string;
  name: string;
  inference_config: Record<string, unknown>;
  preferred_strategies?: DetectionStrategyType[];
  avg_element_size?: { width: number; height: number };
  common_color_ranges?: Array<{ lower: number[]; upper: number[] }>;
  edge_threshold_overrides?: [number, number];
  tuning_metrics?: TuningMetrics;
  success_rate: number;
  sample_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApplicationProfileCreate {
  name: string;
  inference_config?: Record<string, unknown>;
  preferred_strategies?: DetectionStrategyType[];
}

export interface CandidateListResponse {
  items: TemplateCandidate[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProfileListResponse {
  items: ApplicationProfile[];
  total: number;
}

export interface TuningResult {
  profile_name: string;
  metrics: TuningMetrics;
  recommended_strategies: DetectionStrategyType[];
  success: boolean;
  message?: string;
}

export interface ApproveRequest {
  adjusted_boundary?: CandidateBoundingBox;
}

export interface ImportToStateMachineRequest {
  state_id: string;
  name: string;
  similarity_threshold?: number;
}

// State machine generation types
export type GroupingMethod =
  | "state_hints"
  | "user_assignments"
  | "co_occurrence"
  | "single_state"
  | "one_per_template";

export interface ApprovedTemplateData {
  id: string;
  name?: string;
  state_hint?: string;
  element_type: ElementType;
  frame_number: number;
  pixel_data_base64: string;
  mask_base64?: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  click_x: number;
  click_y: number;
}

export interface GenerateStateMachineRequest {
  templates: ApprovedTemplateData[];
  grouping_method: GroupingMethod;
  grouping_config?: {
    user_assignments?: Record<string, string[]>;
    co_occurrence_threshold?: number;
    single_state_name?: string;
    video_path?: string;
    sample_interval?: number;
  };
  state_machine_name?: string;
  include_transitions?: boolean;
}

export interface StateImageDefResponse {
  id: string;
  name: string;
  pixel_data_base64: string;
  mask_base64?: string;
  bbox: { x: number; y: number; width: number; height: number };
  similarity_threshold: number;
}

export interface TransitionDefResponse {
  from_state_id: string;
  to_state_id: string;
  trigger_image_id?: string;
  action_type: string;
  action_params?: Record<string, unknown>;
}

export interface StateDefResponse {
  id: string;
  name: string;
  description?: string;
  is_initial: boolean;
  state_images: StateImageDefResponse[];
}

export interface StateMachineConfigResponse {
  name: string;
  version: string;
  states: StateDefResponse[];
  transitions: TransitionDefResponse[];
  initial_state_id: string;
}

export interface GenerateStateMachineResponse {
  config: StateMachineConfigResponse;
  grouping_result: {
    method: string;
    state_count: number;
    total_state_images: number;
    ungrouped_count: number;
    processing_time_ms: number;
  };
}

export class TemplateCaptureService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  // ============ Candidate Endpoints ============

  /**
   * Submit candidates from runner after capture session
   */
  async submitCandidates(
    candidates: TemplateCandidateCreate[]
  ): Promise<{ created_count: number }> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates`,
      {
        method: "POST",
        body: JSON.stringify(candidates),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to submit candidates");
    }

    return response.json();
  }

  /**
   * List candidates with optional filtering
   */
  async listCandidates(params?: {
    status?: CandidateStatus;
    session_id?: string;
    project_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<CandidateListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append("status", params.status);
    if (params?.session_id)
      searchParams.append("session_id", params.session_id);
    if (params?.project_id)
      searchParams.append("project_id", params.project_id);
    if (params?.limit) searchParams.append("limit", params.limit.toString());
    if (params?.offset) searchParams.append("offset", params.offset.toString());

    const queryString = searchParams.toString();
    const url = `${this.apiUrl}/api/v1/template-capture/candidates${queryString ? `?${queryString}` : ""}`;

    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to list candidates");
    }

    return response.json();
  }

  /**
   * Get a single candidate by ID
   */
  async getCandidate(id: string): Promise<TemplateCandidate> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates/${id}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to get candidate");
    }

    return response.json();
  }

  /**
   * Approve a candidate with optional boundary adjustment
   */
  async approveCandidate(
    id: string,
    request?: ApproveRequest
  ): Promise<TemplateCandidate> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates/${id}/approve`,
      {
        method: "PATCH",
        body: JSON.stringify(request || {}),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to approve candidate");
    }

    return response.json();
  }

  /**
   * Reject a candidate as false positive
   */
  async rejectCandidate(id: string): Promise<TemplateCandidate> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates/${id}/reject`,
      {
        method: "PATCH",
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to reject candidate");
    }

    return response.json();
  }

  /**
   * Delete a candidate
   */
  async deleteCandidate(id: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates/${id}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to delete candidate");
    }
  }

  /**
   * Import approved candidate as StateImage into state machine
   */
  async importToStateMachine(
    id: string,
    request: ImportToStateMachineRequest
  ): Promise<{ success: boolean; state_image_id?: string }> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates/${id}/import-to-state-machine`,
      {
        method: "POST",
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to import to state machine");
    }

    return response.json();
  }

  /**
   * Set state hint for a candidate (for grouping)
   */
  async setStateHint(
    id: string,
    stateHint: string
  ): Promise<TemplateCandidate> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates/${id}/state-hint`,
      {
        method: "PATCH",
        body: JSON.stringify({ state_hint: stateHint }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to set state hint");
    }

    return response.json();
  }

  /**
   * Set user-friendly name for a candidate
   */
  async setName(id: string, name: string): Promise<TemplateCandidate> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/candidates/${id}/name`,
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to set name");
    }

    return response.json();
  }

  /**
   * Export approved candidates as ApprovedTemplateData
   */
  async exportApproved(params?: {
    session_id?: string;
    project_id?: string;
  }): Promise<{ items: ApprovedTemplateData[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.session_id)
      searchParams.append("session_id", params.session_id);
    if (params?.project_id)
      searchParams.append("project_id", params.project_id);

    const queryString = searchParams.toString();
    const url = `${this.apiUrl}/api/v1/template-capture/candidates/approved/export${queryString ? `?${queryString}` : ""}`;

    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to export approved candidates");
    }

    return response.json();
  }

  // ============ Profile Endpoints ============

  /**
   * List all application profiles
   */
  async listProfiles(): Promise<ProfileListResponse> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/profiles`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to list profiles");
    }

    return response.json();
  }

  /**
   * Create a new application profile
   */
  async createProfile(
    profile: ApplicationProfileCreate
  ): Promise<ApplicationProfile> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/profiles`,
      {
        method: "POST",
        body: JSON.stringify(profile),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to create profile");
    }

    return response.json();
  }

  /**
   * Get a profile by name
   */
  async getProfile(name: string): Promise<ApplicationProfile> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/profiles/${encodeURIComponent(name)}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to get profile");
    }

    return response.json();
  }

  /**
   * Update a profile
   */
  async updateProfile(
    name: string,
    updates: Partial<ApplicationProfileCreate>
  ): Promise<ApplicationProfile> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/profiles/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to update profile");
    }

    return response.json();
  }

  /**
   * Delete a profile
   */
  async deleteProfile(name: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/profiles/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to delete profile");
    }
  }

  /**
   * Trigger auto-tuning for a profile
   */
  async tuneProfile(
    name: string,
    sampleImageUrls?: string[]
  ): Promise<TuningResult> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/template-capture/profiles/${encodeURIComponent(name)}/tune`,
      {
        method: "POST",
        body: JSON.stringify({ sample_image_urls: sampleImageUrls }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to tune profile");
    }

    return response.json();
  }

  // ============ Image URL Methods ============

  /**
   * Refresh image URLs for a candidate.
   * Use this when URLs have expired (presigned URLs typically expire after 1 hour).
   */
  async refreshImageUrls(
    id: string,
    expiration?: number
  ): Promise<{
    pixel_data_url: string | null;
    thumbnail_url: string | null;
    mask_url: string | null;
  }> {
    const params = new URLSearchParams();
    if (expiration) {
      params.append("expiration", expiration.toString());
    }

    const queryString = params.toString();
    const url = `${this.apiUrl}/api/v1/template-capture/candidates/${id}/image${queryString ? `?${queryString}` : ""}`;

    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to refresh image URLs");
    }

    return response.json();
  }

  /**
   * Get thumbnail URL for a candidate, refreshing if needed
   */
  getThumbnailUrl(candidate: TemplateCandidate): string {
    if (candidate.thumbnail_url) {
      return candidate.thumbnail_url;
    }
    if (candidate.pixel_data_url) {
      return candidate.pixel_data_url;
    }
    // Fallback to API endpoint that will return fresh URLs
    return `${this.apiUrl}/api/v1/template-capture/candidates/${candidate.id}/image`;
  }

  /**
   * Get full-size image URL for a candidate
   */
  getImageUrl(candidate: TemplateCandidate): string {
    if (candidate.pixel_data_url) {
      return candidate.pixel_data_url;
    }
    // Fallback to API endpoint that will return fresh URLs
    return `${this.apiUrl}/api/v1/template-capture/candidates/${candidate.id}/image`;
  }

  /**
   * Get mask image URL for a candidate
   */
  getMaskUrl(candidate: TemplateCandidate): string | null {
    return candidate.mask_url || null;
  }

  /**
   * Check if a URL appears to be expired based on URL parameters.
   * Presigned URLs contain expiration timestamps.
   */
  isUrlExpired(url: string | null | undefined): boolean {
    if (!url) return true;

    try {
      const urlObj = new URL(url);
      // Check for AWS S3 presigned URL expiration
      const expires = urlObj.searchParams.get("X-Amz-Expires");
      const date = urlObj.searchParams.get("X-Amz-Date");

      if (expires && date) {
        // Parse X-Amz-Date format: YYYYMMDDTHHMMSSZ
        const dateStr = date;
        const year = parseInt(dateStr.slice(0, 4));
        const month = parseInt(dateStr.slice(4, 6)) - 1;
        const day = parseInt(dateStr.slice(6, 8));
        const hour = parseInt(dateStr.slice(9, 11));
        const minute = parseInt(dateStr.slice(11, 13));
        const second = parseInt(dateStr.slice(13, 15));

        const signedAt = new Date(
          Date.UTC(year, month, day, hour, minute, second)
        );
        const expiresInSeconds = parseInt(expires);
        const expiresAt = new Date(
          signedAt.getTime() + expiresInSeconds * 1000
        );

        return new Date() > expiresAt;
      }

      // If we can't determine expiration, assume it's still valid
      return false;
    } catch {
      // If URL parsing fails, assume it might be expired
      return true;
    }
  }

  /**
   * Get image URL, refreshing if the current URL is expired
   */
  async getImageUrlWithRefresh(candidate: TemplateCandidate): Promise<string> {
    if (
      candidate.pixel_data_url &&
      !this.isUrlExpired(candidate.pixel_data_url)
    ) {
      return candidate.pixel_data_url;
    }

    // Refresh the URLs
    const urls = await this.refreshImageUrls(candidate.id);
    if (urls.pixel_data_url) {
      // Update the candidate object for future use
      candidate.pixel_data_url = urls.pixel_data_url;
      candidate.thumbnail_url = urls.thumbnail_url ?? undefined;
      candidate.mask_url = urls.mask_url ?? undefined;
      return urls.pixel_data_url;
    }

    // No URL available
    throw new Error("No image URL available for this candidate");
  }

  /**
   * Get thumbnail URL, refreshing if the current URL is expired
   */
  async getThumbnailUrlWithRefresh(
    candidate: TemplateCandidate
  ): Promise<string> {
    const thumbnailUrl = candidate.thumbnail_url || candidate.pixel_data_url;
    if (thumbnailUrl && !this.isUrlExpired(thumbnailUrl)) {
      return thumbnailUrl;
    }

    // Refresh the URLs
    const urls = await this.refreshImageUrls(candidate.id);
    if (urls.thumbnail_url) {
      candidate.thumbnail_url = urls.thumbnail_url;
      return urls.thumbnail_url;
    }
    if (urls.pixel_data_url) {
      candidate.pixel_data_url = urls.pixel_data_url;
      return urls.pixel_data_url;
    }

    throw new Error("No thumbnail URL available for this candidate");
  }

  /**
   * Get display name for a candidate (user-defined or generated)
   */
  getDisplayName(candidate: TemplateCandidate): string {
    if (candidate.user_metadata?.name) {
      return candidate.user_metadata.name;
    }
    return `${candidate.element_type}_${candidate.id.slice(0, 8)}`;
  }

  /**
   * Get state hint for a candidate
   */
  getStateHint(candidate: TemplateCandidate): string | null {
    return candidate.user_metadata?.state_hint || null;
  }

  /**
   * Get unique state hints from a list of candidates
   */
  getUniqueStateHints(candidates: TemplateCandidate[]): string[] {
    const hints = new Set<string>();
    for (const candidate of candidates) {
      const hint = candidate.user_metadata?.state_hint;
      if (hint) {
        hints.add(hint);
      }
    }
    return Array.from(hints).sort();
  }
}
