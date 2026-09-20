"""The Cognito-JWKS failure path must be diagnosable from the log alone.

The Cognito twin of ``test_coord_jwks_failure_diagnosability.py``. W2 of
``plans/2026-08-27-mobile-cloud-relay-unreachable-remediation.md`` repaired
the coord door: a fetch failure names the URL dialled and the concrete
transport class, and every terminating handler logs one shared field set.
``cognito_jwks.py`` is a hand-copy of that client, and it kept the pre-fix
shape — a transport raise of ``f"...: {exc}"`` with no URL, and both
handlers logging ``error=str(exc)`` alone — because the guard that caught
the coord drift only knew the coord class. Same defect, one door over.

These tests pin the raise site and the shared field set; the handler walk
itself lives in the coord file and now covers both doors.
"""

from __future__ import annotations

import inspect

import httpx
import pytest

from app.core.config import (
    Settings,
    cognito_issuer_setting_name,
    derived_cognito_issuer,
    settings,
)
from app.services.cognito_jwks import (
    CognitoJWKSClient,
    CognitoJWKSUnavailableError,
    cognito_jwks_client,
    cognito_jwks_failure_log_fields,
)

_ISSUER = "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_TESTPOOL"


def _client(**kw) -> CognitoJWKSClient:
    return CognitoJWKSClient(issuer=_ISSUER, allowed_audiences=["aud-1"], **kw)


