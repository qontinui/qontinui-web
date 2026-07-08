"""Tests for the ``devenv`` Environments (digital-twin) feature.

Two layers:

* **Layer 1 — pure unit tests (no DB):**
  - :func:`app.services.devenv_drift.diff_envelopes` — the section/key/severity
    rubric (removed/changed/added, critical vs warning sections, schema-version
    override, in-sync identity).
  - :class:`app.schemas.devenv.ConfigEnvelope` — the secret backstop
    (env_contract values coerced to present/absent; nested non-string section
    values rejected).
  - :mod:`app.crud.devenv_machine_crud` — machine-key generation (mk_ prefix,
    sha256 hash, non-secret prefix, uniqueness).

* **Layer 2 — full HTTP integration (real Postgres, auth overridden):**
  Drives the enroll → push-config → set-canonical → drift flow end-to-end
  against the test DB, plus the secret backstop and cross-owner isolation.

  Uses ``httpx.AsyncClient`` + ``ASGITransport`` (NOT ``TestClient``) so the
  request handler runs in the SAME asyncio loop as the shared async DB
  session — mirrors the proven pattern in ``test_pair_codes.py``. The
  function-scoped ``async_db_session`` is bound to a connection whose outer
  transaction is rolled back after each test, so endpoint ``db.commit()``
  calls are visible within the test but never persist.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import devenv_machine_crud
from app.schemas.devenv import ConfigEnvelope
from app.services import devenv_drift

API_PREFIX = "/api/v1/devenv"


# ===========================================================================
# Layer 1 — pure unit tests (no DB)
# ===========================================================================


def _envelope(sections: dict, *, schema_version: int = 1) -> dict:
    """Build a persisted-shape envelope dict (what JSONB holds)."""
    return {
        "schema_version": schema_version,
        "captured_at": "2026-06-21T00:00:00Z",
        "sections": sections,
    }


class TestDiffEnvelopes:
    """:func:`diff_envelopes` — the drift rubric."""

    def test_removed_key_is_critical(self) -> None:
        """A canonical key missing on the target → removed / critical."""
        canonical = _envelope({"services": {"redis": "6379", "pg": "5432"}})
        actual = _envelope({"services": {"redis": "6379"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.in_sync is False
        section = _section(report, "services")
        delta = _delta(section, "pg")
        assert delta.status == "removed"
        assert delta.severity == "critical"
        assert delta.expected == "5432"
        assert delta.actual is None

    def test_versions_change_is_critical(self) -> None:
        """A changed value in the ``versions`` (critical) section → critical."""
        canonical = _envelope({"versions": {"python": "3.12"}})
        actual = _envelope({"versions": {"python": "3.11"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "versions"), "python")
        assert delta.status == "changed"
        assert delta.severity == "critical"
        assert delta.expected == "3.12"
        assert delta.actual == "3.11"
        assert report.severity == "critical"

    def test_services_change_is_warning(self) -> None:
        """A changed value in the ``services`` section → warning."""
        canonical = _envelope({"services": {"redis": "6379"}})
        actual = _envelope({"services": {"redis": "6380"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "services"), "redis")
        assert delta.status == "changed"
        assert delta.severity == "warning"
        assert report.severity == "warning"

    def test_claude_accounts_change_is_warning(self) -> None:
        """A changed value in the ``claude_accounts`` section → warning (not info)."""
        canonical = _envelope({"claude_accounts": {"selection_mode": "all"}})
        actual = _envelope({"claude_accounts": {"selection_mode": "single"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "claude_accounts"), "selection_mode")
        assert delta.status == "changed"
        assert delta.severity == "warning"
        assert report.severity == "warning"

    def test_added_key_status_added(self) -> None:
        """A key on the target but not canonical → added."""
        canonical = _envelope({"services": {"redis": "6379"}})
        actual = _envelope({"services": {"redis": "6379", "extra": "1"}})
        report = devenv_drift.diff_envelopes(canonical, actual)

        delta = _delta(_section(report, "services"), "extra")
        assert delta.status == "added"
        assert delta.expected is None
        assert delta.actual == "1"

    def test_schema_version_mismatch_forces_critical(self) -> None:
        """A schema_version mismatch forces overall critical + the flag."""
        canonical = _envelope({"services": {"redis": "6379"}}, schema_version=1)
        actual = _envelope({"services": {"redis": "6379"}}, schema_version=2)
        report = devenv_drift.diff_envelopes(canonical, actual)

        assert report.schema_version_mismatch is True
        assert report.expected_schema_version == 1
        assert report.actual_schema_version == 2
        assert report.severity == "critical"
        assert report.in_sync is False

    def test_identical_envelopes_in_sync(self) -> None:
        """Identical envelopes → in_sync, no section deltas."""
        env = _envelope(
            {
                "versions": {"python": "3.12"},
                "services": {"redis": "6379"},
            }
        )
        report = devenv_drift.diff_envelopes(env, dict(env))

        assert report.in_sync is True
        assert report.sections == []
        assert report.severity == "info"
        assert report.schema_version_mismatch is False


class TestConfigEnvelopeBackstop:
    """:class:`ConfigEnvelope` — secret backstop + nesting rejection."""

    def test_env_contract_secret_value_coerced_to_present(self) -> None:
        """A secret env_contract value is stored as "present", not the raw."""
        secret = "postgres://u:secretpw@h/db"
        env = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={"env_contract": {"DATABASE_URL": secret}},
        )
        stored = env.sections["env_contract"]["DATABASE_URL"]
        assert stored == "present"
        assert "secretpw" not in stored
        assert secret not in str(env.sections)

    def test_env_contract_empty_value_is_absent(self) -> None:
        """An empty env_contract value is stored as "absent"."""
        env = ConfigEnvelope(
            captured_at=datetime.now(UTC),
            sections={"env_contract": {"MISSING": ""}},
        )
        assert env.sections["env_contract"]["MISSING"] == "absent"

    def test_nested_section_value_rejected(self) -> None:
        """A nested (non-string) section value raises ValidationError."""
        with pytest.raises(ValidationError):
            ConfigEnvelope(
                captured_at=datetime.now(UTC),
                sections={"services": {"x": {"nested": 1}}},
            )

    def test_list_section_value_rejected(self) -> None:
        """A list section value raises ValidationError."""
        with pytest.raises(ValidationError):
            ConfigEnvelope(
                captured_at=datetime.now(UTC),
                sections={"services": {"x": [1, 2, 3]}},
            )


class TestMachineKeyCrud:
    """:mod:`devenv_machine_crud` — machine-key generation."""

    def test_key_prefix_hash_shape(self) -> None:
        """Generated key: mk_ prefix, sha256 hex hash, non-secret prefix."""
        plaintext, key_hash, key_prefix = devenv_machine_crud.generate_machine_key()

        assert plaintext.startswith("mk_")
        # Hash is the sha256 hex of the FULL plaintext key.
        assert key_hash == devenv_machine_crud.hash_machine_key(plaintext)
        assert len(key_hash) == 64
        assert all(c in "0123456789abcdef" for c in key_hash)
        # Prefix is a non-secret display prefix — a leading slice of the key,
        # never the hash, and short enough that it can't reveal the secret.
        assert plaintext.startswith(key_prefix)
        assert key_prefix.startswith("mk_")
        assert key_prefix != plaintext
        assert key_prefix != key_hash
        assert len(key_prefix) == devenv_machine_crud.MACHINE_KEY_PREFIX_LEN

    def test_two_generations_differ(self) -> None:
        """Two generations yield distinct keys + hashes."""
        a_plain, a_hash, _ = devenv_machine_crud.generate_machine_key()
        b_plain, b_hash, _ = devenv_machine_crud.generate_machine_key()
        assert a_plain != b_plain
        assert a_hash != b_hash

    def test_enrollment_code_alphabet(self) -> None:
        """Enrollment codes are drawn from the unambiguous alphabet."""
        for _ in range(50):
            code = devenv_machine_crud.generate_enrollment_code()
            assert len(code) == devenv_machine_crud.ENROLLMENT_CODE_LENGTH
            for ch in code:
                assert ch in devenv_machine_crud.ENROLLMENT_CODE_ALPHABET
            assert "0" not in code and "O" not in code
            assert "1" not in code and "I" not in code


# ---------------------------------------------------------------------------
# Layer 1 helpers
# ---------------------------------------------------------------------------


def _section(report, name):
    """Return the SectionDrift for ``name`` (asserts it exists)."""
    for sec in report.sections:
        if sec.section == name:
            return sec
    raise AssertionError(f"section {name!r} not in report: {report.sections}")


def _delta(section, key):
    """Return the KeyDelta for ``key`` within a section (asserts it exists)."""
    for delta in section.deltas:
        if delta.key == key:
            return delta
    raise AssertionError(f"key {key!r} not in section {section.section!r}")


# ===========================================================================
# Layer 2 — full HTTP integration (real DB, auth overridden)
# ===========================================================================


def _build_app(*, db_session: AsyncSession, user) -> FastAPI:
    """Build a FastAPI app mounting the devenv routers with overridden deps.

    Overrides ``get_async_db`` → the shared test session and
    ``get_current_active_user_async`` → the real ``test_user`` row (needed
    because ``devenv.*.owner_user_id`` FKs ``auth.users.id``).
    """
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.devenv import router as devenv_router
    from app.api.v1.endpoints.devenv_agent import router as agent_router

    app = FastAPI()

    if user is not None:
        app.dependency_overrides[get_current_active_user_async] = lambda: user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(devenv_router, prefix=API_PREFIX)
    app.include_router(agent_router, prefix=API_PREFIX)
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    """An in-process ``httpx.AsyncClient`` against ``app``."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _config_body(sections: dict) -> dict:
    """A ConfigEnvelope request body (agent push)."""
    return {
        "schema_version": 1,
        "captured_at": "2026-06-21T12:00:00Z",
        "sections": sections,
    }


