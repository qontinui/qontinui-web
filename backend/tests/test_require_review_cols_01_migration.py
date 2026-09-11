"""Schema + round-trip test for the ``require_review_cols_01`` revision.

Plan ``2026-09-05-require-review-opt-in-columns-web-migration`` lands the two
nullable BOOLEAN columns coord has read ahead of since qontinui-coord#457:
``coord.tenant_merge_settings.require_review`` (tenant tier) and
``coord.tenant_repo_profiles.require_review_override`` (per-repo tier). The DDL
is two ``ADD COLUMN``s; the contract is everything around them, and none of it
is visible from a passing ``upgrade``.

The consumer already exists and is live in production: coord's
``resolve_require_review_db_override`` reads both columns as ``Option<bool>``
and resolves ``trp_override.or(tms).unwrap_or(env)``; the ``PATCH
/pr-merge/settings`` ``require_review`` field writes the tenant tier. Both have
only ever met an absent column. So the first thing that depends on this shape
is the production merge predicate — and when ``require_review`` resolves
``true`` it GATES merges on a GitHub approval. That is why the shape is pinned
here rather than discovered by the gate.

What is asserted, and why each one can break silently:

1. **Both tiers get their column.** The two ``add_column`` calls are
   independent, so one passing is not evidence about the other, and a
   tenant-only landing raises no error anywhere: coord's resolver would simply
   never find a per-repo override.
2. **Exact type.** coord reads both as ``Option<bool>`` straight off the row. A
   non-BOOLEAN column is a tokio-postgres runtime error inside the predicate.
3. **Nullable, with no default** — the load-bearing one. NULL means "inherit
   the next tier up". A ``NOT NULL DEFAULT false`` on ``tenant_repo_profiles``
   would turn every enrolled repo's existing profile row into an EXPLICIT
   per-repo OFF, and an explicit per-repo value dominates the tenant tier: an
   operator would flip review on at the tenant tier, read it back as on, and
   it would gate nothing on any repo that has a profile.
4. **Up → down → up leaves no residue and does not touch data.** ``downgrade``
   must drop from BOTH tables while leaving the tables and any live settings
   rows alone.
5. **``upgrade()`` is idempotent** — the revision's own documented claim.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=host:port`` (NOT ``DATABASE_URL``,
which ``conftest.py`` overwrites unconditionally at import time).
"""

from __future__ import annotations

import re
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
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST equal
# the revision's own `down_revision` — the first test below enforces it.
_REVISION_ID = "require_review_cols_01"
_PARENT_REVISION_ID = "atu_03_embedded_defaults"
_REVISION_FILENAME = "require_review_cols_01_require_review_columns.py"

_REPO_TABLE = "tenant_repo_profiles"
_TENANT_TABLE = "tenant_merge_settings"

# Unlike the ff-land dial the two tiers carry DIFFERENT column names — the
# `_override` suffix on the repo tier is the spelling coord's SQL uses
# (`trp.require_review_override`), so it is pinned per table here.
_TIER_COLUMNS: dict[str, str] = {
    _TENANT_TABLE: "require_review",
    _REPO_TABLE: "require_review_override",
}

