"""
Unit Tests for File-Based Code Execution (Phase 2)

Tests file loader and code execution services independently without requiring
full application stack or database.
"""

import tempfile
from pathlib import Path
from typing import Generator

import pytest


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

        # 9. File with blocked import
        malicious_file = project_root / "scripts" / "malicious.py"
        malicious_file.write_text("""
import os

def delete_files():
    os.system("rm -rf /")
    return "done"

result = delete_files()
""")

        # 10. File with dangerous pattern (eval)
        dangerous_file = project_root / "scripts" / "dangerous.py"
        dangerous_file.write_text("""
def execute_code(code):
    return eval(code)

result = execute_code("2 + 2")
""")

        yield project_root


class TestFilePathValidator:
    """Test file path validation and security."""

    def test_validate_valid_path(self, project_dir: Path):
        """Test validating a valid file path."""
        from app.services.file_loader import FilePathValidator

        validator = FilePathValidator()
        file_path = "scripts/calculator.py"

        absolute_path = validator.validate_path(file_path, project_root=project_dir)

        assert absolute_path.exists()
        assert absolute_path.is_file()
        assert absolute_path.name == "calculator.py"

    def test_validate_path_traversal(self, project_dir: Path):
        """Test that path traversal attempts are blocked."""
        from app.services.file_loader import FilePathValidator
        from fastapi import HTTPException

        validator = FilePathValidator()

        # Try various path traversal attacks
        malicious_paths = [
            "../etc/passwd.py",
            "../../secrets.py",
            "scripts/../../../etc/passwd.py",
        ]

        for malicious_path in malicious_paths:
            with pytest.raises(HTTPException) as exc_info:
                validator.validate_path(malicious_path, project_root=project_dir)

            assert exc_info.value.status_code in [400, 403]

    def test_validate_absolute_path(self, project_dir: Path):
        """Test that absolute paths are blocked."""
        from app.services.file_loader import FilePathValidator
        from fastapi import HTTPException

        validator = FilePathValidator()

        with pytest.raises(HTTPException) as exc_info:
            validator.validate_path("/etc/passwd.py", project_root=project_dir)

        assert exc_info.value.status_code == 400

    def test_validate_non_python_file(self, project_dir: Path):
        """Test that non-Python files are rejected."""
        from app.services.file_loader import FilePathValidator
        from fastapi import HTTPException

        validator = FilePathValidator()

        # Create a non-Python file
        txt_file = project_dir / "test.txt"
        txt_file.write_text("Not a Python file")

        with pytest.raises(HTTPException) as exc_info:
            validator.validate_path("test.txt", project_root=project_dir)

        assert exc_info.value.status_code == 400

    def test_validate_missing_file(self, project_dir: Path):
        """Test that missing files are rejected."""
        from app.services.file_loader import FilePathValidator
        from fastapi import HTTPException

        validator = FilePathValidator()

        with pytest.raises(HTTPException) as exc_info:
            validator.validate_path("scripts/nonexistent.py", project_root=project_dir)

        assert exc_info.value.status_code == 404


