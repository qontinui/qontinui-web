"""
Code security scanner for community packages.

This module provides backward compatibility. Import from app.services.security instead.

All functionality has been refactored into:
- app.services.security.scanner - CodeSecurityScanner
- app.services.security.models - Security models (SecurityStatus, etc.)
- app.services.security.constants - Security constants (BLOCKED_IMPORTS, etc.)
- app.services.security.visitor - SecurityASTVisitor
"""

# Re-export everything from the new location for backward compatibility
from app.services.security import (
    BLOCKED_FUNCTIONS,
    BLOCKED_IMPORTS,
    MAX_COMPLEXITY_BLOCK,
    MAX_COMPLEXITY_WARN,
    MAX_NESTING_DEPTH,
    MIN_MAINTAINABILITY_INDEX,
    OBFUSCATION_PATTERNS,
    SAFE_IMPORTS,
    WARNING_IMPORTS,
    CodeSecurityScanner,
    IssueSeverity,
    IssueType,
    SecurityIssue,
    SecurityScanResult,
    SecurityStatus,
)
from app.services.security.visitor import SecurityASTVisitor

__all__ = [
    # Main scanner
    "CodeSecurityScanner",
    # Models
    "SecurityStatus",
    "IssueSeverity",
    "IssueType",
    "SecurityIssue",
    "SecurityScanResult",
    # AST Visitor
    "SecurityASTVisitor",
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
