"""coord.policy_rules — one AGENT-authored decision row per (tenant, domain, name)

Revision ID: policy_rules_agent_name_uq_01
Revises: findings_keyset_01
Create Date: 2026-10-05

Plan ``2026-09-06-decision-policy-rows-are-operator-only-to-create``, follow-up 1
("Phase 1 as built"). Adds ONE partial unique index::

    uq_policy_rules_agent_domain_name
        ON coord.policy_rules (tenant_id, decision_domain, name)
        WHERE kind IS NULL
          AND decision_domain IN ('pr_fix', 'red_main_fix')
          AND (starts_with(created_by, 'session:')
               OR starts_with(created_by, 'agent:')
               OR starts_with(created_by, 'device:'))

## The consumer

coord ``POST /coord/agent-policies`` (``crates/coord/src/policies/agent_routes.rs``,
qontinui-coord#2601). That door lets an agent author a v2 decision-domain row in
an allowlisted domain, and makes a ``notification_ref`` — a coord finding naming
``policy_rule:<decision_domain>/<name>`` — the precondition of the write. So the
pair ``(decision_domain, name)`` is the key ONE announcement authorizes, and the
door refuses a second row with the same pair (``409 policy_name_taken``).

It refuses it with a read-then-insert (``name_taken`` before the INSERT), which
two concurrent creates can both pass. This index closes that race in the
database: the second INSERT fails with SQLSTATE 23505 on this index name, and
coord maps that to the same ``409 policy_name_taken``. coord does not READ the
index, so there is no read-side deploy ordering to wait on (served policy
``production-and-cost`` ``alembic-sole-authorship`` governs reads of new
objects); the coord-side 23505 mapping is harmless while the index is absent.

## Why the predicate is this narrow

* ``kind IS NULL`` — v2 decision-domain rows only; v1 typed rules are
  operator-only and unaffected.
* ``decision_domain IN ('pr_fix', 'red_main_fix')`` — the agent door's
  allowlist (``AGENT_CREATABLE_DECISION_DOMAINS``). Widening that const should
  widen this list in the same change; a domain missing here only means its race
  is guarded by coord's read-then-insert alone, never a wrong refusal.
* ``created_by`` agent spellings — ``provenance_session::verified_authorship_actor``
  stamps ``session:`` / ``agent:`` / ``device:``; the operator door stamps
  ``operator:...``. An OPERATOR may still keep several same-named rows in a
  domain (for example one per repo) exactly as before: the race being closed is
  between two agent creates, and constraining operator authoring is not this
  revision's business.

## Why a plain CONCURRENTLY build, with no duplicate guard

The index's population is EMPTY in production when this lands: the only writer
that stamps an agent ``created_by`` into these two domains is the agent door,
qontinui-coord#2601, which is not deployed (``next_step_settings`` and the
operator door stamp ``operator:...``; ``agent_desired_state`` writes a
different domain). So the build cannot meet a duplicate, and a guard against
one would only cost the migration its static-SQL shape — coord's migration
classifier refuses a ``DO $$`` block, an f-string or a non-literal
``op.execute`` argument, and would hold this PR for an operator. ``CONCURRENTLY``
takes no lock that blocks policy writes, so there is no unbounded wait behind a
long coord transaction either. Land this BEFORE #2601 deploys; if it ever runs
after agent rows exist and a duplicate does, the build fails loudly and leaves
an INVALID index to drop, which is the visible failure rather than a silent one.

An OPERATOR rename (``PATCH /coord/policies/:id`` keeps ``created_by``) of an
agent-authored row onto another agent row's name in the same tenant and domain
now fails on this index — the one way it touches operator authoring.

``down_revision`` chains off the single live alembic head at authoring time
(``findings_keyset_01``, computed with ``ScriptDirectory.get_heads()``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "policy_rules_agent_name_uq_01"
down_revision: str | Sequence[str] | None = "findings_keyset_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DROP_INDEX = (
    "DROP INDEX CONCURRENTLY IF EXISTS coord.uq_policy_rules_agent_domain_name"
)


def upgrade() -> None:
    """Additive and idempotent: the partial unique index."""
    # CONCURRENTLY cannot run inside a transaction. The SQL is an inline literal
    # (not a module constant) so coord's migration classifier can read it.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_policy_rules_agent_domain_name
                ON coord.policy_rules (tenant_id, decision_domain, name)
                WHERE kind IS NULL
                  AND decision_domain IN ('pr_fix', 'red_main_fix')
                  AND (starts_with(created_by, 'session:')
                       OR starts_with(created_by, 'agent:')
                       OR starts_with(created_by, 'device:'))
            """
        )


def downgrade() -> None:
    """Reverse exactly this revision."""
    with op.get_context().autocommit_block():
        op.execute(_DROP_INDEX)