class TestPythonFileLoader:
    """Test Python file loading and caching."""

    def test_load_file(self, project_dir: Path):
        """Test loading a Python file."""
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)
        content = loader.load_file("scripts/calculator.py", use_cache=False)

        assert "def add(a, b):" in content
        assert "def multiply(a, b):" in content

    def test_file_caching(self, project_dir: Path):
        """Test file caching behavior."""
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)

        # First load (cache miss)
        content1 = loader.load_file("scripts/calculator.py", use_cache=True)

        # Second load (cache hit)
        content2 = loader.load_file("scripts/calculator.py", use_cache=True)

        # Content should be identical
        assert content1 == content2

        # Check cache was used
        assert "scripts/calculator.py" in loader._cache

    def test_cache_bypass(self, project_dir: Path):
        """Test loading file without caching."""
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)

        # Load without caching
        content = loader.load_file("scripts/calculator.py", use_cache=False)

        # Cache should not contain the file
        assert "scripts/calculator.py" not in loader._cache
        assert content is not None

    def test_clear_cache(self, project_dir: Path):
        """Test clearing the file cache."""
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)

        # Load and cache
        loader.load_file("scripts/calculator.py", use_cache=True)
        assert "scripts/calculator.py" in loader._cache

        # Clear specific file
        loader.clear_cache("scripts/calculator.py")
        assert "scripts/calculator.py" not in loader._cache

    def test_clear_all_cache(self, project_dir: Path):
        """Test clearing all cached files."""
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)

        # Load multiple files
        loader.load_file("scripts/calculator.py", use_cache=True)
        loader.load_file("lib/utils.py", use_cache=True)

        assert len(loader._cache) == 2

        # Clear all
        loader.clear_cache()
        assert len(loader._cache) == 0

    def test_list_python_files(self, project_dir: Path):
        """Test listing all Python files in project."""
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)
        files = loader.list_python_files(directory=".")

        # Check expected files are listed
        assert any("calculator.py" in f for f in files)
        assert any("processor.py" in f for f in files)
        assert any("utils.py" in f for f in files)
        assert any("workflow.py" in f for f in files)

    def test_list_files_in_subdirectory(self, project_dir: Path):
        """Test listing files in a specific subdirectory."""
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)
        files = loader.list_python_files(directory="scripts")

        # Should only list files in scripts directory
        assert all("scripts" in f for f in files)
        assert any("calculator.py" in f for f in files)
        assert not any("utils.py" in f for f in files)  # utils.py is in lib/


