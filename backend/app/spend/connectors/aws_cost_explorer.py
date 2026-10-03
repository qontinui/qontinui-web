"""AWS Cost Explorer → cost entries (plan Phase 8).

``ce:GetCostAndUsage`` with ``Granularity=DAILY``, the ``UnblendedCost`` and
``NetUnblendedCost`` metrics, grouped by ``SERVICE``. Each run reads the
trailing 3 days; the first run backfills 90. Every request is billed $0.01,
so a vendor is pulled at most twice a day (``min_pull_interval_hours=12``).

* ``amount_micros`` is ``NetUnblendedCost`` — the billed figure after credits
  and discounts (decision 4). ``gross_micros`` is ``UnblendedCost`` and
  ``discount_micros`` the difference; both are AWS's own numbers.
* ``source_ref = aws:<account>:<day>:<service>``.
* Cost Explorer's day is complete two days later (``complete_lag_days=2``,
  ``expected_lag_hours=48``): yesterday is read and stored, never trusted as
  complete.

**Two arms.** The *task-role* arm reads the hosting account's own bill with the
web task role, and serves ONLY the tenant named by
``SPEND_AWS_TASK_ROLE_TENANT_ID`` (policy ``aws-account-is-per-tenant``) —
:mod:`app.spend.credentials` enforces the pin. Every other tenant links a
cross-account role ARN plus ExternalId, and the pull ``sts:AssumeRole``s it.

Payload (both transports): ``{"account_id": "<12 digits>", "ResultsByTime":
[...]}`` — the ``ResultsByTime`` list verbatim from GetCostAndUsage, all pages.
"""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.spend.connectors import (
    ConnectorSpec,
    CredentialField,
    CredentialRejected,
    FetchContext,
    IngestQuery,
    NormalisedBatch,
    NormalisedEntry,
    NormaliseError,
    Pull,
    micros,
)

ENDPOINT = "ce:GetCostAndUsage DAILY UnblendedCost,NetUnblendedCost by SERVICE"
#: Cost Explorer's API lives in us-east-1 whatever region the caller is in.
CE_REGION = "us-east-1"
BACKFILL_DAYS = 90
TRAILING_DAYS = 3
_ROLE_ARN = re.compile(r"^arn:aws:iam::(\d{12}):role/[\w+=,.@/-]{1,512}$")
_ACCOUNT = re.compile(r"^\d{12}$")


# ---------------------------------------------------------------------------
# Normaliser (pure)
# ---------------------------------------------------------------------------


def _day(value: Any, where: str) -> date:
    if not isinstance(value, str):
        raise NormaliseError(f"{where} is not a date")
    try:
        return date.fromisoformat(value[:10])
    except ValueError as exc:
        raise NormaliseError(f"{where} is not a date") from exc


