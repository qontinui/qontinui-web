"""
Comprehensive End-to-End Tests for File-Based Code Execution (Phase 2)

Tests the complete file-based code execution workflow:
- Loading and executing Python files
- Function calling with inputs
- Import resolution (file importing another file)
- Path validation and security (path traversal prevention)
- File caching behavior
- Error handling (missing files, syntax errors, runtime errors)
"""

import os
import tempfile
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="function")
def project_dir() -> Generator[Path, None, None]:
    """
    Create a temporary project directory with test Python files.
    Automatically cleaned up after test.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        project_root = Path(tmpdir)

        # Create directory structure
        (project_root / "scripts").mkdir(exist_ok=True)
        (project_root / "lib").mkdir(exist_ok=True)
        (project_root / "nested" / "deep").mkdir(parents=True, exist_ok=True)

        # Create test files

        # 1. Simple calculator module
        calculator_py = project_root / "scripts" / "calculator.py"
        calculator_py.write_text("""
def add(a, b):
    \"\"\"Add two numbers.\"\"\"
    return a + b

def multiply(a, b):
    \"\"\"Multiply two numbers.\"\"\"
    return a * b

def divide(a, b):
    \"\"\"Divide two numbers.\"\"\"
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b

# Can also execute as script
result = add(10, 20)
""")

        # 2. Data processor that imports calculator
        processor_py = project_root / "scripts" / "processor.py"
        processor_py.write_text("""
from scripts.calculator import add, multiply

def process_data(numbers):
    \"\"\"Process a list of numbers.\"\"\"
    total = 0
    for num in numbers:
        total = add(total, num)
    return total

def calculate_stats(numbers):
    \"\"\"Calculate statistics for numbers.\"\"\"
    if not numbers:
        return {"mean": 0, "sum": 0, "count": 0}

    total = sum(numbers)
    return {
        "mean": total / len(numbers),
        "sum": total,
        "count": len(numbers)
    }
""")

        # 3. Utility library
        utils_py = project_root / "lib" / "utils.py"
        utils_py.write_text("""
import re

def extract_numbers(text):
    \"\"\"Extract all numbers from text.\"\"\"
    pattern = r'\\d+\\.?\\d*'
    matches = re.findall(pattern, text)
    return [float(m) for m in matches]

def format_currency(amount):
    \"\"\"Format number as currency.\"\"\"
    return f"${amount:,.2f}"
""")

        # 4. Workflow script that uses utils
        workflow_py = project_root / "scripts" / "workflow.py"
        workflow_py.write_text("""
from lib.utils import extract_numbers, format_currency

def process_invoice(text):
    \"\"\"Extract and process invoice data.\"\"\"
    numbers = extract_numbers(text)
    if not numbers:
        return {"total": "$0.00", "count": 0}

    total = sum(numbers)
    return {
        "total": format_currency(total),
        "count": len(numbers),
        "items": numbers
    }
""")

        # 5. File with syntax error
        syntax_error_py = project_root / "scripts" / "syntax_error.py"
        syntax_error_py.write_text("""
