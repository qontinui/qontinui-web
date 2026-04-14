"""
Code security scanner for community packages.

Provides comprehensive security scanning for Python code including:
- Import validation (blocks dangerous modules)
- AST-based pattern detection (eval, exec, file operations)
- Cyclomatic complexity analysis
- Obfuscation detection
- Syntax validation
"""

import ast
import re
from datetime import UTC, datetime
from typing import Any

from app.services.security.constants import (
    MAX_COMPLEXITY_BLOCK,
    MAX_COMPLEXITY_WARN,
    MAX_NESTING_DEPTH,
    MIN_MAINTAINABILITY_INDEX,
    OBFUSCATION_PATTERNS,
)
from app.services.security.models import (
    IssueSeverity,
    IssueType,
    SecurityIssue,
    SecurityScanResult,
    SecurityStatus,
)
from app.services.security.visitor import SecurityASTVisitor
from radon.complexity import cc_visit  # type: ignore[import-untyped]
from radon.metrics import mi_visit  # type: ignore[import-untyped]


class CodeSecurityScanner:
    """Comprehensive security scanner for Python code."""

    def validate_syntax(self, code: str) -> SecurityScanResult:
        """
        Validate Python syntax.

        Args:
            code: Python code to validate

        Returns:
            SecurityScanResult with syntax validation results
        """
        result = SecurityScanResult(
            status=SecurityStatus.PASSED, risk_score=0, issues=[]
        )

        try:
            ast.parse(code)
        except SyntaxError as e:
            result.add_issue(
                severity=IssueSeverity.CRITICAL,
                issue_type=IssueType.SYNTAX_ERROR,
                line_number=e.lineno,
                column=e.offset,
                message=f"Syntax error: {e.msg}",
                suggestion="Fix syntax errors before publishing",
            )
            result.status = SecurityStatus.FAILED

        return result

    def validate_imports(self, code: str) -> list[SecurityIssue]:
        """
        Validate imports using AST parsing.

        Args:
            code: Python code to validate

        Returns:
            List of security issues related to imports
        """
        issues: list[SecurityIssue] = []
        try:
            tree = ast.parse(code)
            code_lines = code.split("\n")
            visitor = SecurityASTVisitor(code_lines)
            visitor.visit(tree)
            # Return only import-related issues
            return [
                issue
                for issue in visitor.issues
                if issue.issue_type == IssueType.BLOCKED_IMPORT
            ]
        except SyntaxError:
            # Syntax errors handled separately
            pass

        return issues

    def detect_dangerous_patterns(self, code: str) -> list[SecurityIssue]:
        """
        Detect dangerous patterns using AST analysis.

        Args:
            code: Python code to analyze

        Returns:
            List of security issues related to dangerous patterns
        """
        issues: list[SecurityIssue] = []
        try:
            tree = ast.parse(code)
            code_lines = code.split("\n")
            visitor = SecurityASTVisitor(code_lines)
            visitor.visit(tree)

            # Return pattern-related issues (excluding imports)
            return [
                issue
                for issue in visitor.issues
                if issue.issue_type
                in [
                    IssueType.BLOCKED_FUNCTION,
                    IssueType.FILE_OPERATION,
                    IssueType.NETWORK_OPERATION,
                    IssueType.DYNAMIC_IMPORT,
                    IssueType.GLOBAL_VARIABLE,
                ]
            ]
        except SyntaxError:
            # Syntax errors handled separately
            pass

        return issues

    def check_complexity(self, code: str) -> dict[str, Any]:
        """
        Check cyclomatic complexity and maintainability.

        Args:
            code: Python code to analyze

        Returns:
            Dict with complexity metrics and issues
        """
        metrics: dict[str, Any] = {
            "average_complexity": 0,
            "max_complexity": 0,
            "total_functions": 0,
            "maintainability_index": 0,
            "issues": [],
        }
        issues_list: list[SecurityIssue] = []

        try:
            # Calculate cyclomatic complexity
            complexity_results = cc_visit(code)
            if complexity_results:
                complexities = [result.complexity for result in complexity_results]
                metrics["average_complexity"] = sum(complexities) / len(complexities)
                metrics["max_complexity"] = max(complexities)
                metrics["total_functions"] = len(complexity_results)

                # Check for high complexity functions
                for result in complexity_results:
                    if result.complexity > MAX_COMPLEXITY_BLOCK:
                        issues_list.append(
                            SecurityIssue(
                                severity=IssueSeverity.HIGH,
                                issue_type=IssueType.HIGH_COMPLEXITY,
                                line_number=result.lineno,
                                message=f"Function '{result.name}' has very high complexity ({result.complexity})",
                                suggestion="Break down into smaller functions (target: < 10)",
                            )
                        )
                    elif result.complexity > MAX_COMPLEXITY_WARN:
                        issues_list.append(
                            SecurityIssue(
                                severity=IssueSeverity.MEDIUM,
                                issue_type=IssueType.HIGH_COMPLEXITY,
                                line_number=result.lineno,
                                message=f"Function '{result.name}' has high complexity ({result.complexity})",
                                suggestion="Consider simplifying (target: < 10)",
                            )
                        )

            # Calculate maintainability index
            mi_results = mi_visit(code, multi=True)
            if mi_results:
                metrics["maintainability_index"] = mi_results

                if mi_results < MIN_MAINTAINABILITY_INDEX:
                    issues_list.append(
                        SecurityIssue(
                            severity=IssueSeverity.MEDIUM,
                            issue_type=IssueType.LOW_MAINTAINABILITY,
                            message=f"Low maintainability index ({mi_results:.1f})",
                            suggestion="Improve code structure and readability (target: > 20)",
                        )
                    )

            # Check nesting depth
            tree = ast.parse(code)
            code_lines = code.split("\n")
            visitor = SecurityASTVisitor(code_lines)
            visitor.visit(tree)

            if visitor.max_nesting_depth > MAX_NESTING_DEPTH:
                issues_list.append(
                    SecurityIssue(
                        severity=IssueSeverity.MEDIUM,
                        issue_type=IssueType.DEEP_NESTING,
                        message=f"Deep nesting detected ({visitor.max_nesting_depth} levels)",
                        suggestion=f"Reduce nesting depth (target: <= {MAX_NESTING_DEPTH})",
                    )
                )

        except Exception as e:
            # If complexity analysis fails, add a warning
            issues_list.append(
                SecurityIssue(
                    severity=IssueSeverity.LOW,
                    issue_type=IssueType.HIGH_COMPLEXITY,
                    message=f"Complexity analysis failed: {str(e)}",
                )
            )

        metrics["issues"] = issues_list
        return metrics

    def detect_obfuscation(self, code: str) -> list[SecurityIssue]:
        """
        Detect code obfuscation patterns.

        Args:
            code: Python code to analyze

        Returns:
            List of security issues related to obfuscation
        """
        issues = []

        for pattern_name, pattern in OBFUSCATION_PATTERNS.items():
            matches = list(re.finditer(pattern, code, re.MULTILINE))
            if matches:
                # Get line number of first match
                first_match = matches[0]
                line_number = code[: first_match.start()].count("\n") + 1

                issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.HIGH,
                        issue_type=IssueType.OBFUSCATION,
                        line_number=line_number,
                        message=f"Obfuscation pattern detected: {pattern_name} ({len(matches)} occurrence(s))",
                        suggestion="Remove obfuscated code; use clear, readable code",
                    )
                )

        return issues

    def scan_code(self, code: str, verified: bool = False) -> SecurityScanResult:
        """
        Main scanning function - performs comprehensive security scan.

        Args:
            code: Python code to scan
            verified: If True, bypasses some checks (staff-approved packages)

        Returns:
            SecurityScanResult with all findings
        """
        result = SecurityScanResult(
            status=SecurityStatus.PASSED,
            risk_score=0,
            issues=[],
            scanned_at=datetime.now(UTC).isoformat(),
        )

        # 1. Validate syntax (always required)
        syntax_result = self.validate_syntax(code)
        result.issues.extend(syntax_result.issues)
        if syntax_result.status == SecurityStatus.FAILED:
            result.status = SecurityStatus.FAILED
            result.calculate_risk_score()
            return result

        # 2. Validate imports
        if not verified:
            import_issues = self.validate_imports(code)
            result.issues.extend(import_issues)

        # 3. Detect dangerous patterns
        if not verified:
            pattern_issues = self.detect_dangerous_patterns(code)
            result.issues.extend(pattern_issues)

        # 4. Check complexity (always run, but warnings only)
        complexity_metrics = self.check_complexity(code)
        result.complexity_metrics = {
            "average_complexity": complexity_metrics.get("average_complexity", 0),
            "max_complexity": complexity_metrics.get("max_complexity", 0),
            "total_functions": complexity_metrics.get("total_functions", 0),
            "maintainability_index": complexity_metrics.get("maintainability_index", 0),
        }
        result.issues.extend(complexity_metrics.get("issues", []))

        # 5. Detect obfuscation
        if not verified:
            obfuscation_issues = self.detect_obfuscation(code)
            result.issues.extend(obfuscation_issues)

        # 6. Calculate final status and risk score
        result.calculate_status()
        result.calculate_risk_score()

        # 7. Generate recommendations
        result.recommendations = self._generate_recommendations(result)

        return result

    def _generate_recommendations(self, result: SecurityScanResult) -> list[str]:
        """Generate security recommendations based on scan results."""
        recommendations = []

        # Group issues by type
        issue_types: dict[IssueType, list[SecurityIssue]] = {}
        for issue in result.issues:
            issue_type = issue.issue_type
            if issue_type not in issue_types:
                issue_types[issue_type] = []
            issue_types[issue_type].append(issue)

        # Generate recommendations
        if IssueType.BLOCKED_IMPORT in issue_types:
            recommendations.append(
                "Remove blocked imports (os, subprocess, socket, etc.) - these pose security risks"
            )

        if IssueType.BLOCKED_FUNCTION in issue_types:
            recommendations.append(
                "Remove dangerous function calls (eval, exec, open, etc.) - these pose security risks"
            )

        if (
            IssueType.FILE_OPERATION in issue_types
            or IssueType.NETWORK_OPERATION in issue_types
        ):
            recommendations.append(
                "Remove file and network operations - community packages should be pure functions"
            )

        if IssueType.HIGH_COMPLEXITY in issue_types:
            recommendations.append(
                "Reduce code complexity by breaking down large functions into smaller ones"
            )

        if IssueType.DEEP_NESTING in issue_types:
            recommendations.append(
                "Reduce nesting depth by using early returns and extracting functions"
            )

        if IssueType.OBFUSCATION in issue_types:
            recommendations.append(
                "Remove obfuscated code patterns - use clear, readable code"
            )

        if IssueType.GLOBAL_VARIABLE in issue_types:
            recommendations.append(
                "Avoid global variables - use function parameters and return values"
            )

        if IssueType.DYNAMIC_IMPORT in issue_types:
            recommendations.append(
                "Replace dynamic imports with static import statements"
            )

        # Add general recommendations based on status
        if result.status == SecurityStatus.FAILED:
            recommendations.insert(
                0, "This code cannot be published due to critical security issues"
            )
        elif result.status == SecurityStatus.WARNING:
            recommendations.insert(
                0,
                "This code can be published with warnings - review issues before publishing",
            )
        else:
            recommendations.insert(0, "Code passed security scan - ready to publish")

        return recommendations
