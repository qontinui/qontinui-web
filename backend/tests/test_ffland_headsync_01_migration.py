"""Schema + round-trip test for the ``ffland_headsync_01`` revision.

Phase 1 of plan ``2026-08-26-coord-ff-land-records-merged-on-github`` adds one
nullable BOOLEAN, ``ff_land_head_sync_enabled``, to **both**
``coord.tenant_merge_settings`` (tenant tier) and ``coord.tenant_repo_profiles``
(per-repo tier). The DDL is two ``ADD COLUMN``s; the contract is everything
around them, and none of it is visible from a passing ``upgrade``.

**Nothing else exercises these columns yet, in any repo.** The consuming build
is ``qontinui-coord#1660``, which is still open — so the first thing that will
ever depend on this shape is coord's production land path. That is the reason
to pin the shape here rather than after the fact.

What is asserted, and why each one can break silently:

1. **Both tiers get the column.** Per-repo granularity is what Phase 2
   graduates on — one repo at a time through ``rollout_state`` — and the plan
   calls it "the point, not a nicety" because the measured benefit ranges from
   87.0% (``qontinui-runner``) to 9.7% (``ui-bridge``). A tenant-only widening
   raises no error and no warning: coord's resolver would simply never find a
   per-repo override, and the dial would look like it worked while being
   ungraduatable. The two ``add_column`` calls are independent, so one passing
   is not evidence about the other.
2. **Exact type.** coord reads the dial as ``Option<bool>`` straight off the
   row. A non-BOOLEAN column is a tokio-postgres runtime error on a path whose
   whole design contract is that it must never be able to fail the land.
3. **Nullable, with no default** — the load-bearing one, and the only assertion
   here that guards a *silent wrong answer* rather than a loud failure. NULL
   means "inherit the next tier up"; the resolution order is
   ``tenant_repo_profiles`` → ``tenant_merge_settings`` → ``Defaults`` (false).
   A ``NOT NULL DEFAULT false`` on ``tenant_repo_profiles`` would turn every
   pre-existing profile row — i.e. every enrolled repo — into an *explicit*
   per-repo OFF, and an explicit per-repo value **dominates** the tenant tier.
   An operator would flip the dial on at the tenant tier, the dashboard would
   read it back as on, and it would do nothing on every repo that has a
   profile. That is Phase 2's graduation path failing silently, which is the
   one failure mode a shadow window cannot distinguish from "the feature is
   off".
4. **Up → down → up leaves no residue and does not touch data.** ``downgrade``
   must drop from *both* tables (leaving one behind is the half-migrated state
   the idempotency guard would then happily skip past on the next upgrade),
   while leaving the tables themselves — they belong to
   ``pr_merge_02_tenant_settings`` — and any live settings rows alone.
5. **``upgrade()`` is idempotent**, which is the revision's own documented
   claim: the adds are guarded by an inspector check rather than by
   ``ADD COLUMN IF NOT EXISTS``, and that guard is per-column.

The CI gates this revision already passes assert none of the above.
``alembic-graph-check`` counts heads. ``migration-reversal.yml`` walks
``upgrade head`` → ``downgrade -1`` → ``upgrade head`` against an **empty**
database, so it proves the SQL parses and nothing about type, nullability,
defaults, or data survival. ``forbid-public-schema.yml`` excludes
``backend/alembic/versions/*`` wholesale, and ``check_alembic_schema_args.py``
only checks that the DDL names a schema.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not
the one accepting the test credentials (on the MSI box the canonical Postgres
listens on **5433**).

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips against 5432 —
which looks exactly like a green run in the summary line.
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
# the revision's own `down_revision` — the first test below enforces it. A
# stale pin rewinds too far and replays unrelated non-idempotent revisions,
# surfacing as someone else's `DuplicateTable`.
_REVISION_ID = "ffland_headsync_01"
_PARENT_REVISION_ID = "projdash_01_stf_prefix_idx"
_REVISION_FILENAME = "ffland_headsync_01_ff_land_head_sync_columns.py"

# The two settings tiers coord's resolver reads, in precedence order:
# per-repo overrides the tenant default, which overrides `Defaults` (false).
_REPO_TABLE = "tenant_repo_profiles"
_TENANT_TABLE = "tenant_merge_settings"
_TIER_TABLES = (_REPO_TABLE, _TENANT_TABLE)

_COLUMN = "ff_land_head_sync_enabled"

# PostgreSQL's own `information_schema` spelling, so a column that regressed to
# TEXT (or to a smallint-shaped "flag") fails loudly here rather than as an
# error inside coord's land path.
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


def test_the_revision_names_both_tiers_in_upgrade_and_downgrade() -> None:
    """Both tables appear on both sides — a structural guard that never skips.

    The live-schema tests below are the real assertion, but they skip without a
    Postgres, and "widen both tiers" is precisely the property a later edit
    could drop while leaving a green summary line behind. Counting the table
    names in each function body is crude, but it is crude *and unskippable*,
    which is the trade this guard is making.
    """
    source = _revision_source()
    upgrade_body = source.split("def upgrade()", 1)[-1].split("def downgrade()", 1)[0]
    downgrade_body = source.split("def downgrade()", 1)[-1]

    for func_name, body in (("upgrade", upgrade_body), ("downgrade", downgrade_body)):
        for table in _TIER_TABLES:
            assert f'"{table}"' in body, (
                f"{_REVISION_FILENAME}:{func_name}() does not name coord.{table}. "
                f"The dial is only graduatable per repo if BOTH tiers carry the "
                f"column, and only reversible if both give it back."
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
    """The dial exists on BOTH tiers, boolean, nullable, undefaulted."""
    for table in _TIER_TABLES:
        cols = _columns(engine, table)
        assert _COLUMN in cols, (
            f"coord.{table} does not carry {_COLUMN}. Both tiers are required: "
            f"the tenant row is the default and the repo row is what Phase 2 "
            f"graduates one repo at a time, and a missing tier raises no error "
            f"anywhere — coord's resolver just never finds an override."
        )

        data_type, nullable, default = cols[_COLUMN]
        assert data_type == _EXPECTED_TYPE, (
            f"coord.{table}.{_COLUMN} is {data_type}, expected {_EXPECTED_TYPE}; "
            f"coord reads it as Option<bool> straight off the row"
        )
        assert nullable == "YES", (
            f"coord.{table}.{_COLUMN} is NOT NULL. NULL is how this schema "
            f"spells 'inherit the next tier up'; without it the tier cannot "
            f"express 'no opinion' and the three-tier resolver collapses."
        )
        assert default is None, (
            f"coord.{table}.{_COLUMN} has DEFAULT {default!r}. A default makes "
            f"every pre-existing row an EXPLICIT value, and on "
            f"coord.{_REPO_TABLE} an explicit per-repo false DOMINATES a "
            f"tenant-tier true — the dial would read as on and do nothing on "
            f"every enrolled repo."
        )


def _assert_dial_absent(engine: Engine) -> None:
    """No residue on either tier after downgrade."""
    for table in _TIER_TABLES:
        assert _COLUMN not in _columns(engine, table), (
            f"coord.{table} still carries {_COLUMN} after downgrade(); "
            f"downgrade must be the exact inverse of upgrade on BOTH tiers. A "
            f"half-dropped column is worse than none: upgrade()'s per-column "
            f"inspector guard will skip the survivor and report success."
        )


def _seed_tenant(engine: Engine) -> uuid.UUID:
    """One tenant, as any live database has — both tiers FK to it."""
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'ffland_headsync_01 fixture')
                """
            ),
            {"t": str(tenant_id), "slug": f"ffland-{tenant_id.hex[:12]}"},
        )
    return tenant_id


