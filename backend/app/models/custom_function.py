"""
Custom function models for storing discovered @automation_function decorators.

Tracks user-defined automation functions discovered in uploaded Python files.
"""

from datetime import datetime

from app.db.base import Base
from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship


class CustomFunction(Base):
    """
    Represents a custom automation function discovered in user code.

    When users upload Python files with @automation_function decorators,
    the function scanner extracts metadata and stores it here for:
    - Function library browsing
    - Autocomplete in workflow builder
    - Documentation generation
    - Execution by automation engine
    """

    __tablename__ = "custom_functions"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    file_path = Column(String, nullable=False, index=True)  # Relative path in project

    # Function identity
    function_name = Column(String, nullable=False, index=True)  # Python function name

    # Display metadata (from decorator)
    display_name = Column(String, nullable=True)  # Human-readable name
    description = Column(Text, nullable=True)  # Short description
    category = Column(String, nullable=True, index=True)  # Category for organization
    tags = Column(JSON, nullable=False, default=list)  # List of tags for search

    # Function signature
    parameters = Column(
        JSON, nullable=False, default=list
    )  # List[FunctionParameter] as dict
    return_type = Column(String, nullable=True)  # Return type annotation

    # Decorator metadata
    inputs = Column(JSON, nullable=False, default=dict)  # {param_name: type_string}
    outputs = Column(JSON, nullable=False, default=dict)  # {output_name: type_string}
    observable_outputs = Column(
        JSON, nullable=False, default=list
    )  # List of observable outputs for RL

    # Source code
    source_code = Column(Text, nullable=True)  # Full function source
    docstring = Column(Text, nullable=True)  # Extracted docstring
    line_start = Column(Integer, nullable=True)  # Start line in file
    line_end = Column(Integer, nullable=True)  # End line in file

    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    project = relationship("Project", backref="custom_functions")

    # Ensure unique function per file in project
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "file_path",
            "function_name",
            name="uq_project_file_function",
        ),
    )

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "file_path": self.file_path,
            "function_name": self.function_name,
            "display_name": self.display_name,
            "description": self.description,
            "category": self.category,
            "tags": self.tags,
            "parameters": self.parameters,
            "return_type": self.return_type,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "observable_outputs": self.observable_outputs,
            "source_code": self.source_code,
            "docstring": self.docstring,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
