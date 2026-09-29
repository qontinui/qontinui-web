"""coord.alerts: fault-onset and visibility columns (G1 of the operations ratchet).

Phase 4 of plan
``qontinui-dev-notes/plans/2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first.md``.
Additive, nullable, no backfill.

What this adds
==========================================================================

Three nullable columns on ``coord.alerts``:

* ``onset_at TIMESTAMPTZ``   — when the FAULT began, as opposed to
  ``first_seen_at`` (when coord first noticed it). Written by coord on INSERT
  only and never rewritten, like ``first_seen_at``.
* ``onset_basis TEXT``       — the evidence ``onset_at`` was derived from. A
  closed vocabulary, each a deterministic read of evidence coord already holds:

  - ``last_healthy_sample`` — the newest resource sample for that device+lane
    whose verdict was healthy;
  - ``last_heartbeat``      — the device's last heartbeat (the device went stale);
  - ``runner_reported``     — the runner's own wedge-incident timestamp;
  - ``claim_last_held``     — a ``domain_spec`` claim's last ``holds`` observation;
  - ``none``                — no evidence: ``onset_at`` is NULL and means
    UNKNOWN. ``first_seen_at`` is **never** substituted for it.

* ``visible_at TIMESTAMPTZ`` — when the fault became visible to someone who can
  act on it (first page, first agent claim, or first serve on the operator
  surface). ``visible_at - onset_at`` is the fault-to-visibility interval coord
  serves at ``GET /coord/alerts/fault-to-visibility``.

And two CHECK constraints that make the vocabulary and the pairing structural
rather than a convention of coord's writer:

* ``alerts_onset_basis_check`` — ``onset_basis`` is NULL or one of the five
  values above. NULL is a row written before this revision (or by a coord build
  predating Phase 4) — "no basis recorded", which readers treat as UNKNOWN
  exactly like ``none``.
* ``alerts_onset_basis_required_check`` — ``onset_at IS NULL OR onset_basis IS
  NOT NULL``: an onset with no stated basis is an unauditable number, so it
  cannot be stored. The converse is allowed and expected (``basis = 'none'``
  with a NULL ``onset_at``).

Every existing row takes NULL for all three columns, which reads as "onset
unknown, visibility unrecorded". No backfill: history predating the writer has
no evidence to derive an onset from, and substituting ``first_seen_at`` would
report a zero interval for exactly the episodes the measurement exists to find.

Nothing reads these columns until coord's Phase 4 half lands, and it lands
AFTER this revision is at head (served policy ``production-and-cost``
``alembic-sole-authorship``: the migration precedes the column read). The coord
PR that first reads them bumps ``MIGRATOR_DIGEST`` so its
``schema_read_contract`` gate migrates to a head that carries them.

Locking, and why the constraints are NOT VALID
==========================================================================

``coord.alerts`` is written continuously (the ``coord_alerts_pagedidx_01``
revision measured it at 1.47 M rows), so the whole ALTER bounds its ACCESS
EXCLUSIVE wait with ``SET LOCAL lock_timeout = '3s'``: failing fast is a retry,
a queued exclusive lock stalling every writer behind it is an outage.
``SET LOCAL lock_timeout = DEFAULT`` afterwards is REQUIRED — ``env.py`` runs
every revision of one ``alembic upgrade`` in a single transaction, so an
unrestored bound would leak into every later revision. (``= DEFAULT`` rather
than ``RESET``: coord's migration classifier admits the former and fails a
``RESET`` closed.)

Both ``ADD COLUMN ... NULL`` with no default and ``ADD CONSTRAINT ... NOT
VALID`` are catalog-only — no rewrite, no scan. ``NOT VALID`` costs nothing
here: the columns are brand new, so every existing row holds NULL and satisfies
both CHECKs trivially; a validation scan could find nothing. Both constraints
are enforced for every row written from now on either way. A validated CHECK
would instead scan all 1.47 M rows under the ACCESS EXCLUSIVE lock, and coord's
classifier rejects ``ADD CONSTRAINT`` without ``NOT VALID`` for exactly that
reason.

Re-runs: the columns are ``IF NOT EXISTS``; the constraints (which PostgreSQL
cannot guard with ``IF NOT EXISTS``) commit in the same transaction as the
version stamp, so a run that died partway leaves neither and re-runs cleanly —
the ``twin_10_served_bundle_target_columns`` posture.

Downgrade drops the constraints and then the three columns. Onset/visibility
data is lost, which is the correct reversal of an additive revision; the alerts
themselves survive.

Revision ID: coord_alerts_onset_01
Revises: coordinput_01_operator_inputs
Create Date: 2026-09-30

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_alerts_onset_01"
# One line, unannotated — see plan_library_06_scan_root_slug_census.
down_revision = "coordinput_01_operator_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the three columns and the two NOT VALID CHECKs. Catalog-only."""
    # Bound the ALTER's ACCESS EXCLUSIVE wait: coord.alerts is under a
    # continuous writer, and a queued exclusive lock blocks everyone behind it.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.alerts
            ADD COLUMN IF NOT EXISTS onset_at    TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS onset_basis TEXT,
            ADD COLUMN IF NOT EXISTS visible_at  TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE coord.alerts
            ADD CONSTRAINT alerts_onset_basis_check
            CHECK (
                onset_basis IS NULL
                OR onset_basis IN (
                    'last_healthy_sample',
                    'last_heartbeat',
                    'runner_reported',
                    'claim_last_held',
                    'none'
                )
            ) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.alerts
            ADD CONSTRAINT alerts_onset_basis_required_check
            CHECK (onset_at IS NULL OR onset_basis IS NOT NULL) NOT VALID
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so without this restore the 3s timeout leaks into every
    # revision that lands after this one.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the two CHECKs, then the three columns. The alerts survive."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.alerts
            DROP CONSTRAINT IF EXISTS alerts_onset_basis_required_check,
            DROP CONSTRAINT IF EXISTS alerts_onset_basis_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.alerts
            DROP COLUMN IF EXISTS visible_at,
            DROP COLUMN IF EXISTS onset_basis,
            DROP COLUMN IF EXISTS onset_at
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