def _metric(metrics: Any, name: str, where: str) -> tuple[int, str]:
    if not isinstance(metrics, dict) or not isinstance(metrics.get(name), dict):
        raise NormaliseError(f"{where} lacks {name}")
    m = metrics[name]
    unit = m.get("Unit")
    if not isinstance(unit, str) or len(unit) != 3:
        raise NormaliseError(f"{where}.{name}.Unit is not a currency")
    return micros(m.get("Amount"), field_name=f"{where}.{name}.Amount"), unit.upper()


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    if not isinstance(raw, dict) or not isinstance(raw.get("ResultsByTime"), list):
        raise NormaliseError(
            "payload has no ResultsByTime — not a Cost Explorer response"
        )
    if not query.is_day:
        raise NormaliseError(
            "Cost Explorer payloads are day or range statements, not a month"
        )
    start, end = query.days()
    account = str(raw.get("account_id") or config.get("account_id") or "")
    if not _ACCOUNT.match(account):
        raise NormaliseError("payload names no 12-digit account_id")
    configured = config.get("account_id")
    if configured and str(configured) != account:
        raise NormaliseError(
            f"payload is for account {account}, the vendor is {configured}"
        )

    entries: dict[str, NormalisedEntry] = {}
    seen_days: set[date] = set()
    items = 0
    for index, result in enumerate(raw["ResultsByTime"]):
        where = f"ResultsByTime[{index}]"
        if not isinstance(result, dict):
            raise NormaliseError(f"{where} is not an object")
        period = result.get("TimePeriod") or {}
        day = _day(period.get("Start"), f"{where}.TimePeriod.Start")
        if not start <= day <= end:
            raise NormaliseError(f"{where} is dated {day}, outside {start}..{end}")
        seen_days.add(day)
        groups = result.get("Groups")
        if not isinstance(groups, list):
            raise NormaliseError(f"{where}.Groups is not a list")
        for g_index, group in enumerate(groups):
            gw = f"{where}.Groups[{g_index}]"
            keys = group.get("Keys") if isinstance(group, dict) else None
            if not isinstance(keys, list) or not keys or not isinstance(keys[0], str):
                raise NormaliseError(f"{gw}.Keys names no service")
            service = keys[0]
            metrics = group.get("Metrics")
            gross, gross_unit = _metric(metrics, "UnblendedCost", gw)
            net, net_unit = _metric(metrics, "NetUnblendedCost", gw)
            if gross_unit != net_unit:
                raise NormaliseError(f"{gw} mixes currencies")
            items += 1
            ref = f"aws:{account}:{day.isoformat()}:{service}"
            entries[ref] = NormalisedEntry(
                source_ref=ref,
                period_start=day,
                period_end=day,
                amount_micros=net,
                gross_micros=gross,
                discount_micros=gross - net,
                currency=net_unit,
                scope_label=service,
                sku=service,
                product=service,
                description=f"AWS {service}",
                category="cloud",
            )
    missing = []
    day = start
    while day <= end:
        if day not in seen_days:
            missing.append(day.isoformat())
        day += timedelta(days=1)
    if missing:
        # A day the payload does not state would read as $0. Refuse it.
        raise NormaliseError(f"payload states no result for {', '.join(missing)}")

    prefixes = []
    day = start
    while day <= end:
        prefixes.append(f"aws:{account}:{day.isoformat()}:")
        day += timedelta(days=1)
    return NormalisedBatch(
        granularity="range" if end > start else "day",
        period_start=start,
        period_end=end,
        items_seen=items,
        provider_endpoint=f"{ENDPOINT} {start}..{end}",
        entries=list(entries.values()),
        account=account,
        ref_prefix=prefixes[0],
        extra_ref_prefixes=prefixes[1:],
    )


# ---------------------------------------------------------------------------
# AWS calls (boto3, in a worker thread)
# ---------------------------------------------------------------------------


def _reject_from_boto(exc: Exception) -> CredentialRejected:
    """A boto error → a typed, value-free rejection."""
    from botocore.exceptions import (
        BotoCoreError,
        ClientError,
        EndpointConnectionError,
        NoCredentialsError,
    )

    if isinstance(exc, ClientError):
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in ("AccessDenied", "AccessDeniedException", "UnauthorizedOperation"):
            return CredentialRejected("forbidden", f"AWS refused the call ({code})")
        if code in ("InvalidClientTokenId", "ExpiredToken", "ExpiredTokenException"):
            return CredentialRejected("unauthorized", f"AWS refused the call ({code})")
        if code in ("LimitExceededException", "Throttling", "ThrottlingException"):
            return CredentialRejected(
                "rate_limited", f"AWS throttled the call ({code})"
            )
        return CredentialRejected(
            "provider_error", f"AWS answered {code or 'an error'}"
        )
    if isinstance(exc, NoCredentialsError):
        return CredentialRejected("not_configured", "no AWS credentials are available")
    if isinstance(exc, EndpointConnectionError):
        return CredentialRejected("unreachable", "AWS could not be reached")
    if isinstance(exc, BotoCoreError):
        return CredentialRejected("provider_error", type(exc).__name__)
    return CredentialRejected("provider_error", type(exc).__name__)


