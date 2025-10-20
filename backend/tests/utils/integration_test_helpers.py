"""
Integration Test Helper Functions
Provides utilities for creating, importing, and validating integration test data
"""

import json
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image


def create_test_snapshot(
    run_name: str = "test_run",
    num_screenshots: int = 5,
    states: list[str] | None = None,
    include_patterns: bool = True,
) -> dict[str, Any]:
    """
    Generate test snapshot data with mock screenshots and patterns.

    Args:
        run_name: Name for the snapshot run
        num_screenshots: Number of screenshots to generate
        states: List of state names (default: ["state_1", "state_2", ...])
        include_patterns: Whether to include pattern data

    Returns:
        Dictionary containing snapshot data structure
    """
    if states is None:
        states = [f"state_{i+1}" for i in range(min(num_screenshots, 3))]

    run_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()

    # Create mock screenshot data
    screenshots = []
    for i in range(num_screenshots):
        active_states = [states[i % len(states)]]
        screenshots.append(
            {
                "screenshot_path": f"screenshot_{i+1}.png",
                "active_states": active_states,
                "timestamp": timestamp,
                "width": 1920,
                "height": 1080,
                "state_hash": f"hash_{i+1}",
            }
        )

    # Create mock pattern data
    patterns = []
    if include_patterns:
        pattern_types = ["button", "input", "menu", "icon", "text"]
        for i in range(10):
            patterns.append(
                {
                    "pattern_id": str(uuid.uuid4()),
                    "name": f"pattern_{i+1}",
                    "type": pattern_types[i % len(pattern_types)],
                    "screenshot_path": screenshots[i % len(screenshots)][
                        "screenshot_path"
                    ],
                    "region": {
                        "x": 100 + (i * 50),
                        "y": 100 + (i * 30),
                        "w": 150,
                        "h": 40,
                    },
                    "active_states": screenshots[i % len(screenshots)]["active_states"],
                    "confidence": 0.85 + (i * 0.01),
                }
            )

    snapshot_data = {
        "run_id": run_id,
        "run_name": run_name,
        "timestamp": timestamp,
        "screenshots": screenshots,
        "patterns": patterns,
        "states": states,
        "metadata": {
            "total_screenshots": num_screenshots,
            "total_patterns": len(patterns),
            "total_states": len(states),
        },
    }

    return snapshot_data


def create_test_screenshot(width: int = 1920, height: int = 1080) -> bytes:
    """
    Create a test screenshot image.

    Args:
        width: Image width in pixels
        height: Image height in pixels

    Returns:
        PNG image bytes
    """
    # Create a simple gradient image for testing
    img = Image.new("RGB", (width, height))
    pixels = img.load()

    for y in range(height):
        for x in range(width):
            # Create a gradient pattern
            r = int((x / width) * 255)
            g = int((y / height) * 255)
            b = 128
            pixels[x, y] = (r, g, b)

    # Save to bytes
    import io

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def import_test_snapshot(client, snapshot_data: dict[str, Any]) -> dict[str, Any]:
    """
    Import snapshot data via API.

    Args:
        client: FastAPI TestClient instance
        snapshot_data: Snapshot data dictionary

    Returns:
        API response data
    """
    # Create temporary directory for screenshots
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Create mock screenshot files
        screenshot_files = []
        for screenshot in snapshot_data["screenshots"]:
            screenshot_path = temp_path / screenshot["screenshot_path"]
            screenshot_bytes = create_test_screenshot()
            screenshot_path.write_bytes(screenshot_bytes)
            screenshot_files.append(screenshot_path)

        # Prepare multipart form data
        files = [
            ("screenshots", (str(path.name), open(path, "rb"), "image/png"))
            for path in screenshot_files
        ]

        # Send import request
        response = client.post(
            "/api/integration-testing/import",
            files=files,
            data={
                "run_name": snapshot_data["run_name"],
                "metadata": json.dumps(snapshot_data.get("metadata", {})),
            },
        )

        # Close file handles
        for _, file_tuple in files:
            file_tuple[1].close()

        if response.status_code != 200:
            raise Exception(f"Import failed: {response.text}")

        return response.json()


