"""The coord-JWKS failure path must be diagnosable from the log alone.

W2 of ``plans/2026-08-27-mobile-cloud-relay-unreachable-remediation.md``.

A runner's WS handshake was rejected with ``1011 "Device authentication
temporarily unavailable."`` on every attempt while coord answered the same
JWKS URL in 0.3s from the same host. The rejection message is deliberately
vague (it becomes the runner's ``last_error``), so the *log line* is the
whole diagnostic surface — and it named neither the coord URL actually
dialled nor the concrete transport exception class. A wrong
``COORD_DEVICE_URL`` and a genuinely slow coord were indistinguishable.

These tests pin both halves, on the raise site and on the handler.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.coord_jwks import CoordJWKSClient, CoordJWKSUnavailableError


@pytest.mark.asyncio
async def test_transport_failure_names_url_timeout_and_exception_class(
    monkeypatch,
):
    """A transport fault carries url, timeout and the concrete class."""
    client = CoordJWKSClient(coord_url="https://coord.example.test", http_timeout_s=3.5)

    class _FailingAsyncClient:
        def __init__(self, *a, **kw) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(
        "app.services.coord_jwks.httpx.AsyncClient", _FailingAsyncClient
    )

    with pytest.raises(CoordJWKSUnavailableError) as excinfo:
        await client.get_jwks()

    message = str(excinfo.value)
    assert "https://coord.example.test/coord/auth/jwks" in message, (
        "the resolved coord URL is the half that distinguishes a config "
        "error from an outage; it must be in the message."
    )
    assert "ConnectTimeout" in message, (
        "the concrete exception class must be named — httpx renders many "
        "transport faults with an empty str()."
    )
    assert "3.5" in message, "the timeout actually applied must be readable."
    # The original exception stays chained so the handler can name the cause.
    assert isinstance(excinfo.value.__cause__, httpx.ConnectTimeout)


@pytest.mark.asyncio
async def test_non_200_and_bad_body_failures_also_name_the_url(monkeypatch):
    """The HTTP-status and malformed-body arms name the URL too."""

    class _Resp:
        def __init__(self, status_code, payload=None, text=""):
            self.status_code = status_code
            self._payload = payload
            self.text = text

        def json(self):
            if self._payload is None:
                raise ValueError("not json")
            return self._payload

    def _client_returning(resp):
        class _C:
            def __init__(self, *a, **kw) -> None:
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, url):
                return resp

        return _C

    url_fragment = "https://coord.example.test/coord/auth/jwks"

    for resp in (
        _Resp(503, text="upstream down"),
        _Resp(200, payload=None, text="<html>"),
        _Resp(200, payload={"not_keys": []}),
    ):
        client = CoordJWKSClient(coord_url="https://coord.example.test")
        monkeypatch.setattr(
            "app.services.coord_jwks.httpx.AsyncClient", _client_returning(resp)
        )
        with pytest.raises(CoordJWKSUnavailableError) as excinfo:
            await client.get_jwks()
        assert url_fragment in str(excinfo.value)


def test_client_exposes_the_resolved_coord_url() -> None:
    """Handlers need the dialled URL without re-deriving it from settings."""
    client = CoordJWKSClient(coord_url="https://coord.example.test/")
    assert client.coord_url == "https://coord.example.test"


def test_rejection_handlers_log_url_and_exception_class() -> None:
    """Both ``CoordJWKSUnavailableError`` handlers log the URL and the class.

    Source-level pin: the runner sees only the vague close reason / 503
    detail, so losing these fields from the log silently restores the
    undiagnosable state without failing anything else.

    ``coord_url_setting`` is pinned here for the same reason it is pinned on
    the identity alarm: TWO settings can produce the URL logged beside it and
    they are not interchangeable, so the URL alone leaves the reader guessing
    which knob to turn. It must be DERIVED — a literal ``"COORD_URL"`` or
    ``"COORD_DEVICE_URL"`` in the handler is right for one deployment only,
    which is the drift this pin exists to catch.
    """
    import inspect

    from app.api import deps
    from app.api.v1.endpoints import devices_ws

    for func in (devices_ws.websocket_device_unified_endpoint, deps._verify_device_jwt):
        source = inspect.getsource(func)
        # Narrow to the JWKS-unavailable handler. The bound is the START of
        # the NEXT `except` clause, not a byte count: a fixed window silently
        # shrinks the region being asserted on as the handler's comments grow,
        # so a `logger.error` pushed past it reads as a MISSING field. That is
        # a false failure in the same test whose job is to catch a real one.
        idx = source.index("except CoordJWKSUnavailableError")
        rest = source[idx + 1 :]
        nxt = rest.find("\n    except ")
        handler = rest[:nxt] if nxt != -1 else rest
        assert "coord_url=coord_jwks_client.coord_url" in handler, (
            f"{func.__name__} must log the coord URL it dialled."
        )
        assert "failure=type(exc).__name__" in handler, (
            f"{func.__name__} must log the exception class, not just str(exc)."
        )
        assert "cause=" in handler, (
            f"{func.__name__} must log the chained transport cause."
        )
        assert "coord_url_setting=coord_device_setting_name()" in handler, (
            f"{func.__name__} must name the SETTING that produced the URL, "
            f"derived from the configuration in force."
        )
