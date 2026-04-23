"""Code execution API endpoints for inline Python code and custom functions."""

import ast
import os
import re
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.session import get_async_db
from app.models import User
from app.services.code_execution_service import (
    CodeExecutionRequest,
    CodeExecutionResult,
    CodeExecutionService,
)

router = APIRouter()

# Context fields recognised by `/files/execute` — if the target function
# declares a parameter with one of these names (and the caller did not
# override it in `inputs`), the value from the request's `context` is
# passed. Order does not matter; matching is by name.
_CONTEXT_FIELDS = ("action_result", "variables", "workflow_state", "active_states")


def _extract_function_signature(
    code: str, function_name: str
) -> tuple[list[str], bool]:
    """Parse user code and return (positional_and_kwonly_param_names, has_kwargs).

    Used by `/files/execute` to pick which kwargs to pass when wrapping the
    call. Falls back to ``([], False)`` on unparseable code or missing
    function — callers treat that as "pass only inputs" (legacy behaviour).
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return [], False
    for node in ast.walk(tree):
        if (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == function_name
        ):
            named = [a.arg for a in node.args.args] + [
                a.arg for a in node.args.kwonlyargs
            ]
            has_kwargs = node.args.kwarg is not None
            return named, has_kwargs
    return [], False


def _get_safe_project_root(project_id: str | None) -> Path:
    """Get a safe project root path, validating against path traversal attacks."""
    # Use test project root if set
    test_project_root = os.getenv("TEST_PROJECT_ROOT")
    if test_project_root:
        return Path(test_project_root)

    # Sanitize project_id to prevent path traversal
    safe_project_id = project_id or "default"

    # Check for path traversal attempts
    if ".." in safe_project_id or "/" in safe_project_id or "\\" in safe_project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project_id: contains path traversal characters",
        )

    # Only allow alphanumeric, underscore, hyphen, and UUID patterns
    if not re.match(r"^[a-zA-Z0-9_-]+$", safe_project_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project_id: must contain only alphanumeric, "
            "underscores, and hyphens",
        )

    base_dir = Path.cwd() / "user_projects"
    project_root = base_dir / safe_project_id

    # Resolve to absolute path and verify it's under user_projects
    resolved_root = project_root.resolve()
    resolved_base = base_dir.resolve()

    if not str(resolved_root).startswith(str(resolved_base)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project_id: path traversal detected",
        )

    return project_root


@router.post("/execute", response_model=CodeExecutionResult)
async def execute_code(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(deps.current_active_user),
    request: CodeExecutionRequest,
) -> CodeExecutionResult:
    """
    Execute inline Python code in a sandboxed environment.

    **Security:**
    - Code runs with restricted builtins (no eval, exec, open, etc.)
    - Only whitelisted imports allowed
    - Timeout enforced (default 30s, max 60s)
    - Dangerous patterns blocked (dunders, file access, etc.)

    **Context:**
    The code has access to:
    - `action_result`: Previous action result (dict or None)
    - `variables`: Workflow variables (dict)
    - `workflow_state`: Current workflow state (dict)
    - `active_states`: Active state machine states (set)
    - Input variables from `inputs` field
    - Whitelisted modules (re, json, math, datetime, etc.)

    **Return Value:**
    - Single value: Stored in output variable
    - Dictionary: Multiple outputs destructured
    - None: No output (side effects only)

    **Example:**
    ```python
    {
        "code": "import re\\ntext = action_result['text']\\nmatch = re.search(r'\\$(\\d+)', text)\\nresult = float(match.group(1)) if match else 0.0",
        "context": {
            "action_result": {"text": "Price: $99.99"},
            "variables": {},
            "workflow_state": {},
            "active_states": []
        },
        "inputs": {},
        "timeout": 30,
        "debug": false
    }
    ```

    Returns:
    ```python
    {
        "success": true,
        "result": 99.99,
        "error": null,
        "execution_time_ms": 2.5
    }
    ```
    """
    try:
        result = CodeExecutionService.execute_code(request)
        return result

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Code execution service error: {str(e)}",
        )


@router.post("/validate", response_model=dict)
async def validate_code(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(deps.current_active_user),
    request: CodeExecutionRequest,
) -> dict:
    """
    Validate Python code without executing it.

    Checks for:
    - Syntax errors
    - Blocked imports
    - Dangerous patterns
    - Whitelist violations

    Returns validation result with any errors found.

    **Example:**
    ```python
    {
        "code": "import os\\nos.system('rm -rf /')",
        "allowed_imports": ["re", "json"]
    }
    ```

    Returns:
    ```python
    {
        "valid": false,
        "errors": [
            {
                "type": "blocked_import",
                "message": "Import of blocked module 'os' is not allowed"
            }
        ]
    }
    ```
    """
    from app.utils.code_validator import CodeValidationError, CodeValidator

    errors: list[dict[str, str | int]] = []

    try:
        # Validate imports
        validator = CodeValidator()
        validator.validate_imports(request.code, request.allowed_imports)
    except CodeValidationError as e:
        errors.append({"type": "import_error", "message": str(e)})

    try:
        # Validate dangerous patterns
        validator.validate_dangerous_patterns(request.code)
    except CodeValidationError as e:
        errors.append({"type": "security_error", "message": str(e)})

    # Check for syntax errors
    try:
        compile(request.code, "<string>", "exec")
    except SyntaxError as e:
        error_dict: dict[str, str | int] = {
            "type": "syntax_error",
            "message": str(e),
        }
        if e.lineno is not None:
            error_dict["line"] = e.lineno
        if e.offset is not None:
            error_dict["offset"] = e.offset
        errors.append(error_dict)

    return {"valid": len(errors) == 0, "errors": errors}


@router.get("/allowed-imports", response_model=dict)
async def get_allowed_imports(
    current_user: User = Depends(deps.current_active_user),
) -> dict:
    """
    Get list of allowed imports for code execution.

    Returns:
    ```python
    {
        "default": ["re", "json", "math", "datetime", ...],
        "blocked": ["os", "sys", "subprocess", ...]
    }
    ```
    """
    from app.core.security.code_policy import BLOCKED_IMPORTS

    default_allowed = [
        "re",
        "json",
        "math",
        "datetime",
        "collections",
        "itertools",
        "functools",
        "typing",
    ]

    return {"default": default_allowed, "blocked": list(BLOCKED_IMPORTS)}


@router.get("/examples", response_model=dict)
async def get_code_examples(
    current_user: User = Depends(deps.current_active_user),
) -> dict:
    """
    Get example code snippets for common use cases.

    Returns a dictionary of categorized code examples.
    """
    examples = {
        "data_extraction": [
            {
                "name": "Extract price from OCR text",
                "description": "Parse dollar amount from text",
                "code": """import re