def execute_test_process(
    client,
    process_id: str,
    process_name: str,
    snapshot_run_ids: list[str],
    initial_states: list[str],
    actions: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Execute a mock process via API.

    Args:
        client: FastAPI TestClient instance
        process_id: Process identifier
        process_name: Human-readable process name
        snapshot_run_ids: List of snapshot run IDs to use
        initial_states: List of initial state names
        actions: List of action specifications

    Returns:
        Execution result data
    """
    request_data = {
        "process_id": process_id,
        "process_name": process_name,
        "snapshot_run_ids": snapshot_run_ids,
        "initial_states": initial_states,
        "actions": actions,
    }

    response = client.post("/api/integration-testing/execute", json=request_data)

    if response.status_code != 200:
        raise Exception(f"Execution failed: {response.text}")

    return response.json()


def verify_execution_result(
    result: dict[str, Any],
    expected_action_count: int,
    expected_success: bool = True,
    min_success_rate: float = 0.8,
) -> None:
    """
    Verify execution result structure and values.

    Args:
        result: Execution result dictionary
        expected_action_count: Expected number of actions
        expected_success: Expected overall success status
        min_success_rate: Minimum acceptable success rate

    Raises:
        AssertionError: If validation fails
    """
    # Verify required fields exist
    required_fields = [
        "process_id",
        "process_name",
        "start_time",
        "end_time",
        "total_duration_ms",
        "initial_states",
        "final_states",
        "actions",
        "success",
        "success_rate",
        "total_actions",
        "successful_actions",
    ]

    for field in required_fields:
        assert field in result, f"Missing required field: {field}"

    # Verify data types
    assert isinstance(result["process_id"], str), "process_id must be string"
    assert isinstance(result["process_name"], str), "process_name must be string"
    assert isinstance(result["initial_states"], list), "initial_states must be list"
    assert isinstance(result["final_states"], list), "final_states must be list"
    assert isinstance(result["actions"], list), "actions must be list"
    assert isinstance(result["success"], bool), "success must be boolean"
    assert isinstance(
        result["success_rate"], int | float
    ), "success_rate must be numeric"
    assert isinstance(result["total_actions"], int), "total_actions must be integer"
    assert isinstance(
        result["successful_actions"], int
    ), "successful_actions must be integer"

    # Verify counts
    assert (
        result["total_actions"] == expected_action_count
    ), f"Expected {expected_action_count} actions, got {result['total_actions']}"
    assert (
        len(result["actions"]) == expected_action_count
    ), f"Expected {expected_action_count} action details, got {len(result['actions'])}"

    # Verify success metrics
    assert (
        result["success"] == expected_success
    ), f"Expected success={expected_success}, got {result['success']}"
    assert (
        result["success_rate"] >= min_success_rate
    ), f"Success rate {result['success_rate']} below minimum {min_success_rate}"

    # Verify action structure
    for i, action in enumerate(result["actions"]):
        action_required_fields = [
            "action_type",
            "screenshot_path",
            "success",
            "active_states",
            "timestamp",
            "duration_ms",
        ]
        for field in action_required_fields:
            assert field in action, f"Action {i} missing field: {field}"

        assert isinstance(action["action_type"], str), f"Action {i} type must be string"
        assert isinstance(
            action["screenshot_path"], str
        ), f"Action {i} screenshot_path must be string"
        assert isinstance(
            action["success"], bool
        ), f"Action {i} success must be boolean"
        assert isinstance(
            action["active_states"], list
        ), f"Action {i} active_states must be list"
        assert isinstance(
            action["duration_ms"], int | float
        ), f"Action {i} duration_ms must be numeric"

    # Verify timestamps
    start_time = datetime.fromisoformat(result["start_time"])
    end_time = datetime.fromisoformat(result["end_time"])
    assert end_time >= start_time, "End time must be after start time"

    # Verify duration is positive
    assert result["total_duration_ms"] >= 0, "Duration must be non-negative"


def cleanup_test_data(client, run_ids: list[str]) -> None:
    """
    Clean up test snapshot data.

    Args:
        client: FastAPI TestClient instance
        run_ids: List of snapshot run IDs to delete
    """
    for run_id in run_ids:
        try:
            response = client.delete(f"/api/integration-testing/snapshots/{run_id}")
            if response.status_code not in [200, 404]:
                print(f"Warning: Failed to delete run {run_id}: {response.text}")
        except Exception as e:
            print(f"Warning: Error deleting run {run_id}: {e}")


def create_test_actions(count: int = 5) -> list[dict[str, Any]]:
    """
    Create a list of test action specifications.

    Args:
        count: Number of actions to create

    Returns:
        List of action specification dictionaries
    """
    action_types = ["FIND", "CLICK", "TYPE", "WAIT", "SCROLL"]
    actions = []

    for i in range(count):
        action_type = action_types[i % len(action_types)]
        action = {
            "type": action_type,
            "pattern_id": str(uuid.uuid4())
            if action_type in ["FIND", "CLICK"]
            else None,
            "text": f"test_text_{i}" if action_type == "TYPE" else None,
            "metadata": {
                "step": i + 1,
                "description": f"Test action {i + 1}",
            },
        }
        actions.append(action)

    return actions


def generate_mock_execution_result(
    process_id: str,
    process_name: str,
    actions: list[dict[str, Any]],
    initial_states: list[str],
    success_rate: float = 1.0,
) -> dict[str, Any]:
    """
    Generate a mock execution result for testing.

    Args:
        process_id: Process identifier
        process_name: Process name
        actions: List of action specifications
        initial_states: Initial states
        success_rate: Proportion of successful actions (0.0 to 1.0)

    Returns:
        Mock execution result dictionary
    """
    start_time = datetime.now()
    action_results = []
    successful_count = 0

    for i, action in enumerate(actions):
        is_successful = i < int(len(actions) * success_rate)
        if is_successful:
            successful_count += 1

        action_result = {
            "action_type": action["type"],
            "screenshot_path": f"execution_step_{i+1}.png",
            "action_location": [500 + i * 10, 300 + i * 10] if is_successful else None,
            "action_region": {
                "x": 100 + i * 20,
                "y": 100 + i * 15,
                "w": 150,
                "h": 40,
            }
            if action["type"] in ["FIND", "CLICK"]
            else None,
            "success": is_successful,
            "matches": [
                {
                    "x": 100 + i * 20,
                    "y": 100 + i * 15,
                    "w": 150,
                    "h": 40,
                    "score": 0.95,
                }
            ]
            if is_successful and action["type"] == "FIND"
            else [],
            "text": action.get("text"),
            "active_states": initial_states,
            "timestamp": (start_time.isoformat()),
            "duration_ms": 50 + i * 10,
        }
        action_results.append(action_result)

    end_time = start_time
    total_duration = sum(a["duration_ms"] for a in action_results)

    return {
        "process_id": process_id,
        "process_name": process_name,
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "total_duration_ms": total_duration,
        "initial_states": initial_states,
        "final_states": initial_states,
        "actions": action_results,
        "success": success_rate >= 0.8,
        "success_rate": success_rate,
        "total_actions": len(actions),
        "successful_actions": successful_count,
    }
