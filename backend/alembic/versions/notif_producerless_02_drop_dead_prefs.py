"""project notification prefs: drop the three producer-less preference columns.

Phase 4 of plan
``qontinui-dev-notes/plans/2026-09-19-delete-producerless-notification-types-and-their-toggles.md``.

Drops the three columns whose only consumers were the retired
``TEAM_INVITE`` / ``PROJECT_UPDATE`` notification types:

* ``project.notification_preferences.email_team_invites``
* ``project.notification_preferences.in_app_team_invites``
* ``project.notification_preferences.in_app_project_updates``

(all three created ``NOT NULL`` with no server default by
``05a366f58455_initial_schema_squashed``; ``notif_producerless_01_drop_enum_values``
gave them ``DEFAULT true``).

Why this is a SEPARATE revision from the code that stopped mapping them
==========================================================================

``migrate.yml`` and ``deploy-web.yml`` fire on the same push with no ordering
between them, so a revision must be safe against BOTH the image it ships with
and the image serving before it ("gone means DEPLOYED, not merged" —
``knowledge-base/qontinui-specific/database-migrations.md``).

The change that removed the ORM mappings (qontinui-web#1836) shipped no
migration: under the image serving before it the columns were still mapped,
so dropping them then would have broken every ``NotificationPreferences`` load
whenever ``migrate.yml`` ran first. ``notif_producerless_01``'s ``DEFAULT true``
is what let the unmapping image's INSERTs omit them.

This revision lands only once #1836's image is SERVING (checked with
``deploy_healthy {service: web}`` against #1836's landed main sha), so no live
image maps these columns and the drop is unobservable. Same split as
``notif_gate_action_03`` / ``notif_gate_action_04``.

Bounded lock wait
==========================================================================

``DROP COLUMN`` takes ``ACCESS EXCLUSIVE`` on
``project.notification_preferences``. A QUEUED ``ACCESS EXCLUSIVE`` request
blocks every reader and writer arriving behind it, so both directions bound
the wait with ``SET LOCAL lock_timeout = '3s'`` exactly as
``notif_gate_action_04_drop_dead_prefs`` does. ``env.py`` runs every revision
of one ``alembic upgrade`` in a single transaction, but its
``on_version_apply`` hook already issues ``RESET lock_timeout`` after each
applied revision (``RESET_AFTER_EACH_REVISION_SQL``), so the trailing
``RESET`` here is a redundant local safeguard, kept to match the precedent.

Downgrade
==========================================================================

Restores the SHAPE, not the data: the three columns come back
``NOT NULL DEFAULT true`` — the shape ``notif_producerless_01`` left them in —
and existing rows pick up the default (the original default-ON behaviour).

Revision ID: notif_producerless_02_drop_dead_prefs
Revises: coord_pdclaims_02_claim_lifecycle
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "notif_producerless_02_drop_dead_prefs"
down_revision: str | Sequence[str] | None = "coord_pdclaims_02_claim_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PREF_COLUMNS = ("email_team_invites", "in_app_team_invites", "in_app_project_updates")


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    for column in _PREF_COLUMNS:
        op.drop_column("notification_preferences", column, schema="project")
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    for column in reversed(_PREF_COLUMNS):
        op.add_column(
            "notification_preferences",
            sa.Column(
                column,
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
            schema="project",
        )
    op.execute("RESET lock_timeout")
