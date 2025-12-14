import { HttpClient } from "./http-client";

/**
 * RAG Export Types
 */
export interface RAGExportRequest {
  include_ocr?: boolean;
  include_screenshots?: boolean;
  embedding_model?: string;
  filter_tags?: string[];
}

export interface RAGElement {
  id: string;
  name: string;
  element_type: string;
  element_subtype?: string;
  text_description: string;
  ocr_text?: string;
  bounding_box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  dominant_colors?: string[];
  is_interactive?: boolean;
  interaction_type?: string;
  semantic_role?: string;
  semantic_action?: string;
  state_id?: string;
  state_name?: string;
  is_defining_element?: boolean;
  similarity_threshold?: number;
  source_screenshot_id?: string;
  element_hash?: string;
  created_at: string;
  updated_at?: string;
}

export interface RAGConfig {
  version: string;
  config_type: "rag";
  metadata: {
    name: string;
    description?: string;
    author?: string;
    created_at: string;
    modified_at?: string;
    tags?: string[];
    target_application?: string;
  };
  embedding_config: {
    text_model: string;
    text_model_version: string;
    text_embedding_dim: number;
    clip_model: string;
    clip_model_version: string;
    clip_embedding_dim: number;
    dinov2_model?: string;
    dinov2_model_version?: string;
    dinov2_embedding_dim?: number;
  };
  elements: RAGElement[];
  states: Array<{
    id: string;
    name: string;
    description?: string;
    defining_element_ids?: string[];
    optional_element_ids?: string[];
    expected_text?: string[];
  }>;
  workflows: Array<{
    id: string;
    name: string;
    description?: string;
    actions: Array<{
      type: string;
      config: Record<string, unknown>;
    }>;
  }>;
  transitions: Array<{
    id: string;
    name?: string;
    from_states?: string[];
    to_states?: string[];
    workflow_id?: string;
  }>;
  screenshots?: Record<
    string,
    {
      filename: string;
      width: number;
      height: number;
      captured_at?: string;
    }
  >;
  vector_db?: {
    filename: string;
    element_count: number;
    last_indexed_at?: string;
    index_hash?: string;
  };
}

export interface TransferStatus {
  success: boolean;
  message: string;
  runner_url?: string;
  transferred_at?: string;
  embedding_status?: string;
}

export interface RAGExportResponse {
  success: boolean;
  message: string;
  config?: RAGConfig;
  transfer_status?: TransferStatus;
  export_size_bytes?: number;
  element_count?: number;
}

export interface RAGExportStatus {
  project_id: string;
  project_name: string;
  rag_exportable: boolean;
  stats: {
    element_count: number;
    state_count: number;
    workflow_count: number;
    transition_count: number;
  };
  metadata: {
    created_at: string;
    updated_at: string;
    version: string;
  };
}

export interface EmbeddingProgress {
  status: "not_started" | "in_progress" | "completed" | "failed";
  message: string;
  percent?: number;
  elements_processed?: number;
  total_elements?: number;
}

/**
 * RAGExportService - Handles RAG export and transfer to runner
 */
export class RAGExportService {
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.baseUrl = "/api/v1/projects/rag";
  }

  /**
   * Export project as RAG format
   */
  async exportProject(
    projectId: string,
    options: RAGExportRequest = {}
  ): Promise<RAGExportResponse> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/${projectId}/export`,
      {
        method: "POST",
        body: JSON.stringify(options),
      }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to export project" }));
      throw new Error(error.detail || "Failed to export project");
    }

    return response.json();
  }

  /**
   * Download RAG export as JSON file
   */
  async downloadExport(
    projectId: string,
    options: RAGExportRequest = {}
  ): Promise<Blob> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/${projectId}/export/download`,
      {
        method: "POST",
        body: JSON.stringify(options),
      }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to download export" }));
      throw new Error(error.detail || "Failed to download export");
    }

    return response.blob();
  }

  /**
   * Transfer RAG config to connected runner
   */
  async transferToRunner(
    projectId: string,
    runnerUrl: string,
    options: RAGExportRequest = {}
  ): Promise<RAGExportResponse> {
    const params = new URLSearchParams({ runner_url: runnerUrl });
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/${projectId}/transfer?${params.toString()}`,
      {
        method: "POST",
        body: JSON.stringify(options),
      }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to transfer to runner" }));
      throw new Error(error.detail || "Failed to transfer to runner");
    }

    return response.json();
  }

  /**
   * Get RAG export status for a project
   */
  async getExportStatus(projectId: string): Promise<RAGExportStatus> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/${projectId}/status`
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to get export status" }));
      throw new Error(error.detail || "Failed to get export status");
    }

    return response.json();
  }

  /**
   * Get embedding progress from runner
   */
  async getEmbeddingProgress(
    runnerUrl: string,
    projectId: string
  ): Promise<EmbeddingProgress> {
    const response = await fetch(`${runnerUrl}/rag/${projectId}/status`);

    if (!response.ok) {
      throw new Error("Failed to get embedding progress from runner");
    }

    const data = await response.json();

    // Extract the progress from the runner's response format
    if (data.success && data.data) {
      return {
        status: data.data.status || "not_started",
        message: data.data.message || "",
        percent: data.data.percent,
        elements_processed: data.data.elements_processed,
        total_elements: data.data.total_elements,
      };
    }

    throw new Error("Invalid response format from runner");
  }
}
