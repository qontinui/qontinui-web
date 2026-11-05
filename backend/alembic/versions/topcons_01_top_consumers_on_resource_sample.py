"""coord.device_resource_samples.top_consumers jsonb column

Revision ID: topcons_01
Revises: pr_events_mergeability_head_idx_01
Create Date: 2026-11-05

Phase 4 of plan
``2026-11-05-devops-a-host-commit-climb-to-99-7-percent-names-no-consumer-and-reads-ok-two-minutes-out``
(design decision D2).

coord authors **zero** DDL (``[policy: production-and-cost
alembic-sole-authorship]``), and the R16 cut-over that moves coord's schema
into the coord repo has not landed, so the column coord will ingest, store
and serve lands here, in qontinui-web. Hand-authored; ``alembic revision
--autogenerate`` was not run and is never run against ``coord.*``.

Why this column exists
======================

On 2026-11-05 the Windows host ``spaceship`` (device
``c79a07d5-7e40-49b4-87fa-554c749f9644``, 326 GB commit limit) climbed from a
commit ratio of about 0.66 to **0.997** between roughly 14:17Z and 14:31:05Z,
then fell back to 0.927 by 14:32:18Z. Roughly 110 GB of commit was consumed
and released, and no coord surface could name the process that held it:
``coord.device_resource_samples`` carries machine totals (``commit_*``,
``mem_*``, ``swap_*``, the kernel gauges, ``os_process_count``) and the
runner's OWN ``thread_count``, but no field naming any other process. CI and
supervisor builds were ruled out (``ci_jobs_running``, ``build_slots_busy``
and ``build_queue_depth`` were all 0), so the consumer was an interactive or
agent process, or something outside the runner's view.

What this adds, and to what
===========================

One nullable column on ``coord.device_resource_samples`` (plan D2), the
host-lane reading the runner's ``collect_host_lane`` will publish through the
existing resource-sample pipe (plan D1 / Phase 3):

```text
top_consumers   JSONB
```

Its shape, as plan D1 defines it::

    {"entries": [{"pid": 1234, "name": "node.exe",
                  "private_bytes": 61234567890,
                  "started_at": "2026-11-05T14:16:02Z"}],
     "scanned": 812, "unreadable": 37,
     "attributed_private_bytes": 98765432100}

``entries`` is at most 5 items by private bytes descending; ``scanned`` and
``unreadable`` are the completeness counts without which a top-5 that misses
the real consumer reads the same as one that names it. Windows basis is
``PROCESS_MEMORY_COUNTERS_EX.PrivateUsage`` (per-process commit charge);
Linux basis is ``RssAnon + VmSwap``. Command lines are NOT published (they
carry secrets); ``name`` is the image name only.

The shape is validated app-side by coord's lenient decoder + sanitizer (plan
Phase 5, modelled on ``device_resource_kernel_gauges.rs``), not by a CHECK:
a CHECK would be a second door on the same input and would make every
reshaping of the payload a migration. ``name`` must be sanitized to printable
text before binding, because Postgres jsonb rejects a NUL (U+0000) escape
with 22P05, which would drop the whole multi-row INSERT.

NULL semantics — never an empty list
====================================

The column is NULL when the publisher predates the field, or when the read
failed. A NULL must never be read, graded or rendered as "no consumers":
it renders as UNKNOWN (``[policy: verification-and-evidence
unknown-must-not-render-as-a-default]``). Rows written before this revision
keep NULL, which is the honest record that no reading existed. The column is
nullable with no default, so the ADD is a catalogue update with no table
rewrite. Retention is unchanged: the column rides ``prune_samples``' rolling
window on ``sampled_at`` (``COORD_DEVICE_RESOURCE_SAMPLE_RETENTION_DAYS``).

Deploy ordering
===============

**coord may deploy on either side, but only through its readiness gate.**
coord drops unknown sample keys with a warning, but an INSERT naming a column
the database lacks fails 42703 and drops the WHOLE push. Plan D2 therefore
puts this column in a ``consumers`` schema-readiness group: coord's INSERT
names it, and its reads project it, only once its schema-readiness probe
observes it ``Present``; until then reads project a typed NULL. The coord
consumer PR (plan Phase 5) is additionally held with ``migration_order``
until this revision is verified live in prod.

This revision arms nothing: no code writes or reads this column yet.

Every ``op.execute`` below takes ONE static string literal, because coord's
migration classifier (``pr_merge/migration_classifier.rs``) reads only static
literals and holds a revision whose SQL it cannot see. Both ``upgrade()`` and
``downgrade()`` open with ``SET LOCAL lock_timeout = '3s'``, the house lock
bound and the one SET form that classifier admits.

The down_revision below is the single alembic head of the branch base at
authoring time. If ``alembic-heads-pr`` reports ``HEAD_COUNT=2`` after this
lands, re-point this line and ``_PARENT_REVISION_ID`` in
``tests/test_topcons_01_top_consumers_on_resource_sample_migration.py``
together.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "topcons_01"
down_revision: str | Sequence[str] | None = "pr_events_mergeability_head_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SAMPLE_TABLE = "coord.device_resource_samples"

# The column, as data; the migration test pins its name and DDL type against
# this tuple, and checks that the static SQL below adds, comments and drops
# exactly it. The SQL spells the same column as a STATIC literal because
# coord's migration classifier can only inspect static op.execute literals.
_TOP_CONSUMER_COLUMNS: tuple[tuple[str, str], ...] = (("top_consumers", "JSONB"),)


def upgrade() -> None:
    """Add the nullable ``top_consumers`` sample column.

    `alembic/env.py` runs this inside `context.begin_transaction()` and
    PostgreSQL DDL is transactional, so the ALTER and its COMMENT commit
    together or not at all.
    """
    # Bound the ACCESS EXCLUSIVE lock wait first (house style): a QUEUED lock
    # request blocks every reader of the table behind it. `alembic/env.py`
    # restores lock_timeout after each revision, so no restore is needed here.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS top_consumers JSONB
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.top_consumers IS
            'Host-lane top commit consumers at sample time (plan '
            '2026-11-05-devops-a-host-commit-climb-to-99-7-percent-names-no-consumer-and-reads-ok-two-minutes-out, '
            'D1/D2), as {entries: [{pid, name, private_bytes, started_at}], '
            'scanned, unreadable, attributed_private_bytes}. entries is at '
            'most 5, by private bytes descending. Windows: '
            'PROCESS_MEMORY_COUNTERS_EX.PrivateUsage; Linux: RssAnon + VmSwap. '
            'name is the image name only, never a command line, and writers '
            'must sanitize it to printable text before binding, because '
            'Postgres jsonb rejects a NUL (U+0000) escape with 22P05, which '
            'would drop the whole multi-row INSERT. NULL = the publisher '
            'predates the field or the read failed; render it as UNKNOWN, '
            'never as an empty list standing in for no consumers.'
        """
    )


def downgrade() -> None:
    """Drop the column upgrade() added. Exact reverse.

    The COMMENT goes with its column. The DROP is a static literal inside
    this function body, out of the upgrade-path drop scan.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS top_consumers
        """
    )
