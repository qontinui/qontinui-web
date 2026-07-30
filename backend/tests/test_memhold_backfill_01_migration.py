"""Data-semantics test for the ``memhold_backfill_01`` revision.

Phase 1b of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``
sets ``source.lifecycle_hold = true`` on the imported sync-conflict sidecars and
their topic-file winners, so the automatic memory lifecycle stops deciding
contested pairs on cosine similarity while a human adjudicates them.

The revision authors **no schema**. Its whole contract is which rows it selects,
and every interesting branch of that selection is a fixture the prod data
actually contains — so this test seeds the parent revision, walks one step up,
and asserts the resulting ``source`` JSON.

Cases covered (each is a distinct branch of the revision's SQL)
==============================================================

1. **Loser with ``source.project`` set** — flagged.
2. **Loser with a NULL ``source.project``** — flagged, and its project resolved
   from the ``[sync-conflict sidecar] <project>/<file>`` title. 80 of the 138
   prod rows are this shape, so the title fallback is load-bearing.
3. **Already-superseded loser** — flagged too. This is the case the hold exists
   for: without it ``decay_prune`` hard-DELETEs the row (and with it the
   ``superseded_by`` lineage that records what consolidation decided) 90 days
   after supersession.
4. **Winner whose project agrees with its loser's** — flagged.
5. **Winner with a NULL ``source.project``** — flagged via the NULL arm, which
   is the only way the first import pass's winners can be reached.
6. **Winner of a DIFFERENT project than any loser** — NOT flagged. This is what
   pins the project match: dropping it would hold unrelated records that merely
   share a filename.
7. **Unrelated topic-file record** (no sidecar shares its file) — NOT flagged.
8. **Bridge-era record with no ``source.origin``** — NOT flagged even when its
   file matches, because ``origin`` is the discriminator the revision keys on.
9. **A record already holding an explicit ``lifecycle_hold: false``** (Phase 3's
   "adjudicated and released" marker, on a row outside the contested set) — left
   untouched by both upgrade and downgrade.
10. **Winner in ANOTHER TENANT** matching on file AND project — NOT flagged.
    ``source.file`` is a bare filename, so the tenant equality is the only thing
    keeping one tenant's conflict from holding a peer tenant's record.

Then three walks are asserted:

* **re-run** (``stamp`` back to the parent, upgrade again) — the idempotency
  claim: both UPDATEs skip rows already reading ``'true'``.
* **downgrade** — removes the key from exactly the rows upgrade set it ``true``
  on, and leaves an explicit ``false`` standing (erasing that would destroy an
  adjudication decision, which is why the downgrade keys on the value rather
  than on the key's presence).
* **re-upgrade** — the selection is re-derivable.

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import hashlib
import json
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

# Pinned explicitly rather than "head" so a later migration landing on top
# cannot silently change what this test walks.
_REVISION_ID = "memhold_backfill_01"
_PARENT_REVISION_ID = "coord_sesscompl_03"

_SIDECAR_ORIGIN = "sync-conflict-sidecar"
_WINNER_ORIGIN = "topic-file"

_PROJECT = "D--qontinui-root"
_OTHER_PROJECT = "D--qontinui-root-qontinui-coord"

# Every seeded row, addressed by title. The titles double as the fixture names
# in the assertions below.
_LOSER_WITH_PROJECT = (
    "[sync-conflict sidecar] D--qontinui-root/topic_a.md.conflict-x-1.md"
)
_LOSER_NULL_PROJECT = (
    "[sync-conflict sidecar] D--qontinui-root/topic_b.md.conflict-y-2.md"
)
_LOSER_SUPERSEDED = (
    "[sync-conflict sidecar] D--qontinui-root/topic_c.md.conflict-z-3.md"
)
_WINNER_SAME_PROJECT = "topic_a"
_WINNER_NULL_PROJECT = "topic_b"
_WINNER_SUPERSEDED_SIDE = "topic_c"
_WINNER_OTHER_PROJECT = "topic_a elsewhere"
_WINNER_UNRELATED = "topic_unrelated"
_BRIDGE_NO_ORIGIN = "topic_a bridge era"
_ALREADY_RELEASED = "topic_released"
# Case 10 lives in a second tenant, so it is asserted separately rather than
# through the primary tenant's title map.
_WINNER_OTHER_TENANT = "topic_a in a peer tenant"

# Rows the revision must flag, and rows it must leave alone.
_EXPECT_HELD = {
    _LOSER_WITH_PROJECT,
    _LOSER_NULL_PROJECT,
    _LOSER_SUPERSEDED,
    _WINNER_SAME_PROJECT,
    _WINNER_NULL_PROJECT,
    _WINNER_SUPERSEDED_SIDE,
}
_EXPECT_UNTOUCHED = {
    _WINNER_OTHER_PROJECT,
    _WINNER_UNRELATED,
    _BRIDGE_NO_ORIGIN,
    _ALREADY_RELEASED,
}


def _seed(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """Seed two tenants and the eleven memory records, at the PARENT revision.

    Seeding must happen before the revision runs: it is a one-shot DML step, so
    a row inserted afterwards would never be flagged. The second tenant exists
    for exactly one row — the cross-tenant winner of case 10.
    """
    tenant_id = uuid.uuid4()
    peer_tenant_id = uuid.uuid4()

    def record(
        title: str,
        source: dict[str, object],
        *,
        superseded_by: uuid.UUID | None = None,
        tenant: uuid.UUID | None = None,
    ) -> uuid.UUID:
        memory_id = uuid.uuid4()
        content = f"body of {title}"
        rows.append(
            {
                "memory_id": memory_id,
                "tenant_id": tenant or tenant_id,
                "kind": "observation",
                "title": title,
                "content": content,
                "content_hash": hashlib.sha256(content.encode()).hexdigest(),
                "source": json.dumps(source),
                "superseded_by": superseded_by,
                # A superseded row carries an ended validity in prod; mirror
                # that so the fixture is the shape decay_prune actually sees.
                "valid_until": "2026-07-28T16:20:00Z" if superseded_by else None,
            }
        )
        return memory_id

    rows: list[dict[str, object]] = []

    # 1. Loser carrying its own project.
    record(
        _LOSER_WITH_PROJECT,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": "topic_a.md.conflict-x-2026-07-16T01-41-08Z.md",
            "project": _PROJECT,
        },
    )
    # 2. Loser with NO project — resolved from the title.
    record(
        _LOSER_NULL_PROJECT,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": "topic_b.md.conflict-y-2026-07-21T05-24-41Z.md",
        },
    )
    # 4/5. The winners of losers 1 and 2: project agreeing, and project NULL.
    winner_a = record(
        _WINNER_SAME_PROJECT,
        {"origin": _WINNER_ORIGIN, "file": "topic_a.md", "project": _PROJECT},
    )
    record(
        _WINNER_NULL_PROJECT,
        {"origin": _WINNER_ORIGIN, "file": "topic_b.md"},
    )
    # 6. A winner for the same FILE in a different project — must not be held.
    record(
        _WINNER_OTHER_PROJECT,
        {"origin": _WINNER_ORIGIN, "file": "topic_a.md", "project": _OTHER_PROJECT},
    )
    # 7. A topic-file record no sidecar refers to.
    record(
        _WINNER_UNRELATED,
        {"origin": _WINNER_ORIGIN, "file": "topic_unrelated.md", "project": _PROJECT},
    )
    # 8. Bridge-era row: file matches, but no origin discriminator.
    record(
        _BRIDGE_NO_ORIGIN,
        {"file": "topic_a.md", "project": _PROJECT},
    )
    # 9. A released record OUTSIDE the contested set, holding an explicit false.
    record(
        _ALREADY_RELEASED,
        {
            "origin": _WINNER_ORIGIN,
            "file": "topic_released.md",
            "project": _PROJECT,
            "lifecycle_hold": False,
        },
    )
    # 10. A winner matching file AND project, but in ANOTHER TENANT. `source.file`
    #     is a bare filename, so without the tenant equality this row would be
    #     held by a peer tenant's sidecar.
    record(
        _WINNER_OTHER_TENANT,
        {"origin": _WINNER_ORIGIN, "file": "topic_a.md", "project": _PROJECT},
        tenant=peer_tenant_id,
    )
    # 3. An already-superseded loser, pointing at a live winner (the shape
    #    consolidation leaves behind), plus that winner.
    winner_c = record(
        _WINNER_SUPERSEDED_SIDE,
        {"origin": _WINNER_ORIGIN, "file": "topic_c.md", "project": _PROJECT},
    )
    record(
        _LOSER_SUPERSEDED,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": "topic_c.md.conflict-z-2026-07-16T02-31-03Z.md",
            "project": _PROJECT,
        },
        superseded_by=winner_c,
    )
    assert winner_a != winner_c

    with engine.begin() as conn:
        for tid in (tenant_id, peer_tenant_id):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:tenant_id, :slug, 'memhold backfill test')
                    """
                ),
                {"tenant_id": tid, "slug": f"memhold-{tid.hex[:12]}"},
            )
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, kind, title, content,
                         content_hash, source, superseded_by, valid_until)
                    VALUES
                        (:memory_id, :tenant_id, :kind, :title, :content,
                         :content_hash, CAST(:source AS jsonb), :superseded_by,
                         CAST(:valid_until AS timestamptz))
                    """
                ),
                row,
            )

    return tenant_id, peer_tenant_id


def _holds(engine: Engine, tenant_id: uuid.UUID) -> dict[str, object]:
    """title → the row's ``source.lifecycle_hold``, as raw JSON (absent = None)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT title, source->'lifecycle_hold' AS hold
                  FROM coord.memory_records
                 WHERE tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id},
        ).mappings()
        return {r["title"]: r["hold"] for r in rows}


