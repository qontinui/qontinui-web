"""Behaviour test for the ``build_records_01_export`` revision.

Pins the reversible shape of the Phase 1 build-record schema (plan
``2026-10-09-factory-built-product-portfolio-and-launch-kit``):

1. **Upgrade** creates ``coord.build_record_products`` and the four ``web.*``
   tables, with the cursor columns, the snapshot's ``allowlist_version`` and
   the slug CHECK.
2. **Downgrade** drops every table, so no retracted page survives it. The
   migration's delete-retracted-rows-first step is not separately observable
   once the tables are gone, and this test does not pin it.
3. **Upgrade again** succeeds on the downgraded database.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    table_exists,
)

_REVISION_ID = "build_records_01_export"
_REVISION_FILENAME = "build_records_01_export.py"
_TENANT = uuid.UUID("5d0c7a43-2b8e-4f61-9a3c-7e1d4b6f8a20")
_WEB_TABLES = (
    "build_record_public_slugs",
    "build_record_snapshots",
    "github_rate_budget",
    "build_record_pending_not_public",
)


def _parent_revision_id() -> str:
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


def _columns(engine: Engine, schema: str, table: str) -> set[str]:
    with engine.connect() as conn:
        return set(
            conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = :s AND table_name = :t"
                ),
                {"s": schema, "t": table},
            ).scalars()
        )


def _seed(engine: Engine, slug: str, *, retracted: bool) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO web.build_record_public_slugs "
                "(public_slug, tenant_id, unpublished_at) "
                "VALUES (:slug, :tid, CASE WHEN :retracted THEN now() END)"
            ),
            {"slug": slug, "tid": _TENANT, "retracted": retracted},
        )
        conn.execute(
            text(
                "INSERT INTO web.build_record_snapshots "
                "(tenant_id, public_slug, version, document, content_sha256, "
                " generated_at, allowlist_version) "
                "VALUES (:tid, :slug, 1, '{}'::jsonb, repeat('a', 64), now(), 1)"
            ),
            {"slug": slug, "tid": _TENANT},
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_build_records_01_upgrades_downgrades_and_upgrades_again() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "brx01_test") as (engine, url):
        run_alembic(root, url, "upgrade", _parent_revision_id())
        assert not table_exists(engine, "coord", "build_record_products")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", "build_record_products")
        for table in _WEB_TABLES:
            assert table_exists(engine, "web", table), table
        assert {
            "unpublished_at",
            "last_visibility_attempt_at",
            "last_visibility_check_at",
            "visibility_check_offset",
            "visibility_unknown_attempts",
            "first_unanswered_attempt_at",
        } <= _columns(engine, "web", "build_record_public_slugs")
        assert {"allowlist_version", "generated_at"} <= _columns(
            engine, "web", "build_record_snapshots"
        )
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO coord.build_record_products "
                        "(tenant_id, slug, title) VALUES (:t, 'Bad_Slug', 'x')"
                    ),
                    {"t": _TENANT},
                )

        _seed(engine, "live-product", retracted=False)
        _seed(engine, "retracted-product", retracted=True)

        run_alembic(root, url, "downgrade", _parent_revision_id())
        assert not table_exists(engine, "coord", "build_record_products")
        for table in _WEB_TABLES:
            assert not table_exists(engine, "web", table), table

        # Upgrade again: the tables are back, and the retracted page was not
        # resurrected by the round trip.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in _WEB_TABLES:
            assert table_exists(engine, "web", table), table
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT 1 FROM web.build_record_public_slugs "
                        "WHERE public_slug = 'retracted-product'"
                    )
                ).first()
                is None
            )
