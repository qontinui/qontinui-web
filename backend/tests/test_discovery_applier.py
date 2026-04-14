"""
Tests for the DiscoveryApplier service.

Tests the logic for applying accepted discoveries to project configurations.
"""

from uuid import uuid4

import pytest
import pytest_asyncio
from app.models.discovery import Discovery
from app.models.project import Project
from app.models.user import User
from app.services.discovery_applier import DiscoveryApplier
from sqlalchemy.ext.asyncio import AsyncSession


@pytest_asyncio.fixture
async def test_project(async_db_session: AsyncSession, test_user: User) -> Project:
    """Create a test project with initial configuration."""
    project = Project(
        id=uuid4(),
        name="Test Project",
        description="A test project",
        configuration={
            "states": {
                "state_1": {
                    "name": "Login Page",
                    "expected_elements": [
                        {"description": "username_field"},
                        {"description": "password_field"},
                    ],
                }
            },
            "transitions": [
                {
                    "id": "trans_1",
                    "from_state": "state_1",
                    "to_state": "state_2",
                    "expected_duration_ms": 500,
                }
            ],
        },
        owner_id=test_user.id,
    )
    async_db_session.add(project)
    await async_db_session.commit()
    await async_db_session.refresh(project)
    return project


@pytest_asyncio.fixture
async def new_element_discovery(
    async_db_session: AsyncSession, test_user: User, test_project: Project
) -> Discovery:
    """Create a discovery for a new element."""
    discovery = Discovery(
        id=uuid4(),
        user_id=test_user.id,
        project_id=test_project.id,
        runner_id="runner_1",
        config_id="config_1",
        discovery_type="new_element",
        title="New Submit Button Detected",
        description="A submit button was consistently detected in the Login Page state",
        discovery_data={
            "state_id": "state_1",
            "element_description": "submit_button",
            "element_data": {"x": 100, "y": 200},
        },
        evidence={"screenshots": ["screenshot_1.png"]},
        confidence=0.95,
        runs_observed=10,
        status="pending",
    )
    async_db_session.add(discovery)
    await async_db_session.commit()
    await async_db_session.refresh(discovery)
    return discovery


@pytest_asyncio.fixture
async def timing_update_discovery(
    async_db_session: AsyncSession, test_user: User, test_project: Project
) -> Discovery:
    """Create a discovery for a timing update."""
    discovery = Discovery(
        id=uuid4(),
        user_id=test_user.id,
        project_id=test_project.id,
        runner_id="runner_1",
        config_id="config_1",
        discovery_type="timing_update",
        title="Transition Duration Updated",
        description="Transition from state_1 to state_2 now takes longer",
        discovery_data={
            "transition_id": "trans_1",
            "observed_duration_ms": 1500,
        },
        evidence={"timing_samples": [1400, 1500, 1600]},
        confidence=0.90,
        runs_observed=5,
        status="pending",
    )
    async_db_session.add(discovery)
    await async_db_session.commit()
    await async_db_session.refresh(discovery)
    return discovery


@pytest_asyncio.fixture
async def new_transition_discovery(
    async_db_session: AsyncSession, test_user: User, test_project: Project
) -> Discovery:
    """Create a discovery for a new transition."""
    discovery = Discovery(
        id=uuid4(),
        user_id=test_user.id,
        project_id=test_project.id,
        runner_id="runner_1",
        config_id="config_1",
        discovery_type="new_transition",
        title="New Transition Path Discovered",
        description="A new path from state_2 to state_3 was discovered",
        discovery_data={
            "from_state_id": "state_2",
            "to_state_id": "state_3",
            "transition_name": "Go to Dashboard",
            "expected_duration_ms": 800,
        },
        evidence={"run_ids": ["run_1", "run_2"]},
        confidence=0.85,
        runs_observed=8,
        status="pending",
    )
    async_db_session.add(discovery)
    await async_db_session.commit()
    await async_db_session.refresh(discovery)
    return discovery


@pytest_asyncio.fixture
async def flaky_detection_discovery(
    async_db_session: AsyncSession, test_user: User, test_project: Project
) -> Discovery:
    """Create a discovery for flaky detection."""
    discovery = Discovery(
        id=uuid4(),
        user_id=test_user.id,
        project_id=test_project.id,
        runner_id="runner_1",
        config_id="config_1",
        discovery_type="flaky_detection",
        title="Flaky Transition Detected",
        description="Transition trans_1 has been failing intermittently",
        discovery_data={
            "item_type": "transition",
            "item_id": "trans_1",
            "success_rate": 0.75,
            "failure_count": 5,
            "total_runs": 20,
        },
        evidence={"failed_run_ids": ["run_3", "run_5", "run_8", "run_12", "run_17"]},
        confidence=0.92,
        runs_observed=20,
        status="pending",
    )
    async_db_session.add(discovery)
    await async_db_session.commit()
    await async_db_session.refresh(discovery)
    return discovery


