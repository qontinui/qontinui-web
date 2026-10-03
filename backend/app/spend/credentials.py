"""The spend connector credential vault (plan Phase 7, decision 7).

A tenant links a provider account through the "Link account" form. The value
is validated with ONE live provider call (the connector's ``validate``), then
stored in AWS Secrets Manager as
``qontinui/<ENVIRONMENT>/web/spend/<tenant_id>/<connector>`` — the path the
web task role's ``task_spend_secrets`` grant is scoped to (qontinui-stack
``aws/modules/web``). From then on the product only ever reports
``linked``, ``not_linked`` or ``error:<typed reason>``.

**A credential value is never returned, logged, or put in a database row.**
Errors carry a typed reason and a value-free sentence; the change log records
that a link happened, never what was linked. The server pull reads the value
fresh through :func:`resolve`; other reads (status, the summary) use an
in-process cache of five minutes for a present value — absence is never
cached, and a vault failure is remembered for 60 seconds.

**The AWS task-role arm** (Phase 8) needs no stored value: the web task role
itself reads the hosting account's Cost Explorer. It serves exactly one
tenant — ``SPEND_AWS_TASK_ROLE_TENANT_ID`` — and every other tenant's
``aws_cost_explorer`` resolves to "not linked" unless it linked its own
cross-account role (policy ``aws-account-is-per-tenant``).
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

import structlog

from app.spend.connectors import CONNECTORS, CredentialRejected

logger = structlog.get_logger(__name__)

#: How long a resolved credential is reused in process. Short, because the
#: cache is per replica: an unlink or re-link on another replica reaches this
#: one within this bound. Absence is never cached, and the server pull always
#: reads the vault fresh.
CACHE_SECONDS = 300.0
#: How long a vault failure is remembered, so a degraded Secrets Manager does
#: not stall every summary read.
ERROR_CACHE_SECONDS = 60.0
#: The largest single field value accepted (a service-account key is ~2.4 KB).
MAX_FIELD_CHARS = 16_384
AWS_TASK_ROLE_CONNECTOR = "aws_cost_explorer"


class StoreUnavailable(Exception):
    """The vault itself could not answer. ``reason`` is typed and value-free:
    ``store_unavailable`` | ``store_forbidden`` | ``store_error``."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


class SecretStore(Protocol):
    async def get(self, name: str) -> str | None: ...

    async def put(self, name: str, value: str) -> None: ...

    async def delete(self, name: str) -> bool: ...


class DisabledStore:
    """No vault in this environment: nothing is linked, and linking refuses."""

    async def get(self, name: str) -> str | None:
        return None

    async def put(self, name: str, value: str) -> None:
        raise StoreUnavailable(
            "store_unavailable", "this environment has no credential vault"
        )

    async def delete(self, name: str) -> bool:
        return False


