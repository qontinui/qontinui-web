"""Data-semantics test for the ``memhold_adjudicate_01`` revision.

Phase 3.3 of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``
lands the operator's 2026-08-01 dispositions (gate
``925c3ab3-9d05-429b-b218-0d1c97262c54``) into ``coord.memory_records``: it
stamps ``source.adjudication`` on every sidecar row, supersedes the ones with a
topic-file winner onto that winner, tombstones the ones without, and releases
``source.lifecycle_hold`` on the sidecars ONLY.

Like its Phase-1b sibling the revision authors **no schema**, so its whole
contract is which rows it touches and what it writes. This test seeds the
parent revision with one fixture per branch, walks one step up, and asserts the
resulting rows.

Cases covered (each a distinct branch of the revision's SQL)
============================================================

1. **Content sidecar WITH a topic-file winner** — stamped with the manifest's
   per-file disposition and re-pointed at the winner.
2. **Index sidecar with NO winner** (``MEMORY.md``) — stamped
   ``index-merge-artifact`` by the structural rule and TOMBSTONED. 113 of the
   138 prod rows are this shape.
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
"""

from __future__ import annotations

import hashlib
import json
import uuid
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

_SIDECAR_ORIGIN = "sync-conflict-sidecar"
_WINNER_ORIGIN = "topic-file"

_PROJECT = "D--qontinui-root"
_GATE_ID = "925c3ab3-9d05-429b-b218-0d1c97262c54"
_PLAN_SLUG = "2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord"

# Real manifest rows, so the fixture exercises the shipped table rather than a
# parallel one. The first two share a base file and disagree on disposition.
_RUNNER_BASE = "project_runner_as_ci_node_migration.md"
_RUNNER_WINNER_FILE = f"{_RUNNER_BASE}.conflict-tiohorst-2026-07-21T05-24-53Z.md"
_RUNNER_MERGED_FILE = f"{_RUNNER_BASE}.conflict-tiohorst-2026-07-23T02-50-41Z.md"
_REDACTION_BASE = "project_ui_bridge_redaction_not_enforced_structural_plan.md"
_REDACTION_FILE = f"{_REDACTION_BASE}.conflict-qontinui-2026-07-23T02-50-32Z.md"

# Titles double as fixture names in the assertions.
_SIDECAR_WINNER_DISP = f"[sync-conflict sidecar] {_PROJECT}/{_RUNNER_WINNER_FILE}"
_SIDECAR_MERGED_DISP = f"[sync-conflict sidecar] {_PROJECT}/{_RUNNER_MERGED_FILE}"
_SIDECAR_NULL_PROJECT = f"[sync-conflict sidecar] {_PROJECT}/{_REDACTION_FILE}"
_SIDECAR_ALREADY_SUPERSEDED = (
    f"[sync-conflict sidecar] {_PROJECT}/"
    "reference_pr_merged_gate_fails_on_coord_rebase_land.md"
    ".conflict-qontinui-2026-07-21T05-24-49Z.md"
)
_SIDECAR_INDEX = (
    f"[sync-conflict sidecar] {_PROJECT}/"
    "MEMORY.md.conflict-qontinui-2026-07-16T01-41-08Z.md"
)
_SIDECAR_UNMAPPED = (
    f"[sync-conflict sidecar] {_PROJECT}/"
    "topic_never_adjudicated.md.conflict-ghost-2026-07-16T01-41-08Z.md"
)

_WINNER_RUNNER = "project_runner_as_ci_node_migration"
_WINNER_RUNNER_DEAD = "project_runner_as_ci_node_migration (dead duplicate)"
_WINNER_REDACTION = "project_ui_bridge_redaction_not_enforced_structural_plan"
_WINNER_REBASE_LAND = "reference_pr_merged_gate_fails_on_coord_rebase_land"
_WINNER_UNMAPPED_SIDE = "topic_never_adjudicated"
_MENTAL_MODEL = "synthesized mental model"
_UNRELATED = "topic_unrelated"
_BRIDGE_NO_ORIGIN = "bridge era row"

