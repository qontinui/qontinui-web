"""
Security policy for code execution.

Defines blocked builtins, blocked imports, and configurable security policies.
Extracted from code_execution_service.py for SRP compliance.
"""

from dataclasses import dataclass, field

# Default blocked builtins - these are always blocked
BLOCKED_BUILTINS: frozenset[str] = frozenset(
    {
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
)

# Default blocked imports - these are always blocked
BLOCKED_IMPORTS: frozenset[str] = frozenset(
    {
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
)

# Default allowed imports for sandboxed execution
DEFAULT_ALLOWED_IMPORTS: tuple[str, ...] = (
    "re",
    "json",
    "math",
    "datetime",
    "collections",
    "itertools",
    "functools",
    "typing",
)


@dataclass
class CodeSecurityPolicy:
    """
    Configurable security policy for code execution.

    Allows customization of blocked/allowed imports while maintaining
    core security constraints.
    """

    blocked_builtins: frozenset[str] = field(default_factory=lambda: BLOCKED_BUILTINS)
    blocked_imports: frozenset[str] = field(default_factory=lambda: BLOCKED_IMPORTS)
    allowed_imports: tuple[str, ...] = field(
        default_factory=lambda: DEFAULT_ALLOWED_IMPORTS
    )
    allow_dunder_methods: bool = False
    max_timeout_seconds: int = 60

    def is_builtin_blocked(self, name: str) -> bool:
        """Check if a builtin is blocked."""
        return name in self.blocked_builtins

    def is_import_blocked(self, module_name: str) -> bool:
        """Check if a module import is blocked."""
        # Get the root module (e.g., 'os' from 'os.path')
        root_module = module_name.split(".")[0]
        return root_module in self.blocked_imports

    def is_import_allowed(
        self, module_name: str, allow_project_imports: bool = False
    ) -> bool:
        """
        Check if a module import is allowed.

        Args:
            module_name: Name of the module to check
            allow_project_imports: If True, allow any non-blocked import

        Returns:
            True if the import is allowed
        """
        root_module = module_name.split(".")[0]

        # Always block dangerous imports
        if root_module in self.blocked_imports:
            return False

        # If project imports are allowed, any non-blocked import is OK
        if allow_project_imports:
            return True

        # Otherwise, must be in whitelist
        return root_module in self.allowed_imports

    def get_safe_builtins(self, include_import: bool = False) -> dict:
        """
        Get a dictionary of safe builtins.

        Args:
            include_import: If True, include __import__ for file-based execution

        Returns:
            Dictionary of safe builtins
        """
        import builtins

        safe = {
            k: v
            for k, v in builtins.__dict__.items()
            if k not in self.blocked_builtins and not k.startswith("_")
        }

        if include_import:
            safe["__import__"] = builtins.__dict__["__import__"]

        return safe
