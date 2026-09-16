"""coord.device_resource_samples — restart readiness and drain wind-down

Revision ID: drr_01
Revises: partdel_01
Create Date: 2026-09-13

Phase 5 of plan
``2026-09-13-drained-runner-never-reaches-idle`` (design decision D8).

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the seven
columns coord's Phase 6 ingest writes and the web's Runners surface reads land
here, in qontinui-web, and this revision must merge **before** the coord PR that
reads them. Hand-authored; ``alembic revision --autogenerate`` was not run and
is never run against ``coord.*``.

Why these columns exist
=======================

A runner that has been drained (coord's ``POST /coord/fleet/drain``, a dispatch
filter) stops receiving new work but has no way to *reach* idle: finished
terminal-hosted sessions stay open, and the runner's own
``GET /restart-readiness`` keeps answering unsafe. Plan D4/D5 give the runner a
wind-down that sends a graceful ``/exit`` to sessions which are declared
``finished`` AND idle, and never kills a live ``claude``. What was missing is a way for an
operator to SEE that verdict from the web — coord has no path to a runner's
loopback API and no restart-readiness knowledge of its own.

D8 settles the transport: the runner already POSTs
``/coord/devices/{id}/resource-sample`` every 30 s, and this table already
carries ``thread_count`` / ``active_terminal_sessions`` from that push
(``lasac_01``). Readiness is a fact about the same machine at the same instant,
published by the same loop, so it rides the same row. An inbound
coord→runner relay was rejected because it would be a new remote-execution door
into every runner.

The columns:

* ``readiness_safe`` (BOOLEAN) — the runner's own ``safe_to_restart`` verdict.
* ``readiness_reason`` (TEXT) — the runner's reason string for that verdict.
* ``readiness_blocking`` (INTEGER) — sessions currently blocking a restart.
* ``readiness_finished`` (INTEGER) — sessions declared ``finished``.
* ``wind_down_candidates`` (INTEGER) — sessions the wind-down considers
  (close-eligible or in grace), per D4.
* ``wind_down_exit_stuck`` (INTEGER) — sessions whose graceful ``/exit`` did not
  take within the deadline and were LEFT RUNNING, per D5.
* ``wind_down_sessions`` (JSONB) — a bounded array of
  ``{claude_code_session_id, blocks_restart, idle_state, close_eligible_at?,
  exit_stuck}``, with truncation stated in the payload, never silent.

Not a new table, and not a new endpoint
=======================================

The argument ``lasac_01`` and ``fleet_res_tel_01`` already won on this table: a
second table or endpoint would fork the sampling clock, the tenant scoping, the
retention prune and the freshness gate for no gain. The lane semantics are
inherited unchanged: a row is per ``(device_id, lane, lane_instance)``, and
these columns are **never summed across lanes**.

NULL is not zero, and NULL is not "safe"
========================================

Every column is nullable with no default, inheriting ``fleet_res_tel_01``'s rule
verbatim: *"A publisher reports what it can probe and omits what it cannot; a
probe that fails must degrade to NULL, never to a fabricated zero."* Every row a
runner build predating Phase 7 sends omits all seven, and that row must read
**UNKNOWN**:

* ``readiness_safe`` NULL is UNKNOWN, and it must never be defaulted to either
  boolean. Defaulted to ``true`` it tells an operator a runner with live work is
  safe to restart — the exact loss served policy ``production-and-cost``
  ``runner-lifecycle`` exists to prevent. Defaulted to ``false`` it is a
  fabricated refusal that hides the fact that nothing was measured.
* ``readiness_blocking = 0`` and ``wind_down_exit_stuck = 0`` read as "nothing is
  in the way", which is the state that invites a restart. A ``DEFAULT 0`` would
  write that into every row an older runner sends.
* ``wind_down_sessions`` NULL means "not probed"; an empty array ``[]`` means
  "probed, nothing is winding down". Those are different facts and the column
  keeps them apart.

Freshness is the consumer's obligation, and D8 states it: the web renders a
sample older than 3 minutes as **UNKNOWN**, never as the last verdict it saw.

``INTEGER``, not ``BIGINT``
===========================

The four counters join the ``build_slots_busy`` / ``ci_jobs_running`` /
``active_terminal_sessions`` counter group, which coord reads as
``Option<i32>``. tokio-postgres treats a width mismatch as a **runtime type
error** (a panic out of ``row.get``), not a widening, so the width is an
interface with the coord read. The coord side **must** read these four as
``Option<i32>``, ``readiness_safe`` as ``Option<bool>``, ``readiness_reason`` as
``Option<String>`` and ``wind_down_sessions`` as ``Option<serde_json::Value>``.
The range does not argue for ``BIGINT`` either: these count one process's
terminal sessions, which the runner's continuation-session cap and its thread
pool bound far below 2^31.

No CHECK on any column
======================

Same reasoning ``lasac_01`` and ``fleet_res_tel_04`` gave: ingest is best-effort
by contract, and a CHECK violation fails the **whole INSERT**, discarding the
memory, disk, saturation and spawn-capacity metrics sharing that row. That
includes a length CHECK on ``wind_down_sessions``: the bound on that array is
enforced app-side at the door (Phase 6 caps its length at ingest), the same
split this table already draws between its CHECKed ``lane`` and its free-text
``source``.

Retention — why a JSONB column here is bounded
==============================================

This is the first JSONB column on the table, so the plan asks for the retention
posture to be stated rather than assumed. As read on qontinui-coord
``origin/main`` on 2026-09-13:

* **A prune exists.** ``device_resource_samples::prune_samples`` runs
  a ``DELETE`` of every row whose ``sampled_at`` is older than the retention
  window (``PRUNE_SQL``), wired into coord's leader-gated
  pruner loop in ``main.rs`` beside the ``device_status`` and worktree-census
  prunes. It is a GLOBAL pass keyed on ``sampled_at`` alone, which is the shape
  ``fleet_res_tel_01`` required so rows with a NULL ``tenant_id`` are pruned too.
* **The window is 7 days by default** (``DEFAULT_RETENTION_DAYS``), set per coord
  deployment by ``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``; a non-finite or
  non-positive value falls back to the default rather than being read literally.
* **The per-tenant knob is stored but not consumed by the prune.**
  ``coord.fleet_runtime_policy.sample_retention_days`` (``fleet_res_tel_03``) is
  validated to ``1..=90`` by ``fleet_policy.rs``, but ``prune_samples`` reads
  only the env window; the narrowing per-tenant pass ``fleet_res_tel_01``
  describes is not implemented. It could only ever SHORTEN the window, so it
  does not change the bound below.

The per-row size of ``wind_down_sessions`` is bounded by design by the runner's
continuation-session cap — ``DEFAULT_CONTINUATION_SESSION_CAP = 64`` in
``qontinui-runner``'s ``agent_runtime.rs``. That cap is operator-overridable
(``QONTINUI_CONTINUATION_SESSION_CAP``), so it is not a hard bound on its own;
the enforced bound is Phase 6's ingest length cap. At 64 entries of roughly
200 bytes the value is ~13 KB (TOASTed, off the main heap). Worst case, a lane
publishing every 30 s over the 7-day window keeps ~20,160 rows, ~260 MB for that
one lane-week if every sample carried a full array. In practice the array is
``[]`` on any probed runner that is not draining (NULL only on a runner that
cannot report), and a drain is transient, so
the steady-state cost is near zero. The table stays bounded by the prune above
— it is a sample table, not a metrics platform.

Degrade obligation on the coord side
====================================

Unchanged from ``fleet_res_tel_01`` / ``lasac_01``: the coord PR that reads these
columns must degrade on a missing column (``pg_error::is_missing_schema_object``,
SQLSTATE 42703), so a coord deploy that lands ahead of this migration fails open.
Because that helper swallows 42703, a **typo'd column name idles forever with no
error** — the seven names below are an interface and the coord side must match
them exactly.

No new index
============

These columns are read on rows the anchor index
(``idx_device_resource_samples_anchor_sampled``) already selects — the newest
sample per device. Nothing filters or orders *by* them. An extra index on an
append-only table written every 30 s would cost maintenance on every insert to
serve no query.

No ``coord.sessions`` and no ``session_events`` migration
=========================================================

Recorded here so a reader does not go looking for the missing half. Session
origin (D7) is stamped into the existing ``coord.sessions.intent`` JSONB as
``intent.spawn_origin`` and validated by coord on create — an existing field
fits, so there is no column and no CHECK. Operator actions (D9) are
``control_request`` / ``control_result`` rows in ``coord.session_events``, whose
``event_kind`` is plain ``TEXT NOT NULL`` with no CHECK, so they need no DDL.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. Every column is nullable with no default, so
each ADD is a catalogue update with no table rewrite.

``IF NOT EXISTS`` is **type-blind** — it matches on name alone, so a column of
the right name and wrong type makes the ADD a silent no-op and leaves the wrong
type in place, where ``row.get`` will **panic** rather than return a degradable
SQLSTATE. Re-running ``upgrade()`` is not a repair for that; fix it with an
explicit ``ALTER COLUMN … TYPE`` in a new revision.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "drr_01"
down_revision: str | Sequence[str] | None = "partdel_01"  # fmt: skip
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# `# fmt: skip` above is NO LONGER load-bearing, and is kept only because
# removing it would be a no-op edit to a landed revision. `DOWN_RE` in
# `scripts/ci/_alembic_graph.py` used to read one line at a time, so the
# parenthesised form ruff format produces for an over-88-column assignment
# parsed as NO parent and `alembic-heads-pr` reported a phantom second head.
# That limit was CLOSED (see the "FORMER PARSE LIMIT, now closed" note there);
# the gate now parses the wrapped form, so a re-point onto a longer head id is
# safe with or without this marker.

# down_revision is the LOCAL CHAIN HEAD at authoring time
# (`scripts/ci/count_alembic_heads.py` -> HEAD_COUNT=1), not `lasac_01`, whose
# column group this extends. Pointing at a non-head would fork the graph, and
# the `alembic-heads-pr` job in `alembic-graph-pr.yml` (a required check) fails
# the PR for that.
#
# The head can MOVE between authoring and landing. If `alembic-heads-pr` reports `HEAD_COUNT=2`, re-point this line AND
# `_PARENT_REVISION_ID` in `tests/test_drr_01_readiness_on_resource_sample_migration.py`
# together — that is the gate working as designed.

_TABLE = "coord.device_resource_samples"

# The seven columns, as data. This tuple is the interface the migration test pins
# (names and DDL types); the SQL below spells the same seven as STATIC string
# literals, and the test asserts the two agree statement by statement.
#
# Why the SQL is not generated from this tuple, as `lasac_01` and
# `fleet_res_tel_05` do: coord merge-train migration classifier
# (`qontinui-coord` `crates/coord/src/pr_merge/migration_classifier.rs`,
# `classify_op`, the `"execute"` arm) extracts string literals from the
# argument of each execute call and rejects a call with none as
# "op.execute with no static SQL string literal (dynamic = unsafe)". A static
# literal is the only op.execute shape it can inspect at all.
#
# INTEGER, not BIGINT, for the four counters: they join the counter group coord
# reads as `Option<i32>`. See the module docstring. The width is an interface
# with the coord read, not a range judgement.
_READINESS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("readiness_safe", "BOOLEAN"),
    ("readiness_reason", "TEXT"),
    ("readiness_blocking", "INTEGER"),
    ("readiness_finished", "INTEGER"),
    ("wind_down_candidates", "INTEGER"),
    ("wind_down_exit_stuck", "INTEGER"),
    ("wind_down_sessions", "JSONB"),
)


def upgrade() -> None:
    """Add the seven readiness / wind-down columns to coord.device_resource_samples."""
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS readiness_safe BOOLEAN,
            ADD COLUMN IF NOT EXISTS readiness_reason TEXT,
            ADD COLUMN IF NOT EXISTS readiness_blocking INTEGER,
            ADD COLUMN IF NOT EXISTS readiness_finished INTEGER,
            ADD COLUMN IF NOT EXISTS wind_down_candidates INTEGER,
            ADD COLUMN IF NOT EXISTS wind_down_exit_stuck INTEGER,
            ADD COLUMN IF NOT EXISTS wind_down_sessions JSONB
        """
    )

    # Column comments carry what a name cannot: that NULL is UNKNOWN and never
    # a verdict, that the counters are a snapshot of one runner process, and
    # what bounds the JSONB array. The psql describe-table output is where a
    # human meets this schema; the docstring above ships nowhere they will see it.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.readiness_safe IS
            'The publishing runner''s own GET /restart-readiness '
            'safe_to_restart verdict at sample time (plan '
            '2026-09-13-drained-runner-never-reaches-idle, D8). NULL = UNKNOWN '
            '(a runner build that predates the field, or a readiness probe '
            'that failed) and must NEVER be defaulted to true or false: true '
            'tells an operator a runner with live work is safe to restart, '
            'false fabricates a refusal nothing measured. A consumer renders a '
            'sample older than 3 minutes as UNKNOWN too, never as its last '
            'verdict.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.readiness_reason IS
            'The runner''s reason string for readiness_safe, verbatim. NULL = '
            'not probed. Free text with no CHECK: an unrecognised reason must '
            'reach the operator rather than fail the best-effort INSERT and '
            'discard the other metrics on this row.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.readiness_blocking IS
            'Sessions on the publishing runner that block a restart at sample '
            'time. NULL = not probed, NEVER 0: a fabricated 0 reads as nothing '
            'in the way, which is exactly the state that invites a restart. '
            'INTEGER because coord reads this counter group as Option<i32>.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.readiness_finished IS
            'Sessions on the publishing runner whose coord session_status is '
            'finished at sample time. finished is a DECLARATION, never an '
            'inference (plan D4). NULL = not probed, never 0. INTEGER, read as '
            'Option<i32>.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.wind_down_candidates IS
            'Sessions the drain wind-down is considering at sample time: '
            'finished AND idle, close-eligible or still inside the grace '
            'period (plan D4). NULL = not probed, NEVER 0; a runner that is '
            'probed and not draining reports 0. INTEGER, read as Option<i32>.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.wind_down_exit_stuck IS
            'Sessions whose graceful /exit did not end claude within the '
            'deadline and were LEFT RUNNING, never killed (plan D5). Each one '
            'still blocks a restart and needs an operator. NULL = not probed, '
            'NEVER 0: a fabricated 0 hides the sessions that need a human. '
            'INTEGER, read as Option<i32>.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.wind_down_sessions IS
            'Bounded JSONB array of per-session wind-down state, each '
            '{claude_code_session_id, blocks_restart, idle_state, '
            'close_eligible_at?, exit_stuck} (plan D8). NULL = not probed; [] '
            '= probed and nothing is winding down; the two are different facts. '
            'Length is bounded by design by the runner continuation-session '
            'cap (default 64, operator-overridable) and ENFORCED at coord '
            'ingest; truncation is stated in the payload, never silent. No '
            'CHECK on length, which would fail the whole best-effort INSERT. '
            'Growth over time is bounded by coord prune_samples (default '
            '7-day rolling window on sampled_at).'
        """
    )


def downgrade() -> None:
    """Drop the seven columns. Exact reverse of upgrade().

    The COMMENTs go with the columns — a column comment has no independent
    existence to drop.

    The DROP lives in this function body as a static literal. That keeps it
    out of `scripts/ci/check_coord_column_drops.py`'s upgrade-path scan, which
    skips the `downgrade()` body, and gives coord's migration classifier a
    literal it can read rather than a dynamic string.

    `_READINESS_COLUMNS` stays the single list the migration test checks both
    statements against, so the ADD and the DROP cannot drift into different
    sets.
    """
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS readiness_safe,
            DROP COLUMN IF EXISTS readiness_reason,
            DROP COLUMN IF EXISTS readiness_blocking,
            DROP COLUMN IF EXISTS readiness_finished,
            DROP COLUMN IF EXISTS wind_down_candidates,
            DROP COLUMN IF EXISTS wind_down_exit_stuck,
            DROP COLUMN IF EXISTS wind_down_sessions
        """
    )
