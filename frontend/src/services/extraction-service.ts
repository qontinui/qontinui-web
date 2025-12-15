import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

export interface ExtractionSession {
  id: string;
  project_id: string;
  source_urls: string[];
  config: Record<string, any>;
  status: "pending" | "running" | "completed" | "failed";
  stats: {
    pages_extracted?: number;
    elements_found?: number;
    states_found?: number;
  };
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
}

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

export interface ExtractionSessionDetail extends ExtractionSession {
  annotations: ExtractionAnnotation[];
}

export interface ExtractionAnnotation {
  id: string;
  session_id: string;
  screenshot_id: string;
  source_url: string;
  viewport_width: number;
  viewport_height: number;
  elements: any[];
  states: any[];
  created_at: string;
  updated_at: string;
}

export interface StateImportRequest {
  state_ids?: string[];
  target_workflow_id?: string;
}

export interface ImportResult {
  imported_states: number;
  imported_transitions: number;
  workflow_id: string | null;
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
      const errorData = await response.json().catch(() => ({}));
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
}
