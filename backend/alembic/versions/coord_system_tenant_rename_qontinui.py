"""Rename the system tenant ``personal-jspinak`` → ``qontinui``.

Phase A.2 of plan ``2026-09-17-tenant-rename`` (design decision D8).

WHY A MIGRATION, AND WHY A NEW ONE
----------------------------------
The operator asked for tenant ``personal-jspinak`` (the system tenant,
``is_system = true``) to be renamed ``qontinui``. An agent cannot drive the
operator-only rename route against production (it is behind
``deny_non_interactive_write``, correctly), and hand DML against production is
ad-hoc mutation. So the rename rides the deploy pipeline as ONE reviewable
forward data migration.

It is deliberately NOT an edit to the eight already-applied migrations that
spell ``personal-jspinak`` (``coord_tenant_scope_columns`` mints it,
``coord_system_tenant_marker`` marks it, ...). Editing those would make them
stop describing what production ran and would change production downgrade
paths. Instead fresh databases still mint ``personal-jspinak`` early in the
chain and arrive at ``qontinui`` here — the same path production takes.

WHAT IT DOES (one statement block, so it is atomic)
---------------------------------------------------
When ALL preconditions hold:

* the system tenant (``is_system``) still has slug ``personal-jspinak``;
* no tenant already owns slug ``qontinui``;
* ``personal-jspinak`` is not already in ``coord.tenant_slug_history``;
* no ``coord.group_tenant_roles`` row already names ``qontinui`` — such a
  dangling mapping (no tenant behind it) would, after the rename, start
  granting its roles IN THE SYSTEM TENANT, and the cascade below could also
  collide on that table's primary key. Narrower than the plan text, never
  wider: prod measured 0 such rows on 2026-09-17.

it sets ``slug = 'qontinui'`` — and ``display_name = 'Qontinui'`` only when the
display name is still exactly the bootstrap ``Personal (jspinak)``, so a
customised name is kept — records
``('personal-jspinak', <tenant_id>, 'alembic:coord_system_tenant_rename_qontinui')``
in ``coord.tenant_slug_history`` (D3 — the old slug stays known so coord never
re-mints a tenant under it) and cascades ``coord.group_tenant_roles.tenant_slug``.
Otherwise it changes nothing and says which precondition failed with
``RAISE NOTICE`` — a no-op on a DB already renamed, on one where ``qontinui``
is taken, and on one with no system tenant.

DOWNGRADE
---------
Reverses exactly the row this revision moved, keyed by the history row carrying
this revision's ``renamed_by`` marker: the slug goes back to
``personal-jspinak``; ``display_name`` is set to the constant
``Personal (jspinak)`` only when it is still ``Qontinui`` (a customised name,
whether kept by the upgrade or edited later, is left alone); mappings naming
``qontinui`` follow the slug back; and the history row is deleted. A no-op with
a NOTICE when there is no marked history row, the tenant has since been renamed
away from ``qontinui``, another tenant now holds ``personal-jspinak``, or a
``coord.group_tenant_roles`` row already names ``personal-jspinak`` (moving the
``qontinui`` mappings back would collide on that table's primary key).

Revision ID: coord_system_tenant_rename_qontinui
Revises: coord_tenant_slug_history
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_system_tenant_rename_qontinui"
down_revision: str | Sequence[str] | None = "coord_tenant_slug_history"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UPGRADE = """
DO $$
DECLARE
    v_tenant_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM coord.tenants
         WHERE is_system AND slug = 'personal-jspinak'
    ) THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui: no-op, no system '
                     'tenant with slug personal-jspinak (already renamed, or '
                     'no system tenant)';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM coord.tenants WHERE slug = 'qontinui') THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui: no-op, slug '
                     'qontinui is already taken';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM coord.tenant_slug_history
         WHERE old_slug = 'personal-jspinak'
    ) THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui: no-op, '
                     'personal-jspinak is already in tenant_slug_history';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM coord.group_tenant_roles WHERE tenant_slug = 'qontinui'
    ) THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui: no-op, a '
                     'group_tenant_roles mapping already names qontinui';
        RETURN;
    END IF;

    UPDATE coord.tenants
       SET slug = 'qontinui',
           display_name = CASE WHEN display_name = 'Personal (jspinak)'
                               THEN 'Qontinui'
                               ELSE display_name END
     WHERE is_system
       AND slug = 'personal-jspinak'
    RETURNING tenant_id INTO v_tenant_id;

    IF v_tenant_id IS NULL THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui: no-op, the '
                     'system tenant row changed under the check';
        RETURN;
    END IF;

    INSERT INTO coord.tenant_slug_history (old_slug, tenant_id, renamed_by)
    VALUES ('personal-jspinak', v_tenant_id,
            'alembic:coord_system_tenant_rename_qontinui');

    UPDATE coord.group_tenant_roles
       SET tenant_slug = 'qontinui'
     WHERE tenant_slug = 'personal-jspinak';

    RAISE NOTICE 'coord_system_tenant_rename_qontinui: renamed tenant % '
                 'personal-jspinak -> qontinui', v_tenant_id;
END
$$;
"""

_DOWNGRADE = """
DO $$
DECLARE
    v_tenant_id uuid;
BEGIN
    SELECT h.tenant_id INTO v_tenant_id
      FROM coord.tenant_slug_history h
      JOIN coord.tenants t ON t.tenant_id = h.tenant_id
     WHERE h.old_slug = 'personal-jspinak'
       AND h.renamed_by = 'alembic:coord_system_tenant_rename_qontinui'
       AND t.slug = 'qontinui';

    IF v_tenant_id IS NULL THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui downgrade: no-op, '
                     'no tenant this revision renamed still holds qontinui';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM coord.tenants
         WHERE slug = 'personal-jspinak' AND tenant_id <> v_tenant_id
    ) THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui downgrade: no-op, '
                     'personal-jspinak is held by another tenant';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM coord.group_tenant_roles
         WHERE tenant_slug = 'personal-jspinak'
    ) THEN
        RAISE NOTICE 'coord_system_tenant_rename_qontinui downgrade: no-op, a '
                     'group_tenant_roles mapping already names personal-jspinak';
        RETURN;
    END IF;

    UPDATE coord.tenants
       SET slug = 'personal-jspinak',
           display_name = CASE WHEN display_name = 'Qontinui'
                               THEN 'Personal (jspinak)'
                               ELSE display_name END
     WHERE tenant_id = v_tenant_id;

    UPDATE coord.group_tenant_roles
       SET tenant_slug = 'personal-jspinak'
     WHERE tenant_slug = 'qontinui';

    DELETE FROM coord.tenant_slug_history
     WHERE old_slug = 'personal-jspinak'
       AND renamed_by = 'alembic:coord_system_tenant_rename_qontinui';
END
$$;
"""


def upgrade() -> None:
    """Rename the system tenant when every precondition holds; else a no-op."""
    op.execute(_UPGRADE)


def downgrade() -> None:
    """Reverse exactly the row this revision renamed, keyed by its history row."""
    op.execute(_DOWNGRADE)
