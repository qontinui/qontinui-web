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

import ast
import inspect
import pathlib

import httpx
import pytest

from app.core.config import coord_device_setting_name
from app.services.coord_jwks import (
    CoordJWKSClient,
    CoordJWKSUnavailableError,
    coord_jwks_client,
    jwks_failure_log_fields,
)


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


# The two JWKS doors this backend verifies tokens against, each with its own
# unavailable-error class and its own shared log-field helper. One walk, both
# doors: the Cognito client is a hand-copy of the coord one, and it carried
# the pre-fix shape (``error=str(exc)`` alone, a raise naming no URL) for as
# long as this guard knew only the coord class. A third door added tomorrow
# is one more row here, not a third copy of the walk.
_JWKS_DOORS = [
    pytest.param("CoordJWKSUnavailableError", "jwks_failure_log_fields", 4, id="coord"),
    pytest.param(
        "CognitoJWKSUnavailableError",
        "cognito_jwks_failure_log_fields",
        2,
        id="cognito",
    ),
]


def _terminating_jwks_handlers(error_class: str) -> list[tuple[str, str]]:
    """Every ``except <error_class>`` handler that ENDS the error.

    Discovered by walking ``app/`` rather than enumerated, because an
    enumerated list is what let one of the coord handlers ship without the
    fields (``memory.py``'s, which kept ``error=str(exc)`` alone while the
    other two were fixed). A handler added tomorrow is caught by this walk.

    A bare ``raise`` handler is a pass-through, not a reporting site — the
    outer handler owns the log line — so it is excluded.

    Shapes this walk does NOT see, none present today: a catch through an
    attribute (``except cognito_jwks.CognitoJWKSUnavailableError`` is an
    ``ast.Attribute``, not an ``ast.Name``), an aliased import (``import …
    as X``), and a handler that ends the error through a base class
    (``except RuntimeError`` around ``verify_token``). Any of those would
    pass here silently; grep for the class before trusting a green run
    after adding a handler in one of those spellings.
    """
    app_root = pathlib.Path(__file__).resolve().parents[1] / "app"
    found: list[tuple[str, str]] = []

    for py in sorted(app_root.rglob("*.py")):
        source = py.read_text(encoding="utf-8")
        if error_class not in source:
            continue
        for node in ast.walk(ast.parse(source)):
            if not isinstance(node, ast.ExceptHandler) or node.type is None:
                continue
            caught = {n.id for n in ast.walk(node.type) if isinstance(n, ast.Name)}
            if error_class not in caught:
                continue
            # A pass-through re-raise reports nothing; the caller does.
            if all(
                isinstance(stmt, ast.Raise) and stmt.exc is None for stmt in node.body
            ):
                continue
            body = "\n".join(ast.unparse(stmt) for stmt in node.body)
            found.append((f"{py.relative_to(app_root.parent)}:{node.lineno}", body))

    return found


@pytest.mark.parametrize(("error_class", "helper", "known_count"), _JWKS_DOORS)
def test_every_terminating_jwks_handler_logs_the_diagnostic_fields(
    error_class: str, helper: str, known_count: int
) -> None:
    """Every reporting handler routes its log through its door's field set.

    Source-level pin: the caller sees only the vague close reason / 503
    detail, so a handler that logs ``error=str(exc)`` alone silently
    restores the undiagnosable state without failing anything else. That is
    not hypothetical — it is the state ``memory.py`` was left in on the
    coord door, and the state BOTH Cognito handlers were left in for as long
    as this walk knew only the coord class.
    """
    handlers = _terminating_jwks_handlers(error_class)

    # A walk that finds nothing must fail rather than pass vacuously.
    assert len(handlers) >= known_count, (
        f"expected at least the {known_count} known reporting handlers for "
        f"{error_class}, found {[where for where, _ in handlers]}"
    )

    for where, body in handlers:
        assert f"{helper}(exc)" in body, (
            f"{where}: the {error_class} handler must log **{helper}(exc) — "
            f"logging str(exc) alone cannot separate a wrong URL setting from "
            f"an unreachable upstream.\n{body}"
        )


def test_the_shared_field_set_names_url_class_and_chained_cause() -> None:
    """The helper carries all four fields, cause included, for a real chain."""
    try:
        try:
            raise httpx.ConnectTimeout("timed out")
        except httpx.ConnectTimeout as transport_exc:
            raise CoordJWKSUnavailableError("boom") from transport_exc
    except CoordJWKSUnavailableError as exc:
        fields = jwks_failure_log_fields(exc)

    assert fields["error"] == "boom"
    assert fields["failure"] == "CoordJWKSUnavailableError"
    assert fields["cause"] == "ConnectTimeout", (
        "the chained transport class is the half that says WHICH fault it was."
    )
    assert fields["coord_url"] == coord_jwks_client.coord_url
    assert fields["coord_url_setting"] == coord_device_setting_name(), (
        "the log must name the SETTING that produced the URL, not just the URL."
    )


def test_the_setting_name_is_derived_not_written_out() -> None:
    """``coord_url_setting`` is pinned for the same reason it is pinned on the
    identity alarm: TWO settings can produce the URL logged beside it and they
    are not interchangeable. It must be DERIVED — a literal ``"COORD_URL"`` or
    ``"COORD_DEVICE_URL"`` in the field set is right for one deployment only,
    which is the drift this pin exists to catch."""
    source = inspect.getsource(jwks_failure_log_fields)
    assert '"coord_url_setting": coord_device_setting_name()' in source
    assert '"COORD_URL"' not in source and '"COORD_DEVICE_URL"' not in source


def test_the_shared_field_set_tolerates_an_unchained_error() -> None:
    """A raise with no ``from`` reports ``cause=None``, not a crash."""
    fields = jwks_failure_log_fields(CoordJWKSUnavailableError("no chain"))
    assert fields["cause"] is None
