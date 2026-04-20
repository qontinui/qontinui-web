"""Schemas for test result API operations."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.base import IsoDatetime


class IndividualTestResult(BaseModel):
    """Individual test within a test suite."""

    name: str
    status: str  # passed, failed, skipped, error
    duration_ms: int | None = None
    error_message: str | None = None
    file_path: str | None = None
    line_number: int | None = None


class CoverageData(BaseModel):
    """Code/state coverage data."""

    line_coverage: float | None = None
    branch_coverage: float | None = None
    function_coverage: float | None = None
    states_covered: list[str] | None = None
    transitions_covered: list[str] | None = None


class TestResultCreate(BaseModel):
    """Schema for creating a test result."""

    test_id: UUID | None = None
    task_run_id: UUID | None = None
    execution_run_id: UUID | None = None
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    output: str | None = None
    error_message: str | None = None
    structured_output: dict | None = None
    screenshots: list[str] | None = None
    assertions_passed: int | None = None
    assertions_failed: int | None = None
    individual_tests: list[IndividualTestResult] | None = None
    coverage: CoverageData | None = None
    exit_code: int | None = None


class TestResultUpdate(BaseModel):
    """Schema for updating a test result."""

    status: str | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    output: str | None = None
    error_message: str | None = None
    structured_output: dict | None = None
    screenshots: list[str] | None = None
    assertions_passed: int | None = None
    assertions_failed: int | None = None
    individual_tests: list[IndividualTestResult] | None = None
    coverage: CoverageData | None = None
    exit_code: int | None = None


class TestResultResponse(BaseModel):
    """Schema for test result response."""

    id: UUID
    test_id: UUID | None
    task_run_id: UUID | None
    execution_run_id: UUID | None
    status: str
    started_at: IsoDatetime | None
    completed_at: IsoDatetime | None
    duration_ms: int | None
    output: str | None
    error_message: str | None
    structured_output: dict | None
    screenshots: list[str]
    assertions_passed: int | None
    assertions_failed: int | None
    individual_tests: list[dict] | None
    coverage: dict | None
    exit_code: int | None
    created_at: IsoDatetime
    updated_at: IsoDatetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class TestResultSummary(BaseModel):
    """Summary of test results for a run."""

    total_tests: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    error: int = 0
    total_duration_ms: int = 0
