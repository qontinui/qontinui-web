import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";
import type { UITarsExtractionConfig } from "@/types/extraction-unified";
import { createLogger } from "@/lib/logger";

const log = createLogger("ExtractionService");

// Re-export types from shared schema
export type {
  ExtractionStatus,
  StateType,
  TriggerType,
  BoundingBox,
  ExtractedElement,
  ElementAnnotation,
  StateAnnotation,
  InferredTransition,
  ExtractionStats,
  ExtractionAnnotation,
  ExtractionSessionConfig,
  StateImportRequest,
  ImportResult,
} from "@/types/extraction";

// Import types for use in this file
import type {
  ExtractionSession as SharedExtractionSession,
  ExtractionSessionDetail as SharedExtractionSessionDetail,
  ExtractionAnnotation,
  StateImportRequest,
  ImportResult,
} from "@/types/extraction";

// Alias the shared types for backward compatibility
// The shared types use snake_case which matches the API response
export type ExtractionSession = SharedExtractionSession;
export type ExtractionSessionDetail = SharedExtractionSessionDetail;

// Config type for creating sessions (matches API request format)
export interface ExtractionSessionCreate {
  source_urls: string[];
  config?: {
    viewports?: [number, number][];
    capture_hover_states?: boolean;
    capture_focus_states?: boolean;
    max_depth?: number;
    max_pages?: number;
    auth_cookies?: Record<string, string>;
  };
}

export class ExtractionService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  async getExtractions(projectId: string): Promise<ExtractionSession[]> {
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/extractions`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      await response.json().catch(() => ({}));
      throw new Error(`Failed to get extractions: ${response.statusText}`);
    }

    return response.json();
  }

  async getExtraction(extractionId: string): Promise<ExtractionSession> {
    const url = `${this.apiUrl}/api/v1/extractions/${extractionId}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to get extraction");
    }

    return response.json();
  }

  async getExtractionDetail(
    extractionId: string
  ): Promise<ExtractionSessionDetail> {
    const url = `${this.apiUrl}/api/v1/extractions/${extractionId}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to get extraction details");
    }

    return response.json();
  }

  async getAnnotations(extractionId: string): Promise<ExtractionAnnotation[]> {
    const url = `${this.apiUrl}/api/v1/extractions/${extractionId}/annotations`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to get annotations");
    }

    return response.json();
  }

  async importStates(
    extractionId: string,
    data: StateImportRequest
  ): Promise<ImportResult> {
    log.debug("importStates called:", { extractionId, data });

    const url = `${this.apiUrl}/api/v1/extractions/${extractionId}/import-states`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[ExtractionService] importStates failed:", errorData);
      throw new Error(`Failed to import states: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    log.debug("importStates result:", result);
    return result;
  }

  async createExtraction(
    projectId: string,
    data: ExtractionSessionCreate
  ): Promise<ExtractionSession> {
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/extractions`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to create extraction: ${JSON.stringify(errorData)}`
      );
    }

    return response.json();
  }

  async deleteExtraction(extractionId: string): Promise<void> {
    const url = `${this.apiUrl}/api/v1/extractions/${extractionId}`;
    const response = await this.httpClient.fetch(url, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error("Failed to delete extraction");
    }
  }

  async updateExtraction(
    extractionId: string,
    data: {
      status?: string;
      error_message?: string;
      stats?: Record<string, unknown>;
    }
  ): Promise<ExtractionSession> {
    const url = `${this.apiUrl}/api/v1/extractions/${extractionId}`;
    const response = await this.httpClient.fetch(url, {
      method: "PATCH",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to update extraction: ${JSON.stringify(errorData)}`
      );
    }

    return response.json();
  }

  // ============================================================
  // UI-TARS Extraction Methods
  // ============================================================

  /**
   * Start a UI-TARS exploration session.
   * This creates an extraction session and triggers UI-TARS on the runner.
   */
  async startUITarsExploration(
    projectId: string,
    config: {
      method: "uitars-web" | "uitars-desktop";
      uitarsConfig: UITarsExtractionConfig;
      selectedMonitors: number[];
    }
  ): Promise<UITarsExplorationSession> {
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/extractions/uitars`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify({
        target_type: config.method === "uitars-web" ? "web" : "desktop",
        target:
          config.method === "uitars-web"
            ? config.uitarsConfig.urls?.[0]
            : config.uitarsConfig.applicationName,
        goal: config.uitarsConfig.goal,
        provider: config.uitarsConfig.provider,
        model_size: config.uitarsConfig.modelSize,
        quantization: config.uitarsConfig.quantization,
        max_steps: config.uitarsConfig.maxSteps,
        timeout_seconds: config.uitarsConfig.timeoutSeconds,
        save_screenshots: config.uitarsConfig.saveScreenshots,
        huggingface_endpoint: config.uitarsConfig.huggingfaceEndpoint,
        huggingface_api_token: config.uitarsConfig.huggingfaceApiToken,
        vllm_server_url: config.uitarsConfig.vllmServerUrl,
        selected_monitors: config.selectedMonitors,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to start UI-TARS exploration: ${JSON.stringify(errorData)}`
      );
    }

    return response.json();
  }

  /**
   * Get the status of a UI-TARS exploration session.
   */
  async getUITarsExplorationStatus(
    sessionId: string
  ): Promise<UITarsExplorationStatus> {
    const url = `${this.apiUrl}/api/v1/extractions/uitars/${sessionId}/status`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to get UI-TARS exploration status");
    }

    return response.json();
  }

  /**
   * Get the results of a completed UI-TARS exploration.
   */
  async getUITarsExplorationResults(
    sessionId: string
  ): Promise<UITarsExplorationResults> {
    const url = `${this.apiUrl}/api/v1/extractions/uitars/${sessionId}/results`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to get UI-TARS exploration results");
    }

    return response.json();
  }

  /**
   * Stop an ongoing UI-TARS exploration session.
   */
  async stopUITarsExploration(sessionId: string): Promise<void> {
    const url = `${this.apiUrl}/api/v1/extractions/uitars/${sessionId}/stop`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Failed to stop UI-TARS exploration");
    }
  }
}

// ============================================================
// UI-TARS Types
// ============================================================

export interface UITarsExplorationSession {
  id: string;
  project_id: string;
  target_type: "web" | "desktop";
  target: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface UITarsExplorationStatus {
  session_id: string;
  status: "pending" | "running" | "completed" | "failed";
  current_step: number;
  max_steps: number;
  elapsed_seconds: number;
  last_thought?: string;
  last_action?: string;
  error_message?: string;
}

export interface UITarsDiscoveredState {
  id: string;
  name: string;
  description?: string;
  screenshot_path: string;
  elements: Array<{
    id: string;
    name: string;
    type: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
}

export interface UITarsDiscoveredTransition {
  id: string;
  from_state_id: string;
  to_state_id: string;
  action_type: string;
  action_description: string;
  coordinates?: { x: number; y: number };
}

export interface UITarsExplorationResults {
  session_id: string;
  states: UITarsDiscoveredState[];
  transitions: UITarsDiscoveredTransition[];
  total_steps: number;
  total_screenshots: number;
  exploration_time_seconds: number;
}
