"""Schemas for cross-entity semantic search."""

from uuid import UUID

from pydantic import BaseModel, Field


class SemanticSearchRequest(BaseModel):
    """Request payload for cross-entity semantic search."""

    query_text: str = Field(..., min_length=1, max_length=2000)
    entities: list[str] = Field(
        default=["execution_issue", "domain_knowledge", "project_embedding"],
        description="Entity types to search across",
    )
    limit: int = Field(default=20, ge=1, le=100)
    min_similarity: float = Field(default=0.5, ge=0.0, le=1.0)
    project_id: UUID | None = Field(default=None, description="Optional project filter")
    status_filter: str | None = None
    severity_filter: str | None = None


class SemanticSearchResultItem(BaseModel):
    """A single semantic search result."""

    entity_type: str
    id: UUID
    title: str
    description: str | None = None
    similarity: float
    metadata: dict | None = None


class SemanticSearchResponse(BaseModel):
    """Response for cross-entity semantic search."""

    query_text: str
    total_results: int
    results: list[SemanticSearchResultItem]
