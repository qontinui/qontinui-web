"""The blank-means-clear contract for ``project.apps`` build/start commands.

``project.apps`` is the RUNNER's table, and it has two independent writers: this
backend (direct SQLAlchemy, ``app/models/app_registry.py``) and the runner's own
``PATCH /apps/:app_id``. The value they must keep OUT of it is a blank command.

Why a blank must never be stored: the runner's auto-fresh engine runs a stored
command via ``sh -c`` / ``cmd /C`` and checks only the exit status
(``fleet.rs::execute_build_and_restart``). A blank command exits 0 on every
platform, so the engine records a successful build having built nothing and
marks the app ``fresh`` at the newly-pulled SHA — after which
``dispatch_to_fresh_host`` routes tests to a host still serving the previous
artifact.

The old implementation was ``raw or None``, which used Python truthiness: ``""``
cleared, but ``"   "`` was truthy and stored verbatim. That is the hole these
tests close.

**Both layers are tested on purpose.** The helper tests alone would stay green
if the call site were reverted to ``raw or None`` — the shipped bug lived at the
call site, so the endpoint test is the one that actually pins the regression.
"""

from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints.fleet_targets import _normalize_command


@pytest.mark.parametrize("blank", ["", " ", "   ", "\t", "\n", " \t\n "])
def test_blank_clears(blank: str) -> None:
    """Every blank shape clears — including ``"   "``, the shipped regression."""
    assert _normalize_command(blank) is None


def test_real_command_is_stored_trimmed() -> None:
    assert _normalize_command("npm run build") == "npm run build"
    assert _normalize_command("  npm run build  ") == "npm run build"


# ---------------------------------------------------------------------------
# Endpoint level — PATCH /api/v1/fleet/apps/{app_id}
#
# The helper tests above cannot catch a reverted call site. These can.
# ---------------------------------------------------------------------------


class _FakeApp:
    """Stand-in for the ``App`` ORM row the handler mutates."""

    def __init__(self, **kwargs: Any) -> None:
        self.app_id = "my-app"
        self.display_name = "My App"
        self.repo_root = "/code/my-app"
        self.update_strategy = "pull_build"
        self.build_command = "npm run build"
        self.start_command = "npm start"
        for key, value in kwargs.items():
            setattr(self, key, value)


class _FakeSession:
    """Minimal async session: ``get`` / ``commit`` / ``refresh``."""

    def __init__(self, row: _FakeApp | None) -> None:
        self.row = row
        self.committed = False

    async def get(self, _model: Any, _pk: str) -> _FakeApp | None:
        return self.row

    async def commit(self) -> None:
        self.committed = True

    async def refresh(self, _obj: Any) -> None:
        return None


def _client(row: _FakeApp | None) -> tuple[TestClient, _FakeSession]:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.fleet_targets import router

    session = _FakeSession(row)
    app = FastAPI()
    app.include_router(router, prefix="/fleet")
    app.dependency_overrides[get_async_db] = lambda: session
    app.dependency_overrides[get_current_active_user_async] = lambda: MagicMock()
    return TestClient(app), session


@pytest.mark.parametrize("blank", ["", "   ", "\t"])
def test_patch_clears_on_blank(blank: str) -> None:
    """A blank on the wire clears the column, through the real handler.

    This is the assertion that fails if the call site regresses to
    ``body.build_command or None`` — ``"   "`` would then be stored.
    """
    row = _FakeApp()
    client, session = _client(row)
    resp = client.patch("/fleet/apps/my-app", json={"build_command": blank})
    assert resp.status_code == 200, resp.text
    assert row.build_command is None
    assert resp.json()["build_command"] is None
    assert session.committed


def test_patch_normalizes_start_command_too() -> None:
    """Both fields get the same treatment — not just ``build_command``."""
    row = _FakeApp()
    client, _ = _client(row)
    resp = client.patch("/fleet/apps/my-app", json={"start_command": "   "})
    assert resp.status_code == 200, resp.text
    assert row.start_command is None
    # The sibling field was not in the body, so it is untouched.
    assert row.build_command == "npm run build"


def test_patch_stores_trimmed() -> None:
    row = _FakeApp()
    client, _ = _client(row)
    resp = client.patch("/fleet/apps/my-app", json={"build_command": "  make  "})
    assert resp.status_code == 200, resp.text
    assert row.build_command == "make"


def test_patch_omitted_field_is_unchanged() -> None:
    """Absent means unchanged — distinct from blank, which means clear."""
    row = _FakeApp()
    client, _ = _client(row)
    resp = client.patch("/fleet/apps/my-app", json={"update_strategy": "pull_only"})
    assert resp.status_code == 200, resp.text
    assert row.build_command == "npm run build"
    assert row.start_command == "npm start"
    assert row.update_strategy == "pull_only"


def test_patch_explicit_null_is_unchanged() -> None:
    """``null`` is 'no change', NOT a clear — clearing requires a blank string."""
    row = _FakeApp()
    client, _ = _client(row)
    resp = client.patch("/fleet/apps/my-app", json={"build_command": None})
    assert resp.status_code == 200, resp.text
    assert row.build_command == "npm run build"


def test_patch_unknown_app_is_404() -> None:
    client, _ = _client(None)
    resp = client.patch("/fleet/apps/ghost", json={"build_command": ""})
    assert resp.status_code == 404
