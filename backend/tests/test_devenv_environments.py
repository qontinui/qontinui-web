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


class TestContentHash:
    """:func:`app.repositories.devenv.compute_content_hash` — canonical JSON."""

    def test_key_order_does_not_change_hash(self) -> None:
        """The same envelope with different dict key order hashes identically."""
        from app.repositories.devenv import compute_content_hash

        a = {
            "schema_version": 1,
            "sections": {
                "services": {"redis": "6379", "pg": "5432"},
                "versions": {"python": "3.12"},
            },
        }
        b = {
            "sections": {
                "versions": {"python": "3.12"},
                "services": {"pg": "5432", "redis": "6379"},
            },
            "schema_version": 1,
        }
        assert compute_content_hash(a) == compute_content_hash(b)
        # Shape sanity: sha256 hex.
        digest = compute_content_hash(a)
        assert len(digest) == 64
        assert all(c in "0123456789abcdef" for c in digest)

    def test_captured_at_excluded_from_hash(self) -> None:
        """A re-capture of identical content dedups despite a moved timestamp."""
        from app.repositories.devenv import compute_content_hash

        sections = {"services": {"redis": "6379"}}
        early = {
            "schema_version": 1,
            "captured_at": "2026-06-21T00:00:00Z",
            "sections": sections,
        }
        late = {
            "schema_version": 1,
            "captured_at": "2026-06-21T00:15:00Z",
            "sections": sections,
        }
        assert compute_content_hash(early) == compute_content_hash(late)

    def test_content_change_changes_hash(self) -> None:
        """A changed section value produces a different hash."""
        from app.repositories.devenv import compute_content_hash

        a = {"schema_version": 1, "sections": {"services": {"redis": "6379"}}}
        b = {"schema_version": 1, "sections": {"services": {"redis": "6380"}}}
        assert compute_content_hash(a) != compute_content_hash(b)


class TestSectionPolicy:
    """:mod:`app.services.devenv_section_policy` — per-section apply policy."""

    def test_known_sections(self) -> None:
        """versions/services apply; env_contract secret; db_schema destructive."""
        from app.services import devenv_section_policy as sp

        assert sp.policy_for("versions") == "applyable"
        assert sp.policy_for("services") == "applyable"
        assert sp.policy_for("env_contract") == "secret_report_only"
        assert sp.policy_for("db_schema") == "destructive_confirm"
        assert sp.policy_for("claude_accounts") == "report_only"

    def test_unknown_section_defaults_report_only(self) -> None:
        """An unrecognized section is conservatively report_only."""
        from app.services import devenv_section_policy as sp

        assert sp.policy_for("something_new") == "report_only"

    def test_policy_map(self) -> None:
        """policy_map returns section -> policy for the given names."""
        from app.services import devenv_section_policy as sp

        m = sp.policy_map(["versions", "db_schema", "zzz"])
        assert m == {
            "versions": "applyable",
            "db_schema": "destructive_confirm",
            "zzz": "report_only",
        }


