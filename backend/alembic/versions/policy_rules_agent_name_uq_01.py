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

## Existing duplicates — create nothing rather than fail the deploy

A UNIQUE index cannot be built over rows that already violate it, and a failed
migration blocks every later deploy. Agent-authored rows in these domains only
become possible with qontinui-coord#2601, so duplicates are not expected — but
the cost asymmetry decides it: when any exist, this revision skips the index and
RAISEs a NOTICE naming the count, leaving coord's read-then-insert as the guard.
A later revision can dedupe and retry. The index is ``IF NOT EXISTS`` so a
re-run is a no-op.

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


_PREDICATE = """
    kind IS NULL
    AND decision_domain IN ('pr_fix', 'red_main_fix')
    AND (starts_with(created_by, 'session:')
         OR starts_with(created_by, 'agent:')
         OR starts_with(created_by, 'device:'))
"""

# No `%` anywhere in this file's SQL, deliberately: SQLAlchemy escapes a literal
# `%` to `%%` on its way to psycopg2, which then reaches PL/pgSQL unexpanded and
# breaks a `RAISE NOTICE '... % ...'` format (measured in pdtier_03). Hence
# `starts_with` rather than `LIKE 'x%'`, and `USING MESSAGE =` concatenation.

_CREATE_IF_NO_DUPLICATES = f"""
DO $$
DECLARE
    dup_groups integer;
BEGIN
    SELECT count(*) INTO dup_groups FROM (
        SELECT 1
          FROM coord.policy_rules
         WHERE {_PREDICATE}
         GROUP BY tenant_id, decision_domain, name
        HAVING count(*) > 1
    ) d;
    IF dup_groups > 0 THEN
        RAISE NOTICE USING MESSAGE =
            'policy_rules_agent_name_uq_01: ' || dup_groups::text
            || ' duplicate (tenant, decision_domain, name) group(s) among agent-authored '
            || 'rows; uq_policy_rules_agent_domain_name NOT created; coord''s '
            || 'read-then-insert remains the guard';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_rules_agent_domain_name
            ON coord.policy_rules (tenant_id, decision_domain, name)
            WHERE {_PREDICATE};
    END IF;
END
$$;
"""

_DROP_INDEX = "DROP INDEX IF EXISTS coord.uq_policy_rules_agent_domain_name"


def upgrade() -> None:
    """Additive and idempotent: the partial unique index, unless duplicates exist."""
    op.execute(_CREATE_IF_NO_DUPLICATES)


def downgrade() -> None:
    """Reverse exactly this revision."""
    op.execute(_DROP_INDEX)