text = action_result['text']
match = re.search(r'\\$(\\d+\\.\\d{2})', text)
result = float(match.group(1)) if match else 0.0""",
            },
            {
                "name": "Extract email address",
                "description": "Find email in text",
                "code": """import re
text = action_result['text']
match = re.search(r'[\\w\\.-]+@[\\w\\.-]+\\.\\w+', text)
result = match.group(0) if match else None""",
            },
        ],
        "data_validation": [
            {
                "name": "Validate threshold",
                "description": "Check if value exceeds threshold",
                "code": """value = float(action_result.get('value', 0))
threshold = variables.get('threshold', 100)
result = value < threshold""",
            },
            {
                "name": "Check for keyword",
                "description": "Verify keyword exists in text",
                "code": """text = action_result.get('text', '').lower()
keyword = variables.get('keyword', '').lower()
result = keyword in text""",
            },
        ],
        "data_transformation": [
            {
                "name": "Convert to uppercase",
                "description": "Transform text to uppercase",
                "code": """text = action_result.get('text', '')
result = text.upper()""",
            },
            {
                "name": "Split and filter",
                "description": "Split text and filter non-empty",
                "code": """text = action_result.get('text', '')
lines = text.split('\\n')
result = [line.strip() for line in lines if line.strip()]""",
            },
        ],
        "state_management": [
            {
                "name": "Increment counter",
                "description": "Track retry count in state",
                "code": """counter = workflow_state.get('counter', 0)
result = counter + 1
workflow_state['counter'] = result""",
            },
            {
                "name": "Accumulate values",
                "description": "Sum values over multiple runs",
                "code": """value = float(action_result.get('value', 0))
