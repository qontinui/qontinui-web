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
import base64
import re
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from pydantic import BaseModel, Field
from radon.complexity import cc_visit
from radon.metrics import mi_visit

# ============================================================================
# Security Configuration
# ============================================================================

# Imports that are BLOCKED (high security risk)
BLOCKED_IMPORTS = {
    # File system operations
    "os",
    "pathlib",
    "shutil",
    "glob",
    "tempfile",
    "fileinput",
    # Network operations
    "socket",
    "socketserver",
    "http",
    "urllib",
    "urllib2",
    "urllib3",
    "requests",
    "httpx",
    "ftplib",
    "telnetlib",
    "smtplib",
    "poplib",
    "imaplib",
    # Process operations
    "subprocess",
    "multiprocessing",
    "threading",
    "asyncio.subprocess",
    # System operations
    "sys",
    "signal",
    "ctypes",
    "cffi",
    # Code execution
    "importlib",
    "runpy",
    "code",
    "codeop",
    # Serialization (unsafe)
    "pickle",
    "marshal",
    "shelve",
    "dill",
    # Other dangerous modules
    "pty",
    "tty",
    "rlcompleter",
    "__builtin__",
    "builtins",
}

# Functions that are BLOCKED (dangerous operations)
BLOCKED_FUNCTIONS = {
    "eval",
    "exec",
    "compile",
    "__import__",
    "open",
    "file",
    "input",
    "raw_input",
    "execfile",
    "reload",
    "delattr",
    "setattr",
    "getattr",  # Can be used for attribute access exploits
    "globals",
    "locals",
    "vars",
    "dir",
    "breakpoint",
    "help",
    "exit",
    "quit",
}

# Imports that generate WARNINGS (potentially risky)
WARNING_IMPORTS = {
    "random",  # Non-cryptographic randomness
    "hashlib",  # Cryptographic functions
    "secrets",  # Cryptographic secrets
    "ssl",  # SSL/TLS operations
    "webbrowser",  # Can open URLs
}

# Allowed safe imports (whitelist)
SAFE_IMPORTS = {
    # Data structures
    "collections",
    "array",
    "heapq",
    "bisect",
    "queue",
    "enum",
    # Math and numbers
    "math",
    "cmath",
    "decimal",
    "fractions",
    "statistics",
    # String processing
    "string",
    "re",
    "difflib",
    "textwrap",
    # Date and time
    "datetime",
    "time",
    "calendar",
    # Data formats
    "json",
    "csv",
    # Functional programming
    "itertools",
    "functools",
    "operator",
    # Type hints
    "typing",
    "types",
    # Data validation
    "dataclasses",
    # Other safe utilities
    "copy",
    "pprint",
    "uuid",
}

# Maximum complexity thresholds
MAX_COMPLEXITY_BLOCK = 20  # Block if complexity > 20
MAX_COMPLEXITY_WARN = 10  # Warn if complexity > 10
MAX_NESTING_DEPTH = 4  # Warn if nesting > 4 levels
MIN_MAINTAINABILITY_INDEX = 20  # Warn if MI < 20

# Obfuscation patterns
OBFUSCATION_PATTERNS = {
    "base64": r"base64\.(b64decode|b64encode|decodebytes|encodebytes)",
    "hex": r"(\\x[0-9a-fA-F]{2}){10,}",  # 10+ hex escape sequences
    "unicode": r"(\\u[0-9a-fA-F]{4}){5,}",  # 5+ unicode escapes
    "bytes_literal": r"b['\"](\\x[0-9a-fA-F]{2}){10,}['\"]",
    "chr_pattern": r"chr\s*\(\s*\d+\s*\)",  # chr() calls (often used in obfuscation)
    "compressed": r"(zlib|gzip|bz2|lzma)\.(decompress|compress)",
}


# ============================================================================
# Models
# ============================================================================


