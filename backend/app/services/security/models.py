"""
Security models for code scanning results.

Provides Pydantic models for representing security scan results,
issues, and their severities.
"""

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class SecurityStatus(StrEnum):
    """Security scan status."""

    PASSED = "passed"  # No issues, safe to publish
    WARNING = "warning"  # Has warnings, can publish with disclaimer
    FAILED = "failed"  # Has blocking issues, cannot publish


class IssueSeverity(StrEnum):
    """Security issue severity."""

    CRITICAL = "critical"  # Blocks publication
    HIGH = "high"  # Blocks publication
    MEDIUM = "medium"  # Warning
    LOW = "low"  # Informational
    INFO = "info"  # Informational


class IssueType(StrEnum):
    """Type of security issue."""

    BLOCKED_IMPORT = "blocked_import"
    BLOCKED_FUNCTION = "blocked_function"
    DANGEROUS_PATTERN = "dangerous_pattern"
    FILE_OPERATION = "file_operation"
    NETWORK_OPERATION = "network_operation"
    CODE_EXECUTION = "code_execution"
    HIGH_COMPLEXITY = "high_complexity"
    DEEP_NESTING = "deep_nesting"
    OBFUSCATION = "obfuscation"
    SYNTAX_ERROR = "syntax_error"
    GLOBAL_VARIABLE = "global_variable"
    DYNAMIC_IMPORT = "dynamic_import"
    LOW_MAINTAINABILITY = "low_maintainability"


class SecurityIssue(BaseModel):
    """A security issue found in code."""

    severity: IssueSeverity
    issue_type: IssueType
    line_number: int | None = None
    column: int | None = None
    message: str
    code_snippet: str | None = None
    suggestion: str | None = None


class SecurityScanResult(BaseModel):
    """Result of security scan."""

    status: SecurityStatus
    issues: list[SecurityIssue] = Field(default_factory=list)
    risk_score: int = Field(
        ge=0, le=100, description="Risk score from 0 (safe) to 100 (dangerous)"
    )
    recommendations: list[str] = Field(default_factory=list)
    complexity_metrics: dict[str, Any] = Field(default_factory=dict)
    scanned_at: str | None = None

    def add_issue(
        self,
        severity: IssueSeverity,
        issue_type: IssueType,
        message: str,
        line_number: int | None = None,
        column: int | None = None,
        code_snippet: str | None = None,
        suggestion: str | None = None,
    ) -> None:
        """Add an issue to the scan result."""
        self.issues.append(
            SecurityIssue(
                severity=severity,
                issue_type=issue_type,
                line_number=line_number,
                column=column,
                message=message,
                code_snippet=code_snippet,
                suggestion=suggestion,
            )
        )

    def calculate_status(self) -> None:
        """Calculate overall status based on issues."""
        has_critical = any(
            issue.severity in [IssueSeverity.CRITICAL, IssueSeverity.HIGH]
            for issue in self.issues
        )
        has_warnings = any(
            issue.severity == IssueSeverity.MEDIUM for issue in self.issues
        )

        if has_critical:
            self.status = SecurityStatus.FAILED
        elif has_warnings:
            self.status = SecurityStatus.WARNING
        else:
            self.status = SecurityStatus.PASSED

    def calculate_risk_score(self) -> None:
        """Calculate risk score based on issues (0-100)."""
        score = 0

        # Count issues by severity
        severity_weights = {
            IssueSeverity.CRITICAL: 30,
            IssueSeverity.HIGH: 20,
            IssueSeverity.MEDIUM: 10,
            IssueSeverity.LOW: 3,
            IssueSeverity.INFO: 1,
        }

        for issue in self.issues:
            score += severity_weights.get(issue.severity, 0)

        # Cap at 100
        self.risk_score = min(score, 100)