def _held_titles(engine: Engine, tenant_id: uuid.UUID) -> set[str]:
    """The titles the shipped ``_not_lifecycle_held`` predicate would exclude."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT title
                  FROM coord.memory_records
                 WHERE tenant_id = :tenant_id
                   AND NOT (
                        lower(source->>'lifecycle_hold') IS DISTINCT FROM 'true'
                   )
                """
            ),
            {"tenant_id": tenant_id},
        )
        return {r[0] for r in rows}


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_memhold_backfill_01_holds_the_contested_set_only() -> None:
    """Seed the parent revision, apply the backfill, assert the selection."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "memhold_backfill_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        tenant_id, peer_tenant_id = _seed(engine)

        before = _holds(engine, tenant_id)
        assert len(before) == len(_EXPECT_HELD) + len(_EXPECT_UNTOUCHED)
        assert before[_ALREADY_RELEASED] is False, "seeded as explicitly released"
        assert _holds(engine, peer_tenant_id) == {_WINNER_OTHER_TENANT: None}

        # ----------------------------------------------------------------
        # Apply the backfill.
        # ----------------------------------------------------------------
        applied = run_alembic(root, url, "upgrade", _REVISION_ID)
        after = _holds(engine, tenant_id)

        for title in sorted(_EXPECT_HELD):
            assert after[title] is True, f"{title} must be held (JSON true)"

        assert after[_WINNER_OTHER_PROJECT] is None, (
            "a same-filename winner in a project no sidecar names must not be "
            "held — dropping the project match would sweep in unrelated records"
        )
        assert after[_WINNER_UNRELATED] is None
        assert after[_BRIDGE_NO_ORIGIN] is None, (
            "source.origin is the discriminator; a bridge-era row without it is "
            "out of scope even when its file matches"
        )
        assert after[_ALREADY_RELEASED] is False, (
            "an explicit false outside the contested set stays false"
        )

        # Case 10 — the tenant equality in the winner match. This row agrees on
        # file AND project with case 1's sidecar and differs only by tenant.
        assert _holds(engine, peer_tenant_id) == {_WINNER_OTHER_TENANT: None}, (
            "a peer tenant's same-file record must not be held by this tenant's "
            "sidecar — source.file is a bare filename, so only the tenant "
            "equality keeps the hold inside the tenant that owns the conflict"
        )
        assert _held_titles(engine, peer_tenant_id) == set()

        # The flag is only worth anything if the SHIPPED predicate reads it, so
        # assert against that exact expression rather than only on the JSON.
        assert _held_titles(engine, tenant_id) == _EXPECT_HELD

        # The migration REPORTS its two row counts into the migrator log — the
        # only record of the backfill's blast radius once the before-picture is
        # gone. Assert the report, not just its effects: a broken count query is
        # otherwise invisible. 3 losers + 3 winners in this fixture.
        log = applied.stdout + applied.stderr
        assert "on 3 sync-conflict sidecar row(s)" in log, (
            f"loser count must be reported; got:\n{log}"
        )
        assert "and 3 topic-file winner row(s)" in log, (
            f"winner count must be reported; got:\n{log}"
        )

        # ----------------------------------------------------------------
        # Re-run over its own output — the idempotency claim.
        # ----------------------------------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        rerun = run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _holds(engine, tenant_id) == after, "re-running must change nothing"
        rerun_log = rerun.stdout + rerun.stderr
        assert "on 0 sync-conflict sidecar row(s)" in rerun_log, (
            f"a re-run must report 0 rows touched; got:\n{rerun_log}"
        )
        assert "and 0 topic-file winner row(s)" in rerun_log

        # ----------------------------------------------------------------
        # Downgrade — drops exactly what upgrade set true.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        reverted = _holds(engine, tenant_id)

        for title in sorted(_EXPECT_HELD):
            assert reverted[title] is None, f"{title} must lose the key entirely"
        assert reverted[_ALREADY_RELEASED] is False, (
            "the downgrade keys on the VALUE being true, so a Phase-3 "
            "'adjudicated and released' marker survives a rollback"
        )
        assert _held_titles(engine, tenant_id) == set()

        # ----------------------------------------------------------------
        # Re-upgrade — the selection is re-derivable.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _holds(engine, tenant_id) == after
