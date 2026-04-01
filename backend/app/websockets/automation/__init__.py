"""Automation WebSocket modules for real-time runner communication.

This package provides modular components for handling WebSocket automation:

- ConnectionHandler: WebSocket connection lifecycle management
- MessageRouter: Message type routing and dispatch
- SessionManager: Automation session state management
- message_handlers: Input events and tree event storage
- screenshot_handler: Screenshot upload and S3 storage
- issue_handlers: Issue detection and sync
- relay_handlers: Frontend relay handlers
- schemas: WebSocket message type definitions
"""

from app.websockets.automation.connection_handler import ConnectionHandler
from app.websockets.automation.message_handlers import (
                                                        handle_input_event,
                                                        handle_screenshot,
                                                        store_tree_event,
)
from app.websockets.automation.message_router import MessageRouter
from app.websockets.automation.schemas import WSMessage, make_timestamp
from app.websockets.automation.session_manager import SessionManager, SessionState

__all__ = [
    # Connection handling
    "ConnectionHandler",
    # Message routing
    "MessageRouter",
    # Session management
    "SessionManager",
    "SessionState",
    # Message handlers
    "handle_input_event",
    "handle_screenshot",
    "store_tree_event",
    # Schemas
    "WSMessage",
    "make_timestamp",
]
