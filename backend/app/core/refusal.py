"""The next-action contract for this backend's operator-facing refusals.

Plan ``2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists``,
Phase D1/D2. The envelope itself is ``Refusal`` from ``qontinui-schemas``
(generated from ``rust/src/refusal.rs``). This module is the ONE door through
which the web backend builds one, so every refusal it serves names what the
reader does next as a typed :class:`NextActionKind` instead of leaving it to
a free-text sentence.

Wire shape: additive, nested under ``refusal``
----------------------------------------------

Existing clients match on the TOP-LEVEL fields this backend has always served
(``error``, ``message``, ``detail``, ``code`` and route-specific keys), so the
envelope never replaces them. It rides beside them under one new key, the
same shape coord and the runner use::

    {
      "error": "<legacy ErrorCode>",       # unchanged
      "message": "<human sentence>",       # unchanged
      "timestamp": ..., "path": ...,       # unchanged
      ...route metadata...,                # unchanged
      "refusal": {
        "code": "<RefusalCode>",
        "discriminator": "<this site's specific code>",
        "next_action": {"kind": "...", "target": "...", "retry_after_s": N},
        "glossary_terms": [...],           # always present, may be empty
        "detail": "<human sentence>",
        "source": "web_backend",
        "observed_at": "<ISO 8601>"
      }
    }

A reader that knows the envelope reads ``refusal``. A reader that does not
(``frontend/src/lib/errors/backend-error-message.ts`` before it learned the
envelope) sees exactly the body it saw before this module existed.

Two ways a route serves one
---------------------------

* **Raise** :func:`refusal_error`. ``exc.detail`` STAYS the human string, so
  in-process code reading ``HTTPException.detail`` (relays, logs, tests) is
  unaffected, and ``http_exception_handler`` composes the body above.
* **Return** a hand-built ``JSONResponse`` (routes whose established body is
  not the composed envelope, e.g. the runner-proxy relay's
  ``{"detail": ..., "device_id": ...}``): build the :class:`Refusal` with
  :func:`build_refusal` and add :func:`refusal_payload` under ``"refusal"``.

Why the sentence is not ``Refusal::render()``
---------------------------------------------

``render()`` lives in Rust; the generated Python binding carries fields only.
``detail``/``message`` is the specific human text the raising site already
wrote, which is what older readers have always shown. A reader that knows the
envelope renders ``render()``'s sentence from the fields itself.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from qontinui_schemas.generated.per_type.refusal import (
    GlossaryTerm,
    NextAction,
    NextActionKind,
    Refusal,
    RefusalCode,
    RefusalSource,
)

from app.core.error_codes import ErrorCode, get_default_error_code

__all__ = [
    "REFUSAL_KEY",
    "GlossaryTerm",
    "NextAction",
    "NextActionKind",
    "Refusal",
    "RefusalCode",
    "RefusalHTTPException",
    "build_refusal",
    "refusal_error",
    "refusal_payload",
]

#: The one top-level key the envelope occupies.
REFUSAL_KEY = "refusal"

#: Kinds that are READER-SIDE only. A producer that emits one is claiming not
#: to know its own next action, so this module refuses to build it.
_READER_SIDE_KINDS = frozenset({NextActionKind.unrecognised})


def build_refusal(
    code: RefusalCode,
    next_action: NextActionKind,
    message: str,
    *,
    discriminator: str,
    target: str | None = None,
    retry_after_s: int | None = None,
    glossary_terms: Iterable[GlossaryTerm] = (),
) -> Refusal:
    """Build one :class:`Refusal` stamped ``source=web_backend``, observed now.

    ``next_action`` is REQUIRED — there is no way to build a refusal here
    without saying what the reader does next, even when the honest answer is
    :attr:`NextActionKind.none_terminal` ("nothing you can do") or
    :attr:`NextActionKind.report_defect` ("this is our bug").

    ``discriminator`` is REQUIRED too: the site-specific code that narrows the
    generic ``code`` (``expired`` under ``credential_rejected``, say). It is
    what a reader tells two refusals of one class apart by.

    ``message`` becomes ``Refusal.detail``: the human sentence, shown beside
    the rendered one.
    """
    if next_action in _READER_SIDE_KINDS:
        raise ValueError(
            f"{next_action!r} is reader-side; a producer must name a real next action"
        )
    if not discriminator:
        raise ValueError("a refusal must carry its site-specific discriminator")
    if not message:
        raise ValueError("a refusal must carry its human sentence in message")
    return Refusal(
        code=code,
        discriminator=discriminator,
        next_action=NextAction(
            kind=next_action, target=target, retry_after_s=retry_after_s
        ),
        glossary_terms=list(glossary_terms),
        detail=message,
        observed_at=datetime.now(UTC).isoformat(),
        source=RefusalSource.web_backend,
    )


def refusal_payload(refusal: Refusal) -> dict[str, Any]:
    """The JSON value served under :data:`REFUSAL_KEY`.

    Optional fields are omitted when unset and ``glossary_terms`` is always
    present (an empty list, never absent) — the wire rules of
    ``rust/src/refusal.rs``.
    """
    payload = refusal.model_dump(mode="json", exclude_none=True)
    payload.setdefault("glossary_terms", [])
    return payload


class RefusalHTTPException(HTTPException):
    """An ``HTTPException`` that carries a typed :class:`Refusal`.

    ``detail`` is the human sentence (a plain string, as on every other
    ``HTTPException``); ``refusal`` is the envelope the handler serves beside
    it; ``error_code`` is the legacy top-level ``error``; ``metadata`` is
    spliced into the top level exactly as a dict ``detail``'s extra keys
    always have been. Construct through :func:`refusal_error`.
    """

    def __init__(
        self,
        status_code: int,
        refusal: Refusal,
        *,
        error_code: str,
        headers: Mapping[str, str] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        if refusal.detail is None:
            raise ValueError("a served refusal must carry its human sentence")
        super().__init__(
            status_code=status_code,
            detail=refusal.detail,
            headers=dict(headers) if headers else None,
        )
        self.refusal = refusal
        self.error_code = error_code
        self.metadata: dict[str, Any] = dict(metadata or {})

    def body(self) -> dict[str, Any]:
        """The response body, minus the handler's ``timestamp``/``path``."""
        return {
            "error": self.error_code,
            "message": self.detail,
            **self.metadata,
            REFUSAL_KEY: refusal_payload(self.refusal),
        }


