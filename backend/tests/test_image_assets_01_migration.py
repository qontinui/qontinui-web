"""Structural and round-trip test for alembic ``image_assets_01``.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 13: the
content-addressed image store's two tables in the ``web`` schema.

Without a database (always runs):

1. **Chain wiring** — ``revision`` / ``down_revision`` / the docstring's
   ``Revises:`` header agree, and the parent is a real sibling revision.
2. **coord's merge-train migration classifier can read it** — every
   ``op.execute`` takes one static string literal (``migration_classifier.rs``
   rejects a dynamic one), every statement is guarded (``IF NOT EXISTS`` /
   ``IF EXISTS``), and nothing names a ``coord.`` relation.
3. **The model and the migration declare the same constraints** — the test
   database is built from the models (``conftest.py``'s ``create_all``), so a
   CHECK only the migration carried would be enforced in production and
   nowhere in the suite.

Against a real Postgres (skipped when none is reachable; a skip proves
nothing — point ``QONTINUI_TEST_PG_DSN`` at a throwaway database):

4. **Upgrade from the parent** creates both tables in ``web`` with the
   declared constraints and the partial unique index, and they bite: an
   unknown kind, a non-hex hash, a cross-tenant candidate and a second
   ``chosen`` candidate for one slot are all refused by the schema.
5. **Downgrade** removes both tables and leaves the ``web`` schema (and its
   older tables) in place; **re-upgrade** restores them; re-running the
   upgrade body on an upgraded database is a no-op.
"""

from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.models.image_asset import (
    IMAGE_ASSET_KINDS,
    IMAGE_MIME_TYPES,
    SLOT_CANDIDATE_STATUSES,
    ImageAsset,
    ImageSlotCandidate,
)
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REVISION_ID = "image_assets_01"
_REVISION_FILENAME = "image_assets_01_content_addressed_store.py"
_PATH: Path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _source() -> str:
    return _PATH.read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parsed from the revision's own ``down_revision`` (it gets re-pointed)."""
    return declared_parent_revision_id(_source(), _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()


def _execute_literals(function: str) -> list[str]:
    """The static SQL of every ``op.execute`` in one top-level function."""
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
                f"op.execute at line {node.lineno} is not a static string literal "
                "— coord's migration classifier rejects a dynamic argument"
            )
            literals.append(arg.value)
    return literals


def _normalised(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


# ───────────────────────────── source-level ─────────────────────────────


def test_revision_chain() -> None:
    module = load_revision_module(_PATH, "image_assets_01_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    header = re.search(r"^Revises: (\S+)$", _source(), re.M)
    assert header and header.group(1) == _PARENT_REVISION_ID, (
        "the docstring's Revises: line must move with down_revision"
    )
    versions = _PATH.parent
    assert any(
        re.search(
            rf"^revision(?:: str)? = [\"']{re.escape(_PARENT_REVISION_ID)}[\"']",
            path.read_text(encoding="utf-8"),
            re.M,
        )
        for path in versions.glob("*.py")
        if path != _PATH
    ), f"no revision file declares the parent {_PARENT_REVISION_ID!r}"


def test_every_statement_is_static_guarded_and_web_only() -> None:
    upgrade = [_normalised(sql) for sql in _execute_literals("upgrade")]
    downgrade = [_normalised(sql) for sql in _execute_literals("downgrade")]
    assert len(upgrade) == 3 and len(downgrade) == 3
    for sql in upgrade:
        assert sql.startswith(
            ("CREATE TABLE IF NOT EXISTS web.", "CREATE UNIQUE INDEX IF NOT EXISTS ")
        ), sql
        assert "coord." not in sql, sql
        assert " DROP " not in f" {sql} ", sql
    for sql in downgrade:
        assert sql.startswith(
            ("DROP TABLE IF EXISTS web.", "DROP INDEX IF EXISTS web.")
        ), sql
    # The schema predates this revision and holds other tables: never dropped.
    assert not any("DROP SCHEMA" in sql for sql in downgrade)
    assert (
        "ON web.image_slot_candidates (tenant_id, repo, slot_id) WHERE status = 'chosen'"
        in upgrade[2]
    )


def _check_names(sql: str) -> set[str]:
    return set(re.findall(r"CONSTRAINT (ck_image_\w+)", sql))


def test_the_models_carry_every_check_the_migration_does() -> None:
    """``conftest.py`` builds the test database from the models, not from
    alembic: a CHECK only the migration carried would bite in production and
    nowhere in the suite. Compared by NAME, and each closed vocabulary is
    compared by VALUE against the models' tuples."""
    from sqlalchemy import CheckConstraint

    in_models = {
        constraint.name
        for model in (ImageAsset, ImageSlotCandidate)
        for constraint in model.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name
    }
    in_migration = _check_names(" ".join(_execute_literals("upgrade")))
    assert in_migration, "the migration's CHECK names could not be read"
    assert in_models == in_migration, (
        f"model only: {sorted(in_models - in_migration)}; "
        f"migration only: {sorted(in_migration - in_models)}"
    )

    upgrade = _normalised(" ".join(_execute_literals("upgrade")))

    def listed(column: str) -> tuple[str, ...]:
        match = re.search(rf"CHECK \({column} IN \(([^)]*)\)\)", upgrade)
        assert match, f"no IN-list CHECK on {column}"
        return tuple(re.findall(r"'([^']*)'", match.group(1)))

    assert listed("kind") == IMAGE_ASSET_KINDS
    assert listed("mime_type") == IMAGE_MIME_TYPES
    assert listed("status") == SLOT_CANDIDATE_STATUSES


# ───────────────────────────── against Postgres ─────────────────────────────

_needs_db = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, point QONTINUI_TEST_PG_DSN at a throwaway database."
    ),
)

