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
* :func:`unavailable`      — ``Page::unavailable`` (store unprovisioned)
* :func:`from_ranked_pool` — a relevance-ranked top-N over a capped candidate
  pool, which has no Rust counterpart yet (see its docstring)

Every key is ALWAYS serialized: ``null`` is a value here (``total: null`` =
"no count ran", ``truncated: null`` = "unknown"), never an absence. Callers
must therefore not serialize these models with ``exclude_none``.

No keyset cursor codec lives here yet: no web door adopting the contract in
this phase takes a cursor. It lands with the first one that does (Phase 4),
over the Rust codec's wire format, not invented locally.
"""

from __future__ import annotations

from typing import Any

from qontinui_schemas.generated.per_type.bounded_read_meta import (
    BoundedReadMeta,
    BoundKind,
    FilterNarrowing,
)

__all__ = [
    "BoundKind",
    "BoundedReadMeta",
    "FilterNarrowing",
    "complete",
    "from_count",
    "from_probe",
    "from_ranked_pool",
    "merge_into",
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
) -> BoundedReadMeta:
    return BoundedReadMeta(
        count=shown,
        limit=limit,
        shown=shown,
        total=total,
        truncated=truncated,
        bound_kind=bound_kind,
        # The wire never carries a cursor beside `truncated: false` — the
        # same restatement `Page::meta` makes on the Rust side.
        next_cursor=None if truncated is False else next_cursor,
        available=available,
        filter_narrowed=filter_narrowed,
    )


def from_probe(
    fetched: int,
    limit: int,
    next_cursor: str | None = None,
    *,
    filter_narrowed: FilterNarrowing | None = None,
) -> BoundedReadMeta:
    """Meta for a ``LIMIT limit + 1`` fetch that returned ``fetched`` rows.

    More than ``limit`` rows means the probe fired: the page shows ``limit``
    rows, the bound is ``at_least`` and ``truncated`` is true. Otherwise the
    page is ``complete`` — even when it filled exactly, because a full page
    with nothing behind it is not truncated. ``next_cursor`` must be minted by
    the caller from the last KEPT row (never the probe row); it is dropped
    when the page is complete.
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
        )
    return complete(fetched, limit, filter_narrowed=filter_narrowed)


def from_count(
    shown: int,
    limit: int,
    total: int,
    next_cursor: str | None = None,
    *,
    filter_narrowed: FilterNarrowing | None = None,
) -> BoundedReadMeta:
    """Meta for a page whose statement carried an EXACT match count.

    ``total`` counts the rows matching from this page's start position
    onward; ``truncated`` is ``total > shown``.
    """
    return _meta(
        shown=shown,
        limit=limit,
        total=total,
        truncated=total > shown,
        bound_kind=BoundKind.exact,
        next_cursor=next_cursor,
        filter_narrowed=filter_narrowed,
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


def from_ranked_pool(
    *, shown: int, limit: int, pool_size: int, pool_capped: bool
) -> BoundedReadMeta:
    """Meta for a relevance-ranked top-``limit`` cut of a fused candidate pool.

    A ranking is not a table walk: its sort key is a computed score that moves
    with every write, so it is never pageable and ``next_cursor`` is ALWAYS
    ``null`` here, even when ``truncated`` is true. That is the one deliberate
    departure from the Rust "cursor iff truncated" invariant, and the door
    must name its enumeration route beside the meta instead (plan Phase 3,
    "a keyset cursor on /memory/query is IMPOSSIBLE").

    * ``pool_capped`` false — every arm returned all of its matches, so the
      pool IS the match set: ``exact``, ``total = pool_size``,
      ``truncated = pool_size > limit``.
    * ``pool_capped`` true and ``pool_size > limit`` — more matches exist than
      shown, and more may exist than the pool saw: ``at_least``,
      ``total: null``, ``truncated: true``.
    * ``pool_capped`` true and ``pool_size <= limit`` — the page shows the whole
      pool, but a capped arm may have left matches unseen, so whether more
      exist did not resolve: ``unknown``, ``truncated: null``. Reporting
      ``at_least`` with ``truncated: false`` would contradict itself, and
      ``false`` would claim a completeness nothing measured.
    """
    if not pool_capped:
        return from_count(shown, limit, pool_size)
    if pool_size > limit:
        return _meta(
            shown=shown,
            limit=limit,
            total=None,
            truncated=True,
            bound_kind=BoundKind.at_least,
            next_cursor=None,
        )
    return unknown(shown, limit)


def merge_into(target: dict[str, Any], meta: BoundedReadMeta) -> dict[str, Any]:
    """Merge the envelope keys into a dict response, overwriting only them.

    For doors that answer with a plain dict rather than a model that can
    subclass :class:`BoundedReadMeta`; every other key is left as the door
    wrote it. Mirrors the Rust ``BoundedReadMeta::insert_into``. Returns
    ``target`` for chaining.
    """
    target.update(meta.model_dump(mode="json"))
    return target
