"""Regression tests for the per-repo merge-profile proxy's slug encoding.

``GET``/``PATCH /operations/pr-merge/repos/{repo:path}/profile`` accept the
``owner/name`` slug with the ``/`` inline, because FastAPI's ``:path``
converter allows it. Coord's route is ``/pr-merge/repos/:repo/profile`` — a
SINGLE axum path segment — so the slug has to be re-encoded on the way out.

Forwarding the raw ``/`` made coord see four path segments, match no route and
return 404. The symptom was quiet and easy to misread: the Merge Settings
per-repo card rendered ``HTTP 404`` where the resolved profile should be, and
"Save override" appeared to work while writing nothing, because the PATCH 404'd
the same way.

The sibling ``/pr-merge/prs/{repo}/{pr}/checks`` route already encodes and
documents the distinction; these tests stop the two drifting apart again.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO = "qontinui/qontinui-runner"
ENCODED = "qontinui%2Fqontinui-runner"


def _build_test_app() -> FastAPI:
    """Minimal FastAPI app with the operations router + auth overridden."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "dev@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    tenant = uuid4()
    test_app.dependency_overrides[get_tenant_id] = lambda: tenant
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: tenant
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


def _mock_response(payload: dict) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = payload
    resp.text = ""
    return resp


@pytest.fixture
def client() -> TestClient:
    return TestClient(_build_test_app())


def test_get_profile_encodes_the_repo_slug(client: TestClient) -> None:
    """The outbound coord URL must carry %2F, not a bare slash."""
    with patch("httpx.AsyncClient") as mock_cls:
        inst = AsyncMock()
        inst.get.return_value = _mock_response({"repo": REPO, "profile": {}})
        mock_cls.return_value.__aenter__.return_value = inst

        res = client.get(f"/api/v1/operations/pr-merge/repos/{REPO}/profile")
        assert res.status_code == 200

        called_url = inst.get.call_args[0][0]

    assert ENCODED in called_url, f"slug not encoded in {called_url!r}"
    # The whole point: coord's :repo is one segment, so the path after
    # /repos/ must contain no raw separator.
    tail = called_url.split("/pr-merge/repos/", 1)[1]
    assert tail == f"{ENCODED}/profile", f"unexpected coord path tail {tail!r}"


def test_patch_profile_encodes_the_repo_slug(client: TestClient) -> None:
    """PATCH had the identical bug — a 404 there loses the operator's edit."""
    body: dict[str, list[str]] = {"escalate_paths_extra": []}
    with patch("httpx.AsyncClient") as mock_cls:
        inst = AsyncMock()
        inst.patch.return_value = _mock_response({"repo": REPO, "profile": {}})
        mock_cls.return_value.__aenter__.return_value = inst

        res = client.patch(
            f"/api/v1/operations/pr-merge/repos/{REPO}/profile", json=body
        )
        assert res.status_code == 200

        called_url = inst.patch.call_args[0][0]
        sent_body = inst.patch.call_args.kwargs.get("json")

    assert ENCODED in called_url, f"slug not encoded in {called_url!r}"
    tail = called_url.split("/pr-merge/repos/", 1)[1]
    assert tail == f"{ENCODED}/profile", f"unexpected coord path tail {tail!r}"
    # An empty list must survive the proxy verbatim: that is how an operator
    # CLEARS a repo's escalate-path overrides, and dropping it would turn the
    # clear into a silent no-op.
    assert sent_body == body
