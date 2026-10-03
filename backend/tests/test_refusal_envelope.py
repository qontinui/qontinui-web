"""The next-action envelope: the helper, the wire shape, and every converted
refusal's ``NextActionKind``.

Plan ``2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists``,
Phases D1/D2 (web backend). The D2 conversions were chosen by SERVED
frequency, measured 2026-09-30 with CloudWatch Logs Insights over the 30 days
of log group ``/ecs/qontinui-staging/web`` (production)::

    filter event = "http_request" and status_code >= 400
      and ip_address != "52.87.90.79"          # coord's route observer
    | stats count(*) as n by method, path, status_code | sort n desc

That put the dual-auth 401s first (``GET /plan-library`` 39,582 +
``POST`` 2,903), then the coord-proxy 504s (``/operations/pr-merge/prs``
14,053, ``/operations/fleet/volumes`` 4,947, ...) and the runner-proxy
relay's 503 (``.../prepaid-balance`` 2,290). The warning-level events over 7
days agreed (``no_auth_token_found``, ``cognito_token_invalid``,
``runner_proxy_relay_not_connected``, ``device_token_rejected``,
``coord_identity_mismatch``). Each converted site has a test below asserting
the kind it names.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import deps
from app.api.v1.endpoints import operations
from app.core.refusal import (
    REFUSAL_KEY,
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    RefusalHTTPException,
    build_refusal,
    refusal_error,
    refusal_payload,
)
from app.middleware.error_handler import http_exception_handler

# --- the helper -------------------------------------------------------------


def test_refusal_error_carries_the_typed_envelope() -> None:
    exc = refusal_error(
        503,
        RefusalCode.upstream_unavailable,
        NextActionKind.retry_later,
        "try again soon",
        discriminator="example",
        retry_after_s=7,
        glossary_terms=[GlossaryTerm.coord],
    )
    assert isinstance(exc, HTTPException)
    # `detail` stays the human string for in-process readers.
    assert exc.detail == "try again soon"
    assert exc.error_code == "SERVICE_UNAVAILABLE"
    assert exc.headers == {"Retry-After": "7"}
    payload = refusal_payload(exc.refusal)
    assert payload["code"] == "upstream_unavailable"
    assert payload["discriminator"] == "example"
    assert payload["next_action"] == {"kind": "retry_later", "retry_after_s": 7}
    assert payload["glossary_terms"] == ["coord"]
    assert payload["detail"] == "try again soon"
    assert payload["source"] == "web_backend"
    assert payload["observed_at"]
    # Reader-side fields are never produced.
    assert not any(k.startswith("unrecognised") for k in payload)


def test_glossary_terms_is_always_on_the_wire() -> None:
    refusal = build_refusal(
        RefusalCode.not_found,
        NextActionKind.none_terminal,
        "gone",
        discriminator="gone",
    )
    assert refusal_payload(refusal)["glossary_terms"] == []


def test_an_explicit_retry_after_header_wins() -> None:
    exc = refusal_error(
        429,
        RefusalCode.rate_limited,
        NextActionKind.retry_later,
        "slow down",
        discriminator="example",
        retry_after_s=7,
        headers={"retry-after": "30"},
    )
    assert exc.headers == {"retry-after": "30"}


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"next_action": NextActionKind.unrecognised}, "reader-side"),
        ({"discriminator": ""}, "discriminator"),
        ({"message": ""}, "human sentence"),
    ],
)
def test_build_refusal_refuses_an_incomplete_refusal(
    kwargs: dict[str, Any], match: str
) -> None:
    args: dict[str, Any] = {
        "code": RefusalCode.conflict,
        "next_action": NextActionKind.fix_request,
        "message": "m",
        "discriminator": "d",
    }
    args.update(kwargs)
    with pytest.raises(ValueError, match=match):
        build_refusal(
            args["code"],
            args["next_action"],
            args["message"],
            discriminator=args["discriminator"],
        )


def test_metadata_may_not_shadow_the_envelope() -> None:
    with pytest.raises(ValueError, match="shadow"):
        refusal_error(
            409,
            RefusalCode.conflict,
            NextActionKind.fix_request,
            "m",
            discriminator="d",
            metadata={REFUSAL_KEY: "x"},
        )


# --- the wire shape ---------------------------------------------------------


def _app_raising(exc: Exception) -> TestClient:
    app = FastAPI()
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]

    @app.get("/boom")
    async def boom() -> None:
        raise exc

    return TestClient(app)


def test_handler_keeps_the_top_level_and_nests_the_envelope() -> None:
    plain = _app_raising(
        HTTPException(status_code=502, detail="coord is not reachable")
    )
    refused = _app_raising(operations._coord_unreachable())
    before = plain.get("/boom").json()
    after = refused.get("/boom").json()
    # Existing top-level fields are byte-for-byte what a string detail served.
    for key in ("error", "message"):
        assert after[key] == before[key]
    assert set(after) - set(before) == {REFUSAL_KEY}
    assert after[REFUSAL_KEY]["code"] == "upstream_unavailable"
    assert after[REFUSAL_KEY]["next_action"]["kind"] == "retry_later"


def test_handler_splices_metadata_at_the_top_level() -> None:
    exc = refusal_error(
        403,
        RefusalCode.permission_denied,
        NextActionKind.pair_device,
        "paired devices only",
        discriminator="d",
        error_code="not_a_device_principal",
        metadata={"device_id": "abc"},
    )
    body = _app_raising(exc).get("/boom").json()
    assert body["error"] == "not_a_device_principal"
    assert body["message"] == "paired devices only"
    assert body["device_id"] == "abc"
    assert body[REFUSAL_KEY]["discriminator"] == "d"


# --- D2: every converted refusal names its next action ----------------------


def _kind(exc: BaseException) -> tuple[str, str, str | None]:
    assert isinstance(exc, RefusalHTTPException), type(exc)
    r = exc.refusal
    return r.code.value, r.next_action.kind.value, r.discriminator


@pytest.mark.asyncio
async def test_dual_auth_without_any_credential_is_sign_in() -> None:
    with pytest.raises(HTTPException) as info:
        await deps._resolve_actor_principal(None, None)
    assert info.value.status_code == 401
    assert _kind(info.value) == ("authentication_required", "sign_in", "no_credential")


def _token_error(name: str) -> Exception:
    from app.services import coord_jwks

    cls = getattr(coord_jwks, name)
    if name == "CoordTokenForeignIssuerError":
        return cls("foreign", coord_url="u", token_kid="k", served_kids=[])
    return cls("x")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "kind", "discriminator"),
    [
        ("CoordTokenExpiredError", "retry_later", "expired"),
        ("CoordTokenNotYetValidError", "set_setting", "not_yet_valid"),
        ("CoordTokenForeignIssuerError", "report_defect", "foreign_issuer"),
        ("CoordTokenInvalidError", "report_defect", "failed_verification"),
    ],
)
async def test_rejected_device_token_names_the_next_action(
    error: str, kind: str, discriminator: str
) -> None:
    from app.services.coord_jwks import coord_jwks_client

    with (
        patch.object(
            coord_jwks_client,
            "verify_token",
            AsyncMock(side_effect=_token_error(error)),
        ),
        pytest.raises(HTTPException) as info,
    ):
        await deps._verify_device_jwt("t")
    assert info.value.status_code == 401
    assert _kind(info.value) == ("credential_rejected", kind, discriminator)
    if kind == "set_setting":
        assert info.value.refusal.next_action.target == "system clock"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "code", "kind", "discriminator"),
    [
        (
            "CoordTokenForeignIssuerError",
            "authentication_required",
            "sign_in",
            "foreign_issuer",
        ),
        (
            "CoordTokenInvalidError",
            "authentication_required",
            "sign_in",
            "failed_verification",
        ),
        ("CoordTokenExpiredError", "credential_rejected", "retry_later", "expired"),
        (
            "CoordTokenNotYetValidError",
            "credential_rejected",
            "set_setting",
            "not_yet_valid",
        ),
    ],
)
async def test_dual_auth_bearer_rejection_sends_a_browser_user_to_sign_in(
    error: str, code: str, kind: str, discriminator: str
) -> None:
    """With no browser session, a bearer that is really an expired browser
    token fails device verification as foreign-issuer or unverifiable. On the
    dual-auth path that is a sign-in, not "report a defect"."""
    from app.services.coord_jwks import coord_jwks_client

    with (
        patch.object(
            coord_jwks_client,
            "verify_token",
            AsyncMock(side_effect=_token_error(error)),
        ),
        pytest.raises(HTTPException) as info,
    ):
        await deps._resolve_actor_principal(
            None, HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
        )
    assert info.value.status_code == 401
    assert _kind(info.value) == (code, kind, discriminator)
    if kind == "sign_in":
        assert "sign in again" in str(info.value.detail)
        assert "different coord" not in str(info.value.detail)


@pytest.mark.asyncio
async def test_expired_device_token_says_a_fresh_token_is_needed() -> None:
    from app.services.coord_jwks import coord_jwks_client

    with (
        patch.object(
            coord_jwks_client,
            "verify_token",
            AsyncMock(side_effect=_token_error("CoordTokenExpiredError")),
        ),
        pytest.raises(HTTPException) as info,
    ):
        await deps._verify_device_jwt("t")
    assert "fresh token" in str(info.value.detail)


@pytest.mark.asyncio
async def test_unreachable_key_set_is_retry_later() -> None:
    from app.services.coord_jwks import CoordJWKSUnavailableError, coord_jwks_client

    with (
        patch.object(
            coord_jwks_client,
            "verify_token",
            AsyncMock(side_effect=CoordJWKSUnavailableError("down")),
        ),
        patch("app.services.coord_jwks.jwks_failure_log_fields", return_value={}),
        pytest.raises(HTTPException) as info,
    ):
        await deps._verify_device_jwt("t")
    assert info.value.status_code == 503
    assert _kind(info.value) == (
        "upstream_unavailable",
        "retry_later",
        "device_key_set_unreachable",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("claims", "discriminator"),
    [
        ({}, "user_id_claim_missing"),
        ({"user_id": "not-a-uuid"}, "user_id_claim_malformed"),
    ],
)
async def test_unusable_user_claim_is_pair_device(
    claims: dict[str, str], discriminator: str
) -> None:
    from app.services.coord_jwks import coord_jwks_client

    with (
        patch.object(coord_jwks_client, "verify_token", AsyncMock(return_value=claims)),
        pytest.raises(HTTPException) as info,
    ):
        await deps._verify_device_jwt("t")
    assert _kind(info.value) == ("credential_rejected", "pair_device", discriminator)


def _session_returning(user: Any) -> Any:
    result = MagicMock()
    result.scalar_one_or_none.return_value = user
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)

    @asynccontextmanager
    async def factory() -> Any:
        yield session

    return factory


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("user", "expected"),
    [
        (None, ("credential_rejected", "pair_device", "paired_user_absent")),
        (
            SimpleNamespace(is_active=False),
            ("credential_rejected", "none_terminal", "paired_user_inactive"),
        ),
    ],
)
async def test_device_owner_lookup_refusals(user: Any, expected: tuple) -> None:
    from app.services.coord_jwks import coord_jwks_client

    with (
        patch.object(
            coord_jwks_client,
            "verify_token",
            AsyncMock(return_value={"user_id": str(uuid4())}),
        ),
        patch("app.db.session.AsyncSessionLocal", _session_returning(user)),
        pytest.raises(HTTPException) as info,
    ):
        await deps._verify_device_jwt("t")
    assert info.value.status_code == 401
    assert _kind(info.value) == expected


@pytest.mark.parametrize(
    ("claims", "discriminator"),
    [
        ({}, "device_id_claim_missing"),
        ({"device_id": "nope"}, "device_id_claim_malformed"),
    ],
)
def test_unusable_device_id_claim_is_pair_device(
    claims: dict[str, str], discriminator: str
) -> None:
    ctx = deps.DeviceTokenContext(claims=claims, user=MagicMock())
    with pytest.raises(HTTPException) as info:
        _ = ctx.device_id
    assert _kind(info.value) == ("credential_rejected", "pair_device", discriminator)


@pytest.mark.asyncio
async def test_reporting_route_refuses_an_operator_with_fix_request() -> None:
    with pytest.raises(HTTPException) as info:
        await deps.get_reporting_device(user=MagicMock(), credentials=None)
    assert info.value.status_code == 403
    assert _kind(info.value) == (
        "permission_denied",
        "fix_request",
        "device_only_route",
    )
    assert info.value.detail == deps.DEVICE_ONLY_REFUSAL


@pytest.mark.asyncio
@pytest.mark.parametrize("dep", ["get_reporting_device", "get_paired_device"])
async def test_device_route_without_a_bearer_is_pair_device(dep: str) -> None:
    fn = getattr(deps, dep)
    kwargs: dict[str, Any] = {"credentials": None}
    if dep == "get_reporting_device":
        kwargs["user"] = None
    with pytest.raises(HTTPException) as info:
        await fn(**kwargs)
    assert info.value.status_code == 401
    assert _kind(info.value) == (
        "authentication_required",
        "pair_device",
        "no_device_credential",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("claims", "expected"),
    [
        (
            {"sub_type": "agent", "mint_provenance": "paired"},
            ("permission_denied", "pair_device", "not_a_device_principal"),
        ),
        (
            {"sub_type": "device", "mint_provenance": "bootstrap"},
            ("credential_rejected", "pair_device", "device_token_provenance_refused"),
        ),
    ],
)
async def test_paired_device_route_refusals(
    claims: dict[str, str], expected: tuple
) -> None:
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="t")
    with (
        patch.object(
            deps, "_verify_device_jwt", AsyncMock(return_value=(claims, MagicMock()))
        ),
        pytest.raises(HTTPException) as info,
    ):
        await deps.get_paired_device(credentials=creds)
    assert info.value.status_code == 403
    assert _kind(info.value) == expected
    # The legacy top-level `error` keeps the code clients matched on.
    assert info.value.error_code == expected[2]


class _Raising:
    """An ``httpx.AsyncClient`` stand-in whose every request raises ``exc``."""

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    async def __aenter__(self) -> _Raising:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def _raise(self, *args: object, **kwargs: object) -> None:
        raise self._exc

    get = post = put = patch = delete = _raise


def _client_raising(exc: Exception) -> Any:
    return patch.object(operations.httpx, "AsyncClient", lambda *a, **k: _Raising(exc))


_REQ = httpx.Request("GET", "http://coord.invalid/x")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("transport_error", "status", "expected"),
    [
        (
            httpx.ConnectError("refused", request=_REQ),
            502,
            ("upstream_unavailable", "retry_later", "coord_unreachable"),
        ),
        (
            httpx.ReadTimeout("slow", request=_REQ),
            504,
            ("upstream_timeout", "retry_later", "coord_timeout"),
        ),
    ],
)
async def test_coord_proxy_read_transport_failures(
    transport_error: Exception, status: int, expected: tuple
) -> None:
    with _client_raising(transport_error), pytest.raises(HTTPException) as info:
        await operations._proxy_coord_get("/x")
    assert info.value.status_code == status
    # Still the type other code dispatches on.
    assert isinstance(info.value, operations.CoordTransportUnavailable)
    assert _kind(info.value) == expected
    assert info.value.refusal.glossary_terms == [GlossaryTerm.coord]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("transport_error", "status", "expected"),
    [
        (
            httpx.ConnectError("refused", request=_REQ),
            502,
            ("upstream_unavailable", "retry_later", "coord_unreachable"),
        ),
        (
            httpx.ReadTimeout("slow", request=_REQ),
            504,
            ("upstream_timeout", "retry_later", "coord_write_timeout"),
        ),
        (
            httpx.RemoteProtocolError("cut", request=_REQ),
            504,
            ("upstream_timeout", "retry_later", "answer_lost"),
        ),
    ],
)
async def test_coord_proxy_write_transport_failures(
    transport_error: Exception, status: int, expected: tuple
) -> None:
    with _client_raising(transport_error), pytest.raises(HTTPException) as info:
        await operations._proxy_coord_write("put", "/x", {}, headers=None)
    assert info.value.status_code == status
    assert _kind(info.value) == expected
    # A write that may have landed never says a bare "retry": the re-read is
    # named, and only the connect failure (nothing sent) omits it.
    target = info.value.refusal.next_action.target
    if expected[2] == "coord_unreachable":
        assert target is None
    else:
        assert target == operations._REREAD_BEFORE_RETRY
        # The human detail carries it too, for a reader that shows `detail`
        # without the rendered next action.
        assert "re-read" in str(info.value.detail)


class _Answering:
    """An ``httpx.AsyncClient`` stand-in answering every request with ``resp``."""

    def __init__(self, resp: httpx.Response) -> None:
        self._resp = resp

    async def __aenter__(self) -> _Answering:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def _answer(self, *args: object, **kwargs: object) -> httpx.Response:
        return self._resp

    put = patch = _answer


@pytest.mark.asyncio
async def test_coord_write_answered_with_non_json_is_unknown_not_a_timeout() -> None:
    resp = httpx.Response(200, content=b"<html>ok</html>", request=_REQ)
    with (
        patch.object(operations.httpx, "AsyncClient", lambda *a, **k: _Answering(resp)),
        pytest.raises(HTTPException) as info,
    ):
        await operations._proxy_coord_write("patch", "/x", {}, headers=None)
    assert info.value.status_code == 504
    assert _kind(info.value) == ("unknown", "retry_later", "answer_not_json")
    assert info.value.refusal.next_action.target == operations._REREAD_BEFORE_RETRY
    assert "may have been applied" in info.value.detail


@pytest.mark.asyncio
async def test_coord_proxy_post_and_delete_transport_failures() -> None:
    connect = httpx.ConnectError("refused", request=_REQ)
    with _client_raising(connect), pytest.raises(HTTPException) as post_info:
        await operations._proxy_coord_post("/x", {})
    assert _kind(post_info.value) == (
        "upstream_unavailable",
        "retry_later",
        "coord_unreachable",
    )
    timeout = httpx.ReadTimeout("slow", request=_REQ)
    with _client_raising(timeout), pytest.raises(HTTPException) as delete_info:
        await operations._proxy_coord_delete("/x")
    assert _kind(delete_info.value) == (
        "upstream_timeout",
        "retry_later",
        "coord_write_timeout",
    )


@pytest.mark.asyncio
async def test_coord_read_timeout_carries_no_reread_target() -> None:
    timeout = httpx.ReadTimeout("slow", request=_REQ)
    with _client_raising(timeout), pytest.raises(HTTPException) as info:
        await operations._proxy_coord_get("/x")
    assert info.value.refusal.next_action.target is None