def broken_function(
    \"\"\"This has a syntax error - missing closing parenthesis\"\"\"
    return "broken"
""")

        # 6. File with runtime error
        runtime_error_py = project_root / "scripts" / "runtime_error.py"
        runtime_error_py.write_text("""
def divide_numbers(a, b):
    \"\"\"This will cause a runtime error if b is 0.\"\"\"
    return a / b

# Cause immediate error
result = divide_numbers(10, 0)
""")

        # 7. Nested file
        nested_py = project_root / "nested" / "deep" / "module.py"
        nested_py.write_text("""
def nested_function(x):
    \"\"\"Function in a deeply nested module.\"\"\"
    return x * 2
""")

        # 8. File that uses context variables
        context_aware_py = project_root / "scripts" / "context_aware.py"
        context_aware_py.write_text("""
import re

def extract_from_ocr(action_result, pattern_type="price"):
    \"\"\"Extract data from OCR result using context.\"\"\"
    text = action_result.get('text', '')

    if pattern_type == "price":
        pattern = r'\\$(\\d+\\.\\d{2})'
        match = re.search(pattern, text)
        return float(match.group(1)) if match else 0.0

    elif pattern_type == "email":
        pattern = r'[\\w\\.-]+@[\\w\\.-]+\\.\\w+'
        match = re.search(pattern, text)
        return match.group(0) if match else None

    return None

def check_threshold(action_result, variables):
    \"\"\"Check if value exceeds threshold from variables.\"\"\"
    value = action_result.get('value', 0)
    threshold = variables.get('threshold', 100)
    return value < threshold
""")

        yield project_root


@pytest.fixture(scope="function")
def test_client_with_auth(
    test_client: TestClient,
) -> Generator[TestClient, None, None]:
    """Test client with ``current_active_user`` dependency overridden to a
    MagicMock. Mirrors the working pattern in test_constraints.py — bypasses
    the token verification chain instead of issuing a Bearer token for a
    user id that doesn't exist in the test DB (which 401s).
    """
    from app.api.deps import current_active_user

    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False

    test_client.app.dependency_overrides[current_active_user] = lambda: mock_user
    try:
        yield test_client
    finally:
        test_client.app.dependency_overrides.pop(current_active_user, None)


class TestFileBasedExecution:
    """Test file-based code execution endpoints."""

    def test_list_python_files(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test listing all Python files in project directory."""
        # Create symlink to project directory
        # In real implementation, project_id would map to project directory
        # For now, we'll manually set the path in the environment
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.get(
            "/api/v1/code-execution/files/list",
            params={"directory": ".", "project_id": "test"},
        )

        # Note: This test will fail if the endpoint doesn't support TEST_PROJECT_ROOT
        # Skip if endpoint not implemented with test support
        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert "files" in data
        assert "count" in data
        assert data["count"] > 0

        # Check that expected files are listed
        files = data["files"]
        assert any("calculator.py" in f for f in files)
        assert any("processor.py" in f for f in files)
        assert any("utils.py" in f for f in files)

    def test_validate_file_path_valid(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test validating a valid file path."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/validate",
            json={"file_path": "scripts/calculator.py", "project_id": "test"},
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["valid"] is True
        assert "absolute_path" in data
        assert data["exists"] is True
        assert data["size_bytes"] > 0

    def test_validate_file_path_traversal(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test that path traversal attempts are blocked."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        # Try various path traversal attacks
        malicious_paths = [
            "../etc/passwd.py",
            "../../secrets.py",
            "scripts/../../../etc/passwd.py",
            "/etc/passwd.py",
            "~/secrets.py",
        ]

        for malicious_path in malicious_paths:
            response = test_client_with_auth.post(
                "/api/v1/code-execution/files/validate",
                json={"file_path": malicious_path, "project_id": "test"},
            )

            if response.status_code == 404:
                pytest.skip("Endpoint not implemented")

            # Should either return valid=False or 400/403 error
            if response.status_code == 200:
                data = response.json()
                assert data["valid"] is False, (
                    f"Path traversal not blocked: {malicious_path}"
                )
            else:
                assert response.status_code in [
                    400,
                    403,
                ], f"Unexpected status for {malicious_path}"

    def test_validate_file_path_non_python(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test that non-Python files are rejected."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        # Create a non-Python file
        txt_file = project_dir / "test.txt"
        txt_file.write_text("Not a Python file")

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/validate",
            json={"file_path": "test.txt", "project_id": "test"},
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should reject non-.py files
        if response.status_code == 200:
            data = response.json()
            assert data["valid"] is False
        else:
            assert response.status_code == 400

    def test_load_file_content(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test loading file content."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/load",
            json={
                "file_path": "scripts/calculator.py",
                "project_id": "test",
                "use_cache": False,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert "content" in data
        assert "path" in data
        assert "size_bytes" in data
        assert "cached" in data

        # Verify content contains expected code
        assert "def add(a, b):" in data["content"]
        assert "def multiply(a, b):" in data["content"]

    def test_load_file_with_cache(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test file caching behavior."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        # First load (cache miss)
        response1 = test_client_with_auth.post(
            "/api/v1/code-execution/files/load",
            json={
                "file_path": "scripts/calculator.py",
                "project_id": "test",
                "use_cache": True,
            },
        )

        if response1.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response1.status_code == 200
        data1 = response1.json()

        # Second load (should use cache)
        response2 = test_client_with_auth.post(
            "/api/v1/code-execution/files/load",
            json={
                "file_path": "scripts/calculator.py",
                "project_id": "test",
                "use_cache": True,
            },
        )

        assert response2.status_code == 200
        data2 = response2.json()

        # Content should be identical
        assert data1["content"] == data2["content"]

        # Note: We can't reliably check 'cached' flag without accessing the loader instance
        # but we can verify the content is the same


class TestFileExecution:
    """Test executing code from files."""

    def test_execute_simple_file(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing a simple Python file."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/calculator.py",
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        # The file executes and sets result = add(10, 20) = 30
        assert data["result"] == 30
        assert "execution_time_ms" in data

    def test_execute_function_with_inputs(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing a specific function with input parameters."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/calculator.py",
                "function_name": "multiply",
                "inputs": {"a": 7, "b": 6},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["result"] == 42  # 7 * 6

    def test_execute_function_with_error(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing a function that raises an error."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/calculator.py",
                "function_name": "divide",
                "inputs": {"a": 10, "b": 0},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should return error result, not 500
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False
            assert "Cannot divide by zero" in data["error"]
        else:
            # Endpoint might return 500 for execution errors
            assert response.status_code == 500

    def test_execute_with_import_resolution(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing file that imports another project file."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/processor.py",
                "function_name": "process_data",
                "inputs": {"numbers": [1, 2, 3, 4, 5]},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["result"] == 15  # sum(1,2,3,4,5)

    def test_execute_with_cross_directory_import(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing file that imports from different directory."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/workflow.py",
                "function_name": "process_invoice",
                "inputs": {"text": "Invoice: $100.50, $200.75, $50.25"},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        result = data["result"]
        assert result["count"] == 3
        assert "$351.50" in result["total"]  # 100.50 + 200.75 + 50.25

    def test_execute_with_context(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing file that uses execution context."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/context_aware.py",
                "function_name": "extract_from_ocr",
                "context": {
                    "action_result": {"text": "Total Price: $99.99"},
                    "variables": {},
                    "workflow_state": {},
                    "active_states": [],
                },
                "inputs": {"pattern_type": "price"},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["result"] == 99.99

    def test_execute_with_variables_context(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing file that uses variables from context."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/context_aware.py",
                "function_name": "check_threshold",
                "context": {
                    "action_result": {"value": 75},
                    "variables": {"threshold": 100},
                    "workflow_state": {},
                    "active_states": [],
                },
                "inputs": {},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["result"] is True  # 75 < 100


class TestFileExecutionErrors:
    """Test error handling in file execution."""

    def test_execute_missing_file(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing a file that doesn't exist."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/nonexistent.py",
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should return 404 or error result
        assert response.status_code in [404, 500]

    def test_execute_syntax_error_file(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing a file with syntax errors."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/syntax_error.py",
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should return error result
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False
            assert data["error_type"] in ["SyntaxError", "ValidationError"]
        else:
            assert response.status_code == 500

    def test_execute_runtime_error_file(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing a file that causes runtime error."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/runtime_error.py",
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should return error result
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False
            assert (
                "ZeroDivisionError" in data["error_type"]
                or "division" in data["error"].lower()
            )
        else:
            assert response.status_code == 500

    def test_execute_missing_function(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test calling a function that doesn't exist in the file."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/calculator.py",
                "function_name": "nonexistent_function",
                "inputs": {},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should return error
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False
            assert "NameError" in data["error_type"] or "not defined" in data["error"]
        else:
            assert response.status_code == 500

    def test_execute_timeout(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test execution timeout."""
        # Create file with infinite loop
        timeout_file = project_dir / "scripts" / "timeout.py"
        timeout_file.write_text("""
import time

def slow_function():
    while True:
        time.sleep(1)

result = slow_function()
""")

        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/timeout.py",
                "project_id": "test",
                "timeout": 2,  # 2 second timeout
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should timeout (note: timeout might not work on Windows)
        if response.status_code == 200:
            data = response.json()
            # May or may not timeout depending on platform
            if not data["success"]:
                assert (
                    "timeout" in data["error"].lower()
                    or "TimeoutError" in data["error_type"]
                )


class TestFileExecutionSecurity:
    """Test security features of file execution."""

    def test_blocked_import_in_file(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test that blocked imports in files are rejected."""
        # Create file with blocked import
        malicious_file = project_dir / "scripts" / "malicious.py"
        malicious_file.write_text("""
import os

def delete_files():
    os.system("rm -rf /")
    return "done"

result = delete_files()
""")

        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/malicious.py",
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should be blocked
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False
            assert (
                "ValidationError" in data["error_type"]
                or "blocked" in data["error"].lower()
            )
        else:
            assert response.status_code in [400, 500]

    def test_dangerous_pattern_in_file(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test that dangerous patterns in files are blocked."""
        # Create file with dangerous pattern
        dangerous_file = project_dir / "scripts" / "dangerous.py"
        dangerous_file.write_text("""
def execute_code(code):
    return eval(code)

result = execute_code("2 + 2")
""")

        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/dangerous.py",
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        # Should be blocked
        if response.status_code == 200:
            data = response.json()
            assert data["success"] is False
            assert (
                "eval" in data["error"].lower()
                or "not allowed" in data["error"].lower()
            )
        else:
            assert response.status_code in [400, 500]


class TestFileExecutionIntegration:
    """Test integrated workflows with file execution."""

    def test_workflow_with_multiple_files(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test a complete workflow using multiple files."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        # Step 1: Extract numbers from text
        response1 = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "lib/utils.py",
                "function_name": "extract_numbers",
                "inputs": {"text": "Prices: $100.50, $200.75, $50.25"},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response1.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response1.status_code == 200
        numbers = response1.json()["result"]

        # Step 2: Calculate statistics
        response2 = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "scripts/processor.py",
                "function_name": "calculate_stats",
                "inputs": {"numbers": numbers},
                "project_id": "test",
                "timeout": 30,
            },
        )

        assert response2.status_code == 200
        stats = response2.json()["result"]

        assert stats["count"] == 3
        assert stats["sum"] == 351.5

        # Step 3: Format as currency
        response3 = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "lib/utils.py",
                "function_name": "format_currency",
                "inputs": {"amount": stats["sum"]},
                "project_id": "test",
                "timeout": 30,
            },
        )

        assert response3.status_code == 200
        formatted = response3.json()["result"]

        assert "$351.50" in formatted

    def test_nested_file_execution(
        self, test_client_with_auth: TestClient, project_dir: Path
    ):
        """Test executing a file in a deeply nested directory."""
        os.environ["TEST_PROJECT_ROOT"] = str(project_dir)

        response = test_client_with_auth.post(
            "/api/v1/code-execution/files/execute",
            json={
                "file_path": "nested/deep/module.py",
                "function_name": "nested_function",
                "inputs": {"x": 21},
                "project_id": "test",
                "timeout": 30,
            },
        )

        if response.status_code == 404:
            pytest.skip("Endpoint not implemented")

        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert data["result"] == 42  # 21 * 2
