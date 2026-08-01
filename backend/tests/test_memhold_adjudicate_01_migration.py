"""Data-semantics test for the ``memhold_adjudicate_01`` revision.

Phase 3.3 of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``
lands the operator's 2026-08-01 dispositions (gate
``925c3ab3-9d05-429b-b218-0d1c97262c54``) into ``coord.memory_records``: it
stamps ``source.adjudication`` on every sidecar row it can map, supersedes the
CONTENT-dispositioned ones onto their topic-file winner, tombstones the
``index-merge-artifact`` ones, and releases ``source.lifecycle_hold`` on the
subset whose decision needs nothing further written.

Like its Phase-1b sibling the revision authors **no schema**, so its whole
contract is which rows it touches and what it writes. This test seeds the
parent revision with one fixture per branch, walks one step up, and asserts the
resulting rows.

Cases covered (each a distinct branch of the revision's SQL)
============================================================

1. **Content sidecar WITH a topic-file winner** — stamped with the manifest's
   per-file disposition and re-pointed at the winner.
2. **Index sidecars** (``MEMORY.md``) — stamped ``index-merge-artifact`` by
   the structural rule and TOMBSTONED. 113 of the 138 prod rows are this
   shape. Two of them, from DIFFERENT project directories, are seeded beside a
   single NULL-project ``'topic-file'`` row also named ``MEMORY.md``: that row
   matches both, so an arm keyed on winner-presence supersedes both onto it
   and reports ``tombstoned 0``. In prod that is all 113 index rows collapsing
   onto one unrelated record, silently. The disposition, not the winner, picks
   the arm — and the unexpected winner is logged at WARNING.
3. **Sidecar ALREADY SUPERSEDED onto another row** — the shape consolidation
   leaves behind (86 of the 138 prod rows). Its prior ``superseded_by`` must
   survive in ``source.adjudication.prior_superseded_by`` before being
   overwritten; that pointer is the record of what the similarity heuristic
   chose, and losing it is the one failure this migration must not have.
4. **Two sidecars of the SAME base file with DIFFERENT dispositions** —
   ``project_runner_as_ci_node_migration.md`` really is adjudicated ``winner``
   on one stamp and ``merged`` on another. Keying the mapping on the base file
   would collapse them; this asserts the sidecar-filename key.
5. **Unmapped content sidecar** — a content file in no manifest row. Must be
   left entirely alone: no stamp, no supersede, no tombstone, hold intact.
6. **Sidecar with a NULL ``source.project``** — project resolved from the
   ``[sync-conflict sidecar] <project>/<file>`` title. 80 of the 138 prod rows
   are this shape, so the fallback is load-bearing.
7. **The topic-file winners** — must KEEP ``lifecycle_hold = true``. Their
   corrected text is a memory-API follow-up, so they are still
   pre-adjudication content and must stay out of the automatic sweeps.
8. **An unrelated topic-file record and a bridge-era row** — untouched.
9. **Content sidecars with a disposition and NO winner** — the arms are keyed
   on the DISPOSITION, not on winner-presence, so these must come out INERT:
   no supersede, no tombstone, hold left ``true``, still on the live surface.
   The manifest's single ``loser`` (``pr-754-stale-cross-repo-dep-edge.md``,
   the row whose body WON) is exactly this shape in prod, and a
   winner-presence key would tombstone it and arm ``decay_prune`` on it.
10. **A ``merged`` sidecar** — superseded like any content row, but its hold
    STAYS ``true``: its body is the input to the memory-API content follow-up,
    and for an already-superseded row the 90-day prune clock is retroactive.
11. **A second tenant** — a sidecar in one tenant must never resolve onto a
    winner in another, in either direction. ``source.file`` is a bare
    filename, so tenant equality is the only thing separating them; both
    cross-tenant candidates here are seeded to WIN the ranking if it were
    dropped.
12. **A NULL-project ``topic-file`` row beside an exact-project match** — the
    winner join is deliberately permissive about project (the first import
    pass wrote none), so the RANKING has to prefer the exact match. The
    NULL-project decoy is seeded live and older, so liveness and ``created_at``
    alone would pick it.

Then two walks:

* **re-run** (``stamp`` back to the parent, upgrade again) — every reported
  count must be 0 and no row may move.
* **downgrade** — ``superseded_by`` / ``is_tombstone`` / ``valid_until``
  restored from the stash, the hold back to ``true``, the stamp gone.

Substrate comes from ``_alembic_harness`` (shared with the other migration
tests): an ephemeral DB inside the test Postgres, skipped when none is
reachable. ⚠️ A skip proves nothing — point it at a live instance with
``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the one accepting the test
credentials.

:func:`test_arm_invariants_raise_when_violated` and
:func:`test_drift_guard_covers_the_locally_rewritten_fragments` need no
database and therefore never skip — they cover the two guards whose whole job
is to abort a forward-only production apply.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import uuid
from types import ModuleType
from typing import Any

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
_REVISION_ID = "memhold_adjudicate_01"
_PARENT_REVISION_ID = "scheduler_ticks_proposal_id_01"
_REVISION_FILENAME = "memhold_adjudicate_01_apply_sidecar_dispositions.py"

_SIDECAR_ORIGIN = "sync-conflict-sidecar"
_WINNER_ORIGIN = "topic-file"

_PROJECT = "D--qontinui-root"
_COORD_PROJECT = "D--qontinui-root-qontinui-coord"
_RUNNER_PROJECT = "D--qontinui-root-qontinui-runner"
_GATE_ID = "925c3ab3-9d05-429b-b218-0d1c97262c54"
_PLAN_SLUG = "2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord"

# Real manifest rows, so the fixture exercises the shipped table rather than a
# parallel one. The first two share a base file and disagree on disposition.
_RUNNER_BASE = "project_runner_as_ci_node_migration.md"
_RUNNER_WINNER_FILE = f"{_RUNNER_BASE}.conflict-tiohorst-2026-07-21T05-24-53Z.md"
_RUNNER_MERGED_FILE = f"{_RUNNER_BASE}.conflict-tiohorst-2026-07-23T02-50-41Z.md"
_REDACTION_BASE = "project_ui_bridge_redaction_not_enforced_structural_plan.md"
_REDACTION_FILE = f"{_REDACTION_BASE}.conflict-qontinui-2026-07-23T02-50-32Z.md"
_REBASE_LAND_BASE = "reference_pr_merged_gate_fails_on_coord_rebase_land.md"
_REBASE_LAND_FILE = f"{_REBASE_LAND_BASE}.conflict-qontinui-2026-07-21T05-24-49Z.md"
# The two manifest rows whose winner is absent from coord — case 9.
_SPECIMEN_BASE = "pr-1060-specimen-never-lands.md"
_SPECIMEN_FILE = f"{_SPECIMEN_BASE}.conflict-tiohorst-2026-07-21T05-24-56Z.md"
_DEP_EDGE_BASE = "pr-754-stale-cross-repo-dep-edge.md"
_DEP_EDGE_FILE = f"{_DEP_EDGE_BASE}.conflict-paktis-2026-07-21T05-24-45Z.md"

# Titles double as fixture names in the assertions.
_SIDECAR_WINNER_DISP = f"[sync-conflict sidecar] {_PROJECT}/{_RUNNER_WINNER_FILE}"
_SIDECAR_MERGED_DISP = f"[sync-conflict sidecar] {_PROJECT}/{_RUNNER_MERGED_FILE}"
_SIDECAR_NULL_PROJECT = f"[sync-conflict sidecar] {_PROJECT}/{_REDACTION_FILE}"
_SIDECAR_ALREADY_SUPERSEDED = f"[sync-conflict sidecar] {_PROJECT}/{_REBASE_LAND_FILE}"
_SIDECAR_INDEX = (
    f"[sync-conflict sidecar] {_PROJECT}/"
    "MEMORY.md.conflict-qontinui-2026-07-16T01-41-08Z.md"
)
# A SECOND MEMORY.md sidecar, from a DIFFERENT project directory. In prod all
# 113 index rows are spread across five such groups, and they share a base
# filename because `source.file` is a bare filename.
_SIDECAR_INDEX_2 = (
    f"[sync-conflict sidecar] {_COORD_PROJECT}/"
    "MEMORY.md.conflict-tiohorst-2026-07-16T01-41-08Z.md"
)
_SIDECAR_UNMAPPED = (
    f"[sync-conflict sidecar] {_PROJECT}/"
    "topic_never_adjudicated.md.conflict-ghost-2026-07-16T01-41-08Z.md"
)
# Case 9 — dispositioned, no winner anywhere in their tenant.
_SIDECAR_ORPHAN_WINNER = f"[sync-conflict sidecar] {_COORD_PROJECT}/{_SPECIMEN_FILE}"
_SIDECAR_ORPHAN_LOSER = f"[sync-conflict sidecar] {_RUNNER_PROJECT}/{_DEP_EDGE_FILE}"

_WINNER_RUNNER = "project_runner_as_ci_node_migration"
_WINNER_RUNNER_DEAD = "project_runner_as_ci_node_migration (dead duplicate)"
_WINNER_REDACTION = "project_ui_bridge_redaction_not_enforced_structural_plan"
_WINNER_REBASE_LAND = "reference_pr_merged_gate_fails_on_coord_rebase_land"
_WINNER_REBASE_LAND_DECOY = (
    "reference_pr_merged_gate_fails_on_coord_rebase_land (NULL project, older)"
)
_WINNER_UNMAPPED_SIDE = "topic_never_adjudicated"
# The row the Phase-1b measurement says does not exist: a 'topic-file' record
# named after an INDEX file, with a NULL project. It matches the MEMORY.md
# sidecar of every project directory at once, so under a winner-presence key it
# swallows all of them — 113 rows in prod, superseded onto one unrelated record
# and reported as `tombstoned 0`. Seeded here so that failure is a test failure.
_WINNER_MEMORY_INDEX = "MEMORY.md imported as a topic file"
_MENTAL_MODEL = "synthesized mental model"
_UNRELATED = "topic_unrelated"
_BRIDGE_NO_ORIGIN = "bridge era row"

# Tenant 2 — case 11. Both winners are seeded to WIN the ranking against their
# tenant-1 counterparts if `s.tenant_id = w.tenant_id` were dropped from the
# join, so the assertions bite in both directions:
#   * the runner winner is NEWER than tenant 1's live one, so tenant 2's own
#     sidecar would be stolen by tenant 1's older row;
#   * the redaction winner is OLDER than tenant 1's, so tenant 1's sidecar
#     would be stolen by tenant 2's row.
_T2_WINNER_RUNNER = "tenant-2 project_runner_as_ci_node_migration"
_T2_WINNER_REDACTION = (
    "tenant-2 project_ui_bridge_redaction_not_enforced_structural_plan"
)
_T2_SIDECAR_RUNNER = (
    f"[sync-conflict sidecar] {_PROJECT}/{_RUNNER_WINNER_FILE} @tenant-2"
)

_ALL_SIDECARS = (
    _SIDECAR_WINNER_DISP,
    _SIDECAR_MERGED_DISP,
    _SIDECAR_NULL_PROJECT,
    _SIDECAR_ALREADY_SUPERSEDED,
    _SIDECAR_INDEX,
    _SIDECAR_INDEX_2,
    _SIDECAR_ORPHAN_WINNER,
    _SIDECAR_ORPHAN_LOSER,
    _SIDECAR_UNMAPPED,
)
# Every sidecar the revision must map, and to what.
_EXPECT_DISPOSITION = {
    _SIDECAR_WINNER_DISP: "winner",
    _SIDECAR_MERGED_DISP: "merged",
    _SIDECAR_NULL_PROJECT: "winner",
    _SIDECAR_ALREADY_SUPERSEDED: "winner",
    _SIDECAR_INDEX: "index-merge-artifact",
    _SIDECAR_INDEX_2: "index-merge-artifact",
    _SIDECAR_ORPHAN_WINNER: "winner",
    _SIDECAR_ORPHAN_LOSER: "loser",
}
# Both index rows, which share a winner they must nonetheless ignore.
_EXPECT_TOMBSTONED = (_SIDECAR_INDEX, _SIDECAR_INDEX_2)
# The hold comes off three ways. Released: the decision is fully landed.
_EXPECT_RELEASED = (
    _SIDECAR_WINNER_DISP,
    _SIDECAR_NULL_PROJECT,
    _SIDECAR_ALREADY_SUPERSEDED,
    _SIDECAR_INDEX,
    _SIDECAR_INDEX_2,
)
# Still held: `merged` / `loser` bodies feed the content follow-up, the inert
# rows were never adjudicable, the unmapped row was never adjudicated.
_EXPECT_SIDECARS_STILL_HELD = (
    _SIDECAR_MERGED_DISP,
    _SIDECAR_ORPHAN_WINNER,
    _SIDECAR_ORPHAN_LOSER,
    _SIDECAR_UNMAPPED,
)
# Dispositioned but with no winner — must be left completely inert.
_EXPECT_INERT = (_SIDECAR_ORPHAN_WINNER, _SIDECAR_ORPHAN_LOSER)
# The plan's exit criterion applies only to rows that actually took an arm.
_EXPECT_OFF_SURFACE = (
    _SIDECAR_WINNER_DISP,
    _SIDECAR_MERGED_DISP,
    _SIDECAR_NULL_PROJECT,
    _SIDECAR_ALREADY_SUPERSEDED,
    _SIDECAR_INDEX,
    _SIDECAR_INDEX_2,
)
# Winners carry the hold through the migration; the adjudicated sidecars lose it.
_EXPECT_STILL_HELD = (
    _WINNER_RUNNER,
    _WINNER_RUNNER_DEAD,
    _WINNER_REDACTION,
    _WINNER_REBASE_LAND,
    _WINNER_REBASE_LAND_DECOY,
    _WINNER_UNMAPPED_SIDE,
    _WINNER_MEMORY_INDEX,
)

_EMBEDDING_DIMS = 384


def _embedding(seed: int) -> str:
    """A distinct 384-dim unit vector per row.

    Distinct per row so "the revision never touches ``embedding``" is asserted
    per record rather than satisfied by every row happening to carry the same
    value (or NULL).
    """
    values = ["0"] * _EMBEDDING_DIMS
    values[seed % _EMBEDDING_DIMS] = "1"
    return "[" + ",".join(values) + "]"


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Seed two tenants and their records, at the PARENT revision.

    Seeding must happen before the revision runs: it is one-shot DML, so a row
    inserted afterwards would never be reached.
    """
    tenant_id = uuid.uuid4()
    tenant2_id = uuid.uuid4()
    ids: dict[str, uuid.UUID] = {}
    rows: list[dict[str, Any]] = []

    def record(
        title: str,
        source: dict[str, object],
        *,
        superseded_by: uuid.UUID | None = None,
        is_tombstone: bool = False,
        created_at: str = "2026-07-05T00:00:00Z",
        tenant: uuid.UUID | None = None,
    ) -> uuid.UUID:
        memory_id = uuid.uuid4()
        content = f"body of {title}"
        # memhold_backfill_01 has already run by the parent revision, but it is
        # a one-shot DML step too — so the fixture carries the hold it would
        # have set rather than relying on it to reach these rows.
        source = {**source, "lifecycle_hold": True}
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
                "valid_until": "2026-07-28T16:20:00Z" if superseded_by else None,
                "is_tombstone": is_tombstone,
                "created_at": created_at,
                "embedding": _embedding(len(rows)),
            }
        )
        ids[title] = memory_id
        return memory_id

    # The topic-file winners the sidecars resolve onto. `_RUNNER_BASE` gets TWO
    # — the Phase-4a import ran twice, and where both passes landed a row the
    # migration must pick the LIVE one. The dead one is seeded with the OLDER
    # created_at, so the created_at tie-break alone would pick it: only the
    # liveness key ahead of it makes the live row win.
    record(
        _WINNER_RUNNER_DEAD,
        {"origin": _WINNER_ORIGIN, "file": _RUNNER_BASE, "project": _PROJECT},
        is_tombstone=True,
        created_at="2026-07-01T00:00:00Z",
    )
    record(
        _WINNER_RUNNER,
        {"origin": _WINNER_ORIGIN, "file": _RUNNER_BASE, "project": _PROJECT},
        created_at="2026-07-02T00:00:00Z",
    )
    # NULL project on the winner side — the first import pass's shape, reachable
    # only through the winner match's NULL arm.
    record(_WINNER_REDACTION, {"origin": _WINNER_ORIGIN, "file": _REDACTION_BASE})
    record(
        _WINNER_REBASE_LAND,
        {
            "origin": _WINNER_ORIGIN,
            "file": _REBASE_LAND_BASE,
            "project": _PROJECT,
        },
    )
    # Case 12 — the NULL-project decoy for the SAME base file. Live, and OLDER
    # than the exact-project row above, so liveness + created_at alone rank it
    # first; only the project-exactness key ahead of them picks the right one.
    # In prod this is the row that would re-point a sidecar at another project
    # directory's file of the same name.
    record(
        _WINNER_REBASE_LAND_DECOY,
        {"origin": _WINNER_ORIGIN, "file": _REBASE_LAND_BASE},
        created_at="2026-07-01T00:00:00Z",
    )
    # Case 5's winner: it exists, but its sidecar is in no manifest row. Having
    # a winner is what proves the unmapped row is skipped by the DISPOSITION
    # test and not merely by having nothing to point at.
    record(
        _WINNER_UNMAPPED_SIDE,
        {
            "origin": _WINNER_ORIGIN,
            "file": "topic_never_adjudicated.md",
            "project": _PROJECT,
        },
    )
    # The topic-file row the Phase-1b measurement says cannot exist: named
    # after an INDEX file, with a NULL project, so it matches the MEMORY.md
    # sidecar of EVERY project directory. Live and sole candidate, so a
    # winner-presence key would supersede both index sidecars onto it.
    record(_WINNER_MEMORY_INDEX, {"origin": _WINNER_ORIGIN, "file": "MEMORY.md"})
    # What consolidation superseded case 3 onto — a synthesized mental_model,
    # the common prod shape. NOT a topic-file row, so the revision must
    # re-point away from it while preserving the pointer in the stash.
    mental_model = record(
        _MENTAL_MODEL,
        {"origin": "consolidation", "file": "synthesis.md", "project": _PROJECT},
    )

    # 1 + 4. Two sidecars, same base file, different dispositions.
    record(
        _SIDECAR_WINNER_DISP,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": _RUNNER_WINNER_FILE,
            "project": _PROJECT,
        },
    )
    record(
        _SIDECAR_MERGED_DISP,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": _RUNNER_MERGED_FILE,
            "project": _PROJECT,
        },
    )
    # 6. NULL source.project — resolved from the title.
    record(_SIDECAR_NULL_PROJECT, {"origin": _SIDECAR_ORIGIN, "file": _REDACTION_FILE})
    # 3. Already superseded onto the mental_model, validity already ended.
    record(
        _SIDECAR_ALREADY_SUPERSEDED,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": _REBASE_LAND_FILE,
            "project": _PROJECT,
        },
        superseded_by=mental_model,
    )
    # 2. Index sidecars, from two DIFFERENT project directories, both matching
    # the single NULL-project MEMORY.md topic-file row above. They must be
    # TOMBSTONED on their disposition and never superseded onto it: that row is
    # not their winner, it merely shares their filename. The second one
    # resolves its project from the title.
    record(
        _SIDECAR_INDEX,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": "MEMORY.md.conflict-qontinui-2026-07-16T01-41-08Z.md",
            "project": _PROJECT,
        },
    )
    record(
        _SIDECAR_INDEX_2,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": "MEMORY.md.conflict-tiohorst-2026-07-16T01-41-08Z.md",
        },
    )
    # 9. Dispositioned CONTENT rows whose winner is nowhere in coord. Under a
    # winner-presence key these fall into the tombstone arm and get their hold
    # released and decay_prune armed; `_DEP_EDGE_BASE` is the manifest's single
    # `loser`, i.e. the row whose body is the text that WON. One carries an
    # explicit project, the other resolves it from the title.
    record(
        _SIDECAR_ORPHAN_WINNER,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": _SPECIMEN_FILE,
            "project": _COORD_PROJECT,
        },
    )
    record(_SIDECAR_ORPHAN_LOSER, {"origin": _SIDECAR_ORIGIN, "file": _DEP_EDGE_FILE})
    # 5. Content sidecar in no manifest row.
    record(
        _SIDECAR_UNMAPPED,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": "topic_never_adjudicated.md.conflict-ghost-2026-07-16T01-41-08Z.md",
            "project": _PROJECT,
        },
    )
    # 8. Out of scope entirely.
    record(
        _UNRELATED,
        {"origin": _WINNER_ORIGIN, "file": "topic_unrelated.md", "project": _PROJECT},
    )
    record(_BRIDGE_NO_ORIGIN, {"file": _RUNNER_BASE, "project": _PROJECT})

    # 11. The second tenant. `source.file` is a bare filename, so nothing but
    # `s.tenant_id = w.tenant_id` keeps these apart from tenant 1's rows.
    record(
        _T2_WINNER_RUNNER,
        {"origin": _WINNER_ORIGIN, "file": _RUNNER_BASE, "project": _PROJECT},
        created_at="2026-07-10T00:00:00Z",
        tenant=tenant2_id,
    )
    record(
        _T2_WINNER_REDACTION,
        {"origin": _WINNER_ORIGIN, "file": _REDACTION_BASE},
        created_at="2026-06-01T00:00:00Z",
        tenant=tenant2_id,
    )
    record(
        _T2_SIDECAR_RUNNER,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": _RUNNER_WINNER_FILE,
            "project": _PROJECT,
        },
        tenant=tenant2_id,
    )

    with engine.begin() as conn:
        for slug_tenant, label in ((tenant_id, "one"), (tenant2_id, "two")):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:tenant_id, :slug, :display_name)
                    """
                ),
                {
                    "tenant_id": slug_tenant,
                    "slug": f"memadj-{slug_tenant.hex[:12]}",
                    "display_name": f"memhold adjudicate test tenant {label}",
                },
            )
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, kind, title, content,
                         content_hash, source, superseded_by, valid_until,
                         is_tombstone, created_at, embedding)
                    VALUES
                        (:memory_id, :tenant_id, :kind, :title, :content,
                         :content_hash, CAST(:source AS jsonb), :superseded_by,
                         CAST(:valid_until AS timestamptz), :is_tombstone,
                         CAST(:created_at AS timestamptz),
                         CAST(:embedding AS vector))
                    """
                ),
                row,
            )

    ids["__tenant__"] = tenant_id
    ids["__tenant2__"] = tenant2_id
    return ids


