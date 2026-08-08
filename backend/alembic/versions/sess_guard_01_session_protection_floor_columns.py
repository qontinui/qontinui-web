"""Session-protection floors — on the parent AND the versions table, together

Revision ID: sess_guard_01
Revises: devenv_08_ci_node_config
Create Date: 2026-08-08

Part B item 1 of plan
``D:/qontinui-root/qontinui-dev-notes/plans/2026-08-07-runner-resource-guard-and-session-protection.md``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the four
columns its Part B code will read land here, in qontinui-web. This revision is
the direct successor of ``fleet_res_tel_03``'s seven §D1 controls: same two
tables, same one-shared-list shape, same NULL-means-no-override rule. Read that
revision's docstring first — everything it argues about types, nullability, the
``IF NOT EXISTS`` type-blindness trap and why both tables are widened in one
migration applies here verbatim. The two points restated below -- the
``IF NOT EXISTS`` type-blindness trap and the NULL-is-not-zero rule -- are
restated deliberately, because both are load-bearing for THESE columns
specifically: an 8 GiB floor does not fit an INTEGER, and a zero floor
disables the guard it names.

What this adds, and to what
===========================

Four columns, added to **both** ``coord.fleet_runtime_policy`` and
``coord.fleet_runtime_policy_versions``:

```text
min_free_bytes_sessions_host           BIGINT  NULL
min_free_bytes_sessions_wsl            BIGINT  NULL
min_free_bytes_sessions_critical_host  BIGINT  NULL
min_free_bytes_sessions_critical_wsl   BIGINT  NULL
```

What these are FOR — and why they are not the §D1 memory floors
===============================================================

``fleet_res_tel_03`` already added ``min_free_mem_bytes_host`` and
``min_free_mem_bytes_wsl``. Those govern **whether coord dispatches new CI or
build work to a machine** — a fleet-scheduling question, answered by a
scheduler, about work that has not started yet.

These four answer a different question, and it is the one the 2026-08-06→07
incident actually raised: **is this box safe enough to keep starting new
interactive sessions on?** Overnight, several Claude Code sessions running in
runner-spawned terminals died while their terminal windows stayed open and the
runner itself never restarted; Windows' Resource-Exhaustion-Detector fired 12
times between 00:00 and 05:29 naming ``vmmemWSL`` plus concurrent ``rustc.exe``
/ ``clippy-driver.exe``. Commit-charge exhaustion kills whatever process is
mid-allocation and leaves the non-allocating parent shell untouched — which is
exactly the reported symptom.

Three properties follow, and they are why reusing the §D1 floors would be
wrong rather than merely untidy:

* The question is **local**. It is about the machine the user is sitting at,
  not about a fleet ranking.
* It is **immediate**. The §A2 publish cadence plus a network round trip is far
  too slow for a decision taken at the moment a PTY is opened; a burst can blow
  the commit ceiling in seconds.
* It must be answerable **with no work being dispatched by anyone**. Last
  night's ``rustc.exe`` processes went through no dispatcher at all — they were
  ad hoc terminal builds. A floor that only a dispatcher consults would not have
  fired.

So these are separate columns with separate values, not a second reading of the
same number. A machine can be perfectly fine to *keep* sessions on while being
a poor choice to *send* a build to, and the reverse.

Two floors per lane, because a fleet default must not loosen a machine owner
============================================================================

Each lane gets a **warn** floor and a **critical** floor, and the consumer's
verdicts differ:

* below **warn** — surface a toast naming the lane, the current headroom and
  the configured floor, then **proceed with the spawn**;
* below **critical** — **block** the spawn and require an explicit override
  ("Start anyway"), never a silent refusal.

They are two columns rather than one column plus a hardcoded ratio because they
carry different verdicts and are tuned against different evidence, and because
the effective floor is
``max(local override, cached fleet default, hardcoded default)``: a machine
owner can only ever *tighten* their own protection, never loosen it. A single
fleet number that silently relaxed an owner's own block threshold is precisely
the failure that discipline exists to prevent. For the same reason NULL here is
load-bearing — see below.

Host and WSL are separate columns because they measure different pools, exactly
as the §D1 pair does: the ``_host`` floors are Windows **free commit** (the
quantity that went to 7.25 GB during the incident, and the one
``fleet::resource_sample::available_commit_bytes`` reads via
``GlobalMemoryStatusEx``), while the ``_wsl`` floors are the WSL lane's own
available memory, read inside the VM from ``/proc/meminfo``. Never sum the two
lanes.

A note on the ``_wsl`` pair, so its low traffic is not later mistaken for an
oversight: the runner's spawn-time gate deliberately reads the **host lane
only**, because the WSL probe forks ``wsl.exe`` under a 5 s timeout and a
pre-PTY gate that can stall five seconds on a cold or wedged WSL VM is a worse
user-facing failure than the one it prevents. The ``_wsl`` floors exist because
the lane pair is the schema's unit — the §D1 controls, the §A1 sample table and
``Lane::{Host, Wsl}`` are all lane-separated — and other consumers of the same
policy row (and the WSL-hosted self-hosted Actions runners) can read them
without a second migration. A lane-asymmetric control set would make "which
lane is this floor about?" unanswerable from the schema.

Types: BIGINT, and this is an interface, not a preference
=========================================================

All four are ``BIGINT`` because they are byte floors read on the coord side as
``Option<i64>`` off the row via ``row.get(...)`` — the same shape as
``FleetPolicyControls``' existing byte floors. An ``i64`` read off an
``INTEGER`` column is a **runtime type error in tokio-postgres, not a
widening**: it is not an SQLSTATE, so there is no ``ControlsSchema`` degrade
path and no 503 — ``from_row`` panics. Re-running ``upgrade()`` does not repair
a column of the wrong type either, because ``ADD COLUMN IF NOT EXISTS`` matches
on name alone; fix such a column with an explicit ``ALTER COLUMN … TYPE`` in a
new revision.

NULL means "no override", never zero
====================================

Every column is nullable with no default, and the distinction is not cosmetic:
**a zero floor disables the guard it names.** "No override, use the built-in
conservative default" and "never warn, never block" are opposite instructions,
and a schema that cannot tell them apart will eventually be handed a 0 by
someone who meant the first. That fact is carried in every
``COMMENT ON COLUMN`` below, for the same reason ``fleet_res_tel_03`` carries
it: a column name cannot say it.

Snapshot rows written before this revision keep NULLs, and no backfill is
wanted. While the columns did not exist no override could have been in force,
so "no override" is not an approximation of that history — it *is* that
history.

Ordering: this migration lands FIRST, coord's read is a separate, later PR
=========================================================================

The coord-side consumer — ``CONTROL_COLS`` and ``FleetPolicyControls`` in
``qontinui-coord/src/fleet_policy.rs`` — is a **separate, later PR**, together
with ``validate()`` (which must reject negative floors and reject
``critical > warn``) and ``from_row``.

**Only the column-NAME lists compose. The parameter positions do not, and that
distinction is load-bearing.** ``d1_payload_cols()`` and ``policy_state_cols()``
build the name lists from ``CONTROL_COLS``, so ``RETURNING {cols}`` and the
``INSERT ... ({payload})`` target list widen on their own. Everything
positional is hand-written and must be extended in lockstep:

* ``insert_version_snapshot_tx`` carries a **literal**
  ``VALUES ($1, ..., $13)`` placeholder list and a hand-written
  ``params.extend_from_slice(&[...])`` bind array. Widening ``CONTROL_COLS``
  alone yields 17 target columns against 13 expressions, which PostgreSQL
  rejects at PREPARE time (``42601, INSERT has more target columns than
  expressions``) — so *every* fleet-policy write starts failing, including
  plain ``level`` / ``master_enabled`` edits that have nothing to do with
  session floors.
* The parent UPSERT composes only its ``RETURNING`` clause; its whole ``SET``
  list is hand-written at literal positions
  (``min_free_mem_bytes_host = $7`` ... ``sample_retention_days = $12``).
  Leaving it untouched makes the four new floors **silently discarded on
  write** while ``RETURNING`` reads them back as NULL — a write path that
  accepts a value and drops it, which is worse than one that errors.

Note also that ``d1_payload_cols()`` emits ``drain`` FIRST, so the bind order
is not the declaration order of this file's column tuple. Count the emitted
names and assert they equal the placeholder arity rather than eyeballing it.

**This revision must merge first.** coord and qontinui-web deploy
independently, and the asymmetry matters: a missing *table* is caught at boot by
``require_table``, but a missing **column** sails straight through boot and
fails at query time, on a live request, in production. ``fleet_res_tel_02``'s
docstring sets exactly this precedent for the ``_versions`` table — "this lands
here, in qontinui-web, and must merge BEFORE the coord PR that writes these
rows" — and this revision inherits it unchanged.

No ``coord:stacked-on`` / ``coord:upstream-of`` label is needed for that
ordering. coord derives migration ordering from the ``down_revision`` chain, not
from PR labels.

No CHECK constraints, and no backfill
=====================================

The invariants worth stating (``>= 0``; ``critical <= warn``) are validated
app-side in ``FleetPolicyControls::validate``, matching the stance
``fleet_res_tel_03`` takes for its own bounds: tunable operational policy is
validated at the door, because mirroring it into a CHECK buys a second door on
the same input while making a future widening a migration — and would
retroactively invalidate historical snapshots the day the allowed set moves.
Fixed vocabularies get a CHECK (``scope_band``); ranges do not. It is a
decision, not an omission.

Every column is nullable with no default, so each ADD is a catalogue update with
no table rewrite. It still takes a brief ``ACCESS EXCLUSIVE`` lock, which on a
table holding one row per (tenant, domain, scope) is immeasurable.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sess_guard_01"
down_revision: str | Sequence[str] | None = "devenv_08_ci_node_config"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The one column list, spelled once, so the parent and the snapshot cannot
# drift into carrying different payloads — the same rule (and the same shape)
# as `fleet_res_tel_03`'s `_CONTROL_COLUMNS`, which exists precisely so a table
# can never get a subset. The versions table's own COMMENT ON TABLE states it:
# a partial snapshot is an audit trail that lies while still reporting as
# versioned.
_SESSION_FLOOR_COLUMNS: tuple[tuple[str, str], ...] = (
    ("min_free_bytes_sessions_host", "BIGINT"),
    ("min_free_bytes_sessions_wsl", "BIGINT"),
    ("min_free_bytes_sessions_critical_host", "BIGINT"),
    ("min_free_bytes_sessions_critical_wsl", "BIGINT"),
)

_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so a table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _SESSION_FLOOR_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list."""
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _SESSION_FLOOR_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the four session-protection floors to the parent AND the versions table."""
    # Both tables, same loop, same list. Not two hand-written blocks: the whole
    # point of this shape is that the two lists are identical, and the cheapest
    # way to guarantee that is to have only one. `alembic/env.py` runs this
    # inside `context.begin_transaction()` and PostgreSQL DDL is transactional,
    # so both ALTERs commit or neither does.
    for table in _TABLES:
        op.execute(_add_columns(table))

    # Column comments carry the two facts a name cannot: which pool each floor
    # measures, and that NULL is "no override" rather than zero. A reader who
    # gets the second one wrong writes a 0 and disables the guard.
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy.min_free_bytes_sessions_host IS
            'WARN floor for starting new interactive sessions, measured on the '
            'Windows host lane free-commit pool (GlobalMemoryStatusEx), in '
            'bytes. Below it the runner warns and PROCEEDS with the spawn. '
            'Distinct from min_free_mem_bytes_host, which governs whether coord '
            'DISPATCHES new CI/build work here; this one governs whether the '
            'machine is safe to keep opening terminals on, and must be '
            'answerable locally with nothing dispatched by anyone. NULL = no '
            'override (consumers fall back to their built-in floor); 0 would '
            'DISABLE the warning, which is a different fact. Validated '
            'app-side (>= 0, and critical <= warn), not by a CHECK — see the '
            'revision docstring.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy.min_free_bytes_sessions_wsl IS
            'WARN floor for starting new interactive sessions, measured on the '
            'WSL lane''s own available memory (/proc/meminfo inside the VM), in '
            'bytes. Separate from the host floor because the two lanes measure '
            'different pools — never sum them. The runner''s spawn-time gate '
            'reads the HOST lane only (the WSL probe forks wsl.exe under a 5 s '
            'timeout, too slow for a pre-PTY decision); this column exists for '
            'the other consumers of this policy row and to keep the control set '
            'lane-symmetric. NULL = no override, not zero.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy.min_free_bytes_sessions_critical_host IS
            'CRITICAL floor for starting new interactive sessions, on the '
            'Windows host lane free-commit pool, in bytes. Below it the runner '
            'BLOCKS the spawn and requires an explicit "Start anyway" override '
            '— never a silent refusal. Paired with '
            'min_free_bytes_sessions_host (warn -> toast and proceed; critical '
            '-> block with override) and always <= it. NULL = no override, not '
            'zero: 0 disables the block entirely. A fleet default must never '
            'silently loosen a machine owner''s own protection, so the '
            'effective floor is max(local override, this, built-in default).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy.min_free_bytes_sessions_critical_wsl IS
            'CRITICAL floor for starting new interactive sessions, on the WSL '
            'lane''s own available memory, in bytes. Block-with-override '
            'verdict, the WSL-lane counterpart of '
            'min_free_bytes_sessions_critical_host, and always <= '
            'min_free_bytes_sessions_wsl. NULL = no override, not zero.'
        """
    )

    # The same four on the snapshot table. Generated from the one list rather
    # than restated, because restating them is how a snapshot column's
    # documented meaning drifts from its parent's — the documentation version of
    # the drift this shape exists to prevent. Without these,
    # `\\d+ coord.fleet_runtime_policy_versions` shows four bare columns beside
    # the commented §D1 ones, which reads as though they were an afterthought.
    for name, _ in _SESSION_FLOOR_COLUMNS:
        op.execute(
            f"COMMENT ON COLUMN coord.fleet_runtime_policy_versions.{name} IS "
            f"'Snapshot of coord.fleet_runtime_policy.{name} — see that column "
            f"for its meaning and for why NULL is not zero. Snapshot rows "
            f"written BEFORE revision sess_guard_01 carry NULL here: the column "
            f"did not exist, so no override could have been in force, and NULL "
            f"is the honest record of that history rather than a gap to be "
            f"backfilled. Immutable: never UPDATE or DELETE a row here.'"
        )


def downgrade() -> None:
    """Drop the four columns from both tables. Reverse of upgrade().

    Both tables again, and for the same reason: leaving the snapshot columns
    behind after removing the parent's would produce a versions table that can
    hold payload the parent cannot — the mirror image of the defect the
    widen-both-together rule exists to prevent, and just as invisible.
    """
    for table in _TABLES:
        op.execute(_drop_columns(table))
