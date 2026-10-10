"""Schema + round-trip test for the ``overview_05_page_sources`` revision.

Phase 2 of plan ``2026-10-07-agents-publish-documents-to-the-project-overview``
adds the published-page source columns to ``overview.pages``, the per-version
``source_sha`` and provenance to ``overview.page_versions``, the provenance
pair to ``overview.change_log``, and the partial unique index
``uq_overview_pages_source``. What a passing ``upgrade`` does NOT show, and so
what this file pins:

* every column arrives NULLABLE and UNDEFAULTED with the type the ORM model
  declares (``ADD COLUMN IF NOT EXISTS`` is type-blind);
* the index is UNIQUE and PARTIAL — two hand-written pages (no source) never
  collide on it, two pages mirroring the same file in one project do, and the
  same file may be mirrored in another project;
* the three CHECKs arrive VALIDATED and refuse what the API refuses — a
  ``source_repo`` not in lowercase, half a source, a ``source_sha`` with no
  source — for any writer, the model declares the same three, and they go
  with a downgrade;
* up → down → up leaves no residue, and the pre-existing page survives.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` /
``QONTINUI_TEST_PG_DSN``). A skip proves nothing.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "overview_05_page_sources"
_PARENT_REVISION_ID = "devcred_01_credential_deny_and_bound_pair_codes"
_REVISION_FILENAME = "overview_05_page_sources.py"

#: (table, column, information_schema.data_type)
_EXPECTED: tuple[tuple[str, str, str], ...] = (
    ("pages", "source_repo", "text"),
    ("pages", "source_path", "text"),
    ("pages", "source_sha", "text"),
    ("page_versions", "source_sha", "text"),
    ("page_versions", "via_device", "uuid"),
    ("page_versions", "via_session", "text"),
    ("change_log", "via_device", "uuid"),
    ("change_log", "via_session", "text"),
)


#: name -> the row that violates it (repo, path, sha)
_CHECKS: dict[str, tuple[str | None, str | None, str | None]] = {
    "ck_overview_pages_source_repo_lowercase": ("Qontinui/X", "a.md", None),
    "ck_overview_pages_source_pair": ("qontinui/x", None, None),
    "ck_overview_pages_source_sha_needs_source": (None, None, "a" * 40),
}


def _checks(engine) -> dict[str, bool]:
    """The source CHECKs on ``overview.pages``, each with ``convalidated``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT conname, convalidated FROM pg_constraint "
                "WHERE conrelid = 'overview.pages'::regclass AND contype = 'c' "
                "AND conname = ANY(:names)"
            ),
            {"names": list(_CHECKS)},
        ).all()
    return {str(name): bool(validated) for name, validated in rows}


def _revision_source() -> str:
    path: Path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    return path.read_text(encoding="utf-8")


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    declared = declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
    assert declared == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={declared!r} but this test "
        f"pins {_PARENT_REVISION_ID!r}; re-point both together"
    )


def test_the_models_declare_the_same_columns() -> None:
    """The ORM and the revision describe one schema — the test database is
    built from the models, so a column only the revision adds would pass every
    API test and fail in production."""
    from app.models.overview import ChangeLog, Page, PageVersion

    tables = {"pages": Page, "page_versions": PageVersion, "change_log": ChangeLog}
    for table, column, _ in _EXPECTED:
        model_column = tables[table].__table__.c[column]
        assert model_column.nullable, (table, column)
        assert model_column.server_default is None, (table, column)
    index = next(
        i for i in Page.__table__.indexes if i.name == "uq_overview_pages_source"
    )
    assert index.unique
    assert [c.name for c in index.columns] == [
        "tenant_id",
        "kind",
        "source_repo",
        "source_path",
    ]
    model_checks = {
        c.name
        for c in Page.__table__.constraints
        if isinstance(c, CheckConstraint) and c.name in _CHECKS
    }
    assert model_checks == set(_CHECKS)


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def _insert_page(conn, tenant, slug: str, source: tuple[str, str] | None) -> None:
    conn.execute(
        text(
            "INSERT INTO overview.pages (tenant_id, kind, slug, title, "
            "source_repo, source_path) "
            "VALUES (:t, 'document', :slug, :slug, :repo, :path)"
        ),
        {
            "t": tenant,
            "slug": slug,
            "repo": source[0] if source else None,
            "path": source[1] if source else None,
        },
    )


