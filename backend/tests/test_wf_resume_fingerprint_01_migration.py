"""Schema + contract test for the ``wf_resume_fingerprint_01`` revision.

Phase 3a of plan ``2026-08-20-workflow-resume-reexecutes-and-rebills`` adds a
nullable ``step_fingerprint TEXT`` to the runner's two durability journals,
``project.workflow_step_checkpoints`` and ``project.workflow_event_log``.

The DDL is two ``ALTER``\\ s. **Everything that makes it correct is a decision
recorded in prose**, and none of it is visible from a passing ``upgrade`` — the
revision landed (PR #1034, ``5c0f8e6b``) without a database ever being started,
and the CI gates it passed assert none of the four properties below.
``alembic-heads-pr`` counts heads; ``check_alembic_schema_args.py`` only checks
that the DDL names a schema; ``migration-reversal.yml`` walks
``upgrade head -> downgrade -1 -> upgrade head`` against an EMPTY database, so
it proves the SQL parses and nothing more — and it is ``paths:``-filtered to
``backend/alembic/versions/**``, so it never runs again once a later revision
lands on top (one already has: ``coord_obs_idx_01``). What is asserted here:

1. **Non-key.** ``step_fingerprint`` must NOT join
   ``workflow_step_checkpoints_uniq``. That constraint is the target of the
   runner's ``ON CONFLICT (execution_id, phase, iteration, step_index,
   stage_index) DO UPDATE`` upsert (``workflow_state.rs``). Adding the
   fingerprint to it silently converts that upsert into an **append log**: one
   row per edit per step, growing without bound on a hot journal, with no error
   anywhere. Asserted twice — structurally off ``pg_constraint``, and
   behaviourally by replaying the runner's own upsert with a changed
   fingerprint and requiring the row count to stay at one.

2. **NULL means MISS, never "matches anything".** Every row that predates the
   revision has no fingerprint, and the revision's whole purpose is that such a
   row is re-executed rather than served. The natural SQL instinct —
   ``step_fingerprint IS NULL OR step_fingerprint = $1`` — reads as a match and
   would serve exactly the stale results this column exists to prevent. Pinned
   as a differential: the correct predicate returns nothing for a
   NULL-fingerprint row, the tempting one returns it.

3. **Nullable ``text`` with no default, on BOTH tables.** Nullable because
   there is no honest value to backfill; no default because a defaulted
   fingerprint would match a lookup and resurrect (2). ``ADD COLUMN IF NOT
   EXISTS`` matches on NAME alone, so a re-run of ``upgrade()`` never repairs a
   column that regressed to ``NOT NULL DEFAULT ''`` — only an assertion does.
   Both tables, because they are two independent ``ALTER``\\ s: one passing is
   not evidence about the other.

4. **The ``COMMENT ON COLUMN`` carries the contract.** The revision
   deliberately puts the NULL-means-MISS rule in the database so an operator
   reading ``\\d+`` sees it without finding the revision file. A comment
   silently dropped is the contract silently dropped, and nothing else in this
   repo records it — the consumer lives in another repository entirely.

Also pinned: **no index on the column** (the revision's explicit
write-amplification decision on two hot append-heavy tables), and the full
``up -> down -> up`` walk with live rows in both journals, which is the only
thing that exercises ``downgrade()`` at all.

And, separately, **all four decisions again at ``head``**. Everything above
walks only as far as ``wf_resume_fingerprint_01``, so it pins what the revision
does IN ISOLATION — a different claim from the one the contract needs. What
deploys is ``alembic upgrade head``, and what the Phase 3b consumer reads is
that schema. A revision landing LATER that adds the column to
``workflow_step_checkpoints_uniq``, indexes it, defaults it, makes it
``NOT NULL`` or drops the ``COMMENT`` leaves every assertion above green. That
gap is what ``test_the_contract_still_holds_at_head`` closes.

⚠️ Cross-repo note: the CONSUMER of this column is qontinui-runner (Phase 3b,
``qontinui-runner#1094``). This repo has no reader — no model, route, service
or schema references either journal — so these assertions are the only place
the web side of the contract is checked at all.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. ⚠️ A skip proves nothing — point
it at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not
the one accepting the test credentials (on the MSI box the canonical Postgres
listens on **5433**, and it is the ``pgvector/pgvector:pg16`` image this chain
requires — a plain ``postgres:16`` cannot run it to head).

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips against 5432 —
which looks exactly like a green run in the summary line.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterator

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
# cannot silently change what this test walks — one already has
# (``coord_obs_idx_01`` names this revision as its parent).
# ``_PARENT_REVISION_ID`` MUST equal the revision's own ``down_revision``; the
# first test below enforces it, because coord re-points ``down_revision`` at
# land time and a stale pin rewinds too far, replaying unrelated
# non-idempotent revisions and surfacing as someone else's ``DuplicateTable``.
_REVISION_ID = "wf_resume_fingerprint_01"
_PARENT_REVISION_ID = "coord_prompt_docs_03_session_briefing_kind"
_REVISION_FILENAME = "wf_resume_fingerprint_01_step_fingerprint_columns.py"

_SCHEMA = "project"
_CHECKPOINTS = "workflow_step_checkpoints"
_EVENT_LOG = "workflow_event_log"
_JOURNALS = (_CHECKPOINTS, _EVENT_LOG)

_COLUMN = "step_fingerprint"

# The uniqueness key the runner's ON CONFLICT names, exactly as
# ``consolidation_phase1_04_workflows`` declares it. ``step_fingerprint`` must
# stay OUT of this tuple — see the module docstring, point 1.
_UNIQ_CONSTRAINT = "workflow_step_checkpoints_uniq"
_UNIQ_COLUMNS = (
    "execution_id",
    "phase",
    "iteration",
    "step_index",
    "stage_index",
)

# Two distinct digests standing in for "the prompt was edited between runs".
# Shaped like the hex digest the runner produces so a column narrowed to, say,
# ``VARCHAR(16)`` fails on the write rather than silently truncating into a
# collision — a truncated fingerprint that still compares equal is the one
# failure mode that would re-open the stale-replay defect while every
# ``information_schema`` assertion still passed.
_FINGERPRINT_V1 = "a" * 64
_FINGERPRINT_V2 = "b" * 64


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """``_PARENT_REVISION_ID`` names the revision's real parent."""
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


