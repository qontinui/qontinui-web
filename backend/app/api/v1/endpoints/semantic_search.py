"""Cross-entity semantic search endpoint.

Searches across execution issues, domain knowledge, and project embeddings
using pgvector cosine similarity with MiniLM-L6-v2 (384-dim) embeddings.
"""

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.semantic_search import (search_domain_knowledge,
                                      search_execution_issues,
                                      search_project_embeddings)
from app.models.user import User
from app.schemas.semantic_search import (SemanticSearchRequest,
                                         SemanticSearchResponse,
                                         SemanticSearchResultItem)
from app.services.embedding_service import EmbeddingService
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


async def _compute_minilm_embedding(text: str) -> list[float] | None:
    """Compute a MiniLM-L6-v2 (384-dim) text embedding."""
    import httpx

    service = EmbeddingService()
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{service.api_url}/api/embeddings/compute-text",
                json={"text": text, "model": "minilm"},
            )
            response.raise_for_status()
            data = response.json()
            if data.get("success") and data.get("embedding"):
                embedding: list[float] = data["embedding"]
                return embedding
            logger.warning("semantic_search_embedding_failed", error=data.get("error"))
            return None
    except Exception as e:
        logger.warning("semantic_search_embedding_failed", error=str(e))
        return None


@router.post("/semantic-search", response_model=SemanticSearchResponse)
async def cross_entity_semantic_search(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    request: SemanticSearchRequest,
) -> SemanticSearchResponse:
    """Search across multiple entity types using semantic similarity.

    Computes a MiniLM embedding of the query text, then searches across
    the requested entity types using pgvector cosine similarity.
    """
    logger.info(
        "semantic_search_request",
        query_text=request.query_text[:100],
        entities=request.entities,
        limit=request.limit,
    )

    # Compute query embedding
    query_embedding = await _compute_minilm_embedding(request.query_text)
    if not query_embedding:
        return SemanticSearchResponse(
            query_text=request.query_text,
            total_results=0,
            results=[],
        )

    all_results: list[SemanticSearchResultItem] = []

    # Search each requested entity type
    if "execution_issue" in request.entities:
        issues = await search_execution_issues(
            db,
            query_embedding,
            limit=request.limit,
            min_similarity=request.min_similarity,
            project_id=request.project_id,
            status_filter=request.status_filter,
            severity_filter=request.severity_filter,
        )
        for issue, sim in issues:
            all_results.append(
                SemanticSearchResultItem(
                    entity_type="execution_issue",
                    id=issue.id,
                    title=issue.title,
                    description=issue.description[:500] if issue.description else None,
                    similarity=round(sim, 4),
                    metadata={
                        "issue_type": issue.issue_type,
                        "severity": issue.severity,
                        "status": issue.status,
                    },
                )
            )

    if "domain_knowledge" in request.entities:
        knowledge = await search_domain_knowledge(
            db,
            query_embedding,
            limit=request.limit,
            min_similarity=request.min_similarity,
            project_id=request.project_id,
        )
        for item, sim in knowledge:
            all_results.append(
                SemanticSearchResultItem(
                    entity_type="domain_knowledge",
                    id=item.id,
                    title=item.title,
                    description=item.content[:500] if item.content else None,
                    similarity=round(sim, 4),
                    metadata={"tags": item.tags},
                )
            )

    if "project_embedding" in request.entities:
        embeddings = await search_project_embeddings(
            db,
            query_embedding,
            limit=request.limit,
            min_similarity=request.min_similarity,
            project_id=request.project_id,
        )
        for emb, sim in embeddings:
            all_results.append(
                SemanticSearchResultItem(
                    entity_type="project_embedding",
                    id=emb.id,
                    title=emb.state_name or "Unnamed",
                    description=emb.text_description,
                    similarity=round(sim, 4),
                    metadata={
                        "state_id": emb.state_id,
                        "pattern_id": emb.pattern_id,
                    },
                )
            )

    # Sort all results by similarity descending and truncate to limit
    all_results.sort(key=lambda r: r.similarity, reverse=True)
    all_results = all_results[: request.limit]

    logger.info(
        "semantic_search_complete",
        total_results=len(all_results),
        entities_searched=request.entities,
    )

    return SemanticSearchResponse(
        query_text=request.query_text,
        total_results=len(all_results),
        results=all_results,
    )
