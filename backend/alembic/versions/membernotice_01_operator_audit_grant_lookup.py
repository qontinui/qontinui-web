"""coord.operator_audit: index the "has this person been granted here before?" lookup.

Supports :func:`_member_had_prior_access` in
``backend/app/api/v1/endpoints/operations.py``, which decides whether
``POST /api/v1/operations/coord/tenant-members`` should email the person it
just granted access to. Index-only; no columns, no data, no backfill.

What this adds
==========================================================================

::

    CREATE INDEX CONCURRENTLY idx_operator_audit_grant_role_lookup
    ON coord.operator_audit (tenant_id, resource_key)
    WHERE action = 'operator.grant_role' AND resource_kind = 'operator'

Why the existing indexes do not serve it
==========================================================================

``coord_sso_rbac`` created exactly two:

* ``idx_operator_audit_operator`` on ``(operator_id, occurred_at DESC)`` —
  ``operator_id`` is the ACTOR who performed the action, not the operator
  acted upon. The lookup filters on the TARGET, which lives in
  ``resource_key``, so this index does not apply at all.
* ``idx_operator_audit_recent`` on ``(occurred_at DESC)`` — a timeline, and
  the lookup has no time predicate.

So the query filters ``action``, ``resource_kind``, ``resource_key`` and
``tenant_id``, of which only ``tenant_id`` appears in any index and never as
a leading column. Without this revision it is a sequential scan of
``coord.operator_audit``.

Why that matters more than a scan usually does
==========================================================================

``coord.operator_audit`` is append-only and high-churn: coord's RBAC layer
stamps a row per authorized mutation, so it grows with fleet traffic and is
never pruned on a schedule. And the scan is unavoidable in exactly the case
that costs most — a FIRST grant, where both ``EXISTS`` subqueries must be
proven false by reading every candidate row, and which is also the case that
then goes on to await an SES send inside the same request.

Why the index is PARTIAL, and why ``tenant_id`` leads
==========================================================================

Partial, because ``action = 'operator.grant_role' AND resource_kind =
'operator'`` is a small minority of the table — every other audited action
(and every RBAC authorization stamp) is excluded, so the index stays a small
fraction of the heap and costs nothing on the writes that dominate.

``tenant_id`` leads because it is the more selective of the two remaining
columns in the shape this query takes (one tenant, one target), and because
it matches the ``(tenant_id, …)`` ordering the neighbouring coord indexes
already use. ``resource_key`` follows to make the lookup an index-only probe
rather than a tenant-wide range scan; it is TEXT and unindexed today.

This index is deliberately NOT unique. ``coord.operator_audit`` is an audit
log: a person granted, revoked and granted again SHOULD have several rows,
and a unique index would make coord's second grant fail.

Locking and CONCURRENTLY
==========================================================================

Built ``CONCURRENTLY`` inside ``op.get_context().autocommit_block()`` (the
``coord_alerts_pagedidx_01`` / ``agent_questions_alert_episode_01``
precedent) so writers to this hot table are never blocked by a ``SHARE``
lock.

A killed or failed CONCURRENTLY build leaves an **INVALID** index of the same
name, which the planner ignores — and which ``IF NOT EXISTS`` would see and
skip, leaving the lookup on a sequential scan forever with nothing to show
for it. So the upgrade looks the index up in ``pg_index`` first and drops an
invalid one before creating. A re-run therefore always ends with a valid
index or a loud failure.

Unlike a unique index, an incomplete build here can only cost performance,
never correctness: nothing infers a conflict against it.

What the repair does NOT cover
==========================================================================

Only an INVALID index is dropped and rebuilt. A pre-existing **valid** index
of this name with a DIFFERENT definition — a hand-built one, or a leftover
from an edited earlier draft of this revision — is silently kept by
``IF NOT EXISTS``, and this revision will report success while the lookup
runs against something other than what the docstring above describes. That
is deliberate: dropping a valid index nobody declared could remove one
another query depends on, which is worse than the performance the wrong
definition costs. It is also the case the accompanying test asserts the
definition rather than merely the name, so a drifted index shows up as a
failure there rather than as a mystery in production.

Downgrade drops the index. No data is touched in either direction.

Revision ID: membernotice_01_operator_audit_grant_lookup
Revises: agent_questions_alert_episode_01
Create Date: 2026-09-19

"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "membernotice_01_operator_audit_grant_lookup"
down_revision: str | Sequence[str] | None = "agent_questions_alert_episode_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEX_NAME = "idx_operator_audit_grant_role_lookup"


def _index_is_invalid(index_name: str) -> bool:
    """True when ``coord.<index_name>`` exists and is INVALID (a failed build)."""
    return bool(
        op.get_bind()
        .execute(
            text(
                """
                SELECT NOT i.indisvalid
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        )
        .scalar()
    )


def upgrade() -> None:
    """Create the partial lookup index. Idempotent."""
    with op.get_context().autocommit_block():
        # A failed earlier CONCURRENTLY build leaves an INVALID index that
        # IF NOT EXISTS would keep, and the planner never uses.
        #
        # Plain literal, never an f-string — here and below. The
        # `alembic-schema-arg-gate` pre-commit hook inspects CONSTANT strings
        # and skips an f-string silently, so an interpolated statement is not
        # rejected, it is simply never audited. Naming `_INDEX_NAME` in the
        # SQL would have bought nothing and cost the check.
        if _index_is_invalid(_INDEX_NAME):
            op.execute(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "coord.idx_operator_audit_grant_role_lookup"
            )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_operator_audit_grant_role_lookup
            ON coord.operator_audit (tenant_id, resource_key)
            WHERE action = 'operator.grant_role' AND resource_kind = 'operator'
            """
        )


def downgrade() -> None:
    """Drop the index. Audit rows survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.idx_operator_audit_grant_role_lookup"
        )