@pytest_asyncio.fixture()
async def second_user(async_db_session: AsyncSession):
    """A second real user row, for cross-owner isolation tests."""
    from app.models.user import User

    user = User(
        email=f"other_{uuid4()}@example.com",
        username=f"other_{uuid4().hex[:8]}",
        full_name="Other User",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


class TestDevenvEndToEnd:
    """The enroll → push → canonical → drift flow against real Postgres."""

    @pytest.mark.asyncio
    async def test_full_flow(self, async_db_session: AsyncSession, test_user) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)

        async with _client(app) as client:
            # 1. Create application + environment + two machines.
            r = await client.post(
                f"{API_PREFIX}/applications",
                json={"name": "App", "slug": "app", "description": None},
            )
            assert r.status_code == 201, r.text

            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "Prod", "description": None},
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]

            r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-a"})
            assert r.status_code == 201, r.text
            body_a = r.json()
            machine_a_id = body_a["id"]
            code_a = body_a["enrollment_code"]
            # The one-time code must be present + key material never exposed.
            assert code_a and "machine_key" not in body_a
            assert "key_hash" not in body_a

            r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-b"})
            assert r.status_code == 201, r.text
            body_b = r.json()
            machine_b_id = body_b["id"]
            code_b = body_b["enrollment_code"]

            assert code_a != code_b

            # 2. Enroll both machines (no user auth needed for enroll).
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code_a, "machine_id": machine_a_id},
            )
            assert r.status_code == 200, r.text
            enroll_a = r.json()
            key_a = enroll_a["machine_key"]
            assert key_a.startswith("mk_")
            assert enroll_a["machine_id"] == machine_a_id
            # Exactly one environment exists → agent gets it bound.
            assert enroll_a["environment_id"] == env_id

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code_b, "machine_id": machine_b_id},
            )
            assert r.status_code == 200, r.text
            key_b = r.json()["machine_key"]
            assert key_b != key_a

            # 3. Push DIFFERENT config for A and B via X-Machine-Key.
            #    A is the intended canonical; B drifts on db_schema + is
            #    missing a key A has; both include a secret env_contract.
            secret = "postgres://user:topsecret@db/app"
            config_a = _config_body(
                {
                    "db_schema": {"alembic_head": "rev_new"},
                    "services": {"redis": "6379"},
                    "env_contract": {"DATABASE_URL": secret, "API_KEY": "abc123"},
                }
            )
            config_b = _config_body(
                {
                    "db_schema": {"alembic_head": "rev_old"},
                    # NOTE: no "services" section → A's services.redis is removed.
                    "env_contract": {"DATABASE_URL": secret},
                }
            )

            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=config_a,
                headers={"X-Machine-Key": key_a},
            )
            assert r.status_code == 200, r.text
            assert r.json()["ok"] is True

            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=config_b,
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 200, r.text

            # 3b. Secret backstop: drift BEFORE canonical is undefined (422),
            #     so verify the persisted value directly is "present".
            from app.repositories.devenv import config_repo

            row_a = await config_repo.get(
                async_db_session,
                environment_id=UUID(env_id),
                machine_id=UUID(machine_a_id),
            )
            assert row_a is not None
            assert row_a.config["sections"]["env_contract"]["DATABASE_URL"] == "present"
            assert "topsecret" not in str(row_a.config)

            # 4. Set canonical to A.
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": machine_a_id},
            )
            assert r.status_code == 200, r.text
            assert r.json()["canonical_machine_id"] == machine_a_id

            # 5. Environment drift — B should appear with non-empty deltas,
            #    the db_schema change flagged critical, overall critical, and
            #    the secret never leaked.
            r = await client.get(f"{API_PREFIX}/environments/{env_id}/drift")
            assert r.status_code == 200, r.text
            drift = r.json()
            assert drift["severity"] == "critical"
            assert drift["in_sync"] is False
            assert drift["canonical_machine_id"] == machine_a_id

            # Only the non-canonical machine (B) is reported.
            reports = drift["reports"]
            assert len(reports) == 1
            report_b = reports[0]
            assert report_b["machine_id"] == machine_b_id
            assert report_b["sections"]  # non-empty deltas

            db_schema = _find_section(report_b, "db_schema")
            head_delta = _find_delta(db_schema, "alembic_head")
            assert head_delta["status"] == "changed"
            assert head_delta["severity"] == "critical"
            assert head_delta["expected"] == "rev_new"
            assert head_delta["actual"] == "rev_old"

            # A's services.redis is removed on B → critical.
            services = _find_section(report_b, "services")
            redis_delta = _find_delta(services, "redis")
            assert redis_delta["status"] == "removed"
            assert redis_delta["severity"] == "critical"

            # Secret backstop holds across the wire: env_contract shows the
            # API_KEY that A has but B lacks as a removed "present" value —
            # never the raw secret.
            env_contract = _find_section(report_b, "env_contract")
            api_key_delta = _find_delta(env_contract, "API_KEY")
            assert api_key_delta["status"] == "removed"
            assert api_key_delta["expected"] == "present"
            assert "abc123" not in r.text
            assert "topsecret" not in r.text

            # 5b. Single-machine drift for B returns B's full report.
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}/drift/{machine_b_id}"
            )
            assert r.status_code == 200, r.text
            single = r.json()
            assert single["machine_id"] == machine_b_id
            assert single["severity"] == "critical"
            assert single["in_sync"] is False
            assert single["has_config"] is True

            # 5c. Single-machine drift for A vs itself (canonical) → in sync.
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}/drift/{machine_a_id}"
            )
            assert r.status_code == 200, r.text
            assert r.json()["in_sync"] is True

    @pytest.mark.asyncio
    async def test_drift_requires_canonical(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Drift with no canonical machine set → 422."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "NoCanon", "description": None},
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]

            r = await client.get(f"{API_PREFIX}/environments/{env_id}/drift")
            assert r.status_code == 422, r.text
            assert r.json()["detail"]["code"] == "no_canonical_machine"

    @pytest.mark.asyncio
    async def test_set_canonical_requires_config(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Setting canonical to a machine with no config → 409."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "EnvX", "description": None},
            )
            env_id = r.json()["id"]
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": "no-config-machine"}
            )
            machine_id = r.json()["id"]

            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": machine_id},
            )
            assert r.status_code == 409, r.text
            assert r.json()["detail"]["code"] == "machine_has_no_config"

    @pytest.mark.asyncio
    async def test_invalid_machine_key_rejected(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Agent config push with a bad/missing key → 401."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "EnvAuth", "description": None},
            )
            env_id = r.json()["id"]

            # Malformed (no mk_ prefix).
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"services": {"a": "1"}}),
                headers={"X-Machine-Key": "not-a-real-key"},
            )
            assert r.status_code == 401, r.text

            # Well-formed prefix but unknown key.
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"services": {"a": "1"}}),
                headers={"X-Machine-Key": "mk_" + "x" * 40},
            )
            assert r.status_code == 401, r.text

    @pytest.mark.asyncio
    async def test_revoked_machine_rejected(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A revoked machine's key is rejected on agent calls → 403/401."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "EnvRevoke", "description": None},
            )
            env_id = r.json()["id"]
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "revoke-me"})
            body = r.json()
            machine_id = body["id"]
            code = body["enrollment_code"]

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "machine_id": machine_id},
            )
            key = r.json()["machine_key"]

            # Revoke it.
            r = await client.post(f"{API_PREFIX}/machines/{machine_id}/revoke")
            assert r.status_code == 200, r.text
            assert r.json()["revoked"] is True

            # The key no longer authenticates. revoke_machine() clears the
            # key_hash, so the lookup misses entirely → 401 (revoked machines
            # whose hash survived would be 403; either way: not authorized).
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=_config_body({"services": {"a": "1"}}),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code in (401, 403), r.text

    @pytest.mark.asyncio
    async def test_enroll_machine_id_mismatch(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Enrolling with a mismatched machine_id → 409."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "bind-check"})
            code = r.json()["enrollment_code"]

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={
                    "enrollment_code": code,
                    "machine_id": str(uuid4()),  # wrong machine
                },
            )
            assert r.status_code == 409, r.text
            assert r.json()["detail"]["code"] == "machine_id_mismatch"

    @pytest.mark.asyncio
    async def test_enroll_persists_coord_device_id(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Enrolling with a coord_device_id persists the P3 coord bridge."""
        app = _build_app(db_session=async_db_session, user=test_user)
        coord_device_id = str(uuid4())
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines", json={"name": "coord-bridged"}
            )
            assert r.status_code == 201, r.text
            body = r.json()
            machine_id = body["id"]
            # Unbridged at create.
            assert body["coord_device_id"] is None

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={
                    "enrollment_code": body["enrollment_code"],
                    "machine_id": machine_id,
                    "coord_device_id": coord_device_id,
                },
            )
            assert r.status_code == 200, r.text

            # The owner read surface exposes the persisted bridge.
            r = await client.get(f"{API_PREFIX}/machines/{machine_id}")
            assert r.status_code == 200, r.text
            assert r.json()["coord_device_id"] == coord_device_id

    @pytest.mark.asyncio
    async def test_cross_owner_isolation(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A second user cannot see the first user's environment → 404."""
        # User 1 creates an environment.
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "PrivateEnv", "description": None},
            )
            assert r.status_code == 201, r.text
            env_id = r.json()["id"]

        # User 2 (same DB session, different identity) cannot read it.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(f"{API_PREFIX}/environments/{env_id}")
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"


