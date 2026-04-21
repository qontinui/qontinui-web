"""
Code execution service for inline Python code blocks.

Provides sandboxed execution of user code with:
- Restricted imports (whitelist only)
- Resource limits (timeout, memory)
- Safe builtins (no eval, exec, __import__)
- Input/output validation

Refactored for SRP compliance - uses extracted modules:
- app.schemas.code_execution - Request/response models
- app.core.security.code_policy - Security rules
- app.utils.code_validator - AST validation
- app.utils.timeout - Timeout handling
"""

import io
import sys
import traceback
from datetime import datetime
from typing import Any

from app.core.security.code_policy import CodeSecurityPolicy
from app.schemas.code_execution import (
    CodeExecutionRequest,
    CodeExecutionResult,
    ExecutionContext,
)
from app.services.automation_context import AutomationContext
from app.utils.code_validator import CodeValidationError, CodeValidator
from app.utils.timeout import ExecutionTimeoutError, time_limit

# Re-export models for backward compatibility
__all__ = [
    "CodeExecutionService",
    "CodeExecutionRequest",
    "CodeExecutionResult",
    "ExecutionContext",
    # Legacy exports (deprecated, use imports from proper modules)
    "CodeValidator",
    "TimeoutError",
]

# Legacy alias for backward compatibility
TimeoutError = ExecutionTimeoutError


class CodeExecutionService:
    """
    Service for executing user Python code in a sandboxed environment.

    Uses:
    - CodeSecurityPolicy for security rules
    - CodeValidator for AST validation
    - time_limit for timeout enforcement
    """

    def __init__(self, policy: CodeSecurityPolicy | None = None):
        """
        Initialize service with security policy.

        Args:
            policy: Security policy to use. Defaults to standard policy.
        """
        self.policy = policy or CodeSecurityPolicy()
        self.validator = CodeValidator(self.policy)

    def create_safe_globals(
        self,
        context: ExecutionContext,
        inputs: dict[str, Any],
        allowed_imports: list[str],
        allow_imports: bool = False,
    ) -> dict[str, Any]:
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
        # Get safe builtins from policy
        safe_builtins = self.policy.get_safe_builtins(include_import=allow_imports)

        # Add allowed imports
        allowed_modules: dict[str, Any] = {}
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

    def _execute_code_impl(self, request: CodeExecutionRequest) -> CodeExecutionResult:
        """
        Execute Python code in a sandboxed environment (internal implementation).

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
            # Validate code using extracted validator
            allow_project_imports = request.project_root is not None
            self.validator.validate(
                request.code,
                allowed_imports=request.allowed_imports,
                allow_project_imports=allow_project_imports,
            )

            # Add project root to sys.path for import resolution
            if request.project_root:
                project_root = request.project_root
                if project_root not in sys.path:
                    sys.path.insert(0, project_root)
                    added_to_path = True

            # Create safe execution environment.
            #
            # ``__import__`` must be available whenever the user code contains
            # any ``import`` statement — even for whitelisted standard-library
            # modules like ``re``/``json``. The CodeValidator has already
            # AST-checked the code against the whitelist, so exposing the real
            # ``__import__`` is safe: any disallowed name was rejected earlier.
            allow_import_stmts = allow_project_imports or bool(request.allowed_imports)
            safe_globals = self.create_safe_globals(
                request.context,
                request.inputs,
                request.allowed_imports,
                allow_imports=allow_import_stmts,
            )

            # Capture stdout/stderr
            stdout_capture = io.StringIO()
            stderr_capture = io.StringIO()
            old_stdout = sys.stdout
            old_stderr = sys.stderr

            # Execute with timeout
            result = None
            stdout_output = ""
            stderr_output = ""

            try:
                # Redirect stdout/stderr
                sys.stdout = stdout_capture
                sys.stderr = stderr_capture

                with time_limit(request.timeout):
                    # Execute code using a single dict for globals+locals so
                    # that module-level ``import`` statements and function
                    # definitions share the same namespace; otherwise a
                    # function defined at module level won't see names (like
                    # imported modules) introduced by sibling statements at
                    # the same level.
                    exec(request.code, safe_globals)  # noqa: S102 - sandboxed execution with restricted globals

                    # Get result (last expression or explicit return)
                    result = safe_globals.get("result", None)

                    # If no 'result' variable, try to evaluate as expression
                    if result is None:
                        try:
                            result = eval(request.code, safe_globals)  # noqa: S307 - sandboxed eval with restricted globals
                        except Exception:
                            # If not an expression, result is None
                            pass

            except ExecutionTimeoutError as e:
                execution_time = (datetime.now() - start_time).total_seconds() * 1000
                stdout_output = stdout_capture.getvalue()
                stderr_output = stderr_capture.getvalue()
                return CodeExecutionResult(
                    success=False,
                    error=str(e),
                    error_type="TimeoutError",
                    execution_time_ms=execution_time,
                    stdout=stdout_output,
                    stderr=stderr_output,
                )
            finally:
                # Restore stdout/stderr
                sys.stdout = old_stdout
                sys.stderr = old_stderr
                stdout_output = stdout_capture.getvalue()
                stderr_output = stderr_capture.getvalue()

            execution_time = (datetime.now() - start_time).total_seconds() * 1000

            return CodeExecutionResult(
                success=True,
                result=result,
                execution_time_ms=execution_time,
                stdout=stdout_output,
                stderr=stderr_output,
            )

        except CodeValidationError as e:
            # Validation error from CodeValidator
            execution_time = (datetime.now() - start_time).total_seconds() * 1000
            return CodeExecutionResult(
                success=False,
                error=str(e),
                error_type="ValidationError",
                execution_time_ms=execution_time,
            )

        except ValueError as e:
            # Legacy validation error handling
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

    @staticmethod
    def execute_code(request: CodeExecutionRequest) -> CodeExecutionResult:
        """
        Execute Python code in a sandboxed environment.

        This is a static method for backward compatibility.
        Creates a new service instance for each execution.

        Args:
            request: Code execution request with code and context

        Returns:
            CodeExecutionResult with result or error
        """
        service = CodeExecutionService()
        return service._execute_code_impl(request)


# Singleton instance for dependency injection
code_execution_service = CodeExecutionService()
