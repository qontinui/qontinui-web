"""Strategy Collaboration (Phase 1) — coord service-account bridge.

`StrategyClient` is the web backend's single trusted identity at
qontinui-coord. It obtains a 4h service JWT via
`POST /coord/auth/service-token` (admin-secret gated), refreshes it
~5 min before expiry on a jittered background loop, and proxies the
read-only `/strategy/docs*` endpoints — forwarding the authenticated
end-user as `X-Qontinui-User-Id` so coord can dual-identity-audit
(`service_principal` = our sub, `acting_user` = the human).

Auth-bridge contract (Option 3, locked + tested coord-side at
`strategy-phase-1-coord`): coord issues, web refetches <4h. The
private signing key never leaves coord; we only ever hold the
issued token string. We never mint or verify JWTs locally — `exp`
comes back in the issuance response, so no JWT library is needed.

Enablement: the feature is OFF until `COORD_ADMIN_SECRET` is set.
Unset = intentionally disabled (endpoints 503), web starts normally
(coord isn't deployed yet — code lands now, goes live later).
Set-but-mint-fails (wrong secret / coord unreachable) = misconfig =
fail-fast at startup, per the prompt's "don't run indefinitely
without coord access".
"""

from __future__ import annotations

import asyncio
import random
import time

import httpx

from app.config.logging_config import get_logger
from app.core.config import settings

logger = get_logger(__name__)

# Refresh this many seconds before `exp` (design §8: 4h TTL, 5min
# buffer). The jitter spreads refreshes so N web workers don't stampede
# coord at the same instant.
_REFRESH_BUFFER_S = 300
_JITTER_S = 30
# Backoff when a refresh fails mid-life (token still valid for a while;
# retry well before it actually expires).
_RETRY_BACKOFF_S = 30


class StrategyDisabledError(RuntimeError):
    """Raised when a strategy call is attempted but the feature is off
    (COORD_ADMIN_SECRET unset). Surfaced as HTTP 503."""


class StrategyClient:
    def __init__(
        self,
        coord_url: str,
        admin_secret: str | None,
        service_name: str,
    ) -> None:
        self._coord_url = coord_url.rstrip("/")
        self._admin_secret = admin_secret
        self._service_name = service_name
        self._token: str | None = None
        self._exp: int = 0  # unix seconds
        self._lock = asyncio.Lock()
        self._refresh_task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return bool(self._admin_secret)

    # -- token lifecycle ------------------------------------------------

    async def _mint(self) -> None:
        """Obtain a fresh service token from coord. Raises on failure."""
        assert self._admin_secret is not None
        async with httpx.AsyncClient(timeout=10.0) as c:
            resp = await c.post(
                f"{self._coord_url}/coord/auth/service-token",
                headers={"X-Coord-Admin-Secret": self._admin_secret},
                json={
                    "service_name": self._service_name,
                    "scopes": {"git_read": ["*"], "strategy_admin": True},
                },
            )
        if resp.status_code != 200:
            raise RuntimeError(
                f"coord service-token mint failed: {resp.status_code} "
                f"{resp.text[:200]}"
            )
        body = resp.json()
        self._token = body["token"]
        self._exp = int(body["exp"])
        logger.info(
            "strategy_token_minted",
            sub=body.get("sub"),
            exp=self._exp,
            ttl_s=self._exp - int(time.time()),
        )

    async def _ensure_token(self) -> str:
        """Return a valid token, minting if absent or within the refresh
        buffer. Serialised so concurrent requests mint at most once."""
        if not self.enabled:
            raise StrategyDisabledError("COORD_ADMIN_SECRET not set")
        async with self._lock:
            if (
                self._token is None
                or self._exp - int(time.time()) <= _REFRESH_BUFFER_S
            ):
                await self._mint()
            assert self._token is not None
            return self._token

    async def _refresh_loop(self) -> None:
        """Background: sleep until ~5 min before expiry (jittered), then
        re-mint. On error, short-backoff retry (token is still valid)."""
        while True:
            try:
                await self._ensure_token()
                sleep_s = max(
                    _RETRY_BACKOFF_S,
                    self._exp
                    - int(time.time())
                    - _REFRESH_BUFFER_S
                    + random.uniform(-_JITTER_S, _JITTER_S),
                )
            except Exception as exc:  # noqa: BLE001 — loop must survive
                logger.warning("strategy_token_refresh_failed", error=str(exc))
                sleep_s = _RETRY_BACKOFF_S
            await asyncio.sleep(sleep_s)

    async def startup(self) -> None:
        """Called from app startup. Disabled → no-op. Enabled →
        fail-fast initial mint, then spawn the refresh loop."""
        if not self.enabled:
            logger.warning(
                "strategy_disabled",
                reason="COORD_ADMIN_SECRET not set — /strategy returns 503",
            )
            return
        # Fail-fast: a wrong secret or unreachable coord is a misconfig
        # we want surfaced at boot, not as silent 5xx forever.
        await self._mint()
        self._refresh_task = asyncio.create_task(self._refresh_loop())
        logger.info("strategy_client_started", coord_url=self._coord_url)

    async def shutdown(self) -> None:
        if self._refresh_task is not None:
            self._refresh_task.cancel()

    # -- proxied reads --------------------------------------------------

    async def _headers(self, acting_user_id: str) -> dict[str, str]:
        token = await self._ensure_token()
        return {
            "Authorization": f"Bearer {token}",
            "X-Qontinui-User-Id": acting_user_id,
        }

    async def _get(
        self, path: str, acting_user_id: str
    ) -> tuple[int, object]:
        headers = await self._headers(acting_user_id)
        async with httpx.AsyncClient(timeout=10.0) as c:
            resp = await c.get(
                f"{self._coord_url}{path}", headers=headers
            )
        try:
            body: object = resp.json()
        except ValueError:
            body = {"error": resp.text[:500]}
        return resp.status_code, body

    async def list_docs(self, acting_user_id: str) -> tuple[int, object]:
        return await self._get("/strategy/docs", acting_user_id)

    async def get_doc(
        self, acting_user_id: str, name: str
    ) -> tuple[int, object]:
        return await self._get(
            f"/strategy/docs/{name}", acting_user_id
        )


# Process-wide singleton, wired in app startup.
strategy_client = StrategyClient(
    coord_url=settings.COORD_URL,
    admin_secret=settings.COORD_ADMIN_SECRET,
    service_name=settings.STRATEGY_SERVICE_NAME,
)