def test_upgrade_shape_the_partial_unique_index_and_a_clean_round_trip(
    _admin_url: str,
) -> None:
    tenant, other = uuid4(), uuid4()
    source = ("qontinui/qontinui-dev-notes", "runbooks/ci.md")
    with ephemeral_database(_admin_url, "overview_05_rtp") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO overview.pages (tenant_id, kind, slug, title) "
                    "VALUES (:t, 'document', 'before', 'Before')"
                ),
                {"t": tenant},
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table, column, data_type in _EXPECTED:
            info = column_info(engine, table, column, schema="overview")
            assert info == (data_type, "YES", None), (table, column, info)
        assert index_exists(engine, "uq_overview_pages_source", schema="overview")

        with engine.begin() as conn:
            # Hand-written pages carry no source and never collide on it.
            _insert_page(conn, tenant, "notes-1", None)
            _insert_page(conn, tenant, "notes-2", None)
            _insert_page(conn, tenant, "mirror", source)
            # The same file mirrored in ANOTHER project is another document.
            _insert_page(conn, other, "mirror", source)
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                _insert_page(conn, tenant, "mirror-again", source)

        assert _checks(engine) == dict.fromkeys(_CHECKS, True)
        for name, (repo, path, sha) in _CHECKS.items():
            with pytest.raises(IntegrityError, match=name):
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO overview.pages (tenant_id, kind, slug, "
                            "title, source_repo, source_path, source_sha) VALUES "
                            "(:t, 'document', :slug, :slug, :repo, :path, :sha)"
                        ),
                        {
                            "t": tenant,
                            "slug": f"violates-{name}",
                            "repo": repo,
                            "path": path,
                            "sha": sha,
                        },
                    )

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for table, column, _ in _EXPECTED:
            assert column_info(engine, table, column, schema="overview") is None
        assert not index_exists(engine, "uq_overview_pages_source", schema="overview")
        assert _checks(engine) == {}
        with engine.connect() as conn:
            kept = conn.execute(
                text("SELECT count(*) FROM overview.pages WHERE slug = 'before'")
            ).scalar_one()
        assert kept == 1

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert index_exists(engine, "uq_overview_pages_source", schema="overview")
        assert _checks(engine) == dict.fromkeys(_CHECKS, True)


def test_a_rerun_after_a_partial_upgrade_converges(_admin_url: str) -> None:
    """The CHECKs commit before the index build; a build that then fails
    leaves the version unstamped, and the re-run must not trip over the
    constraints the first run already added (drop-then-add)."""
    with ephemeral_database(_admin_url, "overview_05_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _checks(engine) == dict.fromkeys(_CHECKS, True)
        assert index_exists(engine, "uq_overview_pages_source", schema="overview")


def test_upgrade_fails_loudly_on_an_invalid_leftover_index(_admin_url: str) -> None:
    """A killed CONCURRENTLY build leaves the index INVALID, and ``IF NOT
    EXISTS`` would skip it by name — so the revision must refuse rather than
    report success over an index that serves no lookup."""
    with ephemeral_database(_admin_url, "overview_05_inv") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        try:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE pg_index SET indisvalid = false WHERE indexrelid = "
                        "'overview.uq_overview_pages_source'::regclass"
                    )
                )
        except Exception as exc:  # noqa: BLE001 — needs a superuser
            pytest.skip(f"cannot mark an index invalid here: {exc}")
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        failed = run_alembic(
            backend_root(), db_url, "upgrade", _REVISION_ID, expect_success=False
        )
        assert "INVALID" in failed.stderr, failed.stderr
