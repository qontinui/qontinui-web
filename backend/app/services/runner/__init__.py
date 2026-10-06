"""Runner connection management services."""

from app.services.runner.command_relay import (
    CommandRelayService,
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
)
from app.services.runner.connection_registry import WebSocketConnectionRegistry
from app.services.runner.device_selector import (
    device_bridge_503_no_device,
    dispatch_or_http_error,
    get_owned_runner_or_404,
    pick_active_device_for_user,
    # Legacy aliases preserved for in-flight migrations of HTTP handlers.
    pick_active_runner_for_user,
    resolve_runner_for_request,
    runner_bridge_503_no_runner,
)
from app.services.runner.event_publisher import RunnerEventPublisher
from app.services.runner.state_repository import RunnerStateRepository

__all__ = [
    "WebSocketConnectionRegistry",
    "RunnerStateRepository",
    "CommandRelayService",
    "RunnerEventPublisher",
    "RunnerCommandTimeoutError",
    "RunnerNotConnectedError",
    "pick_active_device_for_user",
    "device_bridge_503_no_device",
    "get_owned_runner_or_404",
    "resolve_runner_for_request",
    "dispatch_or_http_error",
    "pick_active_runner_for_user",
    "runner_bridge_503_no_runner",
]
