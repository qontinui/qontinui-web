"""coord.findings: author user + altitude facet.

Phase 1, migration 2 of plan
``qontinui-dev-notes/plans/2026-08-06-user-and-device-facets-on-memories-and-findings.md``
(§5). Additive only; no behaviour change. The backfill is NOT here — see
"Backfill — deferred to Phase 3" below.

What this adds
==========================================================================

* ``coord.findings.author_user UUID NULL REFERENCES auth.users(id)
  ON DELETE SET NULL`` — the human behind ``author_device``, which the table
  has carried and populated since ``coord_findings`` (§2.2). Derived
  server-side from the authenticated caller, never from a request field.

  ⚠ ``ON DELETE SET NULL`` is load-bearing, exactly as it is on
  ``memfacets_01``'s two columns — read that migration's banner for the
  worked case. A bare ``REFERENCES`` makes any DELETE of a referenced
  parent row abort, and because such sweeps are written as ONE statement,
  the first surviving child wedges the WHOLE sweep rather than one row.
  ``coord.findings.author_device`` was deliberately left FK-free for the
  neighbouring reason — a "best-effort device link", because findings
  outlive devices — and a finding must likewise outlive its author's
  ``auth.users`` row, just more coarsely attributed. ``SET NULL``, never
  ``CASCADE``: deleting a human must not delete what they found.

  The FK is a separate ``ADD CONSTRAINT … NOT VALID`` rather than an
  inline ``REFERENCES``, for the reason ``memfacets_01``'s classifier
  section states in full: coord's migration classifier rejects an inline
  ``REFERENCES`` (a validated FK), and ``NOT VALID`` skips only the scan of
  existing rows — all NULL in a column created here. New writes are checked
  and ``ON DELETE SET NULL`` fires exactly as on a validated FK. The
  earlier ``DROP CONSTRAINT IF EXISTS`` / re-``ADD`` rebuild is gone
  (``DROP`` is not admitted); on a database that ran the bare-``REFERENCES``
  form the ``ADD CONSTRAINT`` now fails loudly with ``DuplicateObject``
  instead. ``findings_author_user_fkey`` is the name Postgres derives for
  an inline column FK, spelled out so it stays stable.
* ``coord.findings.applies_at TEXT DEFAULT 'tenant'`` — the ALTITUDE facet,
  constrained to ``fleet|tenant|user|device|session`` and to non-NULL by its
  CHECK (a catalog ``NOT NULL`` is rejected by coord's migration classifier;
  the CHECK refuses exactly the same writes — see ``memfacets_01``).

Backfill — deferred to Phase 3
==========================================================================

The first form of this revision carried two ``UPDATE``s::

    UPDATE coord.findings SET applies_at =
      CASE scope WHEN 'fleet-infra' THEN 'fleet' ELSE 'tenant' END;
    UPDATE coord.findings f SET author_user = d.user_id
      FROM coord.devices d WHERE d.device_id = f.author_device
       AND d.user_id IS NOT NULL;

They are REMOVED, because coord's migration classifier rejects every DML
statement on the upgrade path ("data DML / backfill has unbounded blast
radius") and this PR must land without an operator override. That is
behaviour-neutral today: nothing reads ``coord.findings.applies_at`` or
``author_user`` until Phase 3 (no reader in this repo, none in coord), and
the ``DEFAULT 'tenant'`` already gives every existing row the value the
``ELSE`` arm would have. What is NOT yet true without the backfill:

* rows with ``scope = 'fleet-infra'`` read ``applies_at = 'tenant'`` rather
  than ``'fleet'``;
* ``author_user`` is NULL on every pre-existing finding, including those
  whose ``author_device`` has a bound user.

**Phase 3 inherits both statements as a requirement** — it is the phase that
introduces the first reader, so it must run them (as a coord-side catch-up
before the reader is armed, or as its own migration that goes through
operator review) before trusting either column on historical rows. The
mapping caveat stands for whoever runs it: ``coord.findings.scope`` has NO
CHECK constraint, so the ``ELSE 'tenant'`` arm is load-bearing — an
unenumerated ``scope`` must still map to a non-NULL value.

🚨 THERE IS DELIBERATELY NO ``ALTER COLUMN applies_at DROP DEFAULT`` HERE
==========================================================================

Do not "fix" this by adding one — see the same banner on ``memfacets_01`` for
the full reasoning. In short: no writer names ``applies_at`` — a property
of the code, so confirm it the way it stays confirmable, with
``grep -n 'INSERT INTO coord.findings' crates/coord/src/*.rs`` in
qontinui-coord (it DOES return hits — coord writes findings itself, unlike
memories, which it only proxies; every hit is an explicit column list and
none of them names ``applies_at``) rather than with a column count or a
line range, both of
which go stale the moment that file moves. Dropping the default on a
non-NULL-by-CHECK column here would take every finding write in the fleet
to a violation of the ``applies_at`` CHECK — on a
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
    """Add ``author_user`` + ``applies_at``. No backfill (see docstring)."""
    # The auth.users FK takes a SHARE ROW EXCLUSIVE lock on the referenced
    # table for the duration of the ALTER; bound the wait.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.findings
            ADD COLUMN IF NOT EXISTS author_user UUID,
            ADD COLUMN IF NOT EXISTS applies_at TEXT DEFAULT 'tenant'
                CONSTRAINT ck_findings_applies_at
                CHECK (applies_at IS NOT NULL AND applies_at IN (
                    'fleet', 'tenant', 'user', 'device', 'session'
                ))
        """
    )
    # NOT VALID: the column is brand new, so every existing row is NULL and
    # there is nothing to validate; new writes are checked as usual.
    op.execute(
        """
        ALTER TABLE coord.findings
            ADD CONSTRAINT findings_author_user_fkey
                FOREIGN KEY (author_user) REFERENCES auth.users(id)
                ON DELETE SET NULL NOT VALID
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction -- restore the default so the 3s ceiling does not leak into
    # later revisions. (`RESET` is not an admitted statement; this is.)
    op.execute("SET LOCAL lock_timeout = DEFAULT")


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
