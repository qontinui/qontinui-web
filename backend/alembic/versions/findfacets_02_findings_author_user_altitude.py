"""coord.findings: author user + altitude facet, backfilled.

Phase 1, migration 2 of plan
``qontinui-dev-notes/plans/2026-08-06-user-and-device-facets-on-memories-and-findings.md``
(§5). Additive plus a total backfill; no behaviour change.

What this adds
==========================================================================

* ``coord.findings.author_user UUID NULL REFERENCES auth.users(id)`` — the
  human behind ``author_device``, which the table has carried and populated
  since ``coord_findings`` (§2.2). Derived server-side from the authenticated
  caller, never from a request field.
* ``coord.findings.applies_at TEXT NOT NULL DEFAULT 'tenant'`` — the ALTITUDE
  facet, constrained to ``fleet|tenant|user|device|session``.

Backfill
==========================================================================

Both are total and cheap (334 rows, measured 2026-08-06)::

    UPDATE coord.findings SET applies_at =
      CASE scope WHEN 'fleet-infra' THEN 'fleet' ELSE 'tenant' END;
    UPDATE coord.findings f SET author_user = d.user_id
      FROM coord.devices d WHERE d.device_id = f.author_device;

⚠ ``coord.findings.scope`` HAS NO CHECK CONSTRAINT IN THE DATABASE. Verified:
``coord_findings.py`` contains zero ``CHECK`` occurrences on that column and
no later revision adds one — it is a bare ``TEXT NOT NULL DEFAULT 'tenant'``.
So ``scope`` can hold a value neither the code nor this plan enumerates, and
the ``ELSE 'tenant'`` arm above is **load-bearing, not padding**: it is what
keeps an unenumerated ``scope`` from landing a NULL into a ``NOT NULL``
column and aborting the migration. Do not "simplify" it into a two-value
mapping.

``author_user`` is left NULL wherever ``author_device`` is NULL or the device
row has no bound user — a service/CI device (``gh-runner-*``) has no human
owner by design (§7 Phase 0 criterion 2). That is a correct NULL, not a
backfill failure.

🚨 THERE IS DELIBERATELY NO ``ALTER COLUMN applies_at DROP DEFAULT`` HERE
==========================================================================

Do not "fix" this by adding one — see the same banner on ``memfacets_01`` for
the full reasoning. In short: no writer names ``applies_at`` — a property
of the code, so confirm it the way it stays confirmable, with
``grep -n 'INSERT INTO coord.findings' crates/coord/src/*.rs`` in
qontinui-coord (every hit is an explicit column list; none of them names
``applies_at``) rather than with a column count or a line range, both of
which go stale the moment that file moves. Dropping the default on a
``NOT NULL`` column here would take every finding write in the fleet to
``null value in column "applies_at" violates not-null constraint`` — on a
phase explicitly advertised as behaviour-neutral. The ``DROP DEFAULT`` is
**Phase 3's migration 2b**, landing with the API change that makes
``applies_at`` required. The re-vet of 2026-09-19 moved it there; do not put
it back.

Downgrade drops both columns. Findings survive; ``scope`` was never touched.

Revision ID: findfacets_02
Revises: memfacets_01
Create Date: 2026-09-19

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "findfacets_02"
down_revision: str | Sequence[str] | None = "memfacets_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``author_user`` + ``applies_at``, then backfill both."""
    # The auth.users FK takes a SHARE ROW EXCLUSIVE lock on the referenced
    # table for the duration of the ALTER; bound the wait.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.findings
            ADD COLUMN IF NOT EXISTS author_user UUID
                REFERENCES auth.users(id),
            ADD COLUMN IF NOT EXISTS applies_at TEXT NOT NULL DEFAULT 'tenant'
                CONSTRAINT ck_findings_applies_at
                CHECK (applies_at IN (
                    'fleet', 'tenant', 'user', 'device', 'session'
                ))
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction — reset it so the 3s ceiling does not leak into later
    # revisions.
    op.execute("RESET lock_timeout")

    # `ELSE 'tenant'` is load-bearing: `scope` carries no CHECK constraint,
    # so an unenumerated value must still map to something NOT NULL.
    op.execute(
        """
        UPDATE coord.findings
           SET applies_at = CASE scope
                                WHEN 'fleet-infra' THEN 'fleet'
                                ELSE 'tenant'
                            END
        """
    )
    op.execute(
        """
        UPDATE coord.findings f
           SET author_user = d.user_id
          FROM coord.devices d
         WHERE d.device_id = f.author_device
           AND d.user_id IS NOT NULL
        """
    )


def downgrade() -> None:
    """Drop both columns (the CHECK constraint goes with its column)."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.findings
            DROP COLUMN IF EXISTS applies_at,
            DROP COLUMN IF EXISTS author_user
        """
    )
    op.execute("RESET lock_timeout")
