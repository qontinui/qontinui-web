"""Row shapes written by the recording pipeline's PG persistence.

``_persist_result_to_pg`` builds a ``UIBridgeStateConfig`` graph through the
same graph crud the ``ui_bridge_states`` routes use. These tests pin the rows
it writes, and that it leaves the commit to its caller.
"""

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.recording_pipeline import _persist_result_to_pg
from app.models.project import Project
from app.models.ui_bridge_state import UIBridgeState, UIBridgeStateConfig
from app.models.ui_bridge_transition import UIBridgeTransition
from app.models.user import User

pytestmark = pytest.mark.asyncio


async def _make_project(db: AsyncSession) -> Project:
    user = User(
        email=f"rp_{uuid4().hex[:8]}@example.com",
        username=f"rp_{uuid4().hex[:8]}",
        full_name="rp tester",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    project = Project(id=uuid4(), name="rp", owner_id=user.id, configuration={})
    db.add(project)
    await db.commit()
    return project


_PAYLOAD = {
    "session_id": "sess-1",
    "state_count": 2,
    "transition_count": 1,
    "global_state_count": 1,
    "modal_state_count": 0,
    "states": [
        {
            "id": "home",
            "name": "Home",
            "element_ids": ["a", "b"],
            "blocking": True,
            "metadata": {"confidence": 0.75, "is_global": True, "position_zone": "top"},
        },
        {"id": "detail", "element_ids": ["c"]},
    ],
    "transitions": [
        {
            "id": "open_detail",
            "from_states": ["home"],
            "activate_states": ["detail"],
            "exit_states": ["home"],
            "actions": [{"type": "click", "target": "a"}],
            "path_cost": 2.5,
            "stays_visible": True,
            "metadata": {
                "confidence": 0.5,
                "observation_count": 3,
                "is_bidirectional": True,
            },
        }
    ],
}
_EXPORT = {"presenceMatrix": [1, 2, 3], "allFingerprints": ["x", "y"]}


async def test_persist_writes_config_states_and_transitions(
    async_db_session: AsyncSession,
) -> None:
    db = async_db_session
    project = await _make_project(db)

    config_id = await _persist_result_to_pg(db, project.id, "rec", _PAYLOAD, _EXPORT)
    await db.commit()

    config = (
        await db.execute(
            select(UIBridgeStateConfig).where(UIBridgeStateConfig.id == config_id)
        )
    ).scalar_one()
    assert config.project_id == project.id
    assert config.name == "rec"
    assert config.description == "Auto-discovered from recording session sess-1"
    assert config.render_count == 3
    assert config.element_count == 2
    assert config.include_html_ids is False
    assert config.discovery_result == {
        "source": "recording_pipeline",
        "session_id": "sess-1",
        "state_count": 2,
        "transition_count": 1,
        "global_state_count": 1,
        "modal_state_count": 0,
    }

    states = {
        s.state_id: s
        for s in (
            await db.execute(
                select(UIBridgeState).where(UIBridgeState.config_id == config_id)
            )
        ).scalars()
    }
    assert set(states) == {"home", "detail"}
    home = states["home"]
    assert home.name == "Home"
    assert home.element_ids == ["a", "b"]
    assert home.render_ids == []
    assert home.confidence == 0.75
    assert home.acceptance_criteria == []
    assert home.extra_metadata == {
        "blocking": True,
        "is_global": True,
        "position_zone": "top",
        "source": "recording",
    }
    detail = states["detail"]
    assert detail.name == "detail"
    assert detail.confidence == 0.0
    assert detail.extra_metadata == {
        "blocking": False,
        "is_global": False,
        "position_zone": None,
        "source": "recording",
    }

    transition = (
        await db.execute(
            select(UIBridgeTransition).where(UIBridgeTransition.config_id == config_id)
        )
    ).scalar_one()
    assert transition.transition_id == "open_detail"
    assert transition.name == "open_detail"
    assert transition.from_states == ["home"]
    assert transition.activate_states == ["detail"]
    assert transition.exit_states == ["home"]
    assert transition.actions == [{"type": "click", "target": "a"}]
    assert transition.path_cost == 2.5
    assert transition.stays_visible is True
    assert transition.extra_metadata == {
        "confidence": 0.5,
        "observation_count": 3,
        "is_bidirectional": True,
        "source": "recording",
    }


async def test_persist_leaves_the_commit_to_the_caller(
    async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = async_db_session
    project = await _make_project(db)

    commits: list[None] = []

    async def _no_commit() -> None:
        commits.append(None)

    monkeypatch.setattr(db, "commit", _no_commit)
    await _persist_result_to_pg(db, project.id, "rec", _PAYLOAD, _EXPORT)

    assert commits == []