def test_the_revision_never_mutates_search_path() -> None:
    """No ``SET search_path`` — every statement is schema-qualified instead.

    Alembic runs the whole chain on ONE connection, so a ``SET search_path``
    here leaks into every later revision in the same session. This chain
    already contains revisions that do it (``consolidation_phase2_v_18``, which
    created ``workflow_event_log``), which is precisely why this one must not
    add another and must not depend on one: a later edit that stopped setting
    it would otherwise silently retarget these ``ALTER``\\ s at ``public``.
    """
    source = _revision_source()
    offenders = re.findall(r"(?i)\bSET\s+search_path\b", source)
    assert offenders == [], (
        f"{_REVISION_FILENAME} mutates search_path; alembic shares one "
        f"connection across the chain, so the setting leaks into later "
        f"revisions. Fully qualify the DDL with `{_SCHEMA}.` instead."
    )
    # The positive half: both journals are named schema-qualified.
    for table in _JOURNALS:
        assert f"{_SCHEMA}.{table}" in source, (
            f"{_REVISION_FILENAME} does not name {_SCHEMA}.{table} "
            f"schema-qualified; an unqualified ALTER depends on whatever "
            f"search_path an earlier revision happened to leave behind"
        )


# ---------------------------------------------------------------------------
# Live-schema helpers.
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str, str | None]]:
    """``{column: (data_type, is_nullable, column_default)}`` for ``project.<table>``."""
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = :schema AND table_name = :t
        """
    )
    with engine.connect() as conn:
        return {
            r[0]: (r[1], r[2], r[3])
            for r in conn.execute(sql, {"schema": _SCHEMA, "t": table}).fetchall()
        }


def _column_comment(engine: Engine, table: str) -> str | None:
    """The ``COMMENT ON COLUMN`` text for ``project.<table>.step_fingerprint``."""
    sql = text(
        """
        SELECT col_description(c.oid, a.attnum)
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = :schema AND c.relname = :t AND a.attname = :col
        """
    )
    with engine.connect() as conn:
        return conn.execute(
            sql, {"schema": _SCHEMA, "t": table, "col": _COLUMN}
        ).scalar()


def _uniq_constraint_columns(engine: Engine) -> tuple[str, ...]:
    """The columns of ``workflow_step_checkpoints_uniq``, in constraint order."""
    sql = text(
        """
        SELECT a.attname
          FROM pg_constraint con
          JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               ON true
          JOIN pg_attribute a
               ON a.attrelid = con.conrelid AND a.attnum = k.attnum
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = :schema AND con.conname = :name
         ORDER BY k.ord
        """
    )
    with engine.connect() as conn:
        return tuple(
            r[0]
            for r in conn.execute(
                sql, {"schema": _SCHEMA, "name": _UNIQ_CONSTRAINT}
            ).fetchall()
        )


def _indexes_mentioning_the_column(engine: Engine) -> list[str]:
    """Every ``project`` index whose definition references ``step_fingerprint``."""
    sql = text(
        """
        SELECT indexname
          FROM pg_indexes
         WHERE schemaname = :schema AND indexdef LIKE :pattern
         ORDER BY indexname
        """
    )
    with engine.connect() as conn:
        return [
            r[0]
            for r in conn.execute(
                sql, {"schema": _SCHEMA, "pattern": f"%{_COLUMN}%"}
            ).fetchall()
        ]


def _assert_column_present(engine: Engine) -> None:
    """Nullable ``text``, no default, on BOTH journals."""
    for table in _JOURNALS:
        cols = _columns(engine, table)
        assert _COLUMN in cols, (
            f"{_SCHEMA}.{table} does not carry {_COLUMN} after upgrade; the "
            f"two ALTERs are independent, so the other table passing says "
            f"nothing about this one"
        )
        data_type, nullable, default = cols[_COLUMN]
        assert data_type == "text", (
            f"{_SCHEMA}.{table}.{_COLUMN} is {data_type}, expected text; a "
            f"narrowed type truncates a hex digest into a collision, which "
            f"compares EQUAL and re-opens the stale-replay defect"
        )
        assert nullable == "YES", (
            f"{_SCHEMA}.{table}.{_COLUMN} is NOT NULL. Rows that predate this "
            f"revision have no honest fingerprint to backfill, and NOT NULL "
            f"would force one to be invented — an invented digest that matches "
            f"a lookup serves exactly the stale result this column prevents"
        )
        assert default is None, (
            f"{_SCHEMA}.{table}.{_COLUMN} has DEFAULT {default!r}. A defaulted "
            f"fingerprint is indistinguishable from a computed one and would "
            f"match an equality lookup; it also turns a catalog-only ADD "
            f"COLUMN into a table rewrite on a hot journal"
        )


def _assert_column_absent(engine: Engine) -> None:
    """No residue on either journal after downgrade."""
    for table in _JOURNALS:
        assert _COLUMN not in _columns(engine, table), (
            f"{_SCHEMA}.{table} still carries {_COLUMN} after downgrade(); "
            f"downgrade must be the exact inverse of upgrade on BOTH tables"
        )


def _seed_task_run(engine: Engine, execution_id: str) -> None:
    """The ``task_runs`` parent both journals' FKs cascade from."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project.task_runs (id, task_name)
                VALUES (:id, 'wf_resume_fingerprint_01 test run')
                """
            ),
            {"id": execution_id},
        )


def _seed_checkpoint(
    engine: Engine, execution_id: str, *, fingerprint: str | None
) -> None:
    """One checkpoint row, written the way the runner's upsert writes it."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project.workflow_step_checkpoints
                    (id, execution_id, workflow_type, phase, iteration,
                     step_index, step_type, status, result_json, stage_index,
                     step_fingerprint)
                VALUES (:id, :exec, 'unified', 'main', 1,
                        3, 'prompt', 'completed', '{"answer":"cached"}', 0,
                        :fp)
                """
            ),
            {"id": str(uuid.uuid4()), "exec": execution_id, "fp": fingerprint},
        )


def _upsert_checkpoint(engine: Engine, execution_id: str, fingerprint: str) -> None:
    """The runner's own ``ON CONFLICT`` upsert, replayed with a new fingerprint.

    The conflict target is spelled out as the five-column tuple exactly as
    ``workflow_state.rs`` spells it. If ``step_fingerprint`` ever joined
    ``workflow_step_checkpoints_uniq`` this statement would stop matching the
    existing row and INSERT a second one instead of updating — silently, with
    no error to notice.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project.workflow_step_checkpoints
                    (id, execution_id, workflow_type, phase, iteration,
                     step_index, step_type, status, result_json, stage_index,
                     step_fingerprint)
                VALUES (:id, :exec, 'unified', 'main', 1,
                        3, 'prompt', 'completed', '{"answer":"recomputed"}', 0,
                        :fp)
                ON CONFLICT (execution_id, phase, iteration, step_index,
                             stage_index)
                DO UPDATE SET result_json = EXCLUDED.result_json,
                              step_fingerprint = EXCLUDED.step_fingerprint
                """
            ),
            {"id": str(uuid.uuid4()), "exec": execution_id, "fp": fingerprint},
        )


def _seed_event(engine: Engine, execution_id: str, *, fingerprint: str | None) -> None:
    """One DAG event-log row, keyed the way ``event_log.rs`` keys it."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO project.workflow_event_log
                    (execution_id, node_id, event_type, event_data, cursor,
                     step_fingerprint)
                VALUES (:exec, 'node-7', 'node_completed',
                        '{"answer":"cached"}', 1, :fp)
                """
            ),
            {"exec": execution_id, "fp": fingerprint},
        )


def _checkpoint_rows(engine: Engine, execution_id: str) -> list[tuple]:
    """The identity + payload columns that predate this revision.

    Deliberately excludes ``step_fingerprint``: it does not exist after
    downgrade, and the point of this read is that everything which predates the
    revision survives the walk untouched.
    """
    with engine.connect() as conn:
        return [
            tuple(r)
            for r in conn.execute(
                text(
                    """
                    SELECT phase, iteration, step_index, stage_index,
                           step_type, status, result_json
                      FROM project.workflow_step_checkpoints
                     WHERE execution_id = :exec
                     ORDER BY step_index
                    """
                ),
                {"exec": execution_id},
            ).fetchall()
        ]


def _event_rows(engine: Engine, execution_id: str) -> list[tuple]:
    """The DAG event-log columns that predate this revision."""
    with engine.connect() as conn:
        return [
            tuple(r)
            for r in conn.execute(
                text(
                    """
                    SELECT node_id, event_type, event_data, cursor
                      FROM project.workflow_event_log
                     WHERE execution_id = :exec
                     ORDER BY cursor
                    """
                ),
                {"exec": execution_id},
            ).fetchall()
        ]


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


@pytest.fixture(scope="module")
def _upgraded(_admin_url: str) -> Iterator[Engine]:
    """One ephemeral database walked to ``wf_resume_fingerprint_01``, shared.

    Module-scoped on purpose. Replaying the chain costs real wall-clock — this
    repo is past 500 revisions, and ``migration-reversal.yml``'s own measured
    numbers (p50 3.0 min, max 7.7 min for a single up→down→up) are the honest
    scale — so every test that only needs the post-upgrade schema shares ONE
    walk instead of paying for its own. The tests below are safe to share it:
    each seeds under its own ``execution_id`` and none mutates the schema. The
    one test that DOES mutate the schema (the down → up walk) takes a database
    of its own.
    """
    with ephemeral_database(_admin_url, "wf_fingerprint_01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


@pytest.fixture(scope="module")
def _at_head(_admin_url: str) -> Iterator[Engine]:
    """One ephemeral database walked all the way to ``head``.

    Every other walk in this module stops AT ``wf_resume_fingerprint_01``,
    which pins what the revision does **in isolation**. That is a different
    claim from the one the contract actually needs: the four decisions are
    load-bearing at the version that DEPLOYS. ``alembic upgrade head`` is what
    ``migrate.yml`` runs, and head is the schema the Phase 3b consumer in
    qontinui-runner reads against.

    Nothing today asserts the gap between the two. A LATER revision that adds
    ``step_fingerprint`` to ``workflow_step_checkpoints_uniq``, indexes it,
    gives it a ``DEFAULT`` or a ``NOT NULL``, or drops the ``COMMENT`` leaves
    every test above green, because none of them walks past its own revision —
    and nothing else in the repo would notice either: a sweep finds the column
    in that revision and this module and nowhere else, and the consumer is in
    another repository. The four ``ALTER``-time assertions would still pass
    while production had already regressed.

    This costs a THIRD chain replay, which ``_upgraded`` otherwise works hard
    to avoid. It is the only assertion here made against the schema production
    actually gets, so it is the replay least worth economising on.
    """
    with ephemeral_database(_admin_url, "wf_fingerprint_01_head") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", "head")
        yield engine


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def test_the_column_is_non_key_so_the_runners_upsert_stays_an_upsert(
    _upgraded: Engine,
) -> None:
    """The whole design decision, asserted structurally and behaviourally.

    Structurally: ``workflow_step_checkpoints_uniq`` still names exactly the
    five positional columns. Behaviourally: replaying the runner's
    ``ON CONFLICT`` upsert with a DIFFERENT fingerprint updates the one row
    rather than appending a second.

    Both, because they fail differently. A fingerprint added to the constraint
    is caught structurally; a *second* unique index created over the six
    columns (leaving the original constraint intact) is not — only the row
    count catches that. Either one turns a bounded checkpoint table into an
    unbounded append log on a hot write path, with no error anywhere.
    """
    engine = _upgraded
    execution_id = f"exec-{uuid.uuid4().hex[:12]}"

    _assert_column_present(engine)
    assert _uniq_constraint_columns(engine) == _UNIQ_COLUMNS, (
        f"{_UNIQ_CONSTRAINT} is {_uniq_constraint_columns(engine)}, "
        f"expected {_UNIQ_COLUMNS}. {_COLUMN} must stay OUT of the "
        f"uniqueness key: inside it, the runner's ON CONFLICT upsert "
        f"becomes an append log — one row per edit per step, unbounded, "
        f"on a hot journal"
    )

    _seed_task_run(engine, execution_id)
    _seed_checkpoint(engine, execution_id, fingerprint=_FINGERPRINT_V1)
    _upsert_checkpoint(engine, execution_id, _FINGERPRINT_V2)

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT step_fingerprint, result_json
                  FROM project.workflow_step_checkpoints
                 WHERE execution_id = :exec
                """
            ),
            {"exec": execution_id},
        ).fetchall()

    assert len(rows) == 1, (
        f"the upsert appended instead of updating — {len(rows)} rows for "
        f"one (execution_id, phase, iteration, step_index, stage_index). "
        f"{_COLUMN} has joined the uniqueness key somewhere"
    )
    assert rows[0][0] == _FINGERPRINT_V2, (
        "the fingerprint did not round-trip the upsert; a 64-char hex "
        "digest must survive a write and a read unchanged"
    )
    assert rows[0][1] == '{"answer":"recomputed"}', (
        "the cached result was not overwritten — a miss that does not "
        "replace the stale row leaves it to be served again next resume"
    )


