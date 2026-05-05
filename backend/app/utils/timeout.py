"""
Timeout utilities for code execution.

Provides cross-platform, cross-thread timeout handling for sandboxed
execution. Extracted from code_execution_service.py for SRP compliance.
"""

import ctypes
import threading
from collections.abc import Generator
from contextlib import contextmanager


class ExecutionTimeoutError(Exception):
    """Raised when code execution exceeds timeout."""

    def __init__(self, seconds: int = 0, message: str | None = None):
        self.seconds = seconds
        self.message = message or f"Code execution exceeded {seconds} second timeout"
        super().__init__(self.message)


def _async_raise_in_thread(thread_id: int, exc_type: type[BaseException]) -> None:
    """Inject an exception into a target thread via the CPython C API.

    Used so we can interrupt code running in any thread — including
    Starlette's ``run_in_threadpool`` (where ``signal.SIGALRM`` raises
    ``ValueError: signal only works in main thread of the main interpreter``).

    Caveats:
    - The exception fires at the next Python bytecode boundary, so pure
      Python loops are interrupted promptly.
    - Standard-library blocking calls that release the GIL (``time.sleep``,
      socket I/O, etc.) check for pending async exceptions on return, so
      they are interruptible.
    - C extensions that hold the GIL persistently won't be interrupted
      until they yield control. In practice the sandboxed user code can't
      reach such extensions: ``CodeValidator`` enforces an import whitelist
      and ``safe_globals`` strips ``__builtins__`` to a vetted subset.
    """
    res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
        ctypes.c_ulong(thread_id),
        ctypes.py_object(exc_type),
    )
    if res > 1:
        ctypes.pythonapi.PyThreadState_SetAsyncExc(
            ctypes.c_ulong(thread_id), ctypes.c_long(0)
        )


@contextmanager
def time_limit(seconds: int) -> Generator[None, None, None]:
    """
    Context manager to enforce execution timeout.

    Uses ``threading.Timer`` + ``PyThreadState_SetAsyncExc`` so the
    timeout works in any thread, including the threadpool that
    Starlette/FastAPI uses for sync handlers under ``TestClient``. The
    previous ``signal.SIGALRM`` implementation only worked on the main
    thread and raised ``ValueError`` everywhere else.

    Args:
        seconds: Maximum execution time in seconds

    Raises:
        ExecutionTimeoutError: If execution exceeds timeout

    Example:
        with time_limit(10):
            long_running_operation()
    """
    target_thread_id = threading.get_ident()
    state_lock = threading.Lock()
    finished = False

    def fire() -> None:
        # Hold the lock while injecting so we don't race with the
        # ``finally`` block clearing ``finished``: either the body
        # finished first (and we no-op) or the timer wins (and the
        # async exception fires at the next bytecode in the body).
        with state_lock:
            if finished:
                return
            _async_raise_in_thread(target_thread_id, ExecutionTimeoutError)

    timer = threading.Timer(seconds, fire)
    timer.daemon = True
    timer.start()

    try:
        try:
            yield
        except ExecutionTimeoutError:
            # The async-raised exception arrives without our `seconds`
            # argument; rebuild it with the right message.
            raise ExecutionTimeoutError(seconds) from None
    finally:
        with state_lock:
            finished = True
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
