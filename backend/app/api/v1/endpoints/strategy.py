"""Strategy Collaboration (Phase 1 + 2) — proxy to coord.

Thin proxy in front of coord's `/strategy/*` endpoints. Human auth
comes from the existing fastapi-users session; the authenticated
user id is forwarded to coord as `X-Qontinui-User-Id` (via
`StrategyClient`) so coord dual-identity-audits the call.

Phase 1 (read-only): /docs, /docs/{name}
Phase 2.3 (collaboration proxies): threads / posts / mentions
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

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


# --- Pydantic request bodies for Phase 2.3 ---------------------------------


class ThreadCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    anchor: str | None = None
    body_markdown: str = Field(min_length=1)


class PostCreate(BaseModel):
    body_markdown: str = Field(min_length=1)
    parent_post_id: str | None = None


class PostEdit(BaseModel):
    body_markdown: str = Field(min_length=1)


def _disabled_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"error": "strategy feature not enabled"},
    )


# --- Phase 1 read-only -----------------------------------------------------


@router.get("/docs")
async def list_docs(
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.list_docs(str(user.id))
    except StrategyDisabledError:
        return _disabled_response()
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
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


# --- Phase 2.3 collaboration proxies ---------------------------------------


@router.get("/docs/{name}/threads")
async def list_threads(
    name: str,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.list_threads(str(user.id), name)
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.post("/docs/{name}/threads")
async def create_thread(
    name: str,
    payload: ThreadCreate,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.create_thread(
            str(user.id), name, payload.model_dump()
        )
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.get_thread(str(user.id), thread_id)
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.post("/threads/{thread_id}/posts")
async def create_post(
    thread_id: str,
    payload: PostCreate,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.create_post(
            str(user.id), thread_id, payload.model_dump()
        )
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.post("/threads/{thread_id}/resolve")
async def resolve_thread(
    thread_id: str,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.resolve_thread(str(user.id), thread_id)
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.patch("/posts/{post_id}")
async def edit_post(
    post_id: str,
    payload: PostEdit,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.edit_post(
            str(user.id), post_id, payload.model_dump()
        )
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.delete("/posts/{post_id}")
async def delete_post(
    post_id: str,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.delete_post(str(user.id), post_id)
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.get("/mentions/unread")
async def list_unread_mentions(
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> JSONResponse:
    try:
        status_code, body = await client.list_unread_mentions(str(user.id))
    except StrategyDisabledError:
        return _disabled_response()
    return JSONResponse(status_code=status_code, content=body)


@router.post("/mentions/{mention_id}/mark-read")
async def mark_mention_read(
    mention_id: str,
    user: User = Depends(current_active_user),
    client: StrategyClient = Depends(get_client),
) -> Any:
    try:
        status_code, body = await client.mark_mention_read(str(user.id), mention_id)
    except StrategyDisabledError:
        return _disabled_response()
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