def _seed_settings_rows(engine: Engine, tenant_id: uuid.UUID, repo: str) -> None:
    """A tenant-tier row and a per-repo row, both pre-dating the dial.

    Every other column on both tables is nullable or defaulted, so this is the
    shape an operator who has never touched the dial actually has — which is
    the population the nullability assertions are about.
    """
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
    """``(tenant_tier, repo_tier)`` raw dial values — NULL preserved as ``None``."""
    with engine.connect() as conn:
        tenant_value = conn.execute(
            text(
                f"SELECT {_COLUMN} FROM coord.{_TENANT_TABLE} WHERE tenant_id = :t"
            ),  # f-string: the column name is a module constant, never input
            {"t": str(tenant_id)},
        ).scalar_one()
        repo_value = conn.execute(
            text(
                f"SELECT {_COLUMN} FROM coord.{_REPO_TABLE} "
                f"WHERE tenant_id = :t AND repo = :r"
            ),  # f-string: the column name is a module constant, never input
            {"t": str(tenant_id), "r": repo},
        ).scalar_one()
    return tenant_value, repo_value


def _profile_identity(engine: Engine, tenant_id: uuid.UUID, repo: str) -> tuple:
    """The repo profile's pre-existing columns — what must survive the walk.

    Deliberately not the dial column: it does not exist after downgrade, and
    the point of this read is that everything which predates the revision comes
    through untouched.
    """
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
    """The dial's shape, then the property that shape exists for.

    NULL ("inherit the next tier up") and false ("explicitly off here") stay
    two different values. This is what the three-tier resolver is built on, and
    what a ``NOT NULL DEFAULT false`` would erase while every other test still
    passed. All three states are written and read back on both tiers, because
    "the column accepts false" and "the column can still be NULL afterwards"
    are different claims and only the pair of them rules out a default.

    There is deliberately no separate "upgrade adds the columns" test: this one
    upgrades and asserts the full column shape before doing anything else, and
    every database-backed test here replays the whole ~510-revision chain into
    its own ephemeral database, so a duplicate costs a minute of CI for nothing.
    """
    repo = "qontinui/qontinui-runner"
    with ephemeral_database(_admin_url, "ffland_headsync_01_null") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_dial_present(engine)
        tenant_id = _seed_tenant(engine)
        _seed_settings_rows(engine, tenant_id, repo)

        assert _dial_values(engine, tenant_id, repo) == (None, None), (
            "a row that has never set the dial must read as NULL on both tiers, "
            "not as a defaulted false — 'inherit the next tier up' and "
            "'explicitly off here' are different answers, and only NULL can "
            "give the first one"
        )

        # The tenant tier turns the dial on; the repo tier is still inheriting.
        # This is exactly the state Phase 2 graduates FROM, so it has to be
        # representable.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_TENANT_TABLE} SET {_COLUMN} = true "
                    f"WHERE tenant_id = :t"
                ),  # f-strings: table/column are module constants, never input
                {"t": str(tenant_id)},
            )
        assert _dial_values(engine, tenant_id, repo) == (True, None), (
            "a tenant-tier opt-in must not disturb the per-repo tier's NULL"
        )

        # The per-repo tier pins OFF against a tenant-tier ON. If a default had
        # been applied this state would have been indistinguishable from the
        # inheriting one above — which is the whole hazard.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_REPO_TABLE} SET {_COLUMN} = false "
                    f"WHERE tenant_id = :t AND repo = :r"
                ),  # f-strings: table/column are module constants, never input
                {"t": str(tenant_id), "r": repo},
            )
        assert _dial_values(engine, tenant_id, repo) == (True, False), (
            "an explicit per-repo false must be storable and readable alongside "
            "a tenant-tier true; that pair is how a graduated fleet holds one "
            "repo back"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_settings_rows(
    _admin_url: str,
) -> None:
    """The full walk: live rows on BOTH tiers survive, and downgrade cleans both.

    ``downgrade()`` ALTERs both tables, so both are asserted — an over-broad
    drop on either would otherwise stay invisible until coord's next settings
    read.
    """
    repo = "qontinui/qontinui-web"
    with ephemeral_database(_admin_url, "ffland_headsync_01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id = _seed_tenant(engine)
        _seed_settings_rows(engine, tenant_id, repo)
        _assert_dial_present(engine)

        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_REPO_TABLE} SET {_COLUMN} = true "
                    f"WHERE tenant_id = :t AND repo = :r"
                ),  # f-strings: table/column are module constants, never input
                {"t": str(tenant_id), "r": repo},
            )
        before = _profile_identity(engine, tenant_id, repo)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_dial_absent(engine)
        for table in _TIER_TABLES:
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

        # The re-added column is NULL for rows that predate it, which is the
        # honest record: while it did not exist no opt-in could have been in
        # force, so there is nothing to backfill — and a downgrade/upgrade
        # cycle must not silently re-arm a dial an operator had turned on.
        assert _dial_values(engine, tenant_id, repo) == (None, None), (
            "a re-added dial column must come back NULL, not carrying its "
            "pre-downgrade value and not defaulted"
        )


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """A re-run of ``upgrade()`` is a no-op — the revision's own claim.

    The adds are guarded by an inspector check rather than
    ``ADD COLUMN IF NOT EXISTS``, and that guard is written out per column, so
    a copy-paste that checks one table and adds to the other fails here and
    nowhere else. Worth an assertion because a re-run is not hypothetical: it
    is what a redeploy against an already-migrated database does.
    """
    with ephemeral_database(_admin_url, "ffland_headsync_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_dial_present(engine)
