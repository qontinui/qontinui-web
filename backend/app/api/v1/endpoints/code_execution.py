"""
Code execution API endpoints.

Provides endpoints for executing inline Python code blocks and custom functions
within automation workflows.
"""

from app.api import deps
from app.db.session import get_async_db
from app.models import User
from app.services.code_execution_service import (
    CodeExecutionRequest,
    CodeExecutionResult,
    CodeExecutionService,
)
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


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
    from app.services.code_execution_service import CodeValidator

    errors = []

    try:
        # Validate imports
        CodeValidator.validate_imports(request.code, request.allowed_imports)
    except ValueError as e:
        errors.append({"type": "import_error", "message": str(e)})

    try:
        # Validate dangerous patterns
        CodeValidator.validate_dangerous_patterns(request.code)
    except ValueError as e:
        errors.append({"type": "security_error", "message": str(e)})

    # Check for syntax errors
    try:
        compile(request.code, "<string>", "exec")
    except SyntaxError as e:
        errors.append(
            {
                "type": "syntax_error",
                "message": str(e),
                "line": e.lineno,
                "offset": e.offset,
            }
        )

    return {"valid": len(errors) == 0, "errors": errors}


@router.get("/allowed-imports", response_model=dict)
async def get_allowed_imports(
    current_user: User = Depends(deps.get_current_active_user),
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
    from app.services.code_execution_service import BLOCKED_IMPORTS

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
    current_user: User = Depends(deps.get_current_active_user),
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
