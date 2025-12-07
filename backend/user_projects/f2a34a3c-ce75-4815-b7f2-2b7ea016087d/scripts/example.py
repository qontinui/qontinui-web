"""
Example automation script.

This file demonstrates how to write a simple Python function
that can be called from Qontinui workflows.
"""


def detect_unit(screenshot_data: dict, threshold: float = 0.8) -> dict:
    """
    Detect a unit on the screen.

    Args:
        screenshot_data: Screenshot data from action_result
        threshold: Detection confidence threshold (0.0-1.0)

    Returns:
        dict: Detection result with coordinates and confidence
    """
    # Example implementation
    # In a real scenario, this would use computer vision or pattern matching

    return {
        "found": True,
        "confidence": 0.95,
        "x": 100,
        "y": 200,
        "width": 50,
        "height": 50,
    }


def validate_state(action_result: dict) -> bool:
    """
    Validate that the automation is in the correct state.

    Args:
        action_result: Previous action result

    Returns:
        bool: True if state is valid, False otherwise
    """
    # Example validation logic
    if not action_result:
        return False

    # Check if required fields exist
    required_fields = ["status", "data"]
    return all(field in action_result for field in required_fields)


def transform_data(text: str, variables: dict) -> dict:
    """
    Transform extracted text data.

    Args:
        text: Raw text from OCR or action result
        variables: Workflow variables

    Returns:
        dict: Transformed data
    """
    import re

    # Example: Extract price from text
    price_match = re.search(r"\$(\d+\.\d{2})", text)
    price = float(price_match.group(1)) if price_match else 0.0

    # Extract other data
    return {
        "price": price,
        "currency": "USD",
        "timestamp": variables.get("timestamp"),
    }
