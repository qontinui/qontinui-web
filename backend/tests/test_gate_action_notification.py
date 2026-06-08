"""T3 gate-action notifications — N2/N3 unit tests.

Covers the honesty builder (N3), the dedup key (N3), and the embedded-context
->users mapping (N2 path: no coord callback, no bearer).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest

from app.services.identity_resolver import (
    SOURCE_DEVICE_OWNER,
    SOURCE_GITHUB_AUTHOR,
    SOURCE_TENANT_FALLBACK,
    map_context_to_users,
)
from app.services.notifications.builders import (
    build_gate_action_notification,
    gate_action_dedup_key,
)


# ---- N3 honesty builder ---------------------------------------------------


def _build(**over: Any) -> tuple[str, str, dict]:
    kwargs: dict[str, Any] = dict(
        repo="qontinui/qontinui-web",
        pr_number=482,
        block_reason_code="blast_radius_removes_referenced_export",
        head_sha="deadbeef",
        coverage=1.0,
        graph_available=True,
        frontend_url="https://app.qontinui.io",
    )
    kwargs.update(over)
    return build_gate_action_notification(**kwargs)


def test_message_is_authoritative_with_full_graph_coverage():
    _title, message, _meta = _build(graph_available=True, coverage=1.0)
    assert "non-authoritative" not in message
    assert "partial coverage" not in message


def test_message_labels_non_authoritative_without_graph():
    _t, message, _m = _build(graph_available=False, coverage=None)
    assert "non-authoritative" in message
    assert "no code graph" in message


def test_message_states_partial_coverage():
    _t, message, _m = _build(graph_available=True, coverage=0.5)
    assert "partial coverage" in message
    assert "50%" in message


def test_metadata_carries_dedup_key_and_deep_links():
    _t, _m, meta = _build()
    assert meta["dedup_key"] == gate_action_dedup_key(
        "qontinui/qontinui-web", 482, "deadbeef", "blast_radius_removes_referenced_export"
    )
    assert meta["pr_url"] == "https://github.com/qontinui/qontinui-web/pull/482"
    assert meta["operations_url"] == "https://app.qontinui.io/operations"


def test_dedup_key_distinguishes_head_sha_and_reason():
    base = gate_action_dedup_key("r", 1, "aaa", "x")
    assert base != gate_action_dedup_key("r", 1, "bbb", "x")  # new head_sha
    assert base != gate_action_dedup_key("r", 1, "aaa", "y")  # new reason
    assert base == gate_action_dedup_key("r", 1, "aaa", "x")  # stable


# ---- N2 embedded-context -> users mapping ---------------------------------


class _FakeResult:
    def __init__(self, obj: Any) -> None:
        self._obj = obj

    def scalars(self) -> "_FakeResult":
        return self

    def first(self) -> Any:
        return self._obj


class _User:
    def __init__(self, uid: UUID) -> None:
        self.id = uid


class _FakeDB:
    """Maps github_user_id->User (via execute) and id->User (via get)."""

    def __init__(self, *, author: Any = None, by_id: dict[UUID, Any] | None = None):
        self._author = author
        self._by_id = by_id or {}

    async def execute(self, _stmt) -> _FakeResult:  # noqa: ANN001
        return _FakeResult(self._author)

    async def get(self, _model, key: UUID) -> Any:  # noqa: ANN001
        return self._by_id.get(key)


@pytest.mark.asyncio
async def test_map_github_author_wins_over_device_owner():
    author = _User(uuid4())
    owner = _User(uuid4())
    db = _FakeDB(author=author, by_id={owner.id: owner})
    users = await map_context_to_users(
        db,  # type: ignore[arg-type]
        github_author_id="4242",
        device_owner_user_id=owner.id,
        tenant_fallback_user_ids=[],
    )
    sources = {u.source for u in users}
    assert SOURCE_GITHUB_AUTHOR in sources
    assert SOURCE_DEVICE_OWNER in sources
    assert users[0].source == SOURCE_GITHUB_AUTHOR  # priority order


@pytest.mark.asyncio
async def test_map_tenant_fallback_only_when_no_author_or_owner():
    member = _User(uuid4())
    db = _FakeDB(author=None, by_id={member.id: member})
    users = await map_context_to_users(
        db,  # type: ignore[arg-type]
        github_author_id=None,
        device_owner_user_id=None,
        tenant_fallback_user_ids=[member.id],
    )
    assert [u.source for u in users] == [SOURCE_TENANT_FALLBACK]


@pytest.mark.asyncio
async def test_map_returns_empty_when_nothing_resolves():
    db = _FakeDB(author=None, by_id={})
    users = await map_context_to_users(
        db,  # type: ignore[arg-type]
        github_author_id=None,
        device_owner_user_id=uuid4(),  # not in by_id -> unresolved
        tenant_fallback_user_ids=[uuid4()],  # not in by_id -> unresolved
    )
    assert users == []  # caller (webhook) treats empty as a soft no-op
