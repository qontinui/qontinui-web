"""Registered-app config — SQLAlchemy mapping to ``project.apps``.

``project.apps`` is historically RUNNER-authored (spec-multi-app Stream B:
Atlas + a ``CREATE TABLE IF NOT EXISTS`` self-heal in the runner's
``pg/mod.rs``). The fleet-fresh P1a fields (``update_strategy``,
``build_command``, ``start_command``) were added by the alembic revision
``project_apps_p1a_auto_fresh_fields`` on the shared Postgres instance.

The web backend reads AND writes the fleet-config columns of this table
directly via this model (same shared-Postgres posture as
:class:`app.models.device.Device` against ``coord.devices``) so the fleet
UI can edit an app's update strategy + build/start commands. Registration
(``repo_root`` / spec thresholds) remains the runner's job — this model is
the read/config-write surface, not the registration authority.

``upstream_ref`` is intentionally absent: the landed P1a migration does
not add that column (the runner derives the upstream ref from the tree's
default branch), so it is not mapped here.
"""

from sqlalchemy import BigInteger, Boolean, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class App(Base):
    """Registered application row (``project.apps``)."""

    __tablename__ = "apps"
    __table_args__ = ({"schema": "project"},)

    app_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
        doc="Slug-style app id (matches the test_targets designation app_id).",
    )
    repo_root: Mapped[str] = mapped_column(Text, nullable=False)
    ui_bridge_url: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_seen_at_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    auth_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    red_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    yellow_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.8)

    # ---- Fleet-fresh P1a config fields -------------------------------------
    update_strategy: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default="pull_only",
        doc="'pull_only' (keep source current) or 'pull_build' (pull, build, restart).",
    )
    build_command: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Shell command to rebuild the app (pull_build strategy only).",
    )
    start_command: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Shell command to (re)start the app after a build.",
    )
