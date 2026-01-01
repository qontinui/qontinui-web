"""
Timeout utilities for code execution.

Provides cross-platform timeout handling for sandboxed execution.
Extracted from code_execution_service.py for SRP compliance.
"""

import signal
import sys
import threading
from collections.abc import Generator
from contextlib import contextmanager


class ExecutionTimeoutError(Exception):
    """Raised when code execution exceeds timeout."""

    def __init__(self, seconds: int, message: str | None = None):
        self.seconds = seconds
        self.message = message or f"Code execution exceeded {seconds} second timeout"
        super().__init__(self.message)


@contextmanager
def time_limit(seconds: int) -> Generator[None, None, None]:
    """
    Context manager to enforce execution timeout.

    Uses signal.alarm on Unix-like systems for reliable interruption.
    Uses threading.Timer on Windows as a fallback (less reliable).

    Args:
        seconds: Maximum execution time in seconds

    Raises:
        ExecutionTimeoutError: If execution exceeds timeout

    Example:
        with time_limit(10):
            long_running_operation()
    """
    if sys.platform != "win32":
        # Unix: Use signal.alarm for reliable timeout
        yield from _unix_time_limit(seconds)
    else:
        # Windows: Use threading-based timeout (less reliable but works)
        yield from _windows_time_limit(seconds)


def _unix_time_limit(seconds: int) -> Generator[None, None, None]:
    """Unix implementation using signal.alarm."""

    def signal_handler(signum: int, frame) -> None:
        raise ExecutionTimeoutError(seconds)

    # Set the signal handler (Unix only - not available on Windows)
    old_handler = signal.signal(signal.SIGALRM, signal_handler)  # type: ignore[attr-defined]
    signal.alarm(seconds)  # type: ignore[attr-defined]

    try:
        yield
    finally:
        # Restore previous handler and cancel alarm
        signal.alarm(0)  # type: ignore[attr-defined]
        signal.signal(signal.SIGALRM, old_handler)  # type: ignore[attr-defined]


def _windows_time_limit(seconds: int) -> Generator[None, None, None]:
    """
    Windows implementation using threading.Timer.

    Note: This is less reliable than signal.alarm because Python cannot
    interrupt a running thread. The timeout is checked after the yield.
    """
    timed_out = threading.Event()

    def set_timeout():
        timed_out.set()

    timer = threading.Timer(seconds, set_timeout)
    timer.daemon = True
    timer.start()

    try:
        yield
        # Check if we timed out during execution
        if timed_out.is_set():
            raise ExecutionTimeoutError(seconds)
    finally:
        timer.cancel()


class TimeoutContext:
    """
    Alternative timeout handler that can be checked periodically.

    Useful for long-running loops that need to check timeout status.
    """

    def __init__(self, seconds: int):
        self.seconds = seconds
        self._timed_out = threading.Event()
        self._timer: threading.Timer | None = None

    def __enter__(self) -> "TimeoutContext":
        self._timer = threading.Timer(self.seconds, self._set_timeout)
        self._timer.daemon = True
        self._timer.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._timer:
            self._timer.cancel()

    def _set_timeout(self) -> None:
        self._timed_out.set()

    @property
    def timed_out(self) -> bool:
        """Check if the timeout has been reached."""
        return self._timed_out.is_set()

    def check(self) -> None:
        """
        Check if timed out and raise if so.

        Call this periodically in long-running loops.

        Raises:
            ExecutionTimeoutError: If timeout has been reached
        """
        if self._timed_out.is_set():
            raise ExecutionTimeoutError(self.seconds)