class SecurityStatus(str, Enum):
    """Security scan status."""

    PASSED = "passed"  # No issues, safe to publish
    WARNING = "warning"  # Has warnings, can publish with disclaimer
    FAILED = "failed"  # Has blocking issues, cannot publish


class IssueSeverity(str, Enum):
    """Security issue severity."""

    CRITICAL = "critical"  # Blocks publication
    HIGH = "high"  # Blocks publication
    MEDIUM = "medium"  # Warning
    LOW = "low"  # Informational
    INFO = "info"  # Informational


class IssueType(str, Enum):
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
    line_number: Optional[int] = None
    column: Optional[int] = None
    message: str
    code_snippet: Optional[str] = None
    suggestion: Optional[str] = None


class SecurityScanResult(BaseModel):
    """Result of security scan."""

    status: SecurityStatus
    issues: List[SecurityIssue] = Field(default_factory=list)
    risk_score: int = Field(
        ge=0, le=100, description="Risk score from 0 (safe) to 100 (dangerous)"
    )
    recommendations: List[str] = Field(default_factory=list)
    complexity_metrics: Dict[str, Any] = Field(default_factory=dict)
    scanned_at: Optional[str] = None

    def add_issue(
        self,
        severity: IssueSeverity,
        issue_type: IssueType,
        message: str,
        line_number: Optional[int] = None,
        column: Optional[int] = None,
        code_snippet: Optional[str] = None,
        suggestion: Optional[str] = None,
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


# ============================================================================
# AST Visitors for Security Analysis
# ============================================================================


class SecurityASTVisitor(ast.NodeVisitor):
    """AST visitor for detecting security issues."""

    def __init__(self, code_lines: List[str]):
        self.code_lines = code_lines
        self.issues: List[SecurityIssue] = []
        self.imports: Set[str] = set()
        self.function_calls: Set[str] = set()
        self.has_file_operations = False
        self.has_network_operations = False
        self.has_global_vars = False
        self.max_nesting_depth = 0
        self._current_nesting = 0

    def _get_code_snippet(self, lineno: int) -> str:
        """Get code snippet for a line number."""
        if 0 < lineno <= len(self.code_lines):
            return self.code_lines[lineno - 1].strip()
        return ""

    def _enter_block(self):
        """Track entering a code block."""
        self._current_nesting += 1
        self.max_nesting_depth = max(self.max_nesting_depth, self._current_nesting)

    def _exit_block(self):
        """Track exiting a code block."""
        self._current_nesting -= 1

    def visit_Import(self, node: ast.Import) -> None:
        """Check import statements."""
        for alias in node.names:
            module_name = alias.name.split(".")[0]
            self.imports.add(module_name)

            if module_name in BLOCKED_IMPORTS:
                self.issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.CRITICAL,
                        issue_type=IssueType.BLOCKED_IMPORT,
                        line_number=node.lineno,
                        column=node.col_offset,
                        message=f"Blocked import: '{module_name}' - poses security risk",
                        code_snippet=self._get_code_snippet(node.lineno),
                        suggestion=f"Remove import of '{module_name}' or use safer alternatives",
                    )
                )
            elif module_name in WARNING_IMPORTS:
                self.issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.MEDIUM,
                        issue_type=IssueType.BLOCKED_IMPORT,
                        line_number=node.lineno,
                        column=node.col_offset,
                        message=f"Warning: '{module_name}' import may require review",
                        code_snippet=self._get_code_snippet(node.lineno),
                        suggestion=f"Ensure '{module_name}' is used safely",
                    )
                )

        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        """Check from-import statements."""
        if node.module:
            module_name = node.module.split(".")[0]
            self.imports.add(module_name)

            if module_name in BLOCKED_IMPORTS:
                self.issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.CRITICAL,
                        issue_type=IssueType.BLOCKED_IMPORT,
                        line_number=node.lineno,
                        column=node.col_offset,
                        message=f"Blocked import from: '{module_name}' - poses security risk",
                        code_snippet=self._get_code_snippet(node.lineno),
                        suggestion=f"Remove import from '{module_name}' or use safer alternatives",
                    )
                )
            elif module_name in WARNING_IMPORTS:
                self.issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.MEDIUM,
                        issue_type=IssueType.BLOCKED_IMPORT,
                        line_number=node.lineno,
                        column=node.col_offset,
                        message=f"Warning: import from '{module_name}' may require review",
                        code_snippet=self._get_code_snippet(node.lineno),
                        suggestion=f"Ensure '{module_name}' is used safely",
                    )
                )

        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        """Check function calls for dangerous patterns."""
        # Get function name
        func_name = None
        if isinstance(node.func, ast.Name):
            func_name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            func_name = node.func.attr

        if func_name:
            self.function_calls.add(func_name)

            # Check for blocked functions
            if func_name in BLOCKED_FUNCTIONS:
                self.issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.CRITICAL,
                        issue_type=IssueType.BLOCKED_FUNCTION,
                        line_number=node.lineno,
                        column=node.col_offset,
                        message=f"Blocked function call: '{func_name}()' - poses security risk",
                        code_snippet=self._get_code_snippet(node.lineno),
                        suggestion=f"Remove '{func_name}()' call or use safer alternatives",
                    )
                )

            # Check for file operations (only as attributes, not standalone functions)
            file_operations = {
                "read",
                "write",
                "readlines",
                "writelines",
                "remove",
                "unlink",
                "rmdir",
                "mkdir",
            }
            if func_name in file_operations and isinstance(node.func, ast.Attribute):
                # Check if it's likely a file operation (not a dict method, etc.)
                # Skip common safe methods like dict.get(), list.pop(), etc.
                safe_methods = {"get", "pop", "update", "clear", "copy"}
                if func_name not in safe_methods:
                    self.has_file_operations = True
                    self.issues.append(
                        SecurityIssue(
                            severity=IssueSeverity.HIGH,
                            issue_type=IssueType.FILE_OPERATION,
                            line_number=node.lineno,
                            column=node.col_offset,
                            message=f"File operation detected: '{func_name}()' - not allowed in community packages",
                            code_snippet=self._get_code_snippet(node.lineno),
                            suggestion="Remove file operations from community packages",
                        )
                    )

            # Check for network operations (only socket/request-specific methods)
            # Exclude common dict/object methods like .get() to avoid false positives
            network_operations = {
                "connect",
                "send",
                "recv",
                "sendall",
                "sendto",
                "recvfrom",
                "bind",
                "listen",
                "accept",
            }
            http_operations = {"request", "urlopen", "urlretrieve"}

            if func_name in network_operations or func_name in http_operations:
                self.has_network_operations = True
                self.issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.HIGH,
                        issue_type=IssueType.NETWORK_OPERATION,
                        line_number=node.lineno,
                        column=node.col_offset,
                        message=f"Network operation detected: '{func_name}()' - not allowed in community packages",
                        code_snippet=self._get_code_snippet(node.lineno),
                        suggestion="Remove network operations from community packages",
                    )
                )

            # Check for dynamic imports
            if func_name == "__import__" or (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "import_module"
            ):
                self.issues.append(
                    SecurityIssue(
                        severity=IssueSeverity.HIGH,
                        issue_type=IssueType.DYNAMIC_IMPORT,
                        line_number=node.lineno,
                        column=node.col_offset,
                        message="Dynamic import detected - use static imports instead",
                        code_snippet=self._get_code_snippet(node.lineno),
                        suggestion="Replace with static import statement",
                    )
                )

        self.generic_visit(node)

    def visit_Global(self, node: ast.Global) -> None:
        """Check for global variable declarations."""
        self.has_global_vars = True
        self.issues.append(
            SecurityIssue(
                severity=IssueSeverity.MEDIUM,
                issue_type=IssueType.GLOBAL_VARIABLE,
                line_number=node.lineno,
                column=node.col_offset,
                message=f"Global variable declaration: {', '.join(node.names)}",
                code_snippet=self._get_code_snippet(node.lineno),
                suggestion="Avoid global variables; use function parameters and return values",
            )
        )
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        """Track function definitions for nesting depth."""
        self._enter_block()
        self.generic_visit(node)
        self._exit_block()

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        """Track async function definitions for nesting depth."""
        self._enter_block()
        self.generic_visit(node)
        self._exit_block()

    def visit_If(self, node: ast.If) -> None:
        """Track if statements for nesting depth."""
        self._enter_block()
        self.generic_visit(node)
        self._exit_block()

    def visit_For(self, node: ast.For) -> None:
        """Track for loops for nesting depth."""
        self._enter_block()
        self.generic_visit(node)
        self._exit_block()

    def visit_While(self, node: ast.While) -> None:
        """Track while loops for nesting depth."""
        self._enter_block()
        self.generic_visit(node)
        self._exit_block()

    def visit_With(self, node: ast.With) -> None:
        """Track with statements for nesting depth."""
        self._enter_block()
        self.generic_visit(node)
        self._exit_block()

    def visit_Try(self, node: ast.Try) -> None:
        """Track try statements for nesting depth."""
        self._enter_block()
        self.generic_visit(node)
        self._exit_block()


