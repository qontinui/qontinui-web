/**
 * Unified Extraction Service
 *
 * Single service for managing all extraction operations:
 * - Vision extraction (Edge, SAM3, OCR)
 * - Playwright extraction (interactive web crawling)
 * - Pattern matching (template matching)
 * - Web extraction (full page extraction)
 *
 * Features:
 * - Unified job management across all extraction types
 * - Session-based job isolation (multi-user support)
 * - Consistent status tracking and progress reporting
 * - HTTP polling with WebSocket upgrade when available
 */

import type {
  ExtractionMethod,
  ExtractionStatus,
  UnifiedElement,
  UnifiedExtractionJob,
  UnifiedExtractionProgress,
  UnifiedExtractionRequest,
  UnifiedExtractionResult,
} from "@/types/unified-extraction";
import { runnerClient } from "@/lib/runner-client";

// Default runner URL
const RUNNER_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";

// ============================================================================
// Session Management
// ============================================================================

/**
 * Generate a unique session ID for this client.
 * Persists across page reloads but unique per browser tab.
 */
function getOrCreateSessionId(): string {
  const SESSION_KEY = "qontinui_extraction_session_id";

  // Check sessionStorage first (tab-specific)
  let sessionId = sessionStorage.getItem(SESSION_KEY);

  if (!sessionId) {
    // Generate a new session ID
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  return sessionId;
}

// ============================================================================
// Result Converters
// ============================================================================

/**
 * Convert vision extraction results to unified format.
 */
function convertVisionResults(data: Record<string, unknown>): UnifiedElement[] {
  const elements: UnifiedElement[] = [];

  // Convert edge results
  const edgeResults = (data.edge_results as unknown[]) || [];
  for (const result of edgeResults) {
    const r = result as Record<string, unknown>;
    const bbox = (r.bbox as Record<string, number>) || {};
    elements.push({
      id: r.id as string,
      bbox: {
        x: bbox.x ?? 0,
        y: bbox.y ?? 0,
        width: bbox.width ?? 0,
        height: bbox.height ?? 0,
      },
      confidence: (r.confidence as number) || 0,
      detectionMethod: "edge",
      contourArea: r.contour_area as number,
      vertexCount: r.vertex_count as number,
      aspectRatio: r.aspect_ratio as number,
    });
  }

  // Convert SAM3 results
  const sam3Results = (data.sam3_results as unknown[]) || [];
  for (const result of sam3Results) {
    const r = result as Record<string, unknown>;
    const bbox = (r.bbox as Record<string, number>) || {};
    elements.push({
      id: r.id as string,
      bbox: {
        x: bbox.x ?? 0,
        y: bbox.y ?? 0,
        width: bbox.width ?? 0,
        height: bbox.height ?? 0,
      },
      confidence: (r.confidence as number) || 0,
      detectionMethod: "sam3",
      maskArea: r.mask_area as number,
      stabilityScore: r.stability_score as number,
      predictedIou: r.predicted_iou as number,
    });
  }

  // Convert OCR results
  const ocrResults = (data.ocr_results as unknown[]) || [];
  for (const result of ocrResults) {
    const r = result as Record<string, unknown>;
    const bbox = (r.bbox as Record<string, number>) || {};
    elements.push({
      id: r.id as string,
      bbox: {
        x: bbox.x ?? 0,
        y: bbox.y ?? 0,
        width: bbox.width ?? 0,
        height: bbox.height ?? 0,
      },
      confidence: (r.confidence as number) || 0,
      detectionMethod: "ocr",
      text: r.text as string,
      language: r.language as string,
      category: "text",
    });
  }

  // Convert merged candidates (these are the deduplicated results)
  const mergedCandidates = (data.merged_candidates as unknown[]) || [];
  for (const result of mergedCandidates) {
    const r = result as Record<string, unknown>;
    const bbox = (r.bbox as Record<string, number>) || {};
    elements.push({
      id: r.id as string,
      bbox: {
        x: bbox.x ?? 0,
        y: bbox.y ?? 0,
        width: bbox.width ?? 0,
        height: bbox.height ?? 0,
      },
      confidence: (r.confidence as number) || 0,
      detectionMethod: (r.detection_technique as string) || "vision",
      category: r.category as string,
      text: r.text as string | undefined,
      isInteractive: r.is_clickable as boolean,
    });
  }

  return elements;
}

/**
 * Convert Playwright results to unified format.
 */
function convertPlaywrightResults(
  data: Record<string, unknown>
): UnifiedElement[] {
  const elements: UnifiedElement[] = [];

  const clickables = (data.clickables as unknown[]) || [];
  for (const result of clickables) {
    const r = result as Record<string, unknown>;
    const bbox = r.bounding_box as Record<string, number>;

    elements.push({
      id: r.element_id as string,
      bbox: {
        x: bbox?.x || 0,
        y: bbox?.y || 0,
        width: bbox?.width || 0,
        height: bbox?.height || 0,
      },
      confidence: (r.verification_confidence as number) || (r.verified ? 0.9 : 0.5),
      detectionMethod: "playwright",
      selector: r.selector as string,
      tagName: r.tag_name as string,
      text: r.text as string | undefined,
      ariaLabel: r.aria_label as string | undefined,
      riskLevel: r.risk_level as "safe" | "caution" | "dangerous" | "blocked",
      riskReason: r.risk_reason as string,
      wasClicked: r.was_clicked as boolean,
      verified: r.verified as boolean,
      verificationConfidence: r.verification_confidence as number,
      isInteractive: true,
      screenshot: r.screenshot as string | undefined,
    });
  }

  return elements;
}

/**
 * Convert pattern matching results to unified format.
 */
function convertPatternResults(data: Record<string, unknown>): UnifiedElement[] {
  const elements: UnifiedElement[] = [];

  const matches = (data.matches as unknown[]) || [];
  for (let i = 0; i < matches.length; i++) {
    const r = matches[i] as Record<string, number>;
    elements.push({
      id: `pattern_match_${i}`,
      bbox: {
        x: r.x ?? 0,
        y: r.y ?? 0,
        width: r.width ?? 0,
        height: r.height ?? 0,
      },
      confidence: r.similarity ?? 0,
      detectionMethod: "pattern",
      similarity: r.similarity ?? 0,
      center: {
        x: r.center_x ?? 0,
        y: r.center_y ?? 0,
      },
    });
  }

  return elements;
}

// ============================================================================
// Unified Extraction Service
// ============================================================================

class UnifiedExtractionService {
  private baseUrl: string;
  private sessionId: string;
  private activeJobs: Map<string, UnifiedExtractionJob> = new Map();
  private progressCallbacks: Map<
    string,
    ((progress: UnifiedExtractionProgress) => void)[]
  > = new Map();

  constructor(baseUrl: string = RUNNER_URL) {
    this.baseUrl = baseUrl;
    this.sessionId = getOrCreateSessionId();
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set a custom session ID (useful for testing or multi-tenant scenarios).
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  // ============================================================================
  // Job Management
  // ============================================================================

  /**
   * Start an extraction job using the unified interface.
   */
  async startExtraction(
    request: UnifiedExtractionRequest
  ): Promise<UnifiedExtractionResult> {
    const startTime = Date.now();

    // Add session ID to request
    const requestWithSession = {
      ...request,
      sessionId: request.sessionId || this.sessionId,
    };

    try {
      let result: UnifiedExtractionResult;

      switch (request.method) {
        case "vision":
          result = await this.runVisionExtraction(requestWithSession);
          break;
        case "playwright":
          result = await this.runPlaywrightExtraction(requestWithSession);
          break;
        case "pattern":
          result = await this.runPatternExtraction(requestWithSession);
          break;
        case "web":
          result = await this.runWebExtraction(requestWithSession);
          break;
        default:
          throw new Error(`Unknown extraction method: ${request.method}`);
      }

      // Calculate duration if not set
      if (!result.durationMs) {
        result.durationMs = Date.now() - startTime;
      }

      return result;
    } catch (error) {
      return {
        jobId: `error_${Date.now()}`,
        method: request.method,
        status: "failed",
        techniquesRun: [],
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        elements: [],
        error: error instanceof Error ? error.message : "Unknown error",
        sessionId: requestWithSession.sessionId,
      };
    }
  }

  /**
   * Get the status of a running job.
   */
  async getJobStatus(jobId: string): Promise<UnifiedExtractionJob | null> {
    // Check local cache first
    const cached = this.activeJobs.get(jobId);
    if (cached) {
      return cached;
    }

    // Try to fetch from runner
    try {
      const response = await fetch(
        `${this.baseUrl}/extraction/status/${jobId}`,
        {
          headers: {
            "X-Session-ID": this.sessionId,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return this.convertToUnifiedJob(data);
    } catch {
      return null;
    }
  }

  /**
   * Get the results of a completed job.
   */
  async getJobResults(jobId: string): Promise<UnifiedExtractionResult | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/extraction/results/${jobId}`,
        {
          headers: {
            "X-Session-ID": this.sessionId,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return this.convertToUnifiedResult(data);
    } catch {
      return null;
    }
  }

  /**
   * Cancel a running job.
   */
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/extraction/cancel/${jobId}`, {
        method: "POST",
        headers: {
          "X-Session-ID": this.sessionId,
        },
      });

      if (response.ok) {
        this.activeJobs.delete(jobId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List all jobs for the current session.
   */
  async listJobs(options?: {
    status?: ExtractionStatus;
    method?: ExtractionMethod;
    limit?: number;
  }): Promise<UnifiedExtractionJob[]> {
    try {
      const params = new URLSearchParams();
      params.set("session_id", this.sessionId);
      if (options?.status) params.set("status", options.status);
      if (options?.method) params.set("method", options.method);
      if (options?.limit) params.set("limit", options.limit.toString());

      const response = await fetch(
        `${this.baseUrl}/extraction/jobs?${params.toString()}`,
        {
          headers: {
            "X-Session-ID": this.sessionId,
          },
        }
      );

      if (!response.ok) {
        return Array.from(this.activeJobs.values());
      }

      const data = await response.json();
      return (data.jobs || []).map((job: unknown) =>
        this.convertToUnifiedJob(job as Record<string, unknown>)
      );
    } catch {
      return Array.from(this.activeJobs.values());
    }
  }

  // ============================================================================
  // Progress Tracking
  // ============================================================================

  /**
   * Subscribe to progress updates for a job.
   */
  onProgress(
    jobId: string,
    callback: (progress: UnifiedExtractionProgress) => void
  ): () => void {
    const callbacks = this.progressCallbacks.get(jobId) || [];
    callbacks.push(callback);
    this.progressCallbacks.set(jobId, callbacks);

    // Return unsubscribe function
    return () => {
      const current = this.progressCallbacks.get(jobId) || [];
      const index = current.indexOf(callback);
      if (index > -1) {
        current.splice(index, 1);
        if (current.length === 0) {
          this.progressCallbacks.delete(jobId);
        }
      }
    };
  }

  /**
   * Emit progress to all subscribers.
   */
  private emitProgress(progress: UnifiedExtractionProgress): void {
    const callbacks = this.progressCallbacks.get(progress.jobId) || [];
    for (const callback of callbacks) {
      try {
        callback(progress);
      } catch (error) {
        console.error("Progress callback error:", error);
      }
    }
  }

  // ============================================================================
  // Extraction Method Implementations
  // ============================================================================

  private async runVisionExtraction(
    request: UnifiedExtractionRequest
  ): Promise<UnifiedExtractionResult> {
    if (!request.screenshot) {
      throw new Error("Screenshot is required for vision extraction");
    }

    const jobId = `vision_${Date.now()}`;
    const startedAt = new Date().toISOString();

    // Build request body
    const body: Record<string, unknown> = {
      screenshot: request.screenshot,
      session_id: request.sessionId,
      techniques: request.techniques || ["edge", "sam3", "ocr"],
    };

    if (request.edgeParams) {
      body.canny_low = request.edgeParams.cannyLow;
      body.canny_high = request.edgeParams.cannyHigh;
      body.min_contour_area = request.edgeParams.minContourArea;
    }

    if (request.sam3Params) {
      body.points_per_side = request.sam3Params.pointsPerSide;
      body.pred_iou_thresh = request.sam3Params.predIouThresh;
      body.stability_score_thresh = request.sam3Params.stabilityScoreThresh;
    }

    if (request.ocrParams) {
      body.ocr_engine = request.ocrParams.engine;
      body.ocr_languages = request.ocrParams.languages;
    }

    if (request.confidence) {
      body.iou_threshold = request.confidence;
    }

    const response = await fetch(`${this.baseUrl}/vision-extraction/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": request.sessionId || this.sessionId,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision extraction failed: ${errorText}`);
    }

    const data = await response.json();
    const resultData = data.data || data;

    const elements = convertVisionResults(resultData);

    return {
      jobId,
      method: "vision",
      status: "completed",
      techniquesRun: resultData.techniques_run || [],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: resultData.processing_time_ms,
      imageWidth: resultData.image_width,
      imageHeight: resultData.image_height,
      elements,
      rawResults: {
        edge: resultData.edge_results,
        sam3: resultData.sam3_results,
        ocr: resultData.ocr_results,
      },
      overlays: {
        edge: resultData.edge_overlay,
        sam3: resultData.sam3_overlay,
        ocr: resultData.ocr_overlay,
      },
      metrics: {
        totalFound: elements.length,
        byTechnique: {
          edge: (resultData.edge_results || []).length,
          sam3: (resultData.sam3_results || []).length,
          ocr: (resultData.ocr_results || []).length,
        },
      },
      sessionId: request.sessionId,
    };
  }

  private async runPlaywrightExtraction(
    request: UnifiedExtractionRequest
  ): Promise<UnifiedExtractionResult> {
    if (!request.url) {
      throw new Error("URL is required for Playwright extraction");
    }

    const startedAt = new Date().toISOString();

    // Start the extraction
    // Map risk level - exclude 'dangerous' and 'blocked' as they are not valid for max_risk_level
    const maxRiskLevel = request.maxRiskLevel === "dangerous" || request.maxRiskLevel === "blocked"
      ? "caution"
      : request.maxRiskLevel;
    const startResponse = await runnerClient.startPlaywrightCollection({
      url: request.url,
      max_depth: request.maxDepth,
      max_elements_per_page: request.maxElementsPerPage,
      max_risk_level: maxRiskLevel,
      dry_run: request.dryRun,
      verify_extractions: request.verifyExtractions,
      verification_threshold: request.verificationThreshold,
      additional_blocked_keywords: request.blockedKeywords,
      additional_safe_keywords: request.safeKeywords,
      blocked_selectors: request.blockedSelectors,
    });

    if (!startResponse.success || !startResponse.data?.job_id) {
      throw new Error(
        startResponse.error || "Failed to start Playwright extraction"
      );
    }

    const jobId = startResponse.data.job_id;

    // Track the job
    this.activeJobs.set(jobId, {
      jobId,
      method: "playwright",
      status: "running",
      progress: 0,
      sessionId: request.sessionId,
      source: request.url,
      createdAt: startedAt,
      startedAt,
      hasResults: false,
    });

    // Poll for completion
    const result = await this.pollForCompletion(jobId, "playwright", request);

    return result;
  }

  private async runPatternExtraction(
    request: UnifiedExtractionRequest
  ): Promise<UnifiedExtractionResult> {
    if (!request.screenshot || !request.template) {
      throw new Error(
        "Screenshot and template are required for pattern matching"
      );
    }

    const jobId = `pattern_${Date.now()}`;
    const startedAt = new Date().toISOString();

    // Extract base64 from data URLs if present
    const screenshot = request.screenshot.includes(",")
      ? (request.screenshot.split(",")[1] ?? request.screenshot)
      : request.screenshot;
    const template = request.template.includes(",")
      ? (request.template.split(",")[1] ?? request.template)
      : request.template;

    const patternRequest = {
      screenshot,
      template,
      similarity: request.similarity || 0.8,
      search_region: request.searchRegion,
      max_matches: request.maxMatches,
    };

    const response = request.findAll
      ? await runnerClient.patternFindAll(patternRequest)
      : await runnerClient.patternFind(patternRequest);

    if (!response.success) {
      throw new Error(response.error || "Pattern matching failed");
    }

    const elements = convertPatternResults(response as unknown as Record<string, unknown>);

    return {
      jobId,
      method: "pattern",
      status: "completed",
      techniquesRun: ["pattern"],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: response.search_time_ms,
      imageWidth: response.screenshot_width,
      imageHeight: response.screenshot_height,
      elements,
      rawResults: {
        pattern: response.matches,
      },
      metrics: {
        totalFound: response.matches.length,
      },
      sessionId: request.sessionId,
    };
  }

  private async runWebExtraction(
    request: UnifiedExtractionRequest
  ): Promise<UnifiedExtractionResult> {
    const urls = request.urls || (request.url ? [request.url] : []);
    if (urls.length === 0) {
      throw new Error("At least one URL is required for web extraction");
    }

    const startedAt = new Date().toISOString();

    const startResponse = await runnerClient.startExtraction({
      urls,
      viewports: request.viewports || [[1920, 1080]],
      capture_hover_states: request.captureHoverStates || false,
      capture_focus_states: request.captureFocusStates || false,
      max_depth: request.maxDepth || 2,
      max_pages: request.maxPages || 100,
      session_id: request.backendSessionId,
      backend_url: request.backendUrl,
      auth_token: request.authToken,
    });

    if (!startResponse.success || !startResponse.data?.extraction_id) {
      throw new Error(startResponse.error || "Failed to start web extraction");
    }

    const jobId = startResponse.data.extraction_id;

    // Track the job
    this.activeJobs.set(jobId, {
      jobId,
      method: "web",
      status: "running",
      progress: 0,
      sessionId: request.sessionId,
      source: urls.join(", "),
      createdAt: startedAt,
      startedAt,
      hasResults: false,
    });

    // Poll for completion
    const result = await this.pollForCompletion(jobId, "web", request);

    return result;
  }

  // ============================================================================
  // Polling
  // ============================================================================

  private async pollForCompletion(
    jobId: string,
    method: ExtractionMethod,
    request: UnifiedExtractionRequest
  ): Promise<UnifiedExtractionResult> {
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minute timeout
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeout) {
      let status: ExtractionStatus;
      let progress = 0;
      let message = "";

      if (method === "playwright") {
        const statusResponse =
          await runnerClient.getPlaywrightCollectionStatus(jobId);
        if (statusResponse.success && statusResponse.data) {
          status = statusResponse.data.status as ExtractionStatus;
          progress = statusResponse.data.progress_percent || 0;
          message = statusResponse.data.progress_message || "";
        } else {
          status = "failed";
        }
      } else {
        const statusResponse = await runnerClient.getExtractionStatus();
        if (statusResponse.success && statusResponse.data) {
          status = statusResponse.data.is_running ? "running" : "completed";
          progress = statusResponse.data.stats
            ? Math.min(
                ((statusResponse.data.stats.pages_extracted || 0) / 100) * 100,
                95
              )
            : 0;
        } else {
          status = "failed";
        }
      }

      // Update job status
      const job = this.activeJobs.get(jobId);
      if (job) {
        job.status = status;
        job.progress = progress;
        job.progressMessage = message;
      }

      // Emit progress
      this.emitProgress({
        jobId,
        status,
        percent: progress,
        message,
        timestamp: new Date().toISOString(),
      });

      if (status === "completed") {
        // Fetch results
        if (method === "playwright") {
          const resultsResponse =
            await runnerClient.getPlaywrightCollectionResults(jobId);
          if (resultsResponse.success && resultsResponse.data) {
            const elements = convertPlaywrightResults(
              resultsResponse.data as unknown as Record<string, unknown>
            );
            const metrics = resultsResponse.data.metrics;

            this.activeJobs.delete(jobId);

            return {
              jobId,
              method,
              status: "completed",
              techniquesRun: ["playwright"],
              startedAt: new Date(startTime).toISOString(),
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              source: request.url,
              elements,
              metrics: metrics
                ? {
                    totalFound: metrics.total_found,
                    clicked: metrics.clicked,
                    skippedDangerous: metrics.skipped_dangerous,
                    pagesVisited: metrics.pages_visited,
                    verified: metrics.verified,
                    errors: metrics.errors,
                  }
                : undefined,
              sessionId: request.sessionId,
            };
          }
        }

        // Web extraction results are stored in backend
        this.activeJobs.delete(jobId);
        return {
          jobId,
          method,
          status: "completed",
          techniquesRun: ["web"],
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          source: request.urls?.join(", ") || request.url,
          elements: [],
          sessionId: request.sessionId,
        };
      }

      if (status === "failed") {
        this.activeJobs.delete(jobId);
        throw new Error(`${method} extraction failed`);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error("Extraction timed out");
  }

  // ============================================================================
  // Converters
  // ============================================================================

  private convertToUnifiedJob(
    data: Record<string, unknown>
  ): UnifiedExtractionJob {
    return {
      jobId: (data.job_id || data.jobId || data.id) as string,
      method: (data.method || "unknown") as ExtractionMethod,
      status: (data.status || "unknown") as ExtractionStatus,
      progress: (data.progress || data.progress_percent || 0) as number,
      progressMessage: data.progress_message as string | undefined,
      sessionId: data.session_id as string | undefined,
      source: (data.source || data.url) as string | undefined,
      createdAt:
        (data.created_at as string) || new Date().toISOString(),
      startedAt: data.started_at as string | undefined,
      completedAt: data.completed_at as string | undefined,
      error: data.error as string | undefined,
      hasResults: (data.has_results || false) as boolean,
    };
  }

  private convertToUnifiedResult(
    data: Record<string, unknown>
  ): UnifiedExtractionResult {
    const method = (data.method || "unknown") as ExtractionMethod;
    let elements: UnifiedElement[] = [];

    if (method === "vision") {
      elements = convertVisionResults(data);
    } else if (method === "playwright") {
      elements = convertPlaywrightResults(data);
    } else if (method === "pattern") {
      elements = convertPatternResults(data);
    }

    return {
      jobId: (data.job_id || data.jobId || data.id) as string,
      method,
      status: (data.status || "completed") as ExtractionStatus,
      techniquesRun: (data.techniques_run || [method]) as string[],
      startedAt: (data.started_at as string) || new Date().toISOString(),
      completedAt: data.completed_at as string,
      durationMs: data.duration_ms as number,
      imageWidth: data.image_width as number,
      imageHeight: data.image_height as number,
      source: data.source as string,
      elements,
      sessionId: data.session_id as string,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const unifiedExtractionService = new UnifiedExtractionService();

// Also export the class for testing
export { UnifiedExtractionService };
