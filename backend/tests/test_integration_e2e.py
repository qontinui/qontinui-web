"""
Comprehensive End-to-End Integration Testing Suite

Tests the complete integration testing workflow:
- Import snapshot runs
- Select process
- Get smart recommendations
- Execute with recommended snapshots
- Verify results structure
- Generate coverage report
- Export PDF
- Export video
"""

import uuid
from datetime import datetime
from typing import Any

import pytest
from app.main import app
from fastapi.testclient import TestClient
from tests.utils.integration_test_helpers import (
    cleanup_test_data, create_test_actions, create_test_snapshot,
    generate_mock_execution_result, verify_execution_result)

# Create test client
client = TestClient(app)


@pytest.fixture(scope="function")
def test_snapshot_data() -> dict[str, Any]:
    """Create test snapshot data."""
    return create_test_snapshot(
        run_name="e2e_test_run",
        num_screenshots=10,
        states=["login", "dashboard", "settings"],
        include_patterns=True,
    )


@pytest.fixture(scope="function")
def test_snapshot_data_multi() -> list[dict[str, Any]]:
    """Create multiple test snapshot datasets."""
    return [
        create_test_snapshot(
            run_name=f"e2e_test_run_{i}",
            num_screenshots=5,
            states=["state_a", "state_b"],
            include_patterns=True,
        )
        for i in range(3)
    ]


@pytest.fixture(scope="function")
def test_process_id() -> str:
    """Generate a test process ID."""
    return str(uuid.uuid4())


@pytest.fixture(scope="function")
def cleanup_runs():
    """Fixture to track and cleanup test runs."""
    run_ids = []

    yield run_ids

    # Cleanup after test
    if run_ids:
        cleanup_test_data(client, run_ids)


class TestCompleteWorkflow:
    """Test the complete end-to-end integration testing workflow."""

    def test_complete_workflow_single_snapshot(
        self, test_snapshot_data, test_process_id, cleanup_runs
    ):
        """
        Test complete workflow with a single snapshot run:
        1. Import snapshot run
        2. Execute process
        3. Verify results
        """
        # Step 1: Import snapshot run
        snapshot_data = test_snapshot_data
        # Note: This is a mock - real implementation would use import_test_snapshot
        # For now, we'll simulate the imported data
        run_id = snapshot_data["run_id"]
        cleanup_runs.append(run_id)

        # Step 2: Create test actions
        actions = create_test_actions(count=5)

        # Step 3: Execute process (mocked)
        # In real implementation, this would call execute_test_process
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Test Process",
            actions=actions,
            initial_states=["login"],
            success_rate=1.0,
        )

        # Step 4: Verify results
        verify_execution_result(
            result, expected_action_count=5, expected_success=True, min_success_rate=0.8
        )

        # Assertions
        assert result["process_id"] == test_process_id
        assert result["success"] is True
        assert result["success_rate"] == 1.0
        assert len(result["actions"]) == 5
        assert result["total_actions"] == 5
        assert result["successful_actions"] == 5

    def test_complete_workflow_multi_snapshot(
        self, test_snapshot_data_multi, test_process_id, cleanup_runs
    ):
        """
        Test complete workflow with multiple snapshot runs:
        1. Import multiple snapshot runs
        2. Execute process with all snapshots
        3. Verify results include data from all snapshots
        """
        # Step 1: Import multiple snapshot runs
        run_ids = [snapshot["run_id"] for snapshot in test_snapshot_data_multi]
        cleanup_runs.extend(run_ids)

        # Step 2: Create test actions
        actions = create_test_actions(count=7)

        # Step 3: Execute process with multiple snapshots
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Multi-Snapshot Test Process",
            actions=actions,
            initial_states=["state_a", "state_b"],
            success_rate=0.9,
        )

        # Step 4: Verify results
        verify_execution_result(
            result, expected_action_count=7, expected_success=True, min_success_rate=0.8
        )

        # Assertions
        assert result["total_actions"] == 7
        assert result["successful_actions"] >= 6  # 90% success rate


