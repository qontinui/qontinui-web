"""Revision ``design_refs_01`` against the real alembic chain.

Plan ``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``
Phase 1. The revision is hand-authored raw SQL (never autogenerate), so the
thing worth checking is that it builds what the models declare:

1. Upgrade from the parent builds the ``design_refs`` tables, the split
   trigger and the seeded vocabularies equal to the model constants; upgrading
   on through ``design_refs_split_intake_01`` (the split is assigned at
   intake) to ``design_refs_jobs_01`` (``capture_job.browser``) leaves
   exactly the models' columns and nullability, exactly their CHECK and
   UNIQUE constraints by name, and every declared index.
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
_SPLIT_REVISION_ID = "design_refs_split_intake_01"
# ``design_refs_jobs_01`` is the design_refs head: it chains off the alembic head
# main carried when it was re-pointed, not off ``design_refs_01``.
_JOBS_REVISION_ID = "design_refs_jobs_01"
_JOBS_PARENT_REVISION_ID = "coord_policy_outcome_counts_02"
_PARENT_REVISION_ID = "coord_subprojects_01"

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

        run_alembic(cwd, url, "upgrade", _JOBS_REVISION_ID)
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

        run_alembic(cwd, url, "upgrade", _JOBS_REVISION_ID)
        assert _columns(engine) == declared


def _insert_site(
    engine: Engine,
    tenant: str,
    tier: str,
    domain: str,
    *,
    confirmed: bool,
    split: str | None,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO design_refs.site
                    (tenant_id, tier, domain, context_state, context_confirmed_at,
                     split, split_assigned_at)
                VALUES (:t, :tier, :d, :state,
                        CASE WHEN :c THEN now() END, :s,
                        CASE WHEN :s IS NOT NULL THEN now() END)
                """
            ),
            {
                "t": tenant,
                "tier": tier,
                "d": domain,
                "state": "confirmed" if confirmed else "proposed",
                "c": confirmed,
                "s": split,
            },
        )


def _splits(engine: Engine) -> dict[tuple[str, str], str | None]:
    with engine.connect() as conn:
        return {
            (tier, domain): split
            for tier, domain, split in conn.execute(
                text("SELECT tier, domain, split FROM design_refs.site")
            ).all()
        }


def test_split_intake_backfills_unsplit_sites_and_reverses() -> None:
    from app.services.design_refs import domain_bucket

    cwd = backend_root()
    held = next(
        f"h{i}.example" for i in range(1000) if domain_bucket(f"h{i}.example") == 0
    )
    kept = next(
        f"k{i}.example" for i in range(1000) if domain_bucket(f"k{i}.example") != 0
    )
    with ephemeral_database(admin_database_url(), "design_refs_split_intake") as (
        engine,
        url,
    ):
        run_alembic(cwd, url, "upgrade", _REVISION_ID)
        tenant = "11111111-1111-1111-1111-111111111111"
        # Unsplit proposed sites, one a hash holdout and one not ...
        _insert_site(engine, tenant, "private", held, confirmed=False, split=None)
        _insert_site(engine, tenant, "private", kept, confirmed=False, split=None)
        # ... a confirmed one the old rule forced to a split the hash disagrees with,
        # whose other-tier sibling is still unsplit ...
        _insert_site(
            engine, tenant, "public", kept + ".x", confirmed=True, split="holdout"
        )
        _insert_site(
            engine, tenant, "private", kept + ".x", confirmed=False, split=None
        )
        # ... and a confirmed one with an ordinary split.
        _insert_site(
            engine, tenant, "private", "done.example", confirmed=True, split="reference"
        )

        run_alembic(cwd, url, "upgrade", _SPLIT_REVISION_ID)
        got = _splits(engine)
        assert got[("private", held)] == "holdout"
        assert got[("private", kept)] == "reference"
        assert got[("private", kept + ".x")] == "holdout"  # the sibling's split
        assert got[("public", kept + ".x")] == "holdout"  # untouched
        assert got[("private", "done.example")] == "reference"
        with engine.connect() as conn:
            assert not conn.execute(
                text(
                    "SELECT count(*) FROM design_refs.site "
                    "WHERE split IS NULL OR split_assigned_at IS NULL"
                )
            ).scalar()
        # A site can no longer be written without a split.
        with pytest.raises(DBAPIError):
            _insert_site(
                engine,
                tenant,
                "private",
                "nosplit.example",
                confirmed=False,
                split=None,
            )
        # The split of an unconfirmed site is allowed at intake: the CHECK is gone.
        _insert_site(
            engine,
            tenant,
            "private",
            "early.example",
            confirmed=False,
            split="reference",
        )

        run_alembic(cwd, url, "downgrade", _REVISION_ID)
        back = _splits(engine)
        assert back[("private", held)] is None
        assert back[("private", "early.example")] is None
        assert back[("private", kept + ".x")] is None
        assert back[("public", kept + ".x")] == "holdout"  # confirmed rows keep theirs
        assert back[("private", "done.example")] == "reference"
        with pytest.raises(DBAPIError, match="ck_site_split_after_confirmation"):
            _insert_site(
                engine,
                tenant,
                "private",
                "late.example",
                confirmed=False,
                split="reference",
            )

        # Reversible: the hash is deterministic.
        run_alembic(cwd, url, "upgrade", _SPLIT_REVISION_ID)
        again = _splits(engine)
        assert again[("private", held)] == "holdout"
        assert again[("private", kept)] == "reference"