def test_a_null_fingerprint_is_a_miss_and_never_matches_a_lookup(
    _upgraded: Engine,
) -> None:
    """The consumer contract, pinned as a differential against the SQL trap.

    Two runs: one whose rows were written before the revision existed (NULL
    fingerprint) and one written after (``_FINGERPRINT_V1``). The correct
    predicate — ``step_fingerprint = $1`` — must find only the second. The
    tempting one — ``step_fingerprint IS NULL OR step_fingerprint = $1`` —
    finds both, which is the stale-replay defect this whole revision exists to
    close, so the test asserts that difference explicitly rather than merely
    asserting the correct form works.

    Asserted on BOTH journals: the DAG replay path and the unified resume path
    read different tables and are written by different code.
    """
    engine = _upgraded
    exec_pre = f"exec-{uuid.uuid4().hex[:12]}"
    exec_post = f"exec-{uuid.uuid4().hex[:12]}"

    for ex, fp in ((exec_pre, None), (exec_post, _FINGERPRINT_V1)):
        _seed_task_run(engine, ex)
        _seed_checkpoint(engine, ex, fingerprint=fp)
        _seed_event(engine, ex, fingerprint=fp)

    # Scoped to this test's own two execution ids: the database is shared with
    # the sibling tests, which seed rows of their own under different ids.
    seeded = (exec_pre, exec_post)

    for table in _JOURNALS:
        with engine.connect() as conn:
            strict = {
                r[0]
                for r in conn.execute(
                    text(
                        f"""
                        SELECT execution_id FROM {_SCHEMA}.{table}
                         WHERE execution_id = ANY(:seeded)
                           AND step_fingerprint = :fp
                        """  # f-string: both names are module constants
                    ),
                    {"seeded": list(seeded), "fp": _FINGERPRINT_V1},
                ).fetchall()
            }
            tempting = {
                r[0]
                for r in conn.execute(
                    text(
                        f"""
                        SELECT execution_id FROM {_SCHEMA}.{table}
                         WHERE execution_id = ANY(:seeded)
                           AND (step_fingerprint IS NULL
                                OR step_fingerprint = :fp)
                        """  # f-string: both names are module constants
                    ),
                    {"seeded": list(seeded), "fp": _FINGERPRINT_V1},
                ).fetchall()
            }

        assert strict == {exec_post}, (
            f"in {_SCHEMA}.{table}, `step_fingerprint = $1` matched "
            f"{sorted(strict)}; a row with NO fingerprint is a MISS and "
            f"must be re-executed, never served"
        )
        assert tempting == {exec_pre, exec_post}, (
            f"in {_SCHEMA}.{table}, the `IS NULL OR =` predicate did not "
            f"match the pre-revision row — this assertion exists to keep "
            f"the difference between the two forms visible, so if it fails "
            f"the seed is wrong, not the schema"
        )
        assert strict != tempting, (
            f"in {_SCHEMA}.{table}, the correct and the tempting predicate "
            f"return the same rows, so nothing here pins the contract. "
            f"NULL must be a MISS, not a wildcard."
        )

        # A mismatching fingerprint is a miss too — the other half of the
        # contract, and the case a prompt edit actually produces.
        with engine.connect() as conn:
            matched = conn.execute(
                text(
                    f"""
                    SELECT count(*) FROM {_SCHEMA}.{table}
                     WHERE execution_id = ANY(:seeded)
                       AND step_fingerprint = :fp
                    """  # f-string: both names are module constants
                ),
                {"seeded": list(seeded), "fp": _FINGERPRINT_V2},
            ).scalar()
        assert matched == 0, (
            f"a changed fingerprint matched {matched} row(s) in "
            f"{_SCHEMA}.{table}; an edited prompt must miss, not replay"
        )


