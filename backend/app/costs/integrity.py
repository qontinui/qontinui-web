"""Turn a database integrity refusal into the refusal a caller can act on.

A store checks what it can before writing (the vendor and phase exist in this
project), but a concurrent delete can still remove one between that check and
the flush, and a unique constraint is only decided by the database. Each is
mapped by the CONSTRAINT that refused it — never by guessing that every
integrity error means a duplicate.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

from app.overview.resource import StoreRefused


def constraint_name(exc: IntegrityError) -> str | None:
    """The violated constraint's name, from asyncpg (``constraint_name``) or
    psycopg (``diag.constraint_name``) under SQLAlchemy's wrapper."""
    for candidate in (exc.orig, getattr(exc.orig, "__cause__", None)):
        if candidate is None:
            continue
        name = getattr(candidate, "constraint_name", None)
        if name:
            return str(name)
        diag = getattr(candidate, "diag", None)
        if diag is not None and getattr(diag, "constraint_name", None):
            return str(diag.constraint_name)
    return None


def refusal_for(exc: IntegrityError) -> StoreRefused:
    name = constraint_name(exc) or ""
    if name == "uq_overview_cost_entries_source_ref":
        return StoreRefused(
            409, "name_taken", "This vendor already has an entry with that reference."
        )
    if "vendor_id" in name:
        return StoreRefused(
            422,
            "unknown_vendor",
            "That vendor no longer exists in this project (it was just deleted).",
        )
    if "phase_id" in name:
        return StoreRefused(
            422,
            "unknown_phase",
            "That phase no longer exists in this project (it was just removed).",
        )
    return StoreRefused(
        409,
        "conflict",
        f"The database refused the write ({name or 'an unnamed constraint'}); "
        "reload and try again.",
    )
