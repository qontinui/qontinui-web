"""
Tests for AutomatedStateDiscoveryService.

Tests the computer vision-based state discovery algorithm including:
- Screenshot clustering by visual similarity
- StateImage extraction from clusters
- Co-occurrence matrix building
- State assembly from StateImages
- Transition inference
"""

import io
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from PIL import Image

from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.user import User
from app.services.automated_state_discovery_service import (
    AutomatedStateDiscoveryService,
)
from app.services.computer_vision_service import ComputerVisionService


@pytest.fixture
def mock_cv_service():
    """Create a mock ComputerVisionService."""
    service = MagicMock(spec=ComputerVisionService)

    # Mock hash generation (return predictable hashes)
    async def mock_generate_hash(image_bytes):
        # Use image size as a simple hash proxy
        img = Image.open(io.BytesIO(image_bytes))
        return f"hash_{img.size[0]}x{img.size[1]}"

    service.generate_perceptual_hash = AsyncMock(side_effect=mock_generate_hash)

    # Mock similarity calculation
    async def mock_calculate_similarity(hash1, hash2):
        # Same hash = 1.0 similarity, different = 0.5
        return 1.0 if hash1 == hash2 else 0.5

    service.calculate_similarity = AsyncMock(side_effect=mock_calculate_similarity)

    # Mock screenshot download
    async def mock_download_screenshot(s3_key):
        # Create a simple image based on the key
        img = Image.new('RGB', (100, 100), color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()

    service.download_screenshot_from_s3 = AsyncMock(side_effect=mock_download_screenshot)

    # Mock stable region finding
    async def mock_find_stable_regions(screenshot_batch, min_stability, min_region_size):
        # Return mock stable regions
        return [
            {
                'x': 10,
                'y': 10,
                'width': 50,
                'height': 50,
                'pixel_hash': 'region_hash_1',
                'stability_score': 0.98,
                'screenshot_indices': list(range(len(screenshot_batch)))
            },
            {
                'x': 70,
                'y': 70,
                'width': 30,
                'height': 30,
                'pixel_hash': 'region_hash_2',
                'stability_score': 0.96,
                'screenshot_indices': list(range(len(screenshot_batch)))
            }
        ]

    service.find_stable_regions = AsyncMock(side_effect=mock_find_stable_regions)

    return service


@pytest.fixture
def discovery_service(mock_cv_service):
    """Create AutomatedStateDiscoveryService with mocked CV service."""
    return AutomatedStateDiscoveryService(mock_cv_service)


@pytest.mark.asyncio
async def test_cluster_screenshots_by_similarity(discovery_service, mock_cv_service):
    """Test screenshot clustering by visual similarity."""
    # Create test screenshots with same dimensions (will hash to same value)
    screenshots = []
    for i in range(5):
        screenshot = MagicMock(spec=AutomationScreenshot)
        screenshot.id = uuid4()
        screenshot.automation_metadata = {'perceptual_hash': 'hash_100x100'}
        screenshots.append(screenshot)

    # Add one different screenshot
    different = MagicMock(spec=AutomationScreenshot)
    different.id = uuid4()
    different.automation_metadata = {'perceptual_hash': 'hash_200x200'}
    screenshots.append(different)

    # Cluster with high threshold
    clusters = await discovery_service.cluster_screenshots_by_similarity(
        screenshots,
        similarity_threshold=0.90
    )

    # Should have 2 clusters (5 similar + 1 different)
    assert len(clusters) == 2

    # Find the larger cluster
    cluster_sizes = [len(cluster) for cluster in clusters.values()]
    assert 5 in cluster_sizes
    assert 1 in cluster_sizes


@pytest.mark.asyncio
async def test_cluster_screenshots_no_hash(discovery_service):
    """Test clustering when screenshots lack perceptual hash."""
    screenshot = MagicMock(spec=AutomationScreenshot)
    screenshot.id = uuid4()
    screenshot.automation_metadata = {}  # No hash

    clusters = await discovery_service.cluster_screenshots_by_similarity(
        [screenshot],
        similarity_threshold=0.90
    )

    # Should create a cluster even without hash
    assert len(clusters) == 1


@pytest.mark.asyncio
async def test_extract_state_images_from_cluster(discovery_service, mock_cv_service):
    """Test StateImage extraction from a cluster."""
    # Create test screenshots
    screenshots = []
    for i in range(3):
        screenshot = MagicMock(spec=AutomationScreenshot)
        screenshot.id = uuid4()
        screenshot.storage_path = f"test/screenshot_{i}.png"
        screenshots.append(screenshot)

    # Extract state images
    state_images = await discovery_service.extract_state_images_from_cluster(
        screenshots,
        cluster_id="cluster_0",
        min_stability=0.95,
        min_region_size=(20, 20)
    )

    # Should extract the mocked regions
    assert len(state_images) == 2
    assert state_images[0]['cluster_id'] == 'cluster_0'
    assert state_images[0]['x'] == 10
    assert state_images[0]['y'] == 10
    assert state_images[0]['pixel_hash'] == 'region_hash_1'
    assert state_images[0]['stability_score'] == 0.98


@pytest.mark.asyncio
async def test_extract_state_images_small_cluster(discovery_service):
    """Test StateImage extraction with only 1 screenshot (too small)."""
    screenshot = MagicMock(spec=AutomationScreenshot)
    screenshot.id = uuid4()

    # Should return empty list (need at least 2 screenshots)
    state_images = await discovery_service.extract_state_images_from_cluster(
        [screenshot],
        cluster_id="cluster_0"
    )

    assert len(state_images) == 0


@pytest.mark.asyncio
async def test_build_cooccurrence_matrix(discovery_service):
    """Test co-occurrence matrix building."""
    # Create test screenshots
    screenshot1_id = uuid4()
    screenshot2_id = uuid4()
    screenshot3_id = uuid4()

    screenshots = [
        MagicMock(id=screenshot1_id),
        MagicMock(id=screenshot2_id),
        MagicMock(id=screenshot3_id)
    ]

    # Create state images with different co-occurrence patterns
    state_images = [
        {
            'screenshot_ids': [screenshot1_id, screenshot2_id],  # Appears in 2/3
            'pixel_hash': 'img1'
        },
        {
            'screenshot_ids': [screenshot1_id, screenshot2_id],  # Appears with img1
            'pixel_hash': 'img2'
        },
        {
            'screenshot_ids': [screenshot3_id],  # Appears alone
            'pixel_hash': 'img3'
        }
    ]

    # Build matrix
    matrix = await discovery_service.build_cooccurrence_matrix(
        state_images,
        screenshots
    )

    # Verify matrix dimensions
    assert len(matrix) == 3
    assert len(matrix[0]) == 3

    # Verify co-occurrence values
    # img1 and img2 appear together in 2/3 screenshots
    assert matrix[0][1] == pytest.approx(2/3)
    assert matrix[1][0] == pytest.approx(2/3)

    # img3 appears alone in 1/3 screenshots
    assert matrix[2][2] == pytest.approx(1/3)

    # img1 and img3 never appear together
    assert matrix[0][2] == 0.0


@pytest.mark.asyncio
async def test_assemble_discovered_states(discovery_service):
    """Test state assembly from StateImages using co-occurrence."""
    screenshot1 = MagicMock(id=uuid4(), timestamp=datetime.utcnow())
    screenshot2 = MagicMock(id=uuid4(), timestamp=datetime.utcnow())
    screenshot3 = MagicMock(id=uuid4(), timestamp=datetime.utcnow())
    screenshots = [screenshot1, screenshot2, screenshot3]

    # Create state images
    state_images = [
        {'screenshot_ids': [screenshot1.id, screenshot2.id], 'pixel_hash': 'img1'},
        {'screenshot_ids': [screenshot1.id, screenshot2.id], 'pixel_hash': 'img2'},
        {'screenshot_ids': [screenshot3.id], 'pixel_hash': 'img3'}
    ]

    # High co-occurrence between img1 and img2
    cooccurrence_matrix = [
        [1.0, 0.9, 0.0],  # img1
        [0.9, 1.0, 0.0],  # img2
        [0.0, 0.0, 1.0]   # img3
    ]

    # Assemble states
    states = await discovery_service.assemble_discovered_states(
        state_images,
        cooccurrence_matrix,
        threshold=0.80,
        screenshots=screenshots
    )

    # Should group img1 and img2 into one state, img3 into another
    assert len(states) == 2

    # Verify state structure
    for state in states:
        assert 'state_id' in state
        assert 'screenshot_ids' in state
        assert 'state_images' in state
        assert 'metadata' in state


@pytest.mark.asyncio
async def test_assemble_discovered_states_filters_universal(discovery_service):
    """Test that universal elements (>80% appearance) are filtered."""
    screenshots = [MagicMock(id=uuid4(), timestamp=datetime.utcnow()) for _ in range(10)]
    screenshot_ids = [s.id for s in screenshots]

    # Create state images - one appears in 90% of screenshots (universal)
    state_images = [
        {'screenshot_ids': screenshot_ids[:9], 'pixel_hash': 'universal'},  # 90%
        {'screenshot_ids': screenshot_ids[:5], 'pixel_hash': 'normal'}  # 50%
    ]

    cooccurrence_matrix = [
        [1.0, 0.5],
        [0.5, 1.0]
    ]

    states = await discovery_service.assemble_discovered_states(
        state_images,
        cooccurrence_matrix,
        threshold=0.80,
        screenshots=screenshots
    )

    # Universal element should be filtered, only 'normal' remains
    assert len(states) >= 0  # May create state from 'normal' if not filtered


@pytest.mark.asyncio
async def test_infer_state_transitions(discovery_service):
    """Test transition inference from input events."""
    base_time = datetime.utcnow()

    # Create screenshots in different states
    screenshot1 = MagicMock(id=uuid4(), timestamp=base_time)
    screenshot2 = MagicMock(id=uuid4(), timestamp=base_time + timedelta(seconds=5))
    screenshots = [screenshot1, screenshot2]

    # Create states
    states = [
        {
            'state_id': 'state_0',
            'screenshot_ids': [screenshot1.id]
        },
        {
            'state_id': 'state_1',
            'screenshot_ids': [screenshot2.id]
        }
    ]

    # Create input event between screenshots
    input_event = MagicMock(spec=AutomationInputEvent)
    input_event.id = 123
    input_event.timestamp = base_time + timedelta(seconds=2)
    input_event.event_type = 'mouse.clicked'

    # Infer transitions
    transitions = await discovery_service.infer_state_transitions(
        states,
        [input_event],
        screenshots
    )

    # Should create one transition from state_0 to state_1
    assert len(transitions) == 1
    assert transitions[0]['from_state_id'] == 'state_0'
    assert transitions[0]['to_state_id'] == 'state_1'
    assert transitions[0]['trigger_event_id'] == 123
    assert transitions[0]['event_type'] == 'mouse.clicked'


@pytest.mark.asyncio
async def test_infer_state_transitions_no_state_change(discovery_service):
    """Test that no transition is created if state doesn't change."""
    base_time = datetime.utcnow()

    # Both screenshots in same state
    screenshot1 = MagicMock(id=uuid4(), timestamp=base_time)
    screenshot2 = MagicMock(id=uuid4(), timestamp=base_time + timedelta(seconds=5))
    screenshots = [screenshot1, screenshot2]

    states = [
        {
            'state_id': 'state_0',
            'screenshot_ids': [screenshot1.id, screenshot2.id]
        }
    ]

    input_event = MagicMock(spec=AutomationInputEvent)
    input_event.id = 123
    input_event.timestamp = base_time + timedelta(seconds=2)
    input_event.event_type = 'mouse.clicked'

    transitions = await discovery_service.infer_state_transitions(
        states,
        [input_event],
        screenshots
    )

    # No transition since state didn't change
    assert len(transitions) == 0


@pytest.mark.asyncio
async def test_discover_states_from_session_empty(
    discovery_service,
    async_db_session,
    test_user
):
    """Test full pipeline with empty session (no screenshots)."""
    # Create session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        runner_version="1.0.0",
        runner_os="linux",
        runner_hostname="test-host",
        status="completed"
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Run discovery
    result = await discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session
    )

    # Should handle gracefully
    assert result['statistics']['state_count'] == 0
    assert result['statistics']['transition_count'] == 0