_ALL_SIDECARS = (
    _SIDECAR_WINNER_DISP,
    _SIDECAR_MERGED_DISP,
    _SIDECAR_NULL_PROJECT,
    _SIDECAR_ALREADY_SUPERSEDED,
    _SIDECAR_INDEX,
    _SIDECAR_UNMAPPED,
)
# Every sidecar the revision must map, and to what.
_EXPECT_DISPOSITION = {
    _SIDECAR_WINNER_DISP: "winner",
    _SIDECAR_MERGED_DISP: "merged",
    _SIDECAR_NULL_PROJECT: "winner",
    _SIDECAR_ALREADY_SUPERSEDED: "winner",
    _SIDECAR_INDEX: "index-merge-artifact",
}
# Winners carry the hold through the migration; the sidecars lose it.
_EXPECT_STILL_HELD = (
    _WINNER_RUNNER,
    _WINNER_RUNNER_DEAD,
    _WINNER_REDACTION,
    _WINNER_REBASE_LAND,
    _WINNER_UNMAPPED_SIDE,
)


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """Seed one tenant and the eleven records, at the PARENT revision.

    Seeding must happen before the revision runs: it is one-shot DML, so a row
    inserted afterwards would never be reached.
    """
    tenant_id = uuid.uuid4()
    ids: dict[str, uuid.UUID] = {}
    rows: list[dict[str, Any]] = []

    def record(
        title: str,
        source: dict[str, object],
        *,
        superseded_by: uuid.UUID | None = None,
        is_tombstone: bool = False,
        created_at: str = "2026-07-05T00:00:00Z",
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
                "tenant_id": tenant_id,
                "kind": "observation",
                "title": title,
                "content": content,
                "content_hash": hashlib.sha256(content.encode()).hexdigest(),
                "source": json.dumps(source),
                "superseded_by": superseded_by,
                "valid_until": "2026-07-28T16:20:00Z" if superseded_by else None,
                "is_tombstone": is_tombstone,
                "created_at": created_at,
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
            "file": "reference_pr_merged_gate_fails_on_coord_rebase_land.md",
            "project": _PROJECT,
        },
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
            "file": (
                "reference_pr_merged_gate_fails_on_coord_rebase_land.md"
                ".conflict-qontinui-2026-07-21T05-24-49Z.md"
            ),
            "project": _PROJECT,
        },
        superseded_by=mental_model,
    )
    # 2. Index sidecar — no topic-file row exists for MEMORY.md.
    record(
        _SIDECAR_INDEX,
        {
            "origin": _SIDECAR_ORIGIN,
            "file": "MEMORY.md.conflict-qontinui-2026-07-16T01-41-08Z.md",
            "project": _PROJECT,
        },
    )
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

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:tenant_id, :slug, 'memhold adjudicate test')
                """
            ),
            {"tenant_id": tenant_id, "slug": f"memadj-{tenant_id.hex[:12]}"},
        )
        for row in rows:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.memory_records
                        (memory_id, tenant_id, kind, title, content,
                         content_hash, source, superseded_by, valid_until,
                         is_tombstone, created_at)
                    VALUES
                        (:memory_id, :tenant_id, :kind, :title, :content,
                         :content_hash, CAST(:source AS jsonb), :superseded_by,
                         CAST(:valid_until AS timestamptz), :is_tombstone,
                         CAST(:created_at AS timestamptz))
                    """
                ),
                row,
            )

    ids["__tenant__"] = tenant_id
    return ids


