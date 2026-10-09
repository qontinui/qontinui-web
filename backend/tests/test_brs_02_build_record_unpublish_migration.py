"""Behaviour test for the ``brs_02_build_record_unpublish`` revision.

Pins the property its downgrade exists for: dropping ``unpublished_at`` must
NOT resurrect a retracted public build record. Without the column a retracted
slug would read as live, so the downgrade deletes retracted slugs' snapshots
and ownership rows first and leaves live ones alone.

upgrade → seed one live + one retracted slug → downgrade ``brs_02`` → only the
live slug survives → upgrade again (the column returns, the live slug is live).

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "brs_02_build_record_unpublish"
_PARENT_REVISION_ID = "brs_01_build_record_snapshots"
_TENANT = uuid.UUID("5d0c7a43-2b8e-4f61-9a3c-7e1d4b6f8a20")


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


def _slugs(engine: Engine, table: str) -> list[str]:
    with engine.connect() as conn:
        return sorted(
            conn.execute(text(f"SELECT public_slug FROM web.{table}")).scalars()
        )


def _has_column(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema = 'web' "
                    "AND table_name = 'build_record_public_slugs' "
                    "AND column_name = 'unpublished_at'"
                )
            ).first()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_downgrade_deletes_retracted_records_and_keeps_live_ones() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "brs02_test") as (engine, url):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _has_column(engine)

        _seed(engine, "live-product", retracted=False)
        _seed(engine, "retracted-product", retracted=True)

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not _has_column(engine)
        assert _slugs(engine, "build_record_public_slugs") == ["live-product"]
        assert _slugs(engine, "build_record_snapshots") == ["live-product"]

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _has_column(engine)
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT unpublished_at FROM web.build_record_public_slugs "
                        "WHERE public_slug = 'live-product'"
                    )
                ).scalar_one()
                is None
            )
