"""Server-side secret redaction for tenant agentic-memory writes.

Phase 1 of ``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

Every memory record's title/content passes through :func:`redact_text`
before hashing/embedding/insert, so secret-shaped substrings never land
in ``coord.memory_records``. Matches are replaced with
``[REDACTED:<class>]`` markers; when anything was redacted the caller
logs a warning with per-class COUNTS only (log-not-store: the secret
itself is never logged).

Why not reuse ``app/core/log_sanitizer.py``: that module is field-NAME
based (redacts dict values whose key looks sensitive when building log
payloads). Memory content is free text — it needs a content-shape regex
sweep, which is what this module provides.

Redaction classes (checked in order; earlier classes claim their text
before later, broader ones can):

* ``private_key``  — PEM private-key blocks.
* ``aws_key``      — AWS access-key ids (``AKIA`` + 16 uppercase/digit).
* ``jwt``          — JWT-looking blobs (``eyJ…`` base64url header + dot).
* ``keyed_secret`` — ``api_key/secret/token/password[:=] <value>``
                     assignments (case-insensitive), including long
                     hex/base64 values following such keys.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import structlog

logger = structlog.get_logger(__name__)


def _marker(cls: str) -> str:
    return f"[REDACTED:{cls}]"


# Ordered: more specific shapes first so e.g. a PEM block is claimed as
# ``private_key`` before the generic keyed-secret sweep sees it.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "private_key",
        re.compile(
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"
            r".*?"
            r"-----END [A-Z0-9 ]*PRIVATE KEY-----",
            re.DOTALL,
        ),
    ),
    ("aws_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    (
        "jwt",
        re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_.-]*"),
    ),
    (
        # `api_key: <value>` / `secret = <value>` / `password=<value>` —
        # the value is any non-whitespace run of >= 8 chars. This also
        # covers hex/base64 strings >= 32 chars following such keys
        # (they are non-whitespace runs >= 8). The optional quote lets
        # `token = "abcd1234..."` redact the quoted value too.
        "keyed_secret",
        re.compile(
            r"""(?P<key>\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*)"""
            r"""["']?(?P<value>\S{8,})""",
            re.IGNORECASE,
        ),
    ),
)


@dataclass
class RedactionResult:
    """Outcome of one :func:`redact_text` pass."""

    text: str
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def redacted(self) -> bool:
        return bool(self.counts)

    @property
    def total(self) -> int:
        return sum(self.counts.values())


def redact_text(text: str) -> RedactionResult:
    """Sweep ``text`` for secret shapes, replacing each with a marker.

    Returns the redacted text plus per-class match counts. Never raises;
    never logs the matched secret (callers log counts only).
    """
    counts: dict[str, int] = {}
    for cls, pattern in _PATTERNS:
        if cls == "keyed_secret":
            # Keep the key + separator so the record stays readable
            # (`api_key: [REDACTED:keyed_secret]`), redact the value.
            def _keep_key(m: re.Match[str]) -> str:
                return f"{m.group('key')}{_marker('keyed_secret')}"

            text, n = pattern.subn(_keep_key, text)
        else:
            text, n = pattern.subn(_marker(cls), text)
        if n:
            counts[cls] = counts.get(cls, 0) + n
    return RedactionResult(text=text, counts=counts)


def log_redactions(context: str, counts: dict[str, int]) -> None:
    """Warn that secrets were redacted — counts only, never the values."""
    if counts:
        logger.warning(
            "memory_content_redacted",
            context=context,
            total=sum(counts.values()),
            **{f"class_{cls}": n for cls, n in counts.items()},
        )
