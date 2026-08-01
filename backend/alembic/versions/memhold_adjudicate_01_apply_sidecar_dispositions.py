"""memhold adjudicate 01 — land the operator's sidecar dispositions in coord

Revision ID: memhold_adjudicate_01
Revises: scheduler_ticks_proposal_id_01

Why
---
Phase 3.3 of plan
``D:/qontinui-root/plans/2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord.md``.

``memhold_backfill_01`` froze the contested set: 138 ``source.origin =
'sync-conflict-sidecar'`` rows and their 11 ``'topic-file'`` winners were taken
out of every automatic lifecycle sweep with ``source.lifecycle_hold = true``, so
the adjudication would decide the pairs instead of a cosine-similarity
heuristic. The operator then adjudicated **all 67 conflict events** on
2026-08-01 under gate ``925c3ab3-9d05-429b-b218-0d1c97262c54`` (approved):
55 ``index-merge-artifact``, 6 ``winner``, 5 ``merged``, 1 ``loser``. The
decisions were applied to the FILES; coord still holds the sidecar rows as if
nothing had been decided.

This revision writes the decisions into ``coord.memory_records``. It is shipped
as a migration rather than run ad-hoc because it is ~149 rows of prod DML —
over ``production-and-cost`` ``prod-mutation``'s 50-row proceed+notify bound,
and ``pipeline-deploys-are-not-adhoc-mutation`` puts a pipeline deploy outside
that rule altogether.

What it does, in order
----------------------

1. **Stamps ``source.adjudication`` on every sidecar row it can map** —
   ``{disposition, decided, plan, gate, prior_superseded_by,
   prior_is_tombstone, prior_valid_until}``.
2. **Supersedes** each sidecar row that HAS a topic-file winner onto that
   winner and ends its validity. This is the explicit adjudication supersede:
   it deliberately overrides ``lifecycle_hold``, exactly as
   ``memory_store.mark_superseded`` does (see that function's docstring — the
   hold is honoured at the AUTOMATIC callers' selectors, never here).
3. **Tombstones** each sidecar row that has NO winner and ends its validity.
4. **Releases the hold** on the sidecar rows, as an explicit JSON ``false`` —
   the value ``memhold_backfill_01`` reserved to mean "adjudicated and
   released", which a presence-only check could not express.

⚠️ **The 11 topic-file winners KEEP their hold, and that asymmetry is
deliberate.** Their corrected text has not been written yet: the 5 ``merged``
bodies and the 1 ``loser``-wins body are a FOLLOW-UP that must go through the
memory API (``POST /records`` + ``POST /records/{id}/supersede``), because
content writes need redaction, content-hashing and embedding — all of which raw
SQL bypasses, and none of which a migration should reimplement. Until that
lands the winners still carry pre-adjudication content, so they must stay out of
the automatic sweeps. 6 records is inside the 50-row ad-hoc bound, so that step
is legitimately outside a migration. This revision therefore touches NO
``content``, ``content_hash``, ``embedding`` or ``title`` on any row.

⚠️ **Releasing the hold re-arms ``decay_prune`` on these rows.** Once
``valid_until`` is set and the hold is gone, ``decay_prune`` becomes free to
physically DELETE each sidecar row (and with it this ``adjudication`` stamp)
after its grace window. That is the intended end-state for an adjudicated loser
— the surviving record of the decision is the manifest and the merged file
bodies, not the row — but it is a one-way door, so it is named here rather than
left to be discovered.

How a row is mapped to a disposition
------------------------------------

Two rules, and nothing else:

* **Index rule (structural).** A sidecar whose base file is ``MEMORY.md`` or
  ``MEMORY-archive.md`` is ``index-merge-artifact``. These are the memory INDEX
  files; their divergences are merge artifacts of the retired 3-account sync,
  not competing knowledge. 55 of the 67 events and **113 of the 138 rows** are
  this case, and — measured — they have **no ``'topic-file'`` row at all**: the
  Phase-4a import never imported the index files as memories, so there is
  nothing to supersede them ONTO. They are the tombstone arm.
* **Content rule (explicit table).** The remaining 12 events are listed
  verbatim in :data:`_CONTENT_DECISIONS` below, one row per event, transcribed
  from the authoritative per-event record
  ``C:/claude/memory-canonical/adjudication-2026-07-29/manifest.json``.

📌 **The content table is keyed on the SIDECAR filename, not on the base
file.** The Phase-3.3 brief specified ``(project, base_file)``; the manifest
falsifies that. ``D--qontinui-root/project_runner_as_ci_node_migration.md`` has
TWO sidecars with DIFFERENT dispositions — the ``2026-07-21T05-24-53Z`` one is
``winner`` ("loser is a 2026-07-16 snapshot; the winner restates all of it plus
outcomes") and the ``2026-07-23T02-50-41Z`` one is ``merged`` ("recovered the
shadow-soak ARMING record, coord#1127, that the winner lacked"). Keying on the
base file would have collapsed those two decisions into one and silently
mislabelled a row. The table therefore carries ``(project, base_file, account,
stamp)`` — the manifest's own four identifying fields — and reconstructs the
sidecar filename the import wrote into ``source.file``.

A row that matches NEITHER rule gets **no stamp and no action**, and is logged
at ERROR with its identifying fields. That is not defensive padding: an
unmapped sidecar is an unadjudicated sidecar, and releasing its hold or ending
its validity on a guess is precisely the loss this whole plan exists to
prevent. It keeps its ``lifecycle_hold = true`` and waits for a human.

Row selection is shared with ``memhold_backfill_01``
----------------------------------------------------

``_SIDECAR_ORIGIN``, ``_WINNER_ORIGIN``, ``_SIDECAR_KEY_CTE`` and
``_WINNER_MATCH`` are **imported from that revision's module** rather than
copied, so the two migrations cannot drift in which rows they address.
``_WINNER_MATCH`` and ``_SIDECAR_KEY_CTE`` are used VERBATIM for the
still-held-winner count. The two fragments this revision cannot reuse as-is —
a per-ROW sidecar CTE (the shared one projects no ``memory_id``) and a JOINable
form of the winner predicate (the shared one is an ``EXISTS`` written from the
winner's side) — are re-expressed here and then checked, atom by atom, against
the imported originals by :func:`_assert_no_drift`, which runs at the top of
both ``upgrade()`` and ``downgrade()``. Editing one side without the other
fails the migration loudly instead of quietly addressing a different row set.

Winner selection when a base file has more than one ``'topic-file'`` row (the
Phase-4a import ran twice): prefer a LIVE row — not superseded, not tombstoned,
validity not ended — then oldest ``created_at``, then ``memory_id``. Pointing a
supersession at a dead row would bury the lineage one hop deeper for no gain.

Interaction with the live-dedup unique index
--------------------------------------------

``uq_memory_records_tenant_content_hash_live`` is PARTIAL:
``(tenant_id, content_hash) WHERE is_tombstone = false AND superseded_by IS
NULL AND valid_until IS NULL``. Every write here only ever sets
``superseded_by``, ``is_tombstone`` or ``valid_until`` — so rows only ever LEAVE
that index, never enter it. No collision is reachable, including the case of
two sidecars with identical content landing on the same winner.

Idempotency
-----------

Each statement carries a guard on the state it writes (``adjudication`` absent /
``superseded_by`` already correct / ``is_tombstone`` already true /
``lifecycle_hold`` already ``false``), so a re-run reports 0 for every count.
The stamp guard is also what makes the ORDER load-bearing: step 1 must observe
``superseded_by`` BEFORE step 2 overwrites it.

Downgrade — what it does and does not restore
----------------------------------------------

Restores, from the ``source.adjudication`` stash: ``superseded_by``,
``is_tombstone`` and ``valid_until``. Then restores ``lifecycle_hold = true``
(the state ``memhold_backfill_01`` left, which is by construction what preceded
this revision) and drops the ``adjudication`` key.

It does NOT restore ``updated_at`` — this revision overwrites it with ``now()``
on every superseded/tombstoned row, mirroring ``mark_superseded``, and the
pre-image is not stashed. It also cannot undo anything done through the memory
API by the content follow-up, and it cannot resurrect a row ``decay_prune``
deleted after the hold was released. Run it promptly or not at all.
"""

