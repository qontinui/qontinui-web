"""Structural and round-trip test for alembic ``presentation_scope_01``.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3): the
presentation scope's table in the ``web`` schema.

Without a database (always runs):

1. **Chain wiring** — ``revision`` / ``down_revision`` / the docstring's
   ``Revises:`` header agree, and the parent is a real sibling revision.
2. **coord's merge-train migration classifier can read it** — every
   ``op.execute`` takes one static string literal, every DDL statement is
   guarded (``IF NOT EXISTS`` / ``IF EXISTS``), the FK-creating and
   FK-dropping statements run under a bounded ``lock_timeout`` that is
   restored afterwards, and nothing names a ``coord.`` relation.
3. **The model and the migration declare the same constraints**, with the
   same bounds — the test database is built from the model, so a CHECK only
   the migration carried would be enforced in production and nowhere in the
   suite.

Against a real Postgres (skipped when none is reachable; a skip proves
nothing — point ``QONTINUI_TEST_PG_DSN`` at a throwaway database):

4. **Upgrade from the parent** creates the table, its defaults apply, and the
   constraints bite: too many owners, too many terms, a version below 1, a
   writer that is not a user; deleting the writer keeps the row.
5. **Downgrade** removes the table and leaves ``auth.users`` in place;
   **re-upgrade** restores it; re-running the upgrade body is a no-op.
"""

from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.models.presentation_scope import (
    MAX_CONFIDENTIAL_TERMS,
    MAX_FIRST_PARTY_OWNERS,
    PresentationScope,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REVISION_ID = "presentation_scope_01"
_REVISION_FILENAME = "presentation_scope_01_create.py"
_PATH: Path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
_LOCK_ON = "SET LOCAL lock_timeout = '3s'"
_LOCK_OFF = "SET LOCAL lock_timeout = DEFAULT"


def _source() -> str:
    return _PATH.read_text(encoding="utf-8")


_PARENT_REVISION_ID = declared_parent_revision_id(_source(), _REVISION_FILENAME)


def _execute_literals(function: str) -> list[str]:
    tree = ast.parse(_source())
    [fn] = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == function
    ]
    literals: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "op"
        ):
            assert len(node.args) == 1 and not node.keywords, ast.dump(node)
            arg = node.args[0]
            assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
                f"op.execute at line {node.lineno} is not a static string literal"
            )
            literals.append(arg.value)
    return literals


