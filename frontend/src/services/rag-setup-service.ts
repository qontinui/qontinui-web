/**
 * RAG Setup Service
 *
 * This service handles direct communication with the qontinui-runner
 * for RAG embedding generation after configuration export.
 *
 * Unlike other services that go through the backend, this service
 * communicates directly with the runner on port 9876.
 *
 * The runner now accepts QontinuiConfig directly - no transformation needed.
 */

import type { QontinuiConfig } from "@/lib/export-schema";

// Default runner URL - can be overridden
const DEFAULT_RUNNER_URL = "http://localhost:9876";

/**
 * RAG availability status from the runner
 */
export interface RAGAvailability {
  available: boolean;
  models: {
    clip: boolean;
    text: boolean;
    ocr: boolean;
    sam?: boolean;
  };
  reason?: string;
}

/**
 * Progress status for RAG setup
 */
export interface RAGSetupProgress {
  status: "not_started" | "in_progress" | "completed" | "failed";
  percent: number;
  elementsProcessed: number;
  totalElements: number;
  currentElement?: string;
  error?: string;
}

/**
 * Embedding data for a single StateImage
 */
export interface StateImageEmbedding {
  stateImageId: string;
  patternId?: string;
  imageEmbedding?: number[];
  textEmbedding?: number[];
  ocrText?: string;
  ocrConfidence?: number;
}

/**
 * Result of RAG setup containing computed embeddings
 */
export interface RAGSetupResult {
  projectId: string;
  projectName: string;
  elementsProcessed: number;
  embeddings: StateImageEmbedding[];
  vectorDbPath?: string;
  completedAt: string;
}

/**
 * Saved project information from ~/.qontinui/rag/
 */
export interface SavedRAGProject {
  id: string;
  name: string;
  configPath: string;
  lastModified: string;
  ragReady: boolean;
  elementCount: number;
  description?: string;
}

/**
 * Response for listing saved projects
 */
export interface ListProjectsResponse {
  projects: SavedRAGProject[];
}

/**
 * RAG Setup Service
 *
 * Communicates directly with qontinui-runner for:
 * - Checking RAG availability (ML models loaded)
 * - Sending config for embedding generation
 * - Polling setup progress
 * - Retrieving computed embeddings
 * - Listing saved projects
 */
export class RAGSetupService {
  private runnerUrl: string;

  constructor(runnerUrl: string = DEFAULT_RUNNER_URL) {
    this.runnerUrl = runnerUrl;
  }

  /**
   * Set the runner URL (useful when runner URL changes)
   */
  setRunnerUrl(url: string): void {
    this.runnerUrl = url;
  }

  /**
   * Get the current runner URL
   */
  getRunnerUrl(): string {
    return this.runnerUrl;
  }