import importlib.util
import logging
import re
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa

from alembic import op

# Same channel the sibling data migrations report on, so the migrator
# container's logs carry this revision's blast radius. Without it the only
# record of what the adjudication moved is a query run afterwards, by which
# point the before-picture is gone.
logger = logging.getLogger("alembic.runtime.migration")

# revision identifiers, used by Alembic.
revision: str = "memhold_adjudicate_01"
down_revision: str = "scheduler_ticks_proposal_id_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ---------------------------------------------------------------------------
# Shared row selection — imported from memhold_backfill_01, never copied.
# ---------------------------------------------------------------------------
#
# Alembic version files are not a package, so a plain ``from ... import`` does
# not resolve. Load the sibling by path instead, under a private module name so
# nothing collides with alembic's own import of the same file.
_BACKFILL_FILENAME = "memhold_backfill_01_lifecycle_hold_sidecars.py"


def _load_backfill() -> ModuleType:
    """Import the Phase-1b revision module by path (it is not importable)."""
    path = Path(__file__).with_name(_BACKFILL_FILENAME)
    spec = importlib.util.spec_from_file_location(
        "_memhold_backfill_01_shared", path
    )
    if spec is None or spec.loader is None:  # pragma: no cover — packaging bug
        raise RuntimeError(
            f"memhold_adjudicate_01 cannot load {path}; the two revisions share "
            "their row selection and must not be separated."
        )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_backfill = _load_backfill()