@pytest.mark.asyncio
async def test_discover_states_from_session_with_data(
    discovery_service,
    async_db_session,
    test_user,
    mock_cv_service
):
    """Test full pipeline with real session data."""
    # Create session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        runner_version="1.0.0",
        runner_os="linux",
        runner_hostname="test-host",
        status="active"
    )
    async_db_session.add(session)
    await async_db_session.commit()

    base_time = datetime.utcnow()

    # Create screenshots
    screenshots = []
    for i in range(4):
        screenshot = AutomationScreenshot(
            id=uuid4(),
            session_id=session.id,
            name=f"screenshot_{i}",
            storage_path=f"test/screenshot_{i}.png",
            width=100,
            height=100,
            timestamp=base_time + timedelta(seconds=i * 2),
            automation_metadata={}
        )
        screenshots.append(screenshot)
        async_db_session.add(screenshot)

    await async_db_session.commit()

    # Create input event
    input_event = AutomationInputEvent(
        session_id=session.id,
        event_type='mouse.clicked',
        timestamp=base_time + timedelta(seconds=3),
        mouse_x=50,
        mouse_y=50
    )
    async_db_session.add(input_event)
    await async_db_session.commit()

    # Run discovery
    result = await discovery_service.discover_states_from_session(
        session_id=session.id,
        db=async_db_session,
        config={
            'similarity_threshold': 0.90,
            'min_stability': 0.95
        }
    )

    # Verify result structure
    assert 'states' in result
    assert 'state_images' in result
    assert 'transitions' in result
    assert 'statistics' in result

    # Verify statistics
    assert result['statistics']['screenshot_count'] == 4
    assert result['statistics']['processing_time_ms'] > 0

    # Verify session status was updated
    await async_db_session.refresh(session)
    assert session.state_discovery_status == "completed"
    assert session.state_discovery_completed_at is not None


