"""Deliver spend alerts: Expo push to the operator's phone, and coord.

An alert ROW is the durable record (decision 6); each delivery is a
projection of it, tracked on the row and retried on later ticks. A send that
failed is never recorded as sent, and an accepted one is never recorded as
delivered until Expo's receipt says so (served policy ``ux-priorities``
``a-status-signal-must-observe-the-state-it-names``).

Push
----
* ``mtd_threshold`` and ``stale`` alerts push on their own
  (``collapse_id = spend-<rule>-<scope>-<period>``).
* ``daily_abs`` and ``spike`` alerts go into ONE digest push per tenant per
  UTC day (``collapse_id = spend-digest-<day>``): at current spend the $50
  daily rule fires every day, and one buzz a day is the budget. A daily or
  spike row that fires after today's digest was accepted waits, ``pending``,
  for tomorrow's.
* A ticket ``ok`` → ``accepted``; a later tick polls the receipts →
  ``delivered`` or ``failed``; ``DeviceNotRegistered`` deactivates that
  device. Recipients that cannot be read → ``unknown_recipients``; every
  recipient muted → ``muted``. Undelivered rows are retried for
  :data:`RETRY_WINDOW`.

Coord
-----
``POST /coord/spend-alerts`` for every new or resolved row: ``sent``;
``unsupported`` when coord answers 404/501 (the route is not deployed);
``disabled`` without a coord service credential; ``failed`` otherwise —
all but ``sent`` retried within the window.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import SpendAlert, SpendPushDelivery
from app.models.push_device import PushDevice
from app.services import push_notifications
from app.spend import recipients as recipients_module

logger = structlog.get_logger(__name__)

#: How long an undelivered alert keeps being retried.
RETRY_WINDOW = timedelta(hours=48)
#: Expo keeps receipts about a day; past this an accepted ticket stays
#: ``accepted`` (its delivery is UNKNOWN), and is no longer polled.
RECEIPT_WINDOW = timedelta(hours=26)
DIGEST_RULES = ("daily_abs", "spike")
SINGLE_RULES = ("mtd_threshold", "stale")
#: Statuses a later tick sends (again). ``failed`` is retried only while
#: ``push_attempts`` is under :data:`MAX_PUSH_ATTEMPTS` — and a failure Expo
#: reported in a RECEIPT (after it accepted the message) sets the attempts
#: to the cap, so it is terminal: the message was delivered to Expo once, and
#: resending would only repeat whatever refused it.
_RETRYABLE_PUSH = ("pending", "failed", "unknown_recipients")
MAX_PUSH_ATTEMPTS = 3
_RETRYABLE_COORD = ("pending", "failed", "unsupported", "disabled")
_DIGEST_LINES = 6
#: Expo's getReceipts takes at most 1000 ids per call.
_RECEIPT_BATCH = 1000


def money(micros: int | None) -> str:
    if micros is None:
        return "unknown"
    dollars = micros / 1_000_000
    if abs(dollars) >= 100:
        return f"${dollars:,.0f}"
    return f"${dollars:,.2f}"


def _day_label(raw: str | None) -> str:
    try:
        d = date.fromisoformat(raw or "")
    except ValueError:
        return raw or ""
    return f"{d:%b} {d.day}"


def _line(alert: SpendAlert) -> str:
    d = alert.detail or {}
    vendor = d.get("vendor") or "Spend"
    if alert.rule == "spike":
        median = d.get("median_micros")
        ratio = (
            f"{alert.observed_micros / median:.1f}×"
            if median and alert.observed_micros is not None
            else f"over {d.get('multiplier')}×"
        )
        return (
            f"{vendor} {alert.scope_key}: {money(alert.observed_micros)} on "
            f"{_day_label(alert.period_key)} ({ratio} its "
            f"{d.get('window_days')}-day median of {money(median)})"
        )
    if alert.rule == "daily_abs":
        so_far = "" if d.get("complete", True) else " so far"
        return (
            f"{vendor}: {money(alert.observed_micros)} on "
            f"{_day_label(alert.period_key)}{so_far} (over the "
            f"{money(alert.threshold_micros)} daily limit)"
        )
    if alert.rule == "mtd_threshold":
        return (
            f"{vendor}: month to date {money(alert.observed_micros)} of "
            f"{money(d.get('ceiling_micros'))} ({d.get('pct')}% of the ceiling)"
        )
    return f"{vendor}: spend figures unavailable — {d.get('reason') or 'stale'}"


def _url(alert: SpendAlert) -> str:
    day = alert.period_key if len(alert.period_key) == 10 else ""
    if not day:
        day = alert.fired_at.astimezone(UTC).date().isoformat()
    vendor = str(alert.vendor_id) if alert.vendor_id else ""
    return f"/financials?vendor={vendor}&day={day}"


def _single_message(alert: SpendAlert) -> tuple[str, str, str, str]:
    """``(title, body, priority, collapse_id)``."""
    d = alert.detail or {}
    vendor = d.get("vendor") or "Spend"
    provider = d.get("provider") or vendor
    collapse = (
        f"spend-{alert.rule}-{alert.vendor_key}-{alert.scope_key}-{alert.period_key}"
    )
    if alert.rule == "mtd_threshold":
        pct = int(d.get("pct") or alert.threshold_key)
        title = f"{vendor} spend at {pct}% of its monthly ceiling"
        body = f"{_line(alert)}, as reported by {provider}."
        return title, body, "high" if pct >= 100 else "default", collapse
    title = f"{vendor} spend data is stale"
    return title, _line(alert) + ".", "default", collapse


def _digest_message(alerts: list[SpendAlert], day: date) -> tuple[str, str, str, str]:
    spikes = [a for a in alerts if a.rule == "spike"]
    first = (spikes or alerts)[0]
    vendor = (first.detail or {}).get("vendor") or "Spend"
    if spikes:
        title = (
            f"{vendor} spend spike"
            if len(alerts) == 1
            else f"{vendor} spend spike (+{len(alerts) - 1} more)"
        )
    else:
        title = f"{vendor} daily spend over limit"
    lines = [_line(a) for a in alerts[:_DIGEST_LINES]]
    if len(alerts) > _DIGEST_LINES:
        lines.append(f"…and {len(alerts) - _DIGEST_LINES} more")
    # The month-to-date line the operator reads beside a spike, where a
    # ceiling is set.
    for a in alerts:
        d = a.detail or {}
        if d.get("ceiling_micros"):
            lines.append(
                f"Month to date {money(d.get('mtd_micros'))} of "
                f"{money(d.get('ceiling_micros'))} ({d.get('vendor')})."
            )
            break
    priority = "high" if spikes else "default"
    return title, "\n".join(lines), priority, f"spend-digest-{day.isoformat()}"


async def _send(
    db: AsyncSession,
    tenant_id: UUID,
    alerts: list[SpendAlert],
    devices: list[tuple[UUID, str]],
    *,
    kind: str,
    digest_day: date | None,
    title: str,
    body: str,
    priority: str,
    collapse_id: str,
    now: datetime,
) -> SpendPushDelivery:
    tokens = [token for _, token in devices]
    by_token = {token: device_id for device_id, token in devices}
    tickets = await push_notifications.send_push_notifications(
        tokens=tokens,
        title=title,
        body=body,
        data={"url": _url(alerts[0]), "kind": "spend_alert"},
        priority=priority,
        collapse_id=collapse_id,
    )
    stored = [
        {
            "push_device_id": str(by_token.get(t.token))
            if t.token in by_token
            else None,
            "ticket_id": t.ticket_id,
            "ticket_status": t.status,
            "ticket_error": t.error,
            "receipt_status": None,
            "receipt_error": None,
        }
        for t in tickets
    ]
    gone = [t.token for t in tickets if t.error == "DeviceNotRegistered"]
    if gone:
        await push_notifications.deactivate_push_tokens(db, gone)
    accepted = any(t.status == "ok" for t in tickets)
    errors = sorted({t.error or "error" for t in tickets if t.status != "ok"})
    delivery = SpendPushDelivery(
        tenant_id=tenant_id,
        kind=kind,
        digest_day=digest_day,
        collapse_id=collapse_id,
        title=title,
        body=body,
        status="accepted" if accepted else "failed",
        tickets=stored,
        detail=", ".join(errors) if errors else None,
        sent_at=now,
        created_by="spend_evaluate",
        updated_by="spend_evaluate",
    )
    db.add(delivery)
    await db.flush()
    for alert in alerts:
        alert.push_delivery_id = delivery.id
        alert.push_status = delivery.status
        alert.push_attempts = (alert.push_attempts or 0) + 1
        alert.push_detail = (
            None if accepted else f"no ticket accepted: {delivery.detail}"
        )
        alert.updated_at = now
    return delivery


async def _send_and_record(db: AsyncSession, *args: Any, **kwargs: Any) -> None:
    """Send, then COMMIT the delivery at once: the push is out, so its record
    must not ride on anything that could still roll back."""
    await _send(db, *args, **kwargs)
    await db.commit()


async def poll_receipts(db: AsyncSession, tenant_id: UUID, now: datetime) -> int:
    """Move accepted deliveries to delivered/failed from Expo's receipts."""
    deliveries = list(
        (
            await db.execute(
                select(SpendPushDelivery).where(
                    SpendPushDelivery.tenant_id == tenant_id,
                    SpendPushDelivery.status == "accepted",
                    SpendPushDelivery.sent_at >= now - RECEIPT_WINDOW,
                )
            )
        ).scalars()
    )
    pending_ids = [
        t["ticket_id"]
        for d in deliveries
        for t in d.tickets
        if t.get("ticket_id") and t.get("receipt_status") is None
    ]
    if not pending_ids:
        return 0
    receipts: dict[str, dict] = {}
    for start in range(0, len(pending_ids), _RECEIPT_BATCH):
        batch = await push_notifications.get_push_receipts(
            pending_ids[start : start + _RECEIPT_BATCH]
        )
        if batch is None:
            return 0  # the poll failed: UNKNOWN, retried next tick
        receipts.update(batch)
    unregistered: list[UUID] = []
    moved = 0
    for delivery in deliveries:
        tickets: list[dict[str, Any]] = []
        for ticket in delivery.tickets:
            ticket = dict(ticket)
            receipt = receipts.get(ticket.get("ticket_id") or "")
            if receipt is not None and ticket.get("receipt_status") is None:
                ticket["receipt_status"] = receipt.get("status")
                ticket["receipt_error"] = receipt.get("error")
                if receipt.get("error") == "DeviceNotRegistered" and ticket.get(
                    "push_device_id"
                ):
                    unregistered.append(UUID(ticket["push_device_id"]))
            tickets.append(ticket)
        delivery.tickets = tickets
        delivery.receipts_checked_at = now
        if any(t.get("receipt_status") == "ok" for t in tickets):
            status = "delivered"
        elif all(
            t.get("ticket_status") != "ok" or t.get("receipt_status") == "error"
            for t in tickets
        ):
            status = "failed"
        else:
            status = "accepted"
        if status != delivery.status:
            delivery.status = status
            moved += 1
            await db.execute(
                update(SpendAlert)
                .where(
                    SpendAlert.tenant_id == tenant_id,
                    SpendAlert.push_delivery_id == delivery.id,
                    SpendAlert.push_status == "accepted",
                )
                .values(
                    push_status=status,
                    push_detail=(
                        None if status == "delivered" else "every receipt was an error"
                    ),
                    # A receipt-level failure is terminal (see _RETRYABLE_PUSH).
                    **(
                        {"push_attempts": MAX_PUSH_ATTEMPTS}
                        if status == "failed"
                        else {}
                    ),
                    updated_at=now,
                )
            )
    if unregistered:
        await db.execute(
            update(PushDevice)
            .where(PushDevice.id.in_(unregistered))
            .values(is_active=False, updated_at=now)
        )
    await db.flush()
    return moved