_SIDECAR_ORIGIN: str = _backfill._SIDECAR_ORIGIN
_WINNER_ORIGIN: str = _backfill._WINNER_ORIGIN
_SIDECAR_KEY_CTE: str = _backfill._SIDECAR_KEY_CTE
_WINNER_MATCH: str = _backfill._WINNER_MATCH


# The two rewritten fragments, and the atoms each must still agree with.
#
# Per-ROW sidecar key: identical resolution to `_SIDECAR_KEY_CTE` (project from
# `source.project` with the title as fallback — 80 of the 138 rows carry a NULL
# project, so the fallback is load-bearing; base file from `source.file` with
# the `.conflict-<account>-<stamp>.md` suffix stripped) plus the `memory_id`
# and the raw `source.file` that the shared CTE does not project.
_SIDECAR_ROW_CTE = f"""
    SELECT
        memory_id,
        tenant_id,
        COALESCE(
            source->>'project',
            NULLIF(
                split_part(
                    replace(title, '[sync-conflict sidecar] ', ''), '/', 1
                ),
                ''
            )
        ) AS project,
        regexp_replace(source->>'file', '\\.conflict-.*$', '') AS base_file,
        source->>'file' AS sidecar_file
      FROM coord.memory_records
     WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
"""

# JOINable form of `_WINNER_MATCH`. The shared constant is an EXISTS written
# from the winner's side, which answers "is this row A winner?" but not "which
# winner is THIS sidecar's?". Same three conditions, same operand order, so
# every atom below is checkable against it.
_WINNER_JOIN_ON = f"""
    w.source->>'origin' = '{_WINNER_ORIGIN}'
    AND s.tenant_id = w.tenant_id
    AND s.base_file = w.source->>'file'
    AND (
         w.source->>'project' IS NULL
         OR w.source->>'project' = s.project
    )
"""

# Atoms that must survive verbatim (whitespace-normalized) in the imported
# originals. A change on either side that these do not catch is a change that
# does not alter which rows are addressed.
_SIDECAR_ATOMS = (
    "COALESCE( source->>'project', NULLIF( split_part( "
    "replace(title, '[sync-conflict sidecar] ', ''), '/', 1 ), '' ) )",
    "regexp_replace(source->>'file', '\\.conflict-.*$', '')",
    f"WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'",
)
_WINNER_ATOMS = (
    f"w.source->>'origin' = '{_WINNER_ORIGIN}'",
    "s.tenant_id = w.tenant_id",
    "s.base_file = w.source->>'file'",
    "w.source->>'project' IS NULL",
    "w.source->>'project' = s.project",
)


def _norm(sql: str) -> str:
    """Collapse whitespace so a reformat is not mistaken for a semantic change."""
    return re.sub(r"\s+", " ", sql).strip()


def _assert_no_drift() -> None:
    """Fail loudly if this revision's row selection has parted from Phase 1b's."""
    sidecar_src = _norm(_SIDECAR_KEY_CTE)
    for atom in _SIDECAR_ATOMS:
        if _norm(atom) not in sidecar_src:
            raise RuntimeError(
                "memhold_adjudicate_01 has drifted from memhold_backfill_01's "
                f"sidecar key: {atom!r} is no longer part of _SIDECAR_KEY_CTE. "
                "Reconcile the two before applying — they must address the "
                "same rows."
            )
    winner_src = _norm(_WINNER_MATCH)
    for atom in _WINNER_ATOMS:
        if _norm(atom) not in winner_src:
            raise RuntimeError(
                "memhold_adjudicate_01 has drifted from memhold_backfill_01's "
                f"winner match: {atom!r} is no longer part of _WINNER_MATCH. "
                "Reconcile the two before applying — they must address the "
                "same rows."
            )


