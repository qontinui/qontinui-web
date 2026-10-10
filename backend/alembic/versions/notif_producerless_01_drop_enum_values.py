"""project.notifications: delete the five producer-less labels and their rows.

Phase 2 of plan
``qontinui-dev-notes/plans/2026-09-19-delete-producerless-notification-types-and-their-toggles.md``.

``LOCK_RELEASED``, ``PROJECT_UPDATE``, ``TEAM_INVITE``, ``ACCESS_GRANTED`` and
``ACCESS_REVOKED`` have no producer: a repo-wide ``git grep`` for
``NotificationType.<X>`` finds each only in its own enum definition. (The
``"LOCK_RELEASED"`` string the sync websocket sends is an unrelated message
type, not a notification.) This revision deletes every notification carrying
one of those labels and removes the five labels from the ``notificationtype``
PG ENUM.

Deploy-order safety — why this revision drops NO column
==========================================================================

``migrate.yml`` and ``deploy-web.yml`` fire on the same push with no ordering
between them, so a revision must be safe against BOTH the image it ships with
and the image serving before it:

* The previous image never writes any of the five labels (they have no
  producer) and its Python enum is a superset of the trimmed PG enum, so it is
  unaffected.
* The new image still carries the five ``NotificationType`` members, so a
  stored row this revision has not yet deleted still loads if the image serves
  first (``Enum(NotificationType)`` maps stored member NAMES).

The dead ``email_team_invites`` / ``in_app_team_invites`` /
``in_app_project_updates`` columns are deliberately NOT dropped here: the
previous image still maps them, and dropping them under it would break every
``NotificationPreferences`` load. The drop is Phase 3 of the plan, taken once
this change's image is the one serving (the "gone means DEPLOYED, not merged"
rule in ``knowledge-base/qontinui-specific/database-migrations.md``).

Why the three columns gain ``DEFAULT true`` here — for Phase 3's image
==========================================================================

``05a366f58455_initial_schema_squashed`` created all three columns
``nullable=False`` with NO server default; the ORM's Python-side
``default=True`` supplies the value on every INSERT. That is why the image
this revision ships with still MAPS the three columns (it only stops reading
and exposing them): if that image served before this revision ran, an
unmapped column would make every ``NotificationPreferences.create_default``
INSERT violate NOT NULL.

Phase 3 removes the mappings together with a revision that drops the columns,
and meets the same race in its turn: its image may serve before its drop runs.
The server default set here is what makes that safe — an INSERT omitting the
columns is then legal against the not-yet-dropped schema. So the default must
be DEPLOYED before Phase 3 starts, which is why it lands now. It is harmless to
every image that maps the columns (they send an explicit value), and adding a
default is a catalog-only change (no table rewrite).

Dropping ENUM values
==========================================================================

PostgreSQL has no ``ALTER TYPE … DROP VALUE``. The labels are removed by
rename-and-recreate, the exact sequence ``notif_gate_action_03`` used: delete
the rows that carry the values, rename the type aside, create the trimmed type,
re-type the one column that uses it (``project.notifications.type``, whose
btree index is rebuilt by the ``ALTER COLUMN … TYPE``), then drop the old type.

Lock bound
==========================================================================

The re-type takes ``ACCESS EXCLUSIVE`` on ``project.notifications`` and the
default change takes it on ``project.notification_preferences``. Both
``upgrade()`` and ``downgrade()`` bound the wait with
``SET LOCAL lock_timeout = '3s'`` (the convention
``notif_gate_action_04_drop_dead_prefs`` follows): a QUEUED ``ACCESS
EXCLUSIVE`` request blocks every reader and writer behind it, so failing fast
beats stalling. ``RESET lock_timeout`` at the end is REQUIRED: ``env.py`` runs
every revision of one ``alembic upgrade`` in a single transaction, so an
unreset ``SET LOCAL`` would leak into every later migration.

Downgrade
==========================================================================

Drops the three server defaults, then re-adds the five labels with
``ADD VALUE IF NOT EXISTS`` inside an ``autocommit_block`` (``ADD VALUE``
cannot run inside the migration transaction — same shape as
``notif_gate_action_03``'s downgrade). Deleted rows are not restored.

Revision ID: notif_producerless_01_drop_enum_values
Revises: census_idx_01_device_repo_path_observed
Create Date: 2026-09-30
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "notif_producerless_01_drop_enum_values"
down_revision: str | Sequence[str] | None = "census_idx_01_device_repo_path_observed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The labels this revision removes, in the order gate_action_02 created them.
_DEAD_LABELS = (
    "LOCK_RELEASED",
    "PROJECT_UPDATE",
    "TEAM_INVITE",
    "ACCESS_GRANTED",
    "ACCESS_REVOKED",
)

# Every label that remains, in their original order.
_REMAINING_LABELS = "'MENTION', 'SHARE', 'COMMENT', 'REPLY'"

# The retired preference columns. They are NOT NULL with no server default
# until this revision gives them one, which the Phase 3 image (the first that
# no longer maps them) relies on.
_DEAD_PREF_COLUMNS = (
    "email_team_invites",
    "in_app_team_invites",
    "in_app_project_updates",
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    dead = ", ".join(f"'{label}'" for label in _DEAD_LABELS)
    op.execute(f"DELETE FROM project.notifications WHERE type IN ({dead})")
    op.execute("ALTER TYPE public.notificationtype RENAME TO notificationtype_old")
    op.execute(f"CREATE TYPE public.notificationtype AS ENUM ({_REMAINING_LABELS})")
    op.execute(
        "ALTER TABLE project.notifications "
        "ALTER COLUMN type TYPE public.notificationtype "
        "USING type::text::public.notificationtype"
    )
    op.execute("DROP TYPE public.notificationtype_old")
    for column in _DEAD_PREF_COLUMNS:
        op.execute(
            "ALTER TABLE project.notification_preferences "
            f"ALTER COLUMN {column} SET DEFAULT true"
        )
    op.execute("RESET lock_timeout")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    for column in _DEAD_PREF_COLUMNS:
        op.execute(
            "ALTER TABLE project.notification_preferences "
            f"ALTER COLUMN {column} DROP DEFAULT"
        )
    op.execute("RESET lock_timeout")
    with op.get_context().autocommit_block():
        for label in _DEAD_LABELS:
            op.execute(
                f"ALTER TYPE public.notificationtype ADD VALUE IF NOT EXISTS '{label}'"
            )
