"""Coord service-account bridge.

`CoordServiceAccountClient` is the web backend's single trusted identity at
qontinui-coord. It obtains a 4h service JWT via
`POST /coord/auth/service-token` (admin-secret gated), refreshes it
~5 min before expiry on a jittered background loop, and is used by device
pairing (`app/api/v1/endpoints/devices.py`, `app/api/v1/endpoints/pair_codes.py`)
to authenticate to coord's device-identity surface — forwarding the
authenticated end-user as `X-Qontinui-User-Id` so coord can
dual-identity-audit (`service_principal` = our sub, `acting_user` = the
human). It is also how a background job asks coord's device resolver on a
user's behalf: `mint_acting_user_token` exchanges the service bearer for a
short-lived token acting for one named user
(`app/services/coord_device_resolve.py`).

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

This module was extracted from the former `app/services/strategy.py`
(plan `2026-09-20-remove-the-strategy-collaboration-feature`, Phase 2) as
a pure move with no behaviour change: this client is ALSO the web
backend's service-account bridge to coord, used by device pairing, and
that usage predates and outlives the deleted Strategy collaboration
feature — only the device-pairing bridge survives here.
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


class CoordServiceAccountDisabledError(RuntimeError):
    """Raised when a coord service-account call is attempted but the
    feature is off (COORD_ADMIN_SECRET unset). Surfaced as HTTP 503."""


class CoordServiceTokenError(RuntimeError):
    """Coord did not give the web backend its OWN service token.

    Raised by :meth:`CoordServiceAccountClient._mint` when
    ``POST /coord/auth/service-token`` answers anything but a usable
    ``200 {"token", "exp"}``. ``status`` is coord's HTTP status — a refusal
    (the admin secret was not accepted), a 5xx, or a ``200`` whose body is
    not the contract. A transport failure is not this error: it propagates
    as the ``httpx`` exception it is.

    A ``RuntimeError`` subclass, which is what this failure raised before it
    had a type, so the startup fail-fast and the refresh loop are unchanged.
    """

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class CoordServiceAccountClient:
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
        """Obtain a fresh service token from coord.

        Raises :class:`CoordServiceTokenError` when coord answers anything
        but a usable token, and the ``httpx`` error when it cannot be
        reached. The cached token is replaced only by a whole, usable answer.
        """
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
            raise CoordServiceTokenError(
                f"coord service-token mint failed: {resp.status_code} {resp.text[:200]}",
                status=resp.status_code,
            )
        try:
            body = resp.json()
            token = body["token"]
            exp = int(body["exp"])
        except (KeyError, TypeError, ValueError, OverflowError) as exc:
            # Not JSON, not an object, no token, or an ``exp`` that is not a
            # number of seconds (``int(float("inf"))`` overflows).
            raise CoordServiceTokenError(
                f"coord service-token mint answered an unusable body: {exc!r}",
                status=resp.status_code,
            ) from exc
        if not isinstance(token, str) or not token:
            raise CoordServiceTokenError(
                "coord service-token mint answered no token string",
                status=resp.status_code,
            )
        self._token = token
        self._exp = exp
        logger.info(
            "coord_service_account_token_minted",
            sub=body.get("sub"),
            exp=self._exp,
            ttl_s=self._exp - int(time.time()),
        )

    async def _ensure_token(self) -> str:
        """Return a valid token, minting if absent or within the refresh
        buffer. Serialised so concurrent requests mint at most once."""
        if not self.enabled:
            raise CoordServiceAccountDisabledError("COORD_ADMIN_SECRET not set")
        async with self._lock:
            if self._token is None or self._exp - int(time.time()) <= _REFRESH_BUFFER_S:
                await self._mint()
            assert self._token is not None
            return self._token

    async def _drop_token(self, stale: str) -> None:
        """Forget the cached service token ``stale`` — coord refused it.

        :meth:`_ensure_token` re-mints only inside the refresh buffer, so a
        token coord stopped accepting early (a coord restart with new signing
        keys) would otherwise be presented until it expired. Taken under the
        lock, and only while ``stale`` is still the cached token: a caller
        that lost the race to a concurrent re-mint keeps the fresh one.
        """
        async with self._lock:
            if self._token == stale:
                self._token = None
                self._exp = 0

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
                logger.warning(
                    "coord_service_account_token_refresh_failed", error=str(exc)
                )
                sleep_s = _RETRY_BACKOFF_S
            await asyncio.sleep(sleep_s)

    async def startup(self) -> None:
        """Called from app startup. Disabled → no-op. Enabled →
        fail-fast initial mint, then spawn the refresh loop."""
        if not self.enabled:
            logger.warning(
                "coord_service_account_disabled",
                reason="COORD_ADMIN_SECRET not set — coord service-account bridge is off",
            )
            return
        # Fail-fast: a wrong secret or unreachable coord is a misconfig
        # we want surfaced at boot, not as silent 5xx forever.
        await self._mint()
        self._refresh_task = asyncio.create_task(self._refresh_loop())
        logger.info("coord_service_account_started", coord_url=self._coord_url)

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

    async def _post(
        self,
        path: str,
        acting_user_id: str,
        json_body: object | None = None,
    ) -> tuple[int, object]:
        headers = await self._headers(acting_user_id)
        async with httpx.AsyncClient(timeout=10.0) as c:
            resp = await c.post(
                f"{self._coord_url}{path}",
                headers=headers,
                json=json_body,
            )
        # 204 No Content has no body to parse.
        if resp.status_code == 204 or not resp.content:
            return resp.status_code, None
        try:
            body: object = resp.json()
        except ValueError:
            body = {"error": resp.text[:500]}
        return resp.status_code, body

    # -- device machine-key exchange (4b cold-start recovery) ------------

    async def mint_device_token(
        self, acting_user_id: str, device_id: str
    ) -> tuple[int, object]:
        """Mint a device JWT for ``device_id`` via coord's service-mint.

        Rides web's trusted service identity: coord's
        ``POST /coord/devices/{device_id}/service-mint`` accepts our service
        bearer and resolves the device's owner/tenant server-side from
        ``coord.devices`` (web never asserts them). Used by the ``dmk_``
        exchange endpoint after web has verified the credential.

        Returns ``(status_code, body)``; raises
        :class:`CoordServiceAccountDisabledError` (via ``_ensure_token``)
        when the feature is off (COORD_ADMIN_SECRET unset) so the caller
        can surface a 503.
        """
        return await self._post(
            f"/coord/devices/{device_id}/service-mint",
            acting_user_id,
            json_body=None,
        )

    # -- acting-user mint (background device resolve) --------------------

    async def mint_acting_user_token(
        self, user_id: str, *, timeout: httpx.Timeout
    ) -> tuple[int, object]:
        """Mint a short-lived Service token that ACTS FOR ``user_id``.

        The door is ``POST /coord/auth/service-acting-user-token``. Its
        contract is that of the coord change that adds it (qontinui-coord,
        plan
        ``2026-09-23-runner-selector-follow-ups-drain-aware-background-dispatch-and-typed-instances``
        Phase 1a): it accepts our service bearer and answers ``200 {"token",
        "acting_user", "tenant_id", "jti", "exp"}``. A coord without that
        change answers from its router fallback, which the caller reads as
        ``not_deployed``. The token, presented as the bearer to
        ``POST /coord/devices/resolve``, resolves that user's paired devices —
        how a caller with no request behind it (a scheduled run) asks coord's
        resolver as the schedule's owner.

        Not to be confused with coord's older
        ``POST /coord/auth/acting-user-service-token``, where a device or
        agent JWT exchanges for a token acting for its OWN bound user. Here
        the trusted web service NAMES the user. The two paths differ only in
        word order and are different doors: do not "fix" one to the other.

        The user is named in the BODY, which is what the door reads. No
        ``X-Qontinui-User-Id`` header is sent: on this door it is not an
        identity, and sending it would only suggest it was. No tenant is sent
        either: by the same contract coord resolves the user's tenant itself
        and answers ``409 tenant_ambiguous`` only when it cannot — web never
        names one.

        Nothing is cached: every call is a fresh mint for the user it names,
        so one user's token can never be handed to another.

        A ``401`` means coord no longer accepts our SERVICE token (a coord
        restart with new signing keys, well before the token's ``exp``). The
        cached service token is dropped, a fresh one obtained, and the mint
        retried exactly once; a second ``401`` is returned as it is.

        ``timeout`` is the ``httpx`` timeout given to EACH request to this
        door (the first, and the one retry): a bound on each phase of that
        request, not a total across them and not shared with anything the
        caller does next. It is required so the caller states it rather than
        inheriting a default. A service-token mint this call triggers
        (:meth:`_mint`) is not covered by it and keeps its own 10 s timeout.

        Returns ``(status_code, body)``. ``body`` is coord's parsed JSON, or
        ``None`` when the answer is not JSON — never a wrapped text body, so
        an ``error`` string read from it is always coord's own. Raises
        :class:`CoordServiceAccountDisabledError` (via ``_ensure_token``) when
        the feature is off (COORD_ADMIN_SECRET unset), and
        :class:`CoordServiceTokenError` when coord will not give us our own
        service token.
        """
        token = await self._ensure_token()
        status, body = await self._post_acting_user_mint(token, user_id, timeout)
        if status == 401:
            logger.warning("coord_service_account_token_refused_reminting")
            await self._drop_token(token)
            token = await self._ensure_token()
            status, body = await self._post_acting_user_mint(token, user_id, timeout)
        return status, body

    async def _post_acting_user_mint(
        self, token: str, user_id: str, timeout: httpx.Timeout
    ) -> tuple[int, object]:
        async with httpx.AsyncClient(timeout=timeout) as c:
            resp = await c.post(
                f"{self._coord_url}/coord/auth/service-acting-user-token",
                headers={"Authorization": f"Bearer {token}"},
                json={"user_id": user_id},
            )
        try:
            body: object = resp.json()
        except ValueError:
            body = None
        return resp.status_code, body


# Process-wide singleton, wired in app startup.
coord_service_account = CoordServiceAccountClient(
    coord_url=settings.COORD_URL,
    admin_secret=settings.COORD_ADMIN_SECRET,
    service_name=settings.STRATEGY_SERVICE_NAME,
)
