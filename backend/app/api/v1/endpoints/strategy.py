"""Strategy Collaboration (Phase 1) — read-only doc proxy.

Thin proxy in front of coord's `/strategy/docs*`. Human auth comes
from the existing fastapi-users session; the authenticated user id is
forwarded to coord as `X-Qontinui-User-Id` (via `StrategyClient`) so
coord dual-identity-audits the call. Threads/posts/comments are Phase
2 and intentionally absent (design §7).
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.api.deps import current_active_user
from app.models.user import User
from app.services.strategy import StrategyClient, StrategyDisabledError
from app.services.strategy import strategy_client as _client

router = APIRouter()


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