# ---------------------------------------------------------------------------
# The adjudication itself.
# ---------------------------------------------------------------------------

_PLAN_SLUG = "2026-07-28-adjudicate-the-67-sync-conflict-sidecars-now-in-coord"
_GATE_ID = "925c3ab3-9d05-429b-b218-0d1c97262c54"
_DECIDED_ON = "2026-08-01"

# The index rule. These two are the memory INDEX files, whose divergences are
# merge artifacts of the retired 3-account sync rather than competing knowledge.
_INDEX_FILES = ("MEMORY.md", "MEMORY-archive.md")
_INDEX_DISPOSITION = "index-merge-artifact"

# The 12 CONTENT conflict events, transcribed one-for-one from
# adjudication-2026-07-29/manifest.json. Fields are the manifest's own:
# (project, base file, account, stamp, disposition). The sidecar filename the
# Phase-4a import wrote into `source.file` is
# ``<base>.conflict-<account>-<stamp>.md``.
#
# Note the two `project_runner_as_ci_node_migration.md` rows: same project,
# same base file, DIFFERENT dispositions. That pair is why this table is keyed
# on the sidecar and not on the base file.
_CONTENT_DECISIONS: tuple[tuple[str, str, str, str, str], ...] = (
    (
        "D--qontinui-root",
        "project_runner_as_ci_node_migration.md",
        "tiohorst",
        "2026-07-21T05-24-53Z",
        "winner",
    ),
    (
        "D--qontinui-root",
        "project_runner_as_ci_node_migration.md",
        "tiohorst",
        "2026-07-23T02-50-41Z",
        "merged",
    ),
    (
        "D--qontinui-root",
        "project_ui_bridge_redaction_not_enforced_structural_plan.md",
        "qontinui",
        "2026-07-23T02-50-32Z",
        "winner",
    ),
    (
        "D--qontinui-root",
        "project_ui_bridge_redaction_not_enforced_structural_plan.md",
        "tiohorst",
        "2026-07-23T02-50-41Z",
        "winner",
    ),
    (
        "D--qontinui-root",
        "reference_coord_mcp_client_caches_stale_nonce_across_runner_restart.md",
        "qontinui",
        "2026-07-21T05-24-48Z",
        "merged",
    ),
    (
        "D--qontinui-root",
        "reference_coord_reconciler_freeze_reeval_lookready_and_missing_rows.md",
        "qontinui",
        "2026-07-16T01-41-10Z",
        "merged",
    ),
    (
        "D--qontinui-root",
        "reference_pr_merged_gate_fails_on_coord_rebase_land.md",
        "qontinui",
        "2026-07-21T05-24-49Z",
        "winner",
    ),
    (
        "D--qontinui-root",
        "reference_pr_merged_gate_fails_on_coord_rebase_land.md",
        "tiohorst",
        "2026-07-21T05-24-55Z",
        "winner",
    ),
    (
        "D--qontinui-root-qontinui-coord",
        "pr-1060-specimen-never-lands.md",
        "tiohorst",
        "2026-07-21T05-24-56Z",
        "winner",
    ),
    (
        "D--qontinui-root-qontinui-coord",
        "pr-repair-session-is-read-only.md",
        "hotmail",
        "2026-07-16T01-41-05Z",
        "merged",
    ),
    (
        "D--qontinui-root-qontinui-runner",
        "pr-754-stale-cross-repo-dep-edge.md",
        "paktis",
        "2026-07-21T05-24-45Z",
        "loser",
    ),
    (
        "D--qontinui-root-qontinui-runner",
        "repair-worktree-tool-gating.md",
        "paktis",
        "2026-07-21T05-24-45Z",
        "merged",
    ),
)

# Measured against prod 2026-07-30 / manifest 2026-08-01. Reported alongside
# the ACTUAL counts rather than asserted: a drift is something to read, not
# something to abort a deploy on — the rows may legitimately have moved between
# the measurement and the apply, and the unmapped-row report is the check that
# actually matters.
_EXPECTED_SIDECARS = 138
_EXPECTED_TOMBSTONED = 113
_EXPECTED_SUPERSEDED = 25
_EXPECTED_HELD_WINNERS = 11