#: Top-level keys the handler composes; ``metadata`` may not overwrite them.
_RESERVED_KEYS = frozenset({"error", "message", "timestamp", "path", REFUSAL_KEY})


def refusal_error(
    status_code: int,
    code: RefusalCode,
    next_action: NextActionKind,
    message: str,
    *,
    discriminator: str,
    target: str | None = None,
    retry_after_s: int | None = None,
    glossary_terms: Iterable[GlossaryTerm] = (),
    error_code: ErrorCode | str | None = None,
    headers: Mapping[str, str] | None = None,
    metadata: Mapping[str, Any] | None = None,
    exc_type: type[RefusalHTTPException] = RefusalHTTPException,
) -> RefusalHTTPException:
    """Build the HTTP error for one operator-facing refusal (to ``raise``).

    See :func:`build_refusal` for ``code``/``next_action``/``message``/
    ``discriminator``.

    ``error_code`` is the legacy top-level ``error``. It defaults to the
    status's :func:`get_default_error_code` — exactly what the handler has
    always inferred for a string detail, so the top level is unchanged.

    A ``retry_later`` refusal with ``retry_after_s`` gets a ``Retry-After``
    header unless ``headers`` already sets one.

    ``exc_type`` lets a caller raise a SUBCLASS (``CoordTransportUnavailable``
    in ``operations.py``) whose type other code dispatches on.
    """
    refusal = build_refusal(
        code,
        next_action,
        message,
        discriminator=discriminator,
        target=target,
        retry_after_s=retry_after_s,
        glossary_terms=glossary_terms,
    )
    if metadata:
        clash = set(metadata) & _RESERVED_KEYS
        if clash:
            raise ValueError(f"metadata may not shadow envelope keys: {sorted(clash)}")
    merged_headers = dict(headers or {})
    if (
        next_action is NextActionKind.retry_later
        and retry_after_s is not None
        and not any(k.lower() == "retry-after" for k in merged_headers)
    ):
        merged_headers["Retry-After"] = str(retry_after_s)
    legacy = (
        error_code if error_code is not None else get_default_error_code(status_code)
    )
    return exc_type(
        status_code,
        refusal,
        error_code=legacy.value if isinstance(legacy, ErrorCode) else legacy,
        headers=merged_headers or None,
        metadata=metadata,
    )
