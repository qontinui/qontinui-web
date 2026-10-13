"""Expo push notification dispatch service.

Sends push notifications to mobile devices via the Expo Push API.
Called as a background task after workflow events are ingested
(:func:`dispatch_push_for_event`, fire-and-forget), and by coord through
``POST /api/v1/internal/coord-push`` (:func:`send_push_notifications_with_result`,
which reports per-request counts so coord can record the item's push state).
"""

from dataclasses import dataclass, field

import httpx
import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push_device import PushDevice
from app.models.workflow_event import WorkflowEvent, is_telemetry

logger = structlog.get_logger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Map event types to human-readable titles and notification categories
EVENT_DISPLAY = {
    "run_started": {"title": "Run Started", "category": "run"},
    "run_completed": {"title": "Run Completed", "category": "run"},
    "run_failed": {"title": "Run Failed", "category": "run"},
    "session_completed": {"title": "Session Completed", "category": "session"},
    "terminal_exited": {"title": "Terminal Exited", "category": "terminal"},
    "step_completed": {"title": "Step Completed", "category": "step"},
    "hitl_question_pending": {"title": "Action Required", "category": "hitl"},
    "runner_crashed": {"title": "Runner Crashed", "category": "runner"},
    "runner_recovered": {"title": "Runner Recovered", "category": "runner"},
    "build_failed": {"title": "Build Failed", "category": "build"},
    "verification_failed": {"title": "Verification Failed", "category": "verification"},
    "phase_completed": {"title": "Phase Completed", "category": "phase"},
}

# Event types that warrant high-priority notifications
HIGH_PRIORITY_EVENTS = {
    "run_failed",
    "hitl_question_pending",
    "runner_crashed",
    "build_failed",
    "verification_failed",
}


def build_deep_link(event: WorkflowEvent) -> str:
    """Build a deep link URL for the notification.

    Returns an Expo deep link that the mobile app can handle to navigate
    to the relevant screen.
    """
    event_type = event.event_type
    run_id = event.run_id

    if event_type == "terminal_exited":
        return "qontinui://terminal"
    elif event_type == "hitl_question_pending" and run_id:
        return f"qontinui://run/{run_id}/hitl"
    elif run_id:
        return f"qontinui://run/{run_id}"
    else:
        return "qontinui://events"


async def get_user_push_tokens(db: AsyncSession, user_id) -> list[str]:
    """Get all active push tokens for a user."""
    result = await db.execute(
        select(PushDevice.push_token).where(
            PushDevice.user_id == user_id,
            PushDevice.is_active == True,  # noqa: E712
        )
    )
    return [row[0] for row in result.fetchall()]


@dataclass
class PushResult:
    """What one Expo send actually achieved, counted from Expo's tickets.

    ``accepted`` counts tickets with ``status: "ok"`` — Expo ACCEPTED the
    message, which is not proof the phone displayed it (receipts are not
    polled). ``failed`` counts every message that did not get an ``ok``
    ticket, including the whole batch on a network error or a non-200.
    ``deactivated`` counts tokens switched to ``is_active = False`` because
    their ticket said ``DeviceNotRegistered``. ``errors`` holds at most
    :data:`MAX_REPORTED_ERRORS` human-readable messages, first-seen order.
    """

    devices: int = 0
    accepted: int = 0
    failed: int = 0
    deactivated: int = 0
    errors: list[str] = field(default_factory=list)


MAX_REPORTED_ERRORS = 3

# Expo's documented ceiling on messages per push request.
EXPO_MAX_MESSAGES_PER_REQUEST = 100

# Expo's ticket ``details.error`` for a token that no longer addresses an
# installed app. The token can never succeed again, so it is deactivated.
DEVICE_NOT_REGISTERED = "DeviceNotRegistered"