def test_the_null_means_miss_contract_is_recorded_on_both_columns(
    _upgraded: Engine,
) -> None:
    """``COMMENT ON COLUMN`` carries the contract into the database itself.

    This is not decoration. The consumer lives in **another repository**
    (qontinui-runner), this repo has no reader at all, and the rule is
    counter-intuitive enough that the revision's own docstring spends a
    paragraph on it. The comment is what an operator sees from ``\\d+``, and it
    is the only machine-readable trace of the contract on the web side.
    """
    engine = _upgraded

    for table in _JOURNALS:
        comment = _column_comment(engine, table)
        assert comment, (
            f"{_SCHEMA}.{table}.{_COLUMN} has no COMMENT. The NULL-means-"
            f"MISS rule is recorded nowhere else in this repo — the "
            f"consumer is in qontinui-runner"
        )
        lowered = comment.lower()
        assert "null" in lowered and "miss" in lowered, (
            f"{_SCHEMA}.{table}.{_COLUMN}'s COMMENT no longer states the "
            f"NULL-means-MISS rule: {comment!r}"
        )
        assert "hash" in lowered or "content" in lowered, (
            f"{_SCHEMA}.{table}.{_COLUMN}'s COMMENT no longer says what "
            f"the value IS: {comment!r}"
        )

    # The checkpoints comment additionally records the non-key decision, which
    # is the property the first test enforces. Keeping the two in the same
    # place means an operator about to change the constraint sees the rule
    # that forbids it.
    checkpoints_comment = (_column_comment(engine, _CHECKPOINTS) or "").lower()
    assert "non-key" in checkpoints_comment, (
        f"{_SCHEMA}.{_CHECKPOINTS}.{_COLUMN}'s COMMENT no longer records "
        f"that the column is NON-KEY — the one decision that keeps the "
        f"runner's ON CONFLICT an upsert rather than an append log"
    )


