"""``_recent_crash_from`` — the stored ``recent_crash`` JSONB → ``RunnerCrash``.

The runner's WS heartbeat stores its camelCase ``RecentCrash`` verbatim,
including ``pid`` (qontinui-runner#2551 / #2722) and ``null`` for a section
the dump lacks. These pin that the pid survives the read, that a missing pid
stays unknown rather than guessed, and that a ``null`` section is never
rendered as the text ``"None"``.
"""

from __future__ import annotations

from app.api.v1.endpoints.devices import _recent_crash_from

_FULL = {
    "filePath": "C:/dumps/crash_1.txt",
    "panicLocation": "src/main.rs:1:1",
    "panicMessage": "boom",
    "reportedAt": "2026-11-08T00:00:00Z",
    "thread": "main",
}


def test_camelcase_crash_keeps_pid() -> None:
    crash = _recent_crash_from({**_FULL, "pid": 4242})
    assert crash is not None
    assert crash.pid == 4242
    assert crash.panicMessage == "boom"


def test_crash_without_pid_reads_as_unknown() -> None:
    crash = _recent_crash_from(dict(_FULL))
    assert crash is not None
    assert crash.pid is None


def test_null_sections_fall_back_without_rendering_none() -> None:
    crash = _recent_crash_from(
        {
            "filePath": "C:/dumps/crash_2.txt",
            "reportedAt": "2026-11-08T00:00:00Z",
            "panicLocation": None,
            "panicMessage": None,
            "thread": None,
            "pid": 77,
        }
    )
    assert crash is not None
    assert crash.panicLocation == ""
    assert crash.panicMessage == ""
    assert crash.thread == ""
    assert crash.pid == 77


def test_snake_case_crash_keeps_pid() -> None:
    crash = _recent_crash_from(
        {
            "file_path": "C:/dumps/crash_3.txt",
            "reported_at": "2026-11-08T00:00:00Z",
            "panic_message": "boom",
            "pid": 9,
        }
    )
    assert crash is not None
    assert crash.filePath == "C:/dumps/crash_3.txt"
    assert crash.panicMessage == "boom"
    assert crash.pid == 9


def test_non_integer_pid_is_dropped_not_guessed() -> None:
    for bad in ("4242", True, -1, 1.5):
        crash = _recent_crash_from({**_FULL, "panicLocation": None, "pid": bad})
        assert crash is not None
        assert crash.pid is None, bad
