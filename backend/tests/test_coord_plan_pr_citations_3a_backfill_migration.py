"""Data-semantics test for the ``coord_plan_pr_citations_3a_backfill`` revision.

Stage 3a of plan
``D:/qontinui-root/plans/2026-07-06-coord-plan-slug-to-work-unit-slug-rename.md``
folds residual ``coord.plan_pr_citations`` rows into the live successor
``coord.work_unit_pr_citations``, resolving ``plan_slug`` → ``work_unit_id``
through the globally-unique ``coord.work_units.slug``.

Unlike ``test_coord_session_substrate_migration`` (a DDL roundtrip — schema
shape is the whole contract), 3a authors **no schema at all**. Its contract is
entirely *data*: which legacy rows fold, which are deliberately left behind,
what ``source`` the folded rows carry, what the migration *reports* about the
rows it skipped, and which rows the downgrade is allowed to delete. A
schema-shape assertion would prove nothing about any of that, so this test
seeds the parent revision, walks one step up, and asserts the resulting rows.

Why this is worth pinning even though 3a is already applied to prod
==================================================================

* The **downgrade** is live-reachable (a rollback) and untested. It deletes by
  ``source = 'legacy_backfill'``, so its blast radius is exactly the set of
  rows this revision minted — an invariant worth a regression guard, because
  the value is a bare string literal shared between two functions.
* **Stage 3c drops ``coord.plan_pr_citations`` entirely.** Once it does, the
  legacy rows are gone and 3a's fold can never be re-derived or re-checked
  against the source data. This test is the last point at which the fold's
  semantics can be verified against a real legacy table.
* Every fresh substrate — CI, a developer DB, a new tenant deployment — runs
  this revision on real rows.

Cases covered (each is a distinct branch of the migration's SQL)
===============================================================

1. **Resolvable** — ``plan_slug`` matches a ``coord.work_units.slug`` → folded,
   stamped ``source='legacy_backfill'``, ``cited_at`` copied verbatim (NOT
   ``now()``), ``tenant_id`` copied from the legacy row.
2. **Already dual-written** — coord wrote the same edge to both tables → the
   ``ON CONFLICT DO NOTHING`` dedupe fires, the successor keeps exactly one row
   and **retains its original organic ``source``** (the fold must not relabel
   an organic citation as a backfill).
3. **Orphan** — ``plan_slug`` matches no work unit → NOT folded (the successor's
   hard FK forbids it), deliberately **retained** in the legacy table, and
   **counted in the migration's log**.
4. **Cross-tenant drift** — slug matches but both sides carry a non-NULL,
   disagreeing ``tenant_id`` → excluded by the migration's WHERE guard, and
   likewise **counted in the log** rather than silently dropped.
5. **NULL tenant on the legacy side** — not a mismatch → folded.
6. **NULL tenant on the work-unit side** — the guard's other NULL disjunct →
   folded, carrying the legacy row's own tenant.
7. **NULL pr_number / NULL commit_sha** — commit-only and PR-body-only
   citations fold, and a pre-existing NULL-bearing successor row still dedupes,
   which is what pins the ``NULLS NOT DISTINCT`` property both table migrations
   call out as REQUIRED (a plain ``UNIQUE`` would NOT dedupe these).

Then three walks are asserted:

* **re-run** (``stamp`` back to the parent, upgrade again) — the INSERT runs a
  second time over its OWN prior output and mints nothing new. This is the
  migration's actual idempotency claim, and the prod-repair scenario.
* **downgrade** — removes exactly the minted rows, leaving the organic
  successor rows and the whole legacy table intact.
* **re-upgrade** — the fold is re-derivable from the retained legacy rows.

Substrate comes from ``_alembic_harness`` (shared with
``test_coord_session_substrate_migration``): an ephemeral DB inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

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

# The revision under test and its parent. Both are pinned explicitly rather
# than using "head" so a later migration landing on top cannot silently change
# what this test walks.
_REVISION_ID = "coord_plan_pr_citations_3a_backfill"
_PARENT_REVISION_ID = "appid_01_co_occurrence_app_id"

# The source literal the migration stamps on every row it mints, and deletes by
# on downgrade. Kept as a module constant so the "downgrade targets exactly
# this" assertion reads against one name.
_BACKFILL_SOURCE = "legacy_backfill"

_REPO = "qontinui/qontinui-web"

# Eight legacy rows across the seven cases. Four do not mint: two are already
# present in the successor (cases 2 and 7a, which dedupe), one is an orphan
# (case 3), one is cross-tenant drift (case 4) — so the fold mints exactly four.
_LEGACY_ROWS = 8
_MINTED_ROWS = 4
_PRESEEDED_SUCCESSOR_ROWS = 2
_TOTAL_SUCCESSOR_ROWS = _MINTED_ROWS + _PRESEEDED_SUCCESSOR_ROWS


class _Fixtures:
    """Ids and tenants the seeded rows are addressed by."""

    def __init__(
        self, units: dict[str, uuid.UUID], tenant_a: uuid.UUID, tenant_b: uuid.UUID
    ):
        self.units = units
        self.tenant_a = tenant_a
        self.tenant_b = tenant_b


def _seed(engine: Engine) -> _Fixtures:
    """Seed the eight legacy rows (seven cases) plus two successor rows.

    Seeding must happen at the PARENT revision: 3a is a one-shot DML step, so
    rows inserted after it has run would never be folded.
    """
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    # Slugs are globally unique (idx_work_units_slug), so each resolves to at
    # most one work unit — the property the migration's join relies on.
    # `wu-null-wu-tenant` deliberately carries a NULL tenant (case 6).
    units: dict[str, uuid.UUID | None] = {
        "wu-resolvable": tenant_a,
        "wu-dual-written": tenant_a,
        "wu-tenant-drift": tenant_a,
        "wu-null-tenant": tenant_a,
        "wu-null-cols": tenant_a,
        "wu-null-wu-tenant": None,
    }
    ids: dict[str, uuid.UUID] = {}

    with engine.begin() as conn:
        for slug, tenant in units.items():
            unit_id = uuid.uuid4()
            ids[slug] = unit_id
            conn.execute(
                text(
                    """
                    INSERT INTO coord.work_units (id, slug, tenant_id, status)
                    VALUES (:id, :slug, :tenant, 'in_progress')
                    """
                ),
                {"id": unit_id, "slug": slug, "tenant": tenant},
            )

        def legacy(
            slug: str,
            pr: int | None,
            sha: str | None,
            source: str,
            tenant: uuid.UUID | None,
            cited_at: str,
        ) -> None:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.plan_pr_citations
                        (tenant_id, plan_slug, repo, pr_number, commit_sha,
                         source, cited_at)
                    VALUES (:tenant, :slug, :repo, :pr, :sha, :source, :cited_at)
                    """
                ),
                {
                    "tenant": tenant,
                    "slug": slug,
                    "repo": _REPO,
                    "pr": pr,
                    "sha": sha,
                    "source": source,
                    "cited_at": cited_at,
                },
            )

        def successor(
            slug: str,
            pr: int | None,
            sha: str | None,
            source: str,
            tenant: uuid.UUID | None,
            cited_at: str,
        ) -> None:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.work_unit_pr_citations
                        (tenant_id, work_unit_id, repo, pr_number, commit_sha,
                         source, cited_at)
                    VALUES (:tenant, :wu, :repo, :pr, :sha, :source, :cited_at)
                    """
                ),
                {
                    "tenant": tenant,
                    "wu": ids[slug],
                    "repo": _REPO,
                    "pr": pr,
                    "sha": sha,
                    "source": source,
                    "cited_at": cited_at,
                },
            )

        # 1. Resolvable — folds.
        legacy(
            "wu-resolvable", 101, "aaa111", "pr_body", tenant_a, "2026-01-01T00:00:00Z"
        )

        # 2. Already dual-written on a fully non-NULL key — dedupes, and must
        #    keep its organic source rather than being relabelled.
        legacy(
            "wu-dual-written",
            202,
            "bbb222",
            "pr_body",
            tenant_a,
            "2026-02-02T00:00:00Z",
        )
        successor(
            "wu-dual-written",
            202,
            "bbb222",
            "pr_body",
            tenant_a,
            "2026-02-02T00:00:00Z",
        )

        # 3. Orphan — no coord.work_units row carries this slug.
        legacy(
            "wu-does-not-exist",
            303,
            "ccc333",
            "pr_body",
            tenant_a,
            "2026-03-03T00:00:00Z",
        )

        # 4. Cross-tenant drift — slug resolves but tenants disagree (both
        #    non-NULL). Excluded by the migration's WHERE guard.
        legacy(
            "wu-tenant-drift",
            404,
            "ddd444",
            "pr_body",
            tenant_b,
            "2026-04-04T00:00:00Z",
        )

        # 5. NULL tenant on the LEGACY side — not a mismatch, so it folds.
        legacy(
            "wu-null-tenant",
            505,
            "eee555",
            "manual_backfill",
            None,
            "2026-05-05T00:00:00Z",
        )

        # 6. NULL tenant on the WORK-UNIT side — the guard's other NULL
        #    disjunct. Folds, carrying the legacy row's own tenant.
        legacy(
            "wu-null-wu-tenant",
            707,
            "ggg777",
            "pr_body",
            tenant_a,
            "2026-07-07T00:00:00Z",
        )

        # 7. NULL pr_number (commit-only) and NULL commit_sha (PR-body-only).
        #    The commit-only edge is ALSO pre-seeded in the successor, so the
        #    dedupe has to fire on a key containing a NULL — which only
        #    NULLS NOT DISTINCT achieves.
        legacy(
            "wu-null-cols",
            None,
            "fff666",
            "commit_message",
            tenant_a,
            "2026-06-06T00:00:00Z",
        )
        successor(
            "wu-null-cols",
            None,
            "fff666",
            "commit_message",
            tenant_a,
            "2026-06-06T00:00:00Z",
        )
        legacy("wu-null-cols", 606, None, "pr_body", tenant_a, "2026-06-07T00:00:00Z")

    return _Fixtures(ids, tenant_a, tenant_b)


def _successor_rows(engine: Engine, work_unit_id: uuid.UUID) -> list[dict[str, object]]:
    """Rows for one work unit, ordered so multi-row cases compare deterministically."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT tenant_id, repo, pr_number, commit_sha, source, cited_at
                  FROM coord.work_unit_pr_citations
                 WHERE work_unit_id = :wu
                 ORDER BY pr_number NULLS FIRST, commit_sha NULLS FIRST
                """
            ),
            {"wu": work_unit_id},
        ).mappings()
        return [dict(r) for r in rows]


def _legacy_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text("SELECT count(*) FROM coord.plan_pr_citations")).scalar()
            or 0
        )


def _successor_count(engine: Engine, source: str | None = None) -> int:
    sql = "SELECT count(*) FROM coord.work_unit_pr_citations"
    params: dict[str, object] = {}
    if source is not None:
        sql += " WHERE source = :source"
        params["source"] = source
    with engine.connect() as conn:
        return int(conn.execute(text(sql), params).scalar() or 0)


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_plan_pr_citations_3a_backfill_folds_and_downgrades() -> None:
    """Seed the parent revision, apply 3a, assert the fold, re-run, downgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_citations_3a_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Walk the chain to 3a's PARENT, then seed.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        fx = _seed(engine)

        assert _legacy_count(engine) == _LEGACY_ROWS
        assert _successor_count(engine) == _PRESEEDED_SUCCESSOR_ROWS

        # ----------------------------------------------------------------
        # 2. Apply 3a — the fold.
        # ----------------------------------------------------------------
        applied = run_alembic(root, url, "upgrade", _REVISION_ID)

        # Case 1 — resolvable row folded, restamped, cited_at + tenant copied.
        resolvable = _successor_rows(engine, fx.units["wu-resolvable"])
        assert len(resolvable) == 1
        assert resolvable[0]["source"] == _BACKFILL_SOURCE
        assert resolvable[0]["pr_number"] == 101
        assert resolvable[0]["commit_sha"] == "aaa111"
        assert resolvable[0]["tenant_id"] == fx.tenant_a, (
            "tenant_id copied from the legacy row"
        )
        assert resolvable[0]["cited_at"] == datetime(2026, 1, 1, tzinfo=UTC), (
            "cited_at must be copied verbatim from the legacy row, not now()"
        )

        # Case 2 — dual-written edge deduped to ONE row that keeps its organic
        # source. A second row (or a relabel to legacy_backfill) would mean the
        # ON CONFLICT arbiter missed, and would put an organic webhook
        # observation into the caller-removable trust class.
        dual = _successor_rows(engine, fx.units["wu-dual-written"])
        assert len(dual) == 1, "ON CONFLICT DO NOTHING must not duplicate the edge"
        assert dual[0]["source"] == "pr_body", (
            "an already-dual-written organic citation must keep its own source"
        )

        # Case 3 — orphan neither folded nor deleted, and reported.
        with engine.connect() as conn:
            orphan_still_there = conn.execute(
                text(
                    "SELECT count(*) FROM coord.plan_pr_citations "
                    "WHERE plan_slug = 'wu-does-not-exist'"
                )
            ).scalar()
        assert orphan_still_there == 1, "orphans are retained in the legacy table"

        # Case 4 — cross-tenant drift excluded.
        assert _successor_rows(engine, fx.units["wu-tenant-drift"]) == [], (
            "a non-NULL tenant disagreement must be excluded from the fold"
        )

        # Cases 3 + 4 — the migration's contract is that skipped rows are
        # "counted and reported, not silently dropped". Assert the report, not
        # just its effects: a broken count query is otherwise invisible.
        log = applied.stdout + applied.stderr
        assert "1 orphan row(s)" in log, f"orphan count must be reported; got:\n{log}"
        assert "1 tenant-mismatch row(s)" in log, (
            f"tenant-mismatch count must be reported; got:\n{log}"
        )

        # Case 5 — NULL tenant on the legacy side is tolerated, and copied.
        null_tenant = _successor_rows(engine, fx.units["wu-null-tenant"])
        assert len(null_tenant) == 1
        assert null_tenant[0]["tenant_id"] is None, (
            "tenant_id copied verbatim, not enriched"
        )
        assert null_tenant[0]["source"] == _BACKFILL_SOURCE

        # Case 6 — NULL tenant on the work-unit side also folds, and the row
        # keeps the LEGACY tenant (no enrichment from coord.work_units).
        null_wu_tenant = _successor_rows(engine, fx.units["wu-null-wu-tenant"])
        assert len(null_wu_tenant) == 1
        assert null_wu_tenant[0]["tenant_id"] == fx.tenant_a
        assert null_wu_tenant[0]["source"] == _BACKFILL_SOURCE

        # Case 7 — commit-only and PR-body-only citations both present, and the
        # pre-seeded commit-only row deduped on a NULL-bearing key rather than
        # being inserted a second time. Under a plain UNIQUE (without NULLS NOT
        # DISTINCT) this would be two rows and the source would not survive.
        null_cols = _successor_rows(engine, fx.units["wu-null-cols"])
        assert len(null_cols) == 2, "NULL-bearing key must dedupe (NULLS NOT DISTINCT)"
        by_key = {(r["pr_number"], r["commit_sha"]): r for r in null_cols}
        assert set(by_key) == {(None, "fff666"), (606, None)}
        assert by_key[(None, "fff666")]["source"] == "commit_message", (
            "the pre-existing commit-only row keeps its organic source"
        )
        assert by_key[(606, None)]["source"] == _BACKFILL_SOURCE

        # The legacy table is read-only to this revision.
        assert _legacy_count(engine) == _LEGACY_ROWS, "3a must not delete legacy rows"
        assert _successor_count(engine, _BACKFILL_SOURCE) == _MINTED_ROWS
        assert _successor_count(engine) == _TOTAL_SUCCESSOR_ROWS

        # ----------------------------------------------------------------
        # 3. Re-run over its OWN output — the migration's idempotency claim.
        #    `stamp` rewinds only the version marker, leaving the folded rows
        #    in place, so the INSERT re-executes against a table that already
        #    contains them. This is the prod-repair scenario.
        # ----------------------------------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _successor_count(engine, _BACKFILL_SOURCE) == _MINTED_ROWS, (
            "re-running the fold over its own output must mint nothing new"
        )
        assert _successor_count(engine) == _TOTAL_SUCCESSOR_ROWS

        # ----------------------------------------------------------------
        # 4. Downgrade — removes exactly what it minted.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        assert _successor_count(engine, _BACKFILL_SOURCE) == 0, (
            "downgrade removes every row it minted"
        )
        assert _successor_count(engine) == _PRESEEDED_SUCCESSOR_ROWS, (
            "downgrade must not touch organically dual-written citations"
        )
        assert _legacy_count(engine) == _LEGACY_ROWS, (
            "downgrade must not touch the legacy table"
        )

        # ----------------------------------------------------------------
        # 5. Re-upgrade — the fold is re-derivable from the retained rows.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _successor_count(engine, _BACKFILL_SOURCE) == _MINTED_ROWS
        assert _successor_count(engine) == _TOTAL_SUCCESSOR_ROWS