# ---------------------------------------------------------------------------
# Layer 2 helpers (operate on JSON dicts, not pydantic models)
# ---------------------------------------------------------------------------


def _find_section(report: dict, name: str) -> dict:
    """Return the section dict named ``name`` from a JSON drift report."""
    for sec in report["sections"]:
        if sec["section"] == name:
            return sec
    raise AssertionError(f"section {name!r} not in report sections")


def _find_delta(section: dict, key: str) -> dict:
    """Return the delta dict for ``key`` within a JSON section."""
    for delta in section["deltas"]:
        if delta["key"] == key:
            return delta
    raise AssertionError(f"key {key!r} not in section {section['section']!r}")


class TestDevenvMachineEnvBinding:
    """Phase 2 P1 — explicit machine→environment binding."""

    @pytest.mark.asyncio
    async def test_create_machine_with_environment_binds(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-1", "description": None},
            )
            env_id = r.json()["id"]

            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": "bound-machine", "environment_id": env_id},
            )
            assert r.status_code == 201, r.text
            assert r.json()["environment_id"] == env_id

    @pytest.mark.asyncio
    async def test_create_machine_with_foreign_environment_404(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": "m", "environment_id": str(uuid4())},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"

    @pytest.mark.asyncio
    async def test_set_machine_environment_rebind_and_unbind(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-a", "description": None},
            )
            env_id = r.json()["id"]
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "rebind-me"})
            machine_id = r.json()["id"]
            assert r.json()["environment_id"] is None

            # Bind.
            r = await client.put(
                f"{API_PREFIX}/machines/{machine_id}/environment",
                json={"environment_id": env_id},
            )
            assert r.status_code == 200, r.text
            assert r.json()["environment_id"] == env_id

            # Unbind (null).
            r = await client.put(
                f"{API_PREFIX}/machines/{machine_id}/environment",
                json={"environment_id": None},
            )
            assert r.status_code == 200, r.text
            assert r.json()["environment_id"] is None

    @pytest.mark.asyncio
    async def test_enroll_honors_explicit_binding_over_multi_env(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """With MULTIPLE environments the v1 auto-bind returns None; an
        explicit binding must still resolve deterministically at enroll."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-1", "description": None},
            )
            assert r.status_code == 201, r.text
            r = await client.post(
                f"{API_PREFIX}/environments",
                json={"name": "env-2", "description": None},
            )
            env2_id = r.json()["id"]

            r = await client.post(
                f"{API_PREFIX}/machines",
                json={"name": "explicit", "environment_id": env2_id},
            )
            machine_id = r.json()["id"]
            code = r.json()["enrollment_code"]

            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={"enrollment_code": code, "machine_id": machine_id},
            )
            assert r.status_code == 200, r.text
            # Two envs exist, so the v1 heuristic would bind None — the explicit
            # binding wins.
            assert r.json()["environment_id"] == env2_id


class TestDispatchEnroll:
    """Phase 3 — POST /machines/dispatch-enroll creates a machine, binds it to
    the chosen coord device, and dispatches an enroll directive via coord."""

    @pytest.mark.asyncio
    async def test_dispatch_success(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)
        captured: dict = {}

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            captured["path"] = path
            captured["body"] = json_body
            return httpx.Response(200, json={"dispatched": True})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        device_id = str(uuid4())
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "dispatch-me", "target_device_id": device_id},
            )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["dispatched"] is True
        machine = body["machine"]
        # Machine created with a one-time code, bound to the chosen device.
        assert machine["enrollment_code"]
        assert machine["coord_device_id"] == device_id
        assert "machine_key" not in machine and "key_hash" not in machine
        # Coord received the correct directive.
        assert captured["path"] == "/devenv/enroll-dispatch"
        assert captured["body"]["target_device_id"] == device_id
        assert captured["body"]["enrollment_code"] == machine["enrollment_code"]
        assert captured["body"]["machine_id"] == machine["id"]

    @pytest.mark.asyncio
    async def test_dispatch_rejection_still_creates_machine(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        app = _build_app(db_session=async_db_session, user=test_user)

        async def _fake_post(path, *, headers, json_body, log_event, **kw):
            return httpx.Response(400, json={"error": "unknown device"})

        monkeypatch.setattr("app.api.v1.endpoints.devenv.post_to_coord", _fake_post)
        async with _client(app) as client:
            r = await client.post(
                f"{API_PREFIX}/machines/dispatch-enroll",
                json={"name": "offline-box", "target_device_id": str(uuid4())},
            )
        # The machine + code are still created (copy-paste fallback), dispatch soft-fails.
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["dispatched"] is False
        assert body["detail"]
        assert body["machine"]["enrollment_code"]