@pytest.mark.asyncio
async def test_transport_failure_names_url_timeout_and_exception_class(
    monkeypatch,
):
    """A transport fault carries url, timeout and the concrete class."""
    client = _client(http_timeout_s=3.5)

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
        "app.services.cognito_jwks.httpx.AsyncClient", _FailingAsyncClient
    )

    with pytest.raises(CognitoJWKSUnavailableError) as excinfo:
        await client._fetch_jwks()

    message = str(excinfo.value)
    assert f"{_ISSUER}/.well-known/jwks.json" in message, (
        "the resolved JWKS URL is the half that distinguishes a wrong issuer "
        "from an outage; it must be in the message."
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

    url_fragment = f"{_ISSUER}/.well-known/jwks.json"

    for resp in (
        _Resp(503, text="upstream down"),
        _Resp(200, payload=None, text="<html>"),
        _Resp(200, payload={"not_keys": []}),
    ):
        monkeypatch.setattr(
            "app.services.cognito_jwks.httpx.AsyncClient", _client_returning(resp)
        )
        with pytest.raises(CognitoJWKSUnavailableError) as excinfo:
            await _client()._fetch_jwks()
        assert url_fragment in str(excinfo.value)


def test_client_exposes_the_dialled_jwks_url() -> None:
    """Handlers need the dialled URL without re-deriving it from settings."""
    assert _client().jwks_url == f"{_ISSUER}/.well-known/jwks.json"
    assert _client(jwks_url="https://keys.example.test/x").jwks_url == (
        "https://keys.example.test/x"
    ), "an explicit jwks_url override is what was dialled, so it is what is named"


def test_the_shared_field_set_names_url_class_and_chained_cause() -> None:
    """The helper carries every field, cause included, for a real chain."""
    try:
        try:
            raise httpx.ConnectTimeout("timed out")
        except httpx.ConnectTimeout as transport_exc:
            raise CognitoJWKSUnavailableError("boom") from transport_exc
    except CognitoJWKSUnavailableError as exc:
        fields = cognito_jwks_failure_log_fields(exc)

    assert fields["error"] == "boom"
    assert fields["failure"] == "CognitoJWKSUnavailableError"
    assert fields["cause"] == "ConnectTimeout", (
        "the chained transport class is the half that says WHICH fault it was."
    )
    assert fields["jwks_url"] == cognito_jwks_client.jwks_url
    assert fields["issuer_setting"] == cognito_issuer_setting_name(), (
        "the log must name the SETTING that produced the URL, not just the URL."
    )


def test_the_setting_name_is_derived_not_written_out() -> None:
    """``issuer_setting`` is pinned for the same reason the coord field is:
    TWO spellings produce the issuer (an explicit ``COGNITO_ISSUER``, or
    ``COGNITO_REGION`` + ``COGNITO_USER_POOL_ID``) and they are not
    interchangeable. It must be DERIVED — a literal in the field set is right
    for one deployment only, which is the drift this pin exists to catch."""
    source = inspect.getsource(cognito_jwks_failure_log_fields)
    assert '"issuer_setting": cognito_issuer_setting_name()' in source
    assert '"COGNITO_ISSUER"' not in source
    assert '"COGNITO_REGION' not in source


def test_the_shared_field_set_tolerates_an_unchained_error() -> None:
    """A raise with no ``from`` reports ``cause=None``, not a crash."""
    fields = cognito_jwks_failure_log_fields(CognitoJWKSUnavailableError("no chain"))
    assert fields["cause"] is None


_ISOLATED_DB = "postgresql://user:pass@localhost/isolated"


def _settings(**cognito: str) -> Settings:
    """A Settings with ONLY the given Cognito fields supplied, env ignored.

    ``_env_file=None`` and the cleared env keep ``model_fields_set`` honest:
    the predicate under test reads it, so a developer's ``.env`` or shell
    ``COGNITO_ISSUER`` must not leak into what "supplied" means here.
    """
    return Settings(_env_file=None, DATABASE_URL=_ISOLATED_DB, **cognito)


@pytest.fixture
def _no_cognito_env(monkeypatch):
    for name in ("COGNITO_ISSUER", "COGNITO_REGION", "COGNITO_USER_POOL_ID"):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.usefixtures("_no_cognito_env")
def test_setting_name_never_supplied_names_the_pair() -> None:
    """``COGNITO_ISSUER`` never supplied: the pair produced it, for certain."""
    cfg = _settings(
        COGNITO_REGION="eu-west-1", COGNITO_USER_POOL_ID="eu-west-1_TESTPOOL"
    )
    assert cfg.COGNITO_ISSUER == _ISSUER, "precondition: the validator derived it"
    assert "COGNITO_ISSUER" not in cfg.model_fields_set
    assert cognito_issuer_setting_name(cfg) == "COGNITO_REGION + COGNITO_USER_POOL_ID"


@pytest.mark.usefixtures("_no_cognito_env")
def test_setting_name_explicit_override_names_the_issuer() -> None:
    """An explicit issuer that differs from the derivation names ``COGNITO_ISSUER``."""
    cfg = _settings(
        COGNITO_ISSUER="https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OTHER",
        COGNITO_REGION="eu-west-1",
        COGNITO_USER_POOL_ID="eu-west-1_TESTPOOL",
    )
    assert cognito_issuer_setting_name(cfg) == "COGNITO_ISSUER", (
        "with an explicit issuer in force, repointing the region or pool id "
        "changes nothing — the log must send the operator to the knob that does."
    )


@pytest.mark.usefixtures("_no_cognito_env")
def test_setting_name_supplied_and_equal_to_derivation_still_names_the_issuer() -> None:
    """The ambiguous corner errs toward the knob that always moves the issuer.

    A ``.env`` copied from a template commonly carries the canonical issuer
    written out. After the validator runs, that is indistinguishable from a
    blank value it filled in — yet with the explicit spelling in force,
    repointing the region or pool id moves NOTHING (verified below). Naming
    the pair there would send the operator to two knobs that do nothing;
    naming ``COGNITO_ISSUER`` works in both readings, so that is the answer,
    with the agreement stated so a reader is not surprised by the equality.
    """
    explicit_equal = _settings(
        COGNITO_ISSUER=_ISSUER,
        COGNITO_REGION="eu-west-1",
        COGNITO_USER_POOL_ID="eu-west-1_TESTPOOL",
    )
    blank_supplied = _settings(
        COGNITO_ISSUER="",
        COGNITO_REGION="eu-west-1",
        COGNITO_USER_POOL_ID="eu-west-1_TESTPOOL",
    )
    assert explicit_equal.COGNITO_ISSUER == blank_supplied.COGNITO_ISSUER == _ISSUER, (
        "precondition: the two configurations are indistinguishable by value"
    )

    # The trap the answer must not walk into: the explicit spelling wins,
    # so a region repoint leaves the issuer where it was.
    repointed = _settings(
        COGNITO_ISSUER=_ISSUER,
        COGNITO_REGION="us-east-1",
        COGNITO_USER_POOL_ID="eu-west-1_TESTPOOL",
    )
    assert repointed.COGNITO_ISSUER == _ISSUER

    for cfg in (explicit_equal, blank_supplied):
        answer = cognito_issuer_setting_name(cfg)
        assert answer.startswith("COGNITO_ISSUER"), answer
        assert "COGNITO_REGION + COGNITO_USER_POOL_ID" in answer, (
            "the agreement with the derivation is stated, not hidden"
        )


def test_setting_name_defaults_to_the_process_settings() -> None:
    """No argument reads the process-wide ``settings`` — what handlers log."""
    assert cognito_issuer_setting_name() == cognito_issuer_setting_name(settings)


def test_validator_and_setting_name_share_one_derivation() -> None:
    """Both consumers of the derived-issuer format read the same function.

    If the validator re-typed the URL format, ``cognito_issuer_setting_name``
    could compare against a spelling the validator never produces and name
    ``COGNITO_ISSUER`` on every derived deployment.
    """
    assert derived_cognito_issuer(region="eu-west-1", pool_id="eu-west-1_TESTPOOL") == (
        _ISSUER
    )
    assert derived_cognito_issuer(region="", pool_id="eu-west-1_TESTPOOL") == ""
    assert derived_cognito_issuer(region="eu-west-1", pool_id="") == ""
    assert "derived_cognito_issuer(" in inspect.getsource(
        Settings.derive_cognito_issuer
    )