class TestCodeExecution:
    """Test code execution with file loading."""

    def test_execute_simple_file(self, project_dir: Path):
        """Test executing a simple Python file."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/calculator.py")

        # Execute
        request = CodeExecutionRequest(code=code, context={}, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is True
        assert result.result == 30  # add(10, 20)

    def test_execute_function_with_inputs(self, project_dir: Path):
        """Test executing a specific function with inputs."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/calculator.py")

        # Wrap to call function
        wrapped_code = f"{code}\n\nresult = multiply(7, 6)"

        # Execute
        request = CodeExecutionRequest(code=wrapped_code, context={}, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is True
        assert result.result == 42

    def test_execute_with_import_resolution(self, project_dir: Path):
        """Test executing file that imports another project file."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file that imports another file
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/processor.py")

        # Wrap to call function
        wrapped_code = f"{code}\n\nresult = process_data([1, 2, 3, 4, 5])"

        # Execute with project_root for import resolution
        request = CodeExecutionRequest(
            code=wrapped_code,
            context={},
            inputs={},
            project_root=str(project_dir),
        )
        result = CodeExecutionService.execute_code(request)

        assert result.success is True
        assert result.result == 15

    def test_execute_with_cross_directory_import(self, project_dir: Path):
        """Test executing file that imports from different directory."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file that imports from lib/
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/workflow.py")

        # Wrap to call function
        wrapped_code = (
            f"{code}\n\nresult = process_invoice('Invoice: $100.50, $200.75, $50.25')"
        )

        # Execute with project_root for import resolution
        request = CodeExecutionRequest(
            code=wrapped_code,
            context={},
            inputs={},
            project_root=str(project_dir),
        )
        result = CodeExecutionService.execute_code(request)

        assert result.success is True
        assert result.result["count"] == 3
        assert "$351.50" in result.result["total"]

    def test_execute_syntax_error(self, project_dir: Path):
        """Test executing file with syntax error."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file with syntax error
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/syntax_error.py")

        # Execute
        request = CodeExecutionRequest(code=code, context={}, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is False
        assert result.error_type == "ValidationError"

    def test_execute_runtime_error(self, project_dir: Path):
        """Test executing file that causes runtime error."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file with runtime error
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/runtime_error.py")

        # Execute
        request = CodeExecutionRequest(code=code, context={}, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is False
        assert "ZeroDivisionError" in result.error_type

    def test_execute_blocked_import(self, project_dir: Path):
        """Test that blocked imports are rejected."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file with blocked import
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/malicious.py")

        # Execute
        request = CodeExecutionRequest(code=code, context={}, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is False
        assert result.error_type == "ValidationError"
        assert "blocked" in result.error.lower() or "not allowed" in result.error.lower()

    def test_execute_dangerous_pattern(self, project_dir: Path):
        """Test that dangerous patterns are blocked."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file with eval
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/dangerous.py")

        # Execute
        request = CodeExecutionRequest(code=code, context={}, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is False
        assert result.error_type == "ValidationError"
        assert "eval" in result.error.lower()


class TestCodeExecutionWithContext:
    """Test code execution using context variables."""

    def test_execute_with_action_result(self, project_dir: Path):
        """Test executing file that uses action_result from context."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
            ExecutionContext,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/context_aware.py")

        # Wrap to call function
        wrapped_code = f"{code}\n\nresult = extract_from_ocr(action_result, 'price')"

        # Execute with context
        context = ExecutionContext(
            action_result={"text": "Total Price: $99.99"},
            variables={},
            workflow_state={},
            active_states=set(),
        )

        request = CodeExecutionRequest(code=wrapped_code, context=context, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is True
        assert result.result == 99.99

    def test_execute_with_variables(self, project_dir: Path):
        """Test executing file that uses variables from context."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
            ExecutionContext,
        )
        from app.services.file_loader import PythonFileLoader

        # Load file
        loader = PythonFileLoader(project_root=project_dir)
        code = loader.load_file("scripts/context_aware.py")

        # Wrap to call function
        wrapped_code = f"{code}\n\nresult = check_threshold(action_result, variables)"

        # Execute with context
        context = ExecutionContext(
            action_result={"value": 75},
            variables={"threshold": 100},
            workflow_state={},
            active_states=set(),
        )

        request = CodeExecutionRequest(code=wrapped_code, context=context, inputs={})
        result = CodeExecutionService.execute_code(request)

        assert result.success is True
        assert result.result is True  # 75 < 100


class TestIntegratedWorkflow:
    """Test complete workflows using multiple files."""

    def test_multi_file_workflow(self, project_dir: Path):
        """Test a workflow that uses multiple files sequentially."""
        from app.services.code_execution_service import (
            CodeExecutionRequest,
            CodeExecutionService,
        )
        from app.services.file_loader import PythonFileLoader

        loader = PythonFileLoader(project_root=project_dir)

        # Step 1: Extract numbers from text
        code1 = loader.load_file("lib/utils.py")
        wrapped_code1 = (
            f"{code1}\n\nresult = extract_numbers('Prices: $100.50, $200.75, $50.25')"
        )

        request1 = CodeExecutionRequest(code=wrapped_code1, context={}, inputs={})
        result1 = CodeExecutionService.execute_code(request1)

        assert result1.success is True
        numbers = result1.result

        # Step 2: Calculate statistics
        code2 = loader.load_file("scripts/processor.py")
        wrapped_code2 = f"{code2}\n\nresult = calculate_stats({numbers})"

        request2 = CodeExecutionRequest(
            code=wrapped_code2, context={}, inputs={}, project_root=str(project_dir)
        )
        result2 = CodeExecutionService.execute_code(request2)

        assert result2.success is True
        stats = result2.result

        assert stats["count"] == 3
        assert stats["sum"] == 351.5

        # Step 3: Format as currency
        wrapped_code3 = f"{code1}\n\nresult = format_currency({stats['sum']})"

        request3 = CodeExecutionRequest(code=wrapped_code3, context={}, inputs={})
        result3 = CodeExecutionService.execute_code(request3)

        assert result3.success is True
        assert "$351.50" in result3.result