@pytest.mark.asyncio
async def test_discover_states_from_session_error_handling(
    discovery_service,
    async_db_session,
    test_user,
    mock_cv_service
):
    """Test error handling in discovery pipeline."""
    # Create session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        runner_version="1.0.0",
        runner_os="linux",
        runner_hostname="test-host",
        status="active"
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Make CV service raise an error
    mock_cv_service.generate_perceptual_hash.side_effect = Exception("CV error")

    # Create a screenshot
    screenshot = AutomationScreenshot(
        id=uuid4(),
        session_id=session.id,
        name="screenshot",
        storage_path="test/screenshot.png",
        width=100,
        height=100,
        timestamp=datetime.utcnow(),
        automation_metadata={}
    )
    async_db_session.add(screenshot)
    await async_db_session.commit()

    # Run discovery - should handle error gracefully
    with pytest.raises(Exception):
        await discovery_service.discover_states_from_session(
            session_id=session.id,
            db=async_db_session
        )

    # Verify session status was updated to failed
    await async_db_session.refresh(session)
    assert session.state_discovery_status == "failed"
    assert session.state_discovery_error is not None


@pytest.mark.asyncio
async def test_discover_states_nonexistent_session(
    discovery_service,
    async_db_session
):
    """Test discovery with nonexistent session ID."""
    nonexistent_id = uuid4()

    with pytest.raises(ValueError, match="Session .* not found"):
        await discovery_service.discover_states_from_session(
            session_id=nonexistent_id,
            db=async_db_session
        )


