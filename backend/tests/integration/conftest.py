"""
Pytest fixtures for integration testing module.

Provides fixtures for creating test data, database sessions,
and helper utilities for testing the complete testing system.
"""

import os
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

# Set test environment
os.environ["TESTING"] = "1"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"

from app.db.base import Base
from app.models.project import Project
from app.models.runner_connection import RunnerConnection
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import (
    DeficiencySeverity,
    DeficiencyStatus,
    DeficiencyType,
    TestDeficiency,
)
from app.models.user import User


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Create an async database session for testing.
    Uses in-memory SQLite for fast, isolated tests.
    """
    # Create async engine with in-memory SQLite
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=NullPool,
        echo=False,
    )

    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create session factory
    async_session_maker = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    # Yield session
    async with async_session_maker() as session:
        yield session

    # Cleanup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user in the database."""
    user = User(
        id=uuid4(),
        email=f"testuser_{uuid4().hex[:8]}@example.com",
        username=f"testuser_{uuid4().hex[:8]}",
        full_name="Test User",
        hashed_password="hashed_password",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture(scope="function")
async def test_project(db_session: AsyncSession, test_user: User) -> Project:
    """Create a test project in the database."""
    project = Project(
        name=f"Test Project {uuid4().hex[:8]}",
        description="Test project for integration tests",
        owner_id=test_user.id,
        is_public=False,
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project


@pytest_asyncio.fixture(scope="function")
async def test_runner_connection(
    db_session: AsyncSession, test_user: User, test_project: Project
) -> RunnerConnection:
    """Create a test runner connection in the database."""
    runner = RunnerConnection(
        user_id=test_user.id,
        project_id=test_project.id,
        machine_name=f"test-machine-{uuid4().hex[:8]}",
        status="connected",
        last_heartbeat=datetime.utcnow(),
    )
    db_session.add(runner)
    await db_session.commit()
    await db_session.refresh(runner)
    return runner


@pytest_asyncio.fixture(scope="function")
async def test_run(
    db_session: AsyncSession,
    test_project: Project,
    test_runner_connection: RunnerConnection,
) -> SoftwareTestRun:
    """Create a test run in the database."""
    test_run = SoftwareTestRun(
        id=uuid4(),
        project_id=test_project.id,
        runner_connection_id=test_runner_connection.id,
        workflow_id="test-workflow-001",
        status=TestRunStatus.RUNNING,
        started_at=datetime.utcnow(),
        total_transitions=0,
        successful_transitions=0,
        failed_transitions=0,
        skipped_transitions=0,
        coverage_percentage=Decimal("0.00"),
        unique_paths_found=0,
        unique_states_visited=0,
        configuration_snapshot={
            "strategy": "random_walk",
            "max_duration_seconds": 3600,
            "screenshot_on_error": True,
        },
        test_mode="exploration",
        max_duration_seconds=3600,
        deficiencies_found=0,
        runner_metadata={
            "runner_version": "0.1.0",
            "os": "Linux",
            "hostname": "test-machine-01",
        },
        tags=["integration-test", "automated"],
    )
    db_session.add(test_run)
    await db_session.commit()
    await db_session.refresh(test_run)
    return test_run


@pytest_asyncio.fixture(scope="function")
async def test_deficiency(
    db_session: AsyncSession, test_run: SoftwareTestRun
) -> TestDeficiency:
    """Create a test deficiency in the database."""
    deficiency = TestDeficiency(
        id=uuid4(),
        test_run_id=test_run.id,
        severity=DeficiencySeverity.HIGH,
        deficiency_type=DeficiencyType.FUNCTIONAL,
        title="Login button not responding",
        description="The login button does not respond to clicks after entering credentials.",
        screenshot_urls=["https://example.com/screenshot1.png"],
        reproduction_steps=[
            "Navigate to login page",
            "Enter valid credentials",
            "Click login button",
            "Observe no response",
        ],
        reproduction_rate=Decimal("95.50"),
        reproducible=True,
        environment_info={
            "os": "Windows 11",
            "browser": "Chrome 120",
            "screen_resolution": "1920x1080",
        },
        status=DeficiencyStatus.NEW,
        tags=["ui", "login", "critical-path"],
    )
    db_session.add(deficiency)
    await db_session.commit()
    await db_session.refresh(deficiency)
    return deficiency


# Factory functions for creating multiple test objects


async def create_test_runs(
    db_session: AsyncSession,
    project: Project,
    runner: RunnerConnection,
    count: int = 3,
    status: TestRunStatus = TestRunStatus.COMPLETED,
) -> list[SoftwareTestRun]:
    """Create multiple test runs for testing."""
    runs = []
    for i in range(count):
        run = SoftwareTestRun(
            id=uuid4(),
            project_id=project.id,
            runner_connection_id=runner.id,
            workflow_id=f"workflow-{i:03d}",
            status=status,
            started_at=datetime.utcnow() - timedelta(hours=count - i),
            completed_at=(
                datetime.utcnow() - timedelta(hours=count - i - 1)
                if status == TestRunStatus.COMPLETED
                else None
            ),
            total_transitions=50 + i * 10,
            successful_transitions=45 + i * 10,
            failed_transitions=5,
            coverage_percentage=Decimal(f"{70 + i * 5}.00"),
            unique_paths_found=20 + i * 5,
            unique_states_visited=15 + i * 3,
            configuration_snapshot={"strategy": "random_walk"},
            test_mode="regression",
            deficiencies_found=i,
            runner_metadata={"version": "0.1.0"},
            tags=["automated"],
        )
        db_session.add(run)
        runs.append(run)

    await db_session.commit()
    for run in runs:
        await db_session.refresh(run)
    return runs


async def create_test_deficiencies(
    db_session: AsyncSession,
    test_run: SoftwareTestRun,
    count: int = 5,
    severity: DeficiencySeverity = DeficiencySeverity.MEDIUM,
) -> list[TestDeficiency]:
    """Create multiple deficiencies for testing."""
    deficiencies = []
    for i in range(count):
        deficiency = TestDeficiency(
            id=uuid4(),
            test_run_id=test_run.id,
            severity=severity,
            deficiency_type=DeficiencyType.FUNCTIONAL,
            title=f"Test deficiency {i + 1}",
            description=f"This is test deficiency number {i + 1}",
            screenshot_urls=[f"https://example.com/screenshot{i}.png"],
            reproduction_steps=[f"Step {j + 1}" for j in range(3)],
            reproducible=True,
            environment_info={"os": "Linux", "browser": "Firefox"},
            status=DeficiencyStatus.NEW,
            tags=["automated-test"],
        )
        db_session.add(deficiency)
        deficiencies.append(deficiency)

    await db_session.commit()
    for deficiency in deficiencies:
        await db_session.refresh(deficiency)
    return deficiencies


# Mock data generators


def generate_mock_transition_data(count: int = 10) -> list[dict[str, Any]]:
    """Generate mock transition data for testing."""
    transitions = []
    states = ["login", "dashboard", "settings", "profile", "logout"]

    for i in range(count):
        from_state = states[i % len(states)]
        to_state = states[(i + 1) % len(states)]
        transitions.append(
            {
                "sequence_number": i + 1,
                "from_state": from_state,
                "to_state": to_state,
                "transition_name": f"{from_state}_to_{to_state}",
                "status": "success" if i % 10 != 0 else "failed",
                "started_at": datetime.utcnow().isoformat(),
                "completed_at": (datetime.utcnow() + timedelta(seconds=2)).isoformat(),
                "duration_ms": 2000,
                "error_message": "Element not found" if i % 10 == 0 else None,
                "error_type": "element_not_found" if i % 10 == 0 else None,
                "metadata": {"actions_executed": 3, "confidence_score": 0.95},
            }
        )
    return transitions


def generate_mock_deficiency_data(count: int = 5) -> list[dict[str, Any]]:
    """Generate mock deficiency data for testing."""
    deficiencies = []
    for i in range(count):
        deficiencies.append(
            {
                "title": f"Test deficiency {i + 1}",
                "description": f"Description for deficiency {i + 1}",
                "severity": ["critical", "high", "medium", "low"][i % 4],
                "deficiency_type": "functional_bug",
                "state": "login" if i % 2 == 0 else "dashboard",
                "transition_sequence_number": i + 1,
                "screenshot_ids": [],
                "reproduction_steps": [
                    "Step 1: Navigate to page",
                    "Step 2: Perform action",
                    "Step 3: Observe error",
                ],
                "metadata": {"severity_score": 8.5, "impact": "high"},
            }
        )
    return deficiencies


def generate_mock_coverage_data() -> dict[str, Any]:
    """Generate mock coverage data for testing."""
    return {
        "total_transitions_executed": 100,
        "unique_transitions_covered": 45,
        "coverage_percentage": 75.0,
        "transition_coverage_map": {
            "login_to_dashboard": 10,
            "dashboard_to_profile": 8,
            "profile_to_settings": 5,
        },
        "state_coverage_map": {
            "login": 12,
            "dashboard": 25,
            "profile": 15,
            "settings": 10,
        },
        "uncovered_transitions": ["settings_to_admin", "admin_to_users"],
    }
