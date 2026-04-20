"""
Security services for code scanning and validation.

Provides:
- CodeSecurityScanner: Comprehensive security scanner for Python code
- Security models and constants
"""

from app.services.security.constants import (
    BLOCKED_FUNCTIONS,
    BLOCKED_IMPORTS,
    MAX_COMPLEXITY_BLOCK,
    MAX_COMPLEXITY_WARN,
    MAX_NESTING_DEPTH,
    MIN_MAINTAINABILITY_INDEX,
    OBFUSCATION_PATTERNS,
    SAFE_IMPORTS,
    WARNING_IMPORTS,
)
from app.services.security.models import (
    IssueSeverity,
    IssueType,
    SecurityIssue,
    SecurityScanResult,
    SecurityStatus,
)
from app.services.security.scanner import CodeSecurityScanner

__all__ = [
    # Main scanner
    "CodeSecurityScanner",
    # Models
    "SecurityStatus",
    "IssueSeverity",
    "IssueType",
    "SecurityIssue",
    "SecurityScanResult",
    # Constants
    "BLOCKED_IMPORTS",
    "BLOCKED_FUNCTIONS",
    "WARNING_IMPORTS",
    "SAFE_IMPORTS",
    "MAX_COMPLEXITY_BLOCK",
    "MAX_COMPLEXITY_WARN",
    "MAX_NESTING_DEPTH",
    "MIN_MAINTAINABILITY_INDEX",
    "OBFUSCATION_PATTERNS",
]
