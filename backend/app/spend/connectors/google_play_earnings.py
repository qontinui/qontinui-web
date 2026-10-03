"""Google Play earnings reports → cost entries (plan Phase 9, decision 11).

Play has no usage charges: Google's service fee is deducted FROM revenue, so it
exists only once the app earns. The monthly earnings report is a zipped CSV in
the developer's Cloud Storage bucket,
``gs://pubsite_prod_rev_<developer_id>/earnings/earnings_YYYYMM_*.zip``, read
with a service account that Play Console granted "View financial data".

* Only the **fee and refund** lines are stored as cost: ``Google fee``,
  ``Google fee refund`` and ``Charge refund``. Their ``Amount (Merchant
  Currency)`` is signed from the developer's side (a fee is negative), so the
  cost is its negation — a fee refund is a negative cost.
* Revenue (``Charge`` lines) is NEVER stored as spend, and never as negative
  spend. Its sum is kept as a fact and a notice, as context.
* One entry per (month, transaction type, merchant currency), dated to the
  report's month: ``source_ref = play:<developer>:<YYYYMM>:<transaction type>``
  (plus ``:<currency>`` for a currency other than USD). A month with no report
  yet is not pulled — it stays UNKNOWN, never $0.
* The spike rule is off for this vendor: fees follow revenue, and a spike in
  either is not a cost anomaly.

Payload (both transports): ``{"developer_id": "...", "month": "YYYYMM",
"files": [{"name": "...", "csv": "<the CSV text>"}]}``.

Column names are from Google's documentation of the earnings report; until a
real report is captured that is UNKNOWN in detail (the fixture says so).
"""

from __future__ import annotations

import calendar
import csv
import io
import re
import zipfile
from collections import defaultdict
from datetime import UTC, date, timedelta
from typing import Any
from urllib.parse import quote

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
    _google,
    _http,
    micros,
)

STORAGE = "https://storage.googleapis.com/storage/v1/b/{bucket}/o"
SCOPE = "https://www.googleapis.com/auth/devstorage.read_only"
COST_TYPES = ("Google fee", "Google fee refund", "Charge refund")
REVENUE_TYPE = "Charge"
TYPE_COLUMN = "Transaction Type"
AMOUNT_COLUMN = "Amount (Merchant Currency)"
CURRENCY_COLUMN = "Merchant Currency"
_BUCKET = re.compile(r"^(?:gs://)?([a-z0-9][a-z0-9._-]{1,220}[a-z0-9])/?$")
#: The largest zipped report read (a guard on a key with access to a big bucket).
MAX_REPORT_BYTES = 50 * 1024 * 1024


def _month(value: Any) -> tuple[date, date, str]:
    if not isinstance(value, str) or not re.fullmatch(r"\d{6}", value):
        raise NormaliseError("payload names no YYYYMM month")
    year, month = int(value[:4]), int(value[4:])
    if not 1 <= month <= 12:
        raise NormaliseError("payload month is not a month")
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    return start, end, value


def normalise(raw: Any, query: IngestQuery, config: dict[str, Any]) -> NormalisedBatch:
    if not isinstance(raw, dict) or not isinstance(raw.get("files"), list):
        raise NormaliseError("payload has no files list — not a Play earnings read")
    start, end, label = _month(raw.get("month"))
    if not query.is_day or query.days() != (start, end):
        raise NormaliseError(f"the query must name the report month {start}..{end}")
    developer = str(raw.get("developer_id") or config.get("developer_id") or "")
    if not developer:
        raise NormaliseError("payload names no developer_id")
    if not raw["files"]:
        raise NormaliseError(f"no earnings report for {label} — UNKNOWN, not $0")

    cost: dict[tuple[str, str], int] = defaultdict(int)
    revenue: dict[str, int] = defaultdict(int)
    rows = 0
    for f_index, item in enumerate(raw["files"]):
        if not isinstance(item, dict) or not isinstance(item.get("csv"), str):
            raise NormaliseError(f"files[{f_index}] has no csv text")
        reader = csv.DictReader(io.StringIO(item["csv"].lstrip("﻿")))
        missing = {TYPE_COLUMN, AMOUNT_COLUMN, CURRENCY_COLUMN} - set(
            reader.fieldnames or []
        )
        if missing:
            raise NormaliseError(f"files[{f_index}] lacks columns {sorted(missing)}")
        for r_index, row in enumerate(reader):
            rows += 1
            kind = (row.get(TYPE_COLUMN) or "").strip()
            currency = (row.get(CURRENCY_COLUMN) or "").strip().upper()
            where = f"files[{f_index}] row {r_index + 2}"
            if kind not in COST_TYPES and kind != REVENUE_TYPE:
                continue
            if len(currency) != 3:
                raise NormaliseError(f"{where} has no merchant currency")
            amount = micros(
                (row.get(AMOUNT_COLUMN) or "").replace(",", "").strip(),
                field_name=f"{where} {AMOUNT_COLUMN}",
            )
            if kind == REVENUE_TYPE:
                revenue[currency] += amount
            else:
                # Developer-side signs: a fee is negative. Cost is the negation.
                cost[(kind, currency)] -= amount

    entries = []
    for (kind, currency), amount in sorted(cost.items()):
        ref = f"play:{developer}:{label}:{kind}"
        if currency != "USD":
            ref += f":{currency}"
        entries.append(
            NormalisedEntry(
                source_ref=ref,
                period_start=start,
                period_end=end,
                amount_micros=amount,
                currency=currency,
                scope_label="Google Play",
                sku=kind,
                product="play",
                description=f"Google Play {kind.lower()} ({label})",
                category="saas",
            )
        )
    notices = [
        f"Play revenue in {label} (context, not spend): "
        f"{amount / 1_000_000:.2f} {currency}"
        for currency, amount in sorted(revenue.items())
    ]
    return NormalisedBatch(
        granularity="range",
        period_start=start,
        period_end=end,
        items_seen=rows,
        provider_endpoint=(
            f"gs://pubsite_prod_rev_{developer}/earnings/earnings_{label}_*.zip"
        ),
        entries=entries,
        account=developer,
        ref_prefix=f"play:{developer}:{label}:",
        facts={"revenue_micros": dict(revenue), "month": label},
        notices=notices,
    )