def _state(engine: Engine, tenant_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """title → the columns and JSON keys this revision is allowed to move."""
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

        before = _state(engine, tenant_id)
        assert all(row["hold"] is True for row in before.values()), (
            "the fixture must start from the memhold_backfill_01 state"
        )
        assert (
            before[_SIDECAR_ALREADY_SUPERSEDED]["superseded_by"] == ids[_MENTAL_MODEL]
        )

        # ----------------------------------------------------------------
        # Apply.
        # ----------------------------------------------------------------
        applied = run_alembic(root, url, "upgrade", _REVISION_ID)
        after = _state(engine, tenant_id)

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

        # -- 3a. rows WITH a winner are re-pointed at it -------------------
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
        ), "an already-superseded row is re-pointed away from the mental_model"
        for title in (
            _SIDECAR_WINNER_DISP,
            _SIDECAR_MERGED_DISP,
            _SIDECAR_NULL_PROJECT,
        ):
            assert after[title]["valid_until"] is not None
            assert after[title]["is_tombstone"] is False, (
                "a row with a winner is superseded, never tombstoned"
            )
        assert (
            after[_SIDECAR_ALREADY_SUPERSEDED]["valid_until"]
            == before[_SIDECAR_ALREADY_SUPERSEDED]["valid_until"]
        ), "a validity already ended keeps its original supersession instant"

        # -- 3b. rows with NO winner are tombstoned -----------------------
        assert after[_SIDECAR_INDEX]["is_tombstone"] is True
        assert after[_SIDECAR_INDEX]["valid_until"] is not None
        assert after[_SIDECAR_INDEX]["superseded_by"] is None, (
            "there is no topic-file row for MEMORY.md to point at"
        )

        # -- 4. the hold, asymmetrically ----------------------------------
        for title in _EXPECT_DISPOSITION:
            assert after[title]["hold"] is False, (
                f"{title} is adjudicated, so its hold is explicitly released"
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
            _WINNER_UNMAPPED_SIDE,
        ):
            assert after[title] == before[title], (
                f"{title} must not move — this revision writes to sidecar rows "
                "only, and the winners' corrected text is a separate follow-up"
            )

        # -- 7. content is never touched, on any row ----------------------
        for title, row in after.items():
            assert row["content"] == before[title]["content"]
            assert row["content_hash"] == before[title]["content_hash"]

        # -- 8. the exit criterion: adjudicated sidecars leave the surface -
        live = _live_titles(engine, tenant_id)
        assert live.isdisjoint(_EXPECT_DISPOSITION), (
            "every adjudicated sidecar must be off the live retrieval surface"
        )
        assert _SIDECAR_UNMAPPED in live, "the unmapped one is deliberately still live"

        # -- 9. the migrator log is the only record of the blast radius ---
        log = applied.stdout + applied.stderr
        assert "6 sync-conflict sidecar row(s) in scope" in log, log
        assert "stamped 5 with source.adjudication" in log, log
        assert "superseded 4 onto a topic-file winner" in log, log
        assert "tombstoned 1 with no winner" in log, log
        assert "released the hold on 5" in log, log
        assert "5 topic-file winner(s) REMAIN HELD" in log, log
        assert "1 sidecar row(s) could not be mapped" in log, log
        assert "UNMAPPED sidecar row" in log, (
            "the unmappable row must be named loudly, with its identifying "
            f"fields; got:\n{log}"
        )
        assert _SIDECAR_UNMAPPED.split("/")[-1] in log

        # ----------------------------------------------------------------
        # Re-run over its own output — the idempotency claim.
        # ----------------------------------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        rerun = run_alembic(root, url, "upgrade", _REVISION_ID)

        assert _state(engine, tenant_id) == after, "a re-run must change nothing"
        rerun_log = rerun.stdout + rerun.stderr
        assert "stamped 0 with source.adjudication" in rerun_log, rerun_log
        assert "superseded 0 onto a topic-file winner" in rerun_log, rerun_log
        assert "tombstoned 0 with no winner" in rerun_log, rerun_log
        assert "released the hold on 0" in rerun_log, rerun_log

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
