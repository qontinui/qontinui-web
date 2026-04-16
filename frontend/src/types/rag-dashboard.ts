/**
 * TypeScript types for RAG Dashboard
 *
 * Re-exports shared types from @qontinui/schemas and adds frontend-specific types.
 */

// JobStatus is a string-literal union type (Rust schemars → TS), not a
// runtime enum. Grep verified no `JobStatus.X` value uses exist, so
// type-only re-export is safe.
export type { JobStatus } from "@qontinui/shared-types/rag";

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
} from "@qontinui/shared-types/rag";

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
