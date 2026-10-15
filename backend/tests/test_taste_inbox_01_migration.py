"""Structural and round-trip test for alembic ``taste_inbox_01``.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 23: the taste
inbox's two tables in the ``web`` schema.

Without a database (always runs):

1. **Chain wiring** — ``revision`` / ``down_revision`` / the docstring's
   ``Revises:`` header agree, and the parent is a real sibling revision.
2. **coord's merge-train migration classifier can read it** — every
   ``op.execute`` takes one static string literal, every DDL statement is
   guarded (``IF NOT EXISTS`` / ``IF EXISTS``), the FK-creating and
   FK-dropping statements run under a bounded ``lock_timeout`` that is
   restored afterwards, and nothing names a ``coord.`` relation.
3. **The model and the migration declare the same constraints** — the test
   database is built from the models, so a CHECK only the migration carried
   would be enforced in production and nowhere in the suite. Compared by
   name, and each closed vocabulary by value.

Against a real Postgres (skipped when none is reachable; a skip proves
nothing — point ``QONTINUI_TEST_PG_DSN`` at a throwaway database):

4. **Upgrade from the parent** creates both tables and their indexes, and the
   constraints bite: a pair naming another tenant's image, the same pair in
   the other order, an unknown source or label, a label with no time, half a
   slot, half a capture pair.
5. **Downgrade** removes both tables and leaves ``web.image_assets`` in place;
   **re-upgrade** restores them; re-running the upgrade body is a no-op.
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

from app.models.taste import TASTE_LABELS, TASTE_PAIR_SOURCES, TastePair, TasteSettings
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

_REVISION_ID = "taste_inbox_01"
_REVISION_FILENAME = "taste_inbox_01_taste_pairs.py"
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
    # ast.walk is breadth-first; the statements are all top-level calls, so
    # source order is line order.
    return literals


def _normalised(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


# ───────────────────────────── source-level ─────────────────────────────


def test_revision_chain() -> None:
    module = load_revision_module(_PATH, "taste_inbox_01_under_test")
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
    # The lock bound brackets each body: first and last statement.
    for body in (upgrade, downgrade):
        assert body[0] == _LOCK_ON and body[-1] == _LOCK_OFF, body
        assert body.count(_LOCK_ON) == 1 and body.count(_LOCK_OFF) == 1
    for sql in upgrade[1:-1]:
        assert sql.startswith(
            (
                "CREATE TABLE IF NOT EXISTS web.",
                "CREATE UNIQUE INDEX IF NOT EXISTS ",
                "CREATE INDEX IF NOT EXISTS ",
            )
        ), sql
        assert "coord." not in sql, sql
        assert " DROP " not in f" {sql} ", sql
    for sql in downgrade[1:-1]:
        assert sql.startswith(
            ("DROP TABLE IF EXISTS web.", "DROP INDEX IF EXISTS web.")
        ), sql
    assert not any("DROP SCHEMA" in sql for sql in downgrade)
    assert not any("image_assets" in sql for sql in downgrade)
    unique = next(sql for sql in upgrade if "uq_taste_pairs_pair" in sql)
    assert (
        "LEAST(asset_a_sha256, asset_b_sha256), GREATEST(asset_a_sha256, asset_b_sha256)"
        in unique
    )


def test_the_models_carry_every_check_the_migration_does() -> None:
    in_models = {
        constraint.name
        for model in (TastePair, TasteSettings)
        for constraint in model.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name
    }
    upgrade = _normalised(" ".join(_execute_literals("upgrade")))
    in_migration = set(re.findall(r"CONSTRAINT (ck_taste_\w+)", upgrade))
    assert in_migration
    assert in_models == in_migration, (
        f"model only: {sorted(in_models - in_migration)}; "
        f"migration only: {sorted(in_migration - in_models)}"
    )
    fk_models = {
        fk.name
        for model in (TastePair, TasteSettings)
        for fk in model.__table__.foreign_key_constraints
    }
    assert fk_models == set(re.findall(r"CONSTRAINT (fk_taste_\w+)", upgrade))
    indexes = {index.name for index in TastePair.__table__.indexes}
    assert indexes == set(
        re.findall(r"INDEX IF NOT EXISTS ((?:uq|ix)_taste_\w+)", upgrade)
    )

    def listed(column: str) -> tuple[str, ...]:
        match = re.search(
            rf"CHECK \((?:{column} IS NULL OR )?{column} IN \(([^)]*)\)\)", upgrade
        )
        assert match, f"no IN-list CHECK on {column}"
        return tuple(re.findall(r"'([^']*)'", match.group(1)))

    assert listed("source") == TASTE_PAIR_SOURCES
    assert listed("label") == TASTE_LABELS


# ───────────────────────────── against Postgres ─────────────────────────────

_needs_db = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="Postgres not reachable; point QONTINUI_TEST_PG_DSN at a throwaway database.",
)

_ASSET = text(
    """
    INSERT INTO web.image_assets
        (tenant_id, sha256, storage_key, mime_type, width, height, byte_size, kind)
    VALUES (:tenant, :sha, 'k', 'image/png', 4, 3, 100, :kind)
    """
)
_PAIR = text(
    """
    INSERT INTO web.taste_pairs
        (tenant_id, repo, slot_id, asset_a_sha256, asset_b_sha256,
         capture_a_sha256, capture_b_sha256, source, pushed_by, label, labelled_at)
    VALUES (:tenant, :repo, :slot, :a, :b, :ca, :cb, :source, 'device', :label, :at)
    """
)


def _pair(tenant: uuid.UUID, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant": tenant,
        "repo": None,
        "slot": None,
        "a": "a" * 64,
        "b": "b" * 64,
        "ca": None,
        "cb": None,
        "source": "calibration",
        "label": None,
        "at": None,
    }
    row.update(overrides)
    return row


def _refused(engine: Engine, params: dict[str, object], name: str) -> None:
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(_PAIR, params)
    assert name in str(excinfo.value), str(excinfo.value)


@_needs_db
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "taste_inbox01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert table_exists(engine, "web", "image_assets")
        assert not table_exists(engine, "web", "taste_pairs")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "web", "taste_pairs")
        assert table_exists(engine, "web", "taste_settings")
        for name in (
            "uq_taste_pairs_pair",
            "ix_taste_pairs_pending",
            "ix_taste_pairs_labelled",
        ):
            assert index_exists(engine, name, schema="web"), name

        tenant, other = uuid.uuid4(), uuid.uuid4()
        with engine.begin() as conn:
            for sha in ("a" * 64, "b" * 64, "c" * 64):
                conn.execute(
                    _ASSET, {"tenant": tenant, "sha": sha, "kind": "candidate"}
                )
            conn.execute(_ASSET, {"tenant": tenant, "sha": "d" * 64, "kind": "capture"})
            conn.execute(
                _ASSET, {"tenant": other, "sha": "e" * 64, "kind": "candidate"}
            )
            conn.execute(_PAIR, _pair(tenant))

        # The same question in the other order is the same row.
        _refused(engine, _pair(tenant, a="b" * 64, b="a" * 64), "uq_taste_pairs_pair")
        # A tenant cannot name an image it does not hold.
        _refused(engine, _pair(tenant, b="e" * 64), "fk_taste_pairs_asset_b")
        _refused(engine, _pair(tenant, b="a" * 64), "ck_taste_pairs_distinct_assets")
        _refused(
            engine, _pair(tenant, b="c" * 64, repo="web"), "ck_taste_pairs_slot_whole"
        )
        _refused(
            engine,
            _pair(tenant, b="c" * 64, ca="d" * 64),
            "ck_taste_pairs_captures_paired",
        )
        _refused(
            engine, _pair(tenant, b="c" * 64, source="hunch"), "ck_taste_pairs_source"
        )
        _refused(
            engine,
            _pair(tenant, b="c" * 64, label="maybe", at="2026-10-15T00:00:00Z"),
            "ck_taste_pairs_label",
        )
        _refused(
            engine, _pair(tenant, b="c" * 64, label="a"), "ck_taste_pairs_label_time"
        )
        # The same images for a slot are another question.
        with engine.begin() as conn:
            conn.execute(_PAIR, _pair(tenant, repo="web", slot="home.hero"))
        with pytest.raises(IntegrityError) as budget:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO web.taste_settings (tenant_id, weekly_budget) VALUES (:t, 0)"
                    ),
                    {"t": tenant},
                )
        assert "ck_taste_settings_budget" in str(budget.value)

        # A capture still in use is not deleted out from under its pair…
        with engine.begin() as conn:
            conn.execute(
                _PAIR,
                _pair(
                    tenant, b="c" * 64, ca="d" * 64, cb="d" * 64, repo="web", slot="x"
                ),
            )
        with pytest.raises(IntegrityError) as held:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "DELETE FROM web.image_assets WHERE tenant_id = :t AND sha256 = :s"
                    ),
                    {"t": tenant, "s": "d" * 64},
                )
        assert "fk_taste_pairs_capture" in str(held.value)
        # …but a compared image takes its pairs with it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM web.image_assets WHERE tenant_id = :t AND sha256 = :s"
                ),
                {"t": tenant, "s": "c" * 64},
            )
            left = conn.execute(
                text("SELECT count(*) FROM web.taste_pairs WHERE asset_b_sha256 = :s"),
                {"s": "c" * 64},
            ).scalar_one()
        assert left == 0

        with engine.begin() as conn:
            for sql in _execute_literals("upgrade"):
                conn.execute(text(sql))

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "web", "taste_pairs")
        assert not table_exists(engine, "web", "taste_settings")
        assert not index_exists(engine, "uq_taste_pairs_pair", schema="web")
        assert table_exists(engine, "web", "image_assets")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "web", "taste_pairs")
        assert table_exists(engine, "web", "taste_settings")
