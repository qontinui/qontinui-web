"""Relay handlers for automation WebSocket.

Handles message types that primarily relay data to frontends,
including command responses, extraction events, execution events,
and tree events.
"""

from typing import Any

import structlog

from app.websockets.automation.message_handlers import store_tree_event
from app.websockets.automation.schemas import WSMessage, make_timestamp

logger = structlog.get_logger(__name__)


async def handle_command_response(
    message: WSMessage,
    raw_data: dict[str, Any],
    send_to_frontends: Any,
    connection_id: Any,
) -> dict[str, Any]:
    """Handle command response from runner.

    Args:
        message: Parsed WebSocket message.
        raw_data: Raw message data.
        send_to_frontends: Function to relay to frontends.
        connection_id: Connection ID for logging.

    Returns:
        Acknowledgment response.
    """
    await send_to_frontends(
        {
            "type": "command_response",
            "data": message.data,
            "timestamp": make_timestamp(),
        }
    )
    logger.info(
        "command_response_relayed_to_frontends",
        connection_id=connection_id,
        response_type=message.data.get("response_type"),
    )
    return {
        "type": "command_response_ack",
        "timestamp": make_timestamp(),
    }


async def handle_extraction_event(
    message: WSMessage,
    raw_data: dict[str, Any],
    send_to_frontends: Any,
    connection_id: Any,
) -> dict[str, Any]:
    """Handle web extraction events from runner.

    Args:
        message: Parsed WebSocket message.
        raw_data: Raw message data.
        send_to_frontends: Function to relay to frontends.
        connection_id: Connection ID for logging.

    Returns:
        Acknowledgment response.
    """
    await send_to_frontends(
        {
            "type": message.type,
            **message.data,
            "timestamp": make_timestamp(),
        }
    )
    logger.info(
        "extraction_event_relayed_to_frontends",
        connection_id=connection_id,
        event_type=message.type,
    )
    return {
        "type": f"{message.type}_ack",
        "timestamp": make_timestamp(),
    }


async def handle_tree_event(
    message: WSMessage,
    raw_data: dict[str, Any],
    db: Any,
    send_to_frontends: Any,
    connection_id: Any,
) -> dict[str, Any]:
    """Handle tree event from runner.

    Stores the event and relays to frontends.

    Args:
        message: Parsed WebSocket message.
        raw_data: Raw message data.
        db: Database session.
        send_to_frontends: Function to relay to frontends.
        connection_id: Connection ID for logging.

    Returns:
        Acknowledgment response.
    """
    # Store the tree event for historical analysis
    await store_tree_event(db, message.data)

    # Relay to frontends for real-time display
    await send_to_frontends(
        {
            "type": message.type,
            **message.data,
            "timestamp": make_timestamp(),
        }
    )
    logger.debug(
        "tree_event_stored_and_relayed",
        connection_id=connection_id,
        event_type=message.data.get("event_type"),
    )
    return {
        "type": "tree_event_ack",
        "timestamp": make_timestamp(),
    }


async def handle_execution_event(
    message: WSMessage,
    raw_data: dict[str, Any],
    send_to_frontends: Any,
    connection_id: Any,
) -> dict[str, Any]:
    """Handle execution events from runner.

    Args:
        message: Parsed WebSocket message.
        raw_data: Raw message data.
        send_to_frontends: Function to relay to frontends.
        connection_id: Connection ID for logging.

    Returns:
        Acknowledgment response.
    """
    await send_to_frontends(
        {
            "type": message.type,
            **message.data,
            "timestamp": make_timestamp(),
        }
    )
    logger.debug(
        "execution_event_relayed_to_frontends",
        connection_id=connection_id,
        event_type=message.type,
    )
    return {
        "type": f"{message.type}_ack",
        "timestamp": make_timestamp(),
    }


async def handle_unknown_message(
    message: WSMessage,
    send_to_frontends: Any,
    connection_id: Any,
) -> dict[str, Any]:
    """Handle unknown message type - relay to frontend anyway.

    Args:
        message: Parsed WebSocket message.
        send_to_frontends: Function to relay to frontends.
        connection_id: Connection ID for logging.

    Returns:
        Warning response.
    """
    await send_to_frontends(
        {
            "type": message.type,
            **message.data,
            "timestamp": make_timestamp(),
        }
    )
    logger.warning(
        "unknown_message_type_relayed",
        connection_id=connection_id,
        message_type=message.type,
    )
    return {
        "type": "warning",
        "message": f"Unknown message type '{message.type}' - relayed to frontends anyway",
    }
