"""Resilient POST helper for web→coord proxy calls on interactive flows.

Incident 2026-06-11: during a coord rolling deploy, fresh coord tasks
refuse to serve until their git-replication catch-up completes, so for a
short window the coord ALB has no ready targets. The pairing endpoints
(``/devices/pair-cli``, ``/devices/pair-confirm``, pair-code redeem)
failed their single POST with a transport error and surfaced
``502 {"error": "INTERNAL_SERVER_ERROR", "message": "Coord unreachable."}``
to the login flow — a hard onboarding failure for a self-healing blip.

Retry policy (deliberately narrow — these POSTs are not idempotent in
general, so we only retry when the request provably never reached
coord's application):

* ``httpx.ConnectError`` / ``httpx.ConnectTimeout`` — the TCP/TLS
  connection was never established; nothing was sent. Retried.
* Gateway statuses **502/503/504 from the load balancer or coord's
  readiness degrade** — returned before the application processed the
  request. Retried.
* ``httpx.TimeoutException`` (read/write/pool) — the request may have
  reached coord; NOT retried. Mapped to an honest 504.
* Any other transport error — NOT retried; 502 as before.

Exhausted retries map to **503 + Retry-After** (the same honest-degrade
posture as the ``schema_readiness`` 503), not a generic 502: the
condition is transient and client-retryable.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import structlog
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.error_codes import ErrorCode

logger = structlog.get_logger(__name__)

# Statuses a gateway returns BEFORE the application processed the request
# (ALB no-healthy-target / upstream connect failure, or coord's own
# readiness 503) — safe to retry even for non-idempotent POSTs.
_RETRYABLE_GATEWAY_STATUSES = frozenset({502, 503, 504})

# 3 attempts total; sleeps between them. Worst case adds ~2s of backoff
# on top of the per-attempt timeout — well under interactive patience,
# and connection-refused failures (the deploy-window signature) fail
# fast rather than burning the full timeout.
_ATTEMPTS = 3
_BACKOFF_SECONDS = (0.5, 1.5)

# Conservative hint for clients; deploy windows are minutes, but a quick
# first re-poll often lands on an already-recovered target.
_RETRY_AFTER_SECONDS = "10"


async def post_to_coord(
    path: str,
    *,
    headers: dict[str, str],
    json_body: dict[str, Any],
    timeout: float = 10.0,
    log_event: str,
    **log_fields: Any,
) -> httpx.Response:
    """POST ``path`` to coord, retrying only never-reached-coord failures.

    Returns coord's response for every status outside
    ``_RETRYABLE_GATEWAY_STATUSES`` (callers keep their own non-2xx
    handling for genuine coord rejections). Raises ``HTTPException``:

    * 503 + ``Retry-After`` when coord stayed unavailable across all
      attempts (connect failures / gateway statuses),
    * 504 on a read/write timeout (single attempt — the request may have
      been processed),
    * 502 on any other transport error (single attempt).

    ``log_event`` prefixes the structured-log events
    (``<log_event>_coord_*``); extra ``log_fields`` are attached to each.
    """
    url = f"{settings.COORD_URL.rstrip('/')}{path}"
    last_exc: Exception | None = None
    last_status: int | None = None

    for attempt in range(1, _ATTEMPTS + 1):
        if attempt > 1:
            await asyncio.sleep(_BACKOFF_SECONDS[attempt - 2])
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, headers=headers, json=json_body)
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            # Connection never established — request provably not sent.
            last_exc, last_status = exc, None
            logger.warning(
                f"{log_event}_coord_connect_failed",
                attempt=attempt,
                error=str(exc),
                **log_fields,
            )
            continue
        except httpx.TimeoutException as exc:
            # Read/write/pool timeout — coord may have processed the
            # request; blind retry is unsafe for a non-idempotent POST.
            logger.error(
                f"{log_event}_coord_timeout",
                error=str(exc),
                **log_fields,
            )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail={
                    "error": ErrorCode.GATEWAY_TIMEOUT.value,
                    "message": (
                        "Coord did not respond in time; the operation may "
                        "not have completed. Retry shortly."
                    ),
                },
                headers={"Retry-After": _RETRY_AFTER_SECONDS},
            ) from exc
        except httpx.HTTPError as exc:
            logger.error(
                f"{log_event}_coord_transport_failed",
                error=str(exc),
                **log_fields,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Coord unreachable.",
            ) from exc

        if resp.status_code in _RETRYABLE_GATEWAY_STATUSES:
            # Gateway answered for coord — the application never saw the
            # request (or refused it pre-processing via readiness 503).
            last_exc, last_status = None, resp.status_code
            logger.warning(
                f"{log_event}_coord_gateway_status",
                attempt=attempt,
                status=resp.status_code,
                **log_fields,
            )
            continue

        return resp

    logger.error(
        f"{log_event}_coord_unavailable",
        attempts=_ATTEMPTS,
        last_status=last_status,
        error=str(last_exc) if last_exc else None,
        **log_fields,
    )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": ErrorCode.SERVICE_UNAVAILABLE.value,
            "message": (
                "Coord is temporarily unavailable (likely a rolling "
                "deploy); retry shortly."
            ),
        },
        headers={"Retry-After": _RETRY_AFTER_SECONDS},
    ) from last_exc
