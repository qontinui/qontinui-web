/**
 * TypeScript types for RAG Dashboard
 *
 * These types match the backend Pydantic schemas in rag_dashboard.py
 */

// ============================================================================
// Dashboard Stats
// ============================================================================

export interface JobSummary {
  id: string;
  status: JobStatus;
  progress_percent: number;
  total_patterns: number;
  processed_patterns: number;
  started_at: string | null;
  error_message: string | null;
}

export interface RAGDashboardStats {
  total_embeddings: number;
  total_states: number;
  total_patterns: number;
  last_sync_at: string | null;
  active_job: JobSummary | null;
}

// ============================================================================
// Embeddings
// ============================================================================

export interface EmbeddingItem {
  id: string;
  pattern_id: string;
  pattern_name: string | null;
  state_id: string;
  state_name: string;
  image_id: string;
  image_storage_path: string;
  embedding_model: string;
  embedding_version: string;
  image_width: number;
  image_height: number;
  pattern_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EmbeddingListResponse {
  items: EmbeddingItem[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface EmbeddingsParams {
  page?: number;
  limit?: number;
  state_filter?: string;
}

// ============================================================================
// Jobs
// ============================================================================

export type JobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobItem {
  id: string;
  status: JobStatus;
  total_patterns: number;
  processed_patterns: number;
  progress_percent: number;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  job_metadata: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobListResponse {
  items: JobItem[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface JobsParams {
  page?: number;
  limit?: number;
  status_filter?: JobStatus;
}

// ============================================================================
// Search
// ============================================================================

export interface SemanticSearchRequest {
  query: string;
  limit?: number;
  min_similarity?: number;
  state_filter?: string;
}

export interface SearchResultItem {
  embedding: EmbeddingItem;
  similarity_score: number;
}

export interface SemanticSearchResponse {
  results: SearchResultItem[];
  query: string;
  total_found: number;
}

// ============================================================================
// States (for filter dropdown)
// ============================================================================

export interface StateFilterItem {
  state_id: string;
  state_name: string;
  count: number;
}

export interface StatesResponse {
  states: StateFilterItem[];
  count: number;
}
