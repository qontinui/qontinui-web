import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";
import type {
  RAGDashboardStats,
  EmbeddingListResponse,
  EmbeddingsParams,
  JobListResponse,
  JobsParams,
  SemanticSearchRequest,
  SemanticSearchResponse,
  StatesResponse,
} from "@/types/rag-dashboard";

/**
 * RAG Dashboard Service
 *
 * API client for RAG dashboard data including embeddings, jobs, and search.
 * Communicates with the main backend (port 8000) via Next.js proxy.
 */
export class RAGDashboardService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    // Use main backend (port 8000) via Next.js proxy
    this.apiUrl = ApiConfig.getBaseUrl();
  }

  /**
   * Get dashboard summary statistics.
   */
  async getDashboard(projectId: string): Promise<RAGDashboardStats> {
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/rag/dashboard`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.detail || `Failed to fetch RAG dashboard: ${response.status}`
      );
    }

    return response.json();
  }

  /**
   * Get paginated list of embeddings.
   */
  async getEmbeddings(
    projectId: string,
    params: EmbeddingsParams = {}
  ): Promise<EmbeddingListResponse> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.state_filter)
      searchParams.set("state_filter", params.state_filter);

    const queryString = searchParams.toString();
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/rag/embeddings${
      queryString ? `?${queryString}` : ""
    }`;

    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.detail || `Failed to fetch embeddings: ${response.status}`
      );
    }

    return response.json();
  }

  /**
   * Get paginated list of embedding generation jobs.
   */
  async getJobs(
    projectId: string,
    params: JobsParams = {}
  ): Promise<JobListResponse> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set("page", String(params.page));
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.status_filter)
      searchParams.set("status_filter", params.status_filter);

    const queryString = searchParams.toString();
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/rag/jobs${
      queryString ? `?${queryString}` : ""
    }`;

    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.detail || `Failed to fetch jobs: ${response.status}`
      );
    }

    return response.json();
  }

  /**
   * Perform semantic search across embeddings.
   */
  async search(
    projectId: string,
    request: SemanticSearchRequest
  ): Promise<SemanticSearchResponse> {
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/rag/search`;

    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `Search failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get list of unique states for filter dropdown.
   */
  async getStates(projectId: string): Promise<StatesResponse> {
    const url = `${this.apiUrl}/api/v1/projects/${projectId}/rag/states`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.detail || `Failed to fetch states: ${response.status}`
      );
    }

    return response.json();
  }
}