def _normalised(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


# ───────────────────────────── source-level ─────────────────────────────


def test_revision_chain() -> None:
    module = load_revision_module(_PATH, "presentation_scope_01_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    header = re.search(r"^Revises: (\S+)$", _source(), re.M)
    assert header and header.group(1) == _PARENT_REVISION_ID
    assert any(
        re.search(
            rf"^revision(?:: str)? = [\"']{re.escape(_PARENT_REVISION_ID)}[\"']",
            path.read_text(encoding="utf-8"),
            re.M,
        )
        for path in _PATH.parent.glob("*.py")
        if path != _PATH
    ), f"no revision file declares the parent {_PARENT_REVISION_ID!r}"


def test_every_statement_is_static_guarded_bounded_and_web_only() -> None:
    upgrade = [_normalised(sql) for sql in _execute_literals("upgrade")]
    downgrade = [_normalised(sql) for sql in _execute_literals("downgrade")]
    for body in (upgrade, downgrade):
        assert body[0] == _LOCK_ON and body[-1] == _LOCK_OFF, body
        assert body.count(_LOCK_ON) == 1 and body.count(_LOCK_OFF) == 1
    assert [sql.split(" (")[0] for sql in upgrade[1:-1]] == [
        "CREATE TABLE IF NOT EXISTS web.presentation_scopes"
    ]
    assert downgrade[1:-1] == ["DROP TABLE IF EXISTS web.presentation_scopes"]
    for sql in upgrade + downgrade:
        assert "coord." not in sql, sql
    assert not any("DROP SCHEMA" in sql for sql in downgrade)
    assert not any("auth.users" in sql for sql in downgrade)


def test_the_model_carries_every_constraint_the_migration_does() -> None:
    in_model = {
        constraint.name
        for constraint in PresentationScope.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name
    }
    upgrade = _normalised(" ".join(_execute_literals("upgrade")))
    in_migration = set(re.findall(r"CONSTRAINT (ck_presentation_scopes_\w+)", upgrade))
    assert in_migration
    assert in_model == in_migration, (
        f"model only: {sorted(in_model - in_migration)}; "
        f"migration only: {sorted(in_migration - in_model)}"
    )
    fk_model = {fk.name for fk in PresentationScope.__table__.foreign_key_constraints}
    assert fk_model == set(
        re.findall(r"CONSTRAINT (fk_presentation_scopes_\w+)", upgrade)
    )
    # The bounds are the model's constants, not a second copy that can drift.
    assert f"cardinality(first_party_owners) <= {MAX_FIRST_PARTY_OWNERS}" in upgrade
    assert f"cardinality(confidential_terms) <= {MAX_CONFIDENTIAL_TERMS}" in upgrade


# ───────────────────────────── against Postgres ─────────────────────────────

_needs_db = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="Postgres not reachable; point QONTINUI_TEST_PG_DSN at a throwaway database.",
)

_INSERT = text(
    """
    INSERT INTO web.presentation_scopes
        (tenant_id, first_party_owners, confidential_terms, version,
         updated_by_user_id)
    VALUES (:tenant, :owners, :terms, :version, :user_id)
    """
)


def _row(tenant: uuid.UUID, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant": tenant,
        "owners": None,
        "terms": [],
        "version": 1,
        "user_id": None,
    }
    row.update(overrides)
    return row


def _refused(engine: Engine, params: dict[str, object], name: str) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(_INSERT, params)
    assert name in str(excinfo.value), str(excinfo.value)


@_needs_db
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "presentation_scope01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert table_exists(engine, "auth", "users")
        assert not table_exists(engine, "web", "presentation_scopes")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "web", "presentation_scopes")

        tenant = uuid.uuid4()
        user_id = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO auth.users
                        (id, email, username, is_active, is_superuser, is_verified,
                         is_beta, subscription_tier, login_count,
                         remember_me_usage_count, automation_streaming_enabled,
                         automation_sessions_used, created_at, updated_at)
                    VALUES
                        (:id, :email, :username, true, false, true, false, 'free',
                         0, 0, false, 0, now(), now())
                    """
                ),
                {
                    "id": user_id,
                    "email": f"scope_{user_id.hex[:8]}@example.com",
                    "username": f"scope_{user_id.hex[:8]}",
                },
            )
            # The defaults: no owners configured, no terms, version 1, a time.
            conn.execute(
                text("INSERT INTO web.presentation_scopes (tenant_id) VALUES (:t)"),
                {"t": tenant},
            )
            stored = conn.execute(
                text(
                    "SELECT first_party_owners, confidential_terms, version, "
                    "updated_at IS NOT NULL FROM web.presentation_scopes "
                    "WHERE tenant_id = :t"
                ),
                {"t": tenant},
            ).one()
        assert tuple(stored) == (None, [], 1, True)

        _refused(
            engine,
            _row(
                uuid.uuid4(),
                owners=[f"o{i}" for i in range(MAX_FIRST_PARTY_OWNERS + 1)],
            ),
            "ck_presentation_scopes_owner_count",
        )
        _refused(
            engine,
            _row(
                uuid.uuid4(), terms=[f"t{i}" for i in range(MAX_CONFIDENTIAL_TERMS + 1)]
            ),
            "ck_presentation_scopes_term_count",
        )
        _refused(
            engine, _row(uuid.uuid4(), version=0), "ck_presentation_scopes_version"
        )
        _refused(
            engine,
            _row(uuid.uuid4(), user_id=uuid.uuid4()),
            "fk_presentation_scopes_updated_by",
        )
        # At the bounds is accepted.
        written = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                _INSERT,
                _row(
                    written,
                    owners=[f"o{i}" for i in range(MAX_FIRST_PARTY_OWNERS)],
                    terms=[f"t{i}" for i in range(MAX_CONFIDENTIAL_TERMS)],
                    user_id=user_id,
                ),
            )
        # Deleting the writer keeps the tenant's scope and forgets who saved it.
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM auth.users WHERE id = :id"), {"id": user_id})
            kept = conn.execute(
                text(
                    "SELECT updated_by_user_id FROM web.presentation_scopes "
                    "WHERE tenant_id = :t"
                ),
                {"t": written},
            ).one()
        assert kept[0] is None

        # Re-running the upgrade body is a no-op.
        with engine.begin() as conn:
            for sql in _execute_literals("upgrade"):
                conn.execute(text(sql))

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "web", "presentation_scopes")
        assert table_exists(engine, "auth", "users")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "web", "presentation_scopes")
