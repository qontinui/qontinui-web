"""
Code validation utilities for sandboxed execution.

Validates Python code AST for security concerns before execution.
Extracted from code_execution_service.py for SRP compliance.
"""

import ast
import re
from collections.abc import Sequence

from app.core.security.code_policy import CodeSecurityPolicy


class CodeValidationError(ValueError):
    """Raised when code validation fails."""

    pass


class CodeValidator:
    """
    Validates Python code for security concerns before execution.

    Uses AST analysis to detect:
    - Blocked imports
    - Non-whitelisted imports
    - Dangerous patterns (eval, exec, etc.)
    """

    def __init__(self, policy: CodeSecurityPolicy | None = None):
        """
        Initialize validator with security policy.

        Args:
            policy: Security policy to use. Defaults to standard policy.
        """
        self.policy = policy or CodeSecurityPolicy()

    def validate(
        self,
        code: str,
        allowed_imports: Sequence[str] | None = None,
        allow_project_imports: bool = False,
    ) -> None:
        """
        Validate code for security concerns.

        Args:
            code: Python code to validate
            allowed_imports: Override whitelist of allowed imports
            allow_project_imports: If True, allow any non-blocked import

        Raises:
            CodeValidationError: If validation fails
        """
        self.validate_syntax(code)
        self.validate_imports(code, allowed_imports, allow_project_imports)
        self.validate_dangerous_patterns(code)

    def validate_syntax(self, code: str) -> ast.Module:
        """
        Validate code syntax by parsing AST.

        Args:
            code: Python code to validate

        Returns:
            Parsed AST module

        Raises:
            CodeValidationError: If syntax is invalid
        """
        try:
            return ast.parse(code)
        except SyntaxError as e:
            raise CodeValidationError(f"Syntax error in code: {e}")

    def validate_imports(
        self,
        code: str,
        allowed_imports: Sequence[str] | None = None,
        allow_project_imports: bool = False,
    ) -> None:
        """
        Validate that code only imports allowed modules.

        Args:
            code: Python code to validate
            allowed_imports: Override whitelist of allowed module names
            allow_project_imports: If True, allow any non-blocked import

        Raises:
            CodeValidationError: If code imports blocked or non-whitelisted modules
        """
        tree = self.validate_syntax(code)

        # Use provided whitelist or policy default
        whitelist = (
            set(allowed_imports)
            if allowed_imports
            else set(self.policy.allowed_imports)
        )

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module_name = alias.name.split(".")[0]

                    if self.policy.is_import_blocked(module_name):
                        raise CodeValidationError(
                            f"Import of blocked module '{module_name}' is not allowed"
                        )

                    if not allow_project_imports and module_name not in whitelist:
                        raise CodeValidationError(
                            f"Import of '{module_name}' is not whitelisted. "
                            f"Allowed imports: {', '.join(sorted(whitelist))}"
                        )

            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    module_name = node.module.split(".")[0]

                    if self.policy.is_import_blocked(module_name):
                        raise CodeValidationError(
                            f"Import from blocked module '{module_name}' is not allowed"
                        )

                    if not allow_project_imports and module_name not in whitelist:
                        raise CodeValidationError(
                            f"Import from '{module_name}' is not whitelisted. "
                            f"Allowed imports: {', '.join(sorted(whitelist))}"
                        )

    def validate_dangerous_patterns(self, code: str) -> None:
        """
        Check for dangerous patterns in code.

        Args:
            code: Python code to validate

        Raises:
            CodeValidationError: If dangerous patterns are found
        """
        dangerous_patterns = [
            (r"__\w+__", "Dunder methods are not allowed"),
            (r"\beval\s*\(", "eval() is not allowed"),
            (r"\bexec\s*\(", "exec() is not allowed"),
            (r"\bcompile\s*\(", "compile() is not allowed"),
            (r"\b__import__\s*\(", "__import__() is not allowed"),
            (r"\bopen\s*\(", "open() is not allowed"),
        ]

        # Skip dunder check if policy allows it
        if self.policy.allow_dunder_methods:
            dangerous_patterns = dangerous_patterns[1:]

        for pattern, message in dangerous_patterns:
            if re.search(pattern, code):
                raise CodeValidationError(message)
