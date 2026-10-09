"""The Python BEHAVIOUR half of the shared bounded-read contract.

Plan ``2026-09-05-every-bounded-read-is-a-page-that-reads-as-a-corpus``
(§3 Layer 2; Phase 1's Python half, first consumed by Phase 3's
``POST /memory/query``). Every list-shaped read serves the same envelope
keys beside its own collection key, so a reader can tell a bounded PAGE from
the whole CORPUS without knowing which door it called.

**This module declares no wire shape.** The wire model is
:class:`BoundedReadMeta`, GENERATED from the Rust ``BoundedReadMeta`` in
``qontinui-schemas/rust/src/page.rs`` into
``qontinui_schemas.generated.per_type.bounded_read_meta`` (schemars → JSON
Schema → datamodel-codegen), and guarded there by the schemas drift gate.
Never add a hand-written Pydantic twin of it here or anywhere else: a second
spelling of the envelope is exactly the drift the plan exists to end. A
response adopts the keys by SUBCLASSING the generated model (see
``MemoryQueryResponse``), or, for a door that answers with a plain dict, by
:func:`merge_into`.

The builders mirror the Rust ``Page`` constructors so both languages derive
``truncated`` / ``total`` / ``bound_kind`` from the same rules:

* :func:`from_probe`       — ``Page::from_probe`` (a ``LIMIT n + 1`` fetch)
* :func:`from_count`       — ``Page::from_window_count`` (an exact count)
* :func:`complete`         — ``Page::complete``
* :func:`unknown`          — a read whose bound did not resolve
* :func:`from_lower_bound` — a keyset walk over a population an upstream cap
  left as a lower bound (``at_least`` / ``unknown``, never ``exact``)
* :func:`unavailable`      — ``Page::unavailable`` (store unprovisioned)
* :func:`not_pageable`     — ``Page::not_pageable`` (a ranked read from a
  ``limit + 1`` probe: never a cursor, ``enumerate_via`` names the walk)
* :func:`from_ranked_pool` — a ranked top-N cut of a fused candidate pool
  whose arms were capped in SQL, which has no single-probe Rust counterpart
  (see its docstring); it keeps the same envelope invariant

The shared invariant every builder keeps (the Rust ``Page`` doc): a
``next_cursor`` sits only beside ``truncated: true`` and never beside an
``enumerate_via``; ``truncated: true`` with no cursor happens only on a
RANKED read, and then ``enumerate_via`` names the door that walks the corpus.

Every key is ALWAYS serialized: ``null`` is a value here (``total: null`` =
"no count ran", ``truncated: null`` = "unknown"), never an absence. Callers
must therefore not serialize these models with ``exclude_none``.

The keyset cursor CODEC (Phase 4, first consumed by the plan-library doors) is
the Rust codec's wire format, not one invented here: :class:`SortKey`,
:class:`CursorScope` → :class:`ScopeFingerprint`, :class:`KeysetPosition` and
:class:`CursorError` mirror their Rust namesakes byte for byte. The layout is
pinned in ``qontinui-schemas/rust/src/page.rs``'s module doc; a token Rust
mints decodes here, and a token minted here decodes in Rust
(``tests/fixtures/bounded_read/rust_minted_cursors.json`` holds Rust-minted
tokens and is the cross-language guard). :func:`cursor_refusal` turns a
:class:`CursorError` into the typed ``400 cursor_malformed`` every door answers.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import struct
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from qontinui_schemas.generated.per_type.bounded_read_meta import (
    BoundedReadMeta,
    BoundKind,
    FilterNarrowing,
)

__all__ = [
    "BOUNDED_READ_HEADER",
    "CURSOR_MAX_TOKEN_LEN",
    "CURSOR_WIRE_VERSION",
    "BoundKind",
    "BoundedReadMeta",
    "CursorError",
    "CursorRejection",
    "CursorScope",
    "FilterNarrowing",
    "KeysetPosition",
    "ScopeFingerprint",
    "SortKey",
    "complete",
    "cursor_refusal",
    "from_count",
    "from_lower_bound",
    "from_probe",
    "from_ranked_pool",
    "header_value",
    "merge_into",
    "not_pageable",
    "unavailable",
    "unknown",
]


def _meta(
    *,
    shown: int,
    limit: int,
    total: int | None,
    truncated: bool | None,
    bound_kind: BoundKind,
    next_cursor: str | None,
    available: bool = True,
    filter_narrowed: FilterNarrowing | None = None,
    enumerate_via: str | None = None,
) -> BoundedReadMeta:
    """The ONE place a :class:`BoundedReadMeta` is built, and the gate that
    makes a self-contradicting envelope unconstructible.

    Mirrors Rust ``Page::envelope_is_consistent`` (``qontinui-schemas``
    ``rust/src/page.rs``), but REFUSES rather than ``debug_assert!``-ing,
    because Python has no private-field constructor discipline to lean on:
    any caller can reach this function. Three states are refused:

    * ``next_cursor`` and ``enumerate_via`` both set — a cursor IS the walk,
      so it never names another one;
    * ``next_cursor`` set while ``truncated`` is not ``True`` — a cursor
      beside ``false`` (nothing more) or ``null`` (unknown) points nowhere;
    * ``truncated`` ``True`` with neither — "there is more" with no way to
      reach it, which is only honest on a ranking that names its walk.

    Raises :class:`ValueError`; nothing is silently dropped here.
    """
    if next_cursor is not None and enumerate_via is not None:
        raise ValueError("a page with a next_cursor cannot name enumerate_via")
    if next_cursor is not None and truncated is not True:
        raise ValueError(
            f"a next_cursor may only sit beside truncated=True, not {truncated!r}"
        )
    if truncated is True and next_cursor is None and enumerate_via is None:
        raise ValueError(
            "a truncated page needs a next_cursor (a walk) or an enumerate_via "
            "(a ranking naming the door that walks the corpus)"
        )
    return BoundedReadMeta(
        count=shown,
        limit=limit,
        shown=shown,
        total=total,
        truncated=truncated,
        bound_kind=bound_kind,
        next_cursor=next_cursor,
        available=available,
        filter_narrowed=filter_narrowed,
        enumerate_via=enumerate_via,
    )


def from_probe(
    fetched: int,
    limit: int,
    *,
    next_cursor: str | None,
    enumerate_via: str | None,
    filter_narrowed: FilterNarrowing | None = None,
) -> BoundedReadMeta:
    """Meta for a ``LIMIT limit + 1`` fetch that returned ``fetched`` rows.

    More than ``limit`` rows means the probe fired: the page shows ``limit``
    rows, the bound is ``at_least`` and ``truncated`` is true. Otherwise the
    page is ``complete`` — even when it filled exactly, because a full page
    with nothing behind it is not truncated.

    ``next_cursor`` and ``enumerate_via`` are keyword-only and have NO
    default, so every caller states which way on it offers: a walk passes the
    cursor minted from the last KEPT row (never the probe row) and
    ``enumerate_via=None``; a ranking passes ``next_cursor=None`` and names
    its walk (see :func:`not_pageable`). Passing neither when the probe fires
    is refused by :func:`_meta`. When the probe did NOT fire the cursor is not
    used — there is no next position, exactly as Rust ``Page::from_probe``
    never calls ``cursor_of`` then — while ``enumerate_via`` is kept, because
    it describes the READ rather than this page.
    """
    limit = max(limit, 1)
    if fetched > limit:
        return _meta(
            shown=limit,
            limit=limit,
            total=None,
            truncated=True,
            bound_kind=BoundKind.at_least,
            next_cursor=next_cursor,
            filter_narrowed=filter_narrowed,
            enumerate_via=enumerate_via,
        )
    return _meta(
        shown=fetched,
        limit=limit,
        total=None,
        truncated=False,
        bound_kind=BoundKind.complete,
        next_cursor=None,
        filter_narrowed=filter_narrowed,
        enumerate_via=enumerate_via,
    )


def from_count(
    shown: int,
    limit: int,
    total: int,
    *,
    next_cursor: str | None,
    enumerate_via: str | None,
    filter_narrowed: FilterNarrowing | None = None,
) -> BoundedReadMeta:
    """Meta for a page whose statement carried an EXACT match count.

    ``total`` counts the rows matching from this page's start position
    onward; ``truncated`` is ``total > shown``. Same keyword-only, no-default
    ``next_cursor`` / ``enumerate_via`` contract as :func:`from_probe`: a
    truncated page must name one of them (refused otherwise), and the cursor
    is not used when the page is not truncated — Rust
    ``Page::from_window_count`` mints it only then.
    """
    truncated = total > shown
    return _meta(
        shown=shown,
        limit=limit,
        total=total,
        truncated=truncated,
        bound_kind=BoundKind.exact,
        next_cursor=next_cursor if truncated else None,
        filter_narrowed=filter_narrowed,
        enumerate_via=enumerate_via,
    )


def complete(
    shown: int, limit: int, *, filter_narrowed: FilterNarrowing | None = None
) -> BoundedReadMeta:
    """Meta for a page that holds every matching row by construction."""
    return _meta(
        shown=shown,
        limit=limit,
        total=None,
        truncated=False,
        bound_kind=BoundKind.complete,
        next_cursor=None,
        filter_narrowed=filter_narrowed,
    )


def unknown(
    shown: int, limit: int, *, filter_narrowed: FilterNarrowing | None = None
) -> BoundedReadMeta:
    """Meta for a read whose bound did not resolve.

    ``truncated`` and ``total`` are ``null``: never ``false``, because
    ``false`` asserts "you have seen everything" on a read that could not say.
    """
    return _meta(
        shown=shown,
        limit=limit,
        total=None,
        truncated=None,
        bound_kind=BoundKind.unknown,
        next_cursor=None,
        filter_narrowed=filter_narrowed,
    )


def from_lower_bound(
    shown: int,
    limit: int,
    *,
    more_read: bool,
    next_cursor: str | None,
    filter_narrowed: FilterNarrowing | None = None,
) -> BoundedReadMeta:
    """Meta for a keyset WALK over a population known only as a LOWER BOUND —
    an upstream read that stopped at its own cap, so rows may exist that this
    read never saw.

    No exact count is possible, so ``total`` is ``null`` either way:

    * ``more_read`` — rows past this page WERE read: ``at_least``,
      ``truncated: true``, and the walk continues by ``next_cursor``
      (required — refused otherwise).
    * otherwise — this page shows everything that was read, and nothing
      proves that was everything: ``unknown``, ``truncated: null``. Never
      ``false``, which would claim a completeness the capped read cannot.
    """
    if more_read:
        return _meta(
            shown=shown,
            limit=limit,
            total=None,
            truncated=True,
            bound_kind=BoundKind.at_least,
            next_cursor=next_cursor,
            filter_narrowed=filter_narrowed,
        )
    return unknown(shown, limit, filter_narrowed=filter_narrowed)


def unavailable(limit: int) -> BoundedReadMeta:
    """Meta for an UNPROVISIONED store: no rows, bound unknown, ``available``
    false — an empty page here is UNKNOWN, never "nothing matched"."""
    return _meta(
        shown=0,
        limit=limit,
        total=None,
        truncated=None,
        bound_kind=BoundKind.unknown,
        next_cursor=None,
        available=False,
    )


def not_pageable(
    fetched: int,
    limit: int,
    enumerate_via: str,
    *,
    filter_narrowed: FilterNarrowing | None = None,
) -> BoundedReadMeta:
    """Meta for a RANKED read from a ``LIMIT limit + 1`` fetch — mirrors
    Rust ``Page::not_pageable``.

    A ranking has no stable position to resume from, so it never hands out a
    cursor: when the probe fired the page is ``at_least``, ``truncated: true``,
    ``next_cursor: null``; otherwise ``complete``. ``enumerate_via`` names the
    door that walks the same corpus by an immutable key, and is set on every
    page of the read, truncated or not, because it describes the READ.
    """
    return from_probe(
        fetched,
        limit,
        next_cursor=None,
        enumerate_via=enumerate_via,
        filter_narrowed=filter_narrowed,
    )


def from_ranked_pool(
    *,
    shown: int,
    limit: int,
    pool_size: int,
    pool_capped: bool,
    enumerate_via: str,
) -> BoundedReadMeta:
    """Meta for a relevance-ranked top-``limit`` cut of a fused candidate pool.

    Like :func:`not_pageable`, a ranking is never pageable (its sort key is a
    computed score that moves with every write): ``next_cursor`` is ALWAYS
    ``null`` and ``enumerate_via`` is ALWAYS set. What differs is how the
    bound is known — the pool's size is exact unless an arm was capped:

    * ``pool_capped`` false — every arm returned all of its matches, so the
      pool IS the match set: ``exact``, ``total = pool_size``,
      ``truncated = pool_size > limit``.

    ``truncated`` is judged against ``limit`` — the CUT — never against
    ``shown``. The two differ only when a pooled id's row was not fetched
    (tombstoned between the arm and the fetch): that row was never going to
    appear on any page, so it is not "more beyond this page", and comparing
    against ``shown`` would report ``truncated: true`` on a read with nothing
    past its cut. ``total`` still counts that id, because it counts
    CANDIDATES the arms returned, not rows rendered.
    * ``pool_capped`` true and ``pool_size > limit`` — more matches exist than
      shown, and more may exist than the pool saw: ``at_least``,
      ``total: null``, ``truncated: true``.
    * ``pool_capped`` true and ``pool_size <= limit`` — the page shows the whole
      pool, but a capped arm may have left matches unseen, so whether more
      exist did not resolve: ``unknown``, ``truncated: null``. ``at_least``
      beside ``truncated: false`` would contradict itself, and ``false`` would
      claim a completeness nothing measured.
    """
    if not pool_capped:
        return _meta(
            shown=shown,
            limit=limit,
            total=pool_size,
            truncated=pool_size > limit,
            bound_kind=BoundKind.exact,
            next_cursor=None,
            enumerate_via=enumerate_via,
        )
    if pool_size > limit:
        return _meta(
            shown=shown,
            limit=limit,
            total=None,
            truncated=True,
            bound_kind=BoundKind.at_least,
            next_cursor=None,
            enumerate_via=enumerate_via,
        )
    return _meta(
        shown=shown,
        limit=limit,
        total=None,
        truncated=None,
        bound_kind=BoundKind.unknown,
        next_cursor=None,
        enumerate_via=enumerate_via,
    )


def merge_into(target: dict[str, Any], meta: BoundedReadMeta) -> dict[str, Any]:
    """Merge the envelope keys into a dict response, overwriting only them.

    For doors that answer with a plain dict rather than a model that can
    subclass :class:`BoundedReadMeta`; every other key is left as the door
    wrote it. Mirrors the Rust ``BoundedReadMeta::insert_into``. Returns
    ``target`` for chaining.
    """
    target.update(meta.model_dump(mode="json"))
    return target


#: The response header a NON-JSON bounded read (a zip, a stream) carries its
#: envelope in — the same ten keys, as compact JSON, so a binary body states
#: its bound in the one shared vocabulary rather than a bespoke header per
#: door. A cross-origin browser reads it only if CORS publishes it.
BOUNDED_READ_HEADER = "X-Bounded-Read"


def header_value(meta: BoundedReadMeta) -> str:
    """:data:`BOUNDED_READ_HEADER`'s value: every key, ``null`` included,
    as ASCII compact JSON with sorted keys (one spelling per envelope)."""
    return json.dumps(
        meta.model_dump(mode="json"), separators=(",", ":"), sort_keys=True
    )


# ============================================================================
# The keyset cursor codec — the Rust ``page.rs`` codec, byte for byte
# ============================================================================

#: Wire version of the cursor payload (Rust ``CURSOR_WIRE_VERSION``). A token
#: carrying any other version is refused, never reinterpreted.
CURSOR_WIRE_VERSION = 1

#: The longest token :meth:`ScopeFingerprint.decode` will look at (Rust
#: ``CURSOR_MAX_TOKEN_LEN``), in BYTES — a hostile query string must not buy a
#: large base64 + JSON decode.
CURSOR_MAX_TOKEN_LEN = 1024

#: Domain separator pinning the fingerprint's meaning to this layout.
_FINGERPRINT_DOMAIN = b"qontinui.bounded-read.cursor"

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_ONE_MICROSECOND = timedelta(microseconds=1)
_I64_MIN = -(2**63)
_I64_MAX = 2**63 - 1
_U8_MAX = 255
_BASE64URL_ALPHABET = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
)
_PAYLOAD_KEYS = frozenset({"v", "s", "k", "i", "f"})


@dataclass(frozen=True, slots=True)
class SortKey:
    """A keyset sort key this codec may walk — Rust's ``SortKey`` marker.

    **Declaring one is an assertion about the schema** (plan D8). Its four
    clauses, the Rust trait doc's in meaning:

    1. **The key is IMMUTABLE after insert** — a column with no UPDATE site
       anywhere (``created_at``; never ``updated_at``, never a heartbeat, never
       a ``COALESCE`` over a mutable column). Keyset survives INSERT and
       DELETE, but an UPDATE that moves an unreached row's key across the
       cursor drops that row from the walk silently. A surface whose natural
       order is mutable keeps it for display only and walks on an immutable
       key. Each surface pins this with a test that greps for an
       ``UPDATE … SET <key>``.
    2. **The tiebreak is the row's unique id**, so ``(key, id)`` is a total
       order and the row comparison neither drops nor repeats rows that share
       a timestamp.
    3. **The statement orders by exactly ``(key, id)``** in one direction and
       filters with exactly that row comparison. The Rust doc names ``DESC``;
       a surface that walks ``ASC`` says so in :attr:`id`, because the
       direction is part of WHICH sequence a token addresses.
    4. **:attr:`id` names the sequence and changes when the key does.** It is
       bound into every token and into the fingerprint, so a token minted
       against an old key decodes as malformed instead of paging silently
       wrong. Keep it short: ``<store>:<key>,<tiebreak>[ asc]``.
    """

    id: str


@dataclass(frozen=True, slots=True)
class KeysetPosition:
    """The last served row's sort key and id (Rust ``KeysetPosition``).

    ``at`` round-trips at microsecond resolution — PostgreSQL ``timestamptz``'s
    own, and Python ``datetime``'s.
    """

    at: datetime
    id: UUID


class CursorRejection(Enum):
    """Why a supplied cursor was refused (Rust ``CursorRejection``). Every
    reason is the same refusal on the wire; the value is the short human
    reason, and it echoes NOTHING from the token."""

    EMPTY = "the cursor is blank"
    TOO_LONG = "the cursor is longer than any token this read mints"
    ENCODING = "the cursor is not unpadded urlsafe base64"
    PAYLOAD = "the cursor does not decode to a cursor payload"
    VERSION = "the cursor was minted by a different version of this read"
    SORT_KEY = "the cursor was minted for a different sort order"
    SCOPE = (
        "the cursor was minted under different filters or a different tenant; "
        "a cursor addresses a position in ONE ordered sequence"
    )
    TIMESTAMP = "the cursor's position is out of range"


class CursorError(ValueError):
    """A malformed cursor (Rust ``CursorError``) — the typed refusal every door
    answers with ``400 cursor_malformed`` via :func:`cursor_refusal`."""

    #: One stable machine code for every reason, because every reason has the
    #: one remedy: restart the walk.
    code = "cursor_malformed"

    def __init__(self, reason: CursorRejection) -> None:
        self.reason = reason
        super().__init__(
            "invalid cursor — pass a `next_cursor` from a previous response "
            f"verbatim, or omit `cursor` for the first page ({reason.value})"
        )

    def refusal(self, surface: str, *, parameter: str = "cursor") -> str:
        """The refusal text naming the surface the cursor should have come
        from — the fleet's standard wording (Rust ``CursorError::refusal``)."""
        return (
            f"invalid cursor — pass a `next_cursor` from a previous {surface} "
            f"response verbatim, or omit `{parameter}` for the first page "
            f"({self.reason.value})"
        )


