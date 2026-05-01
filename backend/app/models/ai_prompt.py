"""
AI prompt template and sequence models.

Stores reusable AI prompt templates and prompt sequences for automation workflows.
Templates can be referenced from workflow actions and composed into sequences for
complex multi-step AI operations.
"""

from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class AIPromptTemplate(Base):
    """
    Reusable AI prompt template.

    Templates define prompts that can be reused across workflows and sequences.
    They support parameters using {parameter_name} syntax for dynamic values.

    Example:
        Template: "Fix all type errors in {module_path}. Run mypy first."
        Parameters: [{"name": "module_path", "type": "string", "required": true}]
    """

    __tablename__ = "ai_prompt_templates"
    __table_args__ = {"schema": "project"}

    id = Column(String, primary_key=True, index=True)  # User-defined ID
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("project.projects.id"),
        nullable=False,
        index=True,
    )
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("auth.users.id"), nullable=False, index=True
    )

    # Display metadata
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True, index=True)
    tags = Column(JSON, nullable=False, default=list)  # List of strings

    # Prompt content
    prompt = Column(
        Text, nullable=False
    )  # Prompt text with optional {param} placeholders

    # Parameters
    parameters = Column(
        JSON, nullable=False, default=list
    )  # List of PromptParameter dicts

    # Versioning
    current_version = Column(Integer, nullable=True)  # Current active version number

    # Execution defaults
    default_timeout = Column(
        Integer, nullable=True, default=600000
    )  # Milliseconds (10 min default)
    default_working_directory = Column(String, nullable=True)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    project = relationship("Project", backref="ai_prompt_templates")
    creator = relationship("User", backref="created_prompt_templates")
    versions = relationship("PromptTemplateVersion", back_populates="template")

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "created_by": self.created_by,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "tags": self.tags,
            "prompt": self.prompt,
            "parameters": self.parameters,
            "current_version": self.current_version,
            "default_timeout": self.default_timeout,
            "default_working_directory": self.default_working_directory,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PromptSequence(Base):
    """
    Ordered sequence of AI prompts executed with context isolation.

    Each step runs in a fresh AI session to avoid context overflow.
    Results from each step are persisted to files/variables for subsequent steps.

    This is the key abstraction for running complex multi-step AI workflows
    like code improvement pipelines that would otherwise overflow context.

    Example:
        Sequence: "Full Code Improvement"
        Steps:
            1. Clean and format code
            2. Fix type errors
            3. Security audit
            4. Implement TODOs
    """

    __tablename__ = "prompt_sequences"
    __table_args__ = {"schema": "project"}

    id = Column(String, primary_key=True, index=True)  # User-defined ID
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("project.projects.id"),
        nullable=False,
        index=True,
    )
    created_by = Column(
        UUID(as_uuid=True), ForeignKey("auth.users.id"), nullable=False, index=True
    )

    # Display metadata
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True, index=True)
    tags = Column(JSON, nullable=False, default=list)  # List of strings

    # Sequence configuration
    steps = Column(JSON, nullable=False)  # List of PromptSequenceStep dicts

    # Error handling
    on_failure = Column(
        String, nullable=False, default="stop"
    )  # "stop", "continue", "retry"
    max_retries = Column(Integer, nullable=False, default=0)

    # Output settings
    results_directory = Column(String, nullable=True)

    # Execution settings
    default_timeout = Column(
        Integer, nullable=True, default=600000
    )  # Milliseconds (10 min default)

    # Timestamps
    created_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    project = relationship("Project", backref="prompt_sequences")
    creator = relationship("User", backref="created_prompt_sequences")

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "created_by": self.created_by,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "tags": self.tags,
            "steps": self.steps,
            "on_failure": self.on_failure,
            "max_retries": self.max_retries,
            "results_directory": self.results_directory,
            "default_timeout": self.default_timeout,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
