"""Schemas for RAG Dashboard endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RAGDashboardStats(BaseModel):
    """Summary statistics for RAG dashboard."""

    total_embeddings: int = Field(description="Total number of indexed embeddings")
    total_states: int = Field(description="Number of unique states with embeddings")
    total_patterns: int = Field(description="Number of unique patterns")
    last_sync_at: datetime | None = Field(
        description="When runner last synced embeddings"
    )
    active_job: "JobSummary | None" = Field(description="Currently running job if any")


class JobSummary(BaseModel):
    """Summary of an embedding generation job."""

    id: UUID
    status: str = Field(
        description="pending, in_progress, completed, failed, cancelled"
    )
    progress_percent: float = Field(description="0-100 progress percentage")
    total_patterns: int
    processed_patterns: int
    started_at: datetime | None
    error_message: str | None = None


class EmbeddingItem(BaseModel):
    """Single embedding record for display."""

    id: UUID
    pattern_id: str
    pattern_name: str | None
    state_id: str
    state_name: str
    image_id: str
    image_storage_path: str
    embedding_model: str
    embedding_version: str
    image_width: int
    image_height: int
    pattern_metadata: dict
    created_at: datetime
    updated_at: datetime


class EmbeddingListResponse(BaseModel):
    """Paginated list of embeddings."""

    items: list[EmbeddingItem]
    total: int
    page: int
    limit: int
    has_more: bool


class JobItem(BaseModel):
    """Single job record for display."""

    id: UUID
    status: str
    total_patterns: int
    processed_patterns: int
    progress_percent: float
    error_message: str | None
    retry_count: int
    max_retries: int
    job_metadata: dict
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class JobListResponse(BaseModel):
    """Paginated list of jobs."""

    items: list[JobItem]
    total: int
    page: int
    limit: int
    has_more: bool


class SemanticSearchRequest(BaseModel):
    """Request for semantic search."""

    query: str = Field(min_length=1, description="Search query text")
    limit: int = Field(default=20, ge=1, le=100, description="Max results to return")
    min_similarity: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Minimum similarity threshold"
    )
    state_filter: str | None = Field(default=None, description="Filter by state ID")


class SearchResultItem(BaseModel):
    """Single search result."""

    embedding: EmbeddingItem
    similarity_score: float = Field(description="0-1 similarity score")


class SemanticSearchResponse(BaseModel):
    """Response from semantic search."""

    results: list[SearchResultItem]
    query: str
    total_found: int


# Update forward reference
RAGDashboardStats.model_rebuild()