def _build_messages(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None,
    priority: str,
    collapse_id: str | None,
) -> list[dict]:
    messages = []
    for token in tokens:
        msg: dict = {
            "to": token,
            "title": title,
            "body": body,
            "sound": "default" if priority == "high" else None,
            "priority": priority,
            "data": data or {},
        }
        if collapse_id:
            msg["_collapseId"] = collapse_id
        messages.append(msg)
    return messages


def _add_error(result: PushResult, message: str) -> None:
    if len(result.errors) < MAX_REPORTED_ERRORS:
        result.errors.append(message)


async def _deactivate_tokens(db: AsyncSession, tokens: list[str]) -> int:
    """Set ``is_active = False`` on every still-active row for ``tokens``."""
    result = await db.execute(
        update(PushDevice)
        .where(
            PushDevice.push_token.in_(tokens),
            PushDevice.is_active == True,  # noqa: E712
        )
        .values(is_active=False)
    )
    await db.commit()
    return int(getattr(result, "rowcount", 0) or 0)


async def _send_chunk(
    client: httpx.AsyncClient,
    tokens: list[str],
    messages: list[dict],
    result: PushResult,
    dead_tokens: list[str],
) -> None:
    """POST one chunk (<= :data:`EXPO_MAX_MESSAGES_PER_REQUEST`) and fold its
    tickets into ``result``. Tickets are positional WITHIN the chunk."""
    try:
        response = await client.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
    except Exception as e:
        result.failed += len(tokens)
        _add_error(result, f"expo request failed: {type(e).__name__}: {e}")
        logger.warning(
            "push_notification_send_failed", error=str(e), token_count=len(tokens)
        )
        return

    if response.status_code != 200:
        result.failed += len(tokens)
        _add_error(
            result, f"expo answered HTTP {response.status_code}: {response.text[:200]}"
        )
        logger.warning(
            "push_notification_api_error",
            status=response.status_code,
            body=response.text[:500],
        )
        return

    try:
        payload = response.json()
    except ValueError:
        payload = None
    tickets = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(tickets, list):
        result.failed += len(tokens)
        request_errors = (
            payload.get("errors") if isinstance(payload, dict) else None
        ) or []
        reported = False
        for err in request_errors:
            if isinstance(err, dict):
                _add_error(result, str(err.get("message") or err.get("code")))
                reported = True
        if not reported:
            _add_error(result, "expo answered 200 without a ticket list")
        logger.warning("push_notification_no_tickets", body=response.text[:500])
        return

    for index, token in enumerate(tokens):
        ticket = tickets[index] if index < len(tickets) else None
        if isinstance(ticket, dict) and ticket.get("status") == "ok":
            result.accepted += 1
            continue
        result.failed += 1
        if not isinstance(ticket, dict):
            _add_error(result, "expo returned no ticket for a message")
            continue
        details = ticket.get("details")
        error_code = details.get("error") if isinstance(details, dict) else None
        _add_error(
            result, str(ticket.get("message") or error_code or "expo ticket error")
        )
        if error_code == DEVICE_NOT_REGISTERED:
            dead_tokens.append(token)