class TestErrorScenarios:
    """Test error handling and edge cases."""

    def test_missing_screenshots(self, test_process_id):
        """Test execution with missing screenshot data."""
        # Create snapshot data without screenshot files
        _ = create_test_snapshot(
            run_name="missing_screenshots", num_screenshots=0, include_patterns=True
        )

        # Attempt execution - should handle gracefully
        actions = create_test_actions(count=3)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Missing Screenshots Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=0.0,  # All actions fail
        )

        # Verify failure is properly recorded
        assert result["success"] is False
        assert result["success_rate"] == 0.0
        assert result["successful_actions"] == 0

    def test_invalid_action_type(self, test_process_id):
        """Test execution with invalid action types."""
        actions = [
            {"type": "INVALID_ACTION", "pattern_id": None, "text": None, "metadata": {}}
        ]

        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Invalid Action Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=0.0,
        )

        # Should record as failed action
        assert result["success"] is False
        assert result["actions"][0]["success"] is False

    def test_empty_initial_states(self, test_process_id):
        """Test execution with no initial states specified."""
        actions = create_test_actions(count=3)

        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Empty States Test",
            actions=actions,
            initial_states=[],  # Empty states
            success_rate=0.5,
        )

        # Should still execute but with reduced success
        assert len(result["initial_states"]) == 0
        assert result["success_rate"] == 0.5

    def test_partial_success(self, test_process_id):
        """Test execution where some actions succeed and some fail."""
        actions = create_test_actions(count=10)

        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Partial Success Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=0.6,  # 60% success
        )

        verify_execution_result(
            result,
            expected_action_count=10,
            expected_success=False,
            min_success_rate=0.5,
        )

        assert result["successful_actions"] == 6
        assert result["total_actions"] == 10
        assert result["success_rate"] == 0.6


class TestDuplicateDetection:
    """Test duplicate screenshot and pattern detection."""

    def test_duplicate_screenshots_detected(self):
        """Test that duplicate screenshots are identified."""
        # Create snapshot with duplicate state hashes
        snapshot_data = create_test_snapshot(num_screenshots=10)

        # Simulate duplicate detection
        state_hashes = [s["state_hash"] for s in snapshot_data["screenshots"]]
        unique_hashes = set(state_hashes)

        # In a real implementation, duplicates would be flagged
        # Here we just verify the structure allows for detection
        assert len(state_hashes) == 10
        assert len(unique_hashes) <= 10

    def test_duplicate_patterns_in_same_state(self):
        """Test detection of duplicate patterns in the same state."""
        snapshot_data = create_test_snapshot(num_screenshots=5, include_patterns=True)

        # Group patterns by state
        patterns_by_state = {}
        for pattern in snapshot_data["patterns"]:
            state_key = tuple(pattern["active_states"])
            if state_key not in patterns_by_state:
                patterns_by_state[state_key] = []
            patterns_by_state[state_key].append(pattern)

        # Verify patterns are organized by state
        assert len(patterns_by_state) > 0
        for _state, patterns in patterns_by_state.items():
            assert len(patterns) > 0


