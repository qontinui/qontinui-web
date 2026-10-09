"""Operator-chosen model family per plan difficulty — ``agent.plan_difficulty_model_routes``.

Plan ``2026-10-08-operator-editable-model-family-per-plan-difficulty``. Mirrors
alembic revision ``plan_library_10_model_routes``; read that migration's
docstring for why the table is keyed the way it is.

One row per ``(organization, level)``: the model FAMILY a plan rated ``level``
routes to, in the selector vocabulary
:data:`app.services.plan_difficulty.MODEL_SELECTOR_VOCABULARY`. A level with no
row resolves to :data:`app.services.plan_difficulty.DEFAULT_MODEL_SELECTORS`
(see :mod:`app.services.plan_model_routing`), so an empty table serves exactly
what the hardcoded map served before this table existed.

The family is stored, never a model version: the harness resolves a family
alias to that family's LATEST model, which is the operator's stated intent
("when Opus is selected, it should use the latest Opus").
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Text, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

#: The difficulty levels a row may name. The ONE copy the CHECK is built from;
#: ``tests/test_plan_model_routing.py`` pins it against ``DifficultyLevel`` and
#: against the shipped migration's literal CHECK.
ROUTE_LEVELS: tuple[str, ...] = ("high", "medium", "low")

#: The model families a row may name — the ``claude_code_agent_tool_v1``
#: selector vocabulary (the Claude Code Agent tool's ``model`` enum). Same
#: pinning as :data:`ROUTE_LEVELS`.
MODEL_FAMILIES: tuple[str, ...] = ("fable", "opus", "sonnet", "haiku")

LEVEL_CHECK_SQL = "level IN ({})".format(", ".join(f"'{v}'" for v in ROUTE_LEVELS))
FAMILY_CHECK_SQL = "model_family IN ({})".format(
    ", ".join(f"'{v}'" for v in MODEL_FAMILIES)
)


class PlanDifficultyModelRoute(Base):
    """The model family one organization routes one difficulty level to."""

    __tablename__ = "plan_difficulty_model_routes"
    __table_args__ = (
        CheckConstraint(LEVEL_CHECK_SQL, name="ck_plan_difficulty_model_routes_level"),
        CheckConstraint(
            FAMILY_CHECK_SQL, name="ck_plan_difficulty_model_routes_family"
        ),
        {"schema": "agent"},
    )

    # No FK, matching ``agent.work_artifacts.organization_id``. NOT NULL, unlike
    # that column: the NULL bucket is shared by every principal without a
    # personal organization, so a routing assertion there would re-route
    # someone else's sweeps — that scope reads the defaults and cannot write.
    organization_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True
    )
    level: Mapped[str] = mapped_column(Text, primary_key=True)
    model_family: Mapped[str] = mapped_column(Text, nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=text("now()"),
    )
    #: The Cognito user who wrote the row. FK-less, like the other ``agent``
    #: tables' actor columns: the row outlives an account.
    updated_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
