"""Expo push notification dispatch service.

Sends push notifications to mobile devices via the Expo Push API.
Called as a background task after workflow events are ingested.
"""

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push_device import PushDevice
from app.models.workflow_event import WorkflowEvent

logger = structlog.get_logger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Map event types to human-readable titles and notification categories
EVENT_DISPLAY = {
    "run_started": {"title": "Run Started", "category": "run"},
    "run_completed": {"title": "Run Completed", "category": "run"},
    "run_failed": {"title": "Run Failed", "category": "run"},
    "step_completed": {"title": "Step Completed", "category": "step"},
    "hitl_question_pending": {"title": "Action Required", "category": "hitl"},
    "runner_crashed": {"title": "Runner Crashed", "category": "runner"},
    "runner_recovered": {"title": "Runner Recovered", "category": "runner"},
    "build_failed": {"title": "Build Failed", "category": "build"},
    "verification_failed": {"title": "Verification Failed", "category": "verification"},
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

    if event_type == "hitl_question_pending" and run_id:
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


async def send_push_notifications(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
    priority: str = "default",
) -> None:
    """Send push notifications via Expo Push API.

    Sends to multiple tokens in a single batch request.
    Failures are logged but do not raise — this is fire-and-forget.
    """
    if not tokens:
        return

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "sound": "default" if priority == "high" else None,
            "priority": priority,
            "data": data or {},
        }
        for token in tokens
    ]

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

            if response.status_code == 200:
                result = response.json()
                # Check for individual ticket errors
                errors = [
                    t for t in result.get("data", []) if t.get("status") == "error"
                ]
                if errors:
                    logger.warning(
                        "push_notification_partial_failure",
                        total=len(tokens),
                        errors=len(errors),
                        error_details=[e.get("message") for e in errors[:3]],
                    )
                else:
                    logger.info(
                        "push_notifications_sent",
                        count=len(tokens),
                    )
            else:
                logger.warning(
                    "push_notification_api_error",
                    status=response.status_code,
                    body=response.text[:500],
                )
    except Exception as e:
        logger.warning(
            "push_notification_send_failed",
            error=str(e),
            token_count=len(tokens),
        )


async def dispatch_push_for_event(db: AsyncSession, event: WorkflowEvent) -> None:
    """Dispatch push notifications for a workflow event.

    Looks up the user's push tokens and sends a notification via Expo.
    This should be called as a background task after event ingestion.
    """
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

    await send_push_notifications(
        tokens=tokens,
        title=title,
        body=body,
        data=data,
        priority=priority,
    )
