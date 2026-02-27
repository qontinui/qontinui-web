"""
Code validation utilities for sandboxed execution.

Validates Python code AST for security concerns before execution.
Extracted from code_execution_service.py for SRP compliance.

Security layers:
1. Regex-based pattern matching (fast, catches obvious violations)
2. AST-level validation (thorough, catches bypass attempts via
   getattr, string concatenation, and other indirect access patterns)
"""

import ast
import re
from collections.abc import Sequence

from app.core.security.code_policy import CodeSecurityPolicy

# Functions that can be used to bypass attribute-level restrictions
# by dynamically resolving names at runtime.
BLOCKED_FUNCTIONS: frozenset[str] = frozenset(
    {
        "getattr",
        "setattr",
        "delattr",
        "globals",
        "locals",
        "vars",
        "dir",
        "eval",
        "exec",
        "compile",
        "__import__",
        "open",
        "breakpoint",
        "input",
        "help",
        "exit",
        "quit",
        "memoryview",
        "type",
    }
)


class CodeValidationError(ValueError):
    """Raised when code validation fails."""

    pass


class CodeValidator:
    """
    Validates Python code for security concerns before execution.

    Uses a two-layer approach:
    - Regex pattern matching for fast rejection of obvious violations
    - AST walking for thorough detection of bypass attempts (e.g.,
      getattr(obj, '__class__'), string concatenation to build dunder
      names, indirect calls to blocked functions)
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
        tree = self.validate_syntax(code)
        self.validate_imports_from_tree(tree, allowed_imports, allow_project_imports)
        self.validate_dangerous_patterns(code)
        self.validate_ast_security(tree)

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
        self.validate_imports_from_tree(tree, allowed_imports, allow_project_imports)

    def validate_imports_from_tree(
        self,
        tree: ast.Module,
        allowed_imports: Sequence[str] | None = None,
        allow_project_imports: bool = False,
    ) -> None:
        """
        Validate imports from an already-parsed AST.

        Args:
            tree: Parsed AST module
            allowed_imports: Override whitelist of allowed module names
            allow_project_imports: If True, allow any non-blocked import

        Raises:
            CodeValidationError: If code imports blocked or non-whitelisted modules
        """
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
        Check for dangerous patterns in code using regex.

        This is the fast first-pass check. The AST validation
        (validate_ast_security) provides the thorough second pass.

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

    def validate_ast_security(self, tree: ast.Module) -> None:
        """
        Walk the AST to block sandbox-escape patterns that regex cannot catch.

        This catches bypass attempts such as:
        - getattr(obj, '__class__') — indirect dunder access
        - getattr(x, '_'+'_class_'+'_') — string-concatenated dunder access
        - globals()['os'].system('cmd') — runtime namespace introspection
        - type('X', (object,), {}) — dynamic class creation

        Args:
            tree: Parsed AST module

        Raises:
            CodeValidationError: If dangerous AST patterns are found
        """
        for node in ast.walk(tree):
            self._check_dunder_attribute_access(node)
            self._check_blocked_function_call(node)
            self._check_dunder_string_literal(node)

    def _check_dunder_attribute_access(self, node: ast.AST) -> None:
        """Block direct attribute access to dunder names (e.g. obj.__class__)."""
        if self.policy.allow_dunder_methods:
            return

        if isinstance(node, ast.Attribute):
            attr_name = node.attr
            if attr_name.startswith("__") and attr_name.endswith("__"):
                raise CodeValidationError(
                    f"Access to dunder attribute '{attr_name}' is not allowed"
                )

    def _check_blocked_function_call(self, node: ast.AST) -> None:
        """Block calls to dangerous functions like getattr, globals, etc."""
        if not isinstance(node, ast.Call):
            return

        func = node.func

        # Direct call: getattr(...)
        if isinstance(func, ast.Name) and func.id in BLOCKED_FUNCTIONS:
            raise CodeValidationError(
                f"Call to '{func.id}()' is not allowed in sandboxed code"
            )

        # Method-style call on builtins module: builtins.getattr(...)
        if isinstance(func, ast.Attribute) and func.attr in BLOCKED_FUNCTIONS:
            raise CodeValidationError(
                f"Call to '{func.attr}()' is not allowed in sandboxed code"
            )

    def _check_dunder_string_literal(self, node: ast.AST) -> None:
        """Block string literals containing dunder names.

        This catches patterns like getattr(obj, '__class__') where the
        dunder name is passed as a string argument rather than used as
        a direct attribute. Also catches string constants assigned to
        variables that could later be used with getattr.
        """
        if self.policy.allow_dunder_methods:
            return

        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            value = node.value
            if re.match(r"^__\w+__$", value):
                raise CodeValidationError(
                    f"String literal '{value}' resembles a dunder name "
                    f"and is not allowed in sandboxed code"
                )
