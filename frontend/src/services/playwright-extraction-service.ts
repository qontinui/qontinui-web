/**
 * Service for interacting with the Playwright State Collector API.
 *
 * This communicates with the qontinui-api (port 8001) web extraction endpoints.
 */

import type {
  PlaywrightExtractionJob,
  PlaywrightExtractionRequest,
  PlaywrightExtractedClickable,
  PlaywrightSkippedElement,
} from "@/types/extraction";

// Use qontinui-api URL (port 8001) for extraction
const QONTINUI_API_URL =
  process.env.NEXT_PUBLIC_QONTINUI_API_URL || "http://localhost:8001";

class PlaywrightExtractionService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${QONTINUI_API_URL}/api/web-extraction`;
  }

  /**
   * Start a full web extraction job with navigation and clicking.
   */
  async startExtraction(
    request: Partial<PlaywrightExtractionRequest>
  ): Promise<PlaywrightExtractionJob> {
    const response = await fetch(`${this.baseUrl}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: request.url,
        max_depth: request.max_depth ?? 2,
        max_elements_per_page: request.max_elements_per_page ?? 50,
        max_risk_level: request.max_risk_level ?? "safe",
        dry_run: request.dry_run ?? true,
        additional_blocked_keywords: request.additional_blocked_keywords ?? [],
        additional_safe_keywords: request.additional_safe_keywords ?? [],
        blocked_selectors: request.blocked_selectors ?? [],
        verify_extractions: request.verify_extractions ?? true,
        verification_threshold: request.verification_threshold ?? 0.85,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to start extraction" }));
      throw new Error(error.detail || "Failed to start extraction");
    }

    return response.json();
  }

  /**
   * Start a single-page extraction (no navigation/clicking).
   */
  async startSinglePageExtraction(
    url: string,
    options?: {
      maxElements?: number;
      verifyExtractions?: boolean;
      verificationThreshold?: number;
      additionalBlockedKeywords?: string[];
    }
  ): Promise<PlaywrightExtractionJob> {
    const response = await fetch(`${this.baseUrl}/single-page`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        max_elements: options?.maxElements ?? 100,
        verify_extractions: options?.verifyExtractions ?? true,
        verification_threshold: options?.verificationThreshold ?? 0.85,
        additional_blocked_keywords: options?.additionalBlockedKeywords ?? [],
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to start extraction" }));
      throw new Error(error.detail || "Failed to start extraction");
    }

    return response.json();
  }

  /**
   * Get the status of an extraction job.
   */
  async getJobStatus(jobId: string): Promise<PlaywrightExtractionJob> {
    const response = await fetch(`${this.baseUrl}/status/${jobId}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Job not found");
      }
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to get job status" }));
      throw new Error(error.detail || "Failed to get job status");
    }

    return response.json();
  }

  /**
   * Get extracted elements from a completed job.
   */
  async getExtractedElements(
    jobId: string,
    options?: {
      verifiedOnly?: boolean;
      minConfidence?: number;
      includeScreenshots?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<{
    elements: PlaywrightExtractedClickable[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const params = new URLSearchParams();
    if (options?.verifiedOnly) params.set("verified_only", "true");
    if (options?.minConfidence)
      params.set("min_confidence", String(options.minConfidence));
    if (options?.includeScreenshots) params.set("include_screenshots", "true");
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));

    const response = await fetch(
      `${this.baseUrl}/results/${jobId}/elements?${params}`
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to get elements" }));
      throw new Error(error.detail || "Failed to get elements");
    }

    return response.json();
  }

  /**
   * Get elements that were skipped due to safety rules.
   */
  async getSkippedElements(jobId: string): Promise<{
    skipped: PlaywrightSkippedElement[];
  }> {
    const response = await fetch(`${this.baseUrl}/results/${jobId}/skipped`);

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to get skipped elements" }));
      throw new Error(error.detail || "Failed to get skipped elements");
    }

    return response.json();
  }

  /**
   * Get extraction metrics.
   */
  async getMetrics(jobId: string): Promise<{
    metrics: Record<string, number>;
  }> {
    const response = await fetch(`${this.baseUrl}/results/${jobId}/metrics`);

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to get metrics" }));
      throw new Error(error.detail || "Failed to get metrics");
    }

    return response.json();
  }

  /**
   * Build State Machine states from extracted elements.
   */
  async buildStates(
    jobId: string,
    options?: {
      stateNamePrefix?: string;
      verifiedOnly?: boolean;
      minConfidence?: number;
    }
  ): Promise<{
    states: Array<{
      id: string;
      name: string;
      description: string;
      stateImages: Array<{
        id: string;
        name: string;
        searchRegion: { x: number; y: number; width: number; height: number };
        similarity: number;
      }>;
      stateLocations: Array<{
        id: string;
        name: string;
        x: number;
        y: number;
      }>;
    }>;
    total_states: number;
    total_elements: number;
    verification_stats: {
      verified: number;
      unverified: number;
    };
  }> {
    const params = new URLSearchParams();
    if (options?.stateNamePrefix)
      params.set("state_name_prefix", options.stateNamePrefix);
    if (options?.verifiedOnly !== undefined)
      params.set("verified_only", String(options.verifiedOnly));
    if (options?.minConfidence)
      params.set("min_confidence", String(options.minConfidence));

    const response = await fetch(
      `${this.baseUrl}/results/${jobId}/build-states?${params}`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to build states" }));
      throw new Error(error.detail || "Failed to build states");
    }

    return response.json();
  }

  /**
   * Delete a job and its results.
   */
  async deleteJob(jobId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to delete job" }));
      throw new Error(error.detail || "Failed to delete job");
    }
  }

  /**
   * List all extraction jobs.
   */
  async listJobs(options?: { status?: string; limit?: number }): Promise<{
    jobs: Array<{
      job_id: string;
      status: string;
      progress: { stage: string; percent: number } | null;
      url: string;
    }>;
    total: number;
  }> {
    const params = new URLSearchParams();
    if (options?.status) params.set("status", options.status);
    if (options?.limit) params.set("limit", String(options.limit));

    const response = await fetch(`${this.baseUrl}/jobs?${params}`);

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to list jobs" }));
      throw new Error(error.detail || "Failed to list jobs");
    }

    return response.json();
  }

  /**
   * Poll a job until it completes or fails.
   */
  async pollUntilComplete(
    jobId: string,
    options?: {
      interval?: number;
      timeout?: number;
      onProgress?: (job: PlaywrightExtractionJob) => void;
    }
  ): Promise<PlaywrightExtractionJob> {
    const interval = options?.interval ?? 2000;
    const timeout = options?.timeout ?? 300000; // 5 minutes
    const startTime = Date.now();

    while (true) {
      const job = await this.getJobStatus(jobId);

      if (options?.onProgress) {
        options.onProgress(job);
      }

      if (job.status === "completed" || job.status === "failed") {
        return job;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error("Polling timeout exceeded");
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

export const playwrightExtractionService = new PlaywrightExtractionService();
