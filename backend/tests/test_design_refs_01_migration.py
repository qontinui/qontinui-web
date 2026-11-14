"""Revision ``design_refs_01`` against the real alembic chain.

Plan ``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``
Phase 1. The revision is hand-authored raw SQL (never autogenerate), so the
thing worth checking is that it builds what the models declare:

1. Upgrade from the parent builds every ``design_refs`` table with exactly the
   models' columns and nullability, exactly their CHECK and UNIQUE constraints
   by name, every declared index, the split trigger, and the seeded
   vocabularies equal to the model constants.
2. The split trigger refuses a change of an assigned split and allows the
   first assignment.
3. Downgrade to the parent removes the schema (and its trigger function);
   a second upgrade re-applies cleanly.

Substrate: ``_alembic_harness`` — an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import CheckConstraint, UniqueConstraint, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError

from app.models import design_refs as models
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "design_refs_01"
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"

pytestmark = pytest.mark.skipif(
    not can_connect(admin_database_url()), reason="no test Postgres reachable"
)


def _columns(engine: Engine) -> dict[str, dict[str, bool]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT table_name, column_name, is_nullable = 'YES'
                  FROM information_schema.columns
                 WHERE table_schema = 'design_refs'
                """
            )
        ).all()
    out: dict[str, dict[str, bool]] = {}
    for table, column, nullable in rows:
        out.setdefault(table, {})[column] = bool(nullable)
    return out


def _indexes(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT indexname FROM pg_indexes WHERE schemaname = 'design_refs'"
                )
            ).all()
        }


def _constraints(engine: Engine) -> set[tuple[str, str, str]]:
    """``(table, kind, name)`` of every CHECK and UNIQUE constraint."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT t.relname, c.contype, c.conname
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'design_refs' AND c.contype IN ('c', 'u')
                """
            )
        ).all()
    return {(t, "check" if k == "c" else "unique", name) for t, k, name in rows}


def _declared_constraints() -> set[tuple[str, str, str]]:
    out: set[tuple[str, str, str]] = set()
    for model in models.DESIGN_REFS_MODELS:
        table = model.__table__
        for constraint in table.constraints:
            if isinstance(constraint, CheckConstraint) and constraint.name:
                out.add((table.name, "check", str(constraint.name)))
            elif isinstance(constraint, UniqueConstraint) and constraint.name:
                out.add((table.name, "unique", str(constraint.name)))
    return out


def _schema_exists(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'design_refs')"
                )
            ).scalar()
        )


def test_design_refs_01_builds_what_the_models_declare() -> None:
    cwd = backend_root()
    with ephemeral_database(admin_database_url(), "design_refs_01") as (engine, url):
        run_alembic(cwd, url, "upgrade", _PARENT_REVISION_ID)
        assert not _schema_exists(engine)

        run_alembic(cwd, url, "upgrade", _REVISION_ID)
        live = _columns(engine)
        declared = {
            model.__table__.name: {
                c.name: bool(c.nullable) for c in model.__table__.columns
            }
            for model in models.DESIGN_REFS_MODELS
        }
        assert live == declared
        # CHECK and UNIQUE constraints, by name, in both directions.
        assert _constraints(engine) == _declared_constraints()

        declared_indexes = {
            index.name
            for model in models.DESIGN_REFS_MODELS
            for index in model.__table__.indexes
        }
        assert declared_indexes <= _indexes(engine)

        with engine.connect() as conn:
            families = conn.execute(
                text("SELECT key, label FROM design_refs.style_family ORDER BY key")
            ).all()
            dims = conn.execute(
                text(
                    "SELECT key, pole_high, pole_low, anchors::text "
                    "FROM design_refs.perception_dimension ORDER BY key"
                )
            ).all()
            traits = conn.execute(
                text(
                    "SELECT key, description FROM design_refs.personality_trait ORDER BY key"
                )
            ).all()
        assert [tuple(r) for r in families] == sorted(models.SEED_STYLE_FAMILIES)
        assert [(k, h, lo, json.loads(a)) for k, h, lo, a in dims] == sorted(
            (k, h, lo, dict(a)) for k, h, lo, a in models.SEED_PERCEPTION_DIMENSIONS
        )
        assert [tuple(r) for r in traits] == sorted(models.SEED_PERSONALITY_TRAITS)

        # The split trigger: the first assignment is allowed, a change is not.
        with engine.begin() as conn:
            site_id = conn.execute(
                text(
                    """
                    INSERT INTO design_refs.site
                        (tenant_id, tier, domain, context_state, context_confirmed_at)
                    VALUES (gen_random_uuid(), 'private', 'a.example', 'confirmed', now())
                    RETURNING id
                    """
                )
            ).scalar()
            conn.execute(
                text("UPDATE design_refs.site SET split = 'reference' WHERE id = :id"),
                {"id": site_id},
            )
        with pytest.raises(DBAPIError, match="split"):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE design_refs.site SET split = 'holdout' WHERE id = :id"
                    ),
                    {"id": site_id},
                )

        run_alembic(cwd, url, "downgrade", _PARENT_REVISION_ID)
        assert not _schema_exists(engine)
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM pg_proc WHERE proname = 'site_split_immutable'"
                    )
                ).scalar()
                == 0
            )

        run_alembic(cwd, url, "upgrade", _REVISION_ID)
        assert _columns(engine) == declared