def _sql_str(value: str) -> str:
    """Render a constant as a SQL literal, refusing anything needing escaping.

    Every value here is a literal in this file, so this is not an injection
    guard — it is a transcription guard. A quote or backslash arriving in a
    project name or filename would silently reshape the VALUES list.
    """
    if "'" in value or "\\" in value:
        raise RuntimeError(
            f"memhold_adjudicate_01: {value!r} contains a quote or backslash; "
            "the disposition table is rendered as SQL literals and cannot "
            "carry one."
        )
    return f"'{value}'"


def _decision_values_sql() -> str:
    """The content decisions as a SQL ``VALUES`` list.

    The first row casts every column to ``text`` so the join against the
    sidecar CTE's ``text`` columns never has to resolve an ``unknown`` literal.
    """
    rows: list[str] = []
    for index, (project, base_file, account, stamp, disposition) in enumerate(
        _CONTENT_DECISIONS
    ):
        sidecar_file = f"{base_file}.conflict-{account}-{stamp}.md"
        cells = [
            _sql_str(project),
            _sql_str(base_file),
            _sql_str(sidecar_file),
            _sql_str(disposition),
        ]
        if index == 0:
            cells = [f"CAST({cell} AS text)" for cell in cells]
        rows.append("(" + ", ".join(cells) + ")")
    return "VALUES\n            " + ",\n            ".join(rows)


def _index_files_sql() -> str:
    return ", ".join(_sql_str(name) for name in _INDEX_FILES)


# Every sidecar row, resolved to its disposition. Shared by the report, the
# stamp and (via `sidecar`) the winner link, so all three agree by construction.
_RESOLVED_CTE = f"""
    sidecar AS ({_SIDECAR_ROW_CTE}),
    decision (project, base_file, sidecar_file, disposition) AS (
        {_decision_values_sql()}
    ),
    resolved AS (
        SELECT
            s.memory_id,
            s.tenant_id,
            s.project,
            s.base_file,
            s.sidecar_file,
            CASE
                WHEN s.base_file IN ({_index_files_sql()})
                    THEN CAST({_sql_str(_INDEX_DISPOSITION)} AS text)
                ELSE d.disposition
            END AS disposition
          FROM sidecar s
          LEFT JOIN decision d
                 ON d.project = s.project
                AND d.base_file = s.base_file
                AND d.sidecar_file = s.sidecar_file
    )
"""

# Each sidecar row paired with the topic-file winner it must be superseded onto,
# or NULL when it has none (the 113 index-file rows). Live winners first, then
# oldest — pointing a supersession at a dead row buries the lineage for nothing.
_WINNER_LINK_CTE = f"""
    winner_ranked AS (
        SELECT
            s.memory_id AS sidecar_id,
            w.memory_id AS winner_id,
            row_number() OVER (
                PARTITION BY s.memory_id
                ORDER BY
                    (
                        w.superseded_by IS NULL
                        AND w.is_tombstone = false
                        AND w.valid_until IS NULL
                    ) DESC,
                    w.created_at,
                    w.memory_id
            ) AS winner_rank
          FROM sidecar s
          JOIN coord.memory_records w
            ON {_WINNER_JOIN_ON}
    ),
    winner AS (
        SELECT
            s.memory_id AS sidecar_id,
            r.winner_id
          FROM sidecar s
          LEFT JOIN winner_ranked r
                 ON r.sidecar_id = s.memory_id
                AND r.winner_rank = 1
    )
"""