total = workflow_state.get('total', 0.0)
result = total + value
workflow_state['total'] = result""",
            },
        ],
    }

    return examples


# ==============================================================================
# Phase 2: File-based Code Execution Endpoints
# ==============================================================================


@router.get("/files/list", response_model=dict)
async def list_python_files(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(deps.current_active_user),
    directory: str = ".",
    project_id: str | None = None,
) -> dict:
    """
    List all Python files in project directory.

    Args:
        directory: Directory to search (relative to project root)
        project_id: Project ID for scoping file access

    Returns:
        {
            "files": ["scripts/detector.py", "lib/utils.py", ...],
            "count": 2
        }
    """
    from app.services.file_loader import PythonFileLoader

    project_root = _get_safe_project_root(project_id)

    try:
        loader = PythonFileLoader(project_root=project_root)
        files = loader.list_python_files(directory=directory)

        return {"files": files, "count": len(files)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list files: {str(e)}",
        )


@router.post("/files/validate", response_model=dict)
async def validate_file_path(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(deps.current_active_user),
    file_path: str = Body(..., description="Relative path to validate"),
    project_id: str | None = Body(None, description="Project ID for scoping"),
) -> dict:
    """
    Validate a file path for security and accessibility.

    Checks:
    - Path is within project directory
    - No directory traversal (..)
    - File exists and is readable
    - File has .py extension

    Args:
        file_path: Relative path to validate
        project_id: Project ID for scoping file access

    Returns:
        {
            "valid": true,
            "absolute_path": "/path/to/project/scripts/detector.py",
            "exists": true,
            "size_bytes": 1234
        }
    """
    from app.services.file_loader import FilePathValidator

    project_root = _get_safe_project_root(project_id)

    try:
        validator = FilePathValidator()
        absolute_path = validator.validate_path(file_path, project_root=project_root)

        return {
            "valid": True,
            "absolute_path": str(absolute_path),
            "exists": absolute_path.exists(),
            "size_bytes": absolute_path.stat().st_size if absolute_path.exists() else 0,
        }

    except HTTPException as e:
        return {
            "valid": False,
            "error": e.detail,
            "status_code": e.status_code,
        }


@router.post("/files/load", response_model=dict)
async def load_file_content(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(deps.current_active_user),
    file_path: str = Body(..., description="Relative path to file"),
    project_id: str | None = Body(None, description="Project ID"),
    use_cache: bool = Body(True, description="Whether to use cached content"),
) -> dict:
    """
    Load content of a Python file.

    Args:
        file_path: Relative path to file
        project_id: Project ID
        use_cache: Whether to use cached content

    Returns:
        {
            "content": "def detect_unit():\\n    ...",
            "path": "scripts/detector.py",
            "size_bytes": 1234,
            "cached": false
        }
    """
    from app.services.file_loader import PythonFileLoader

    project_root = _get_safe_project_root(project_id)

    try:
        loader = PythonFileLoader(project_root=project_root)
        content = loader.load_file(file_path, use_cache=use_cache)

        return {
            "content": content,
            "path": file_path,
            "size_bytes": len(content),
            "cached": use_cache and file_path in loader._cache,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load file: {str(e)}",
        )


@router.post("/files/execute", response_model=CodeExecutionResult)
async def execute_file_code(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(deps.current_active_user),
    file_path: str = Body(..., description="Relative path to Python file"),
    function_name: str | None = Body(
        None, description="Optional function name to call"
    ),
    context: dict | None = Body(None, description="Execution context"),
    inputs: dict | None = Body(None, description="Input variables for the function"),
    timeout: int = Body(30, ge=1, le=60, description="Execution timeout in seconds"),
    project_id: str | None = Body(None, description="Project ID"),
) -> CodeExecutionResult:
    """
    Execute code from a Python file.

    If function_name is provided, calls that function with inputs as kwargs.
    Otherwise, executes the entire file.

    Args:
        file_path: Relative path to Python file
        function_name: Optional function name to call
        context: Execution context (action_result, variables, etc.)
        inputs: Input variables for the function
        timeout: Execution timeout in seconds
        project_id: Project ID

    Returns:
        CodeExecutionResult with execution status and result
    """
    from app.services.file_loader import PythonFileLoader

    project_root = _get_safe_project_root(project_id)

    try:
        # Load file content
        loader = PythonFileLoader(project_root=project_root)
        code = loader.load_file(file_path)

        # If function name specified, wrap code to call function
        if function_name:
            # Pick the kwargs to pass. Candidates are: context fields the
            # function declares as parameters, plus everything in ``inputs``.
            # Inputs override context on name collision.
            input_kwargs = inputs or {}
            candidates: dict = {}
            if context:
                for field in _CONTEXT_FIELDS:
                    if field in context:
                        candidates[field] = context[field]
            candidates.update(input_kwargs)

            named_params, has_kwargs = _extract_function_signature(code, function_name)
            if has_kwargs:
                # Function accepts **kwargs — pass everything.
                passed = candidates
            elif named_params:
                # Drop candidates the function cannot accept (would TypeError).
                passed = {k: v for k, v in candidates.items() if k in named_params}
            else:
                # Couldn't parse or function not found — fall back to inputs
                # only (preserves pre-2026-04-23 behaviour).
                passed = dict(input_kwargs)

            kwargs_str = ", ".join(f"{k}={v!r}" for k, v in passed.items())
            wrapped_code = f"{code}\n\nresult = {function_name}({kwargs_str})"
            code = wrapped_code

        # Execute code using existing service with import resolution
        from app.services.code_execution_service import ExecutionContext

        # Convert dict context to ExecutionContext if provided
        exec_context = ExecutionContext(**context) if context else ExecutionContext()

        request = CodeExecutionRequest(
            code=code,
            context=exec_context,
            inputs=inputs or {},
            timeout=timeout,
            project_root=str(
                project_root
            ),  # Enable import resolution for file-based code
        )

        result = CodeExecutionService.execute_code(request)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"File execution failed: {str(e)}",
        )
