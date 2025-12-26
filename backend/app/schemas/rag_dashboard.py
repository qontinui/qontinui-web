"""Schemas for RAG Dashboard endpoints.

Re-exports shared types from qontinui-schemas.
"""

# Re-export all RAG API schemas from the shared package
from qontinui_schemas.api.rag import (  # Enums; Dashboard Stats; Embeddings; Jobs; Search; States
    EmbeddingItem,
    EmbeddingListResponse,
    JobItem,
    JobListResponse,
    JobStatus,
    JobSummary,
    RAGDashboardStats,
    SearchResultItem,
    SemanticSearchRequest,
    SemanticSearchResponse,
    StateFilterItem,
    StatesResponse,
)

__all__ = [
    "JobStatus",
    "JobSummary",
    "RAGDashboardStats",
    "EmbeddingItem",
    "EmbeddingListResponse",
    "JobItem",
    "JobListResponse",
    "SemanticSearchRequest",
    "SearchResultItem",
    "SemanticSearchResponse",
    "StateFilterItem",
    "StatesResponse",
]
