"""sentinel attempt key 01 -- coord.pr_check_runs.attempt_key persisted attempt identity

Revision ID: sentinel_attempt_key_01
Revises: coordtouch_01
Create Date: 2026-08-31

Phase 2 (schema half) of plan
``2026-08-31-coord-candidate-ci-sentinel-bucket-keeps-old-grain``. The read
half lands in qontinui-coord and MUST NOT ship before this migration -- coord
and qontinui-web deploy independently, and unlike a missing *table* (caught at
boot by ``require_table``) a missing *column* sails past boot and fails at
query time.

Why the column exists
=====================

``pr_merge/economics.rs`` derives a per-attempt grouping key on READ, by
parsing the GitHub Actions run id out of ``details_url``::

    coalesce(substring(details_url from 'actions/runs/([0-9]+)'), '')

Rows with no parseable run id collapse to the ``''`` sentinel, which groups
them together per ``head_sha`` -- the pre-fix grain that
``2026-08-27-coord-candidate-ci-envelope-spans-attempts`` removed for every
other row. The bucket is fed by a LIVE production writer, so it does not drain:
``ci_dispatch``'s authoritative-result path writes a synthetic check-run row
with ``details_url: None`` ("there is no GitHub webhook behind it"), and those
rows carry a constant check ``name``, so two dispatches on one ``head_sha``
share ``(repo, head_sha, name, run_id='')`` and the query's ``DISTINCT ON``
keeps only the newest -- the older dispatch's observation is lost. Measured
2026-08-31 on qontinui/qontinui-coord: 24-26% of every served candidate sample
sat in that bucket, at both a 12h and a 72h window, and the share is growing.

``attempt_key`` gives those rows a real attempt identity so they partition
correctly instead of fusing.

Shape, and why
==============

* ``coord.pr_check_runs.attempt_key TEXT`` -- **NULLABLE, no default.** This is
  deliberate and load-bearing. The read side is::

      coalesce(attempt_key, substring(details_url from 'actions/runs/([0-9]+)'), '')

  so NULL means exactly "no persisted attempt identity here, fall through to
  the URL parse", and every existing row keeps behaving precisely as it does
  today. A ``NOT NULL DEFAULT ''`` would instead make the ``coalesce`` short-
  circuit on the empty string for every legacy row and pin the whole population
  into the sentinel -- the mirror image of the defect this closes.

* **No CHECK constraint.** Unlike the closed two-valued
  ``coord.agent_worktrees.retention`` pin, ``attempt_key`` is an open identity
  space: coord writes ``dispatch:<uuid>`` today, and the column is shaped to
  carry a GitHub ``run_attempt`` or a third-party provider's attempt id later.
  A CHECK here would have to be widened by a migration every time a new
  producer appears, which is the drift ``trigger_signal`` on that same table
  was left un-CHECKed to avoid.

* **No index.** The column is a GROUP BY / DISTINCT ON key inside a CTE whose
  rows are already selected by ``repo`` and a time bound; it is never itself a
  filter predicate, so an index on it would be carried for no read. A guessed
  index is worse than none.

Backfill
========

None, and none is possible. There is no column, table, or ledger join that can
reconstruct which ``coord.ci_dispatches`` row produced a historical synthetic
check-run: ``synthetic_check_id(dispatch_id)`` is a lossy 64-bit fold of the
dispatch UUID, so ``check_id`` cannot be inverted back to a ``dispatch_id``.
Historical rows therefore stay NULL and keep falling to the sentinel. The
sentinel bucket drains forward, not retroactively, and
``CiWallSamples::run_id_absent_samples`` stays the honest counter of what is
still measured at the old grain.

Idempotency / authorship posture
================================

DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP ... IF EXISTS`` raw SQL with an
explicit ``coord.`` schema qualification, matching the ``coord.*`` migration
house style (and keeping the ``forbid-public-schema`` CI check green).
**alembic in qontinui-web is the sole author of the coord.* schema** -- the
Rust in qontinui-coord runs no ``coord.*`` DDL (CI-enforced, no allowlist), so
this migration is the only place the column exists.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sentinel_attempt_key_01"
down_revision: str | Sequence[str] | None = "coordtouch_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.pr_check_runs
            ADD COLUMN IF NOT EXISTS attempt_key TEXT
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.pr_check_runs DROP COLUMN IF EXISTS attempt_key")