def test_no_index_is_created_on_the_fingerprint(_upgraded: Engine) -> None:
    """The deliberate no-index decision, made checkable.

    The access pattern is locate-by-existing-key then compare, so the check
    lands on an already-located row — a comparison, not a search. Both journals
    are hot and append-heavy, so a b-tree here is write amplification for zero
    read benefit. A reflexive ``CREATE INDEX`` added later "because the column
    is queried" would be a real regression on the write path, and nothing else
    would notice.

    The pre-existing lookup indexes are asserted present alongside, because
    they are what makes the no-index decision defensible: remove them and the
    reasoning stops holding.
    """
    engine = _upgraded

    offenders = _indexes_mentioning_the_column(engine)
    assert offenders == [], (
        f"index(es) {offenders} reference {_COLUMN}. The revision "
        f"deliberately creates none: the fingerprint is compared on a row "
        f"already located by the existing key, and a hex digest has no "
        f"standalone selectivity. Adding one buys write amplification on "
        f"two hot append-heavy journals for no read benefit."
    )

    with engine.connect() as conn:
        existing = {
            r[0]
            for r in conn.execute(
                text("SELECT indexname FROM pg_indexes WHERE schemaname = :s"),
                {"s": _SCHEMA},
            ).fetchall()
        }
    for idx in ("idx_wsc_lookup", "idx_event_log_node"):
        assert idx in existing, (
            f"{idx} is gone. It is what locates the row the fingerprint is "
            f"compared on; without it the 'no index needed' reasoning no "
            f"longer holds"
        )