class TestDerivedKeys:
    """:mod:`app.services.devenv_section_policy` — per-KEY derived refinement."""

    def test_versions_repo_derived_keys(self) -> None:
        """Every repo-derived versions key is classified derived, incl. node_dep_*."""
        from app.services import devenv_section_policy as sp

        derived = sp.derived_keys_map(
            {
                "versions": {
                    "runner_crate_version": "0.1.0",
                    "node_package_version": "1.2.3",
                    "node_package_name": "qontinui-runner",
                    "python_constraint": ">=3.12",
                    "tauri": "2.0.0",
                    "node_dep_react": "19.0.0",
                }
            }
        )
        assert sorted(derived["versions"]) == [
            "node_dep_react",
            "node_package_name",
            "node_package_version",
            "python_constraint",
            "runner_crate_version",
            "tauri",
        ]

    def test_machine_facts_are_not_derived(self) -> None:
        """node/python/rustc are shelled machine facts — they stay applyable."""
        from app.services import devenv_section_policy as sp

        derived = sp.derived_keys_map(
            {"versions": {"node": "22.1.0", "python": "3.13", "rustc": "1.84.0"}}
        )
        assert derived == {"versions": []}

    def test_other_sections_have_no_derived_keys(self) -> None:
        """services/env_contract/db_schema classify to empty lists."""
        from app.services import devenv_section_policy as sp

        derived = sp.derived_keys_map(
            {
                "services": {"redis": "6379"},
                "env_contract": {"DATABASE_URL": "present"},
                "db_schema": {"alembic_head": "abc123"},
            }
        )
        assert derived == {"services": [], "env_contract": [], "db_schema": []}

    def test_unknown_key_is_not_derived(self) -> None:
        """Conservative default: an unrecognized key keeps its section policy."""
        from app.services import devenv_section_policy as sp

        assert sp.is_derived_key("versions", "something_new") is False
        assert sp.is_derived_key("services", "runner_crate_version") is False
        assert sp.derived_keys_map({"versions": {"something_new": "x"}}) == {
            "versions": []
        }

    def test_response_is_valid_without_derived_keys(self) -> None:
        """Additive: a response built without the field still validates (empty)."""
        from uuid import uuid4

        from app.schemas.devenv import CanonicalConfigResponse

        r = CanonicalConfigResponse(
            environment_id=uuid4(),
            sections={"versions": {"python": "3.13"}},
            section_policy={"versions": "applyable"},
        )
        assert r.derived_keys == {}


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


