"""
AST visitor for security analysis.

Provides SecurityASTVisitor for traversing Python AST and detecting security issues.
"""

import ast

from app.services.security.constants import (
    BLOCKED_FUNCTIONS,
    BLOCKED_IMPORTS,
    WARNING_IMPORTS,
)
from app.services.security.models import IssueSeverity, IssueType, SecurityIssue


class SecurityASTVisitor(ast.NodeVisitor):
    """AST visitor for detecting security issues."""

    def __init__(self, code_lines: list[str]):
        self.code_lines = code_lines
        self.issues: list[SecurityIssue] = []
        self.imports: set[str] = set()
        self.function_calls: set[str] = set()
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

    def _enter_block(self) -> None:
        """Track entering a code block."""
        self._current_nesting += 1
        self.max_nesting_depth = max(self.max_nesting_depth, self._current_nesting)

    def _exit_block(self) -> None:
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
