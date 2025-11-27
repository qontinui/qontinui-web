"""
Integration tests for testing system API endpoints.

Tests the complete API flow for software test runs, transitions,
deficiencies, and coverage tracking.
"""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.project import Project
from app.models.runner_connection import RunnerConnection
from app.models.software_test_run import SoftwareTestRun, TestRunStatus
from app.models.test_deficiency import DeficiencySeverity, TestDeficiency

from .conftest import (
    create_test_deficiencies,
    create_test_runs,
    generate_mock_coverage_data,
    generate_mock_deficiency_data,
    generate_mock_transition_data,
)


@pytest.mark.asyncio
class TestTestRunAPI:
    """Test test run API endpoints."""

    async def test_create_test_run(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test creating a new test run."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            request_data = {
                "project_id": test_project.id,
                "run_name": "Test Run 001",
                "description": "Integration test run",
                "runner_metadata": {
                    "runner_version": "0.1.0",
                    "os": "Windows 11",
                    "hostname": "test-machine-01",
                },
                "workflow_metadata": {
                    "workflow_id": str(uuid4()),
                    "workflow_name": "Login Flow",
                    "total_states": 5,
                    "total_transitions": 10,
                },
                "configuration_snapshot": {
                    "strategy": "random_walk",
                    "max_duration_seconds": 3600,
                },
            }

            response = await client.post(
                "/api/v1/testing/runs",
                json=request_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 201
            data = response.json()
            assert "run_id" in data
            assert data["project_id"] == test_project.id
            assert data["status"] == "running"
            assert data["run_name"] == "Test Run 001"

    async def test_get_test_run_details(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test retrieving test run details."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                f"/api/v1/testing/runs/{test_run.id}",
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["run_id"] == str(test_run.id)
            assert data["status"] == test_run.status
            assert data["project_id"] == test_run.project_id

    async def test_list_test_runs_with_filters(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test listing test runs with various filters."""
        # Create multiple test runs
        await create_test_runs(
            db_session, test_project, test_runner_connection, count=10
        )

        async with AsyncClient(app=app, base_url="http://test") as client:
            # Test basic listing
            response = await client.get(
                "/api/v1/testing/runs",
                params={"project_id": test_project.id},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert "runs" in data
            assert "pagination" in data
            assert len(data["runs"]) >= 10

            # Test filtering by status
            response = await client.get(
                "/api/v1/testing/runs",
                params={"project_id": test_project.id, "status": "completed"},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            for run in data["runs"]:
                assert run["status"] == "completed"

            # Test pagination
            response = await client.get(
                "/api/v1/testing/runs",
                params={"project_id": test_project.id, "limit": 5, "offset": 0},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["runs"]) <= 5
            assert data["pagination"]["limit"] == 5

    async def test_complete_test_run(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test completing a test run."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            completion_data = {
                "status": "completed",
                "ended_at": datetime.utcnow().isoformat(),
                "final_metrics": {
                    "total_transitions_executed": 50,
                    "successful_transitions": 45,
                    "failed_transitions": 5,
                    "coverage_percentage": 75.0,
                    "unique_transitions_covered": 20,
                    "total_deficiencies_found": 3,
                },
                "summary": "Test run completed successfully",
            }

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/complete",
                json=completion_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "completed"
            assert data["duration_seconds"] > 0
            assert "final_metrics" in data


@pytest.mark.asyncio
class TestTransitionAPI:
    """Test transition reporting API endpoints."""

    async def test_report_single_transition(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test reporting a single transition."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            transition_data = {
                "sequence_number": 1,
                "from_state": "login",
                "to_state": "dashboard",
                "transition_name": "successful_login",
                "status": "success",
                "started_at": datetime.utcnow().isoformat(),
                "completed_at": (datetime.utcnow() + timedelta(seconds=2)).isoformat(),
                "duration_ms": 2000,
                "metadata": {"confidence_score": 0.95},
            }

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/transitions",
                json=transition_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 201
            data = response.json()
            assert "transition_id" in data
            assert data["from_state"] == "login"
            assert data["to_state"] == "dashboard"

    async def test_report_batch_transitions(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test reporting multiple transitions in a batch."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            transitions = generate_mock_transition_data(count=10)

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/transitions/batch",
                json={"transitions": transitions},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["transitions_recorded"] == 10
            assert len(data["transition_ids"]) == 10
            assert "coverage_updated" in data

    async def test_get_run_transitions(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test retrieving transitions for a test run."""
        # First, create some transitions
        async with AsyncClient(app=app, base_url="http://test") as client:
            transitions = generate_mock_transition_data(count=20)
            await client.post(
                f"/api/v1/testing/runs/{test_run.id}/transitions/batch",
                json={"transitions": transitions},
                headers={"Authorization": "Bearer test_token"},
            )

            # Now retrieve them
            response = await client.get(
                f"/api/v1/testing/runs/{test_run.id}/transitions",
                params={"limit": 10},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert "transitions" in data
            assert len(data["transitions"]) <= 10


@pytest.mark.asyncio
class TestDeficiencyAPI:
    """Test deficiency reporting API endpoints."""

    async def test_report_single_deficiency(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test reporting a single deficiency."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            deficiency_data = {
                "title": "Button not responding",
                "description": "Login button does not respond to clicks",
                "severity": "high",
                "deficiency_type": "functional_bug",
                "state": "login",
                "transition_sequence_number": 1,
                "screenshot_ids": [],
                "reproduction_steps": [
                    "Navigate to login page",
                    "Click login button",
                    "Observe no response",
                ],
                "metadata": {"browser": "Chrome", "os": "Windows"},
            }

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/deficiencies",
                json=deficiency_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 201
            data = response.json()
            assert "deficiency_id" in data
            assert data["title"] == "Button not responding"
            assert data["severity"] == "high"

    async def test_report_batch_deficiencies(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test reporting multiple deficiencies in a batch."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            deficiencies = generate_mock_deficiency_data(count=5)

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/deficiencies/batch",
                json={"deficiencies": deficiencies},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 201
            data = response.json()
            assert data["deficiencies_recorded"] == 5
            assert len(data["deficiency_ids"]) == 5

    async def test_update_deficiency_status(
        self, db_session: AsyncSession, test_deficiency: TestDeficiency
    ):
        """Test updating deficiency status."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            update_data = {
                "status": "in_progress",
                "severity": "critical",
                "resolution_notes": "Working on fix",
            }

            response = await client.patch(
                f"/api/v1/testing/deficiencies/{test_deficiency.id}",
                json=update_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "in_progress"
            assert data["severity"] == "critical"

    async def test_list_deficiencies_with_filters(
        self,
        db_session: AsyncSession,
        test_run: SoftwareTestRun,
    ):
        """Test listing deficiencies with various filters."""
        # Create deficiencies with different severities
        await create_test_deficiencies(
            db_session, test_run, count=10, severity=DeficiencySeverity.HIGH
        )

        async with AsyncClient(app=app, base_url="http://test") as client:
            # Test basic listing
            response = await client.get(
                f"/api/v1/testing/runs/{test_run.id}/deficiencies",
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert "deficiencies" in data
            assert "summary" in data

            # Test filtering by severity
            response = await client.get(
                "/api/v1/testing/deficiencies",
                params={"severity": "high", "run_id": str(test_run.id)},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            for deficiency in data["deficiencies"]:
                assert deficiency["severity"] == "high"


@pytest.mark.asyncio
class TestCoverageAPI:
    """Test coverage tracking API endpoints."""

    async def test_update_coverage(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test updating coverage metrics."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            coverage_data = generate_mock_coverage_data()

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/coverage",
                json=coverage_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["coverage_updated"] is True
            assert data["coverage_percentage"] == 75.0
            assert data["unique_transitions_covered"] == 45

    async def test_get_coverage_trends(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test retrieving coverage trends over time."""
        # Create multiple completed runs with different coverage
        runs = await create_test_runs(
            db_session,
            test_project,
            test_runner_connection,
            count=30,
            status=TestRunStatus.COMPLETED,
        )

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/testing/analytics/coverage-trends",
                params={
                    "project_id": test_project.id,
                    "start_date": (datetime.utcnow() - timedelta(days=30)).strftime(
                        "%Y-%m-%d"
                    ),
                    "end_date": datetime.utcnow().strftime("%Y-%m-%d"),
                    "granularity": "daily",
                },
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert "data_points" in data
            assert "overall_stats" in data
            assert len(data["data_points"]) > 0


@pytest.mark.asyncio
class TestAnalyticsAPI:
    """Test analytics and reporting API endpoints."""

    async def test_get_transition_reliability(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test retrieving transition reliability statistics."""
        # Create multiple test runs
        await create_test_runs(
            db_session,
            test_project,
            test_runner_connection,
            count=10,
            status=TestRunStatus.COMPLETED,
        )

        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/testing/analytics/reliability",
                params={
                    "workflow_id": "workflow-001",
                    "project_id": test_project.id,
                    "start_date": (datetime.utcnow() - timedelta(days=30)).strftime(
                        "%Y-%m-%d"
                    ),
                    "end_date": datetime.utcnow().strftime("%Y-%m-%d"),
                },
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert "transition_stats" in data
            assert "overall_reliability" in data

    async def test_export_test_report(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test exporting test run report."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            response = await client.get(
                f"/api/v1/testing/runs/{test_run.id}/export",
                params={"format": "json"},
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert "run_id" in data
            assert "transitions" in data
            assert "deficiencies" in data
            assert "coverage_data" in data


@pytest.mark.asyncio
class TestBatchOperations:
    """Test batch operations on test runs and deficiencies."""

    async def test_batch_update_deficiencies(
        self,
        db_session: AsyncSession,
        test_run: SoftwareTestRun,
    ):
        """Test updating multiple deficiencies at once."""
        # Create multiple deficiencies
        deficiencies = await create_test_deficiencies(db_session, test_run, count=10)

        async with AsyncClient(app=app, base_url="http://test") as client:
            deficiency_ids = [str(d.id) for d in deficiencies]
            update_data = {
                "deficiency_ids": deficiency_ids,
                "status": "triaged",
            }

            response = await client.patch(
                "/api/v1/testing/deficiencies/batch",
                json=update_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["updated_count"] == 10

    async def test_batch_delete_test_runs(
        self,
        db_session: AsyncSession,
        test_project: Project,
        test_runner_connection: RunnerConnection,
    ):
        """Test deleting multiple test runs at once."""
        # Create multiple test runs
        runs = await create_test_runs(
            db_session, test_project, test_runner_connection, count=5
        )

        async with AsyncClient(app=app, base_url="http://test") as client:
            run_ids = [str(r.id) for r in runs]
            delete_data = {"run_ids": run_ids}

            response = await client.request(
                "DELETE",
                "/api/v1/testing/runs/batch",
                json=delete_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["deleted_count"] == 5


@pytest.mark.asyncio
class TestErrorHandling:
    """Test API error handling."""

    async def test_get_nonexistent_test_run(self, db_session: AsyncSession):
        """Test retrieving a nonexistent test run."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            fake_id = uuid4()
            response = await client.get(
                f"/api/v1/testing/runs/{fake_id}",
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 404

    async def test_invalid_transition_data(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test reporting transition with invalid data."""
        async with AsyncClient(app=app, base_url="http://test") as client:
            invalid_data = {
                "sequence_number": -1,  # Invalid
                "from_state": "",  # Invalid
                "to_state": "",  # Invalid
                "status": "invalid_status",  # Invalid
            }

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/transitions",
                json=invalid_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 422  # Validation error

    async def test_update_completed_test_run(
        self, db_session: AsyncSession, test_run: SoftwareTestRun
    ):
        """Test attempting to update a completed test run."""
        # Complete the test run first
        test_run.status = TestRunStatus.COMPLETED
        test_run.completed_at = datetime.utcnow()
        db_session.add(test_run)
        await db_session.commit()

        async with AsyncClient(app=app, base_url="http://test") as client:
            transition_data = {
                "sequence_number": 1,
                "from_state": "login",
                "to_state": "dashboard",
                "transition_name": "login",
                "status": "success",
                "started_at": datetime.utcnow().isoformat(),
                "completed_at": datetime.utcnow().isoformat(),
                "duration_ms": 1000,
            }

            response = await client.post(
                f"/api/v1/testing/runs/{test_run.id}/transitions",
                json=transition_data,
                headers={"Authorization": "Bearer test_token"},
            )

            assert response.status_code == 400
            assert "completed" in response.json()["detail"].lower()
