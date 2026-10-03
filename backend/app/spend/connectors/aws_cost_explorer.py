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
import hashlib
import hmac
import re
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

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
#: The role NAME must start ``qontinui-spend-``: the web task role's
#: ``sts:AssumeRole`` grant is scoped to that name (qontinui-stack
#: ``task_cost_explorer``), so no other role in any account is assumable.
ROLE_PREFIX = "qontinui-spend-"
_ROLE_ARN = re.compile(r"^arn:aws:iam::(\d{12}):role/qontinui-spend-[\w+=,.@-]{1,48}$")
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

    # A fresh Session per call: the default session is not thread-safe, and
    # this runs in worker threads (a link can race a pull).
    session = boto3.session.Session()
    hosting = str(session.client("sts").get_caller_identity()["Account"])
    if arm == "task_role":
        return session, hosting
    role_arn = str(credential.get("role_arn") or "").strip()
    external_id = str(credential.get("external_id") or "").strip()
    match = _ROLE_ARN.match(role_arn)
    if not match:
        raise CredentialRejected(
            "invalid_credential",
            f"role_arn is not an IAM role ARN whose name starts {ROLE_PREFIX}",
        )
    if match.group(1) == hosting:
        # The hosting account's bill belongs to the pinned tenant alone, and
        # it reads it through the task-role arm (aws-account-is-per-tenant).
        raise CredentialRejected(
            "forbidden", "a role in the hosting AWS account cannot be linked"
        )
    if not external_id:
        raise CredentialRejected(
            "invalid_credential", "the credential has no external_id"
        )
    assumed = session.client("sts").assume_role(
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
        # From None: boto's frames hold the assumed-role credentials.
        raise _reject_from_boto(exc) from None
    return {"account_id": account, "ResultsByTime": results}


def external_id_for(tenant_id: UUID) -> str:
    """The ExternalId qontinui ISSUES to a tenant for its cross-account role.

    Server-derived (HMAC of the tenant id under :func:`_external_id_key`), so
    a tenant cannot choose another's: the confused-deputy guard AWS requires
    of a third party assuming customer roles. Not secret — the Link form
    shows it, and the tenant puts it in the role's trust policy.
    """
    digest = hmac.new(
        _external_id_key(),
        f"spend-aws-external-id:{tenant_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"qontinui-{digest[:32]}"


#: The HKDF label that separates this derivation from every other use of
#: SECRET_KEY. Changing it changes every tenant's ExternalId.
_EXTERNAL_ID_HKDF_INFO = b"qontinui/spend/aws-external-id/v1"


def _external_id_key() -> bytes:
    """The key ExternalIds are derived from.

    ``SPEND_EXTERNAL_ID_KEY`` when set; otherwise HKDF-SHA256 of
    ``SECRET_KEY`` under a fixed label, so the JWT signing key is never used
    directly. ROTATING EITHER CHANGES EVERY TENANT'S EXTERNALID: every linked
    cross-account role then refuses the assume until its trust policy is
    updated with the new value shown on the Link form.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    from app.core.config import settings

    dedicated = (settings.SPEND_EXTERNAL_ID_KEY or "").strip()
    if dedicated:
        return dedicated.encode("utf-8")
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_EXTERNAL_ID_HKDF_INFO,
    ).derive(settings.SECRET_KEY.encode("utf-8"))


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
    first = today - timedelta(days=BACKFILL_DAYS)
    if ctx.last_pulled_day is None:
        start = first
    else:
        # The trailing window, reaching back past any gap failed pulls left
        # (two days before the last pulled day, which was not yet complete).
        start = max(
            first,
            min(
                ctx.last_pulled_day - timedelta(days=2),
                today - timedelta(days=TRAILING_DAYS),
            ),
        )
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
            help="arn:aws:iam::<your account>:role/qontinui-spend-<name>",
        ),
    ),
    issued_fields=lambda tenant_id: {"external_id": external_id_for(tenant_id)},
    credential_help=(
        "In YOUR AWS account, create an IAM role named qontinui-spend-<anything> "
        'whose only permission is ce:GetCostAndUsage (Resource "*"), trusting '
        "the qontinui web task role with the External ID shown here (qontinui "
        "issues it for your project; it cannot be chosen). Link its ARN. The "
        "hosting tenant needs no link: it is read with the web task role."
    ),
    validate=validate,
    fetch=fetch,
    min_pull_interval_hours=12,
)
