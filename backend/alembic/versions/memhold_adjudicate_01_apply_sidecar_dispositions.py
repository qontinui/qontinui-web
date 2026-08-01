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
2. **Supersedes** each CONTENT-dispositioned row (``winner`` / ``merged`` /
   ``loser``) that has a topic-file winner onto that winner, and ends its
   validity. This is the explicit adjudication supersede: it deliberately
   overrides ``lifecycle_hold``, exactly as ``memory_store.mark_superseded``
   does (see that function's docstring — the hold is honoured at the AUTOMATIC
   callers' selectors, never here).
3. **Tombstones** each ``index-merge-artifact`` row and ends its validity.
4. **Releases the hold** on the ``winner`` and ``index-merge-artifact`` rows
   only, as an explicit JSON ``false`` — the value ``memhold_backfill_01``
   reserved to mean "adjudicated and released", which a presence-only check
   could not express.

📌 **The arms are keyed on the DISPOSITION, never on winner-presence.** Step 2
takes only rows whose disposition is NOT ``index-merge-artifact``; step 3 takes
only rows whose disposition IS. "Has a winner" and "is a content row" coincide
in the corpus measured on 2026-07-30 and nowhere else, and keying on the former
fails in both directions:

* a single ``'topic-file'`` row carrying ``source.file = 'MEMORY.md'`` and a
  NULL ``source.project`` matches the index sidecars of EVERY project
  directory, so all 113 of them would be superseded onto that one unrelated
  record — and the log would read ``tombstoned 0``, with nothing else to see;
* a content row whose winner is absent (never imported, or living in another
  tenant) would be tombstoned as though a human had decided it away. The
  manifest contains exactly such a row: ``pr-754-stale-cross-repo-dep-edge.md``
  is the single ``loser``, and its body is the text that WON.

A content-dispositioned row with NO winner is therefore **INERT** — not
superseded, not tombstoned, ``lifecycle_hold`` left ``true``, and logged at
ERROR with its identifying fields. That is the same treatment an unmapped row
gets, for the same reason. Symmetrically, an ``index-merge-artifact`` row that
unexpectedly HAS a winner is still TOMBSTONED — its disposition is
authoritative — and the surprise is logged at WARNING.

⚠️ **The hold comes off three ways, not two.**

* ``winner`` and ``index-merge-artifact`` sidecars are **released**
  (``lifecycle_hold = false``): their decision needs nothing further written,
  so they can rejoin the automatic lifecycle.
* ``merged`` and ``loser`` sidecars stay **HELD, pending the follow-up.**
  Their bodies are the INPUT to the content follow-up below — the 5 merged
  texts and the 1 loser-wins text are read FROM these rows — so freeing them
  for ``decay_prune`` before that follow-up runs would delete the input to the
  work this migration exists to enable. Same rationale that already keeps the
  11 winners held.
* content rows with no winner, and rows neither rule maps, stay **HELD and
  untouched** — they are not adjudicated at all.

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

⚠️ **Releasing the hold re-arms ``decay_prune``, and for many rows the grace
clock is RETROACTIVE.** Once ``valid_until`` is set and the hold is gone,
``decay_prune`` becomes free to physically DELETE each sidecar row (and with it
this ``adjudication`` stamp) 90 days after its supersession instant. Step 2
writes ``valid_until = COALESCE(m.valid_until, now())``, which deliberately
preserves the ORIGINAL instant on the 86 rows consolidation had already
retired — so their 90-day window started before this migration ran and, for the
oldest of them, may already have elapsed. For those rows "released" means
"collectable on the next sweep", not "collectable in 90 days". That is the
intended end-state for an adjudicated loser — the surviving record of the
decision is the manifest and the merged file bodies, not the row — but it is a
one-way door, so it is named here rather than left to be discovered. It is also
the second reason ``merged`` and ``loser`` rows keep their hold: those are
precisely the bodies the follow-up still has to read, and a retroactive clock
gives no margin at all.

How a row is mapped to a disposition
------------------------------------

Two rules, and nothing else:

* **Index rule (structural).** A sidecar whose base file is ``MEMORY.md`` or
  ``MEMORY-archive.md`` is ``index-merge-artifact``. These are the memory INDEX
  files; their divergences are merge artifacts of the retired 3-account sync,
  not competing knowledge. 55 of the 67 events and **113 of the 138 rows** are
  this case, and — measured — they have **no ``'topic-file'`` row at all**: the
  Phase-4a import never imported the index files as memories, so there is
  nothing to supersede them ONTO. They are the tombstone arm — by this
  disposition, not by that measurement; see the arm note above for why the
  distinction is the whole point.
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
winner's side) — are re-expressed here as :data:`_SIDECAR_ROW_CTE` and
:data:`_WINNER_JOIN_ON`. :func:`_assert_no_drift`, which runs at the top of
both ``upgrade()`` and ``downgrade()``, then asserts every atom of the row
selection is present in **both** sides: the constant imported from Phase 1b AND
the local fragment this revision's DML actually interpolates. Guarding only the
import would be guarding the string nobody here executes — deleting the tenant
equality from ``_WINNER_JOIN_ON``, or the project fallback from
``_SIDECAR_ROW_CTE``, would sail straight through it. Editing either side
without the other now fails the migration loudly instead of quietly addressing
a different row set.

Winner selection when a base file has more than one ``'topic-file'`` row (the
Phase-4a import ran twice), in order: prefer the row whose ``source.project``
EXACTLY matches the sidecar's, then a LIVE row — not superseded, not
tombstoned, validity not ended — then oldest ``created_at``, then
``memory_id``.

The project term is load-bearing precisely because the JOIN is not: it has to
accept a winner with a NULL project (the first import pass wrote none), which
makes a same-named file from ANOTHER project directory a candidate. Without an
exactness key ahead of liveness, that candidate can outrank the correct row on
``created_at`` alone. Unreachable in the corpus measured on 2026-07-30 — each
of the 9 content base filenames exists in exactly one project dir — and that
measurement was the only thing making the permissive join safe. Liveness comes
next because pointing a supersession at a dead row buries the lineage one hop
deeper for no gain.

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

# Atoms that must survive verbatim (whitespace-normalized) in BOTH the imported
# original AND the local fragment rewritten from it. A change on either side
# that these do not catch is a change that does not alter which rows are
# addressed.
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


def _drift_checks() -> tuple[tuple[str, tuple[str, ...], tuple[tuple[str, str], ...]], ...]:
    """(label, atoms, ((fragment name, fragment SQL), ...)) for the guard.

    Each atom is asserted against EVERY listed fragment: the imported Phase-1b
    constant AND the local rewrite this revision's DML actually interpolates.
    Guarding only the import leaves the executed strings unwatched — a deleted
    tenant equality or a nulled project fallback sails straight through.

    A function rather than a module constant so it reads the fragments as they
    are NOW, which is what lets a test mutate one and observe the guard fire.
    """
    return (
        (
            "sidecar key",
            _SIDECAR_ATOMS,
            (
                ("_SIDECAR_KEY_CTE (imported)", _SIDECAR_KEY_CTE),
                ("_SIDECAR_ROW_CTE (interpolated here)", _SIDECAR_ROW_CTE),
            ),
        ),
        (
            "winner match",
            _WINNER_ATOMS,
            (
                ("_WINNER_MATCH (imported)", _WINNER_MATCH),
                ("_WINNER_JOIN_ON (interpolated here)", _WINNER_JOIN_ON),
            ),
        ),
    )


def _assert_no_drift() -> None:
    """Fail loudly if this revision's row selection has parted from Phase 1b's.

    Every atom is checked against both the imported constant and the locally
    rewritten fragment, so the guard covers the SQL that actually runs and not
    merely the SQL that was copied from.
    """
    for label, atoms, fragments in _drift_checks():
        for name, fragment in fragments:
            normalized = _norm(fragment)
            for atom in atoms:
                if _norm(atom) not in normalized:
                    raise RuntimeError(
                        "memhold_adjudicate_01 has drifted from "
                        f"memhold_backfill_01's {label}: {atom!r} is no longer "
                        f"part of {name}. Reconcile the two before applying — "
                        "they must address the same rows."
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

# The dispositions whose hold comes OFF here. `merged` and `loser` are absent
# on purpose: their bodies are the input to the memory-API content follow-up,
# so freeing them for `decay_prune` would delete the text that follow-up has to
# read — and for the already-superseded ones the 90-day clock is retroactive,
# so "freed" can mean "collectable immediately". See the module docstring.
_RELEASED_DISPOSITIONS = ("winner", _INDEX_DISPOSITION)

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

# Measured against prod 2026-07-30 / manifest 2026-08-01. These are
# MEASUREMENTS, and they are LOGGED beside the actual counts rather than
# asserted: the row set can legitimately move between the day it was counted
# and the day this applies, so a difference here is something to READ, not
# something to abort a deploy on.
#
# The INVARIANTS are a different thing entirely and are asserted — see
# `_assert_arm_invariants`. Assert invariants, log measurements.
_EXPECTED_SIDECARS = 138
_EXPECTED_TOMBSTONED = 113
_EXPECTED_SUPERSEDED = 25
_EXPECTED_HELD_WINNERS = 11


def _assert_arm_invariants(
    *,
    stamped_rows: int,
    arm_supersede: int,
    arm_tombstone: int,
    arm_inert: int,
    content_tombstoned: int,
    index_superseded: int,
) -> None:
    """Abort the migration when a row took an arm its disposition forbids.

    Unlike the ``_EXPECTED_*`` counts above, none of these can move
    legitimately. Each one means the write arms and the adjudication disagree
    about what a row is, on a forward-only production migration whose writes
    are not recoverable by rollback — so each raises rather than logs, failing
    the deploy while the transaction can still be rolled back.

    Split out of :func:`upgrade` and given plain integer arguments so the
    conditions themselves are testable without a database.
    """
    arms = arm_supersede + arm_tombstone + arm_inert
    if arms != stamped_rows:
        raise RuntimeError(
            "memhold_adjudicate_01 INVARIANT VIOLATED: the write arms do not "
            f"partition the stamped set — superseded {arm_supersede} + "
            f"tombstoned {arm_tombstone} + skipped {arm_inert} = {arms}, "
            f"against {stamped_rows} row(s) carrying a disposition stamp. "
            "Every mapped sidecar must take exactly one arm."
        )
    if content_tombstoned:
        raise RuntimeError(
            "memhold_adjudicate_01 INVARIANT VIOLATED: "
            f"{content_tombstoned} row(s) with a CONTENT disposition were "
            f"tombstoned. Only '{_INDEX_DISPOSITION}' rows may be tombstoned; "
            "a content row whose winner is missing is INERT, never retired — "
            "the manifest's single 'loser' is a row whose body WON."
        )
    if index_superseded:
        raise RuntimeError(
            "memhold_adjudicate_01 INVARIANT VIOLATED: "
            f"{index_superseded} row(s) dispositioned '{_INDEX_DISPOSITION}' "
            "had superseded_by rewritten. Index rows are tombstoned, never "
            "superseded — one 'topic-file' row named after an index file would "
            "otherwise collapse every index sidecar in every project directory "
            "onto it, silently."
        )


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


def _released_dispositions_sql() -> str:
    return ", ".join(_sql_str(name) for name in _RELEASED_DISPOSITIONS)


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
# or NULL when it has none (the 113 index-file rows).
#
# Ranking, in order: EXACT PROJECT match first, then live winners, then oldest.
#
# The project term is what keeps the join's deliberate permissiveness from
# turning into a cross-project re-point. `_WINNER_JOIN_ON` accepts a winner
# whose `source.project` is NULL — it has to, because the first Phase-4a import
# pass wrote no project — but that arm makes a NULL-project row from a
# DIFFERENT project directory a candidate for this sidecar, and with liveness
# and `created_at` as the only keys it can outrank the exact-project match
# sitting right beside it. Not reachable in the corpus measured on 2026-07-30
# (each of the 9 content base filenames exists in exactly one project dir), and
# that measurement is the only thing that made the permissive join safe; this
# term is what makes it safe by construction. Only TRUE and NULL are reachable
# — a project MISMATCH cannot pass the join at all — so NULLS LAST puts the
# fallback arm behind the exact match, which is the whole point.
#
# Liveness next: pointing a supersession at a dead row buries the lineage for
# nothing.
_WINNER_LINK_CTE = f"""
    winner_ranked AS (
        SELECT
            s.memory_id AS sidecar_id,
            w.memory_id AS winner_id,
            row_number() OVER (
                PARTITION BY s.memory_id
                ORDER BY
                    (w.source->>'project' = s.project) DESC NULLS LAST,
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
    # 0b. Rows whose DISPOSITION and winner-presence disagree. Reported
    #     before anything is written, for the same reason as the unmapped
    #     rows — and, on the content arm, with the same outcome.
    #
    #     A content disposition with NO topic-file winner is INERT: there
    #     is nothing to supersede it onto, and tombstoning it would end the
    #     validity of a row a human decided to KEEP. The manifest's single
    #     `loser` (pr-754-stale-cross-repo-dep-edge.md) is exactly that
    #     shape — its body is the text that won — and a winner living in
    #     another tenant produces it too.
    # ------------------------------------------------------------------
    inert = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE},
            {_WINNER_LINK_CTE}
            SELECT r.memory_id, r.tenant_id, r.project, r.base_file,
                   r.sidecar_file, r.disposition
              FROM resolved r
              JOIN winner w
                ON w.sidecar_id = r.memory_id
             WHERE r.disposition IS NOT NULL
               AND r.disposition <> {_sql_str(_INDEX_DISPOSITION)}
               AND w.winner_id IS NULL
             ORDER BY r.project, r.sidecar_file
            """
        )
    ).all()
    for row in inert:
        logger.error(
            "memhold_adjudicate_01: INERT sidecar row — memory_id=%s "
            "tenant_id=%s project=%s base_file=%s file=%s disposition=%s. It "
            "carries a CONTENT disposition but has no 'topic-file' winner in "
            "its tenant, so there is nothing to supersede it onto. It is left "
            "HELD and untouched — NOT tombstoned: a content row whose winner "
            "is missing is an unfinished import, not an adjudicated loser. "
            "Import the winner (or correct the manifest) and re-run.",
            row.memory_id,
            row.tenant_id,
            row.project,
            row.base_file,
            row.sidecar_file,
            row.disposition,
        )

    # ------------------------------------------------------------------
    # 0c. The mirror surprise: an index-file sidecar that DOES have a
    #     topic-file winner. The disposition still wins — index rows are
    #     tombstoned, never superseded — but the Phase-1b measurement said
    #     zero 'topic-file' rows are named after an index file, so one
    #     appearing means the corpus moved and somebody should look.
    # ------------------------------------------------------------------
    index_with_winner = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE},
            {_WINNER_LINK_CTE}
            SELECT r.memory_id, r.tenant_id, r.project, r.base_file,
                   r.sidecar_file, w.winner_id
              FROM resolved r
              JOIN winner w
                ON w.sidecar_id = r.memory_id
             WHERE r.disposition = {_sql_str(_INDEX_DISPOSITION)}
               AND w.winner_id IS NOT NULL
             ORDER BY r.project, r.sidecar_file
            """
        )
    ).all()
    for row in index_with_winner:
        logger.warning(
            "memhold_adjudicate_01: index sidecar with an UNEXPECTED winner — "
            "memory_id=%s tenant_id=%s project=%s base_file=%s file=%s "
            "winner_id=%s. Measured 2026-07-30: no 'topic-file' row carries an "
            "index filename. It is TOMBSTONED anyway — the disposition is "
            "authoritative and superseding it would point an index merge "
            "artifact at a record that is not its winner — but the corpus has "
            "moved since the measurement.",
            row.memory_id,
            row.tenant_id,
            row.project,
            row.base_file,
            row.sidecar_file,
            row.winner_id,
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
    # 2. Supersede the CONTENT-dispositioned rows that have a winner. The
    #    arm is keyed on the DISPOSITION (`<> index-merge-artifact`) and
    #    only then on winner-presence: an index row that happens to have a
    #    matching 'topic-file' row must NOT come through here — see the
    #    module docstring for what one such row would do to all 113.
    #
    #    This deliberately overrides `lifecycle_hold`, exactly as
    #    `mark_superseded` does — that override IS what landing an
    #    adjudication means. `valid_until` is only set where not already
    #    ended, so a row consolidation had already retired keeps its
    #    original supersession instant (and, per the docstring, its
    #    already-running prune clock).
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
               AND r.disposition <> {_sql_str(_INDEX_DISPOSITION)}
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
    # 3. Tombstone the `index-merge-artifact` rows. Keyed on the
    #    disposition and NOT on winner-presence, in both directions: a
    #    content row with no winner is inert (step 0b), and an index row
    #    with a winner is still tombstoned (step 0c logged the surprise).
    #    The winner link is therefore not consulted here at all.
    #
    #    The plan's verification criterion requires these leave the live
    #    surface. Any `superseded_by` consolidation gave them is left
    #    standing: it is still the honest record of what the heuristic
    #    chose, and step 1 stashed it either way.
    # ------------------------------------------------------------------
    tombstoned = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE}
            UPDATE coord.memory_records m
               SET is_tombstone = true,
                   valid_until = COALESCE(m.valid_until, now()),
                   updated_at = now()
              FROM resolved r
             WHERE m.memory_id = r.memory_id
               AND r.disposition = {_sql_str(_INDEX_DISPOSITION)}
               AND m.source->'adjudication' IS NOT NULL
               AND m.is_tombstone = false
            """
        )
    ).rowcount

    # ------------------------------------------------------------------
    # 4. Release the hold — on the sidecars only, and among those only on
    #    the dispositions whose decision is fully landed:
    #      * `winner` / `index-merge-artifact` → RELEASED here;
    #      * `merged` / `loser`                → still HELD, because their
    #        bodies are the INPUT to the memory-API content follow-up and
    #        the prune clock on the already-superseded ones is retroactive;
    #      * content rows with no winner (step 0b) and unmapped rows (step
    #        0) → still HELD, because they were never adjudicated at all.
    #
    #    Written as an explicit JSON `false`, the value memhold_backfill_01
    #    reserved for "adjudicated and released"; its own downgrade keys on
    #    the value being `true` precisely so this marker survives a
    #    rollback of that revision.
    # ------------------------------------------------------------------
    released = conn.execute(
        sa.text(
            f"""
            WITH {_RESOLVED_CTE},
            {_WINNER_LINK_CTE}
            UPDATE coord.memory_records m
               SET source = jsonb_set(
                       m.source, '{{lifecycle_hold}}', 'false'::jsonb, true
                   )
              FROM resolved r, winner w
             WHERE m.memory_id = r.memory_id
               AND w.sidecar_id = m.memory_id
               AND m.source->'adjudication' IS NOT NULL
               AND r.disposition IN ({_released_dispositions_sql()})
               AND (
                    r.disposition = {_sql_str(_INDEX_DISPOSITION)}
                    OR w.winner_id IS NOT NULL
               )
               AND m.source->'lifecycle_hold' IS DISTINCT FROM 'false'::jsonb
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

    # ------------------------------------------------------------------
    # 6. The invariants. Counted from the END state over the same CTEs the
    #    arms are built from, so a re-run re-derives the same answers and
    #    the check is not a restatement of the rowcounts above (which are
    #    all 0 on a re-run). The `prior_*` values stashed in step 1 are what
    #    make "was this row moved BY THIS MIGRATION" answerable at all.
    #
    #    The three arm counters use independent predicates rather than one
    #    CASE, so an edit that makes two arms overlap — or leaves a mapped
    #    row with no arm — breaks the partition instead of being absorbed
    #    by an ELSE.
    # ------------------------------------------------------------------
    invariants = (
        conn.execute(
            sa.text(
                f"""
            WITH {_RESOLVED_CTE},
            {_WINNER_LINK_CTE}
            SELECT
                count(*) FILTER (
                    WHERE r.disposition IS NOT NULL
                      AND m.source->'adjudication' IS NOT NULL
                ) AS stamped_rows,
                count(*) FILTER (
                    WHERE r.disposition IS NOT NULL
                      AND r.disposition <> {_sql_str(_INDEX_DISPOSITION)}
                      AND w.winner_id IS NOT NULL
                ) AS arm_supersede,
                count(*) FILTER (
                    WHERE r.disposition = {_sql_str(_INDEX_DISPOSITION)}
                ) AS arm_tombstone,
                count(*) FILTER (
                    WHERE r.disposition IS NOT NULL
                      AND r.disposition <> {_sql_str(_INDEX_DISPOSITION)}
                      AND w.winner_id IS NULL
                ) AS arm_inert,
                count(*) FILTER (
                    WHERE r.disposition IS NOT NULL
                      AND r.disposition <> {_sql_str(_INDEX_DISPOSITION)}
                      AND m.is_tombstone
                      AND COALESCE(
                              CAST(
                                  m.source->'adjudication'->>'prior_is_tombstone'
                                  AS boolean
                              ),
                              false
                          ) = false
                ) AS content_tombstoned,
                count(*) FILTER (
                    WHERE r.disposition = {_sql_str(_INDEX_DISPOSITION)}
                      AND m.superseded_by IS DISTINCT FROM CAST(
                              m.source->'adjudication'->>'prior_superseded_by'
                              AS uuid
                          )
                ) AS index_superseded
              FROM resolved r
              JOIN winner w
                ON w.sidecar_id = r.memory_id
              JOIN coord.memory_records m
                ON m.memory_id = r.memory_id
            """
            )
        )
        .mappings()
        .one()
    )
    _assert_arm_invariants(
        stamped_rows=int(invariants["stamped_rows"]),
        arm_supersede=int(invariants["arm_supersede"]),
        arm_tombstone=int(invariants["arm_tombstone"]),
        arm_inert=int(invariants["arm_inert"]),
        content_tombstoned=int(invariants["content_tombstoned"]),
        index_superseded=int(invariants["index_superseded"]),
    )

    logger.info(
        "memhold_adjudicate_01: %d sync-conflict sidecar row(s) in scope; "
        "stamped %d with source.adjudication, superseded %d onto a topic-file "
        "winner, tombstoned %d index-merge-artifact row(s), released the hold "
        "on %d. %d topic-file winner(s) REMAIN HELD by design — their "
        "corrected text is a follow-up through the memory API, so they are "
        "still pre-adjudication content; the 'merged' and 'loser' sidecars stay "
        "held for the same reason, since that follow-up reads its input from "
        "them. %d content row(s) were left INERT (a disposition but no winner) "
        "and %d sidecar row(s) could not be mapped to a disposition at all — "
        "both left untouched and held. Invariants held: the arms partition the "
        "%d stamped row(s) as %d superseded / %d tombstoned / %d skipped, with "
        "0 content rows tombstoned and 0 index rows superseded. Measured "
        "expectations (prod 2026-07-30 / manifest 2026-08-01): %d in scope, "
        "%d superseded, %d tombstoned, %d winners held, 0 unmapped, 0 inert — "
        "those are measurements, so a difference is worth reading, not "
        "necessarily a fault. A re-run reports 0/0/0/0.",
        total_sidecars,
        stamped,
        superseded,
        tombstoned,
        released,
        held_winners,
        len(inert),
        len(unmapped),
        invariants["stamped_rows"],
        invariants["arm_supersede"],
        invariants["arm_tombstone"],
        invariants["arm_inert"],
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
