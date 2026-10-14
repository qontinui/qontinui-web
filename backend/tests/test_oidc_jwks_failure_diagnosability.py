"""The OIDC-JWKS failure path must be diagnosable from the log alone.

The OIDC twin of ``test_coord_jwks_failure_diagnosability.py``. A fetch
failure names the URL dialled (the discovery document or the JWKS it points
at) and the concrete transport class, and every terminating handler logs one
shared field set — issuer, URL, the setting that configured the issuer, and
the chained cause. The handler walk itself lives in the coord file and covers
this door too.
"""

from __future__ import annotations

import inspect

import httpx
import pytest

from app.core.config import (
    OIDCProviderSetting,
    Settings,
    cognito_issuer_setting_name,
    derived_cognito_issuer,
    settings,
)
from app.services.oidc_jwks import (
    OIDCIssuerClient,
    OIDCJWKSUnavailableError,
    OIDCProvider,
    build_providers,
    oidc_jwks_failure_log_fields,
)

_ISSUER = "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_TESTPOOL"
_DISCOVERY = f"{_ISSUER}/.well-known/openid-configuration"


def _client(**kw) -> OIDCIssuerClient:
    provider = OIDCProvider(
        issuer=_ISSUER,
        audiences=frozenset({"aud-1"}),
        audience_claims=("aud", "client_id"),
        groups_claim="cognito:groups",
        issuer_setting="COGNITO_ISSUER",
        kind="cognito",
    )
    return OIDCIssuerClient(provider, **kw)


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

    monkeypatch.setattr("app.services.oidc_jwks.httpx.AsyncClient", _FailingAsyncClient)

    with pytest.raises(OIDCJWKSUnavailableError) as excinfo:
        await client._fetch_metadata()

    message = str(excinfo.value)
    assert _DISCOVERY in message, (
        "the dialled URL is the half that distinguishes a wrong issuer from "
        "an outage; it must be in the message."
    )
    assert "ConnectTimeout" in message, (
        "the concrete exception class must be named — httpx renders many "
        "transport faults with an empty str()."
    )
    assert "3.5" in message, "the timeout actually applied must be readable."
    assert isinstance(excinfo.value.__cause__, httpx.ConnectTimeout)
    assert excinfo.value.url == _DISCOVERY
    assert excinfo.value.issuer == _ISSUER
    assert excinfo.value.issuer_setting == "COGNITO_ISSUER"


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

    for resp in (
        _Resp(503, text="upstream down"),
        _Resp(200, payload=None, text="<html>"),
        _Resp(200, payload=["not", "an", "object"]),
        _Resp(200, payload={"issuer": _ISSUER}),  # no jwks_uri
        _Resp(200, payload={"issuer": "https://other.example", "jwks_uri": "x"}),
    ):
        monkeypatch.setattr(
            "app.services.oidc_jwks.httpx.AsyncClient", _client_returning(resp)
        )
        with pytest.raises(OIDCJWKSUnavailableError) as excinfo:
            await _client()._fetch_metadata()
        assert _DISCOVERY in str(excinfo.value)


def test_client_exposes_the_dialled_urls() -> None:
    """Handlers need the dialled URLs without re-deriving them from settings."""
    client = _client()
    assert client.discovery_url == _DISCOVERY
    assert client.jwks_url is None, "no jwks_uri is known before discovery runs"


def test_the_shared_field_set_names_url_class_and_chained_cause() -> None:
    """The helper carries every field, cause included, for a real chain."""
    try:
        try:
            raise httpx.ConnectTimeout("timed out")
        except httpx.ConnectTimeout as transport_exc:
            raise OIDCJWKSUnavailableError(
                "boom",
                issuer=_ISSUER,
                url=_DISCOVERY,
                issuer_setting="COGNITO_ISSUER",
            ) from transport_exc
    except OIDCJWKSUnavailableError as exc:
        fields = oidc_jwks_failure_log_fields(exc)

    assert fields["error"] == "boom"
    assert fields["failure"] == "OIDCJWKSUnavailableError"
    assert fields["cause"] == "ConnectTimeout", (
        "the chained transport class is the half that says WHICH fault it was."
    )
    assert fields["url"] == _DISCOVERY
    assert fields["issuer"] == _ISSUER
    assert fields["issuer_setting"] == "COGNITO_ISSUER"


@pytest.mark.usefixtures("_no_cognito_env")
def test_the_cognito_provider_names_its_setting_by_derivation() -> None:
    """The Cognito provider's ``issuer_setting`` is DERIVED, not written out.

    Two spellings produce the Cognito issuer (an explicit ``COGNITO_ISSUER``,
    or ``COGNITO_REGION`` + ``COGNITO_USER_POOL_ID``) and they are not
    interchangeable, so the field the failure log carries must come from
    :func:`cognito_issuer_setting_name`. Generic issuers name their
    ``OIDC_PROVIDERS`` index.
    """
    source = inspect.getsource(build_providers)
    assert "issuer_setting=cognito_issuer_setting_name(cfg)" in source
    assert '"COGNITO_ISSUER"' not in source

    cfg = Settings(
        _env_file=None,
        DATABASE_URL=_ISOLATED_DB,
        COGNITO_REGION="eu-west-1",
        COGNITO_USER_POOL_ID="eu-west-1_TESTPOOL",
        OIDC_PROVIDERS=[
            OIDCProviderSetting(
                issuer="https://login.example.com/realms/acme",
                audiences=["qontinui-web"],
            )
        ],
    )
    cognito, generic = build_providers(cfg)
    assert cognito.issuer_setting == cognito_issuer_setting_name(cfg)
    assert generic.issuer_setting == "OIDC_PROVIDERS[0]"


def test_the_shared_field_set_tolerates_an_unchained_error() -> None:
    """A raise with no ``from`` reports ``cause=None``, not a crash."""
    fields = oidc_jwks_failure_log_fields(OIDCJWKSUnavailableError("no chain"))
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
