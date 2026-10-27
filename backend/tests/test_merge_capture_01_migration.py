"""Schema-contract and round-trip test for alembic ``merge_capture_01`` — slice B
of Phase 1 (schema half) of plan
``2026-10-19-the-merge-theory-has-no-data-to-test-it-against``.

``coord.merge_candidates`` (one row per candidate attempt),
``coord.merge_candidate_members`` (one row per member, with its red
attribution), ``coord.merge_verdict_heads`` (one row per evaluated head) and
``coord.merge_lane_hourly`` (the per-repo hourly rollup), plus the
``coord.ci_job_observations.steps`` column, are a contract with coord's
``merge_lane_capture`` writers: the columns, the CHECK vocabularies, the
conflict targets the writers' ``ON CONFLICT`` clauses name, and the indexes
their reads and retention sweeps lean on. Each is pinned EXACTLY against the
live catalog, so a widened vocabulary, a renamed constraint or a dropped index
fails here rather than as a coord write error.

What is pinned:

1. The revision is wired to one real parent, drops nothing on upgrade, and
   every statement it runs is ``coord.``-qualified. ``downgrade`` runs exactly
   the expected statements, its lock bound first.
2. Every column (type, nullability), every column DEFAULT (the complete map,
   ``None`` for a column with none — a default that invents a value, such as
   ``0`` on a rolled-up measure or ``'[]'`` on ``steps``, would render UNKNOWN
   as a fact), every constraint (``pg_get_constraintdef``) and every index
   (``pg_indexes.indexdef``). The ``steps`` comment equals the one the source
   emits.
3. The constraints bite: an unknown vocabulary word, an outcome without its
   time, a land field without its partner, a base sha without its basis, a
   decisive verdict without its time, a push or supersession without its
   basis, a stale count above the evaluation count, a recent-evaluation ring
   that is empty or too long, follower evaluations or distinct heads above the
   total, and an hour that is not a whole UTC hour are all refused. The
   writers' inserts are idempotent on their conflict targets, and two cuts
   that share a tip are two rows.
4. ``downgrade`` removes the four tables, their indexes and the ``steps``
   column and leaves ``coord.ci_job_observations`` exactly as it found it;
   ``upgrade`` re-applies.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, migrated by the real alembic chain. Without a reachable Postgres the
DB-backed test skips and the source-level ones still run.
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.elements import TextClause

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "merge_capture_01"
_REVISION_FILENAME = "merge_capture_01_candidates_verdict_heads_lane_hourly.py"
_CANDIDATES = "merge_candidates"
_MEMBERS = "merge_candidate_members"
_HEADS = "merge_verdict_heads"
_HOURLY = "merge_lane_hourly"
_TABLES = (_CANDIDATES, _MEMBERS, _HEADS, _HOURLY)
_JOBS = "ci_job_observations"

_KINDS = (
    "singleton",
    "batch",
    "speculative",
    "bisect_child",
    "ci_skip",
    "ff_reuse",
    "ac_cache",
    "expedited",
    "unknown",
    "ctl_landing",
    "ctl_cert",
    "ctl_hedge",
)
_BASE_BASES = (
    "rebase_result",
    "speculative_chain",
    "land_parent",
    "scheduler_tick",
    "expedited_request",
)
_OUTCOMES = (
    "landed",
    "red",
    "cancelled",
    "superseded",
    "voided",
    "abandoned",
    "unknown",
)
_RECUT_CAUSES = ("base_moved", "land_seam_deferral", "precondition_deferral", "unknown")
_RUN_CLASSES = ("content", "flake", "infra", "red_unclassified")
_SOURCES = ("observed", "backfill")
_MEMBER_OUTCOMES = (
    "passed",
    "red_alone",
    "red_against_main",
    "interaction",
    "flake",
    "infra",
    "cancelled",
    "unknown",
)
_HEAD_OUTCOMES = ("landed", "closed", "superseded")
_PUSHED_BASES = ("pull_request_webhook", "check_run", "first_evaluation")
_SUPERSEDED_BASES = (*_PUSHED_BASES, "pr_merged")

_TZ = "timestamp with time zone"

# (information_schema data_type, is_nullable) per column.
_EXPECTED_CANDIDATE_COLUMNS: dict[str, tuple[str, str]] = {
    "candidate_id": ("uuid", "NO"),
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "candidate_key": ("text", "NO"),
    "kind": ("text", "NO"),
    "candidate_ref": ("text", "YES"),
    "ledger_id": ("bigint", "YES"),
    "proposal_id": ("uuid", "YES"),
    "batch_id": ("uuid", "YES"),
    "base_sha": ("text", "YES"),
    "base_basis": ("text", "YES"),
    "tip_sha": ("text", "NO"),
    "retry_of": ("uuid", "YES"),
    "parent_candidate_id": ("uuid", "YES"),
    "chain_position": ("integer", "YES"),
    "cut_at": (_TZ, "NO"),
    "pushed_at": (_TZ, "YES"),
    "ci_first_job_at": (_TZ, "YES"),
    "ci_concluded_at": (_TZ, "YES"),
    "ci_red_at": (_TZ, "YES"),
    "ci_attempts": ("integer", "YES"),
    "outcome": ("text", "YES"),
    "outcome_at": (_TZ, "YES"),
    "recut_cause": ("text", "YES"),
    "run_class": ("text", "YES"),
    "land_sha": ("text", "YES"),
    "landed_at": (_TZ, "YES"),
    "land_route": ("text", "YES"),
    "source": ("text", "NO"),
    "evidence": ("jsonb", "NO"),
    "created_at": (_TZ, "NO"),
    "updated_at": (_TZ, "NO"),
}

_EXPECTED_MEMBER_COLUMNS: dict[str, tuple[str, str]] = {
    "candidate_id": ("uuid", "NO"),
    "member_position": ("integer", "NO"),
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "cut_at": (_TZ, "NO"),
    "proposal_id": ("uuid", "YES"),
    "pr_number": ("integer", "YES"),
    "head_sha": ("text", "YES"),
    "member_outcome": ("text", "YES"),
    "attribution_basis": ("text", "YES"),
    "attribution_ref": ("jsonb", "YES"),
    "lands_between": ("integer", "YES"),
    "created_at": (_TZ, "NO"),
    "updated_at": (_TZ, "NO"),
}

_EXPECTED_HEAD_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "pr_number": ("integer", "NO"),
    "head_sha": ("text", "NO"),
    "pushed_at": (_TZ, "YES"),
    "pushed_basis": ("text", "YES"),
    "first_eval_at": (_TZ, "NO"),
    "last_eval_at": (_TZ, "NO"),
    "eval_count": ("integer", "NO"),
    "follower_eval_count": ("integer", "NO"),
    "recent_eval_at": ("ARRAY", "NO"),
    "first_verdict": ("text", "NO"),
    "first_disposition": ("text", "YES"),
    "first_decisive_verdict": ("text", "YES"),
    "first_decisive_disposition": ("text", "YES"),
    "first_decisive_at": (_TZ, "YES"),
    "last_verdict": ("text", "NO"),
    "last_disposition": ("text", "YES"),
    "superseded_at": (_TZ, "YES"),
    "superseded_basis": ("text", "YES"),
    "stale_eval_count": ("integer", "YES"),
    "outcome": ("text", "YES"),
    "outcome_at": (_TZ, "YES"),
    "updated_at": (_TZ, "NO"),
}

_EXPECTED_HOURLY_COLUMNS: dict[str, tuple[str, str]] = {
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "hour": (_TZ, "NO"),
    "evaluations": ("integer", "NO"),
    "follower_evaluations": ("integer", "NO"),
    "decisive_evaluations": ("integer", "NO"),
    "distinct_heads": ("integer", "NO"),
    "queue_depth_sample_sum": ("bigint", "NO"),
    "queue_depth_samples": ("integer", "NO"),
    "reeval_seated": ("jsonb", "YES"),
    "reeval_deferred": ("jsonb", "YES"),
    "stale_evaluations": ("integer", "YES"),
    "heads_first_decisive": ("integer", "YES"),
    "decisive_latency_secs": ("jsonb", "YES"),
    "verdict_age_secs": ("jsonb", "YES"),
    "decision_code_seconds": ("jsonb", "YES"),
    "dominant_decision_code": ("text", "YES"),
    "admissions": ("integer", "YES"),
    "candidates_cut": ("integer", "YES"),
    "candidates_landed": ("integer", "YES"),
    "candidates_red": ("integer", "YES"),
    "session_hours": ("double precision", "YES"),
    "lane_state_seconds": ("jsonb", "YES"),
    "unknown_reasons": ("jsonb", "NO"),
    "rolled_up_at": (_TZ, "YES"),
    "updated_at": (_TZ, "NO"),
}

# The COMPLETE default map per table: every column, None where it has none. A
# default the writers do not rely on is a value nobody observed.
_NOW = "now()"
_EXPECTED_DEFAULTS: dict[str, dict[str, str | None]] = {
    _CANDIDATES: {
        **dict.fromkeys(_EXPECTED_CANDIDATE_COLUMNS),
        "candidate_id": "gen_random_uuid()",
        "source": "'observed'::text",
        "evidence": "'{}'::jsonb",
        "created_at": _NOW,
        "updated_at": _NOW,
    },
    _MEMBERS: {
        **dict.fromkeys(_EXPECTED_MEMBER_COLUMNS),
        "created_at": _NOW,
        "updated_at": _NOW,
    },
    _HEADS: {
        **dict.fromkeys(_EXPECTED_HEAD_COLUMNS),
        "updated_at": _NOW,
    },
    _HOURLY: {
        **dict.fromkeys(_EXPECTED_HOURLY_COLUMNS),
        # Live counters only: they start at zero because they count events.
        "evaluations": "0",
        "follower_evaluations": "0",
        "decisive_evaluations": "0",
        "distinct_heads": "0",
        "queue_depth_sample_sum": "0",
        "queue_depth_samples": "0",
        "unknown_reasons": "'{}'::jsonb",
        "updated_at": _NOW,
    },
}


def _text_array(values: tuple[str, ...]) -> str:
    """How ``pg_get_constraintdef`` renders an ``IN (...)`` list."""
    return "ARRAY[" + ", ".join(f"'{value}'::text" for value in values) + "]"


def _in_check(column: str, values: tuple[str, ...]) -> str:
    return f"CHECK (({column} = ANY ({_text_array(values)})))"


def _nullable_in_check(column: str, values: tuple[str, ...]) -> str:
    return f"CHECK ((({column} IS NULL) OR ({column} = ANY ({_text_array(values)}))))"


_EXPECTED_CANDIDATE_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "merge_candidates_pkey": ("p", "PRIMARY KEY (candidate_id)"),
    "uq_merge_candidates_repo_key": ("u", "UNIQUE (repo, candidate_key)"),
    "ck_merge_candidates_kind": ("c", _in_check("kind", _KINDS)),
    "ck_merge_candidates_base_basis": (
        "c",
        _nullable_in_check("base_basis", _BASE_BASES),
    ),
    "ck_merge_candidates_base_paired": (
        "c",
        "CHECK (((base_sha IS NULL) = (base_basis IS NULL)))",
    ),
    "ck_merge_candidates_chain_position": (
        "c",
        "CHECK (((chain_position IS NULL) OR (chain_position >= 0)))",
    ),
    "ck_merge_candidates_outcome": ("c", _nullable_in_check("outcome", _OUTCOMES)),
    "ck_merge_candidates_outcome_paired": (
        "c",
        "CHECK (((outcome IS NULL) = (outcome_at IS NULL)))",
    ),
    "ck_merge_candidates_land_fields_paired": (
        "c",
        "CHECK (((land_sha IS NULL) = (landed_at IS NULL)))",
    ),
    "ck_merge_candidates_land_paired": (
        "c",
        "CHECK (((NOT (outcome IS DISTINCT FROM 'landed'::text)) = "
        "((land_sha IS NOT NULL) AND (landed_at IS NOT NULL))))",
    ),
    "ck_merge_candidates_recut_cause": (
        "c",
        _nullable_in_check("recut_cause", _RECUT_CAUSES),
    ),
    "ck_merge_candidates_run_class": (
        "c",
        _nullable_in_check("run_class", _RUN_CLASSES),
    ),
    "ck_merge_candidates_ci_attempts": (
        "c",
        "CHECK (((ci_attempts IS NULL) OR (ci_attempts >= 0)))",
    ),
    "ck_merge_candidates_source": ("c", _in_check("source", _SOURCES)),
}

_EXPECTED_MEMBER_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "merge_candidate_members_pkey": (
        "p",
        "PRIMARY KEY (candidate_id, member_position)",
    ),
    "ck_merge_candidate_members_position": ("c", "CHECK ((member_position >= 0))"),
    "ck_merge_candidate_members_outcome": (
        "c",
        _nullable_in_check("member_outcome", _MEMBER_OUTCOMES),
    ),
    "ck_merge_candidate_members_lands_between": (
        "c",
        "CHECK (((lands_between IS NULL) OR (lands_between >= 0)))",
    ),
}

_EXPECTED_HEAD_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "merge_verdict_heads_pkey": ("p", "PRIMARY KEY (repo, pr_number, head_sha)"),
    "ck_merge_verdict_heads_counts": (
        "c",
        "CHECK (((eval_count >= 1) AND (follower_eval_count >= 0) "
        "AND (follower_eval_count <= eval_count)))",
    ),
    "ck_merge_verdict_heads_eval_order": (
        "c",
        "CHECK ((last_eval_at >= first_eval_at))",
    ),
    "ck_merge_verdict_heads_recent_evals": (
        "c",
        "CHECK ((((cardinality(recent_eval_at) >= 1) AND "
        "(cardinality(recent_eval_at) <= 64)) AND "
        "(cardinality(recent_eval_at) <= eval_count)))",
    ),
    "ck_merge_verdict_heads_pushed_basis": (
        "c",
        _nullable_in_check("pushed_basis", _PUSHED_BASES),
    ),
    "ck_merge_verdict_heads_pushed_paired": (
        "c",
        "CHECK (((pushed_at IS NULL) = (pushed_basis IS NULL)))",
    ),
    "ck_merge_verdict_heads_decisive_paired": (
        "c",
        "CHECK (((first_decisive_verdict IS NULL) = (first_decisive_at IS NULL)))",
    ),
    "ck_merge_verdict_heads_superseded_basis": (
        "c",
        _nullable_in_check("superseded_basis", _SUPERSEDED_BASES),
    ),
    "ck_merge_verdict_heads_superseded_paired": (
        "c",
        "CHECK ((((superseded_at IS NULL) = (superseded_basis IS NULL)) AND "
        "((superseded_at IS NULL) = (stale_eval_count IS NULL))))",
    ),
    "ck_merge_verdict_heads_stale_eval_count": (
        "c",
        "CHECK (((stale_eval_count IS NULL) OR ((stale_eval_count >= 0) AND "
        "(stale_eval_count <= eval_count))))",
    ),
    "ck_merge_verdict_heads_outcome": (
        "c",
        _nullable_in_check("outcome", _HEAD_OUTCOMES),
    ),
    "ck_merge_verdict_heads_outcome_paired": (
        "c",
        "CHECK (((outcome IS NULL) = (outcome_at IS NULL)))",
    ),
}

_EXPECTED_HOURLY_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "merge_lane_hourly_pkey": ("p", "PRIMARY KEY (repo, hour)"),
    "ck_merge_lane_hourly_hour_aligned": (
        "c",
        "CHECK (((EXTRACT(epoch FROM hour) % (3600)::numeric) = (0)::numeric))",
    ),
    "ck_merge_lane_hourly_counts": (
        "c",
        "CHECK (((evaluations >= 0) AND (follower_evaluations >= 0) "
        "AND (decisive_evaluations >= 0) AND (distinct_heads >= 0) "
        "AND (follower_evaluations <= evaluations) "
        "AND (decisive_evaluations <= evaluations) "
        "AND (distinct_heads <= evaluations) AND (queue_depth_sample_sum >= 0) "
        "AND (queue_depth_samples >= 0)))",
    ),
    "ck_merge_lane_hourly_rolled_counts": (
        "c",
        "CHECK ((((stale_evaluations IS NULL) OR (stale_evaluations >= 0)) "
        "AND ((heads_first_decisive IS NULL) OR (heads_first_decisive >= 0)) "
        "AND ((admissions IS NULL) OR (admissions >= 0)) "
        "AND ((candidates_cut IS NULL) OR (candidates_cut >= 0)) "
        "AND ((candidates_landed IS NULL) OR (candidates_landed >= 0)) "
        "AND ((candidates_red IS NULL) OR (candidates_red >= 0)) "
        "AND ((session_hours IS NULL) OR (session_hours >= (0)::double precision))))",
    ),
}


def _ix(name: str, table: str, body: str, *, unique: bool = False) -> str:
    kind = "UNIQUE INDEX" if unique else "INDEX"
    return f"CREATE {kind} {name} ON coord.{table} USING btree {body}"


_EXPECTED_CANDIDATE_INDEXES: dict[str, str] = {
    "merge_candidates_pkey": _ix(
        "merge_candidates_pkey", _CANDIDATES, "(candidate_id)", unique=True
    ),
    "uq_merge_candidates_repo_key": _ix(
        "uq_merge_candidates_repo_key",
        _CANDIDATES,
        "(repo, candidate_key)",
        unique=True,
    ),
    "ix_merge_candidates_tenant_repo_cut": _ix(
        "ix_merge_candidates_tenant_repo_cut",
        _CANDIDATES,
        "(tenant_id, repo, cut_at DESC)",
    ),
    "ix_merge_candidates_repo_tip": _ix(
        "ix_merge_candidates_repo_tip", _CANDIDATES, "(repo, tip_sha)"
    ),
    "ix_merge_candidates_open": _ix(
        "ix_merge_candidates_open", _CANDIDATES, "(repo) WHERE (outcome IS NULL)"
    ),
    "ix_merge_candidates_proposal": _ix(
        "ix_merge_candidates_proposal",
        _CANDIDATES,
        "(proposal_id) WHERE (proposal_id IS NOT NULL)",
    ),
    "ix_merge_candidates_batch": _ix(
        "ix_merge_candidates_batch",
        _CANDIDATES,
        "(batch_id) WHERE (batch_id IS NOT NULL)",
    ),
    "ix_merge_candidates_cut_at": _ix(
        "ix_merge_candidates_cut_at", _CANDIDATES, "(cut_at)"
    ),
}

_EXPECTED_MEMBER_INDEXES: dict[str, str] = {
    "merge_candidate_members_pkey": _ix(
        "merge_candidate_members_pkey",
        _MEMBERS,
        "(candidate_id, member_position)",
        unique=True,
    ),
    "ix_merge_candidate_members_repo_pr": _ix(
        "ix_merge_candidate_members_repo_pr", _MEMBERS, "(repo, pr_number)"
    ),
    "ix_merge_candidate_members_cut_at": _ix(
        "ix_merge_candidate_members_cut_at", _MEMBERS, "(cut_at)"
    ),
}

_EXPECTED_HEAD_INDEXES: dict[str, str] = {
    "merge_verdict_heads_pkey": _ix(
        "merge_verdict_heads_pkey",
        _HEADS,
        "(repo, pr_number, head_sha)",
        unique=True,
    ),
    "ix_merge_verdict_heads_tenant_repo_first": _ix(
        "ix_merge_verdict_heads_tenant_repo_first",
        _HEADS,
        "(tenant_id, repo, first_eval_at DESC)",
    ),
    "ix_merge_verdict_heads_open": _ix(
        "ix_merge_verdict_heads_open",
        _HEADS,
        "(repo, pr_number) WHERE (outcome IS NULL)",
    ),
    "ix_merge_verdict_heads_superseded": _ix(
        "ix_merge_verdict_heads_superseded",
        _HEADS,
        "(outcome_at) WHERE (outcome = 'superseded'::text)",
    ),
    "ix_merge_verdict_heads_first_eval": _ix(
        "ix_merge_verdict_heads_first_eval", _HEADS, "(first_eval_at)"
    ),
}

_EXPECTED_HOURLY_INDEXES: dict[str, str] = {
    "merge_lane_hourly_pkey": _ix(
        "merge_lane_hourly_pkey", _HOURLY, "(repo, hour)", unique=True
    ),
    "ix_merge_lane_hourly_tenant_repo_hour": _ix(
        "ix_merge_lane_hourly_tenant_repo_hour",
        _HOURLY,
        "(tenant_id, repo, hour DESC)",
    ),
    "ix_merge_lane_hourly_hour": _ix("ix_merge_lane_hourly_hour", _HOURLY, "(hour)"),
}

_EXPECTED_CONSTRAINTS = {
    _CANDIDATES: _EXPECTED_CANDIDATE_CONSTRAINTS,
    _MEMBERS: _EXPECTED_MEMBER_CONSTRAINTS,
    _HEADS: _EXPECTED_HEAD_CONSTRAINTS,
    _HOURLY: _EXPECTED_HOURLY_CONSTRAINTS,
}
_EXPECTED_COLUMNS = {
    _CANDIDATES: _EXPECTED_CANDIDATE_COLUMNS,
    _MEMBERS: _EXPECTED_MEMBER_COLUMNS,
    _HEADS: _EXPECTED_HEAD_COLUMNS,
    _HOURLY: _EXPECTED_HOURLY_COLUMNS,
}
_EXPECTED_INDEXES = {
    _CANDIDATES: _EXPECTED_CANDIDATE_INDEXES,
    _MEMBERS: _EXPECTED_MEMBER_INDEXES,
    _HEADS: _EXPECTED_HEAD_INDEXES,
    _HOURLY: _EXPECTED_HOURLY_INDEXES,
}

# ``downgrade()`` exactly, in order: the lock bound first, then the column, then
# each table's own indexes before the table.
_EXPECTED_DOWNGRADE: list[str] = [
    "SET LOCAL lock_timeout = '3s'",
    "ALTER TABLE coord.ci_job_observations DROP COLUMN IF EXISTS steps",
    "DROP INDEX IF EXISTS coord.ix_merge_lane_hourly_hour",
    "DROP INDEX IF EXISTS coord.ix_merge_lane_hourly_tenant_repo_hour",
    "DROP TABLE IF EXISTS coord.merge_lane_hourly",
    "DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_first_eval",
    "DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_superseded",
    "DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_open",
    "DROP INDEX IF EXISTS coord.ix_merge_verdict_heads_tenant_repo_first",
    "DROP TABLE IF EXISTS coord.merge_verdict_heads",
    "DROP INDEX IF EXISTS coord.ix_merge_candidate_members_cut_at",
    "DROP INDEX IF EXISTS coord.ix_merge_candidate_members_repo_pr",
    "DROP TABLE IF EXISTS coord.merge_candidate_members",
    "DROP INDEX IF EXISTS coord.ix_merge_candidates_cut_at",
    "DROP INDEX IF EXISTS coord.ix_merge_candidates_batch",
    "DROP INDEX IF EXISTS coord.ix_merge_candidates_proposal",
    "DROP INDEX IF EXISTS coord.ix_merge_candidates_open",
    "DROP INDEX IF EXISTS coord.ix_merge_candidates_repo_tip",
    "DROP INDEX IF EXISTS coord.ix_merge_candidates_tenant_repo_cut",
    "DROP TABLE IF EXISTS coord.merge_candidates",
]

# The candidate projector's write: one row per PUSH, keyed on the push's ledger
# row, idempotent on (repo, candidate_key).
_INSERT_CUT = text(
    """
    INSERT INTO coord.merge_candidates
        (tenant_id, repo, candidate_key, kind, candidate_ref, ledger_id,
         proposal_id, base_sha, base_basis, tip_sha, cut_at, pushed_at)
    VALUES (:tid, :repo, :key, :kind, :ref, :ledger, :proposal, :base, :basis,
            :tip, :at, :at)
    ON CONFLICT (repo, candidate_key) DO NOTHING
    """
)

_INSERT_CANDIDATE = text(
    """
    INSERT INTO coord.merge_candidates
        (tenant_id, repo, candidate_key, kind, base_sha, base_basis, tip_sha,
         chain_position, cut_at, outcome, outcome_at, recut_cause, run_class,
         land_sha, landed_at, ci_attempts, source)
    VALUES (:tid, :repo, :key, :kind, :base, :basis, :tip, :chain, now(),
            :outcome, :outcome_at, :recut, :run_class, :land_sha, :landed_at,
            :attempts, :source)
    """
)

_INSERT_MEMBER = text(
    """
    INSERT INTO coord.merge_candidate_members
        (candidate_id, member_position, tenant_id, repo, cut_at, pr_number,
         member_outcome, lands_between)
    VALUES (:cid, :pos, :tid, :repo, now(), :pr, :outcome, :j)
    """
)

# The evaluation writer's first-evaluation insert: it decides "new head" from
# whether this inserted, so a second insert of the same head must not.
_INSERT_FIRST_EVAL = text(
    """
    INSERT INTO coord.merge_verdict_heads
        (tenant_id, repo, pr_number, head_sha, first_eval_at, last_eval_at,
         eval_count, follower_eval_count, recent_eval_at, first_verdict,
         first_disposition, last_verdict, last_disposition)
    VALUES (:tid, :repo, :pr, :head, :at, :at, 1, :follower,
            ARRAY[CAST(:at AS timestamptz)], :verdict, :disposition, :verdict,
            :disposition)
    ON CONFLICT (repo, pr_number, head_sha) DO NOTHING
    """
)

_INSERT_HEAD = text(
    """
    INSERT INTO coord.merge_verdict_heads
        (tenant_id, repo, pr_number, head_sha, pushed_at, pushed_basis,
         first_eval_at, last_eval_at, eval_count, follower_eval_count,
         recent_eval_at, first_verdict, last_verdict, first_decisive_verdict,
         first_decisive_at, superseded_at, superseded_basis, stale_eval_count,
         outcome, outcome_at)
    VALUES (:tid, :repo, :pr, :head, :pushed, :pushed_basis, :first, :last,
            :count, :follower, CAST(:recent AS timestamptz[]), 'none', 'none',
            :decisive_verdict, :decisive_at, :superseded, :superseded_basis,
            :stale, :outcome, :outcome_at)
    """
)

# The evaluation writer's hourly counters.
_BUMP_HOUR = text(
    """
    INSERT INTO coord.merge_lane_hourly
        (tenant_id, repo, hour, evaluations, follower_evaluations,
         decisive_evaluations, distinct_heads)
    VALUES (:tid, :repo, :hour, 1, :follower, :decisive, :new_head)
    ON CONFLICT (repo, hour) DO UPDATE
        SET evaluations = coord.merge_lane_hourly.evaluations + 1,
            follower_evaluations = coord.merge_lane_hourly.follower_evaluations
                                   + EXCLUDED.follower_evaluations,
            decisive_evaluations = coord.merge_lane_hourly.decisive_evaluations
                                   + EXCLUDED.decisive_evaluations,
            distinct_heads = coord.merge_lane_hourly.distinct_heads
                             + EXCLUDED.distinct_heads,
            updated_at = now()
    """
)

_INSERT_HOUR = text(
    """
    INSERT INTO coord.merge_lane_hourly
        (tenant_id, repo, hour, evaluations, follower_evaluations, distinct_heads,
         stale_evaluations, session_hours)
    VALUES (:tid, :repo, :hour, :evaluations, :follower, :distinct, :stale,
            :session_hours)
    """
)

_TENANT = uuid.UUID("3f6b0d52-9c41-4e87-b2a6-71d8c5e0f913")
_REPO = "qontinui/qontinui-coord"
_HOUR = "2026-10-27T13:00:00Z"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set DATABASE_URL to a dev Postgres)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _function_sql(name: str) -> list[str]:
    """The literal SQL of each ``op.execute`` in ``name``, in source order."""
    tree = ast.parse(_revision_path().read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    out: list[str] = []
    for stmt in fn.body:
        if not (
            isinstance(stmt, ast.Expr)
            and isinstance(stmt.value, ast.Call)
            and isinstance(stmt.value.func, ast.Attribute)
            and stmt.value.func.attr == "execute"
        ):
            continue
        args = stmt.value.args
        assert len(args) == 1 and isinstance(args[0], ast.Constant), ast.dump(stmt)
        assert isinstance(args[0].value, str)
        out.append(args[0].value)
    return out


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _defaults(engine: Engine, table: str) -> dict[str, str | None]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {str(name): default for name, default in rows}


def _constraints(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.' || :table)
                   -- NOT NULL is pinned by ``_columns``.
                   AND contype <> 'n'
                """
            ),
            {"table": table},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": table},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _jobs_shape(
    engine: Engine,
) -> tuple[dict[str, tuple[str, str]], dict[str, str | None], dict[str, str]]:
    """``coord.ci_job_observations``'s columns, defaults and indexes."""
    return (
        _columns(engine, _JOBS),
        _defaults(engine, _JOBS),
        _indexes(engine, _JOBS),
    )


