/**
 * TypeScript types for RAG Dashboard
 *
 * Re-exports shared types from @qontinui/schemas and adds frontend-specific types.
 */

// Re-export enum (value export is fine)
export { JobStatus } from "@qontinui/schemas/rag";

// Re-export types (must use 'export type' with isolatedModules)
export type {
  // Dashboard Stats
  JobSummary,
  RAGDashboardStats,
  // Embeddings
  EmbeddingItem,
  EmbeddingListResponse,
  // Jobs
  JobItem,
  JobListResponse,
  // Search
  SemanticSearchRequest,
  SearchResultItem,
  SemanticSearchResponse,
  // States
  StateFilterItem,
  StatesResponse,
} from "@qontinui/schemas/rag";

// ============================================================================
// Frontend-specific types (not in shared schema)
// ============================================================================

export interface EmbeddingsParams {
  page?: number;
  limit?: number;
  state_filter?: string;
}

export interface JobsParams {
  page?: number;
  limit?: number;
  status_filter?: string;
}