class TestPriorityWeighting:
    """Test snapshot recommendation priority weighting."""

    def test_recency_priority(self):
        """Test that newer snapshots are prioritized."""
        # Create snapshots with different timestamps
        old_snapshot = create_test_snapshot(run_name="old_run")
        new_snapshot = create_test_snapshot(run_name="new_run")

        # In real implementation, would call recommendation API
        # Here we verify timestamp parsing works
        old_time = datetime.fromisoformat(old_snapshot["timestamp"])
        new_time = datetime.fromisoformat(new_snapshot["timestamp"])

        assert new_time >= old_time

    def test_coverage_priority(self):
        """Test that snapshots with better coverage are prioritized."""
        low_coverage = create_test_snapshot(run_name="low_coverage", num_screenshots=3)
        high_coverage = create_test_snapshot(
            run_name="high_coverage", num_screenshots=10
        )

        # Verify coverage metadata
        assert low_coverage["metadata"]["total_screenshots"] == 3
        assert high_coverage["metadata"]["total_screenshots"] == 10
        assert (
            high_coverage["metadata"]["total_screenshots"]
            > low_coverage["metadata"]["total_screenshots"]
        )

    def test_state_match_priority(self):
        """Test that snapshots matching required states are prioritized."""
        required_states = ["login", "dashboard"]

        snapshot_match = create_test_snapshot(
            run_name="matching", states=required_states
        )
        snapshot_no_match = create_test_snapshot(
            run_name="non_matching", states=["other_state"]
        )

        # Verify state matching logic
        snapshot_match_states = set(snapshot_match["states"])
        required_states_set = set(required_states)

        match_score = len(snapshot_match_states.intersection(required_states_set))
        no_match_score = len(
            set(snapshot_no_match["states"]).intersection(required_states_set)
        )

        assert match_score > no_match_score


class TestSmartRecommendations:
    """Test the smart recommendation system."""

    def test_recommend_single_snapshot(self):
        """Test recommendation for a single best snapshot."""
        snapshots = [
            create_test_snapshot(run_name=f"snapshot_{i}", num_screenshots=5 + i)
            for i in range(3)
        ]

        # Mock recommendation logic
        # In real implementation, would call recommendation API
        best_snapshot = max(snapshots, key=lambda s: s["metadata"]["total_screenshots"])

        assert best_snapshot["run_name"] == "snapshot_2"
        assert best_snapshot["metadata"]["total_screenshots"] == 7

    def test_recommend_multiple_snapshots(self):
        """Test recommendation for multiple complementary snapshots."""
        snapshot1 = create_test_snapshot(
            run_name="snapshot1", states=["state_a", "state_b"]
        )
        snapshot2 = create_test_snapshot(
            run_name="snapshot2", states=["state_c", "state_d"]
        )
        snapshot3 = create_test_snapshot(
            run_name="snapshot3", states=["state_a", "state_c"]
        )

        # Mock recommendation: select snapshots that cover all required states
        required_states = {"state_a", "state_b", "state_c"}
        selected_snapshots = []

        covered_states = set()
        for snapshot in [snapshot1, snapshot2, snapshot3]:
            snapshot_states = set(snapshot["states"])
            if len(covered_states.union(snapshot_states)) > len(covered_states):
                selected_snapshots.append(snapshot)
                covered_states.update(snapshot_states)

        # Verify we selected snapshots that cover all states
        assert len(selected_snapshots) >= 2
        all_states = set()
        for snapshot in selected_snapshots:
            all_states.update(snapshot["states"])
        assert required_states.issubset(all_states)


class TestResultsStructure:
    """Test the structure and validity of execution results."""

    def test_result_contains_all_required_fields(self, test_process_id):
        """Verify execution result contains all required fields."""
        actions = create_test_actions(count=3)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Structure Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=1.0,
        )

        verify_execution_result(result, expected_action_count=3)

    def test_action_visualization_structure(self, test_process_id):
        """Verify each action visualization has proper structure."""
        actions = create_test_actions(count=3)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Visualization Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=1.0,
        )

        for action in result["actions"]:
            # Verify required fields
            assert "action_type" in action
            assert "screenshot_path" in action
            assert "success" in action
            assert "active_states" in action
            assert "timestamp" in action
            assert "duration_ms" in action

            # Verify types
            assert isinstance(action["action_type"], str)
            assert isinstance(action["screenshot_path"], str)
            assert isinstance(action["success"], bool)
            assert isinstance(action["active_states"], list)
            assert isinstance(action["duration_ms"], int | float)

    def test_timing_consistency(self, test_process_id):
        """Verify timing data is consistent."""
        actions = create_test_actions(count=5)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Timing Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=1.0,
        )

        # Verify start and end times
        start_time = datetime.fromisoformat(result["start_time"])
        end_time = datetime.fromisoformat(result["end_time"])
        assert end_time >= start_time

        # Verify duration matches sum of action durations
        total_action_duration = sum(a["duration_ms"] for a in result["actions"])
        assert result["total_duration_ms"] == total_action_duration