  /**
   * Check if the runner is connected and responsive
   */
  async isRunnerConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.runnerUrl}/status`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check RAG availability on the runner
   * Returns which ML models are available and ready
   */
  async checkRAGAvailability(): Promise<RAGAvailability> {
    try {
      const response = await fetch(`${this.runnerUrl}/rag/availability`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Runner responded with ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      // Handle both wrapped and unwrapped response formats
      if (data.success !== undefined && data.data) {
        return data.data as RAGAvailability;
      }

      return data as RAGAvailability;
    } catch (error) {
      // If endpoint doesn't exist, return unavailable
      if (error instanceof Error && error.message.includes("404")) {
        return {
          available: false,
          models: { clip: false, text: false, ocr: false },
          reason: "RAG availability endpoint not found on runner",
        };
      }

      return {
        available: false,
        models: { clip: false, text: false, ocr: false },
        reason:
          error instanceof Error
            ? error.message
            : "Failed to check RAG availability",
      };
    }
  }

  /**
   * Start RAG setup for a project
   * Sends the QontinuiConfig directly to the runner for embedding generation.
   * The runner accepts the full config format and extracts what it needs.
   */
  async startRAGSetup(
    projectId: string,
    config: QontinuiConfig
  ): Promise<{ success: boolean; message: string }> {
    // Count patterns for logging
    const patternCount = (config.states || []).reduce(
      (total, state) =>
        total +
        (state.stateImages || []).reduce(
          (stTotal, si) => stTotal + (si.patterns?.length || 0),
          0
        ),
      0
    );

    console.log("[RAG] Sending QontinuiConfig to runner:", {
      project_id: projectId,
      name: config.metadata.name,
      stateCount: config.states?.length || 0,
      imageCount: config.images?.length || 0,
      patternCount,
    });

    const response = await fetch(`${this.runnerUrl}/rag/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        config,
        project_id: projectId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to start RAG setup: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    // Handle wrapped response format
    if (data.success !== undefined) {
      return {
        success: data.success,
        message: data.message || data.data?.message || "RAG setup started",
      };
    }

    return { success: true, message: "RAG setup started" };
  }

  /**
   * Get RAG setup progress for a project
   */
  async getRAGSetupProgress(projectId: string): Promise<RAGSetupProgress> {
    const response = await fetch(
      `${this.runnerUrl}/rag/${projectId}/status`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return {
          status: "not_started",
          percent: 0,
          elementsProcessed: 0,
          totalElements: 0,
        };
      }
      const errorText = await response.text();
      throw new Error(
        `Failed to get RAG setup progress: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    // Handle wrapped response format
    if (data.success !== undefined && data.data) {
      return data.data as RAGSetupProgress;
    }

    return data as RAGSetupProgress;
  }

  /**
   * Get RAG setup result with computed embeddings
   */
  async getRAGSetupResult(projectId: string): Promise<RAGSetupResult | null> {
    const response = await fetch(
      `${this.runnerUrl}/rag/${projectId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorText = await response.text();
      throw new Error(
        `Failed to get RAG setup result: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    // Handle wrapped response format
    if (data.success !== undefined && data.data) {
      return data.data as RAGSetupResult;
    }

    return data as RAGSetupResult;
  }

  /**
   * Cancel RAG setup in progress
   * Note: This endpoint may not be implemented yet on the runner
   */
  async cancelRAGSetup(projectId: string): Promise<void> {
    const response = await fetch(
      `${this.runnerUrl}/rag/${projectId}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to cancel RAG setup: ${response.status} ${errorText}`
      );
    }
  }

  /**
   * List saved RAG projects from ~/.qontinui/rag/
   */
  async listSavedProjects(): Promise<SavedRAGProject[]> {
    const response = await fetch(`${this.runnerUrl}/rag/list`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to list saved projects: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    // Runner returns ApiResponse<Vec<RAGConfigSummary>> with snake_case fields
    // Transform to SavedRAGProject format
    interface RunnerConfigSummary {
      project_id: string;
      project_name: string;
      version: string;
      exported_at: string;
      screenshot_count: number;
      element_count: number;
      has_embeddings: boolean;
      embedding_status?: string;
    }

    const transformConfig = (config: RunnerConfigSummary): SavedRAGProject => ({
      id: config.project_id,
      name: config.project_name,
      configPath: "", // Not provided by runner
      lastModified: config.exported_at,
      ragReady: config.has_embeddings,
      elementCount: config.element_count,
      description: config.embedding_status,
    });

    // Handle wrapped response format: { success: true, data: [...] }
    if (data.success !== undefined && Array.isArray(data.data)) {
      return (data.data as RunnerConfigSummary[]).map(transformConfig);
    }

    // Handle direct array response
    if (Array.isArray(data)) {
      return (data as RunnerConfigSummary[]).map(transformConfig);
    }

    return [];
  }

  /**
   * Load a saved project by ID
   */
  async loadSavedProject(
    projectId: string
  ): Promise<{ success: boolean; message: string; config?: QontinuiConfig }> {
    const response = await fetch(
      `${this.runnerUrl}/rag/${projectId}/load`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to load project: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    // Handle wrapped response format
    if (data.success !== undefined) {
      return {
        success: data.success,
        message: data.message || "Project loaded",
        config: data.data?.config || data.config,
      };
    }

    return { success: true, message: "Project loaded", config: data.config };
  }

  /**
   * Delete a saved project
   */
  async deleteSavedProject(
    projectId: string
  ): Promise<{ success: boolean; message: string }> {
    const response = await fetch(
      `${this.runnerUrl}/rag/${projectId}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to delete project: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    // Handle wrapped response format
    if (data.success !== undefined) {
      return {
        success: data.success,
        message: data.message || "Project deleted",
      };
    }

    return { success: true, message: "Project deleted" };
  }

  /**
   * Poll for RAG setup completion
   * Returns a promise that resolves when setup completes or fails
   */
  async waitForRAGSetupCompletion(
    projectId: string,
    options: {
      pollInterval?: number;
      timeout?: number;
      onProgress?: (progress: RAGSetupProgress) => void;
    } = {}
  ): Promise<RAGSetupResult> {
    const { pollInterval = 1000, timeout = 300000, onProgress } = options;

    const startTime = Date.now();

    while (true) {
      const progress = await this.getRAGSetupProgress(projectId);

      if (onProgress) {
        onProgress(progress);
      }

      if (progress.status === "completed") {
        const result = await this.getRAGSetupResult(projectId);
        if (result) {
          return result;
        }
        throw new Error("RAG setup completed but no result available");
      }

      if (progress.status === "failed") {
        throw new Error(progress.error || "RAG setup failed");
      }

      if (Date.now() - startTime > timeout) {
        throw new Error("RAG setup timed out");
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}

// Create singleton instance
let ragSetupServiceInstance: RAGSetupService | null = null;

export function getRAGSetupService(runnerUrl?: string): RAGSetupService {
  if (!ragSetupServiceInstance) {
    ragSetupServiceInstance = new RAGSetupService(runnerUrl);
  } else if (runnerUrl) {
    ragSetupServiceInstance.setRunnerUrl(runnerUrl);
  }
  return ragSetupServiceInstance;
}

// Export a default instance
export const ragSetupService = new RAGSetupService();
