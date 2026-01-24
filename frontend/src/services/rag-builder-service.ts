import { HttpClient } from "./http-client";
import type { RAGElement, RAGElementFormData } from "@/types/rag-builder";
import type { RAGFindRequest, RAGFindResponse } from "@/types/rag-testing";

/**
 * RAG Builder Service
 *
 * API client for managing RAG elements, states, and transitions.
 * Communicates with the runner backend (port 9876).
 */

// ============================================================================
// Types
// ============================================================================

export interface RAGState {
  id: string;
  name: string;
  description: string;
  element_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface RAGTransition {
  id: string;
  from_state_id: string;
  to_state_id: string;
  action: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface SearchQuery {
  query: string;
  element_types?: string[];
  states?: string[];
  limit?: number;
}

export interface SearchResult {
  element: RAGElement;
  score: number;
  matches: {
    text?: number;
    visual?: number;
    semantic?: number;
  };
}

export interface RAGExportData {
  elements: RAGElement[];
  states: RAGState[];
  transitions: RAGTransition[];
  metadata: {
    exported_at: string;
    version: string;
    project_id?: string;
  };
}

// ============================================================================
// RAG Builder Service
// ============================================================================

export class RAGBuilderService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    // Use runner (port 9876) instead of main backend
    // Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
    this.apiUrl =
      process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";
  }

  // ==========================================================================
  // Elements
  // ==========================================================================

  /**
   * Get all RAG elements for a project
   */
  async getElements(projectId: string): Promise<RAGElement[]> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/elements`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get elements: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a single RAG element by ID
   */
  async getElement(elementId: string): Promise<RAGElement> {
    const url = `${this.apiUrl}/api/rag/elements/${elementId}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get element: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a new RAG element
   */
  async createElement(
    projectId: string,
    data: RAGElementFormData
  ): Promise<RAGElement> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/elements`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Failed to create element: ${JSON.stringify(errorData)}`);
    }

    return response.json();
  }

  /**
   * Update an existing RAG element
   */
  async updateElement(
    elementId: string,
    data: RAGElementFormData
  ): Promise<RAGElement> {
    const url = `${this.apiUrl}/api/rag/elements/${elementId}`;
    const response = await this.httpClient.fetch(url, {
      method: "PUT",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to update element: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete a RAG element
   */
  async deleteElement(elementId: string): Promise<void> {
    const url = `${this.apiUrl}/api/rag/elements/${elementId}`;
    const response = await this.httpClient.fetch(url, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to delete element: ${response.statusText}`);
    }
  }

  // ==========================================================================
  // States
  // ==========================================================================

  /**
   * Get all RAG states for a project
   */
  async getStates(projectId: string): Promise<RAGState[]> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/states`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get states: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a single RAG state by ID
   */
  async getState(stateId: string): Promise<RAGState> {
    const url = `${this.apiUrl}/api/rag/states/${stateId}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get state: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a new RAG state
   */
  async createState(
    projectId: string,
    data: Partial<RAGState>
  ): Promise<RAGState> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/states`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Failed to create state: ${JSON.stringify(errorData)}`);
    }

    return response.json();
  }

  /**
   * Update an existing RAG state
   */
  async updateState(
    stateId: string,
    data: Partial<RAGState>
  ): Promise<RAGState> {
    const url = `${this.apiUrl}/api/rag/states/${stateId}`;
    const response = await this.httpClient.fetch(url, {
      method: "PUT",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to update state: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete a RAG state
   */
  async deleteState(stateId: string): Promise<void> {
    const url = `${this.apiUrl}/api/rag/states/${stateId}`;
    const response = await this.httpClient.fetch(url, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to delete state: ${response.statusText}`);
    }
  }

  // ==========================================================================
  // Transitions
  // ==========================================================================

  /**
   * Get all RAG transitions for a project
   */
  async getTransitions(projectId: string): Promise<RAGTransition[]> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/transitions`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get transitions: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a single RAG transition by ID
   */
  async getTransition(transitionId: string): Promise<RAGTransition> {
    const url = `${this.apiUrl}/api/rag/transitions/${transitionId}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get transition: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a new RAG transition
   */
  async createTransition(
    projectId: string,
    data: Partial<RAGTransition>
  ): Promise<RAGTransition> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/transitions`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to create transition: ${JSON.stringify(errorData)}`
      );
    }

    return response.json();
  }

  /**
   * Update an existing RAG transition
   */
  async updateTransition(
    transitionId: string,
    data: Partial<RAGTransition>
  ): Promise<RAGTransition> {
    const url = `${this.apiUrl}/api/rag/transitions/${transitionId}`;
    const response = await this.httpClient.fetch(url, {
      method: "PUT",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to update transition: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete a RAG transition
   */
  async deleteTransition(transitionId: string): Promise<void> {
    const url = `${this.apiUrl}/api/rag/transitions/${transitionId}`;
    const response = await this.httpClient.fetch(url, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to delete transition: ${response.statusText}`);
    }
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  /**
   * Search RAG elements using text and semantic similarity
   */
  async search(projectId: string, query: SearchQuery): Promise<SearchResult[]> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/search`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(query),
    });

    if (!response.ok) {
      throw new Error(`Failed to search elements: ${response.statusText}`);
    }

    return response.json();
  }

  // ==========================================================================
  // AI Generation
  // ==========================================================================

  /**
   * Generate description for an element using AI
   */
  async generateDescription(elementId: string): Promise<string> {
    const url = `${this.apiUrl}/api/rag/elements/${elementId}/generate-description`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Failed to generate description: ${response.statusText}`);
    }

    const data = await response.json();
    return data.description;
  }

  /**
   * Batch generate descriptions for all elements missing text_description
   */
  async generateDescriptions(
    projectId: string
  ): Promise<{ updated: number; total: number }> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/generate-descriptions`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(
        `Failed to generate descriptions: ${response.statusText}`
      );
    }

    return response.json();
  }

  // ==========================================================================
  // Export/Import
  // ==========================================================================

  /**
   * Export RAG data for a project
   */
  async exportProject(projectId: string): Promise<RAGExportData> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/export`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to export project: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Import RAG data into a project
   */
  async importProject(
    projectId: string,
    data: RAGExportData
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/import`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to import project: ${response.statusText}`);
    }

    return response.json();
  }

  // ==========================================================================
  // RAG Find (Testing)
  // ==========================================================================

  /**
   * Find RAG elements in a screenshot using SAM3 segmentation
   *
   * This endpoint segments the screenshot, vectorizes each segment with CLIP,
   * and matches against indexed element embeddings.
   */
  async findElements(
    projectId: string,
    request: RAGFindRequest
  ): Promise<RAGFindResponse> {
    const url = `${this.apiUrl}/api/rag/projects/${projectId}/find`;
    const response = await this.httpClient.fetch(url, {
      method: "POST",
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Failed to find elements: ${JSON.stringify(errorData)}`);
    }

    return response.json();
  }
}