# ============================================================================
# Code Security Scanner
# ============================================================================


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

    def validate_imports(self, code: str) -> List[SecurityIssue]:
        """
        Validate imports using AST parsing.

        Args:
            code: Python code to validate

        Returns:
            List of security issues related to imports
        """
        issues = []
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

    def detect_dangerous_patterns(self, code: str) -> List[SecurityIssue]:
        """
        Detect dangerous patterns using AST analysis.

        Args:
            code: Python code to analyze

        Returns:
            List of security issues related to dangerous patterns
        """
        issues = []
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

    def check_complexity(self, code: str) -> Dict[str, Any]:
        """
        Check cyclomatic complexity and maintainability.

        Args:
            code: Python code to analyze

        Returns:
            Dict with complexity metrics and issues
        """
        metrics = {
            "average_complexity": 0,
            "max_complexity": 0,
            "total_functions": 0,
            "maintainability_index": 0,
            "issues": [],
        }

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
                        metrics["issues"].append(
                            SecurityIssue(
                                severity=IssueSeverity.HIGH,
                                issue_type=IssueType.HIGH_COMPLEXITY,
                                line_number=result.lineno,
                                message=f"Function '{result.name}' has very high complexity ({result.complexity})",
                                suggestion="Break down into smaller functions (target: < 10)",
                            )
                        )
                    elif result.complexity > MAX_COMPLEXITY_WARN:
                        metrics["issues"].append(
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
                    metrics["issues"].append(
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
                metrics["issues"].append(
                    SecurityIssue(
                        severity=IssueSeverity.MEDIUM,
                        issue_type=IssueType.DEEP_NESTING,
                        message=f"Deep nesting detected ({visitor.max_nesting_depth} levels)",
                        suggestion=f"Reduce nesting depth (target: <= {MAX_NESTING_DEPTH})",
                    )
                )

        except Exception as e:
            # If complexity analysis fails, add a warning
            metrics["issues"].append(
                SecurityIssue(
                    severity=IssueSeverity.LOW,
                    issue_type=IssueType.HIGH_COMPLEXITY,
                    message=f"Complexity analysis failed: {str(e)}",
                )
            )

        return metrics

    def detect_obfuscation(self, code: str) -> List[SecurityIssue]:
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
        from datetime import datetime

        result = SecurityScanResult(
            status=SecurityStatus.PASSED,
            risk_score=0,
            issues=[],
            scanned_at=datetime.utcnow().isoformat(),
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

    def _generate_recommendations(self, result: SecurityScanResult) -> List[str]:
        """Generate security recommendations based on scan results."""
        recommendations = []

        # Group issues by type
        issue_types = {}
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