def _bucket(credential: dict[str, Any]) -> str:
    raw = str(credential.get("bucket") or "").strip()
    match = _BUCKET.match(raw)
    if not match:
        raise CredentialRejected(
            "invalid_credential", "bucket is not a Cloud Storage bucket (gs://…)"
        )
    return match.group(1)


def _developer(bucket: str) -> str:
    return bucket.removeprefix("pubsite_prod_rev_")


async def _list(
    token: str, bucket: str, prefix: str, limit: int = 100
) -> list[dict[str, Any]]:
    body = await _http.get_json(
        STORAGE.format(bucket=quote(bucket, safe="")),
        provider="Google Cloud Storage",
        headers={"Authorization": f"Bearer {token}"},
        params={"prefix": prefix, "maxResults": limit},
    )
    if not isinstance(body, dict):
        raise CredentialRejected(
            "invalid_response", "Cloud Storage answered no object list"
        )
    items = body.get("items") or []
    return [i for i in items if isinstance(i, dict) and isinstance(i.get("name"), str)]


async def _download(token: str, bucket: str, name: str) -> bytes:
    response = await _http.request(
        "GET",
        f"{STORAGE.format(bucket=quote(bucket, safe=''))}/{quote(name, safe='')}",
        provider="Google Cloud Storage",
        headers={"Authorization": f"Bearer {token}"},
        params={"alt": "media"},
    )
    if len(response.content) > MAX_REPORT_BYTES:
        raise CredentialRejected(
            "provider_error", "an earnings report is too large to read"
        )
    return response.content


def _csv_files(name: str, blob: bytes) -> list[dict[str, str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            out = []
            for member in archive.infolist():
                if not member.filename.lower().endswith(".csv"):
                    continue
                if member.file_size > MAX_REPORT_BYTES * 4:
                    raise CredentialRejected(
                        "provider_error", "an earnings report expands too large"
                    )
                out.append(
                    {
                        "name": f"{name}/{member.filename}",
                        "csv": archive.read(member).decode("utf-8-sig"),
                    }
                )
            return out
    except zipfile.BadZipFile as exc:
        raise CredentialRejected("invalid_response", f"{name} is not a zip") from exc


async def validate(credential: dict[str, Any], config: dict[str, Any]) -> None:
    bucket = _bucket(credential)
    token = await _google.access_token(credential, scope=SCOPE)
    await _list(token, bucket, "earnings/", limit=1)


def _months_to_pull(today: date, first: bool) -> list[date]:
    """The finished months whose report may be published by now."""
    months: list[date] = []
    cursor = today.replace(day=1)
    for _ in range(3 if first else 2):
        cursor = (cursor - timedelta(days=1)).replace(day=1)
        months.append(cursor)
    return sorted(months)


async def fetch(ctx: FetchContext) -> list[Pull]:
    bucket = _bucket(ctx.credential)
    token = await _google.access_token(ctx.credential, scope=SCOPE)
    today = ctx.now.astimezone(UTC).date()
    pulls: list[Pull] = []
    for month_start in _months_to_pull(today, ctx.last_pulled_day is None):
        label = month_start.strftime("%Y%m")
        objects = await _list(token, bucket, f"earnings/earnings_{label}")
        if not objects:
            continue  # not published yet: the month stays UNKNOWN
        files: list[dict[str, str]] = []
        for obj in objects:
            name = obj["name"]
            if not name.endswith(".zip"):
                continue
            files.extend(_csv_files(name, await _download(token, bucket, name)))
        month_end = month_start.replace(
            day=calendar.monthrange(month_start.year, month_start.month)[1]
        )
        pulls.append(
            Pull(
                IngestQuery.for_range(month_start, month_end),
                {"developer_id": _developer(bucket), "month": label, "files": files},
            )
        )
    return pulls


SPEC = ConnectorSpec(
    key="google_play_earnings",
    provider="Google Play",
    # Monthly earnings reports land days after the month ends.
    expected_lag_hours=24 * 35,
    provenance="as reported by Google Play earnings reports (fees only)",
    normalise=normalise,
    spike_rule=False,
    credential_fields=(
        CredentialField("service_account_json", "Service-account JSON key"),
        CredentialField(
            "bucket",
            "Reports bucket",
            secret=False,
            help="gs://pubsite_prod_rev_<developer id>/ (Play Console -> Download reports -> Financial -> Copy Cloud Storage URI)",
        ),
    ),
    credential_help=(
        "Optional — only needed once the app earns revenue. Create a service "
        "account with a JSON key; in Play Console -> Users and permissions, "
        "invite its email with ONLY 'View financial data, orders, and "
        "cancellation survey responses' for all apps. Access can take 24 h to "
        "propagate."
    ),
    validate=validate,
    fetch=fetch,
    min_pull_interval_hours=24,
)