async def push_pending(db: AsyncSession, tenant_id: UUID, now: datetime) -> None:
    alerts = list(
        (
            await db.execute(
                select(SpendAlert)
                .where(
                    SpendAlert.tenant_id == tenant_id,
                    SpendAlert.push_status.in_(_RETRYABLE_PUSH),
                    or_(
                        SpendAlert.push_status != "failed",
                        SpendAlert.push_attempts < MAX_PUSH_ATTEMPTS,
                    ),
                    SpendAlert.resolved_at.is_(None),
                    SpendAlert.fired_at >= now - RETRY_WINDOW,
                )
                .order_by(SpendAlert.fired_at, SpendAlert.rule, SpendAlert.scope_key)
            )
        ).scalars()
    )
    if not alerts:
        return
    today = now.astimezone(UTC).date()
    digest_sent_today = await db.scalar(
        select(SpendPushDelivery.id).where(
            SpendPushDelivery.tenant_id == tenant_id,
            SpendPushDelivery.kind == "digest",
            SpendPushDelivery.digest_day == today,
            SpendPushDelivery.status.in_(("accepted", "delivered")),
        )
    )
    singles = [a for a in alerts if a.rule in SINGLE_RULES]
    digest = [a for a in alerts if a.rule in DIGEST_RULES]
    if digest_sent_today is not None:
        digest = []  # one digest a day; these wait for tomorrow's
    if not singles and not digest:
        return

    who = await recipients_module.resolve_recipients(db, tenant_id)
    targets = singles + digest
    if who.status != "ok":
        for a in targets:
            a.push_status = "unknown_recipients"
            a.push_detail = who.detail
            a.updated_at = now
        return
    if not who.devices:
        status = "muted" if who.users and who.muted_users == who.users else "failed"
        detail = (
            "every recipient has muted spend alerts"
            if status == "muted"
            else who.detail or "no recipient has an active push device"
        )
        for a in targets:
            a.push_status = status
            a.push_detail = detail
            if status == "failed":
                a.push_attempts = (a.push_attempts or 0) + 1
            a.updated_at = now
        return

    for alert in singles:
        title, body, priority, collapse = _single_message(alert)
        await _send_and_record(
            db,
            tenant_id,
            [alert],
            who.devices,
            kind="single",
            digest_day=None,
            title=title,
            body=body,
            priority=priority,
            collapse_id=collapse,
            now=now,
        )
    if digest:
        title, body, priority, collapse = _digest_message(digest, today)
        await _send_and_record(
            db,
            tenant_id,
            digest,
            who.devices,
            kind="digest",
            digest_day=today,
            title=title,
            body=body,
            priority=priority,
            collapse_id=collapse,
            now=now,
        )
    await db.flush()