def upgrade() -> None:
    """Stamp, supersede/tombstone, and release the adjudicated sidecars."""
    _assert_no_drift()
    conn = op.get_bind()

    total_sidecars = (
        conn.execute(
            sa.text(
                f"""
                SELECT count(*)
                  FROM coord.memory_records
                 WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
                """
            )
        ).scalar()
        or 0
    )

    # ------------------------------------------------------------------
    # 0. Rows neither rule maps. Reported BEFORE anything is written, and
    #    then excluded from every statement below: an unmapped sidecar is
    #    an unadjudicated sidecar, so it keeps its hold and its validity.
    # ------------------------------------------------------------------
    unmapped = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE}
            SELECT memory_id, tenant_id, project, base_file, sidecar_file
              FROM resolved
             WHERE disposition IS NULL
             ORDER BY project, sidecar_file
            """
        )
    ).all()
    for row in unmapped:
        logger.error(
            "memhold_adjudicate_01: UNMAPPED sidecar row — memory_id=%s "
            "tenant_id=%s project=%s base_file=%s file=%s. No disposition in "
            "the manifest table and not an index file, so it is left HELD and "
            "untouched. Adjudicate it before this set is released.",
            row.memory_id,
            row.tenant_id,
            row.project,
            row.base_file,
            row.sidecar_file,
        )

    # ------------------------------------------------------------------
    # 1. Stamp the disposition — FIRST, because it is what preserves the
    #    pre-image. `prior_superseded_by` is the pointer consolidation's
    #    similarity heuristic chose (86 of the 138 rows carry one, often
    #    onto a synthesized mental_model); overwriting it in step 2
    #    without stashing it would destroy the very lineage the hold was
    #    put there to protect. `prior_is_tombstone` / `prior_valid_until`
    #    are stashed for the same reason — the downgrade restores all
    #    three from here.
    #
    #    `jsonb_build_object` renders a SQL NULL as JSON `null`, so a row
    #    that was never superseded stashes an explicit null rather than
    #    omitting the key.
    # ------------------------------------------------------------------
    stamped = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE}
            UPDATE coord.memory_records m
               SET source = jsonb_set(
                       m.source,
                       '{{adjudication}}',
                       jsonb_build_object(
                           'disposition', r.disposition,
                           'decided', CAST({_sql_str(_DECIDED_ON)} AS text),
                           'plan', CAST({_sql_str(_PLAN_SLUG)} AS text),
                           'gate', CAST({_sql_str(_GATE_ID)} AS text),
                           'prior_superseded_by', to_jsonb(m.superseded_by),
                           'prior_is_tombstone', to_jsonb(m.is_tombstone),
                           'prior_valid_until', to_jsonb(m.valid_until)
                       ),
                       true
                   )
              FROM resolved r
             WHERE m.memory_id = r.memory_id
               AND r.disposition IS NOT NULL
               AND m.source->'adjudication' IS NULL
            """
        )
    ).rowcount

    # ------------------------------------------------------------------
    # 2. Supersede the rows that HAVE a winner. This deliberately
    #    overrides `lifecycle_hold`, exactly as `mark_superseded` does —
    #    that override IS what landing an adjudication means. `valid_until`
    #    is only set where not already ended, so a row consolidation had
    #    already retired keeps its original supersession instant.
    # ------------------------------------------------------------------
    superseded = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE},
            {_WINNER_LINK_CTE}
            UPDATE coord.memory_records m
               SET superseded_by = w.winner_id,
                   valid_until = COALESCE(m.valid_until, now()),
                   updated_at = now()
              FROM winner w, resolved r
             WHERE m.memory_id = w.sidecar_id
               AND r.memory_id = m.memory_id
               AND r.disposition IS NOT NULL
               AND w.winner_id IS NOT NULL
               AND m.source->'adjudication' IS NOT NULL
               AND (
                    m.superseded_by IS DISTINCT FROM w.winner_id
                    OR m.valid_until IS NULL
               )
            """
        )
    ).rowcount

    # ------------------------------------------------------------------
    # 3. Tombstone the rows that have NO winner — the index-file sidecars.
    #    There is nothing to point them at, and the plan's verification
    #    criterion requires they leave the live surface. Any `superseded_by`
    #    consolidation gave them is left standing: it is still the honest
    #    record of what the heuristic chose, and step 1 stashed it either way.
    # ------------------------------------------------------------------
    tombstoned = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE},
            {_WINNER_LINK_CTE}
            UPDATE coord.memory_records m
               SET is_tombstone = true,
                   valid_until = COALESCE(m.valid_until, now()),
                   updated_at = now()
              FROM winner w, resolved r
             WHERE m.memory_id = w.sidecar_id
               AND r.memory_id = m.memory_id
               AND r.disposition IS NOT NULL
               AND w.winner_id IS NULL
               AND m.source->'adjudication' IS NOT NULL
               AND m.is_tombstone = false
            """
        )
    ).rowcount

    # ------------------------------------------------------------------
    # 4. Release the hold on the sidecars — and ONLY the sidecars. Written
    #    as an explicit JSON `false`, the value memhold_backfill_01
    #    reserved for "adjudicated and released"; its own downgrade keys on
    #    the value being `true` precisely so this marker survives a
    #    rollback of that revision.
    # ------------------------------------------------------------------
    released = conn.execute(
        sa.text(
            f"""
            UPDATE coord.memory_records
               SET source = jsonb_set(
                       source, '{{lifecycle_hold}}', 'false'::jsonb, true
                   )
             WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
               AND source->'adjudication' IS NOT NULL
               AND source->'lifecycle_hold' IS DISTINCT FROM 'false'::jsonb
            """
        )
    ).rowcount

    # ------------------------------------------------------------------
    # 5. The winners KEEP their hold. Nothing to write — this counts them,
    #    so the log carries positive evidence of the asymmetry rather than
    #    an unverified claim in a docstring.
    # ------------------------------------------------------------------
    held_winners = (
        conn.execute(
            sa.text(
                f"""
                WITH sidecar AS ({_SIDECAR_KEY_CTE})
                SELECT count(*)
                  FROM coord.memory_records w
                 WHERE {_WINNER_MATCH}
                   AND lower(w.source->>'lifecycle_hold') = 'true'
                """
            )
        ).scalar()
        or 0
    )

    logger.info(
        "memhold_adjudicate_01: %d sync-conflict sidecar row(s) in scope; "
        "stamped %d with source.adjudication, superseded %d onto a topic-file "
        "winner, tombstoned %d with no winner, released the hold on %d. "
        "%d topic-file winner(s) REMAIN HELD by design — their corrected text "
        "is a follow-up through the memory API, so they are still "
        "pre-adjudication content. %d sidecar row(s) could not be mapped to a "
        "disposition and were left untouched and held. Measured expectations "
        "(prod 2026-07-30 / manifest 2026-08-01): %d in scope, %d superseded, "
        "%d tombstoned, %d winners held, 0 unmapped — a difference is worth "
        "reading, not necessarily a fault. A re-run reports 0/0/0/0.",
        total_sidecars,
        stamped,
        superseded,
        tombstoned,
        released,
        held_winners,
        len(unmapped),
        _EXPECTED_SIDECARS,
        _EXPECTED_SUPERSEDED,
        _EXPECTED_TOMBSTONED,
        _EXPECTED_HELD_WINNERS,
    )


