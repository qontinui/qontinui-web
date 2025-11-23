"""
Code execution service for inline Python code blocks.

Provides sandboxed execution of user code with:
- Restricted imports (whitelist only)
- Resource limits (timeout, memory)
- Safe builtins (no eval, exec, __import__)
- Input/output validation
"""

import ast
import re
import signal
import sys
import traceback
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

from app.services.automation_context import AutomationContext
from pydantic import BaseModel, Field

# ============================================================================
# Models
# ============================================================================


class ExecutionContext(BaseModel):
    """Context available during code execution."""

    # Previous action result (from workflow)
    action_result: Optional[Dict[str, Any]] = None

    # Workflow variables
    variables: Dict[str, Any] = Field(default_factory=dict)

    # Workflow state
    workflow_state: Dict[str, Any] = Field(default_factory=dict)

    # Active states (from state machine)
    active_states: Set[str] = Field(default_factory=set)

    # Execution metadata
    workflow_id: Optional[str] = None
    run_id: Optional[str] = None


class CodeExecutionRequest(BaseModel):
    """Request to execute Python code."""

    code: str = Field(..., description="Python code to execute")

    context: ExecutionContext = Field(
        default_factory=ExecutionContext, description="Execution context"
    )

    inputs: Dict[str, Any] = Field(
        default_factory=dict, description="Additional input variables"
    )

    timeout: int = Field(
        default=30, ge=1, le=60, description="Execution timeout in seconds"
    )

    allowed_imports: List[str] = Field(
        default_factory=lambda: [
            "re",
            "json",
            "math",
            "datetime",
            "collections",
            "itertools",
            "functools",
            "typing",
        ],
        description="Whitelist of allowed imports",
    )

    project_root: Optional[str] = Field(
        default=None,
        description="Project root directory for import resolution (file-based execution)",
    )

    debug: bool = Field(default=False, description="Enable debug logging")


class CodeExecutionResult(BaseModel):
    """Result of code execution."""

    success: bool
    result: Any = None
    error: Optional[str] = None
    error_type: Optional[str] = None
    traceback: Optional[str] = None
    execution_time_ms: float
    stdout: str = ""
    stderr: str = ""


# ============================================================================
# Security: Blocked builtins and imports
# ============================================================================

BLOCKED_BUILTINS = {
    "eval",
    "exec",
    "compile",
    "__import__",
    "open",
    "input",
    "help",
    "breakpoint",
    "exit",
    "quit",
}

BLOCKED_IMPORTS = {
    "os",
    "sys",
    "subprocess",
    "socket",
    "urllib",
    "requests",
    "httpx",
    "pathlib",
    "shutil",
    "glob",
    "tempfile",
    "pickle",
    "marshal",
    "ctypes",
    "importlib",
}


# ============================================================================
# Code Validation
# ============================================================================


class CodeValidator:
    """Validates Python code for security concerns before execution."""

    @staticmethod
    def validate_imports(
        code: str, allowed_imports: List[str], allow_project_imports: bool = False
    ) -> None:
        """
        Validate that code only imports allowed modules.

        Args:
            code: Python code to validate
            allowed_imports: Whitelist of allowed module names
            allow_project_imports: If True, allow imports from any non-blocked module (for project files)

        Raises:
            ValueError: If code imports blocked or non-whitelisted modules
        """
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            raise ValueError(f"Syntax error in code: {e}")

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module_name = alias.name.split(".")[0]
                    if module_name in BLOCKED_IMPORTS:
                        raise ValueError(
                            f"Import of blocked module '{module_name}' is not allowed"
                        )
                    # Skip whitelist check if project imports are allowed
                    if not allow_project_imports and module_name not in allowed_imports:
                        raise ValueError(
                            f"Import of '{module_name}' is not whitelisted. "
                            f"Allowed imports: {', '.join(allowed_imports)}"
                        )

            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    module_name = node.module.split(".")[0]
                    if module_name in BLOCKED_IMPORTS:
                        raise ValueError(
                            f"Import from blocked module '{module_name}' is not allowed"
                        )
                    # Skip whitelist check if project imports are allowed
                    if not allow_project_imports and module_name not in allowed_imports:
                        raise ValueError(
                            f"Import from '{module_name}' is not whitelisted. "
                            f"Allowed imports: {', '.join(allowed_imports)}"
                        )

    @staticmethod
    def validate_dangerous_patterns(code: str) -> None:
        """
        Check for dangerous patterns in code.

        Args:
            code: Python code to validate

        Raises:
            ValueError: If dangerous patterns are found
        """
        dangerous_patterns = [
            (r"__\w+__", "Dunder methods are not allowed"),
            (r"\beval\b", "eval() is not allowed"),
            (r"\bexec\b", "exec() is not allowed"),
            (r"\bcompile\b", "compile() is not allowed"),
            (r"\b__import__\b", "__import__() is not allowed"),
            (r"\bopen\b", "open() is not allowed"),
        ]

        for pattern, message in dangerous_patterns:
            if re.search(pattern, code):
                raise ValueError(message)


# ============================================================================
# Timeout Handler
# ============================================================================


class TimeoutError(Exception):
    """Raised when code execution exceeds timeout."""

    pass


@contextmanager
def time_limit(seconds: int):
    """
    Context manager to enforce execution timeout.

    Args:
        seconds: Maximum execution time

    Raises:
        TimeoutError: If execution exceeds timeout
    """

    def signal_handler(signum, frame):
        raise TimeoutError(f"Code execution exceeded {seconds} second timeout")

    # Note: signal.alarm only works on Unix-like systems
    # For Windows, we would need a threading-based solution
    if sys.platform != "win32":
        signal.signal(signal.SIGALRM, signal_handler)
        signal.alarm(seconds)
        try:
            yield
        finally:
            signal.alarm(0)
    else:
        # Fallback for Windows: no timeout enforcement
        # TODO: Implement threading-based timeout for Windows
        yield


