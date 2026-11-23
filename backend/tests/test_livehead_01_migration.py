"""Behaviour test for the ``livehead_01`` revision.

The revision makes "at most one LIVE ``coord.merge_proposals`` row per
``(repo, branch, head_sha)``" a database invariant (plan
``2026-11-23-coord-one-live-merge-proposal-per-head-is-a-database-invariant``
Phase 2). It cancels existing live duplicates, adds a trigger-maintained
``coord.merge_proposal_repos.proposal_live`` and builds the partial unique
index ``uq_merge_proposal_repos_live_head`` over it.

What is asserted, against the real alembic chain on a throwaway database:

1. **Cleanup keeps the right row.** Of two live rows at one head the MOST
   ADVANCED one is kept even when it is newer; of two equally advanced rows the
   OLDEST ``proposal_id`` is kept. Each loser reads ``cancelled`` with
   ``cancelled_at`` set and an ``error`` naming its keeper. Terminal rows and a
   lone live row at another head are untouched. A batch member that is the
   KEEPER does not trip the refusal.
2. **The invariant holds against a new writer:** a second live insert at a held
   head raises ``23505`` on ``uq_merge_proposal_repos_live_head``.
3. **…and against a revive:** moving a terminal row back to a live status at a
   held head raises ``23505``, and the row stays terminal.
4. **A live-to-live move writes no child row** (``queued`` → ``dry-rebasing``:
   the child's ``xmin`` is unchanged), while a live-to-terminal move flips the
   child to ``false`` and frees the head for a new proposal.
5. **Downgrade round-trips:** index, triggers, functions and column are gone;
   the cleanup's cancellations survive (documented — the downgrade never
   un-cancels); a second upgrade re-applies cleanly.
6. **The refusal arm:** a duplicate whose LOSER is a batch member, spans
   more than one repo, or is past ``queued`` / ``blocked-by-overlap`` (coord
   may be mid-rebase, mid-CI or mid-land on it) makes the upgrade fail, naming
   the row. The WHOLE upgrade rolls back: nothing cancelled, no column, and —
   the one object created BEFORE the refusal — no liveness function.
7. **The step order is load-bearing:** running the revision's own SQL in the
   pre-vet order (backfill ``proposal_live`` before the cleanup) makes the
   index build fail with ``23505``; the shipped order builds it. The module's
   ``UPGRADE_STEPS`` is pinned to the shipped order, and step 1 already holds
   ``ACCESS EXCLUSIVE`` on the child, so ``ADD COLUMN`` takes no new lock.
8. **Concurrency and coord's statement shapes, after upgrade:** a child
   inserted under a parent whose cancel is in flight in another connection
   waits for it and reads ``false`` (the ``FOR SHARE`` in the child trigger);
   and coord's ``heal_missing_rebased_tip`` shape — one ``WITH`` statement that
   flips the parent to terminal and writes the child — runs and leaves the
   child ``false``.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    index_state,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "livehead_01"
_PARENT_REVISION_ID = "coord_subprojects_05_note_events"
_INDEX_NAME = "uq_merge_proposal_repos_live_head"
_REVISION_PATH = (
    backend_root()
    / "alembic"
    / "versions"
    / "livehead_01_merge_proposal_repos_live_head.py"
)

_REPO = "qontinui/qontinui-coord"
_BRANCH_1, _HEAD_1 = "feat/one", "1111111111111111111111111111111111111111"
_BRANCH_2, _HEAD_2 = "feat/two", "2222222222222222222222222222222222222222"
_BRANCH_3, _HEAD_3 = "feat/three", "3333333333333333333333333333333333333333"


def _pid(n: int) -> uuid.UUID:
    """A UUIDv7-shaped id whose byte order (and so mint order) follows ``n``."""
    return uuid.UUID(f"01a1abe0-0000-7000-8000-{n:012d}")


def _error_for(keeper: uuid.UUID) -> str:
    return f"duplicate live proposal for this head; kept {keeper} (alembic livehead_01)"


pytestmark = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)


@pytest.fixture
def db_at_parent() -> Iterator[tuple[Engine, str]]:
    """A throwaway database migrated to the parent revision."""
    with ephemeral_database(admin_database_url(), "livehead_01_test") as (
        engine,
        url,
    ):
        run_alembic(backend_root(), url, "upgrade", _PARENT_REVISION_ID)
        yield engine, url


def _seed(
    engine: Engine,
    proposal_id: uuid.UUID,
    status: str,
    heads: list[tuple[str, str, str]],
    batch_id: uuid.UUID | None = None,
) -> None:
    """One parent row and one child row per ``(repo, branch, head_sha)``."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.merge_proposals
                    (proposal_id, agent_id, status, batch_id)
                VALUES (:p, :agent, :status, :batch)
                """
            ),
            {
                "p": proposal_id,
                "agent": uuid.uuid4(),
                "status": status,
                "batch": batch_id,
            },
        )
        for repo, branch, head_sha in heads:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.merge_proposal_repos
                        (proposal_id, repo, branch, head_sha)
                    VALUES (:p, :repo, :branch, :head)
                    """
                ),
                {"p": proposal_id, "repo": repo, "branch": branch, "head": head_sha},
            )


