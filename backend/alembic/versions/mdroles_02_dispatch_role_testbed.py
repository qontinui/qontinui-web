"""coord.machine_dispatch_roles — rename the ``bench`` dispatch role to ``testbed``

Revision ID: mdroles_02
Revises: census_idx_01_device_repo_path_observed
Create Date: 2026-10-10

Amendment 2026-10-10 (A2, A5 Phase A, A6) of plan
``qontinui-dev-notes/plans/2026-10-02-fleet-machine-roles-workhorse-bench-ci-node.md``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

What changes
============

The role a machine holds when coord may send it NOTHING — neither CI nor agent
sessions — was called ``bench``. It is the machine kept empty for hand-driven
UI Bridge testing (``/manual-test-loop``, ``/ux-improve``), and "bench" read as
"idle" or as "where benchmarks run". A2 renames it ``testbed``; its lanes (§D1:
both closed) do not change.

This revision swaps ``ck_machine_dispatch_roles_dispatch_role`` from
``('workhorse', 'bench', 'ci_node')`` to ``('workhorse', 'testbed', 'ci_node')``
in ONE step — A6 collapses A5's expand/contract pair, because no row can hold
``'bench'``: no route has ever written a role (coord finding ``e4a7e7e9``;
coord's write route is qontinui-coord#3015, still open at authoring), and under
A6 none will. The constraint keeps its NAME — ``mdroles_01`` named it so a
later change could replace it by name — and is dropped and re-added in a single
``ALTER TABLE`` statement, so no moment exists in which the column is
unconstrained.

There is deliberately NO data rewrite. If a row does hold ``'bench'``, the
re-added CHECK validates every existing row and fails this upgrade with a
23514 naming the constraint — loud, at migration time — rather than a silent
``UPDATE`` that A6's own premise says is unnecessary. (A data UPDATE would
also be refused by coord's merge-train migration classifier as "data DML /
backfill has unbounded blast radius".) An operator who meets that failure
decides what the row should be; the migration does not decide for them.

The versions table ``coord.machine_dispatch_roles_versions`` carries no value
CHECK (``mdroles_01``: "a future widening of the live table's role set must
not retroactively invalidate stored history"), so it is untouched, and any
``'bench'`` snapshot it could ever hold stays readable as history. No column is
added, so §D4's "versions mirror every column" rule is unaffected.

The table COMMENT named ``bench``; it is restated with ``testbed``.

Coord's merge-train migration classifier: this revision is NOT auto-safe
=========================================================================

``qontinui-coord`` ``crates/coord/src/pr_merge/migration_classifier.rs``
``classify_sql_statement`` rejects the ``ALTER TABLE`` statement below with
``"destructive DROP inside ALTER TABLE"`` (its ``p.contains(" DROP ")`` arm,
checked before any per-action rule). That is inherent to the change, not to
its spelling: the admitted ``ALTER TABLE`` forms are ``ADD COLUMN`` and
``ADD CONSTRAINT … NOT VALID`` only, and an added CHECK cannot WIDEN the set
an existing CHECK still narrows — ``'testbed'`` is writable only once the old
constraint is gone. So the PR needs the audited operator override, the same
path ``cinode_04_runner_requires_windows`` takes. The two ``COMMENT ON``
statements are individually admitted (``classify_comment_on``); one rejected
statement rejects the whole file.

Deploy ordering — what this revision does to a coord that still writes ``bench``
================================================================================

qontinui-coord#3015 (``dispatch_role.rs``) parses ``"bench"`` and writes
``DispatchRole::Bench.as_str() == "bench"``; it refuses ``"testbed"`` with a
422. A coord build like that, against a database at this revision, gets a 23514
on ``ck_machine_dispatch_roles_dispatch_role`` when an operator sets a machine
to the no-lanes role — loud, never a silent wrong role, and no other role is
affected. A5 step 1/3 (coord ``DispatchRole::Testbed``, parsing both spellings
and writing ``"testbed"``) is what makes that write succeed. Reads are
unaffected in every combination: there is no ``'bench'`` row to read.

Downgrade
=========

Restores the ``mdroles_01`` set and the ``mdroles_01`` comment. It, too, does
not rewrite data: a ``'testbed'`` row makes the downgrade fail with a 23514,
which is the honest answer — the older schema has no spelling for it.

HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here. Raw,
static, ``coord.``-qualified ``op.execute``; pure DDL, no app imports.
``down_revision`` is re-pointed onto the merged head at land time if another
revision lands first.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "mdroles_02"
down_revision: str | Sequence[str] | None = "census_idx_01_device_repo_path_observed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Swap the role CHECK to admit ``testbed`` instead of ``bench``."""
    op.execute(
        """
        ALTER TABLE coord.machine_dispatch_roles
            DROP CONSTRAINT IF EXISTS ck_machine_dispatch_roles_dispatch_role,
            ADD CONSTRAINT ck_machine_dispatch_roles_dispatch_role
                CHECK (dispatch_role IN ('workhorse', 'testbed', 'ci_node'))
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.machine_dispatch_roles IS
            'Operator-chosen dispatch role per machine: which lanes coord may '
            'dispatch on (workhorse = ci+agent, testbed = none, kept for '
            'hand-driven UI testing, ci_node = ci only). No row means '
            'unassigned, which behaves as workhorse. Keyed '
            'on the machine (workstation device or un-linked CI host), never '
            'on one coord.devices row. ci_host_name is '
            'unique case-insensitively via the derived machine_key: upsert '
            'with ON CONFLICT ON CONSTRAINT uq_machine_dispatch_roles_machine, '
            'and read with key-shaped predicates (machine_key = ''/'' || '
            'lower(host), or device::text || ''/''). ci_host_name is printable '
            'ASCII only. Not '
            'coord.devices.role, which is what a '
            'process IS and is self-declared. Every write must INSERT the '
            'matching coord.machine_dispatch_roles_versions row in the SAME '
            'transaction, including the first one.'
        """
    )


def downgrade() -> None:
    """Restore the ``mdroles_01`` role set and comment (fails on a testbed row)."""
    op.execute(
        """
        ALTER TABLE coord.machine_dispatch_roles
            DROP CONSTRAINT IF EXISTS ck_machine_dispatch_roles_dispatch_role,
            ADD CONSTRAINT ck_machine_dispatch_roles_dispatch_role
                CHECK (dispatch_role IN ('workhorse', 'bench', 'ci_node'))
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.machine_dispatch_roles IS
            'Operator-chosen dispatch role per machine: which lanes coord may '
            'dispatch on (workhorse = ci+agent, bench = none, ci_node = ci '
            'only). No row means unassigned, which behaves as workhorse. Keyed '
            'on the machine (workstation device or un-linked CI host), never '
            'on one coord.devices row. ci_host_name is '
            'unique case-insensitively via the derived machine_key: upsert '
            'with ON CONFLICT ON CONSTRAINT uq_machine_dispatch_roles_machine, '
            'and read with key-shaped predicates (machine_key = ''/'' || '
            'lower(host), or device::text || ''/''). ci_host_name is printable '
            'ASCII only. Not '
            'coord.devices.role, which is what a '
            'process IS and is self-declared. Every write must INSERT the '
            'matching coord.machine_dispatch_roles_versions row in the SAME '
            'transaction, including the first one.'
        """
    )