async def post_to_coord(db: AsyncSession, tenant_id: UUID, now: datetime) -> None:
    from app.services.coord_service_account import (
        CoordServiceAccountDisabledError,
        coord_service_account,
    )

    alerts = list(
        (
            await db.execute(
                select(SpendAlert).where(
                    SpendAlert.tenant_id == tenant_id,
                    SpendAlert.coord_status.in_(_RETRYABLE_COORD),
                    or_(
                        SpendAlert.fired_at >= now - RETRY_WINDOW,
                        SpendAlert.resolved_at >= now - RETRY_WINDOW,
                    ),
                )
            )
        ).scalars()
    )
    for alert in alerts:
        body = {
            "tenant_id": str(tenant_id),
            "alert_id": str(alert.id),
            "rule": alert.rule,
            "scope_key": alert.scope_key,
            "period_key": alert.period_key,
            "observed_micros": alert.observed_micros,
            "threshold_micros": alert.threshold_micros,
            "vendor": (alert.detail or {}).get("vendor"),
            "resolved": alert.resolved_at is not None,
        }
        try:
            status, _ = await coord_service_account.post_spend_alert(body)
        except CoordServiceAccountDisabledError:
            alert.coord_status = "disabled"
            alert.coord_detail = "COORD_ADMIN_SECRET unset"
            continue
        except Exception as exc:  # noqa: BLE001 — retried next tick
            alert.coord_status = "failed"
            alert.coord_detail = f"{type(exc).__name__}"
            continue
        if 200 <= status < 300:
            alert.coord_status, alert.coord_detail = "sent", None
        elif status in (404, 501):
            alert.coord_status = "unsupported"
            alert.coord_detail = f"coord answered HTTP {status}"
        else:
            alert.coord_status = "failed"
            alert.coord_detail = f"coord answered HTTP {status}"
        alert.updated_at = now
    await db.flush()


async def deliver_tenant(db: AsyncSession, tenant_id: UUID, now: datetime) -> None:
    """Receipts first (so a retried row sees its latest state), then push,
    then coord. Each step stands alone: one failing never blocks the rest."""
    for step in (poll_receipts, push_pending, post_to_coord):
        try:
            await step(db, tenant_id, now)
            # Committed per step (and per send, inside push_pending): what
            # went out is recorded before anything later can fail.
            await db.commit()
        except Exception:  # noqa: BLE001 — the row stands; next tick retries
            await db.rollback()
            logger.exception(
                "spend_delivery_step_failed",
                step=step.__name__,
                tenant_id=str(tenant_id),
            )
