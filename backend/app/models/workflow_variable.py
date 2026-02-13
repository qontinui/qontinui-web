"""
Workflow variable models for three-tier variable storage system.

Architecture:
1. Global Variables: Project-scoped, persistent across all workflows (workflow_id=NULL)
2. Workflow Variables: Workflow-scoped, persistent within workflow runs (workflow_id set)
3. Execution Variables: Temporary, single run only (in-memory, no DB model)
"""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class VariableScope(StrEnum):
    """Variable scope enumeration."""

    GLOBAL = "global"  # Project-level variables
    WORKFLOW = "workflow"  # Workflow-level variables


class WorkflowVariable(Base):
    """
    Persistent workflow variables.

    Supports two scopes:
    - GLOBAL: Project-level variables (workflow_id is NULL)
    - WORKFLOW: Workflow-level variables (workflow_id is set)

    Note: Execution variables are temporary and stored in-memory only.
    """

    __tablename__ = "workflow_variables"

    id = Column(String, primary_key=True)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False, index=True
    )
    workflow_id = Column(
        String, nullable=True, index=True
    )  # NULL for global variables (workflow IDs are strings in project JSON)
    name = Column(String, nullable=False, index=True)
    value = Column(JSON, nullable=True)  # Supports any JSON-serializable type
    scope: Column[VariableScope] = Column(
        Enum(VariableScope), nullable=False, index=True
    )
    description = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    project = relationship("Project", backref="workflow_variables")
    history = relationship(
        "VariableHistory",
        back_populates="variable",
        cascade="all, delete-orphan",
        order_by="VariableHistory.changed_at.desc()",
    )

    # Ensure unique variable names per project/workflow combination
    __table_args__ = (
        UniqueConstraint(
            "project_id", "workflow_id", "name", name="uq_project_workflow_var"
        ),
    )


class VariableHistory(Base):
    """
    Track variable changes over time for auditing and debugging.

    Records:
    - What changed (old_value -> new_value)
    - When it changed (changed_at)
    - Which workflow run caused the change (workflow_run_id)
    - Which action triggered the change (changed_by_action)
    """

    __tablename__ = "variable_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    variable_id = Column(
        String, ForeignKey("workflow_variables.id"), nullable=False, index=True
    )
    workflow_run_id = Column(String, nullable=True, index=True)  # For tracking runs
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    changed_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    changed_by_action = Column(
        String, nullable=True
    )  # Action ID that triggered the change

    # Relationships
    variable = relationship("WorkflowVariable", back_populates="history")