_ASSET_INSERT = text(
    """
    INSERT INTO web.image_assets
        (tenant_id, sha256, storage_key, mime_type, width, height, byte_size, kind)
    VALUES (:tenant, :sha, :key, :mime, :w, :h, :n, :kind)
    """
)
_CANDIDATE_INSERT = text(
    """
    INSERT INTO web.image_slot_candidates
        (tenant_id, repo, slot_id, asset_sha256, status)
    VALUES (:tenant, :repo, :slot, :sha, :status)
    """
)


def _asset(tenant: uuid.UUID, sha: str, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant": tenant,
        "sha": sha,
        "key": f"image-assets/{tenant}/sha256/{sha[:2]}/{sha}.png",
        "mime": "image/png",
        "w": 4,
        "h": 3,
        "n": 100,
        "kind": "candidate",
    }
    row.update(overrides)
    return row


def _refused(
    engine: Engine, statement: object, params: dict[str, object], name: str
) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(statement, params)  # type: ignore[arg-type]
    assert name in str(excinfo.value), str(excinfo.value)


@_needs_db
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "image_assets01_test") as (
        engine,
        url,
    ):
        # 1. The parent: web exists (bridge_audit_log_01), these tables do not.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert table_exists(engine, "web", "bridge_audit_log")
        assert not table_exists(engine, "web", "image_assets")
        assert not table_exists(engine, "web", "image_slot_candidates")

        # 2. Apply.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "web", "image_assets")
        assert table_exists(engine, "web", "image_slot_candidates")
        assert index_exists(engine, "uq_image_slot_candidates_one_chosen", schema="web")

        tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
        sha_a = "a" * 64
        with engine.begin() as conn:
            conn.execute(_ASSET_INSERT, _asset(tenant_a, sha_a))
            row = conn.execute(
                text(
                    "SELECT provenance, created_at IS NOT NULL FROM web.image_assets "
                    "WHERE tenant_id = :t"
                ),
                {"t": tenant_a},
            ).one()
        assert row[0] == {} and row[1] is True

        # 3. The constraints bite in the migrated schema.
        _refused(
            engine,
            _ASSET_INSERT,
            _asset(tenant_a, sha_a),
            "uq_image_assets_tenant_sha256",
        )
        _refused(
            engine,
            _ASSET_INSERT,
            _asset(tenant_a, "b" * 64, kind="thumbnail"),
            "ck_image_assets_kind",
        )
        _refused(
            engine,
            _ASSET_INSERT,
            _asset(tenant_a, "B" * 64),
            "ck_image_assets_sha256_hex",
        )
        _refused(
            engine,
            _ASSET_INSERT,
            _asset(tenant_a, "c" * 64, mime="image/svg+xml"),
            "ck_image_assets_mime_type",
        )
        _refused(
            engine,
            _ASSET_INSERT,
            _asset(tenant_a, "d" * 64, w=0),
            "ck_image_assets_dimensions_positive",
        )
        _refused(
            engine,
            _ASSET_INSERT,
            _asset(tenant_a, "e" * 64, n=0),
            "ck_image_assets_byte_size_positive",
        )
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO web.image_assets (tenant_id, sha256, storage_key, "
                    "mime_type, width, height, byte_size, kind, orientation) VALUES "
                    "(:t, :s, 'k', 'image/png', 1, 1, 1, 'capture', 6)"
                ),
                {"t": tenant_a, "s": "9" * 64},
            )
        _refused(
            engine,
            text(
                "INSERT INTO web.image_assets (tenant_id, sha256, storage_key, "
                "mime_type, width, height, byte_size, kind, orientation) VALUES "
                "(:t, :s, 'k', 'image/png', 1, 1, 1, 'capture', 9)"
            ),
            {"t": tenant_a, "s": "8" * 64},
            "ck_image_assets_orientation",
        )
        # The same bytes for ANOTHER tenant are a separate row.
        with engine.begin() as conn:
            conn.execute(_ASSET_INSERT, _asset(tenant_b, sha_a))

        candidate = {
            "tenant": tenant_a,
            "repo": "qontinui-web",
            "slot": "home.hero",
            "sha": sha_a,
            "status": "chosen",
        }
        with engine.begin() as conn:
            conn.execute(_CANDIDATE_INSERT, candidate)
        # A tenant cannot name an image it does not hold — the composite FK.
        _refused(
            engine,
            _CANDIDATE_INSERT,
            {**candidate, "tenant": uuid.uuid4()},
            "fk_image_slot_candidates_asset",
        )
        _refused(
            engine,
            _CANDIDATE_INSERT,
            {**candidate, "status": "picked"},
            "ck_image_slot_candidates_status",
        )
        # One chosen candidate per slot.
        with engine.begin() as conn:
            conn.execute(_ASSET_INSERT, _asset(tenant_a, "f" * 64))
        _refused(
            engine,
            _CANDIDATE_INSERT,
            {**candidate, "sha": "f" * 64},
            "uq_image_slot_candidates_one_chosen",
        )
        # …but any number of non-chosen ones, and a chosen one in another slot.
        with engine.begin() as conn:
            conn.execute(
                _CANDIDATE_INSERT, {**candidate, "sha": "f" * 64, "status": "rejected"}
            )
            conn.execute(_CANDIDATE_INSERT, {**candidate, "slot": "home.footer"})
        # Deleting an asset takes its candidates with it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM web.image_assets WHERE tenant_id = :t AND sha256 = :s"
                ),
                {"t": tenant_a, "s": "f" * 64},
            )
            left = conn.execute(
                text(
                    "SELECT count(*) FROM web.image_slot_candidates WHERE asset_sha256 = :s"
                ),
                {"s": "f" * 64},
            ).scalar_one()
        assert left == 0

        # 4. Re-running the upgrade body on the upgraded schema is a no-op.
        with engine.begin() as conn:
            for sql in _execute_literals("upgrade"):
                conn.execute(text(sql))

        # 5. Downgrade: both tables and the index gone, web and its older
        # tables kept.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "web", "image_assets")
        assert not table_exists(engine, "web", "image_slot_candidates")
        assert not index_exists(
            engine, "uq_image_slot_candidates_one_chosen", schema="web"
        )
        assert table_exists(engine, "web", "bridge_audit_log")

        # 6. Re-upgrade restores them — empty of this test's rows, which the
        # downgrade took with the tables.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "web", "image_assets")
        assert table_exists(engine, "web", "image_slot_candidates")
        assert index_exists(engine, "uq_image_slot_candidates_one_chosen", schema="web")
        with engine.connect() as conn:
            survivors = conn.execute(
                text(
                    "SELECT count(*) FROM web.image_assets WHERE tenant_id IN (:a, :b)"
                ),
                {"a": tenant_a, "b": tenant_b},
            ).scalar_one()
        assert survivors == 0