def _session_for(credential: dict[str, Any], arm: str) -> tuple[Any, str]:
    """A boto3 session and the account it reads, for this arm."""
    import boto3

    if arm == "task_role":
        session = boto3.session.Session()
        account = session.client("sts").get_caller_identity()["Account"]
        return session, str(account)
    role_arn = str(credential.get("role_arn") or "").strip()
    external_id = str(credential.get("external_id") or "").strip()
    match = _ROLE_ARN.match(role_arn)
    if not match:
        raise CredentialRejected(
            "invalid_credential", "role_arn is not an IAM role ARN"
        )
    if not external_id:
        raise CredentialRejected(
            "invalid_credential", "the credential has no external_id"
        )
    assumed = boto3.client("sts").assume_role(
        RoleArn=role_arn,
        RoleSessionName="qontinui-spend-collector",
        ExternalId=external_id,
        DurationSeconds=900,
    )["Credentials"]
    session = boto3.session.Session(
        aws_access_key_id=assumed["AccessKeyId"],
        aws_secret_access_key=assumed["SecretAccessKey"],
        aws_session_token=assumed["SessionToken"],
    )
    return session, match.group(1)


def _get_cost_and_usage(session: Any, start: date, end_exclusive: date) -> list[Any]:
    ce = session.client("ce", region_name=CE_REGION)
    results: list[Any] = []
    token: str | None = None
    while True:
        kwargs: dict[str, Any] = {
            "TimePeriod": {
                "Start": start.isoformat(),
                "End": end_exclusive.isoformat(),
            },
            "Granularity": "DAILY",
            "Metrics": ["UnblendedCost", "NetUnblendedCost"],
            "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}],
        }
        if token:
            kwargs["NextPageToken"] = token
        page = ce.get_cost_and_usage(**kwargs)
        results.extend(page.get("ResultsByTime") or [])
        token = page.get("NextPageToken")
        if not token:
            return results


def _read(
    credential: dict[str, Any], arm: str, start: date, end_exclusive: date
) -> dict[str, Any]:
    try:
        session, account = _session_for(credential, arm)
        results = _get_cost_and_usage(session, start, end_exclusive)
    except CredentialRejected:
        raise
    except Exception as exc:  # noqa: BLE001 — every boto failure is typed
        raise _reject_from_boto(exc) from exc
    return {"account_id": account, "ResultsByTime": results}


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    """Assume the linked role and read one day — one $0.01 request."""
    today = datetime.now(UTC).date()
    await asyncio.to_thread(
        _read,
        credential,
        "secret",
        today - timedelta(days=2),
        today - timedelta(days=1),
    )


async def fetch(ctx: FetchContext) -> list[Pull]:
    today = ctx.now.astimezone(UTC).date()
    days = BACKFILL_DAYS if ctx.last_pulled_day is None else TRAILING_DAYS
    start = today - timedelta(days=days)
    raw = await asyncio.to_thread(_read, ctx.credential, ctx.arm, start, today)
    return [Pull(IngestQuery.for_range(start, today - timedelta(days=1)), raw)]


SPEC = ConnectorSpec(
    key="aws_cost_explorer",
    provider="AWS",
    expected_lag_hours=48,
    complete_lag_days=2,
    provenance=(
        "as reported by AWS Cost Explorer (NetUnblendedCost; UnblendedCost as gross)"
    ),
    normalise=normalise,
    credential_fields=(
        CredentialField(
            "role_arn",
            "Role ARN",
            secret=False,
            help="arn:aws:iam::<your account>:role/<role> granting ce:GetCostAndUsage",
        ),
        CredentialField("external_id", "External ID"),
    ),
    credential_help=(
        "In YOUR AWS account, create an IAM role whose only permission is "
        'ce:GetCostAndUsage (Resource "*"), trusting the qontinui web task '
        "role with the External ID you choose here. The hosting tenant needs "
        "no link: it is read with the web task role."
    ),
    validate=validate,
    fetch=fetch,
    min_pull_interval_hours=12,
)
