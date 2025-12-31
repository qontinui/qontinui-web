import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

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
    const url = `${this.apiUrl}/api/v1/extractions/${extractionId}/import-states`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Failed to import states: ${JSON.stringify(errorData)}`);
    }

    return response.json();
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
}
