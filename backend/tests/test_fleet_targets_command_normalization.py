"""The blank-means-clear contract for ``project.apps`` build/start commands.

``project.apps`` has TWO independent writers — this backend (direct SQLAlchemy,
``app/models/app_registry.py``) and the runner's own ``PATCH /apps/:app_id``
(``src-tauri/src/database/pg/apps.rs``). They must agree, and the value they
must agree to keep OUT of the table is a blank command.

Why a blank must never be stored: the runner's auto-fresh engine runs a stored
command via ``sh -c`` / ``cmd /C`` and checks only the exit status. A blank
command exits 0 on every platform, so the engine records a successful build
having built nothing and marks the app ``fresh`` at the newly-pulled SHA — after
which ``dispatch_to_fresh_host`` routes tests to a host still serving the
previous artifact.

The old implementation was ``raw or None``, which used Python truthiness: ``""``
cleared, but ``"   "`` was truthy and stored verbatim. That is the hole these
tests close.
"""

import pytest

from app.api.v1.endpoints.fleet_targets import _normalize_command


@pytest.mark.parametrize("blank", ["", " ", "   ", "\t", "\n", " \t\n "])
def test_blank_clears(blank: str) -> None:
    """Every blank shape clears — this is the regression that mattered."""
    assert _normalize_command(blank) is None


def test_whitespace_only_is_not_stored() -> None:
    """The specific old bug: ``"   "`` is truthy in Python and used to persist."""
    assert _normalize_command("   ") is None


def test_real_command_is_stored_trimmed() -> None:
    assert _normalize_command("npm run build") == "npm run build"
    assert _normalize_command("  npm run build  ") == "npm run build"


def test_never_returns_a_blank_string() -> None:
    """The property, not just the cases: no input yields a stored blank."""
    for raw in ["", "   ", "\t\n", "x", " npm start ", "  a  b  "]:
        result = _normalize_command(raw)
        assert result is None or result.strip() == result
        assert result != ""
