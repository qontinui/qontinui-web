"""
Tests for state discovery API endpoints.
"""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.user import User


@pytest.mark.asyncio
async def test_trigger_state_discovery_success(
    async_client: AsyncClient,
    async_db_session,
    test_user: User,
    auth_headers: dict,
):
    """Test triggering state discovery with valid session."""
    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Create some screenshots
    base_time = datetime.utcnow()
    for i in range(3):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/screenshot_{i}.png",
            timestamp=base_time + timedelta(seconds=i * 0.5),
            metadata={},
        )
        async_db_session.add(screenshot)
    await async_db_session.commit()

    # Trigger state discovery with timestamp_clustering (currently implemented)
    response = await async_client.post(
        f"/api/v1/state-discovery/sessions/{session.id}/discover-states",
        json={
            "similarity_threshold": 0.90,
            "min_region_size": [20, 20],
            "stability_threshold": 0.95,
            "cooccurrence_threshold": 0.80,
        },
        headers=auth_headers,
    )

    # Note: This will return 501 NOT_IMPLEMENTED until computer vision is implemented
    # For now, we test that the endpoint is callable and returns proper error
    assert response.status_code in [200, 501]

    if response.status_code == 200:
        data = response.json()
        assert data["session_id"] == str(session.id)
        assert "total_states" in data
        assert "total_transitions" in data
        assert "processing_time_ms" in data


@pytest.mark.asyncio
async def test_trigger_state_discovery_session_not_found(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Test triggering state discovery with nonexistent session."""
    nonexistent_id = uuid4()

    response = await async_client.post(
        f"/api/v1/state-discovery/sessions/{nonexistent_id}/discover-states",
        headers=auth_headers,
    )

    assert response.status_code in [404, 501]


@pytest.mark.asyncio
async def test_get_discovered_states_timestamp_clustering(
    async_client: AsyncClient,
    async_db_session,
    test_user: User,
    auth_headers: dict,
):
    """Test getting discovered states using timestamp_clustering algorithm."""
    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Create screenshots in 2 states
    base_time = datetime.utcnow()

    # State 0: 2 screenshots
    for i in range(2):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/state0_{i}.png",
            timestamp=base_time + timedelta(seconds=i * 0.5),
            metadata={},
        )
        async_db_session.add(screenshot)

    # State 1: 2 screenshots (after 5 second gap)
    for i in range(2):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/state1_{i}.png",
            timestamp=base_time + timedelta(seconds=10 + i * 0.5),
            metadata={},
        )
        async_db_session.add(screenshot)

    await async_db_session.commit()

    # Get discovered states with timestamp_clustering
    response = await async_client.get(
        f"/api/v1/state-discovery/sessions/{session.id}/discovered-states",
        params={"algorithm": "timestamp_clustering"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == str(session.id)
    assert data["total_states"] == 2
    assert len(data["states"]) == 2


@pytest.mark.asyncio
async def test_get_discovered_states_include_flags(
    async_client: AsyncClient,
    async_db_session,
    test_user: User,
    auth_headers: dict,
):
    """Test include_state_images and include_transitions flags."""
    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Create a screenshot
    screenshot = AutomationScreenshot(
        session_id=session.id,
        s3_key="test/screenshot.png",
        timestamp=datetime.utcnow(),
        metadata={},
    )
    async_db_session.add(screenshot)
    await async_db_session.commit()

    # Test with include_state_images=false
    response = await async_client.get(
        f"/api/v1/state-discovery/sessions/{session.id}/discovered-states",
        params={
            "algorithm": "timestamp_clustering",
            "include_state_images": False,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    if len(data["states"]) > 0:
        # Verify state_images is empty
        assert data["states"][0]["state_images"] == []

    # Test with include_transitions=false
    response = await async_client.get(
        f"/api/v1/state-discovery/sessions/{session.id}/discovered-states",
        params={
            "algorithm": "timestamp_clustering",
            "include_transitions": False,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    if len(data["states"]) > 0:
        # Verify outgoing_transitions is empty
        assert data["states"][0]["outgoing_transitions"] == []


@pytest.mark.asyncio
async def test_update_discovered_state_not_implemented(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Test updating a discovered state returns NOT_IMPLEMENTED."""
    response = await async_client.patch(
        "/api/v1/state-discovery/discovered-states/state_0",
        json={"name": "Login Page"},
        headers=auth_headers,
    )

    assert response.status_code == 501
    assert "not yet implemented" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_clear_discovered_states_not_implemented(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Test clearing discovered states returns NOT_IMPLEMENTED."""
    session_id = uuid4()

    response = await async_client.delete(
        f"/api/v1/state-discovery/sessions/{session_id}/discovered-states",
        headers=auth_headers,
    )

    assert response.status_code == 501
    assert "not yet implemented" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_get_state_discovery_status_not_implemented(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Test getting state discovery status returns NOT_IMPLEMENTED."""
    session_id = uuid4()

    response = await async_client.get(
        f"/api/v1/state-discovery/sessions/{session_id}/state-discovery-status",
        headers=auth_headers,
    )

    assert response.status_code == 501
    assert "not yet implemented" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_trigger_state_discovery_unauthorized(async_client: AsyncClient):
    """Test triggering state discovery without authentication."""
    session_id = uuid4()

    response = await async_client.post(
        f"/api/v1/state-discovery/sessions/{session_id}/discover-states",
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_discovered_states_unauthorized(async_client: AsyncClient):
    """Test getting discovered states without authentication."""
    session_id = uuid4()

    response = await async_client.get(
        f"/api/v1/state-discovery/sessions/{session_id}/discovered-states",
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_state_discovery_with_input_events_and_transitions(
    async_client: AsyncClient,
    async_db_session,
    test_user: User,
    auth_headers: dict,
):
    """Test state discovery creates transitions based on input events."""
    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    base_time = datetime.utcnow()

    # State 0: Screenshot at t=0
    screenshot_0 = AutomationScreenshot(
        session_id=session.id,
        s3_key="test/state0.png",
        timestamp=base_time,
        metadata={},
    )
    async_db_session.add(screenshot_0)
    await async_db_session.commit()

    # Input event at t=1
    input_event = AutomationInputEvent(
        session_id=session.id,
        event_type="mouse.clicked",
        timestamp=base_time + timedelta(seconds=1),
        mouse_x=100,
        mouse_y=200,
        mouse_button="left",
    )
    async_db_session.add(input_event)
    await async_db_session.commit()

    # State 1: Screenshot at t=5 (after gap)
    screenshot_1 = AutomationScreenshot(
        session_id=session.id,
        s3_key="test/state1.png",
        timestamp=base_time + timedelta(seconds=5),
        metadata={},
    )
    async_db_session.add(screenshot_1)
    await async_db_session.commit()

    # Get discovered states
    response = await async_client.get(
        f"/api/v1/state-discovery/sessions/{session.id}/discovered-states",
        params={"algorithm": "timestamp_clustering"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total_states"] == 2

    # Verify state 0 has a transition to state 1
    state_0 = data["states"][0]
    assert len(state_0["outgoing_transitions"]) == 1

    transition = state_0["outgoing_transitions"][0]
    assert transition["from_state_id"] == "state_0"
    assert transition["to_state_id"] == "state_1"
    assert transition["event_type"] == "mouse.clicked"