class TestApplyNewElement:
    """Tests for applying new element discoveries."""

    @pytest.mark.asyncio
    async def test_apply_new_element_success(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
        new_element_discovery: Discovery,
    ):
        """Test successfully applying a new element discovery."""
        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=new_element_discovery,
            user_id=test_user.id,
            create_version_snapshot=False,  # Skip snapshot for simpler test
        )

        assert result is True

        # Refresh project to get updated configuration
        await async_db_session.refresh(test_project)

        # Verify the element was added
        state = test_project.configuration["states"]["state_1"]
        element_descriptions = [e["description"] for e in state["expected_elements"]]
        assert "submit_button" in element_descriptions

    @pytest.mark.asyncio
    async def test_apply_new_element_creates_state_if_needed(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
    ):
        """Test that applying a new element creates the state if it doesn't exist."""
        discovery = Discovery(
            id=uuid4(),
            user_id=test_user.id,
            project_id=test_project.id,
            runner_id="runner_1",
            config_id="config_1",
            discovery_type="new_element",
            title="Element in New State",
            discovery_data={
                "state_id": "new_state",
                "element_description": "new_element",
            },
            evidence={},
            confidence=0.9,
            runs_observed=5,
            status="pending",
        )
        async_db_session.add(discovery)
        await async_db_session.commit()

        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is True

        await async_db_session.refresh(test_project)
        assert "new_state" in test_project.configuration["states"]
        assert (
            len(test_project.configuration["states"]["new_state"]["expected_elements"])
            == 1
        )

    @pytest.mark.asyncio
    async def test_apply_duplicate_element_is_idempotent(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
        new_element_discovery: Discovery,
    ):
        """Test that applying the same element twice doesn't create duplicates."""
        # Apply first time
        await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=new_element_discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        await async_db_session.refresh(test_project)
        count_before = len(
            test_project.configuration["states"]["state_1"]["expected_elements"]
        )

        # Apply second time
        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=new_element_discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is True

        await async_db_session.refresh(test_project)
        count_after = len(
            test_project.configuration["states"]["state_1"]["expected_elements"]
        )
        assert count_after == count_before


class TestApplyTimingUpdate:
    """Tests for applying timing update discoveries."""

    @pytest.mark.asyncio
    async def test_apply_timing_update_success(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
        timing_update_discovery: Discovery,
    ):
        """Test successfully applying a timing update discovery."""
        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=timing_update_discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is True

        await async_db_session.refresh(test_project)

        # Verify the timing was updated
        transition = test_project.configuration["transitions"][0]
        assert transition["expected_duration_ms"] == 1500
        assert "timing_updated_from_discovery" in transition


class TestApplyNewTransition:
    """Tests for applying new transition discoveries."""

    @pytest.mark.asyncio
    async def test_apply_new_transition_success(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
        new_transition_discovery: Discovery,
    ):
        """Test successfully applying a new transition discovery."""
        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=new_transition_discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is True

        await async_db_session.refresh(test_project)

        # Verify the transition was added
        transitions = test_project.configuration["transitions"]
        assert len(transitions) == 2

        new_trans = [t for t in transitions if t.get("from_state") == "state_2"]
        assert len(new_trans) == 1
        assert new_trans[0]["to_state"] == "state_3"
        assert new_trans[0]["name"] == "Go to Dashboard"


class TestApplyFlakyDetection:
    """Tests for applying flaky detection discoveries."""

    @pytest.mark.asyncio
    async def test_apply_flaky_detection_success(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
        flaky_detection_discovery: Discovery,
    ):
        """Test successfully applying a flaky detection discovery."""
        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=flaky_detection_discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is True

        await async_db_session.refresh(test_project)

        # Verify flaky metadata was added
        flaky_items = test_project.configuration["flaky_items"]
        assert "transition" in flaky_items
        assert "trans_1" in flaky_items["transition"]
        assert flaky_items["transition"]["trans_1"]["success_rate"] == 0.75


class TestInvalidDiscoveries:
    """Tests for handling invalid discoveries."""

    @pytest.mark.asyncio
    async def test_apply_unknown_type_returns_false(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
    ):
        """Test that an unknown discovery type returns False."""
        discovery = Discovery(
            id=uuid4(),
            user_id=test_user.id,
            project_id=test_project.id,
            runner_id="runner_1",
            config_id="config_1",
            discovery_type="unknown_type",  # Invalid type
            title="Unknown Discovery",
            discovery_data={},
            evidence={},
            confidence=0.9,
            runs_observed=5,
            status="pending",
        )
        async_db_session.add(discovery)
        await async_db_session.commit()

        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is False

    @pytest.mark.asyncio
    async def test_apply_missing_required_fields_returns_false(
        self,
        async_db_session: AsyncSession,
        test_user: User,
        test_project: Project,
    ):
        """Test that missing required fields returns False."""
        discovery = Discovery(
            id=uuid4(),
            user_id=test_user.id,
            project_id=test_project.id,
            runner_id="runner_1",
            config_id="config_1",
            discovery_type="new_element",
            title="Missing Fields Discovery",
            discovery_data={
                # Missing state_id and element_description
            },
            evidence={},
            confidence=0.9,
            runs_observed=5,
            status="pending",
        )
        async_db_session.add(discovery)
        await async_db_session.commit()

        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is False

    @pytest.mark.asyncio
    async def test_apply_nonexistent_project_returns_false(
        self,
        async_db_session: AsyncSession,
        test_user: User,
    ):
        """Test that a discovery with nonexistent project returns False."""
        discovery = Discovery(
            id=uuid4(),
            user_id=test_user.id,
            project_id=uuid4(),  # Nonexistent project
            runner_id="runner_1",
            config_id="config_1",
            discovery_type="new_element",
            title="Orphan Discovery",
            discovery_data={
                "state_id": "state_1",
                "element_description": "some_element",
            },
            evidence={},
            confidence=0.9,
            runs_observed=5,
            status="pending",
        )
        async_db_session.add(discovery)
        await async_db_session.commit()

        result = await DiscoveryApplier.apply_discovery(
            db=async_db_session,
            discovery=discovery,
            user_id=test_user.id,
            create_version_snapshot=False,
        )

        assert result is False