class TestCanonicalAuditAndPull:
    """P1 (pull model) — canonical audit trail + the machine pull surface."""

    async def _seed_env_two_enrolled_machines(
        self, client: httpx.AsyncClient
    ) -> tuple[str, str, str, str, str]:
        """Create env + machines A,B, enroll both, push A's + B's config.

        Returns (env_id, machine_a_id, machine_b_id, key_a, key_b).
        A carries a secret env_contract so pull secret-safety is testable.
        """
        r = await client.post(
            f"{API_PREFIX}/environments", json={"name": "Sync", "description": None}
        )
        env_id = r.json()["id"]

        r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-a"})
        body_a = r.json()
        machine_a_id, code_a = body_a["id"], body_a["enrollment_code"]
        r = await client.post(f"{API_PREFIX}/machines", json={"name": "machine-b"})
        body_b = r.json()
        machine_b_id, code_b = body_b["id"], body_b["enrollment_code"]

        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": code_a, "machine_id": machine_a_id},
        )
        key_a = r.json()["machine_key"]
        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": code_b, "machine_id": machine_b_id},
        )
        key_b = r.json()["machine_key"]

        await client.put(
            f"{API_PREFIX}/agent/environments/{env_id}/config",
            json=_config_body(
                {
                    "versions": {"python": "3.13"},
                    "services": {"redis": "6379"},
                    "env_contract": {"DATABASE_URL": "postgres://u:topsecret@h/d"},
                }
            ),
            headers={"X-Machine-Key": key_a},
        )
        await client.put(
            f"{API_PREFIX}/agent/environments/{env_id}/config",
            json=_config_body({"versions": {"python": "3.11"}}),
            headers={"X-Machine-Key": key_b},
        )
        return env_id, machine_a_id, machine_b_id, key_a, key_b

    @pytest.mark.asyncio
    async def test_canonical_changes_are_audited(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Every canonical (re)designation is recorded who/when/from->to;
        a no-op re-designation is not."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )

            # No changes yet.
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}/canonical-history"
            )
            assert r.status_code == 200, r.text
            assert r.json() == []

            # First designation A: from None -> A, attributed to the user.
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 1
            assert hist[0]["from_machine_id"] is None
            assert hist[0]["to_machine_id"] == a_id
            assert hist[0]["changed_by_user_id"] == str(test_user.id)
            assert hist[0]["changed_at"].endswith("Z")

            # Re-point to B → a second record with the A -> B transition.
            # NOTE: assert on the SET of transitions, not positional order:
            # this test harness wraps every request in ONE transaction, so
            # Postgres now() (transaction-start time) is identical for both
            # rows and ORDER BY changed_at DESC is a tie. In production each
            # change is its own transaction with a distinct timestamp.
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 2
            transitions = {(h["from_machine_id"], h["to_machine_id"]) for h in hist}
            assert transitions == {(None, a_id), (a_id, b_id)}

            # No-op re-designation of B (already canonical) is NOT recorded.
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 2

    @pytest.mark.asyncio
    async def test_canonical_note_round_trips(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The optional "why" travels from the request into the audit row.

        The column, the response field and the UI row all existed; nothing
        could WRITE one until ``SetCanonicalRequest.note`` did.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id, "note": "  a-box rebuilt on 3.12  "},
            )
            assert r.status_code == 200, r.text

            # A note-less designation stays null (the field is optional).
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            assert r.status_code == 200, r.text

            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            # Same-transaction rows tie on changed_at — key by transition.
            notes = {h["to_machine_id"]: h["note"] for h in hist}
            assert notes[a_id] == "a-box rebuilt on 3.12"  # trimmed
            assert notes[b_id] is None

    @pytest.mark.asyncio
    async def test_blank_canonical_note_is_stored_as_null(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A whitespace-only note is no note — never an empty string.

        Readers test the note for truthiness (the UI renders the line only
        when it is non-null); `""` would be a third state meaning nothing.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id, "note": "   "},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 1
            assert hist[0]["note"] is None

    @pytest.mark.asyncio
    async def test_overlong_canonical_note_is_rejected(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The note is bounded — the audit trail is not a free-text dumping
        ground, and the UI renders it inline."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id, "note": "x" * 501},
            )
            assert r.status_code == 422, r.text

    @pytest.mark.asyncio
    async def test_history_pages_without_gaps_or_repeats(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """limit/offset page the audit trail deterministically.

        The load-bearing part is the ``id`` tiebreaker in the repository sort:
        ``changed_at`` defaults to Postgres ``now()`` (transaction time), so
        these three rows share a timestamp exactly. Ordering on the timestamp
        alone would let the two pages skip or repeat a row.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            for machine_id in (a_id, b_id, a_id):
                r = await client.put(
                    f"{API_PREFIX}/environments/{env_id}/canonical",
                    json={"machine_id": machine_id},
                )
                assert r.status_code == 200, r.text

            async def page(limit: int, offset: int) -> list[str]:
                r = await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                    f"?limit={limit}&offset={offset}"
                )
                assert r.status_code == 200, r.text
                return [h["id"] for h in r.json()]

            first, second = await page(2, 0), await page(2, 2)
            assert len(first) == 2
            assert len(second) == 1
            # Disjoint, and together the whole history.
            assert set(first).isdisjoint(second)
            assert set(first) | set(second) == set(await page(50, 0))

    @pytest.mark.asyncio
    async def test_history_resolves_display_names(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """History rows carry the actor email + from/to machine names.

        Resolved server-side by LEFT JOIN so the UI never renders a raw UUID
        and never issues a per-row lookup.
        """
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 2
            # Same-transaction rows share now(), so ORDER BY changed_at DESC
            # is a tie here — assert on the SET of transitions, not position.
            named = {(h["from_machine_name"], h["to_machine_name"]) for h in hist}
            assert named == {(None, "machine-a"), ("machine-a", "machine-b")}
            assert {h["changed_by_email"] for h in hist} == {test_user.email}

    @pytest.mark.asyncio
    async def test_history_survives_machine_deletion_with_null_name(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The load-bearing case: deleting a machine must NOT drop its audit
        rows — the ids are soft refs, so the row stays and the name is None."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, b_id, _, _ = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": b_id},
            )

            r = await client.delete(f"{API_PREFIX}/machines/{a_id}")
            assert r.status_code == 204, r.text

            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            # Both audit rows survive the deletion.
            assert len(hist) == 2
            # The soft-ref ids are untouched — only the resolved name is gone.
            assert {h["to_machine_id"] for h in hist} == {a_id, b_id}
            named = {(h["from_machine_name"], h["to_machine_name"]) for h in hist}
            assert named == {(None, None), (None, "machine-b")}

    @pytest.mark.asyncio
    async def test_history_null_actor_yields_null_email(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """``changed_by_user_id`` is FK SET NULL — a null actor resolves to a
        null email rather than erroring or dropping the row."""
        from app.repositories.devenv import canonical_log_repo

        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            await canonical_log_repo.record(
                async_db_session,
                environment_id=UUID(env_id),
                from_machine_id=None,
                to_machine_id=UUID(a_id),
                changed_by_user_id=None,
            )
            await async_db_session.commit()

            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert len(hist) == 1
            assert hist[0]["changed_by_user_id"] is None
            assert hist[0]["changed_by_email"] is None
            assert hist[0]["to_machine_name"] == "machine-a"

    @pytest.mark.asyncio
    async def test_audit_records_active_tenant_best_effort(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The active-tenant header is captured onto the audit row when sent."""
        app = _build_app(db_session=async_db_session, user=test_user)
        tenant_id = str(uuid4())
        async with _client(app) as client:
            env_id, a_id, _, _, _ = await self._seed_env_two_enrolled_machines(client)
            r = await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
                headers={"X-Qontinui-Active-Tenant": tenant_id},
            )
            assert r.status_code == 200, r.text
            hist = (
                await client.get(
                    f"{API_PREFIX}/environments/{env_id}/canonical-history"
                )
            ).json()
            assert hist[0]["tenant_id"] == tenant_id

    @pytest.mark.asyncio
    async def test_pull_canonical_config(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A machine pulls the canonical config + per-section policy, secret-free."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, a_id, _, _, key_b = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )

            # Machine B pulls what to reconcile toward (canonical = A).
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{env_id}/canonical-config",
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["canonical_machine_id"] == a_id
            assert body["canonical_machine_name"] == "machine-a"
            assert body["sections"]["versions"]["python"] == "3.13"
            # Policy delivered alongside so the runner knows what it may apply.
            assert body["section_policy"]["versions"] == "applyable"
            assert body["section_policy"]["env_contract"] == "secret_report_only"
            # Per-key refinement rides along: python is a machine fact, so the
            # applyable versions section reports no derived keys here.
            assert body["derived_keys"]["versions"] == []
            assert body["derived_keys"]["env_contract"] == []
            # Secret-free: env_contract is present/absent, never the raw value.
            assert body["sections"]["env_contract"]["DATABASE_URL"] == "present"
            assert "topsecret" not in r.text

    @pytest.mark.asyncio
    async def test_pull_requires_canonical(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Pulling with no canonical set → 422 no_canonical_machine."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            _env, _a, _b, _ka, key_b = await self._seed_env_two_enrolled_machines(
                client
            )
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{_env}/canonical-config",
                headers={"X-Machine-Key": key_b},
            )
            assert r.status_code == 422, r.text
            assert r.json()["detail"]["code"] == "no_canonical_machine"

    @pytest.mark.asyncio
    async def test_pull_cross_owner_404(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """A machine can only pull its own owner's environment (else 404)."""
        # Owner 1: env + canonical A.
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            env_id, a_id, _b, _ka, _kb = await self._seed_env_two_enrolled_machines(
                client
            )
            await client.put(
                f"{API_PREFIX}/environments/{env_id}/canonical",
                json={"machine_id": a_id},
            )

        # Owner 2: a machine of their own, whose key must NOT reach env_id.
        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.post(f"{API_PREFIX}/machines", json={"name": "intruder"})
            body = r.json()
            r = await client.post(
                f"{API_PREFIX}/agent/enroll",
                json={
                    "enrollment_code": body["enrollment_code"],
                    "machine_id": body["id"],
                },
            )
            key_intruder = r.json()["machine_key"]
            r = await client.get(
                f"{API_PREFIX}/agent/environments/{env_id}/canonical-config",
                headers={"X-Machine-Key": key_intruder},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"


class TestConfigHistory:
    """P2 — append-only config-history timeline + point-to-point diff."""

    async def _seed_enrolled_machine(
        self, client: httpx.AsyncClient
    ) -> tuple[str, str, str]:
        """Create env + one enrolled machine. Returns (env_id, machine_id, key)."""
        r = await client.post(
            f"{API_PREFIX}/environments", json={"name": "Hist", "description": None}
        )
        env_id = r.json()["id"]
        r = await client.post(f"{API_PREFIX}/machines", json={"name": "hist-machine"})
        body = r.json()
        machine_id, code = body["id"], body["enrollment_code"]
        r = await client.post(
            f"{API_PREFIX}/agent/enroll",
            json={"enrollment_code": code, "machine_id": machine_id},
        )
        key = r.json()["machine_key"]
        return env_id, machine_id, key

    @staticmethod
    def _body(sections: dict, captured_at: str) -> dict:
        return {"schema_version": 1, "captured_at": captured_at, "sections": sections}

    @pytest.mark.asyncio
    async def test_history_dedup_diff_and_prune(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Identical re-push adds no row; a change appends; diff shows it;
        prune caps the timeline and reports counts."""
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app) as client:
            env_id, machine_id, key = await self._seed_enrolled_machine(client)
            history_url = (
                f"{API_PREFIX}/environments/{env_id}"
                f"/machines/{machine_id}/config-history"
            )

            # 1. Push a config, then re-push the IDENTICAL envelope → 1 row.
            sections_v1 = {"services": {"redis": "6379"}}
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(sections_v1, "2026-07-01T10:00:00Z"),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(sections_v1, "2026-07-01T10:15:00Z"),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text

            r = await client.get(history_url)
            assert r.status_code == 200, r.text
            hist = r.json()
            assert len(hist) == 1
            # Metadata only — NEVER a config body in the list payload.
            assert "config" not in hist[0]
            assert hist[0]["source"] == "agent"
            assert hist[0]["schema_version"] == 1
            assert len(hist[0]["content_hash"]) == 64

            # 2. Push a CHANGED envelope → a second row, newest first.
            sections_v2 = {"services": {"redis": "6380"}}
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(sections_v2, "2026-07-02T10:00:00Z"),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text

            hist = (await client.get(history_url)).json()
            assert len(hist) == 2
            assert hist[0]["captured_at"] == "2026-07-02T10:00:00Z"
            assert hist[1]["captured_at"] == "2026-07-01T10:00:00Z"
            assert hist[0]["content_hash"] != hist[1]["content_hash"]
            newer_id, older_id = hist[0]["id"], hist[1]["id"]

            # 3. Diff older -> newer surfaces the changed key.
            r = await client.get(
                f"{history_url}/diff",
                params={"from_id": older_id, "to_id": newer_id},
            )
            assert r.status_code == 200, r.text
            diff = r.json()
            assert diff["machine_id"] == machine_id
            assert diff["from_id"] == older_id
            assert diff["to_id"] == newer_id
            assert diff["in_sync"] is False
            delta = _find_delta(_find_section(diff, "services"), "redis")
            assert delta["status"] == "changed"
            assert delta["expected"] == "6379"
            assert delta["actual"] == "6380"

            # 3b. A diff id from nowhere → 404 (missing or foreign pair).
            r = await client.get(
                f"{history_url}/diff",
                params={"from_id": str(uuid4()), "to_id": newer_id},
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "config_history_entry_not_found"

            # 4. Prune with keep_per_pair=1 deletes the older row + reports it.
            from app.repositories.devenv import config_history_repo

            pruned = await config_history_repo.prune(async_db_session, keep_per_pair=1)
            assert pruned == [(UUID(env_id), UUID(machine_id), 1)]

            hist = (await client.get(history_url)).json()
            assert len(hist) == 1
            assert hist[0]["id"] == newer_id

    @pytest.mark.asyncio
    async def test_history_cross_owner_404(
        self, async_db_session: AsyncSession, test_user, second_user
    ) -> None:
        """Another owner cannot read a machine's history (404, not 403)."""
        app1 = _build_app(db_session=async_db_session, user=test_user)
        async with _client(app1) as client:
            env_id, machine_id, key = await self._seed_enrolled_machine(client)
            r = await client.put(
                f"{API_PREFIX}/agent/environments/{env_id}/config",
                json=self._body(
                    {"services": {"redis": "6379"}}, "2026-07-01T10:00:00Z"
                ),
                headers={"X-Machine-Key": key},
            )
            assert r.status_code == 200, r.text

        app2 = _build_app(db_session=async_db_session, user=second_user)
        async with _client(app2) as client:
            r = await client.get(
                f"{API_PREFIX}/environments/{env_id}"
                f"/machines/{machine_id}/config-history"
            )
            assert r.status_code == 404, r.text
            assert r.json()["detail"]["code"] == "environment_not_found"