def _proposal(engine: Engine, proposal_id: uuid.UUID) -> tuple[str, object, str | None]:
    """``(status, cancelled_at, error)``."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT status, cancelled_at, error
                  FROM coord.merge_proposals WHERE proposal_id = :p
                """
            ),
            {"p": proposal_id},
        ).one()
    return str(row[0]), row[1], row[2]


def _child(engine: Engine, proposal_id: uuid.UUID) -> tuple[bool, str]:
    """``(proposal_live, xmin)`` of the proposal's single child row."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT proposal_live, xmin::text
                  FROM coord.merge_proposal_repos WHERE proposal_id = :p
                """
            ),
            {"p": proposal_id},
        ).one()
    return bool(row[0]), str(row[1])


def _set_status(engine: Engine, proposal_id: uuid.UUID, status: str) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE coord.merge_proposals SET status = :s WHERE proposal_id = :p"),
            {"s": status, "p": proposal_id},
        )


def _assert_live_head_violation(excinfo: pytest.ExceptionInfo[IntegrityError]) -> None:
    orig = excinfo.value.orig
    assert getattr(orig, "pgcode", None) == "23505", orig
    diag = getattr(orig, "diag", None)
    assert getattr(diag, "constraint_name", None) == _INDEX_NAME, orig


def _objects_present(engine: Engine) -> dict[str, bool]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                  to_regprocedure('coord.merge_proposal_status_is_live(text)') IS NOT NULL,
                  to_regprocedure('coord.merge_proposal_repos_set_proposal_live()') IS NOT NULL,
                  to_regprocedure('coord.merge_proposals_propagate_proposal_live()') IS NOT NULL,
                  (SELECT count(*) FROM pg_trigger t
                    WHERE t.tgrelid IN ('coord.merge_proposals'::regclass,
                                        'coord.merge_proposal_repos'::regclass)
                      AND NOT t.tgisinternal)
                """
            )
        ).one()
    return {
        "is_live_fn": bool(row[0]),
        "child_fn": bool(row[1]),
        "parent_fn": bool(row[2]),
        "triggers": int(row[3]) == 2,
    }


def test_livehead_01_cleanup_then_index_enforces_one_live_row_per_head(
    db_at_parent: tuple[Engine, str],
) -> None:
    engine, url = db_at_parent
    root = backend_root()
    head_1 = [(_REPO, _BRANCH_1, _HEAD_1)]
    head_2 = [(_REPO, _BRANCH_2, _HEAD_2)]
    head_3 = [(_REPO, _BRANCH_3, _HEAD_3)]

    # Head 1: an OLDER queued row and a NEWER awaiting-ci row — the more
    # advanced one wins although it is newer. Plus a terminal row.
    older_queued, newer_awaiting, merged_h1 = _pid(1), _pid(2), _pid(3)
    _seed(engine, older_queued, "queued", head_1)
    _seed(engine, newer_awaiting, "awaiting-ci", head_1)
    _seed(engine, merged_h1, "merged", head_1)
    # Head 2: two queued rows — the oldest wins the tie. The keeper is a batch
    # member, which must NOT trip the refusal (only a LOSER does).
    tie_old, tie_new = _pid(4), _pid(5)
    _seed(engine, tie_old, "queued", head_2, batch_id=uuid.uuid4())
    _seed(engine, tie_new, "queued", head_2)
    # Head 3: one live row and one cancelled row — no duplicate.
    lone_live, cancelled_h3 = _pid(6), _pid(7)
    _seed(engine, lone_live, "queued", head_3)
    _seed(engine, cancelled_h3, "cancelled", head_3)

    run_alembic(root, url, "upgrade", _REVISION_ID)

    # 1. Cleanup.
    assert _proposal(engine, newer_awaiting)[0] == "awaiting-ci"
    status, cancelled_at, error = _proposal(engine, older_queued)
    assert status == "cancelled" and cancelled_at is not None
    assert error == _error_for(newer_awaiting)
    assert _proposal(engine, tie_old)[0] == "queued"
    status, cancelled_at, error = _proposal(engine, tie_new)
    assert status == "cancelled" and cancelled_at is not None
    assert error == _error_for(tie_old)
    assert _proposal(engine, merged_h1) == ("merged", None, None)
    assert _proposal(engine, lone_live)[0] == "queued"
    assert _proposal(engine, cancelled_h3)[2] is None, (
        "a pre-existing cancel is not rewritten"
    )

    assert column_info(engine, "merge_proposal_repos", "proposal_live") == (
        "boolean",
        "NO",
        "false",
    )
    for pid, live in (
        (newer_awaiting, True),
        (older_queued, False),
        (merged_h1, False),
        (tie_old, True),
        (tie_new, False),
        (lone_live, True),
        (cancelled_h3, False),
    ):
        assert _child(engine, pid)[0] is live, pid
    valid, unique, predicate = index_state(engine, _INDEX_NAME)
    assert valid and unique and predicate == "proposal_live", predicate

    # 2. A second live proposal at a held head is refused.
    with pytest.raises(IntegrityError) as excinfo:
        _seed(engine, _pid(8), "queued", head_1)
    _assert_live_head_violation(excinfo)
    # A terminal row at a held head is not live, so it is accepted.
    _seed(engine, _pid(9), "cancelled", head_1)
    assert _child(engine, _pid(9))[0] is False

    # 3. Reviving a terminal row at a held head is refused; it stays terminal.
    with pytest.raises(IntegrityError) as excinfo:
        _set_status(engine, merged_h1, "queued")
    _assert_live_head_violation(excinfo)
    assert _proposal(engine, merged_h1)[0] == "merged"
    assert _child(engine, merged_h1)[0] is False

    # 4. live -> live writes no child row; live -> terminal frees the head.
    live_before, xmin_before = _child(engine, lone_live)
    _set_status(engine, lone_live, "dry-rebasing")
    live_after, xmin_after = _child(engine, lone_live)
    assert live_before and live_after
    assert xmin_after == xmin_before, "a live-to-live move must not write the child"

    _set_status(engine, lone_live, "conflict")
    assert _child(engine, lone_live)[0] is False
    _seed(engine, _pid(10), "queued", head_3)
    assert _child(engine, _pid(10))[0] is True
    # ...and the terminal row cannot now be revived over the new holder.
    with pytest.raises(IntegrityError) as excinfo:
        _set_status(engine, lone_live, "queued")
    _assert_live_head_violation(excinfo)

    # 5. Downgrade round-trip. Cancellations survive by design.
    run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
    assert not index_exists(engine, _INDEX_NAME)
    assert column_info(engine, "merge_proposal_repos", "proposal_live") is None
    assert not any(_objects_present(engine).values()), _objects_present(engine)
    assert _proposal(engine, older_queued)[0] == "cancelled"
    assert _proposal(engine, tie_new)[0] == "cancelled"

    run_alembic(root, url, "upgrade", _REVISION_ID)
    assert all(_objects_present(engine).values()), _objects_present(engine)
    assert index_state(engine, _INDEX_NAME)[0]
    assert _child(engine, newer_awaiting)[0] is True
    assert _child(engine, _pid(10))[0] is True
    assert _child(engine, lone_live)[0] is False


def test_livehead_01_refuses_to_cancel_a_batch_member_or_multi_repo_loser(
    db_at_parent: tuple[Engine, str],
) -> None:
    engine, url = db_at_parent
    head_1 = [(_REPO, _BRANCH_1, _HEAD_1)]
    head_2 = [(_REPO, _BRANCH_2, _HEAD_2)]

    # Head 1: the loser (queued, beaten by landing) is a batch member.
    batch_loser, keeper_1 = _pid(1), _pid(2)
    _seed(engine, batch_loser, "queued", head_1, batch_id=uuid.uuid4())
    _seed(engine, keeper_1, "landing", head_1)
    # Head 2: the loser (newer of two queued) spans two repos.
    keeper_2, multi_loser = _pid(3), _pid(4)
    _seed(engine, keeper_2, "queued", head_2)
    _seed(
        engine,
        multi_loser,
        "queued",
        [*head_2, ("qontinui/qontinui-web", "feat/two", "4" * 40)],
    )

    proc = run_alembic(
        backend_root(), url, "upgrade", _REVISION_ID, expect_success=False
    )
    assert str(batch_loser) in proc.stderr, proc.stderr
    assert str(multi_loser) in proc.stderr, proc.stderr

    # The whole upgrade rolled back: nothing cancelled, no column, no index —
    # and no liveness function, which step 2 created BEFORE the refusal, so
    # only a real rollback removes it.
    for pid in (batch_loser, keeper_1, keeper_2, multi_loser):
        assert _proposal(engine, pid)[0] in ("queued", "landing"), pid
    assert column_info(engine, "merge_proposal_repos", "proposal_live") is None
    assert not index_exists(engine, _INDEX_NAME)
    assert not _objects_present(engine)["is_live_fn"], "step 2 survived a RAISE"


def test_livehead_01_refuses_to_cancel_a_loser_past_queued(
    db_at_parent: tuple[Engine, str],
) -> None:
    """A loser coord may be mid-rebase, mid-CI or mid-land on is not cancelled."""
    engine, url = db_at_parent
    head_1 = [(_REPO, _BRANCH_1, _HEAD_1)]
    head_2 = [(_REPO, _BRANCH_2, _HEAD_2)]
    head_3 = [(_REPO, _BRANCH_3, _HEAD_3)]

    # Head 1: landing beats speculative-ci, which is past queued -> refuse.
    _seed(engine, _pid(1), "speculative-ci", head_1)
    _seed(engine, _pid(2), "landing", head_1)
    # Head 2: two landing rows; the newer one loses -> refuse.
    _seed(engine, _pid(3), "landing", head_2)
    _seed(engine, _pid(4), "landing", head_2)
    # Head 3: a blocked-by-overlap loser is still cancellable — not named.
    _seed(engine, _pid(5), "awaiting-ci", head_3)
    _seed(engine, _pid(6), "blocked-by-overlap", head_3)

    proc = run_alembic(
        backend_root(), url, "upgrade", _REVISION_ID, expect_success=False
    )
    refusal = [ln for ln in proc.stderr.splitlines() if "livehead_01 refuses" in ln]
    assert refusal, proc.stderr
    assert str(_pid(1)) in refusal[0] and "speculative-ci" in refusal[0], refusal
    assert str(_pid(4)) in refusal[0] and "landing" in refusal[0], refusal
    assert str(_pid(6)) not in refusal[0], refusal

    statuses = [_proposal(engine, _pid(n))[0] for n in range(1, 7)]
    assert statuses == [
        "speculative-ci",
        "landing",
        "landing",
        "landing",
        "awaiting-ci",
        "blocked-by-overlap",
    ]
    assert not _objects_present(engine)["is_live_fn"]


def _run(engine: Engine, statements: list[str]) -> None:
    with engine.begin() as conn:
        for sql in statements:
            conn.execute(text(sql))


def _revision() -> ModuleType:
    return load_revision_module(_REVISION_PATH, "livehead_01_under_test")


def test_livehead_01_step_order_cleanup_before_backfill_is_load_bearing(
    db_at_parent: tuple[Engine, str],
) -> None:
    """The pre-vet order (backfill, then cleanup) cannot build the index."""
    engine, _url = db_at_parent
    rev = _revision()
    head_1 = [(_REPO, _BRANCH_1, _HEAD_1)]
    _seed(engine, _pid(1), "queued", head_1)
    _seed(engine, _pid(2), "queued", head_1)

    # The shipped order, pinned: lock, function, cleanup, column + backfill,
    # triggers, index.
    assert rev.UPGRADE_STEPS == (
        rev.LOCK_PARENT_SQL,
        rev.LOCK_CHILD_SQL,
        rev.IS_LIVE_FUNCTION_SQL,
        rev.CLEANUP_SQL,
        rev.ADD_COLUMN_SQL,
        rev.BACKFILL_SQL,
        rev.TRIGGERS_SQL,
        rev.INDEX_SQL,
    )

    # Old order: the backfill marks BOTH duplicates live, and with no trigger
    # yet the cleanup's cancel leaves the loser's stale `true` behind, so the
    # index build hits exactly the rows the cleanup existed to clear.
    old_order = [
        rev.IS_LIVE_FUNCTION_SQL,
        rev.ADD_COLUMN_SQL,
        rev.BACKFILL_SQL,
        rev.CLEANUP_SQL,
        rev.TRIGGERS_SQL,
        rev.INDEX_SQL,
    ]
    with pytest.raises(IntegrityError) as excinfo:
        _run(engine, old_order)
    assert getattr(excinfo.value.orig, "pgcode", None) == "23505"

    # The shipped order, same data: builds, one live row.
    _run(engine, list(rev.UPGRADE_STEPS))
    assert index_state(engine, _INDEX_NAME)[0]
    assert _child(engine, _pid(1))[0] is True
    assert _child(engine, _pid(2))[0] is False


def _own_lock_modes(conn: object, table: str) -> set[str]:
    rows = conn.execute(  # type: ignore[attr-defined]
        text(
            """
            SELECT mode FROM pg_locks
             WHERE locktype = 'relation' AND granted
               AND pid = pg_backend_pid()
               AND relation = CAST(:t AS regclass)
            """
        ),
        {"t": table},
    )
    return {str(r[0]) for r in rows}


def test_livehead_01_step_1_takes_every_table_lock_up_front(
    db_at_parent: tuple[Engine, str],
) -> None:
    """Parent SHARE ROW EXCLUSIVE, then child ACCESS EXCLUSIVE; ADD COLUMN adds none."""
    engine, _url = db_at_parent
    rev = _revision()
    with engine.begin() as conn:
        conn.execute(text(rev.LOCK_PARENT_SQL))
        conn.execute(text(rev.LOCK_CHILD_SQL))
        parent = _own_lock_modes(conn, "coord.merge_proposals")
        child = _own_lock_modes(conn, "coord.merge_proposal_repos")
        assert "ShareRowExclusiveLock" in parent, parent
        assert "AccessExclusiveLock" in child, child
        conn.execute(text(rev.ADD_COLUMN_SQL))
        assert _own_lock_modes(conn, "coord.merge_proposal_repos") == child, (
            "ADD COLUMN must not take a lock step 1 did not already hold"
        )
        conn.rollback()


def test_livehead_01_concurrent_cancel_and_coord_statement_shapes(
    db_at_parent: tuple[Engine, str],
) -> None:
    engine, url = db_at_parent
    run_alembic(backend_root(), url, "upgrade", _REVISION_ID)

    # A4: a parent with no child yet; connection A cancels it and holds the
    # transaction open; connection B inserts a child under it. The child
    # trigger's FOR SHARE makes B wait for A and read the COMMITTED status.
    # Without it B would read the pre-cancel `queued`, store `true`, and A's
    # trigger (which cannot see B's uncommitted child) would leave it stale.
    parent = _pid(1)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.merge_proposals (proposal_id, agent_id, status) "
                "VALUES (:p, :a, 'queued')"
            ),
            {"p": parent, "a": uuid.uuid4()},
        )
    errors: list[BaseException] = []

    conn_a = engine.connect()
    tx_a = conn_a.begin()
    conn_a.execute(
        text(
            "UPDATE coord.merge_proposals SET status = 'cancelled' "
            "WHERE proposal_id = :p"
        ),
        {"p": parent},
    )

    def insert_child() -> None:
        try:
            with engine.begin() as conn_b:
                conn_b.execute(text("SET LOCAL lock_timeout = '20s'"))
                conn_b.execute(
                    text(
                        "INSERT INTO coord.merge_proposal_repos "
                        "(proposal_id, repo, branch, head_sha) "
                        "VALUES (:p, :r, :b, :h)"
                    ),
                    {"p": parent, "r": _REPO, "b": _BRANCH_1, "h": _HEAD_1},
                )
        except BaseException as exc:  # surfaced on the main thread below
            errors.append(exc)

    worker = threading.Thread(target=insert_child)
    worker.start()
    worker.join(timeout=2)
    blocked = worker.is_alive()
    tx_a.commit()
    conn_a.close()
    worker.join(timeout=30)
    assert not worker.is_alive()
    assert not errors, errors
    assert blocked, "the child insert must wait for the in-flight parent cancel"
    assert _child(engine, parent)[0] is False, "stale `true` under a cancelled parent"

    # A3: coord's heal_missing_rebased_tip shape (merge_scheduler.rs) — ONE
    # WITH statement that updates the parent's status (here over the requeue
    # cap, so live -> terminal) and then the child, parent row first.
    healed = _pid(2)
    _seed(engine, healed, "dry-rebasing", [(_REPO, _BRANCH_2, _HEAD_2)])
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                WITH counted AS (
                    UPDATE coord.merge_proposals
                       SET requeue_count = requeue_count + 1,
                           status = 'conflict', updated_at = now()
                     WHERE proposal_id = :p
                       AND status IN ('dry-rebasing', 'awaiting-ci')
                     RETURNING requeue_count
                ), cleared AS (
                    UPDATE coord.merge_proposal_repos r
                       SET rebase_result = NULL
                      FROM counted c
                     WHERE r.proposal_id = :p
                )
                SELECT requeue_count FROM counted
                """
            ),
            {"p": healed},
        )
    assert _proposal(engine, healed)[0] == "conflict"
    assert _child(engine, healed)[0] is False
    # ...and its head is free.
    _seed(engine, _pid(3), "queued", [(_REPO, _BRANCH_2, _HEAD_2)])
    assert _child(engine, _pid(3))[0] is True