class MemoryStore:
    """An in-process vault — tests only."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def get(self, name: str) -> str | None:
        return self.values.get(name)

    async def put(self, name: str, value: str) -> None:
        self.values[name] = value

    async def delete(self, name: str) -> bool:
        return self.values.pop(name, None) is not None


class AwsSecretsManagerStore:
    """Secrets Manager, through the web task role. Calls run in a worker
    thread (boto3 is synchronous)."""

    def __init__(self, region: str) -> None:
        self.region = region
        self._client: Any = None

    def _sm(self) -> Any:
        if self._client is None:
            import boto3
            from botocore.config import Config

            self._client = boto3.session.Session().client(
                "secretsmanager",
                region_name=self.region,
                config=Config(
                    connect_timeout=2,
                    read_timeout=5,
                    retries={"max_attempts": 2, "mode": "standard"},
                ),
            )
        return self._client

    @staticmethod
    def _translate(exc: Exception) -> StoreUnavailable:
        from botocore.exceptions import (
            ClientError,
            EndpointConnectionError,
            NoCredentialsError,
        )

        if isinstance(exc, ClientError):
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in ("AccessDeniedException", "AccessDenied"):
                return StoreUnavailable("store_forbidden", code)
            return StoreUnavailable("store_error", code or "ClientError")
        if isinstance(exc, NoCredentialsError | EndpointConnectionError):
            return StoreUnavailable("store_unavailable", type(exc).__name__)
        return StoreUnavailable("store_error", type(exc).__name__)

    @staticmethod
    def _code(exc: Exception) -> str:
        from botocore.exceptions import ClientError

        if isinstance(exc, ClientError):
            return str(exc.response.get("Error", {}).get("Code", ""))
        return ""

    def _get(self, name: str) -> str | None:
        try:
            answer = self._sm().get_secret_value(SecretId=name)
        except Exception as exc:  # noqa: BLE001 — translated, value-free
            # Absent, or scheduled for deletion: not linked.
            if self._code(exc) in (
                "ResourceNotFoundException",
                "InvalidRequestException",
            ):
                return None
            raise self._translate(exc) from None
        value = answer.get("SecretString")
        return value if isinstance(value, str) else None

    def _put(self, name: str, value: str) -> None:
        try:
            try:
                described = self._sm().describe_secret(SecretId=name)
            except Exception as exc:  # noqa: BLE001
                if self._code(exc) != "ResourceNotFoundException":
                    raise
                described = None
            if described is None or described.get("DeletedDate"):
                self._create(name, value)
            else:
                self._sm().put_secret_value(SecretId=name, SecretString=value)
        except StoreUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001 — translated, value-free
            raise self._translate(exc) from None

    def _create(self, name: str, value: str) -> None:
        # A secret deleted without recovery a moment ago may still be
        # finishing its deletion; CreateSecret then answers
        # InvalidRequestException for a few seconds. Retry briefly.
        for attempt in range(4):
            try:
                self._sm().create_secret(
                    Name=name,
                    SecretString=value,
                    Description="qontinui spend connector credential",
                )
                return
            except Exception as exc:  # noqa: BLE001
                if self._code(exc) != "InvalidRequestException" or attempt == 3:
                    raise
                time.sleep(2.0 * (attempt + 1))

    def _delete(self, name: str) -> bool:
        try:
            # Without recovery, so a re-link can CreateSecret the same name.
            self._sm().delete_secret(SecretId=name, ForceDeleteWithoutRecovery=True)
        except Exception as exc:  # noqa: BLE001 — translated, value-free
            if self._code(exc) == "ResourceNotFoundException":
                return False
            raise self._translate(exc) from None
        return True

    async def get(self, name: str) -> str | None:
        return await asyncio.to_thread(self._get, name)

    async def put(self, name: str, value: str) -> None:
        await asyncio.to_thread(self._put, name, value)

    async def delete(self, name: str) -> bool:
        return await asyncio.to_thread(self._delete, name)


_store: SecretStore | None = None
#: (tenant, connector) -> (monotonic expiry, value). Only PRESENT values.
_cache: dict[tuple[UUID, str], tuple[float, dict[str, Any]]] = {}
#: (tenant, connector) -> (monotonic expiry, the vault's failure).
_errors: dict[tuple[UUID, str], tuple[float, StoreUnavailable]] = {}


def _settings() -> Any:
    from app.core.config import settings

    return settings


def get_store() -> SecretStore:
    global _store
    if _store is None:
        s = _settings()
        choice = (s.SPEND_CREDENTIAL_STORE or "").strip().lower() or (
            "aws" if s.ENVIRONMENT in ("staging", "production") else "none"
        )
        _store = (
            AwsSecretsManagerStore(s.AWS_REGION) if choice == "aws" else DisabledStore()
        )
    return _store


def set_store(store: SecretStore | None) -> None:
    """Swap the vault (tests) and forget every cached value."""
    global _store
    _store = store
    _cache.clear()
    _errors.clear()


def secret_name(tenant_id: UUID, connector: str) -> str:
    env = str(_settings().ENVIRONMENT).strip().lower()
    return f"qontinui/{env}/web/spend/{tenant_id}/{connector}"


def task_role_tenant() -> UUID | None:
    raw = (_settings().SPEND_AWS_TASK_ROLE_TENANT_ID or "").strip()
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        logger.warning("spend_task_role_tenant_invalid")
        return None


def task_role_serves(tenant_id: UUID, connector: str) -> bool:
    """Whether the AWS task-role arm serves this tenant — the pinned one only."""
    return connector == AWS_TASK_ROLE_CONNECTOR and task_role_tenant() == tenant_id


@dataclass(frozen=True)
class CredentialStatus:
    #: ``linked`` | ``not_linked`` | ``error:<typed reason>``
    status: str
    #: ``secret`` | ``task_role`` when linked.
    arm: str | None = None

    def wire(self, connector: str) -> dict[str, Any]:
        return {"connector": connector, "status": self.status, "arm": self.arm}


async def _load(
    tenant_id: UUID, connector: str, *, fresh: bool = False
) -> dict[str, Any] | None:
    key = (tenant_id, connector)
    now = time.monotonic()
    if not fresh:
        hit = _cache.get(key)
        if hit is not None and hit[0] > now:
            return hit[1]
        failed = _errors.get(key)
        if failed is not None and failed[0] > now:
            raise failed[1]
    try:
        raw = await get_store().get(secret_name(tenant_id, connector))
    except StoreUnavailable as exc:
        _errors[key] = (now + ERROR_CACHE_SECONDS, exc)
        raise
    _errors.pop(key, None)
    value: dict[str, Any] | None = None
    if raw is not None:
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = None
        if not isinstance(parsed, dict):
            raise StoreUnavailable(
                "store_error", "the stored credential is not an object"
            )
        value = parsed
    if value is None:
        _cache.pop(key, None)
    else:
        _cache[key] = (now + CACHE_SECONDS, value)
    return value


async def resolve(
    tenant_id: UUID, connector: str, *, fresh: bool = False
) -> tuple[dict[str, Any], str] | None:
    """The credential a pull uses and its arm, or ``None`` when not linked.
    ``fresh`` bypasses the cache (the server pull always reads the vault).
    Raises :class:`StoreUnavailable` when the vault cannot answer."""
    value = await _load(tenant_id, connector, fresh=fresh)
    if value is not None:
        return value, "secret"
    if task_role_serves(tenant_id, connector):
        return {}, "task_role"
    return None


async def status(tenant_id: UUID, connector: str) -> CredentialStatus:
    if connector not in CONNECTORS:
        return CredentialStatus("error:unknown_connector")
    try:
        resolved = await resolve(tenant_id, connector)
    except StoreUnavailable as exc:
        if task_role_serves(tenant_id, connector):
            return CredentialStatus("linked", "task_role")
        return CredentialStatus(f"error:{exc.reason}")
    if resolved is None:
        return CredentialStatus("not_linked")
    return CredentialStatus("linked", resolved[1])


def clean_payload(connector: str, payload: Any) -> dict[str, str]:
    """The submitted fields, checked against the connector's declared ones.
    Every refusal names a FIELD, never a value."""
    spec = CONNECTORS[connector]
    if not isinstance(payload, dict):
        raise CredentialRejected("invalid_credential", "credential must be an object")
    declared = {f.name: f for f in spec.credential_fields}
    unknown = sorted(str(k) for k in payload if k not in declared)
    if unknown:
        raise CredentialRejected(
            "invalid_credential", f"unknown field(s): {', '.join(unknown)}"
        )
    out: dict[str, str] = {}
    for name, field_spec in declared.items():
        value = payload.get(name)
        if value is None or (isinstance(value, str) and not value.strip()):
            if field_spec.required:
                raise CredentialRejected("invalid_credential", f"{name} is required")
            continue
        if not isinstance(value, str):
            raise CredentialRejected("invalid_credential", f"{name} must be text")
        if len(value) > MAX_FIELD_CHARS:
            raise CredentialRejected("invalid_credential", f"{name} is too long")
        value = value.strip()
        if not field_spec.multiline and not (value.isascii() and value.isprintable()):
            # A zero-width space or a curly quote pasted with a token: name
            # the field, never the character.
            raise CredentialRejected(
                "invalid_credential",
                f"{name} contains a character that is not printable ASCII",
            )
        out[name] = value
    return out


async def link(
    tenant_id: UUID, connector: str, payload: Any, config: dict[str, Any]
) -> CredentialStatus:
    """Validate with one live provider call, then store. A rejected credential
    stores NOTHING. Raises :class:`CredentialRejected` / :class:`StoreUnavailable`."""
    spec = CONNECTORS[connector]
    if spec.validate is None or not spec.credential_fields:
        raise CredentialRejected(
            "not_supported", f"{spec.provider} takes no linked credential"
        )
    clean: dict[str, str] = clean_payload(connector, payload)
    if spec.issued_fields is not None:
        # Values the SERVER issues (the AWS ExternalId), never taken as input.
        clean.update(spec.issued_fields(tenant_id))
    try:
        await spec.validate(clean, dict(config))
    except CredentialRejected:
        raise
    except Exception as exc:  # noqa: BLE001 — never let a frame holding the value escape
        logger.warning(
            "spend_credential_validate_crashed",
            connector=connector,
            error_type=type(exc).__name__,
        )
        raise CredentialRejected(
            "provider_error",
            f"validating with {spec.provider} failed ({type(exc).__name__})",
        ) from None
    await get_store().put(secret_name(tenant_id, connector), json.dumps(clean))
    _cache[(tenant_id, connector)] = (time.monotonic() + CACHE_SECONDS, clean)
    _errors.pop((tenant_id, connector), None)
    logger.info(
        "spend_credential_linked", tenant_id=str(tenant_id), connector=connector
    )
    return CredentialStatus("linked", "secret")


async def unlink(tenant_id: UUID, connector: str) -> bool:
    """Delete the stored credential. True when one existed."""
    removed = await get_store().delete(secret_name(tenant_id, connector))
    _cache.pop((tenant_id, connector), None)
    _errors.pop((tenant_id, connector), None)
    logger.info(
        "spend_credential_unlinked",
        tenant_id=str(tenant_id),
        connector=connector,
        existed=removed,
    )
    return removed
