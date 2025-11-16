"""
Tests for state discovery service and endpoints.
"""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.user import User
from app.services.state_discovery_service import state_discovery_service


@pytest.mark.asyncio
async def test_discover_states_empty_session(async_db_session):
    """Test state discovery with a session that has no screenshots."""
    # Create test user
    user = User(
        email="test@example.com",
        username="testuser",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create automation session without screenshots
    session = AutomationSession(
        id=uuid4(),
        user_id=user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Discover states
    result = await state_discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
    )

    # Verify result
    assert result.session_id == session.id
    assert result.total_states == 0
    assert result.total_transitions == 0
    assert len(result.states) == 0
    assert result.algorithm == "timestamp_clustering"


@pytest.mark.asyncio
async def test_discover_states_single_state(async_db_session):
    """Test state discovery with screenshots in a single state (no gaps)."""
    # Create test user
    user = User(
        email="test2@example.com",
        username="testuser2",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Create screenshots with small time gaps (< 2 seconds)
    base_time = datetime.utcnow()
    screenshots = []
    for i in range(5):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/screenshot_{i}.png",
            timestamp=base_time + timedelta(seconds=i * 0.5),  # 0.5 second gaps
            metadata={},
        )
        screenshots.append(screenshot)
        async_db_session.add(screenshot)

    await async_db_session.commit()

    # Discover states
    result = await state_discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
    )

    # Verify result
    assert result.total_states == 1
    assert result.total_transitions == 0
    assert len(result.states) == 1

    state = result.states[0]
    assert state.state_id == "state_0"
    assert len(state.screenshot_ids) == 5
    assert state.visit_count == 1
    assert state.representative_screenshot_id == screenshots[0].id


@pytest.mark.asyncio
async def test_discover_states_multiple_states(async_db_session):
    """Test state discovery with multiple states separated by time gaps."""
    # Create test user
    user = User(
        email="test3@example.com",
        username="testuser3",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Create screenshots in 3 distinct states
    base_time = datetime.utcnow()

    # State 0: 3 screenshots
    for i in range(3):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/state0_{i}.png",
            timestamp=base_time + timedelta(seconds=i * 0.5),
            metadata={},
        )
        async_db_session.add(screenshot)

    # Gap of 5 seconds (> threshold of 2)

    # State 1: 2 screenshots
    for i in range(2):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/state1_{i}.png",
            timestamp=base_time + timedelta(seconds=10 + i * 0.5),
            metadata={},
        )
        async_db_session.add(screenshot)

    # Gap of 4 seconds

    # State 2: 4 screenshots
    for i in range(4):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/state2_{i}.png",
            timestamp=base_time + timedelta(seconds=20 + i * 0.5),
            metadata={},
        )
        async_db_session.add(screenshot)

    await async_db_session.commit()

    # Discover states
    result = await state_discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
    )

    # Verify result
    assert result.total_states == 3
    assert len(result.states) == 3

    # Verify state 0
    state0 = result.states[0]
    assert state0.state_id == "state_0"
    assert len(state0.screenshot_ids) == 3

    # Verify state 1
    state1 = result.states[1]
    assert state1.state_id == "state_1"
    assert len(state1.screenshot_ids) == 2

    # Verify state 2
    state2 = result.states[2]
    assert state2.state_id == "state_2"
    assert len(state2.screenshot_ids) == 4


@pytest.mark.asyncio
async def test_discover_states_with_input_events(async_db_session):
    """Test state discovery with input events creating transitions."""
    # Create test user
    user = User(
        email="test4@example.com",
        username="testuser4",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=user.id,
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
    await async_db_session.refresh(screenshot_0)

    # Input event at t=1 (within state 0)
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
    await async_db_session.refresh(input_event)

    # State 1: Screenshot at t=5 (after gap)
    screenshot_1 = AutomationScreenshot(
        session_id=session.id,
        s3_key="test/state1.png",
        timestamp=base_time + timedelta(seconds=5),
        metadata={},
    )
    async_db_session.add(screenshot_1)
    await async_db_session.commit()

    # Discover states
    result = await state_discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
    )

    # Verify result
    assert result.total_states == 2
    assert len(result.states) == 2

    # Verify state 0 contains the input event
    state0 = result.states[0]
    assert len(state0.input_events) == 1
    assert input_event.id in state0.input_events

    # Verify transition from state 0 to state 1
    assert len(state0.outgoing_transitions) == 1
    transition = state0.outgoing_transitions[0]
    assert transition.from_state_id == "state_0"
    assert transition.to_state_id == "state_1"
    assert transition.trigger_event_id == input_event.id
    assert transition.event_type == "mouse.clicked"


@pytest.mark.asyncio
async def test_discover_states_custom_parameters(async_db_session):
    """Test state discovery with custom algorithm parameters."""
    # Create test user
    user = User(
        email="test5@example.com",
        username="testuser5",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    base_time = datetime.utcnow()

    # Create screenshots with 1.5 second gaps
    for i in range(4):
        screenshot = AutomationScreenshot(
            session_id=session.id,
            s3_key=f"test/screenshot_{i}.png",
            timestamp=base_time + timedelta(seconds=i * 1.5),
            metadata={},
        )
        async_db_session.add(screenshot)

    await async_db_session.commit()

    # Test with default threshold (2.0 seconds) - should be 1 state
    result_default = await state_discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
        parameters={"state_threshold_seconds": 2.0},
    )
    assert result_default.total_states == 1

    # Test with lower threshold (1.0 seconds) - should be 4 states
    result_custom = await state_discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
        parameters={"state_threshold_seconds": 1.0},
    )
    assert result_custom.total_states == 4


@pytest.mark.asyncio
async def test_discover_states_nonexistent_session(async_db_session):
    """Test state discovery with nonexistent session ID."""
    nonexistent_id = uuid4()

    with pytest.raises(ValueError, match="Session .* not found"):
        await state_discovery_service.discover_states_from_session(
            session_id=nonexistent_id,
            db=async_db_session,
        )


@pytest.mark.asyncio
async def test_discover_states_processing_time(async_db_session):
    """Test that processing time is tracked and returned."""
    # Create test user
    user = User(
        email="test6@example.com",
        username="testuser6",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    # Create automation session
    session = AutomationSession(
        id=uuid4(),
        user_id=user.id,
        workflow_name="Test Workflow",
        status="completed",
        started_at=datetime.utcnow(),
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Discover states
    result = await state_discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
    )

    # Verify processing time is tracked
    assert result.processing_time_ms is not None
    assert result.processing_time_ms >= 0
    assert result.processing_time_ms < 5000  # Should complete in under 5 seconds
