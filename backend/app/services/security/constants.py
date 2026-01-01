"""
Security configuration constants.

Defines blocked imports, functions, patterns, and thresholds for code security scanning.
"""

# Imports that are BLOCKED (high security risk)
BLOCKED_IMPORTS = {
    # File system operations
    "os",
    "pathlib",
    "shutil",
    "glob",
    "tempfile",
    "fileinput",
    # Network operations
    "socket",
    "socketserver",
    "http",
    "urllib",
    "urllib2",
    "urllib3",
    "requests",
    "httpx",
    "ftplib",
    "telnetlib",
    "smtplib",
    "poplib",
    "imaplib",
    # Process operations
    "subprocess",
    "multiprocessing",
    "threading",
    "asyncio.subprocess",
    # System operations
    "sys",
    "signal",
    "ctypes",
    "cffi",
    # Code execution
    "importlib",
    "runpy",
    "code",
    "codeop",
    # Serialization (unsafe)
    "pickle",
    "marshal",
    "shelve",
    "dill",
    # Other dangerous modules
    "pty",
    "tty",
    "rlcompleter",
    "__builtin__",
    "builtins",
}

# Functions that are BLOCKED (dangerous operations)
BLOCKED_FUNCTIONS = {
    "eval",
    "exec",
    "compile",
    "__import__",
    "open",
    "file",
    "input",
    "raw_input",
    "execfile",
    "reload",
    "delattr",
    "setattr",
    "getattr",  # Can be used for attribute access exploits
    "globals",
    "locals",
    "vars",
    "dir",
    "breakpoint",
    "help",
    "exit",
    "quit",
}

# Imports that generate WARNINGS (potentially risky)
WARNING_IMPORTS = {
    "random",  # Non-cryptographic randomness
    "hashlib",  # Cryptographic functions
    "secrets",  # Cryptographic secrets
    "ssl",  # SSL/TLS operations
    "webbrowser",  # Can open URLs
}

# Allowed safe imports (whitelist)
SAFE_IMPORTS = {
    # Data structures
    "collections",
    "array",
    "heapq",
    "bisect",
    "queue",
    "enum",
    # Math and numbers
    "math",
    "cmath",
    "decimal",
    "fractions",
    "statistics",
    # String processing
    "string",
    "re",
    "difflib",
    "textwrap",
    # Date and time
    "datetime",
    "time",
    "calendar",
    # Data formats
    "json",
    "csv",
    # Functional programming
    "itertools",
    "functools",
    "operator",
    # Type hints
    "typing",
    "types",
    # Data validation
    "dataclasses",
    # Other safe utilities
    "copy",
    "pprint",
    "uuid",
}

# Maximum complexity thresholds
MAX_COMPLEXITY_BLOCK = 20  # Block if complexity > 20
MAX_COMPLEXITY_WARN = 10  # Warn if complexity > 10
MAX_NESTING_DEPTH = 4  # Warn if nesting > 4 levels
MIN_MAINTAINABILITY_INDEX = 20  # Warn if MI < 20

# Obfuscation patterns
OBFUSCATION_PATTERNS = {
    "base64": r"base64\.(b64decode|b64encode|decodebytes|encodebytes)",
    "hex": r"(\\x[0-9a-fA-F]{2}){10,}",  # 10+ hex escape sequences
    "unicode": r"(\\u[0-9a-fA-F]{4}){5,}",  # 5+ unicode escapes
    "bytes_literal": r"b['\"](\\x[0-9a-fA-F]{2}){10,}['\"]",
    "chr_pattern": r"chr\s*\(\s*\d+\s*\)",  # chr() calls (often used in obfuscation)
    "compressed": r"(zlib|gzip|bz2|lzma)\.(decompress|compress)",
}