def test_up_down_up_leaves_no_residue_and_upgrade_is_idempotent(
    _admin_url: str,
) -> None:
    """The full walk — the only thing that exercises ``downgrade()`` at all.

    Takes a database of its own rather than the shared ``_upgraded`` one:
    it is the single test here that mutates the schema.

    Live rows in BOTH journals are seeded first, because ``downgrade()`` drops
    a column from each and an over-broad drop (or a ``DROP TABLE`` typo) would
    otherwise be invisible until a resume found an empty journal. The tables
    themselves must survive: they belong to
    ``consolidation_phase1_04_workflows`` and
    ``consolidation_phase2_v_18_workflow_event_log``, not to this revision.

    The idempotency check rides along at the end, on the same database, for
    the same reason the other tests share one: a second chain replay would
    cost minutes to prove one property. ``ADD COLUMN IF NOT EXISTS`` guards
    are per-clause, and the re-run replays both ``COMMENT ON COLUMN``
    statements too — a revision that cannot be re-applied is a revision that
    cannot be recovered from a partially-applied deploy.
    """
    execution_id = f"exec-{uuid.uuid4().hex[:12]}"
    with ephemeral_database(_admin_url, "wf_fingerprint_01_roundtrip") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_present(engine)

        _seed_task_run(engine, execution_id)
        _seed_checkpoint(engine, execution_id, fingerprint=_FINGERPRINT_V1)
        _seed_event(engine, execution_id, fingerprint=_FINGERPRINT_V1)
        before_checkpoints = _checkpoint_rows(engine, execution_id)
        before_events = _event_rows(engine, execution_id)
        assert before_checkpoints and before_events, "the seed wrote nothing"

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_column_absent(engine)
        for table in _JOURNALS:
            assert table_exists(engine, _SCHEMA, table), (
                f"downgrade() dropped {_SCHEMA}.{table}; it owns ONE COLUMN "
                f"there, not the table"
            )
        assert _checkpoint_rows(engine, execution_id) == before_checkpoints, (
            "downgrade() disturbed live checkpoint rows; it must drop a "
            "column, not data"
        )
        assert _event_rows(engine, execution_id) == before_events, (
            "downgrade() disturbed live event-log rows"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_present(engine)
        assert _checkpoint_rows(engine, execution_id) == before_checkpoints
        assert _event_rows(engine, execution_id) == before_events

        # The re-added column is NULL for rows that predate it — the honest
        # record, and by contract a MISS, which re-executes. That is the safe
        # direction, and it is why the lossy downgrade is acceptable.
        for table in _JOURNALS:
            with engine.connect() as conn:
                resurrected = conn.execute(
                    text(
                        f"""
                        SELECT count(*) FROM {_SCHEMA}.{table}
                         WHERE execution_id = :exec
                           AND step_fingerprint IS NOT NULL
                        """  # f-string: both names are module constants
                    ),
                    {"exec": execution_id},
                ).scalar()
            assert resurrected == 0, (
                f"{resurrected} row(s) in {_SCHEMA}.{table} came back from "
                f"downgrade carrying a fingerprint; the value is not "
                f"recoverable and must not be invented"
            )

        # Idempotency: rewind alembic's bookkeeping WITHOUT touching the
        # schema, then re-run upgrade() over a database that already has both
        # columns. The IF NOT EXISTS guards and the COMMENT statements must
        # all be re-issuable.
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_column_present(engine)
        assert _uniq_constraint_columns(engine) == _UNIQ_COLUMNS
        for table in _JOURNALS:
            assert _column_comment(engine, table), (
                f"{_SCHEMA}.{table}.{_COLUMN} lost its COMMENT on the re-run"
            )
        assert _checkpoint_rows(engine, execution_id) == before_checkpoints, (
            "re-running upgrade() disturbed live checkpoint rows"
        )
        assert _event_rows(engine, execution_id) == before_events, (
            "re-running upgrade() disturbed live event-log rows"
        )


def test_the_contract_still_holds_at_head(_at_head: Engine) -> None:
    """All four decisions, re-asserted against the schema that DEPLOYS.

    The tests above pin ``wf_resume_fingerprint_01``'s own effect. This one
    pins the property the consumer depends on — that the effect **survives to
    head**. They are not the same assertion, and only this one is checked
    against what ``migrate.yml`` produces and what qontinui-runner's Phase 3b
    reader will meet in production.

    Deliberately re-asserted here rather than factored into a helper shared
    with the ``_upgraded`` tests: this test must keep passing (or start
    failing) for reasons of its own, and a shared helper would let a future
    edit weaken both sites at once. The duplication is the point.

    A failure here and a pass above localises the regression precisely: the
    revision is still correct, and something that landed AFTER it changed the
    column out from under the contract.
    """
    engine = _at_head
    execution_id = f"exec-{uuid.uuid4().hex[:12]}"
    exec_null = f"exec-{uuid.uuid4().hex[:12]}"

    # Decision 3 — nullable text, no default, on both journals.
    _assert_column_present(engine)

    # Decision 1, structurally — the uniqueness key is still the five
    # positional columns.
    assert _uniq_constraint_columns(engine) == _UNIQ_COLUMNS, (
        f"at head, {_UNIQ_CONSTRAINT} is {_uniq_constraint_columns(engine)}, "
        f"expected {_UNIQ_COLUMNS}. A revision after "
        f"{_REVISION_ID} put {_COLUMN} into the uniqueness key: the runner's "
        f"ON CONFLICT upsert is an append log in production, one row per edit "
        f"per step, unbounded, with no error anywhere"
    )

    # Decision 1, behaviourally — the runner's own upsert still updates rather
    # than appending. Catches a SECOND unique index over the six columns, which
    # leaves the original constraint intact and so passes the check above.
    _seed_task_run(engine, execution_id)
    _seed_checkpoint(engine, execution_id, fingerprint=_FINGERPRINT_V1)
    _upsert_checkpoint(engine, execution_id, _FINGERPRINT_V2)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT step_fingerprint
                  FROM project.workflow_step_checkpoints
                 WHERE execution_id = :exec
                """
            ),
            {"exec": execution_id},
        ).fetchall()
    assert len(rows) == 1, (
        f"at head the upsert appended instead of updating — {len(rows)} rows "
        f"for one (execution_id, phase, iteration, step_index, stage_index)"
    )
    assert rows[0][0] == _FINGERPRINT_V2, (
        "at head a 64-char hex digest did not survive the upsert unchanged; a "
        "narrowed or truncated column compares EQUAL and re-opens the "
        "stale-replay defect"
    )

    # Decision 2 — NULL is still a MISS on both journals. Asserted
    # behaviourally, not merely from the nullability above: this is the one
    # property the consumer's correctness rests on directly.
    _seed_task_run(engine, exec_null)
    _seed_checkpoint(engine, exec_null, fingerprint=None)
    _seed_event(engine, exec_null, fingerprint=None)
    for table in _JOURNALS:
        with engine.connect() as conn:
            matched = conn.execute(
                text(
                    f"""
                    SELECT count(*) FROM {_SCHEMA}.{table}
                     WHERE execution_id = :exec
                       AND step_fingerprint = :fp
                    """  # f-string: both names are module constants
                ),
                {"exec": exec_null, "fp": _FINGERPRINT_V1},
            ).scalar()
        assert matched == 0, (
            f"at head, `step_fingerprint = $1` matched {matched} row(s) in "
            f"{_SCHEMA}.{table} that carry NO fingerprint. A row without one "
            f"is a MISS and must be re-executed, never served"
        )

    # Decision 4 — still no index on the column, and the lookup indexes that
    # make that decision defensible are still there.
    offenders = _indexes_mentioning_the_column(engine)
    assert offenders == [], (
        f"at head, index(es) {offenders} reference {_COLUMN}. The revision "
        f"creates none deliberately; one added later is write amplification "
        f"on two hot append-heavy journals for zero read benefit"
    )
    with engine.connect() as conn:
        existing = {
            r[0]
            for r in conn.execute(
                text("SELECT indexname FROM pg_indexes WHERE schemaname = :s"),
                {"s": _SCHEMA},
            ).fetchall()
        }
    for idx in ("idx_wsc_lookup", "idx_event_log_node"):
        assert idx in existing, (
            f"{idx} is gone at head. It is what locates the row the "
            f"fingerprint is compared on; without it the 'no index needed' "
            f"reasoning no longer holds"
        )

    # The ``COMMENT`` still carries the contract at head — it is the only
    # machine-readable trace of it on the web side.
    for table in _JOURNALS:
        comment = (_column_comment(engine, table) or "").lower()
        assert "null" in comment and "miss" in comment, (
            f"at head, {_SCHEMA}.{table}.{_COLUMN}'s COMMENT no longer states "
            f"the NULL-means-MISS rule: {comment!r}"
        )
    assert "non-key" in (_column_comment(engine, _CHECKPOINTS) or "").lower(), (
        f"at head, {_SCHEMA}.{_CHECKPOINTS}.{_COLUMN}'s COMMENT no longer "
        f"records that the column is NON-KEY"
    )