def _to_micros(at: datetime) -> int:
    """Microseconds since the Unix epoch. A naive value is read as UTC — every
    column this codec walks is ``timestamptz``."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    return (at - _EPOCH) // _ONE_MICROSECOND


class CursorScope:
    """Builds the :class:`ScopeFingerprint` of a read (Rust ``CursorScope``).

    Add every filter that changes WHICH rows the ordered sequence contains —
    the tenant / org included — as the surface APPLIED it, in a fixed order,
    and nothing that only changes which SLICE is taken (``limit`` stays out,
    so resizing a page mid-walk needs no new cursor). Each method appends one
    tagged, length-prefixed field, exactly the Rust layout::

        0x1E <name utf-8> 0x1F <value>
          'n'                                absent (None)
          's' <u64 BE len> <utf-8>           a string
          'u' <16 raw bytes>                 a uuid
          'b' <0x00 | 0x01>                  a bool
          'i' <i64 BE>                       an integer
          'l' <u64 BE count> (<u64 BE len> <bytes>)*   a sorted, deduped set
    """

    def __init__(self, sort_key: SortKey) -> None:
        self._sort_key = sort_key
        self._hasher = hashlib.sha256()
        self._hasher.update(_FINGERPRINT_DOMAIN)
        self._hasher.update(bytes([0x1F, CURSOR_WIRE_VERSION, 0x1F]))
        self._hasher.update(sort_key.id.encode("utf-8"))

    def _field(self, name: str) -> None:
        self._hasher.update(b"\x1e")
        self._hasher.update(name.encode("utf-8"))
        self._hasher.update(b"\x1f")

    def _put_bytes(self, value: bytes) -> None:
        self._hasher.update(struct.pack(">Q", len(value)))
        self._hasher.update(value)

    def opt_str(self, name: str, value: str | None) -> CursorScope:
        """A string-valued filter; ``None`` is ABSENT, distinct from ``""``."""
        self._field(name)
        if value is None:
            self._hasher.update(b"n")
        else:
            self._hasher.update(b"s")
            self._put_bytes(value.encode("utf-8"))
        return self

    def uuid(self, name: str, value: UUID) -> CursorScope:
        """A uuid-valued scope member (the tenant, the org)."""
        self._field(name)
        self._hasher.update(b"u")
        self._hasher.update(value.bytes)
        return self

    def opt_uuid(self, name: str, value: UUID | None) -> CursorScope:
        """An optional uuid; ``None`` is ABSENT."""
        if value is not None:
            return self.uuid(name, value)
        self._field(name)
        self._hasher.update(b"n")
        return self

    def boolean(self, name: str, value: bool) -> CursorScope:
        """A boolean filter (Rust ``CursorScope::bool``)."""
        self._field(name)
        self._hasher.update(b"b")
        self._hasher.update(b"\x01" if value else b"\x00")
        return self

    def i64(self, name: str, value: int) -> CursorScope:
        """An integer filter. Out of the i64 range is a programming error."""
        if not _I64_MIN <= value <= _I64_MAX:
            raise ValueError(f"{name}={value} does not fit an i64")
        self._field(name)
        self._hasher.update(b"i")
        self._hasher.update(struct.pack(">q", value))
        return self

    def str_set(self, name: str, values: Iterable[str]) -> CursorScope:
        """A SET-valued filter, hashed sorted (by bytes) and deduplicated."""
        members = sorted({v.encode("utf-8") for v in values})
        self._field(name)
        self._hasher.update(b"l")
        self._hasher.update(struct.pack(">Q", len(members)))
        for member in members:
            self._put_bytes(member)
        return self

    def finish(self) -> ScopeFingerprint:
        """Finish the scope."""
        return ScopeFingerprint(self._sort_key, self._hasher.hexdigest())


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """serde's derived struct refuses a repeated field; ``json`` keeps the last."""
    payload: dict[str, Any] = {}
    for key, value in pairs:
        if key in payload:
            raise CursorError(CursorRejection.PAYLOAD)
        payload[key] = value
    return payload