async def send_push_notifications_with_result(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
    priority: str = "default",
    collapse_id: str | None = None,
    *,
    db: AsyncSession | None = None,
) -> PushResult:
    """Send via the Expo Push API and report what happened.

    Expo accepts at most :data:`EXPO_MAX_MESSAGES_PER_REQUEST` messages per
    request, so the tokens are sent in chunks of that size and the per-chunk
    results are summed. Never raises for a delivery failure: a network error
    or a non-200 marks every message of THAT chunk failed and records the
    reason in ``errors``. Tickets are POSITIONAL to each chunk's message list
    (Expo's contract), which is how a ``DeviceNotRegistered`` ticket is mapped
    back to its token.

    ``db`` — when given, tokens whose ticket reports ``DeviceNotRegistered``
    are deactivated in that session (and committed). A failed deactivation is
    rolled back and recorded in ``errors`` rather than raised: the push has
    already been accepted, and a 5xx here would make coord retry it as a
    duplicate. Without ``db`` nothing is written, which is the
    fire-and-forget caller's behaviour.

    Args:
        collapse_id: If set, newer notifications with the same collapse_id
            replace older ones on the device (maps to Expo's ``_collapseId``
            / APNs ``apns-collapse-id`` / FCM ``collapse_key``).
    """
    result = PushResult(devices=len(tokens))
    if not tokens:
        return result

    messages = _build_messages(tokens, title, body, data, priority, collapse_id)
    dead_tokens: list[str] = []
    step = EXPO_MAX_MESSAGES_PER_REQUEST
    async with httpx.AsyncClient(timeout=10.0) as client:
        for start in range(0, len(tokens), step):
            await _send_chunk(
                client,
                tokens[start : start + step],
                messages[start : start + step],
                result,
                dead_tokens,
            )

    if dead_tokens and db is not None:
        try:
            result.deactivated = await _deactivate_tokens(db, dead_tokens)
        except Exception as e:
            try:
                await db.rollback()
            except Exception as rollback_error:
                logger.warning(
                    "push_token_deactivation_rollback_failed",
                    error=str(rollback_error),
                )
            _add_error(result, f"token deactivation failed: {type(e).__name__}")
            logger.warning(
                "push_token_deactivation_failed",
                error=str(e),
                token_count=len(dead_tokens),
            )

    if result.failed:
        logger.warning(
            "push_notification_partial_failure",
            total=len(tokens),
            errors=result.failed,
            error_details=result.errors,
            deactivated=result.deactivated,
        )
    else:
        logger.info("push_notifications_sent", count=len(tokens))
    return result


async def send_push_notifications(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
    priority: str = "default",
    collapse_id: str | None = None,
) -> None:
    """Fire-and-forget send — the workflow-event path's original contract.

    A thin wrapper over :func:`send_push_notifications_with_result` with no
    database session, so it writes nothing (no token deactivation), never
    raises, and returns nothing. Failures are logged by the callee.
    """
    await send_push_notifications_with_result(
        tokens,
        title,
        body,
        data=data,
        priority=priority,
        collapse_id=collapse_id,
    )


async def dispatch_push_for_event(db: AsyncSession, event: WorkflowEvent) -> None:
    """Dispatch push notifications for a workflow event.

    Looks up the user's push tokens and sends a notification via Expo.
    This should be called as a background task after event ingestion.

    Telemetry event types (``is_telemetry``) never send a push: they return
    before the token lookup.
    """
    if is_telemetry(str(event.event_type)):
        logger.debug(
            "push_skipped_telemetry_event",
            user_id=event.user_id,
            event_type=event.event_type,
        )
        return

    tokens = await get_user_push_tokens(db, event.user_id)
    if not tokens:
        logger.debug(
            "no_push_tokens",
            user_id=event.user_id,
            event_type=event.event_type,
        )
        return

    event_type: str = str(event.event_type)
    display = EVENT_DISPLAY.get(
        event_type, {"title": "Workflow Event", "category": "other"}
    )

    title = f"{display['title']} — {event.runner_name}"
    body: str = str(event.summary)
    deep_link = build_deep_link(event)
    priority = "high" if event_type in HIGH_PRIORITY_EVENTS else "default"

    data = {
        "url": deep_link,
        "event_type": event_type,
        "event_id": str(event.id),
        "runner_name": event.runner_name,
    }
    if event.run_id:
        data["run_id"] = event.run_id

    # Collapse notifications so the device shows one updating notification
    # instead of N separate ones.
    collapse_id = None
    if event_type == "session_completed" and event.run_id:
        collapse_id = f"session-completed-{event.run_id}"
    elif event_type == "terminal_exited" and event.device_id:
        collapse_id = f"terminal-exited-{event.device_id}"

    await send_push_notifications(
        tokens=tokens,
        title=title,
        body=body,
        data=data,
        priority=priority,
        collapse_id=collapse_id,
    )