def downgrade() -> None:
    """Restore the pre-adjudication lifecycle state from the stash.

    Faithful for ``superseded_by``, ``is_tombstone`` and ``valid_until``.
    NOT faithful for ``updated_at`` (overwritten with ``now()`` by
    ``upgrade()``, pre-image not stashed), and unable to undo either the
    memory-API content follow-up or a ``decay_prune`` that ran after the hold
    was released. See the module docstring.
    """
    _assert_no_drift()
    conn = op.get_bind()

    # 1. Lifecycle columns, from the stash. `->>` on a JSON `null` yields SQL
    #    NULL, so a row that was never superseded restores to NULL.
    restored = conn.execute(
        sa.text(
            f"""
            UPDATE coord.memory_records m
               SET superseded_by = CAST(
                       m.source->'adjudication'->>'prior_superseded_by' AS uuid
                   ),
                   is_tombstone = COALESCE(
                       CAST(
                           m.source->'adjudication'->>'prior_is_tombstone'
                           AS boolean
                       ),
                       false
                   ),
                   valid_until = CAST(
                       m.source->'adjudication'->>'prior_valid_until'
                       AS timestamptz
                   ),
                   updated_at = now()
             WHERE m.source->>'origin' = '{_SIDECAR_ORIGIN}'
               AND m.source ? 'adjudication'
            """
        )
    ).rowcount

    # 2. Re-hold and drop the stamp. The rows carrying an `adjudication` key are
    #    exactly the rows upgrade() released, so this cannot re-hold anything it
    #    did not free.
    reheld = conn.execute(
        sa.text(
            f"""
            UPDATE coord.memory_records
               SET source = jsonb_set(
                       source, '{{lifecycle_hold}}', 'true'::jsonb, true
                   ) - 'adjudication'
             WHERE source->>'origin' = '{_SIDECAR_ORIGIN}'
               AND source ? 'adjudication'
            """
        )
    ).rowcount

    logger.info(
        "memhold_adjudicate_01 downgrade: restored superseded_by / "
        "is_tombstone / valid_until on %d row(s) from source.adjudication, "
        "re-held and dropped the stamp on %d. updated_at is NOT restored, and "
        "neither the memory-API content follow-up nor a decay_prune that ran "
        "after the release can be undone from here.",
        restored,
        reheld,
    )