def _state(engine: Engine, tenant_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """title → the columns and JSON keys this revision is allowed to move.

    ``content`` / ``content_hash`` / ``embedding`` are here precisely because
    the revision must NOT move them: content writes go through the memory API
    so they get redaction, content-hashing and re-embedding, and raw SQL
    bypasses all three. Selecting them is what turns that docstring claim into
    an assertion.
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT title,
                       superseded_by,
                       is_tombstone,
                       valid_until,
                       content,
                       content_hash,
                       CAST(embedding AS text) AS embedding,
                       source->'lifecycle_hold' AS hold,
                       source->'adjudication'   AS adjudication
                  FROM coord.memory_records
                 WHERE tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id},
        ).mappings()
        return {r["title"]: dict(r) for r in rows}


def _live_titles(engine: Engine, tenant_id: uuid.UUID) -> set[str]:
    """Titles still on the LIVE retrieval surface (the plan's exit criterion)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT title
                  FROM coord.memory_records
                 WHERE tenant_id = :tenant_id
                   AND is_tombstone = false
                   AND superseded_by IS NULL
                   AND valid_until IS NULL
                """
            ),
            {"tenant_id": tenant_id},
        )
        return {r[0] for r in rows}


def _cross_tenant_pointers(engine: Engine) -> list[tuple[str, str]]:
    """Every ``superseded_by`` edge that leaves its tenant. Must always be empty."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT m.title, w.title
                  FROM coord.memory_records m
                  JOIN coord.memory_records w ON w.memory_id = m.superseded_by
                 WHERE w.tenant_id <> m.tenant_id
                """
            )
        )
        return [(r[0], r[1]) for r in rows]


def _load_revision_module() -> ModuleType:
    """Import the revision by path — alembic version files are not a package."""
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    spec = importlib.util.spec_from_file_location(
        "_memhold_adjudicate_under_test", path
    )
    assert spec is not None and spec.loader is not None, path
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_arm_invariants_raise_when_violated() -> None:
    """``_assert_arm_invariants`` must ABORT, not log, on each violation.

    These three conditions cannot be produced from fixture data — that is the
    point of them being invariants — so they are exercised directly. The
    migration is applied to prod unattended and forward-only, so "the deploy
    fails while the transaction can still roll back" is the only useful
    behaviour when an arm and a disposition disagree.
    """
    module = _load_revision_module()
    healthy = {
        "stamped_rows": 9,
        "arm_supersede": 5,
        "arm_tombstone": 2,
        "arm_inert": 2,
        "content_tombstoned": 0,
        "index_superseded": 0,
    }
    module._assert_arm_invariants(**healthy)  # the partition holds: no raise

    with pytest.raises(RuntimeError, match="do not partition the stamped set"):
        module._assert_arm_invariants(**{**healthy, "arm_inert": 1})
    with pytest.raises(RuntimeError, match="do not partition the stamped set"):
        module._assert_arm_invariants(**{**healthy, "stamped_rows": 10})
    with pytest.raises(RuntimeError, match="CONTENT disposition were.*tombstoned"):
        module._assert_arm_invariants(**{**healthy, "content_tombstoned": 1})
    with pytest.raises(RuntimeError, match="had superseded_by rewritten"):
        module._assert_arm_invariants(**{**healthy, "index_superseded": 1})


def test_drift_guard_covers_the_locally_rewritten_fragments() -> None:
    """The drift guard must watch the SQL that RUNS, not only what it copied.

    ``_SIDECAR_ROW_CTE`` and ``_WINNER_JOIN_ON`` are the fragments actually
    interpolated into this revision's DML; the imported Phase-1b constants are
    not. A guard that only inspects the imports passes happily while the tenant
    equality or the project fallback is deleted from the executed strings.
    """
    module = _load_revision_module()
    module._assert_no_drift()  # the shipped fragments agree: no raise

    # Drop the tenant equality from the JOINable winner predicate — the exact
    # edit that would let a sidecar resolve onto another tenant's record.
    module._WINNER_JOIN_ON = module._WINNER_JOIN_ON.replace(
        "AND s.tenant_id = w.tenant_id", ""
    )
    with pytest.raises(RuntimeError, match="_WINNER_JOIN_ON"):
        module._assert_no_drift()

    # And the project fallback from the per-row sidecar CTE — the edit that
    # would strand the 80 rows whose `source.project` is NULL.
    module = _load_revision_module()
    module._SIDECAR_ROW_CTE = module._SIDECAR_ROW_CTE.replace(
        "COALESCE(\n            source->>'project',", "COALESCE(\n            NULL,"
    )
    with pytest.raises(RuntimeError, match="_SIDECAR_ROW_CTE"):
        module._assert_no_drift()


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:5433 (or "
        "bring up a backend Postgres) before running this test."
    ),
)
def test_memhold_adjudicate_01_lands_the_dispositions() -> None:
    """Seed the parent revision, apply the adjudication, assert every branch."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "memhold_adjudicate_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed(engine)
        tenant_id = ids["__tenant__"]
        tenant2_id = ids["__tenant2__"]

        before = _state(engine, tenant_id)
        before2 = _state(engine, tenant2_id)
        assert all(row["hold"] is True for row in before.values()), (
            "the fixture must start from the memhold_backfill_01 state"
        )
        assert (
            before[_SIDECAR_ALREADY_SUPERSEDED]["superseded_by"] == ids[_MENTAL_MODEL]
        )
        assert all(row["embedding"] for row in before.values()), (
            "every fixture row carries an embedding, so 'never touched' is "
            "asserted rather than vacuously true"
        )

        # ----------------------------------------------------------------
        # Apply.
        # ----------------------------------------------------------------
        applied = run_alembic(root, url, "upgrade", _REVISION_ID)
        after = _state(engine, tenant_id)
        after2 = _state(engine, tenant2_id)

        # -- 1. the disposition stamp -------------------------------------
        for title, disposition in _EXPECT_DISPOSITION.items():
            stamp = after[title]["adjudication"]
            assert stamp is not None, f"{title} must be stamped"
            assert stamp["disposition"] == disposition, (
                f"{title} must carry the manifest's disposition; two sidecars "
                "of one base file are allowed to disagree"
            )
            assert stamp["decided"] == "2026-08-01"
            assert stamp["plan"] == _PLAN_SLUG
            assert stamp["gate"] == _GATE_ID

        # -- 2. prior_superseded_by — the one thing that must not be lost --
        assert after[_SIDECAR_ALREADY_SUPERSEDED]["adjudication"][
            "prior_superseded_by"
        ] == str(ids[_MENTAL_MODEL]), (
            "the pointer consolidation's similarity heuristic chose must "
            "survive in the stash before it is overwritten"
        )
        assert (
            after[_SIDECAR_WINNER_DISP]["adjudication"]["prior_superseded_by"] is None
        ), "a never-superseded row stashes an explicit null, not a missing key"

        # -- 3a. content rows WITH a winner are re-pointed at it ------------
        assert after[_SIDECAR_WINNER_DISP]["superseded_by"] == ids[_WINNER_RUNNER], (
            "of the two topic-file rows for this base file the LIVE one wins, "
            "even though the tombstoned one is older"
        )
        assert after[_SIDECAR_MERGED_DISP]["superseded_by"] == ids[_WINNER_RUNNER]
        assert (
            after[_SIDECAR_NULL_PROJECT]["superseded_by"] == ids[_WINNER_REDACTION]
        ), (
            "the project fallback (title) and the winner's NULL-project arm "
            "must both fire for the first import pass's rows"
        )
        assert (
            after[_SIDECAR_ALREADY_SUPERSEDED]["superseded_by"]
            == ids[_WINNER_REBASE_LAND]
        ), (
            "the EXACT-project winner must outrank the NULL-project row for "
            "the same base file, even though the decoy is live and older — "
            "the join's project arm is permissive, so the RANKING is what "
            "stops a cross-project re-point"
        )
        for title in (
            _SIDECAR_WINNER_DISP,
            _SIDECAR_MERGED_DISP,
            _SIDECAR_NULL_PROJECT,
        ):
            assert after[title]["valid_until"] is not None
            assert after[title]["is_tombstone"] is False, (
                "a content row with a winner is superseded, never tombstoned"
            )
        assert (
            after[_SIDECAR_ALREADY_SUPERSEDED]["valid_until"]
            == before[_SIDECAR_ALREADY_SUPERSEDED]["valid_until"]
        ), "a validity already ended keeps its original supersession instant"

        # -- 3b. index rows are tombstoned, winner or no winner ------------
        #
        # The regression this exists for: both of these DO have a matching
        # 'topic-file' row (`_WINNER_MEMORY_INDEX`, NULL project, so it matches
        # every project directory's MEMORY.md at once). Keying the arms on
        # winner-presence supersedes both onto it and reports `tombstoned 0` —
        # in prod, all 113 index rows collapsing onto one unrelated record,
        # silently.
        for title in _EXPECT_TOMBSTONED:
            assert after[title]["is_tombstone"] is True, (
                f"{title} is dispositioned index-merge-artifact, so it is "
                "tombstoned — having a same-named topic-file row does not make "
                "that row its winner"
            )
            assert after[title]["valid_until"] is not None
            assert after[title]["superseded_by"] is None, (
                f"{title} must not be re-pointed at {_WINNER_MEMORY_INDEX}"
            )
            assert after[title]["superseded_by"] != ids[_WINNER_MEMORY_INDEX]

        # -- 3c. content rows with NO winner are INERT ---------------------
        #
        # The regression this exists for: keying the arms on winner-presence
        # instead of on the disposition tombstones these, ends their validity
        # and arms decay_prune on the manifest's single `loser` — the row
        # whose body is the text that WON.
        for title in _EXPECT_INERT:
            row, was = after[title], before[title]
            assert row["is_tombstone"] is False, (
                f"{title} has a CONTENT disposition and no winner — it must "
                "never be tombstoned"
            )
            assert row["superseded_by"] is None, f"{title} has nothing to point at"
            assert row["valid_until"] == was["valid_until"], (
                f"{title} keeps its validity — nothing was adjudicated away"
            )
            assert row["hold"] is True, (
                f"{title} keeps its hold: releasing it arms decay_prune on a "
                "row no human decided to discard"
            )

        # -- 4. the hold, three ways --------------------------------------
        for title in _EXPECT_RELEASED:
            assert after[title]["hold"] is False, (
                f"{title} is fully adjudicated, so its hold is explicitly released"
            )
        for title in _EXPECT_SIDECARS_STILL_HELD:
            assert after[title]["hold"] is True, (
                f"{title} must stay HELD — a `merged`/`loser` body is the "
                "input to the memory-API content follow-up, and an inert or "
                "unmapped row was never adjudicated at all"
            )
        for title in _EXPECT_STILL_HELD:
            assert after[title]["hold"] is True, (
                f"{title} is a topic-file WINNER — its corrected text is still "
                "a memory-API follow-up, so it must stay held"
            )

        # -- 5. the unmapped row is left entirely alone -------------------
        assert after[_SIDECAR_UNMAPPED] == before[_SIDECAR_UNMAPPED], (
            "an unmapped sidecar is an unadjudicated sidecar: no stamp, no "
            "supersede, no tombstone, hold intact"
        )

        # -- 6. nothing outside the contested set moved -------------------
        for title in (
            _UNRELATED,
            _BRIDGE_NO_ORIGIN,
            _MENTAL_MODEL,
            _WINNER_RUNNER,
            _WINNER_RUNNER_DEAD,
            _WINNER_REDACTION,
            _WINNER_REBASE_LAND,
            _WINNER_REBASE_LAND_DECOY,
            _WINNER_UNMAPPED_SIDE,
            _WINNER_MEMORY_INDEX,
        ):
            assert after[title] == before[title], (
                f"{title} must not move — this revision writes to sidecar rows "
                "only, and the winners' corrected text is a separate follow-up"
            )

        # -- 7. content and embedding are never touched, on any row -------
        for title, row in after.items():
            assert row["content"] == before[title]["content"]
            assert row["content_hash"] == before[title]["content_hash"]
            assert row["embedding"] == before[title]["embedding"], (
                "raw SQL cannot re-embed, so a revision that moved `embedding` "
                "would leave the vector describing text that no longer exists"
            )

        # -- 8. tenant isolation, in both directions ----------------------
        assert after2[_T2_SIDECAR_RUNNER]["superseded_by"] == ids[_T2_WINNER_RUNNER], (
            "a sidecar resolves onto its OWN tenant's winner — tenant 1 holds "
            "a live, exact-project, OLDER row for the same base file, which "
            "the ranking would otherwise prefer"
        )
        assert (
            after[_SIDECAR_NULL_PROJECT]["superseded_by"] != ids[_T2_WINNER_REDACTION]
        ), "tenant 2's older NULL-project row must not steal tenant 1's sidecar"
        for title in (_T2_WINNER_RUNNER, _T2_WINNER_REDACTION):
            assert after2[title] == before2[title], (
                f"{title} is a topic-file winner and must not move"
            )
        assert _cross_tenant_pointers(engine) == [], (
            "`source.file` is a bare filename, so tenant equality is the only "
            "thing keeping a supersession inside its tenant"
        )

        # -- 9. the exit criterion: adjudicated sidecars leave the surface -
        live = _live_titles(engine, tenant_id)
        assert live.isdisjoint(_EXPECT_OFF_SURFACE), (
            "every sidecar that took an arm must be off the live retrieval surface"
        )
        assert _SIDECAR_UNMAPPED in live, "the unmapped one is deliberately still live"
        for title in _EXPECT_INERT:
            assert title in live, (
                f"{title} was never adjudicable, so it stays on the live "
                "surface for a human — being tombstoned is the bug"
            )

        # -- 10. the migrator log is the only record of the blast radius --
        log = applied.stdout + applied.stderr
        assert "10 sync-conflict sidecar row(s) in scope" in log, log
        assert "stamped 9 with source.adjudication" in log, log
        assert "superseded 5 onto a topic-file winner" in log, log
        assert "tombstoned 2 index-merge-artifact row(s)" in log, log
        assert "released the hold on 6" in log, log
        assert "8 topic-file winner(s) REMAIN HELD" in log, log
        assert "2 content row(s) were left INERT" in log, log
        assert "1 sidecar row(s) could not be mapped" in log, log
        assert "9 stamped row(s) as 5 superseded / 2 tombstoned / 2 skipped" in log, log
        assert "UNMAPPED sidecar row" in log, (
            "the unmappable row must be named loudly, with its identifying "
            f"fields; got:\n{log}"
        )
        assert _SIDECAR_UNMAPPED.split("/")[-1] in log
        assert log.count("INERT sidecar row") == 2, (
            "each dispositioned row with no winner must be named individually "
            f"at ERROR; got:\n{log}"
        )
        assert _SPECIMEN_FILE in log, log
        assert _DEP_EDGE_FILE in log, log
        assert log.count("index sidecar with an UNEXPECTED winner") == 2, (
            "an index row that has a winner is still tombstoned, but the "
            f"corpus has moved and the log must say so; got:\n{log}"
        )

        # ----------------------------------------------------------------
        # Re-run over its own output — the idempotency claim.
        # ----------------------------------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        rerun = run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _state(engine, tenant_id) == after, "a re-run must change nothing"
        assert _state(engine, tenant2_id) == after2, "a re-run must change nothing"
        rerun_log = rerun.stdout + rerun.stderr
        assert "stamped 0 with source.adjudication" in rerun_log, rerun_log
        assert "superseded 0 onto a topic-file winner" in rerun_log, rerun_log
        assert "tombstoned 0 index-merge-artifact row(s)" in rerun_log, rerun_log
        assert "released the hold on 0" in rerun_log, rerun_log
        # The invariants are counted from the END state, not from the
        # rowcounts, so they still report the full partition on a re-run.
        assert (
            "9 stamped row(s) as 5 superseded / 2 tombstoned / 2 skipped" in rerun_log
        ), rerun_log

        # ----------------------------------------------------------------
        # Downgrade — restores from the stash.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        reverted = _state(engine, tenant_id)

        for title in _ALL_SIDECARS:
            assert reverted[title]["adjudication"] is None, f"{title} loses the stamp"
            assert reverted[title]["hold"] is True, f"{title} is held again"
            assert (
                reverted[title]["superseded_by"] == (before[title]["superseded_by"])
            ), f"{title} restores the pointer it had before"
            assert reverted[title]["is_tombstone"] == before[title]["is_tombstone"]
            assert reverted[title]["valid_until"] == before[title]["valid_until"]

        # ----------------------------------------------------------------
        # Re-upgrade — the selection is re-derivable.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        again = _state(engine, tenant_id)
        for title in _ALL_SIDECARS:
            assert again[title]["superseded_by"] == after[title]["superseded_by"]
            assert again[title]["is_tombstone"] == after[title]["is_tombstone"]
            assert again[title]["hold"] == after[title]["hold"]
