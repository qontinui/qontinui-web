"""web.presentation_scopes — the presentation lens's redaction scope

Revision ID: presentation_scope_01
Revises: wthr_01
Create Date: 2026-10-23

Phase 1 of plan ``2026-10-23-console-presentation-spaces``
(qontinui-dev-notes/plans), design decision D3.3. One table in the EXISTING
web-owned ``web`` schema. Product data, not orchestration: no ``coord.*``
relation is created, altered or referenced, so
``[policy: alembic-sole-authorship]``'s coord ordering is not engaged.

``down_revision`` is this repo's single alembic head at authoring time; if
another revision lands first, re-point it at the new head and move the
``Revises:`` line above with it (``tests/test_presentation_scope_01_migration.py``
reads the parent from ``down_revision`` itself). Do NOT author an ``alembic
merge`` revision.

Why a new table
===============
The scope is per coord tenant (what the console calls a project). The
existing settings stores do not fit: ``auth.organizations.settings`` is keyed
by WEB organization, a different id space from coord's tenants;
``overview.settings`` is keyed by tenant but is the Project Overview's own
settings (currency, billing), gated by that surface's ``editing_roles``; and
``web.taste_settings`` is one domain's single dial. Each tenant-keyed domain
here owns its own table, so this one does too.

Table
=====
``web.presentation_scopes``
    One row per tenant (``tenant_id``, no FK — coord's tenants live in coord's
    deployment). ``first_party_owners`` is the GitHub owners whose
    repositories are the tenant's own, NULL when not configured (the read door
    then derives them from the tenant's registered repositories);
    ``confidential_terms`` the words that withhold a title wherever they
    appear. ``version`` starts at 1 and moves by one on every write: a write
    names the version it read and is refused when the row moved, so two
    admins editing at once cannot silently drop each other's terms.
    ``updated_by_user_id`` / ``updated_at`` record the last write. No row
    means the documented defaults.

Design notes
============
* **The viewer's other projects' names are never stored.** The read door adds
  them to the confidential terms on every read; they are the viewer's, and a
  row every member of the tenant can read must not carry one admin's other
  memberships.
* **The bounds are constraints.** ``ck_presentation_scopes_owner_count`` (at
  most 50 owners) and ``ck_presentation_scopes_term_count`` (at most 200
  terms) match the write schema's limits; ``ck_presentation_scopes_version``
  keeps the version positive. Explicit stable names, so a later widening can
  ``DROP CONSTRAINT <known name>``.
* **The writer FK** points at ``auth.users`` with ``ON DELETE SET NULL``:
  deleting a user keeps the tenant's scope and forgets who saved it.

Locking: the table is created EMPTY, but its FK points at the LIVE
``auth.users``, and creating an FK takes a SHARE ROW EXCLUSIVE lock on the
referenced table (no scan: the referencing table is empty). Login writes that
table, so the wait is bounded: every statement runs under ``SET LOCAL
lock_timeout = '3s'`` and a blocked apply fails fast instead of queueing
writers behind it (``SET LOCAL … = DEFAULT`` restores it; ``RESET`` is not an
admitted statement).

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly. Writes **no rows**.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "presentation_scope_01"
down_revision: str = "wthr_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``web.presentation_scopes``."""
    # Bound the wait for the referenced table's lock (module docstring).
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS web.presentation_scopes (
            tenant_id           UUID PRIMARY KEY,
            first_party_owners  TEXT[]
                CONSTRAINT ck_presentation_scopes_owner_count
                CHECK (first_party_owners IS NULL
                       OR cardinality(first_party_owners) <= 50),
            confidential_terms  TEXT[] NOT NULL DEFAULT '{}'::text[]
                CONSTRAINT ck_presentation_scopes_term_count
                CHECK (cardinality(confidential_terms) <= 200),
            version             INTEGER NOT NULL DEFAULT 1
                CONSTRAINT ck_presentation_scopes_version
                CHECK (version >= 1),
            updated_by_user_id  UUID
                CONSTRAINT fk_presentation_scopes_updated_by
                REFERENCES auth.users (id) ON DELETE SET NULL,
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop ``web.presentation_scopes``. The ``web`` schema stays. Dropping
    the FK locks ``auth.users``, so the wait is bounded as in the upgrade."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS web.presentation_scopes")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
