"""
Function scanner service for detecting @automation_function decorators.

Parses Python files to extract decorated functions and their metadata.
"""

import ast
from typing import Any

from pydantic import BaseModel

# ============================================================================
# Models
# ============================================================================


class FunctionParameter(BaseModel):
    """Parameter metadata for a function."""

    name: str
    type_hint: str | None = None
    default: Any | None = None
    required: bool = True


class FunctionMetadata(BaseModel):
    """Metadata extracted from @automation_function decorator."""

    # Function identity
    function_name: str
    file_path: str

    # Display metadata
    display_name: str | None = None
    description: str | None = None
    category: str | None = None
    tags: list[str] = []

    # Function signature
    parameters: list[FunctionParameter] = []
    return_type: str | None = None

    # Decorator metadata
    inputs: dict[str, str] = {}  # {param_name: type_string}
    outputs: dict[str, str] = {}  # {output_name: type_string}

    # Observability (for RL/strategy agent)
    observable_outputs: list[str] = []

    # Source code
    source_code: str | None = None
    docstring: str | None = None

    # Line numbers
    line_start: int | None = None
    line_end: int | None = None


# ============================================================================
# AST-based Function Scanner
# ============================================================================


class FunctionScanner:
    """Scans Python files for @automation_function decorated functions."""

    DECORATOR_NAME = "automation_function"

    @staticmethod
    def scan_file(file_content: str, file_path: str) -> list[FunctionMetadata]:
        """
        Parse Python file and extract all @automation_function decorated functions.

        Args:
            file_content: Python source code
            file_path: Path to the file (for metadata)

        Returns:
            List of function metadata for each decorated function

        Raises:
            SyntaxError: If file has syntax errors
        """
        try:
            tree = ast.parse(file_content)
        except SyntaxError as e:
            raise SyntaxError(f"Syntax error in {file_path}: {e}")

        functions = []

        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                # Check if function has @automation_function decorator
                if FunctionScanner._has_automation_decorator(node):
                    metadata = FunctionScanner._extract_function_metadata(
                        node, file_content, file_path
                    )
                    functions.append(metadata)

        return functions

    @staticmethod
    def _has_automation_decorator(func_node: ast.FunctionDef) -> bool:
        """Check if function has @automation_function decorator."""
        for decorator in func_node.decorator_list:
            # Handle @automation_function
            if (
                isinstance(decorator, ast.Name)
                and decorator.id == FunctionScanner.DECORATOR_NAME
            ):
                return True

            # Handle @automation_function(...)
            if isinstance(decorator, ast.Call):
                if (
                    isinstance(decorator.func, ast.Name)
                    and decorator.func.id == FunctionScanner.DECORATOR_NAME
                ):
                    return True

        return False

    @staticmethod
    def _extract_function_metadata(
        func_node: ast.FunctionDef, file_content: str, file_path: str
    ) -> FunctionMetadata:
        """Extract metadata from decorated function."""

        # Get decorator arguments
        decorator_kwargs = FunctionScanner._get_decorator_kwargs(func_node)

        # Extract function signature
        parameters = FunctionScanner._extract_parameters(func_node)
        return_type = FunctionScanner._extract_return_type(func_node)

        # Get source code
        source_lines = file_content.split("\n")
        line_start = func_node.lineno
        line_end = func_node.end_lineno or line_start
        source_code = "\n".join(source_lines[line_start - 1 : line_end])

        # Get docstring
        docstring = ast.get_docstring(func_node)

        # Build metadata
        return FunctionMetadata(
            function_name=func_node.name,
            file_path=file_path,
            display_name=decorator_kwargs.get("name"),
            description=decorator_kwargs.get("description"),
            category=decorator_kwargs.get("category"),
            tags=decorator_kwargs.get("tags", []),
            parameters=parameters,
            return_type=return_type,
            inputs=decorator_kwargs.get("inputs", {}),
            outputs=decorator_kwargs.get("outputs", {}),
            observable_outputs=decorator_kwargs.get("observable_outputs", []),
            source_code=source_code,
            docstring=docstring,
            line_start=line_start,
            line_end=line_end,
        )

    @staticmethod
    def _get_decorator_kwargs(func_node: ast.FunctionDef) -> dict[str, Any]:
        """Extract keyword arguments from @automation_function decorator."""
        kwargs = {}

        for decorator in func_node.decorator_list:
            # Only process @automation_function(...) calls
            if not isinstance(decorator, ast.Call):
                continue

            if not isinstance(decorator.func, ast.Name):
                continue

            if decorator.func.id != FunctionScanner.DECORATOR_NAME:
                continue

            # Extract keyword arguments
            for keyword in decorator.keywords:
                key = keyword.arg
                value = FunctionScanner._ast_literal_to_python(keyword.value)
                if key is not None:
                    kwargs[key] = value

        return kwargs

    @staticmethod
    def _ast_literal_to_python(node: ast.AST) -> Any:
        """Convert AST literal node to Python value."""
        if isinstance(node, ast.Constant):
            return node.value
        elif isinstance(node, ast.List):
            return [FunctionScanner._ast_literal_to_python(elt) for elt in node.elts]
        elif isinstance(node, ast.Dict):
            return {
                FunctionScanner._ast_literal_to_python(
                    k
                ): FunctionScanner._ast_literal_to_python(v)
                for k, v in zip(node.keys, node.values, strict=False)
                if k is not None
            }
        elif isinstance(node, ast.Name):
            # For type hints like ActionResult
            return node.id
        else:
            return None

    @staticmethod
    def _extract_parameters(func_node: ast.FunctionDef) -> list[FunctionParameter]:
        """Extract parameter information from function signature."""
        parameters = []

        args = func_node.args

        # Get defaults (align with parameters from right)
        defaults = [None] * (len(args.args) - len(args.defaults)) + args.defaults

        for arg, default in zip(args.args, defaults, strict=False):
            # Skip 'self' and 'context' parameters
            if arg.arg in ["self", "context"]:
                continue

            param = FunctionParameter(
                name=arg.arg,
                type_hint=FunctionScanner._get_type_annotation(arg.annotation),
                default=FunctionScanner._get_default_value(default),
                required=(default is None),
            )
            parameters.append(param)

        return parameters

    @staticmethod
    def _extract_return_type(func_node: ast.FunctionDef) -> str | None:
        """Extract return type annotation."""
        if func_node.returns:
            return FunctionScanner._get_type_annotation(func_node.returns)
        return None

    @staticmethod
    def _get_type_annotation(annotation: ast.AST | None) -> str | None:
        """Convert AST type annotation to string."""
        if annotation is None:
            return None

        if isinstance(annotation, ast.Name):
            return annotation.id
        elif isinstance(annotation, ast.Constant):
            return str(annotation.value)
        else:
            # For complex types, use ast.unparse (Python 3.9+)
            try:
                return ast.unparse(annotation)
            except:
                return str(annotation)

    @staticmethod
    def _get_default_value(default_node: ast.AST | None) -> Any | None:
        """Extract default value from AST node."""
        if default_node is None:
            return None

        return FunctionScanner._ast_literal_to_python(default_node)


# ============================================================================
# Validation
# ============================================================================


class FunctionValidator:
    """Validates that decorated functions meet requirements."""

    @staticmethod
    def validate_function(metadata: FunctionMetadata) -> list[str]:
        """
        Validate function metadata.

        Returns:
            List of validation error messages (empty if valid)
        """
        errors = []

        # Check required fields
        if not metadata.function_name:
            errors.append("Function name is required")

        if not metadata.display_name:
            errors.append("Display name is required (set in decorator)")

        # Check parameters match inputs
        if metadata.inputs:
            input_names = set(metadata.inputs.keys())
            param_names = {p.name for p in metadata.parameters}

            missing = input_names - param_names
            if missing:
                errors.append(
                    f"Inputs declared in decorator but missing from signature: {missing}"
                )

        # Check category is valid
        if metadata.category:
            valid_categories = {
                "Data Processing",
                "Logic & Control",
                "State Management",
                "External Integration",
                "Debugging",
                "Validation",
                "Transformation",
            }
            if metadata.category not in valid_categories:
                errors.append(
                    f"Category '{metadata.category}' not recognized. "
                    f"Valid: {', '.join(valid_categories)}"
                )

        return errors
