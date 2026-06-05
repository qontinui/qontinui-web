"""Unit tests for ``_get_refresh_token_subject`` rate-limit keying.

Added with the python-jose -> PyJWT migration (the lazy ``from jose import
jwt`` HS256 decode in ``app/middleware/rate_limit.py`` became ``import jwt``).
Locks the behavior that python-jose previously provided so the swap is
verified by behavior, not by import success:

  * a valid refresh-token cookie buckets per-user (``refresh-user:<sub>``),
  * a garbage / unsigned token falls back to IP keying,
  * an expired token falls back to IP keying (PyJWT validates ``exp`` by
    default, same as python-jose did).
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import jwt

from app.core.config import settings
from app.middleware.rate_limit import _get_refresh_token_subject


def _mock_request(*, cookie: str | None = None, client_host: str = "203.0.113.7") -> MagicMock:
    """A FastAPI Request stand-in: refresh_token cookie + a client IP."""
    request = MagicMock()
    request.cookies = {"refresh_token": cookie} if cookie else {}
    # slowapi's get_remote_address reads request.client.host (no forwarded hdr)
    request.headers = {}
    request.client = SimpleNamespace(host=client_host)
    return request


def _make_token(sub: str, *, exp_offset: int = 3600) -> str:
    payload: dict[str, object] = {"sub": sub}
    if exp_offset is not None:
        payload["exp"] = int(time.time()) + exp_offset
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def test_valid_token_buckets_per_user() -> None:
    token = _make_token("user-abc-123")
    request = _mock_request(cookie=token)

    assert _get_refresh_token_subject(request) == "refresh-user:user-abc-123"


def test_garbage_token_falls_back_to_ip() -> None:
    request = _mock_request(cookie="not-a-jwt", client_host="198.51.100.4")

    assert _get_refresh_token_subject(request) == "ip:198.51.100.4"


def test_expired_token_falls_back_to_ip() -> None:
    # exp 60s in the past -> PyJWT raises ExpiredSignatureError, caught by the
    # except-Exception fallback (same contract python-jose enforced).
    token = _make_token("user-xyz", exp_offset=-60)
    request = _mock_request(cookie=token, client_host="198.51.100.9")

    assert _get_refresh_token_subject(request) == "ip:198.51.100.9"


def test_wrong_signature_falls_back_to_ip() -> None:
    bad = jwt.encode(
        {"sub": "user-xyz", "exp": int(time.time()) + 3600},
        "a-totally-different-secret-key-not-the-app-one",
        algorithm=settings.ALGORITHM,
    )
    request = _mock_request(cookie=bad, client_host="198.51.100.22")

    assert _get_refresh_token_subject(request) == "ip:198.51.100.22"


def test_no_cookie_falls_back_to_ip() -> None:
    request = _mock_request(cookie=None, client_host="198.51.100.30")

    assert _get_refresh_token_subject(request) == "ip:198.51.100.30"
