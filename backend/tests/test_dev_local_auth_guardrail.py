"""Tests for the dev-local-auth on-ramp guardrail in ``app.core.config``.

Phase 1 of the local web UI-Bridge verification on-ramp adds a fail-fast
guardrail so the hermetic local IdP can NEVER be trusted under a production
posture, plus an isolated-DB guard so the JIT-provisioned dev user cannot
pollute the shared dev database. These tests pin both, and pin that
local-auth is OFF by default (normal Cognito posture unchanged).

The guardrail lives in a ``model_validator(mode="after")`` on ``Settings``, so
it fires at settings-instantiation time — before the app can boot — and a
violation surfaces as a pydantic ``ValidationError``. Each test constructs a
fresh ``Settings`` with explicit kwargs (init kwargs win over env/.env), so it
does not depend on the ambient environment.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings

# A well-formed, non-loopback PostgreSQL DSN with an isolated (non-shared) db.
_ISOLATED_DB = "postgresql://u:p@localhost:5433/qontinui_local_auth"
# The real Cognito issuer shape (non-loopback) — normal prod posture.
_REAL_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_rgTB9dbZ1"
_LOCAL_ISSUER = "http://127.0.0.1:8770"


class TestProdGuardrail:
    """Under a production posture the local-auth seams must refuse to boot."""

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_prod_posture_with_dev_flag_refuses(self, environment: str) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT=environment,
                QONTINUI_DEV_LOCAL_AUTH=True,
                COGNITO_ISSUER=_REAL_ISSUER,
                DATABASE_URL=_ISOLATED_DB,
            )
        msg = str(exc.value)
        assert "Refusing to boot" in msg
        assert "QONTINUI_DEV_LOCAL_AUTH is set" in msg

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_prod_posture_with_loopback_issuer_refuses(
        self, environment: str
    ) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT=environment,
                QONTINUI_DEV_LOCAL_AUTH=False,
                COGNITO_ISSUER=_LOCAL_ISSUER,
                DATABASE_URL=_ISOLATED_DB,
            )
        msg = str(exc.value)
        assert "Refusing to boot" in msg
        assert "loopback" in msg

    def test_prod_posture_reports_both_reasons(self) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT="staging",
                QONTINUI_DEV_LOCAL_AUTH=True,
                COGNITO_ISSUER=_LOCAL_ISSUER,
                DATABASE_URL=_ISOLATED_DB,
            )
        msg = str(exc.value)
        assert "QONTINUI_DEV_LOCAL_AUTH is set" in msg
        assert "loopback" in msg
        assert " and " in msg

    @pytest.mark.parametrize(
        "issuer",
        [
            "http://localhost:8770",
            "http://127.0.0.1:8770",
            "http://127.0.0.2:8770",  # anywhere in 127.0.0.0/8
            "http://host.docker.internal:8770",
            "http://0.0.0.0:8770",
            "http://LOCALHOST:8770",  # case-insensitive
            "http://localhost.:8770",  # trailing-dot FQDN
            "http://app.localhost:8770",  # RFC 6761 .localhost subdomain
            "http://[::1]:8770",  # IPv6 loopback
            "http://[0:0:0:0:0:0:0:1]:8770",  # expanded IPv6 loopback
            "http://[::ffff:127.0.0.1]:8770",  # IPv4-mapped IPv6 loopback
        ],
    )
    def test_loopback_host_variants_all_caught(self, issuer: str) -> None:
        with pytest.raises(ValidationError):
            Settings(
                ENVIRONMENT="production",
                COGNITO_ISSUER=issuer,
                DATABASE_URL=_ISOLATED_DB,
            )

    @pytest.mark.parametrize(
        "issuer",
        [
            _REAL_ISSUER,
            "https://accounts.example.com/pool",
            "http://10.0.0.5:8770",  # private but NOT loopback
        ],
    )
    def test_non_loopback_issuers_boot_in_prod(self, issuer: str) -> None:
        settings = Settings(
            ENVIRONMENT="production",
            COGNITO_ISSUER=issuer,
            DATABASE_URL="postgresql://u:p@db.internal:5432/qontinui_prod",
        )
        assert settings.cognito_issuer_is_loopback is False

    def test_prod_posture_with_real_cognito_boots(self) -> None:
        """Normal prod posture (real issuer, flag off) is unaffected."""
        settings = Settings(
            ENVIRONMENT="production",
            QONTINUI_DEV_LOCAL_AUTH=False,
            COGNITO_ISSUER=_REAL_ISSUER,
            DATABASE_URL="postgresql://u:p@db.internal:5432/qontinui_prod",
        )
        assert settings.QONTINUI_DEV_LOCAL_AUTH is False
        assert settings.is_production_posture is True
        assert settings.cognito_issuer_is_loopback is False


class TestLocalAuthOffByDefault:
    """No flag => normal Cognito posture, unchanged."""

    def test_default_flag_is_false(self) -> None:
        settings = Settings(
            ENVIRONMENT="development",
            COGNITO_ISSUER=_REAL_ISSUER,
            DATABASE_URL=_ISOLATED_DB,
        )
        assert settings.QONTINUI_DEV_LOCAL_AUTH is False

    def test_development_derives_real_cognito_issuer_by_default(self) -> None:
        """With COGNITO_ISSUER unset it derives the real Cognito issuer (not loopback)."""
        settings = Settings(
            ENVIRONMENT="development",
            COGNITO_ISSUER="",
            COGNITO_REGION="us-east-1",
            COGNITO_USER_POOL_ID="us-east-1_rgTB9dbZ1",
            DATABASE_URL=_ISOLATED_DB,
        )
        assert settings.COGNITO_ISSUER == _REAL_ISSUER
        assert settings.cognito_issuer_is_loopback is False


class TestDevPostureAllowsLocalAuth:
    """Under a dev posture the local-auth seam is allowed — with isolation."""

    def test_dev_local_auth_with_isolated_db_boots(self) -> None:
        settings = Settings(
            ENVIRONMENT="development",
            QONTINUI_DEV_LOCAL_AUTH=True,
            COGNITO_ISSUER=_LOCAL_ISSUER,
            COGNITO_ALLOWED_AUDIENCES="qontinui-web-local",
            DATABASE_URL=_ISOLATED_DB,
        )
        assert settings.QONTINUI_DEV_LOCAL_AUTH is True
        assert settings.cognito_issuer_is_loopback is True
        assert settings.is_production_posture is False

    @pytest.mark.parametrize(
        "shared_db",
        [
            "postgresql://qontinui_user:pw@localhost:5433/qontinui_db",
            "postgresql://u:p@localhost/db",
            "postgresql://u:p@localhost:5433/QONTINUI_DB",  # case-insensitive
        ],
    )
    def test_dev_local_auth_against_shared_db_refuses(self, shared_db: str) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT="development",
                QONTINUI_DEV_LOCAL_AUTH=True,
                COGNITO_ISSUER=_LOCAL_ISSUER,
                DATABASE_URL=shared_db,
            )
        msg = str(exc.value)
        assert "ISOLATED database" in msg
        assert "qontinui_local_auth" in msg


class TestFailClosedPosture:
    """M1 — ``is_production_posture`` derives prod by EXCLUSION (fail-closed).

    Anything that is not literal ``development`` is production posture, so the
    guardrail can never go inert because ENVIRONMENT drifted to an unexpected
    value. ``validate_environment`` first normalises case/whitespace (so a
    mis-cased/padded prod value maps to canonical) and rejects genuinely unknown
    values outright — either way an unsafe posture never boots the local seams.
    """

    @pytest.mark.parametrize(
        "environment",
        ["Production", "staging "],  # normalise to a known prod value
    )
    def test_miscased_prod_posture_with_flag_refuses(self, environment: str) -> None:
        """Mis-cased/padded prod values normalise, are seen as prod, and refuse."""
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT=environment,
                QONTINUI_DEV_LOCAL_AUTH=True,
                COGNITO_ISSUER=_REAL_ISSUER,
                DATABASE_URL=_ISOLATED_DB,
            )
        assert "Refusing to boot" in str(exc.value)

    @pytest.mark.parametrize(
        "environment",
        ["Production", "staging "],
    )
    def test_miscased_prod_posture_with_loopback_issuer_refuses(
        self, environment: str
    ) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT=environment,
                QONTINUI_DEV_LOCAL_AUTH=False,
                COGNITO_ISSUER=_LOCAL_ISSUER,
                DATABASE_URL=_ISOLATED_DB,
            )
        assert "Refusing to boot" in str(exc.value)

    @pytest.mark.parametrize("environment", ["", "prod", "PRODUCTION", "qa", "  "])
    def test_unknown_or_empty_environment_refuses_to_boot(
        self, environment: str
    ) -> None:
        """Genuinely unknown/empty values never boot — even with a real issuer.

        The app refuses rather than run under an ambiguous trust posture. (An
        exception: ``PRODUCTION`` normalises to ``production`` and boots cleanly
        with a real issuer + flag off — the safe outcome, proven separately.)
        """
        with pytest.raises(ValidationError):
            Settings(
                ENVIRONMENT=environment,
                QONTINUI_DEV_LOCAL_AUTH=True,
                COGNITO_ISSUER=_LOCAL_ISSUER,
                DATABASE_URL=_ISOLATED_DB,
            )

    def test_miscased_normalises_and_is_production_posture(self) -> None:
        """``Production`` normalises to ``production`` and reads as prod posture."""
        settings = Settings(
            ENVIRONMENT="Production",
            COGNITO_ISSUER=_REAL_ISSUER,
            DATABASE_URL="postgresql://u:p@db.internal:5432/qontinui_prod",
        )
        assert settings.ENVIRONMENT == "production"
        assert settings.is_production_posture is True

    def test_padded_staging_normalises_and_boots_with_real_issuer(self) -> None:
        settings = Settings(
            ENVIRONMENT="staging ",
            COGNITO_ISSUER=_REAL_ISSUER,
            DATABASE_URL="postgresql://u:p@db.internal:5432/qontinui_prod",
        )
        assert settings.ENVIRONMENT == "staging"
        assert settings.is_production_posture is True

    def test_miscased_development_is_not_production_posture(self) -> None:
        """`` Development `` normalises to dev posture and may run local-auth."""
        settings = Settings(
            ENVIRONMENT=" Development ",
            QONTINUI_DEV_LOCAL_AUTH=True,
            COGNITO_ISSUER=_LOCAL_ISSUER,
            DATABASE_URL=_ISOLATED_DB,
        )
        assert settings.ENVIRONMENT == "development"
        assert settings.is_production_posture is False
        assert settings.QONTINUI_DEV_LOCAL_AUTH is True


class TestNumericLoopbackIssuer:
    """M2 — numeric/short/octal/hex IPv4 issuer hosts must be caught as loopback.

    These forms (``127.1``, ``2130706433``, ``0x7f000001``, ``0177.0.0.1``)
    resolve to 127.0.0.0/8 on a real OS but ``ipaddress.ip_address`` rejects
    them; without normalisation they would slip past the prod guardrail.
    """

    @pytest.mark.parametrize(
        "host",
        ["127.1", "2130706433", "0x7f000001", "0177.0.0.1", "0x7f.1"],
    )
    def test_numeric_loopback_forms_detected(self, host: str) -> None:
        issuer = f"http://{host}:8770"
        settings = Settings(
            ENVIRONMENT="development",
            COGNITO_ISSUER=issuer,
            DATABASE_URL=_ISOLATED_DB,
        )
        assert settings.cognito_issuer_is_loopback is True

    @pytest.mark.parametrize(
        "host",
        ["127.1", "2130706433", "0x7f000001", "0177.0.0.1"],
    )
    def test_numeric_loopback_forms_refuse_prod_boot(self, host: str) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT="production",
                COGNITO_ISSUER=f"http://{host}:8770",
                DATABASE_URL="postgresql://u:p@db.internal:5432/qontinui_prod",
            )
        assert "loopback" in str(exc.value)

    @pytest.mark.parametrize(
        "host",
        [
            "8.8.8.8",  # real public IP
            "134.744.1.1",  # numeric-ish but not a valid IPv4 (octet > 255)
            "10.0.0.5",  # private but NOT loopback
            "3232235521",  # 192.168.0.1 as a single integer — not loopback
        ],
    )
    def test_non_loopback_numeric_hosts_not_flagged(self, host: str) -> None:
        settings = Settings(
            ENVIRONMENT="development",
            COGNITO_ISSUER=f"http://{host}:8770",
            DATABASE_URL=_ISOLATED_DB,
        )
        assert settings.cognito_issuer_is_loopback is False

    def test_non_loopback_public_ip_boots_in_prod(self) -> None:
        settings = Settings(
            ENVIRONMENT="production",
            COGNITO_ISSUER="http://8.8.8.8:8770",
            DATABASE_URL="postgresql://u:p@db.internal:5432/qontinui_prod",
        )
        assert settings.cognito_issuer_is_loopback is False

    def test_real_hostname_never_numeric_normalised(self) -> None:
        """A genuine hostname must not be routed through numeric normalisation."""
        settings = Settings(
            ENVIRONMENT="production",
            COGNITO_ISSUER=_REAL_ISSUER,
            DATABASE_URL="postgresql://u:p@db.internal:5432/qontinui_prod",
        )
        assert settings.cognito_issuer_is_loopback is False


class TestDbIsolationTriggersOnLoopbackSignal:
    """M3 — DB isolation gates on ``flag OR loopback issuer``, not the flag alone.

    The Cognito verifier is purely issuer-driven, so pointing COGNITO_ISSUER at
    the local IdP activates local-auth even without the master flag. That path
    must ALSO be barred from the shared dev DB.
    """

    @pytest.mark.parametrize(
        "shared_db",
        [
            "postgresql://qontinui_user:pw@localhost:5433/qontinui_db",
            "postgresql://u:p@localhost/db",
        ],
    )
    def test_loopback_issuer_without_flag_against_shared_db_refuses(
        self, shared_db: str
    ) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT="development",
                QONTINUI_DEV_LOCAL_AUTH=False,  # flag NOT set
                COGNITO_ISSUER=_LOCAL_ISSUER,  # but issuer IS the local IdP
                DATABASE_URL=shared_db,
            )
        msg = str(exc.value)
        assert "ISOLATED database" in msg
        assert "qontinui_local_auth" in msg
        # The message attributes the trigger to the loopback issuer, not the flag.
        assert "COGNITO_ISSUER" in msg

    def test_numeric_loopback_issuer_without_flag_against_shared_db_refuses(
        self,
    ) -> None:
        with pytest.raises(ValidationError) as exc:
            Settings(
                ENVIRONMENT="development",
                QONTINUI_DEV_LOCAL_AUTH=False,
                COGNITO_ISSUER="http://2130706433:8770",  # 127.0.0.1 numeric
                DATABASE_URL="postgresql://u:p@localhost:5433/qontinui_db",
            )
        assert "ISOLATED database" in str(exc.value)

    def test_loopback_issuer_without_flag_with_isolated_db_boots(self) -> None:
        settings = Settings(
            ENVIRONMENT="development",
            QONTINUI_DEV_LOCAL_AUTH=False,
            COGNITO_ISSUER=_LOCAL_ISSUER,
            DATABASE_URL=_ISOLATED_DB,
        )
        assert settings.cognito_issuer_is_loopback is True
        assert settings.QONTINUI_DEV_LOCAL_AUTH is False