def _run(engine: Engine, statement: TextClause, params: dict[str, object]) -> int:
    with engine.begin() as conn:
        return int(conn.execute(statement, params).rowcount)


def _refused(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        _run(engine, statement, params)


def _assert_shape(engine: Engine) -> None:
    for table in _TABLES:
        assert _columns(engine, table) == _EXPECTED_COLUMNS[table], table
        assert _defaults(engine, table) == _EXPECTED_DEFAULTS[table], table
        assert _constraints(engine, table) == _EXPECTED_CONSTRAINTS[table], table
        assert _indexes(engine, table) == _EXPECTED_INDEXES[table], table

    assert column_info(engine, _JOBS, "steps") == ("jsonb", "YES", None)
    source = _revision_path().read_text(encoding="utf-8")
    assert column_comment(engine, _JOBS, "steps") == comment_body_from_source(
        source, "coord.ci_job_observations.steps"
    )


def _assert_absent(engine: Engine) -> None:
    for table in _TABLES:
        assert not table_exists(engine, "coord", table), f"coord.{table} is present"
        assert _indexes(engine, table) == {}, f"coord.{table} left indexes behind"
    assert column_info(engine, _JOBS, "steps") is None, "steps survived the downgrade"


def test_revision_is_wired_to_one_real_parent() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    parent = module.down_revision
    assert isinstance(parent, str) and parent
    doc = ast.get_docstring(ast.parse(_revision_path().read_text(encoding="utf-8")))
    assert f"Revision ID: {_REVISION_ID}" in (doc or "")
    assert f"Revises: {parent}" in (doc or "")
    assert module.branch_labels is None
    assert module.depends_on is None
    parent_files = list(
        (backend_root() / "alembic" / "versions").glob(f"{parent}_*.py")
    ) + list((backend_root() / "alembic" / "versions").glob(f"{parent}.py"))
    assert parent_files, f"no revision file for parent {parent!r}"


def test_upgrade_drops_nothing_and_is_coord_qualified() -> None:
    sql = _function_sql("upgrade")
    assert sql, "upgrade() executes no SQL"
    assert sql[0].strip() == "SET LOCAL lock_timeout = '3s'"
    for stmt in sql:
        upper = stmt.upper()
        assert "DROP" not in upper, stmt
        if "CREATE TABLE" in upper or "CREATE INDEX" in upper:
            assert any(f"coord.{t}" in stmt for t in _TABLES), stmt
        if "ALTER TABLE" in upper or "COMMENT ON" in upper:
            assert "coord.ci_job_observations" in stmt, stmt
    created = {
        name
        for indexes in _EXPECTED_INDEXES.values()
        for name in indexes
        if not (name.endswith("_pkey") or name.startswith("uq_"))
    }
    named = {
        stmt.split("IF NOT EXISTS", 1)[1].split()[0]
        for stmt in sql
        if "CREATE INDEX IF NOT EXISTS" in stmt
    }
    assert named == created


def test_downgrade_runs_exactly_the_expected_statements() -> None:
    assert [s.strip() for s in _function_sql("downgrade")] == _EXPECTED_DOWNGRADE
    created = {
        name
        for indexes in _EXPECTED_INDEXES.values()
        for name in indexes
        if not (name.endswith("_pkey") or name.startswith("uq_"))
    }
    dropped = {
        s.rsplit(".", 1)[1]
        for s in _EXPECTED_DOWNGRADE
        if s.startswith("DROP INDEX IF EXISTS coord.")
    }
    assert dropped == created


@_needs_pg
def test_merge_capture_01_creates_the_stores_and_enforces_the_contract() -> None:
    with ephemeral_database(admin_database_url(), "mcap01") as (engine, url):
        parent = _module().down_revision
        assert isinstance(parent, str)
        run_alembic(backend_root(), url, "upgrade", parent)
        jobs_before = _jobs_shape(engine)
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # --- merge_candidates ---------------------------------------------
        cut_at = "2026-10-27T12:00:00Z"
        cut = {
            "tid": _TENANT,
            "repo": _REPO,
            "key": "refs/heads/merge-candidate/p1@aaa#101",
            "kind": "singleton",
            "ref": "refs/heads/merge-candidate/p1",
            "ledger": 101,
            "proposal": uuid.uuid4(),
            "base": "b0",
            "basis": "rebase_result",
            "tip": "aaa",
            "at": cut_at,
        }
        assert _run(engine, _INSERT_CUT, cut) == 1
        # A re-projection of the same push writes nothing.
        assert _run(engine, _INSERT_CUT, cut) == 0
        # A second push of the SAME tip — a re-cut onto an unmoved base — is a
        # second attempt, keyed by its own ledger row.
        assert (
            _run(
                engine,
                _INSERT_CUT,
                {
                    **cut,
                    "key": "refs/heads/merge-candidate/p1@aaa#117",
                    "ledger": 117,
                    "at": "2026-10-27T12:30:00Z",
                },
            )
            == 1
        )
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.merge_candidates "
                "WHERE repo = :repo AND tip_sha = 'aaa'",
                repo=_REPO,
            )
            == 2
        )

        row = {
            "tid": _TENANT,
            "repo": _REPO,
            "kind": "batch",
            "base": None,
            "basis": None,
            "tip": "bbb",
            "chain": None,
            "outcome": None,
            "outcome_at": None,
            "recut": None,
            "run_class": None,
            "land_sha": None,
            "landed_at": None,
            "attempts": None,
            "source": "observed",
        }
        for i, kind in enumerate(_KINDS):
            assert (
                _run(
                    engine,
                    _INSERT_CANDIDATE,
                    {**row, "key": f"k-kind-{i}", "kind": kind},
                )
                == 1
            )
        for i, basis in enumerate(_BASE_BASES):
            assert (
                _run(
                    engine,
                    _INSERT_CANDIDATE,
                    {**row, "key": f"k-basis-{i}", "base": "b1", "basis": basis},
                )
                == 1
            )
        at = "2026-10-27T12:00:00Z"
        for i, outcome in enumerate(_OUTCOMES):
            landed = outcome == "landed"
            assert (
                _run(
                    engine,
                    _INSERT_CANDIDATE,
                    {
                        **row,
                        "key": f"k-outcome-{i}",
                        "outcome": outcome,
                        "outcome_at": at,
                        "land_sha": "bbb" if landed else None,
                        "landed_at": at if landed else None,
                    },
                )
                == 1
            )
        for i, cause in enumerate(_RECUT_CAUSES):
            assert (
                _run(
                    engine,
                    _INSERT_CANDIDATE,
                    {**row, "key": f"k-recut-{i}", "recut": cause},
                )
                == 1
            )
        for i, run_class in enumerate(_RUN_CLASSES):
            assert (
                _run(
                    engine,
                    _INSERT_CANDIDATE,
                    {**row, "key": f"k-run-{i}", "run_class": run_class},
                )
                == 1
            )
        assert (
            _run(
                engine,
                _INSERT_CANDIDATE,
                {**row, "key": "k-backfill", "source": "backfill"},
            )
            == 1
        )
        assert (
            _run(engine, _INSERT_CANDIDATE, {**row, "key": "k-chain", "chain": 0}) == 1
        )

        _refused(engine, _INSERT_CANDIDATE, {**row, "key": cut["key"]})  # duplicate key
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x1", "kind": "merge"})
        _refused(
            engine,
            _INSERT_CANDIDATE,
            {**row, "key": "x2", "base": "b1", "basis": "guessed"},
        )
        # A base without its basis, and a basis without its base.
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x3", "base": "b1"})
        _refused(
            engine, _INSERT_CANDIDATE, {**row, "key": "x4", "basis": "land_parent"}
        )
        _refused(
            engine,
            _INSERT_CANDIDATE,
            {**row, "key": "x5", "outcome": "merged", "outcome_at": at},
        )
        # An outcome without its time, and a time without its outcome.
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x6", "outcome": "red"})
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x7", "outcome_at": at})
        # A land without its sha; both land fields on a non-landed row and on an
        # open row; and each land field alone, on an open row and a red row.
        _refused(
            engine,
            _INSERT_CANDIDATE,
            {**row, "key": "x8", "outcome": "landed", "outcome_at": at},
        )
        _refused(
            engine,
            _INSERT_CANDIDATE,
            {
                **row,
                "key": "x9",
                "outcome": "red",
                "outcome_at": at,
                "land_sha": "bbb",
                "landed_at": at,
            },
        )
        _refused(
            engine,
            _INSERT_CANDIDATE,
            {**row, "key": "x10", "land_sha": "bbb", "landed_at": at},
        )
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x15", "land_sha": "bbb"})
        _refused(
            engine,
            _INSERT_CANDIDATE,
            {**row, "key": "x16", "outcome": "red", "outcome_at": at, "landed_at": at},
        )
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x11", "recut": "rebased"})
        _refused(
            engine,
            _INSERT_CANDIDATE,
            {**row, "key": "x12", "run_class": "content_fail"},
        )
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x13", "attempts": -1})
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x14", "source": "guessed"})
        _refused(engine, _INSERT_CANDIDATE, {**row, "key": "x17", "chain": -1})

        # --- merge_candidate_members ----------------------------------------
        cid = scalar(
            engine,
            "SELECT candidate_id FROM coord.merge_candidates WHERE candidate_key = :k",
            k=cut["key"],
        )
        member = {
            "cid": cid,
            "tid": _TENANT,
            "repo": _REPO,
            "pr": 42,
            "outcome": None,
            "j": None,
        }
        for i, outcome in enumerate(_MEMBER_OUTCOMES):
            assert (
                _run(engine, _INSERT_MEMBER, {**member, "pos": i, "outcome": outcome})
                == 1
            )
        _refused(engine, _INSERT_MEMBER, {**member, "pos": 0})  # duplicate position
        _refused(engine, _INSERT_MEMBER, {**member, "pos": -1})
        _refused(engine, _INSERT_MEMBER, {**member, "pos": 50, "outcome": "red"})
        _refused(engine, _INSERT_MEMBER, {**member, "pos": 51, "j": -1})
        assert _run(engine, _INSERT_MEMBER, {**member, "pos": 52, "j": 3}) == 1

        # --- merge_verdict_heads ------------------------------------------------
        first = {
            "tid": _TENANT,
            "repo": _REPO,
            "pr": 7,
            "head": "h1",
            "at": "2026-10-27T13:05:00Z",
            "follower": 0,
            "verdict": "ci-pending",
            "disposition": "clears_on_its_own",
        }
        assert _run(engine, _INSERT_FIRST_EVAL, first) == 1
        # The second evaluation of the head is not a new head.
        assert (
            _run(engine, _INSERT_FIRST_EVAL, {**first, "at": "2026-10-27T13:20:00Z"})
            == 0
        )
        assert (
            scalar(
                engine,
                "SELECT cardinality(recent_eval_at) FROM coord.merge_verdict_heads "
                "WHERE repo = :repo AND pr_number = 7 AND head_sha = 'h1'",
                repo=_REPO,
            )
            == 1
        )

        bare = {
            "tid": _TENANT,
            "repo": _REPO,
            "pr": 8,
            "head": "h2",
            "pushed": None,
            "pushed_basis": None,
            "first": "2026-10-27T13:00:00Z",
            "last": "2026-10-27T13:10:00Z",
            "count": 2,
            "follower": 0,
            "recent": "{2026-10-27T13:00:00Z,2026-10-27T13:10:00Z}",
            "decisive_verdict": None,
            "decisive_at": None,
            "superseded": None,
            "superseded_basis": None,
            "stale": None,
            "outcome": None,
            "outcome_at": None,
        }
        for i, outcome in enumerate(_HEAD_OUTCOMES):
            assert (
                _run(
                    engine,
                    _INSERT_HEAD,
                    {
                        **bare,
                        "head": f"h-out-{i}",
                        "outcome": outcome,
                        "outcome_at": at,
                    },
                )
                == 1
            )
        for i, basis in enumerate(_PUSHED_BASES):
            assert (
                _run(
                    engine,
                    _INSERT_HEAD,
                    {
                        **bare,
                        "head": f"h-push-{i}",
                        "pushed": at,
                        "pushed_basis": basis,
                    },
                )
                == 1
            )
        for i, basis in enumerate(_SUPERSEDED_BASES):
            assert (
                _run(
                    engine,
                    _INSERT_HEAD,
                    {
                        **bare,
                        "head": f"h-sup-{i}",
                        "superseded": "2026-10-27T13:05:00Z",
                        "superseded_basis": basis,
                        "stale": 1,
                        "outcome": "superseded",
                        "outcome_at": "2026-10-27T13:30:00Z",
                    },
                )
                == 1
            )
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y1", "count": 0})
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y2", "follower": 3})
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y3", "follower": -1})
        _refused(
            engine, _INSERT_HEAD, {**bare, "head": "y4", "last": "2026-10-27T12:00:00Z"}
        )
        _refused(
            engine, _INSERT_HEAD, {**bare, "head": "y5", "decisive_verdict": "none"}
        )
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y6", "decisive_at": at})
        _refused(
            engine,
            _INSERT_HEAD,
            {**bare, "head": "y7", "outcome": "merged", "outcome_at": at},
        )
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y8", "outcome": "closed"})
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y9", "outcome_at": at})
        # The ring: never empty, at most 64, never longer than the count.
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y10", "recent": "{}"})
        _refused(
            engine,
            _INSERT_HEAD,
            {**bare, "head": "y11", "count": 1},  # two instants, one evaluation
        )
        ring = (
            ",".join(f"2026-10-27T13:{m:02d}:00Z" for m in range(0, 59))
            + ","
            + ",".join(f"2026-10-27T14:{m:02d}:00Z" for m in range(0, 6))
        )
        _refused(
            engine,
            _INSERT_HEAD,
            {
                **bare,
                "head": "y12",
                "count": 65,
                "last": "2026-10-27T14:05:00Z",
                "recent": "{" + ring + "}",
            },
        )
        # A push without its basis, a basis without its push, an unknown basis.
        _refused(engine, _INSERT_HEAD, {**bare, "head": "y13", "pushed": at})
        _refused(
            engine,
            _INSERT_HEAD,
            {**bare, "head": "y14", "pushed_basis": "check_run"},
        )
        _refused(
            engine,
            _INSERT_HEAD,
            {**bare, "head": "y15", "pushed": at, "pushed_basis": "pr_merged"},
        )
        sup = {
            **bare,
            "superseded": at,
            "superseded_basis": "check_run",
            "stale": 0,
        }
        # A supersession without each of its partners, an unknown basis, and a
        # stale count that is negative or above the evaluation count.
        _refused(engine, _INSERT_HEAD, {**sup, "head": "y16", "superseded_basis": None})
        _refused(engine, _INSERT_HEAD, {**sup, "head": "y17", "stale": None})
        _refused(engine, _INSERT_HEAD, {**sup, "head": "y18", "superseded": None})
        _refused(
            engine, _INSERT_HEAD, {**sup, "head": "y19", "superseded_basis": "guess"}
        )
        _refused(engine, _INSERT_HEAD, {**sup, "head": "y20", "stale": -1})
        _refused(engine, _INSERT_HEAD, {**sup, "head": "y21", "stale": 3})
        assert _run(engine, _INSERT_HEAD, {**sup, "head": "y22", "stale": 2}) == 1

        # --- merge_lane_hourly -----------------------------------------------
        bump = {
            "tid": _TENANT,
            "repo": _REPO,
            "hour": _HOUR,
            "follower": 0,
            "decisive": 0,
            "new_head": 1,
        }
        assert _run(engine, _BUMP_HOUR, bump) == 1
        assert (
            _run(
                engine,
                _BUMP_HOUR,
                {**bump, "follower": 1, "decisive": 1, "new_head": 0},
            )
            == 1
        )
        with engine.connect() as conn:
            counters = conn.execute(
                text(
                    """
                    SELECT evaluations, follower_evaluations, decisive_evaluations,
                           distinct_heads, queue_depth_sample_sum,
                           queue_depth_samples, unknown_reasons::text,
                           reeval_seated, stale_evaluations, rolled_up_at
                      FROM coord.merge_lane_hourly
                     WHERE repo = :repo AND hour = :hour
                    """
                ),
                {"repo": _REPO, "hour": _HOUR},
            ).one()
        # Live counters counted; every rolled-up measure still UNKNOWN.
        assert tuple(counters) == (2, 1, 1, 1, 0, 0, "{}", None, None, None)

        hour_row = {
            **bump,
            "evaluations": 1,
            "follower": 0,
            "distinct": 1,
            "stale": None,
            "session_hours": None,
        }
        _refused(engine, _INSERT_HOUR, {**hour_row, "hour": "2026-10-27T13:30:00Z"})
        _refused(engine, _INSERT_HOUR, {**hour_row, "hour": "2026-10-27T14:00:00.5Z"})
        _refused(
            engine,
            _INSERT_HOUR,
            {**hour_row, "hour": "2026-10-27T15:00:00Z", "follower": 2},
        )
        _refused(
            engine,
            _INSERT_HOUR,
            {
                **hour_row,
                "hour": "2026-10-27T16:00:00Z",
                "evaluations": -1,
                "distinct": 0,
            },
        )
        _refused(
            engine,
            _INSERT_HOUR,
            {**hour_row, "hour": "2026-10-27T17:00:00Z", "distinct": 2},
        )
        _refused(
            engine,
            _INSERT_HOUR,
            {**hour_row, "hour": "2026-10-27T18:00:00Z", "stale": -1},
        )
        _refused(
            engine,
            _INSERT_HOUR,
            {**hour_row, "hour": "2026-10-27T20:00:00Z", "session_hours": -0.5},
        )
        # A whole hour written with a non-UTC offset is still a whole UTC hour.
        assert (
            _run(
                engine,
                _INSERT_HOUR,
                {
                    **hour_row,
                    "hour": "2026-10-27T19:00:00+02:00",
                    "evaluations": 0,
                    "distinct": 0,
                    "stale": 0,
                    "session_hours": 1.5,
                },
            )
            == 1
        )

        # --- round trip ------------------------------------------------------
        run_alembic(backend_root(), url, "downgrade", parent)
        _assert_absent(engine)
        assert _jobs_shape(engine) == jobs_before, (
            "downgrade left coord.ci_job_observations different from before the upgrade"
        )
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        for table in _TABLES:
            assert scalar(engine, f"SELECT count(*) FROM coord.{table}") == 0, table