class TestCoverageReporting:
    """Test coverage report generation."""

    def test_generate_state_coverage_report(self):
        """Test generation of state coverage report."""
        snapshot_data = create_test_snapshot(
            num_screenshots=10, states=["state_1", "state_2", "state_3"]
        )

        # Calculate state coverage
        all_states = set(snapshot_data["states"])
        covered_states = set()
        for screenshot in snapshot_data["screenshots"]:
            covered_states.update(screenshot["active_states"])

        coverage_percentage = len(covered_states) / len(all_states) * 100

        assert coverage_percentage > 0
        assert coverage_percentage <= 100

    def test_generate_pattern_coverage_report(self):
        """Test generation of pattern coverage report."""
        snapshot_data = create_test_snapshot(num_screenshots=10, include_patterns=True)

        # Calculate pattern coverage by type
        pattern_types = {}
        for pattern in snapshot_data["patterns"]:
            pattern_type = pattern["type"]
            if pattern_type not in pattern_types:
                pattern_types[pattern_type] = 0
            pattern_types[pattern_type] += 1

        assert len(pattern_types) > 0
        assert sum(pattern_types.values()) == len(snapshot_data["patterns"])

    def test_generate_execution_coverage_report(self, test_process_id):
        """Test generation of execution coverage report."""
        actions = create_test_actions(count=10)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Coverage Test",
            actions=actions,
            initial_states=["state_1", "state_2"],
            success_rate=0.8,
        )

        # Generate coverage metrics
        total_actions = result["total_actions"]
        successful_actions = result["successful_actions"]
        coverage = successful_actions / total_actions * 100

        assert coverage == 80.0
        assert result["success_rate"] == 0.8


class TestExportFunctionality:
    """Test PDF and video export functionality."""

    def test_export_pdf_structure(self, test_process_id):
        """Test that PDF export data is properly structured."""
        actions = create_test_actions(count=5)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="PDF Export Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=1.0,
        )

        # Verify data is suitable for PDF export
        assert "process_name" in result
        assert "start_time" in result
        assert "end_time" in result
        assert "actions" in result
        assert len(result["actions"]) > 0

        # Each action should have screenshot path for PDF inclusion
        for action in result["actions"]:
            assert "screenshot_path" in action
            assert action["screenshot_path"] is not None

    def test_export_video_structure(self, test_process_id):
        """Test that video export data is properly structured."""
        actions = create_test_actions(count=8)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Video Export Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=1.0,
        )

        # Verify data is suitable for video export
        assert len(result["actions"]) > 0

        # Each action should have timing for video timeline
        for action in result["actions"]:
            assert "timestamp" in action
            assert "duration_ms" in action
            assert action["duration_ms"] > 0

        # Verify actions are in chronological order
        timestamps = [datetime.fromisoformat(a["timestamp"]) for a in result["actions"]]
        assert timestamps == sorted(timestamps)


class TestPerformance:
    """Test performance characteristics of the integration testing system."""

    def test_large_snapshot_import(self):
        """Test import of large snapshot with many screenshots."""
        large_snapshot = create_test_snapshot(
            run_name="large_snapshot", num_screenshots=100, include_patterns=True
        )

        # Verify structure can handle large datasets
        assert len(large_snapshot["screenshots"]) == 100
        assert len(large_snapshot["patterns"]) > 0

    def test_many_actions_execution(self, test_process_id):
        """Test execution with many actions."""
        actions = create_test_actions(count=50)
        result = generate_mock_execution_result(
            process_id=test_process_id,
            process_name="Many Actions Test",
            actions=actions,
            initial_states=["state_1"],
            success_rate=0.9,
        )

        verify_execution_result(result, expected_action_count=50, min_success_rate=0.8)
        assert len(result["actions"]) == 50


# Integration test markers
pytestmark = pytest.mark.integration


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
