"""Strategy Collaboration (Phase 1) — read-only doc proxy.

Thin proxy in front of coord's `/strategy/docs*`. Human auth comes
from the existing fastapi-users session; the authenticated user id is
forwarded to coord as `X-Qontinui-User-Id` (via `StrategyClient`) so
coord dual-identity-audits the call. Threads/posts/comments are Phase
2 and intentionally absent (design §7).
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from uuid import UUID

from app.api.deps import current_active_user
from app.models.user import User
from app.services.strategy import StrategyClient, StrategyDisabledError
from app.services.strategy import strategy_client as _client

router = APIRouter()


class HeartbeatBody(BaseModel):
    """Accepts EITHER doc_id (already-resolved UUID) OR doc_name (the
    substrate-relative path). The frontend sends doc_name; coord
    resolves and echoes the canonical doc_id in the response body."""

    doc_id: UUID | None = None
    doc_name: str | None = None


def get_client() -> StrategyClient:
    return _client


@router.get("/docs")
async def list_docs(
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.list_docs(str(user.id))
    except StrategyDisabledError:
        return JSONResponse(
            status_code=503,
            content={"error": "strategy feature not enabled"},
        )
    return JSONResponse(status_code=status_code, content=body)


@router.get("/docs/{name}")
async def get_doc(
    name: str,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.get_doc(str(user.id), name)
    except StrategyDisabledError:
        return JSONResponse(
            status_code=503,
            content={"error": "strategy feature not enabled"},
        )
    return JSONResponse(status_code=status_code, content=body)


# Strategy Phase 2.4 — presence heartbeat. Forwards to coord's
# `POST /strategy/presence/heartbeat`, which emits the per-user
# dual-publish event consumed by the in-process aggregator. Body has
# no ttl_s — server-side 90 s TTL. Coord echoes the resolved doc_id
# so the frontend can match aggregate events by canonical UUID.
@router.post("/presence/heartbeat")
async def heartbeat(
    payload: HeartbeatBody,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    if not payload.doc_id and not payload.doc_name:
        return JSONResponse(
            status_code=400,
            content={"error": "doc_id or doc_name required"},
        )
    try:
        status_code, body = await client.heartbeat(
            str(user.id),
            doc_id=str(payload.doc_id) if payload.doc_id else None,
            doc_name=payload.doc_name,
        )
    except StrategyDisabledError:
        return JSONResponse(
            status_code=503,
            content={"error": "strategy feature not enabled"},
        )
    return JSONResponse(status_code=status_code, content=body)
