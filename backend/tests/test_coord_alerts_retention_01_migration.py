"""Data-semantics test for the ``coord_alerts_retention_01`` revision.

The revision is a one-shot prune: it deletes ``coord.alerts`` rows of the two
historical burst kinds (``stale_wip``, ``stale_primary_tree``) that were
resolved more than 30 days ago. It authors no schema at all, so its entire
contract is *data* — which rows go, which stay, what happens to the one foreign
key that points at the table, and whether a re-run is safe.

**CI does not cover any of that.** ``migration-reversal.yml`` runs
upgrade → downgrade → upgrade against an **empty** database, so a prune whose
WHERE clause deleted the wrong kinds, or every row, or nothing at all, would
sail through it green. This test is the only thing that reads the predicate.

Cases covered (each is a distinct branch of the migration's WHERE clause)
========================================================================

1. **Burst kind, resolved well before the cutoff** — deleted. Both kinds.
2. **Burst kind, resolved just OUTSIDE the window (31 d)** — deleted. Pins the
   cutoff's direction; a flipped comparison would keep this and delete case 3.
3. **Burst kind, resolved just INSIDE the window (29 d / 5 d)** — kept. Pins the
   other side of the same boundary.
4. **Burst kind, NEVER resolved (``resolved_at IS NULL``), old ``first_seen_at``**
   — kept. A live alert must never be pruned by age. This is the case NULL
   comparison semantics would silently get right and an ``OR`` typo would get
   catastrophically wrong.
5. **Non-burst kinds resolved long ago** (``red_main``, ``pr_merge_stuck``) —
   kept. The prune is kind-scoped; ``red_main`` in particular is the kind the
   sibling flake-heal index migration cares about, and the kind carrying the
   only ``counter``-typed metric over this table.
6. **A pruned row referenced by ``coord.merge_decisions.resolved_alert_id``** —
   the alert goes, the merge decision **SURVIVES** with its back-link nulled.
   This is the live-catalog FK (``ON DELETE SET NULL``), and it is the assertion
   that would have caught the stale belief that a ``CASCADE`` edge existed:
   under CASCADE the merge decision would be **deleted**, not nulled.
7. **More rows than one batch** — 25,000 seeded deletable rows against a 20,000
   row batch size, so the primary-key cursor loop must run at least twice and
   still delete each row exactly once. A cursor that failed to advance would
   spin; one that advanced too far would strand rows.

Then three walks: a **re-run** over its own output (the prod-repair scenario, and
the migration's idempotency claim), a **downgrade** (a deliberate no-op — the
drain is not reconstructable), and a **re-upgrade**.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
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

# Pinned explicitly rather than using "head" so a later migration landing on
# top cannot silently change what this test walks.
_REVISION_ID = "coord_alerts_retention_01"
_PARENT_REVISION_ID = "fleet_res_tel_03"

# Mirrors the migration's own constants. Deliberately re-stated rather than
# imported: the test is asserting what the migration DOES, and importing its
# constants would make a wrong-but-consistent change invisible.
_BURST_KINDS = ("stale_wip", "stale_primary_tree")
_RETENTION_DAYS = 30
_BATCH_ROWS = 20_000

# Enough deletable rows to force the batch loop round more than once.
_BULK_ROWS = 25_000

# The individually-seeded rows that must SURVIVE, by alert_key.
_EXPECTED_SURVIVORS = {
    "burst-wip-resolved-29d",
    "burst-wip-resolved-5d",
    "burst-wip-live",
    "burst-tree-live",
    "redmain-resolved-200d",
    "prmerge-resolved-200d",
}


def _seed(engine: Engine) -> int:
    """Seed the ten case rows plus the bulk batch. Returns the linked alert id.

    Seeding must happen at the PARENT revision: this is a one-shot DML step, so
    rows inserted after it has run would never be considered.
    """
    tenant_id = uuid.uuid4()

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'Retention Test Tenant')
                """
            ),
            {"t": tenant_id, "slug": f"retention-test-{uuid.uuid4().hex[:8]}"},
        )

        def alert(
            key: str, kind: str, resolved_days_ago: int | None, seen_days_ago: int
        ) -> int:
            """Insert one alert; ``resolved_days_ago=None`` means still firing.

            All timestamps are computed by the SERVER, not the client, so the
            fixture's 29-vs-31-day boundary cases cannot be perturbed by clock
            skew between this process and Postgres. ``make_interval`` is STRICT,
            so a NULL ``:resolved`` propagates through the subtraction and
            leaves ``resolved_at`` NULL — which is the "still firing" case, with
            no CASE expression needed.

            ``CAST(:resolved AS int)`` rather than ``:resolved::int``: SQLAlchemy's
            ``text()`` parses ``:name`` bind parameters itself, and a ``::`` cast
            immediately following one is mis-parsed (it leaves a literal ``:``
            in the emitted SQL and Postgres rejects it).
            """
            row = conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, detail,
                         first_seen_at, last_seen_at, resolved_at)
                    VALUES
                        (:key, 'warning', :kind, :key, '{}'::jsonb,
                         now() - make_interval(days => CAST(:seen AS int)),
                         now() - make_interval(days => CAST(:seen AS int)),
                         now() - make_interval(days => CAST(:resolved AS int)))
                    RETURNING id
                    """
                ),
                {
                    "key": key,
                    "kind": kind,
                    "seen": seen_days_ago,
                    "resolved": resolved_days_ago,
                },
            )
            return int(row.scalar_one())

        # 1. Burst kinds, resolved well before the cutoff — both must go.
        alert("burst-wip-resolved-60d", "stale_wip", 60, 90)
        alert("burst-tree-resolved-45d", "stale_primary_tree", 45, 90)

        # 2. Just OUTSIDE the window — must go (pins the comparison direction).
        alert("burst-wip-resolved-31d", "stale_wip", 31, 60)

        # 3. Just INSIDE the window — must stay (pins the other side).
        alert("burst-wip-resolved-29d", "stale_wip", 29, 60)
        alert("burst-wip-resolved-5d", "stale_wip", 5, 30)

        # 4. Never resolved, but very old. A LIVE alert is never pruned by age.
        alert("burst-wip-live", "stale_wip", None, 200)
        alert("burst-tree-live", "stale_primary_tree", None, 200)

        # 5. Out-of-scope kinds, resolved long ago — the prune is kind-scoped.
        alert("redmain-resolved-200d", "red_main", 200, 220)
        alert("prmerge-resolved-200d", "pr_merge_stuck", 200, 220)

        # 6. A doomed alert that a merge decision back-links to. The FK is
        #    ON DELETE SET NULL, so the decision must survive with a NULL link.
        linked_id = alert("burst-wip-linked", "stale_wip", 60, 90)
        conn.execute(
            text(
                """
                INSERT INTO coord.merge_decisions
                    (tenant_id, repo, pr_number, decided_by, action,
                     rationale, resolved_alert_id)
                VALUES
                    (:t, 'qontinui/qontinui-coord', 1234, 'operator', 'merge',
                     'test back-link that must survive the prune', :alert_id)
                """
            ),
            {"t": tenant_id, "alert_id": linked_id},
        )

        # 7. Bulk deletable rows, to force more than one batch.
        conn.execute(
            text(
                """
                INSERT INTO coord.alerts
                    (alert_key, severity, kind, summary, detail,
                     first_seen_at, last_seen_at, resolved_at)
                SELECT
                    'bulk-' || g, 'info', 'stale_primary_tree', 'bulk',
                    '{}'::jsonb,
                    now() - interval '90 days',
                    now() - interval '90 days',
                    now() - interval '60 days'
                FROM generate_series(1, :n) AS g
                """
            ),
            {"n": _BULK_ROWS},
        )

    return linked_id


def _alert_keys(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        return {r[0] for r in conn.execute(text("SELECT alert_key FROM coord.alerts"))}


def _alert_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text("SELECT count(*) FROM coord.alerts")).scalar() or 0
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_alerts_retention_01_prunes_only_old_resolved_burst_kinds() -> None:
    """Seed the parent revision, apply the prune, assert exactly what moved."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_alerts_retention_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Walk to the prune's PARENT, then seed.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _seed(engine)

        seeded_total = _BULK_ROWS + 10
        assert _alert_count(engine) == seeded_total

        # ----------------------------------------------------------------
        # 2. Apply the prune.
        # ----------------------------------------------------------------
        applied = run_alembic(root, url, "upgrade", _REVISION_ID)

        survivors = _alert_keys(engine)
        assert survivors == _EXPECTED_SURVIVORS, (
            "the prune must remove exactly the old resolved burst-kind rows"
        )

        # Cases 1 + 2 — deleted. Spelled out so a failure names the case.
        for gone in (
            "burst-wip-resolved-60d",
            "burst-tree-resolved-45d",
            "burst-wip-resolved-31d",
            "burst-wip-linked",
        ):
            assert gone not in survivors, f"{gone} should have been pruned"

        # Case 3 — the 29-day row is INSIDE the retention window.
        assert "burst-wip-resolved-29d" in survivors, (
            f"a row resolved 29 days ago is inside the {_RETENTION_DAYS}-day "
            "window and must be kept"
        )

        # Case 4 — a still-firing alert is never pruned, however old.
        assert {"burst-wip-live", "burst-tree-live"} <= survivors, (
            "unresolved (live) alerts must never be pruned by age"
        )

        # Case 5 — out-of-scope kinds untouched even at 200 days.
        assert {"redmain-resolved-200d", "prmerge-resolved-200d"} <= survivors, (
            "the prune is kind-scoped; other kinds must survive at any age"
        )

        # Case 6 — the FK is ON DELETE SET NULL, not CASCADE. Under CASCADE
        # this row would be GONE; that is the failure this assertion exists for.
        with engine.connect() as conn:
            decisions = conn.execute(
                text(
                    """
                    SELECT resolved_alert_id, rationale
                      FROM coord.merge_decisions
                    """
                )
            ).all()
        assert len(decisions) == 1, (
            "the merge decision must SURVIVE the prune of the alert it links to "
            "(ON DELETE SET NULL, not CASCADE)"
        )
        assert decisions[0][0] is None, (
            "the back-link must be nulled by the FK's ON DELETE SET NULL"
        )

        # Case 7 — the batch loop ran more than once and lost nothing.
        deleted = seeded_total - len(_EXPECTED_SURVIVORS)
        assert deleted == _BULK_ROWS + 4
        log = applied.stdout + applied.stderr
        assert f"deleted {deleted} coord.alerts row(s)" in log, (
            f"the migration must report its deleted count; got:\n{log}"
        )
        expected_batches = -(-deleted // _BATCH_ROWS)  # ceil
        assert expected_batches >= 2, "the fixture must exercise >1 batch"
        assert f"in {expected_batches} batch(es)" in log, (
            f"expected {expected_batches} batches in the log; got:\n{log}"
        )

        # The migration must state the space-reclamation truth where an
        # operator reading the deploy log will see it.
        assert "the win is tuple-processing CPU, not scan size" in log, (
            f"the log must not imply a size win; got:\n{log}"
        )

        # ----------------------------------------------------------------
        # 3. Re-run over its OWN output — the prod-repair scenario. `stamp`
        #    rewinds only the version marker, so the DELETE re-executes
        #    against an already-pruned table.
        # ----------------------------------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        rerun = run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _alert_keys(engine) == _EXPECTED_SURVIVORS, (
            "re-running the prune must delete nothing further"
        )
        rerun_log = rerun.stdout + rerun.stderr
        assert "deleted 0 coord.alerts row(s)" in rerun_log, (
            f"the re-run must report zero deletions; got:\n{rerun_log}"
        )

        # ----------------------------------------------------------------
        # 4. Downgrade — a deliberate no-op. It must neither restore rows
        #    (impossible) nor delete more (a live hazard if it were mis-written
        #    as a symmetric statement).
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _alert_keys(engine) == _EXPECTED_SURVIVORS, (
            "downgrade is a no-op: it restores nothing and removes nothing"
        )

        # ----------------------------------------------------------------
        # 5. Re-upgrade — still stable.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _alert_keys(engine) == _EXPECTED_SURVIVORS