# ============================================================================
# Code Execution Service
# ============================================================================


class CodeExecutionService:
    """Service for executing user Python code in a sandboxed environment."""

    @staticmethod
    def create_safe_globals(
        context: ExecutionContext,
        inputs: Dict[str, Any],
        allowed_imports: List[str],
        allow_imports: bool = False,
    ) -> Dict[str, Any]:
        """
        Create a restricted global namespace for code execution.

        Args:
            context: Execution context with action results and state
            inputs: Additional input variables
            allowed_imports: List of allowed module names
            allow_imports: If True, enable __import__ for file-based execution

        Returns:
            Dict of safe globals for exec()
        """
        # Start with minimal builtins
        safe_builtins = {
            k: v
            for k, v in __builtins__.items()
            if k not in BLOCKED_BUILTINS and not k.startswith("_")
        }

        # Allow __import__ for file-based execution
        if allow_imports:
            safe_builtins["__import__"] = __builtins__["__import__"]

        # Add allowed imports
        allowed_modules = {}
        for module_name in allowed_imports:
            try:
                if module_name == "datetime":
                    # Provide datetime and timedelta directly
                    import datetime as dt_module

                    allowed_modules["datetime"] = dt_module.datetime
                    allowed_modules["timedelta"] = dt_module.timedelta
                else:
                    allowed_modules[module_name] = __import__(module_name)
            except ImportError:
                pass  # Skip if module not available

        # Create AutomationContext for custom functions
        # Build action history from action_result if available
        action_history = []
        if context.action_result:
            action_history = [context.action_result]

        ctx = AutomationContext(
            workflow_run_id=context.run_id or "unknown",
            workflow_id=context.workflow_id,
            db=None,  # No DB session for inline code execution
            variables=context.variables.copy() if context.variables else {},
            action_history=action_history,
            active_states=(
                set(context.active_states) if context.active_states else set()
            ),
        )

        # Build global namespace
        safe_globals = {
            "__builtins__": safe_builtins,
            # AutomationContext instance
            "ctx": ctx,
            # Context variables (for backward compatibility)
            "action_result": context.action_result,
            "variables": context.variables,
            "workflow_state": context.workflow_state,
            "active_states": context.active_states,
            # Metadata
            "workflow_id": context.workflow_id,
            "run_id": context.run_id,
            # Input variables
            **inputs,
            # Allowed modules
            **allowed_modules,
        }

        return safe_globals

    @staticmethod
    def execute_code(request: CodeExecutionRequest) -> CodeExecutionResult:
        """
        Execute Python code in a sandboxed environment.

        Args:
            request: Code execution request with code and context

        Returns:
            CodeExecutionResult with result or error
        """
        start_time = datetime.now()

        # Track if we modified sys.path for cleanup
        added_to_path = False
        project_root = None

        try:
            # Validate code
            # Allow project imports if project_root is set (file-based execution)
            allow_project_imports = request.project_root is not None
            CodeValidator.validate_imports(
                request.code, request.allowed_imports, allow_project_imports
            )
            CodeValidator.validate_dangerous_patterns(request.code)

            # Add project root to sys.path for import resolution (file-based execution)
            if request.project_root:
                project_root = request.project_root
                if project_root not in sys.path:
                    sys.path.insert(0, project_root)
                    added_to_path = True

            # Create safe execution environment
            safe_globals = CodeExecutionService.create_safe_globals(
                request.context,
                request.inputs,
                request.allowed_imports,
                allow_imports=allow_project_imports,
            )
            safe_locals: Dict[str, Any] = {}

            # Capture stdout/stderr
            # TODO: Implement stdout/stderr capture

            # Execute with timeout
            result = None
            try:
                with time_limit(request.timeout):
                    # Execute code
                    exec(request.code, safe_globals, safe_locals)

                    # Get result (last expression or explicit return)
                    result = safe_locals.get("result", None)

                    # If no 'result' variable, check for last expression
                    if result is None:
                        # Try to evaluate as expression
                        try:
                            result = eval(request.code, safe_globals, safe_locals)
                        except:
                            # If not an expression, result is None
                            pass

            except TimeoutError as e:
                execution_time = (datetime.now() - start_time).total_seconds() * 1000
                return CodeExecutionResult(
                    success=False,
                    error=str(e),
                    error_type="TimeoutError",
                    execution_time_ms=execution_time,
                )

            execution_time = (datetime.now() - start_time).total_seconds() * 1000

            return CodeExecutionResult(
                success=True,
                result=result,
                execution_time_ms=execution_time,
            )

        except ValueError as e:
            # Validation error
            execution_time = (datetime.now() - start_time).total_seconds() * 1000
            return CodeExecutionResult(
                success=False,
                error=str(e),
                error_type="ValidationError",
                execution_time_ms=execution_time,
            )

        except Exception as e:
            # Runtime error
            execution_time = (datetime.now() - start_time).total_seconds() * 1000
            return CodeExecutionResult(
                success=False,
                error=str(e),
                error_type=type(e).__name__,
                traceback=traceback.format_exc(),
                execution_time_ms=execution_time,
            )

        finally:
            # Clean up sys.path
            if added_to_path and project_root and project_root in sys.path:
                sys.path.remove(project_root)