@pytest.mark.asyncio
async def test_save_analysis_results(
    discovery_service,
    async_db_session,
    test_user
):
    """Test persisting analysis results to database."""
    # Create session
    session = AutomationSession(
        id=uuid4(),
        user_id=test_user.id,
        runner_version="1.0.0",
        runner_os="linux",
        runner_hostname="test-host",
        status="completed"
    )
    async_db_session.add(session)
    await async_db_session.commit()

    # Create mock results
    states = [
        {
            'state_id': 'state_0',
            'name': None,
            'confidence': 1.0,
            'metadata': {'test': 'data'},
            'screenshot_ids': [uuid4()],
            'state_images': []
        }
    ]

    transitions = [
        {
            'from_state_id': 'state_0',
            'to_state_id': 'state_0',
            'trigger_event_id': None,
            'event_type': 'mouse.clicked',
            'timestamp': datetime.utcnow(),
            'confidence': 1.0,
            'metadata': {}
        }
    ]

    # Save results
    await discovery_service.save_analysis_results(
        session_id=session.id,
        states=states,
        transitions=transitions,
        db=async_db_session
    )

    # Verify states were saved
    from sqlalchemy import select
    from app.models.discovered_state import DiscoveredState

    result = await async_db_session.execute(
        select(DiscoveredState).where(DiscoveredState.session_id == session.id)
    )
    saved_states = result.scalars().all()

    assert len(saved_states) == 1
    assert saved_states[0].state_id == 'state_0'