def _reject_constant(_: str) -> Any:
    """``NaN`` / ``Infinity`` are not JSON, and serde refuses them."""
    raise CursorError(CursorRejection.PAYLOAD)


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


@dataclass(frozen=True, slots=True)
class ScopeFingerprint:
    """The fingerprint of one read's scope under one sort key — and the codec
    (Rust ``ScopeFingerprint``). A token can only resume the sequence it came
    from."""

    sort_key: SortKey
    hex: str

    def encode(self, pos: KeysetPosition) -> str:
        """Mint the token addressing the position immediately AFTER ``pos``.

        ``base64url_nopad`` over the compact JSON
        ``{"v":1,"s":<id>,"k":<micros>,"i":<uuid>,"f":<hex>}`` in that field
        order — serde_json's own compact form.
        """
        payload = {
            "v": CURSOR_WIRE_VERSION,
            "s": self.sort_key.id,
            "k": _to_micros(pos.at),
            "i": str(pos.id),
            "f": self.hex,
        }
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")
        return encoded.rstrip("=")

    def decode(self, token: str) -> KeysetPosition:
        """Decode a caller-supplied token STRICTLY. Anything this fingerprint
        did not mint — garbage, empty, over-long, padded, another wire
        version, another sort key, another scope, an out-of-range instant — is
        a :class:`CursorError`, never a clamp and never a 500."""
        token = token.strip()
        if not token:
            raise CursorError(CursorRejection.EMPTY)
        if len(token.encode("utf-8")) > CURSOR_MAX_TOKEN_LEN:
            raise CursorError(CursorRejection.TOO_LONG)
        if not set(token) <= _BASE64URL_ALPHABET or len(token) % 4 == 1:
            raise CursorError(CursorRejection.ENCODING)
        try:
            raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        except (binascii.Error, ValueError) as exc:
            raise CursorError(CursorRejection.ENCODING) from exc
        # The Rust engine refuses non-canonical trailing bits; re-encoding is
        # the exact test for them, and keeps decode a strict inverse of encode.
        if base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=") != token:
            raise CursorError(CursorRejection.ENCODING)
        try:
            payload = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_keys,
                parse_constant=_reject_constant,
            )
        except CursorError:
            raise
        except ValueError as exc:  # JSONDecodeError and UnicodeDecodeError
            raise CursorError(CursorRejection.PAYLOAD) from exc
        if not isinstance(payload, dict) or set(payload) != _PAYLOAD_KEYS:
            raise CursorError(CursorRejection.PAYLOAD)
        version, sort_key, micros = payload["v"], payload["s"], payload["k"]
        tiebreak, fingerprint = payload["i"], payload["f"]
        if not (
            _is_int(version)
            and 0 <= version <= _U8_MAX
            and isinstance(sort_key, str)
            and _is_int(micros)
            and _I64_MIN <= micros <= _I64_MAX
            and isinstance(tiebreak, str)
            and isinstance(fingerprint, str)
        ):
            raise CursorError(CursorRejection.PAYLOAD)
        try:
            row_id = UUID(tiebreak)
        except ValueError as exc:
            raise CursorError(CursorRejection.PAYLOAD) from exc
        if version != CURSOR_WIRE_VERSION:
            raise CursorError(CursorRejection.VERSION)
        if sort_key != self.sort_key.id:
            raise CursorError(CursorRejection.SORT_KEY)
        if fingerprint != self.hex:
            raise CursorError(CursorRejection.SCOPE)
        try:
            # Python's datetime spans exactly AD 1 … 9999, the range the Rust
            # decoder enforces explicitly; anything outside overflows here.
            at = _EPOCH + timedelta(microseconds=micros)
        except OverflowError as exc:
            raise CursorError(CursorRejection.TIMESTAMP) from exc
        return KeysetPosition(at=at, id=row_id)

    def decode_param(
        self, token: str | None, *, surface: str, parameter: str = "cursor"
    ) -> KeysetPosition | None:
        """:meth:`decode` for a route's optional query parameter: ``None`` is
        the first page, and a malformed token is the typed 400."""
        if token is None:
            return None
        try:
            return self.decode(token)
        except CursorError as exc:
            raise cursor_refusal(exc, surface=surface, parameter=parameter) from exc


def cursor_refusal(
    error: CursorError, *, surface: str, parameter: str = "cursor"
) -> HTTPException:
    """The typed ``400 cursor_malformed`` naming the parameter.

    One shape for every door: ``error`` is the machine code, ``parameter``
    names the query key that carried the token, ``reason`` is the stable
    rejection name, and ``message`` is the fleet's standard refusal wording.
    Nothing from the token is echoed.
    """
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "error": error.code,
            "parameter": parameter,
            "reason": error.reason.name.lower(),
            "message": error.refusal(surface, parameter=parameter),
        },
    )
