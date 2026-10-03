"""Expo push notification dispatch service.

Sends push notifications to mobile devices via the Expo Push API.
Called as a background task after workflow events are ingested.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import structlog
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push_device import PushDevice
from app.models.workflow_event import WorkflowEvent, is_telemetry

logger = structlog.get_logger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"

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


@dataclass(frozen=True)
class PushTicket:
    """Expo's answer for ONE message — accepted for delivery, or refused.

    ``status == "ok"`` means Expo ACCEPTED the message (it carries
    ``ticket_id``); it does not mean a phone showed it. Only a receipt
    (:func:`get_push_receipts`) says that. ``error`` is Expo's
    ``details.error`` (``DeviceNotRegistered``…), or this module's own
    ``transport`` / ``http_<status>`` / ``no_ticket`` when no ticket came back.
    """

    token: str
    status: str
    ticket_id: str | None = None
    error: str | None = None
    message: str | None = None


def _refused_all(tokens: list[str], error: str, message: str) -> list[PushTicket]:
    return [
        PushTicket(token=t, status="error", error=error, message=message)
        for t in tokens
    ]


async def send_push_notifications(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
    priority: str = "default",
    collapse_id: str | None = None,
) -> list[PushTicket]:
    """Send push notifications via Expo Push API and return one ticket per token.

    Sends to multiple tokens in a single batch request. Never raises: a
    transport failure or a non-200 answer comes back as an ``error`` ticket
    for every token, so a caller can record honestly that nothing was
    accepted (served policy ``ux-priorities``
    ``a-status-signal-must-observe-the-state-it-names``).

    Args:
        collapse_id: If set, newer notifications with the same collapse_id
            replace older ones on the device (maps to Expo's ``_collapseId``
            / APNs ``apns-collapse-id`` / FCM ``collapse_key``).
    """
    if not tokens:
        return []

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

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
    except Exception as e:  # noqa: BLE001 — reported as error tickets
        logger.warning(
            "push_notification_send_failed",
            error=type(e).__name__,
            token_count=len(tokens),
        )
        return _refused_all(tokens, "transport", type(e).__name__)

    if response.status_code != 200:
        logger.warning(
            "push_notification_api_error",
            status=response.status_code,
            body=response.text[:500],
        )
        return _refused_all(tokens, f"http_{response.status_code}", response.text[:200])

    try:
        raw_tickets = response.json().get("data", [])
    except ValueError:
        raw_tickets = []
    if not isinstance(raw_tickets, list):
        raw_tickets = []
    tickets: list[PushTicket] = []
    for index, token in enumerate(tokens):
        raw = raw_tickets[index] if index < len(raw_tickets) else None
        if not isinstance(raw, dict):
            tickets.append(PushTicket(token=token, status="error", error="no_ticket"))
        elif raw.get("status") == "ok":
            tickets.append(
                PushTicket(token=token, status="ok", ticket_id=raw.get("id"))
            )
        else:
            details = raw.get("details") or {}
            tickets.append(
                PushTicket(
                    token=token,
                    status="error",
                    error=(details.get("error") if isinstance(details, dict) else None)
                    or "error",
                    message=raw.get("message"),
                )
            )
    errors = [t for t in tickets if t.status != "ok"]
    if errors:
        logger.warning(
            "push_notification_partial_failure",
            total=len(tokens),
            errors=len(errors),
            error_details=[e.error for e in errors[:3]],
        )
    else:
        logger.info("push_notifications_sent", count=len(tokens))
    return tickets


async def get_push_receipts(ticket_ids: list[str]) -> dict[str, dict] | None:
    """Expo's receipts for these tickets: ``{ticket_id: {"status": "ok"}}`` or
    ``{"status": "error", "error": "DeviceNotRegistered", "message": …}``.

    A ticket absent from the answer has no receipt YET (Expo publishes them
    within minutes and keeps them about a day). ``None`` means the poll itself
    failed — UNKNOWN, not "no receipts".
    """
    if not ticket_ids:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                EXPO_RECEIPTS_URL,
                json={"ids": ticket_ids},
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
        if response.status_code != 200:
            logger.warning("push_receipts_api_error", status=response.status_code)
            return None
        data = response.json().get("data", {})
    except Exception as e:  # noqa: BLE001 — UNKNOWN, retried next tick
        logger.warning("push_receipts_failed", error=type(e).__name__)
        return None
    if not isinstance(data, dict):
        return None
    out: dict[str, dict] = {}
    for ticket_id, receipt in data.items():
        if not isinstance(receipt, dict):
            continue
        details = receipt.get("details") or {}
        out[ticket_id] = {
            "status": receipt.get("status"),
            "error": details.get("error") if isinstance(details, dict) else None,
            "message": receipt.get("message"),
        }
    return out


async def deactivate_push_tokens(db: AsyncSession, tokens: list[str]) -> int:
    """Mark these tokens inactive — Expo said the device is no longer
    registered, so sending to them again only spends a ticket."""
    if not tokens:
        return 0
    result = await db.execute(
        update(PushDevice)
        .where(PushDevice.push_token.in_(tokens), PushDevice.is_active.is_(True))
        .values(is_active=False, updated_at=datetime.now(UTC))
    )
    count = int(getattr(result, "rowcount", 0) or 0)
    if count:
        logger.info(
            "push_devices_deactivated", count=count, reason="DeviceNotRegistered"
        )
    return count


async def dispatch_push_for_event(
    db: AsyncSession, event: WorkflowEvent
) -> list[PushTicket]:
    """Dispatch push notifications for a workflow event.

    Looks up the user's push tokens and sends a notification via Expo.
    This should be called as a background task after event ingestion.

    Telemetry event types (``is_telemetry``) never send a push: they return
    before the token lookup. Returns Expo's per-token tickets (empty when
    nothing was sent); a ticket naming ``DeviceNotRegistered`` deactivates
    that device.
    """
    if is_telemetry(str(event.event_type)):
        logger.debug(
            "push_skipped_telemetry_event",
            user_id=event.user_id,
            event_type=event.event_type,
        )
        return []

    tokens = await get_user_push_tokens(db, event.user_id)
    if not tokens:
        logger.debug(
            "no_push_tokens",
            user_id=event.user_id,
            event_type=event.event_type,
        )
        return []

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

    tickets = await send_push_notifications(
        tokens=tokens,
        title=title,
        body=body,
        data=data,
        priority=priority,
        collapse_id=collapse_id,
    )
    # A ticket can already say the device is gone; stop sending to it.
    if isinstance(tickets, list):
        gone = [
            t.token
            for t in tickets
            if isinstance(t, PushTicket) and t.error == "DeviceNotRegistered"
        ]
        if gone:
            await deactivate_push_tokens(db, gone)
            await db.commit()
    return tickets if isinstance(tickets, list) else []
