"""coord.operator_roles.grant_origin — name WHICH path created an admin grant

Revision ID: grantorig_01
Revises: coordtouch_01
Create Date: 2026-08-31

Phase 1 of plan
``2026-08-28-tenant-creation-followup-defects-from-the-preemptive-sweep``.

DDL ONLY. No route change, no query change, no coord change — those are the
coord PR, and it must deploy AFTER this revision is at head
(``[policy: alembic-sole-authorship]``; the 2026-07-13 missing-column incident
is what a coord binary naming a column its migration has not shipped looks
like: PostgreSQL 42703 on every affected request).

The defect this column exists to close
======================================

coord's self-service tenant-creation cap counts a caller's prior
self-created tenants with::

    SELECT ... FROM coord.operator_roles r
     WHERE r.operator_id = $1 AND r.role = 'admin' AND r.granted_by IS NULL

(``crates/coord/src/routes_phase3.rs``). The predicate encodes a belief that
``(role = 'admin', granted_by IS NULL)`` is unique to the self-service create
path. **It is not.** Four production paths write exactly that tuple:

1. ``routes_phase3.rs`` step 6 — the self-service create's own bootstrap
   admin. The one the cap actually means to count.
2. ``auth_sso.rs`` — the ``COORD_SSO_BOOTSTRAP_ADMIN_EMAILS`` allowlist
   bootstrap. ``granted_by = NULL`` deliberately, so the claim-sync reconcile
   (which only revokes sentinel-owned rows) never strips it.
3. ``auth_sso.rs`` — the group-claim **tenant auto-create** bootstrap admin.
   ``granted_by = NULL`` deliberately, and for the same reason: a
   sentinel-owned bootstrap admin would flap off on the very next login,
   because the mapping asserts only ``operator``.
4. ``auth_sso.rs`` — the first-login **default-role** bootstrap, which writes
   ``granted_by = NULL`` for whatever ``COORD_SSO_DEFAULT_ROLE`` names. That
   is ``operator`` in the shipped default, but it is an environment variable:
   set it to ``admin`` and every first login manufactures a row the cap counts.

So an operator who has never used self-service can be **falsely capped** — a
403 on a legitimate action, caused by rows three other subsystems wrote for
their own reasons. The cap needs a discriminator and the table has none: its
entire column set is ``operator_id, tenant_id, role, granted_at, granted_by``
(``coord_sso_rbac``), with no ``ALTER TABLE coord.operator_roles ADD COLUMN``
anywhere in either repo. This revision adds it.

``grant_origin TEXT NULL``
==========================

The value vocabulary — a shared contract with the coord code that will write
it, so these spellings must not drift:

``'self_service'``
    The self-service tenant-create bootstrap admin (path 1). **This is the
    only value the new cap counts.**
``'sso_email_bootstrap'``
    The ``COORD_SSO_BOOTSTRAP_ADMIN_EMAILS`` allowlist bootstrap (path 2).
``'group_auto_create'``
    The group-claim tenant auto-create bootstrap admin (path 3).
``'default_role'``
    The first-login default-role bootstrap (path 4).
``'group_claim_sync'``
    The group-claim reconciliation's own sentinel-owned rows (the fifth
    writer — see the backfill note). ``granted_by`` is the sentinel operator,
    not NULL, so this path never fed the old predicate; it is named here so
    the column can describe every writer rather than only the four the cap
    was confused by.
``'admin_grant'``
    A real grant made by a human admin through the grant endpoints.
``NULL``
    Legacy or unknown provenance — see the backfill below.

The vocabulary grew from five values to six between this revision being
written and the coord half being authored, which is precisely the reason
there is no ``CHECK`` constraint below: a sixth writer surfaced within the
hour, and under a CHECK it would have been a cross-repo release — or, worse,
a ``23514`` on every SSO group-claim login.

**NULLABLE, and it must stay that way.** Deploy order is
producer-before-consumer: this revision lands first and coord starts
populating the column only when the coord half deploys. Every row written
before that carries no origin, and NOT NULL would make the ordering
un-orderable. NULL therefore means *"written before coord recorded an
origin"* — **Unavailable, never Absent**, and specifically never "not
self-service, therefore free". The new cap reads NULL as *not counted*, which
is the correct direction (see below), but a future consumer that reads NULL as
a positive assertion about the grant would be wrong.

Tightening to NOT NULL is safe only after the coord writer is live and every
pre-writer row has been re-classified, and only in a separate revision.

**TEXT, not an enum, and no CHECK constraint** — the house pattern
(``coord.work_units.status``, and ``coord.operator_touches``' vocabulary
columns, which record the reasoning at length). ``role`` on this very table is
already "TEXT (not enum) so adding roles is a no-op migration"
(``coord_sso_rbac``). A CHECK would turn every newly-discovered grant path
into a cross-repo release before coord may write the value, and a rejected
write here silently drops the provenance the column exists to carry. The
vocabulary is enforced in coord's Rust, where the writers are.

Backfill direction — deliberately fails OPEN
============================================

::

    granted_by IS NOT NULL, non-sentinel  ->  'admin_grant'
    granted_by IS NOT NULL, sentinel       ->  NULL  (left alone)
    granted_by IS NULL                     ->  NULL  (left alone)

The ``granted_by IS NULL`` rows are the four-way ambiguity above and there is
no evidence in the row that separates them. They stay **NULL** rather than
being guessed at. Since the new cap counts ``grant_origin = 'self_service'``,
every legacy row counts as **zero** and nobody is falsely capped. That
asymmetry is the point: failing open on a quota under-counts a handful of
historical self-service creates, while failing closed 403s real users — and
the false 403 is the bug being fixed. Under-counting is recoverable; the cap
re-tightens naturally as coord stamps new rows.

**The sentinel carve-out is not an edge case, it is a fifth writer.** The
group-claim reconciliation marks the rows it owns with
``granted_by = <sentinel operator>`` — the operator whose natural key is
``(sso_provider, sso_subject) = ('', 'system-sync')``, seeded by
``coord_group_claim_provisioning`` — precisely so a later reconciliation only
revokes its own rows. Those rows have ``granted_by IS NOT NULL`` and are **not
admin grants**; a flat ``granted_by IS NOT NULL -> 'admin_grant'`` backfill
would stamp a knowably false provenance onto them, which is the same defect
class as the tuple-overload this plan exists to fix. Note ``'group_auto_create'``
is emphatically NOT the value for them — that means the *tenant auto-create
bootstrap admin*, a distinct and ``granted_by``-NULL path. The coord half adds
``'group_claim_sync'`` and stamps these rows going forward, but the backfill
still leaves the EXISTING ones NULL: coord writes the value where it knows the
path was taken, whereas backfilling would infer provenance from a sentinel
lookup, and an inference is not an observation. NULL — unknown — stays the
honest value for a row nobody watched being written. The
``NOT EXISTS`` is written so it is a no-op where the sentinel operator does
not exist, in which case every non-NULL ``granted_by`` row is backfilled, as
it should be.

Nothing is backfilled to ``'self_service'``. Doing so would require inferring
which historical bootstrap wrote a row from evidence that does not exist, and
a wrong inference there re-creates the false 403 in a column that now looks
authoritative.

No index, deliberately
======================

The cap's read is ``WHERE r.operator_id = $1 AND r.role = 'admin' AND …`` —
``operator_id`` is the leading column of the table's primary key
``(operator_id, tenant_id, role)``, so that lookup already prunes to the
handful of rows one operator holds, and ``grant_origin`` is only ever a filter
applied to rows the PK index has already returned. It is also low-cardinality
(six values including NULL), which is the shape an index serves worst. The
table carries **zero** secondary indexes today, and the closest precedent —
``coord_ocs_operator_id``, a nullable column added for exactly this
assert-on-an-already-fetched-row purpose — declines an index in the same
terms. Adding one here would buy write amplification on the SSO login path and
nothing else.

Idempotency
===========

``ADD COLUMN IF NOT EXISTS`` up, ``DROP COLUMN IF EXISTS`` down — the house
convention for ``coord.*``, and reversible for the ``migration-reversal``
gate. The column is nullable with no default, so the ADD is a catalogue update
with no table rewrite. The backfill is guarded on ``grant_origin IS NULL``, so
a re-run never overwrites a value coord has since written.

``down_revision``
=================

``coordtouch_01`` — this repo's LOCAL single alembic head, computed as the
revision that is no other revision's ``down_revision``. It is NOT a value to
copy forward: ``alembic-graph-pr.yml`` serialises alembic PRs, so any revision
that lands ahead of this one re-forks the chain. **A rebase does not re-point
``down_revision``** — recompute it by hand
(``python scripts/ci/count_alembic_heads.py``) and re-point this line. Do NOT
author an ``alembic merge`` revision: this revision has not landed, so
re-pointing leaves nothing behind while a merge revision is permanent
bookkeeping.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# Keep ``down_revision`` on ONE physical line — the ``alembic-heads-pr`` CI
# gate parses it with a line-based regex.
revision: str = "grantorig_01"
down_revision: str | Sequence[str] | None = "coordtouch_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable ``grant_origin`` + backfill unambiguous admin grants."""
    op.execute(
        """
        ALTER TABLE coord.operator_roles
            ADD COLUMN IF NOT EXISTS grant_origin TEXT
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.operator_roles.grant_origin IS
            'WHICH code path created this role grant. Vocabulary: '
            '''self_service'' (the self-service tenant-create bootstrap admin '
            '-- the ONLY value the tenant-creation cap counts), '
            '''sso_email_bootstrap'' (COORD_SSO_BOOTSTRAP_ADMIN_EMAILS), '
            '''group_auto_create'' (group-claim tenant auto-create bootstrap '
            'admin), ''default_role'' (first-login COORD_SSO_DEFAULT_ROLE '
            'bootstrap), ''group_claim_sync'' (the group-claim reconcile''s own '
            'sentinel-owned rows -- granted_by is the sentinel, not NULL), '
            '''admin_grant'' (a human admin used the grant '
            'endpoints). Enforced in coord Rust, NOT by a CHECK, so the '
            'vocabulary can grow without a cross-repo release -- it grew from '
            'five values to six within an hour of this revision being written. '
            'NULL means the '
            'row predates coord recording an origin (deploy order is '
            'producer-before-consumer) or its provenance is genuinely unknown '
            '-- read it as Unavailable, NEVER as a positive assertion that the '
            'grant was not self-service. It exists because '
            '(role=''admin'', granted_by IS NULL) is written by FOUR paths, not '
            'one, so the old cap predicate falsely 403s operators who never '
            'used self-service.'
        """
    )
    # Backfill only what is unambiguous: a non-NULL ``granted_by`` that is not
    # the group-sync sentinel is a real admin grant. Sentinel-owned rows and
    # ``granted_by IS NULL`` rows stay NULL -- guessing their origin is the
    # defect this column closes. Guarded on ``grant_origin IS NULL`` so a
    # re-run never clobbers a value coord has since written.
    #
    # The sentinel's natural key is ``(sso_provider, sso_subject) =
    # ('', 'system-sync')``, seeded by ``coord_group_claim_provisioning``.
    # Spelled as literals rather than an f-string so the repo's alembic
    # schema= gate can still statically read this SQL.
    op.execute(
        """
        UPDATE coord.operator_roles r
           SET grant_origin = 'admin_grant'
         WHERE r.grant_origin IS NULL
           AND r.granted_by IS NOT NULL
           AND NOT EXISTS (
                 SELECT 1
                   FROM coord.operators o
                  WHERE o.operator_id = r.granted_by
                    AND o.sso_provider = ''
                    AND o.sso_subject = 'system-sync'
               )
        """
    )


def downgrade() -> None:
    """Drop ``grant_origin``. Exact inverse of upgrade().

    The backfilled values go with the column; they are derivable again from
    ``granted_by`` plus the sentinel lookup, so nothing unrecoverable is lost.
    """
    op.execute(
        """
        ALTER TABLE coord.operator_roles
            DROP COLUMN IF EXISTS grant_origin
        """
    )