def test_jobs_01_adds_the_browser_column_to_existing_rows() -> None:
    """``design_refs_jobs_01`` backfills ``browser = 'launched'``, refuses any
    other value, and downgrades cleanly back to its parent revision."""
    cwd = backend_root()
    with ephemeral_database(admin_database_url(), "design_refs_jobs_01") as (
        engine,
        url,
    ):
        run_alembic(cwd, url, "upgrade", _JOBS_PARENT_REVISION_ID)
        insert = text(
            """
            INSERT INTO design_refs.capture_job
                (tenant_id, url, domain, scope_kind, source, submitter_kind, state)
            VALUES (gen_random_uuid(), 'https://a.example', 'a.example',
                    'page', 'cli', 'operator', 'queued')
            """
        )
        with engine.begin() as conn:
            conn.execute(insert)

        run_alembic(cwd, url, "upgrade", _JOBS_REVISION_ID)
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT browser FROM design_refs.capture_job")
            ).scalars().all() == ["launched"]
        with pytest.raises(DBAPIError, match="ck_capture_job_browser"):
            with engine.begin() as conn:
                conn.execute(text("UPDATE design_refs.capture_job SET browser = 'x'"))
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE design_refs.capture_job SET browser = 'attached'")
            )

        assert _columns(engine)["capture_job"]["claimed_by_actor"] is True

        run_alembic(cwd, url, "downgrade", _JOBS_PARENT_REVISION_ID)
        assert "browser" not in _columns(engine)["capture_job"]
        assert "claimed_by_actor" not in _columns(engine)["capture_job"]


def _browser_constraints(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM pg_constraint "
                    "WHERE conname = 'ck_capture_job_browser'"
                )
            ).scalar_one()
        )


def _expected_twins(engine: Engine) -> int:
    """The adopt guard's scratch constraint must never outlive the guard."""
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM pg_constraint "
                    "WHERE conname = 'ck_capture_job_browser_expected'"
                )
            ).scalar_one()
        )


def test_jobs_01_adopts_pieces_that_already_match() -> None:
    """Every step of ``design_refs_jobs_01`` is guarded: a database that
    already carries the columns (with the declared type and nullability) and
    the CHECK upgrades cleanly, leaving one constraint, not a duplicate."""
    cwd = backend_root()
    with ephemeral_database(admin_database_url(), "design_refs_jobs_01_adopt") as (
        engine,
        url,
    ):
        run_alembic(cwd, url, "upgrade", _JOBS_PARENT_REVISION_ID)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE design_refs.capture_job "
                    "ADD COLUMN browser varchar(16) NOT NULL DEFAULT 'launched', "
                    "ADD COLUMN claimed_by_actor text, "
                    "ADD CONSTRAINT ck_capture_job_browser "
                    "CHECK (browser IN ('launched', 'attached'))"
                )
            )

        run_alembic(cwd, url, "upgrade", _JOBS_REVISION_ID)
        assert _browser_constraints(engine) == 1
        assert _expected_twins(engine) == 0


def test_jobs_01_refuses_a_column_it_did_not_define() -> None:
    """A pre-existing column with another type, nullability or default, or a
    CHECK of the same name with another body, is not adopted silently: the
    upgrade fails, naming it, and leaves the database at the parent revision
    (the DDL is transactional)."""
    cwd = backend_root()
    with ephemeral_database(admin_database_url(), "design_refs_jobs_01_refuse") as (
        engine,
        url,
    ):
        run_alembic(cwd, url, "upgrade", _JOBS_PARENT_REVISION_ID)
        for existing in (
            "browser text NOT NULL DEFAULT 'launched'",  # wrong type
            "browser varchar(16)",  # nullable
            "browser varchar(64) NOT NULL DEFAULT 'launched'",  # wrong length
            "browser varchar(16) NOT NULL DEFAULT 'attached'",  # wrong default
            "claimed_by_actor varchar(16)",  # wrong type
            "claimed_by_actor text DEFAULT 'x'",  # a default it does not declare
        ):
            column = existing.split()[0]
            with engine.begin() as conn:
                conn.execute(
                    text(f"ALTER TABLE design_refs.capture_job ADD COLUMN {existing}")
                )

            result = run_alembic(
                cwd, url, "upgrade", _JOBS_REVISION_ID, expect_success=False
            )
            assert f"design_refs.capture_job.{column} exists" in (
                result.stdout + result.stderr
            ), existing
            assert _browser_constraints(engine) == 0

            with engine.begin() as conn:
                conn.execute(
                    text(f"ALTER TABLE design_refs.capture_job DROP COLUMN {column}")
                )

        # Columns exactly as declared, but a CHECK of the same name whose body
        # differs: refused, naming the constraint and both bodies.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE design_refs.capture_job "
                    "ADD COLUMN browser varchar(16) NOT NULL DEFAULT 'launched', "
                    "ADD COLUMN claimed_by_actor text, "
                    "ADD CONSTRAINT ck_capture_job_browser "
                    "CHECK (browser IN ('launched'))"
                )
            )
        result = run_alembic(
            cwd, url, "upgrade", _JOBS_REVISION_ID, expect_success=False
        )
        assert "constraint ck_capture_job_browser exists as" in (
            result.stdout + result.stderr
        )
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM pg_constraint "
                        "WHERE conname = 'ck_capture_job_browser_expected'"
                    )
                ).scalar_one()
                == 0
            )

        # The same body, but NOT VALID: refused, and the message says so.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE design_refs.capture_job "
                    "DROP CONSTRAINT ck_capture_job_browser"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE design_refs.capture_job "
                    "ADD CONSTRAINT ck_capture_job_browser "
                    "CHECK (browser IN ('launched', 'attached')) NOT VALID"
                )
            )
        result = run_alembic(
            cwd, url, "upgrade", _JOBS_REVISION_ID, expect_success=False
        )
        assert "exists but is NOT VALID" in (result.stdout + result.stderr)
        assert _expected_twins(engine) == 0