_EXPECTED_TYPE = "boolean"


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` names the revision's real parent."""
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together."
    )


def test_the_revision_names_both_tiers_and_columns_in_upgrade_and_downgrade() -> None:
    """Both tables AND both column spellings appear on both sides.

    Crude and unskippable: the live-schema tests below skip without a Postgres,
    and "both tiers, with the exact column names coord's SQL uses" is precisely
    what a later edit could drop while leaving a green summary line behind.
    """
    source = _revision_source()
    upgrade_body = source.split("def upgrade()", 1)[-1].split("def downgrade()", 1)[0]
    downgrade_body = source.split("def downgrade()", 1)[-1]

    for func_name, body in (("upgrade", upgrade_body), ("downgrade", downgrade_body)):
        for table, column in _TIER_COLUMNS.items():
            assert f'"{table}"' in body, (
                f"{_REVISION_FILENAME}:{func_name}() does not name coord.{table}."
            )
            assert f'"{column}"' in body, (
                f"{_REVISION_FILENAME}:{func_name}() does not name "
                f"coord.{table}.{column} — the spelling coord's resolver SELECTs."
            )


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str, str | None]]:
    """``{column: (data_type, is_nullable, column_default)}`` for ``coord.<table>``."""
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        return {
            r[0]: (r[1], r[2], r[3]) for r in conn.execute(sql, {"t": table}).fetchall()
        }


def _assert_dial_present(engine: Engine) -> None:
    """Each tier carries its column: boolean, nullable, undefaulted."""
    for table, column in _TIER_COLUMNS.items():
        cols = _columns(engine, table)
        assert column in cols, (
            f"coord.{table} does not carry {column}. Both tiers are required: a "
            f"missing tier raises no error anywhere — coord's resolver just "
            f"never finds that tier's value."
        )

        data_type, nullable, default = cols[column]
        assert data_type == _EXPECTED_TYPE, (
            f"coord.{table}.{column} is {data_type}, expected {_EXPECTED_TYPE}; "
            f"coord reads it as Option<bool> straight off the row"
        )
        assert nullable == "YES", (
            f"coord.{table}.{column} is NOT NULL. NULL is how this schema spells "
            f"'inherit the next tier up'; without it the three-tier resolver "
            f"collapses."
        )
        assert default is None, (
            f"coord.{table}.{column} has DEFAULT {default!r}. A default makes "
            f"every pre-existing row an EXPLICIT value, and on coord.{_REPO_TABLE} "
            f"an explicit per-repo false DOMINATES a tenant-tier true — review "
            f"would read as on and gate nothing on every enrolled repo."
        )


def _assert_dial_absent(engine: Engine) -> None:
    """No residue on either tier after downgrade."""
    for table, column in _TIER_COLUMNS.items():
        assert column not in _columns(engine, table), (
            f"coord.{table} still carries {column} after downgrade(); downgrade "
            f"must be the exact inverse of upgrade on BOTH tiers. A half-dropped "
            f"column is worse than none: upgrade()'s per-column inspector guard "
            f"will skip the survivor and report success."
        )


def _seed_tenant(engine: Engine) -> uuid.UUID:
    """One tenant, as any live database has — both tiers FK to it."""
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'require_review_cols_01 fixture')
                """
            ),
            {"t": str(tenant_id), "slug": f"rrcols-{tenant_id.hex[:12]}"},
        )
    return tenant_id


def _seed_settings_rows(engine: Engine, tenant_id: uuid.UUID, repo: str) -> None:
    """A tenant-tier row and a per-repo row, both pre-dating the columns."""
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO coord.tenant_merge_settings (tenant_id) VALUES (:t)"),
            {"t": str(tenant_id)},
        )
        conn.execute(
            text(
                "INSERT INTO coord.tenant_repo_profiles (tenant_id, repo) "
                "VALUES (:t, :r)"
            ),
            {"t": str(tenant_id), "r": repo},
        )


def _dial_values(
    engine: Engine, tenant_id: uuid.UUID, repo: str
) -> tuple[bool | None, bool | None]:
    """``(tenant_tier, repo_tier)`` raw values — NULL preserved as ``None``."""
    tenant_col = _TIER_COLUMNS[_TENANT_TABLE]
    repo_col = _TIER_COLUMNS[_REPO_TABLE]
    with engine.connect() as conn:
        tenant_value = conn.execute(
            text(
                f"SELECT {tenant_col} FROM coord.{_TENANT_TABLE} WHERE tenant_id = :t"
            ),  # f-string: table/column are module constants, never input
            {"t": str(tenant_id)},
        ).scalar_one()
        repo_value = conn.execute(
            text(
                f"SELECT {repo_col} FROM coord.{_REPO_TABLE} "
                f"WHERE tenant_id = :t AND repo = :r"
            ),  # f-string: table/column are module constants, never input
            {"t": str(tenant_id), "r": repo},
        ).scalar_one()
    return tenant_value, repo_value


def _profile_identity(engine: Engine, tenant_id: uuid.UUID, repo: str) -> tuple:
    """The repo profile's pre-existing columns — what must survive the walk."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT repo, framework_signals, escalate_paths_extra,
                       profile_version, profile_source
                  FROM coord.tenant_repo_profiles
                 WHERE tenant_id = :t AND repo = :r
                """
            ),
            {"t": str(tenant_id), "r": repo},
        ).fetchone()
    assert row is not None, "the seeded repo profile row vanished"
    return tuple(row)


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_null_is_distinguishable_from_false_on_both_tiers(_admin_url: str) -> None:
    """The columns' shape, then the property that shape exists for.

    NULL ("inherit the next tier up") and false ("explicitly off here") stay
    two different values on both tiers. All three states are written and read
    back, because "the column accepts false" and "the column can still be NULL
    afterwards" are different claims and only the pair rules out a default.
    """
    repo = "qontinui/qontinui-coord"
    with ephemeral_database(_admin_url, "require_review_cols_01_null") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_dial_present(engine)
        tenant_id = _seed_tenant(engine)
        _seed_settings_rows(engine, tenant_id, repo)

        assert _dial_values(engine, tenant_id, repo) == (None, None), (
            "a row that has never set require-review must read as NULL on both "
            "tiers, not as a defaulted false — coord resolves NULL/NULL to the "
            "env/default (autonomous merge), which is the shipped default"
        )

        # Tenant tier opts in; the repo tier is still inheriting — the state an
        # operator turning on a reviewing merge agent for the whole tenant is in.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_TENANT_TABLE} "
                    f"SET {_TIER_COLUMNS[_TENANT_TABLE]} = true WHERE tenant_id = :t"
                ),  # f-strings: table/column are module constants, never input
                {"t": str(tenant_id)},
            )
        assert _dial_values(engine, tenant_id, repo) == (True, None), (
            "a tenant-tier opt-in must not disturb the per-repo tier's NULL"
        )

        # The per-repo tier pins OFF against a tenant-tier ON — how one repo is
        # held autonomous while the tenant reviews. With a default applied this
        # state would be indistinguishable from the inheriting one above.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_REPO_TABLE} "
                    f"SET {_TIER_COLUMNS[_REPO_TABLE]} = false "
                    f"WHERE tenant_id = :t AND repo = :r"
                ),  # f-strings: table/column are module constants, never input
                {"t": str(tenant_id), "r": repo},
            )
        assert _dial_values(engine, tenant_id, repo) == (True, False), (
            "an explicit per-repo false must be storable and readable alongside "
            "a tenant-tier true; coord resolves that pair to false for this repo"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_settings_rows(
    _admin_url: str,
) -> None:
    """The full walk: live rows on BOTH tiers survive, and downgrade cleans both."""
    repo = "qontinui/qontinui-web"
    with ephemeral_database(_admin_url, "require_review_cols_01_rt") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id = _seed_tenant(engine)
        _seed_settings_rows(engine, tenant_id, repo)
        _assert_dial_present(engine)

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_REPO_TABLE} "
                    f"SET {_TIER_COLUMNS[_REPO_TABLE]} = true "
                    f"WHERE tenant_id = :t AND repo = :r"
                ),  # f-strings: table/column are module constants, never input
                {"t": str(tenant_id), "r": repo},
            )
        before = _profile_identity(engine, tenant_id, repo)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_dial_absent(engine)
        for table in _TIER_COLUMNS:
            assert table_exists(engine, "coord", table), (
                f"downgrade() dropped coord.{table}; it owns one COLUMN there, "
                f"not the table — that belongs to pr_merge_02_tenant_settings"
            )
        assert _profile_identity(engine, tenant_id, repo) == before, (
            "downgrade() disturbed the live repo profile; it must drop a "
            "column, not data"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_dial_present(engine)
        assert _profile_identity(engine, tenant_id, repo) == before

        # Re-added columns are NULL for rows that predate them: while they did
        # not exist no opt-in could have been in force, so there is nothing to
        # backfill — and a downgrade/upgrade cycle must not silently re-arm a
        # review gate an operator had turned on.
        assert _dial_values(engine, tenant_id, repo) == (None, None), (
            "a downgrade/upgrade cycle re-armed require-review from nowhere"
        )

        # Idempotency: a second upgrade against the migrated DB is a no-op.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_dial_present(engine)
        assert _dial_values(engine, tenant_id, repo) == (None, None)
