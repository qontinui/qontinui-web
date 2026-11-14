"""What a versioned resource published from a repository file shares.

Pages (plan ``2026-10-07-agents-publish-documents-to-the-project-overview``
D3) and reports (plan
``2026-11-07-interactive-stakeholder-reports-in-the-project-overview`` D7)
are both markdown an agent publishes from a repository file and a person may
edit in place. Both keep every content write as a version. The rules they
share live here once, so the two stores cannot drift apart on them:

* **The source.** ``source_repo`` + ``source_path`` name the file a record
  mirrors and ``source_sha`` the commit; :class:`SourceFields` validates and
  normalises them (one lowercase spelling of a repository, a path that cannot
  display as another, a full commit sha) and keeps the pair rule.
* **A publish never overwrites the wrong record.** A write naming a source
  refuses a record whose source is absent or different
  (:func:`refuse_source_mismatch`, 409 ``source_mismatch``).
* **The sha follows the content.** New content that names no commit no longer
  mirrors the stored one, so the sha becomes unknown rather than vouching for
  a body it never produced (:func:`content_changes`).
* **Nothing changed is no write.** :func:`changes_anything` decides it; the
  store then returns the record as it was, and the router logs nothing.
* **A change is a version.** :func:`bump_version` moves ``current_version``,
  the contract's ``version``; the store appends its own version row.
* **A retry converges, a different write does not.** A create that collides
  on a unique rule is refused ``name_taken`` (:func:`insert_or_refuse`); a
  store's ``adopt_existing`` then compares the record with the create
  (:func:`holds_content`) and converges only on exactly the same content.
* **A revert restores the sha with the content** (:func:`restored_source`)
  and is logged as an update naming the version it restored
  (:func:`log_revert`).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Awaitable, Callable, Iterable
from typing import Any, Protocol
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.overview import change_log
from app.overview.permissions import OverviewAccess
from app.overview.resource import StoreContext, StoreRefused

MAX_SOURCE_REPO = 200
MAX_SOURCE_PATH = 1000
MAX_SOURCE_SHA = 100

# ---------------------------------------------------------------------------
# The source fields
# ---------------------------------------------------------------------------

#: ``owner/name`` — the full GitHub slug, stored lowercased (GitHub's own
#: slugs are case-insensitive, so one repository has one spelling here).
#: Matched AFTER lowercasing. The owner is GitHub's account shape (letters,
#: digits, ``-``, and ``_`` for a managed user; no dots; at most 39); the name
#: is GitHub's repository shape (at most 100), never ``.`` and never holding
#: ``..`` — :func:`clean_source_repo` checks those two.
_SOURCE_REPO = re.compile(r"^[a-z0-9][a-z0-9_-]{0,38}/[a-z0-9_.-]{1,100}$")
#: Unicode categories no stored path may hold: ``Cc`` (every C0 and C1
#: control — newline, carriage return, NUL, tab, NEL — and DEL), ``Cf`` (the
#: format characters: bidi marks, embeddings, overrides and isolates, zero-width
#: spaces, word joiners, invisible operators, the BOM and the rest of the
#: category; most of them draw nothing, so they make a path DISPLAY as one it is
#: not) and the line and paragraph separators ``Zl`` / ``Zp`` (U+2028, U+2029),
#: which break a line wherever the path is shown or logged.
_PATH_FORBIDDEN_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp"})
#: The format characters ordinary spellings need, let back in BY NAME so the
#: rule stays fail-closed for the rest of ``Cf``: the soft hyphen (U+00AD), the
#: zero-width non-joiner and joiner (U+200C, U+200D: Persian and Indic
#: spellings, emoji ZWJ sequences) and the visible prepended number signs
#: (U+0600–U+0605, U+06DD, U+070F, U+0890, U+0891, U+08E2, U+110BD, U+110CD).
#: What the carve-out costs: a joiner or a soft hyphen draws nothing where it
#: is not needed, so ``runbooks/ci\u200c.md`` and ``runbooks/ci\u00ad.md``
#: are different paths that DISPLAY as ``runbooks/ci.md``. The unassigned code
#: points Unicode reserves as default-ignorable (U+2065, U+FFF0–U+FFF8,
#: U+E0000–U+E0FFF) are refused as well, since they also draw nothing.
#: The tag characters (U+E0001, U+E0020–U+E007F) are format characters
#: too, so emoji tag sequences such as subdivision flags are refused with
#: them. Nor is the rule a complete anti-spoofing guarantee: invisible or
#: look-alike characters outside these categories (variation selectors,
#: U+034F, U+3164, the NFC and NFD spellings of one name) are accepted. A
#: path is part of a record's identity, so it is refused rather than edited
#: (``files.py`` instead strips the other ``Cf`` characters from an upload's
#: display name, and keeps these).
SPELLING_FORMAT_CHARS = frozenset(
    "\u00ad\u200c\u200d"
    "\u0600\u0601\u0602\u0603\u0604\u0605\u06dd\u070f\u0890\u0891\u08e2"
    "\U000110bd\U000110cd"
)


def is_path_forbidden_char(c: str) -> bool:
    category = unicodedata.category(c)
    if category == "Cn":
        # Unassigned, but reserved by Unicode as default-ignorable: renderers
        # draw these as nothing. Any other unassigned code point is accepted,
        # so a character Unicode assigns after this runtime's version is not
        # refused for being new.
        cp = ord(c)
        return cp == 0x2065 or 0xFFF0 <= cp <= 0xFFF8 or 0xE0000 <= cp <= 0xE0FFF
    return category in _PATH_FORBIDDEN_CATEGORIES and c not in SPELLING_FORMAT_CHARS


#: A git COMMIT sha — the newest commit on the published ref touching the
#: path — in SHA-1 (40) or SHA-256 (64) form, lowercase.
_SOURCE_SHA = re.compile(r"^[0-9a-f]{40}([0-9a-f]{24})?$")


def normalize_source_repo(v: str) -> str:
    """The one stored spelling of a ``source_repo``, shared by writes and the
    list filter so a lookup matches what a write stored."""
    return v.strip().lower()


def clean_source_repo(v: str | None) -> str | None:
    if v is None:
        return None
    v = normalize_source_repo(v)
    if not v:
        return None
    if not _SOURCE_REPO.fullmatch(v) or ".." in v or v.endswith("/."):
        raise ValueError(
            "source_repo is the repository's full owner/name slug (exactly one "
            "/, and no . or .. name)"
        )
    return v


def clean_source_path(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    segments = v.split("/")
    if (
        v.startswith("/")
        or v.startswith("./")
        or "\\" in v
        or any(is_path_forbidden_char(c) for c in v)
        or any(segment in ("", ".", "..") for segment in segments)
    ):
        raise ValueError(
            "source_path is the file's path relative to the repository root "
            "(no leading / or ./, no backslash, no control character, line or "
            "paragraph separator, or format character other than a zero-width "
            "(non-)joiner, soft hyphen or prepended number sign, or reserved "
            "invisible (default-ignorable) code point, such as a newline, "
            "NUL, U+2028, U+202E, U+200B or U+E0002, and no empty, . or .. "
            "segment)"
        )
    return v


def clean_source_sha(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip().lower()
    if not v:
        return None
    if not _SOURCE_SHA.fullmatch(v):
        raise ValueError("source_sha is a full 40- or 64-hex git commit sha")
    return v


class SourceFields(BaseModel):
    """The source a published record mirrors. ``source_repo`` and
    ``source_path`` are given together or not at all; ``source_sha`` only
    with them."""

    source_repo: str | None = Field(default=None, max_length=MAX_SOURCE_REPO)
    source_path: str | None = Field(default=None, max_length=MAX_SOURCE_PATH)
    source_sha: str | None = Field(default=None, max_length=MAX_SOURCE_SHA)

    @field_validator("source_repo")
    @classmethod
    def _repo(cls, v: str | None) -> str | None:
        return clean_source_repo(v)

    @field_validator("source_path")
    @classmethod
    def _path(cls, v: str | None) -> str | None:
        return clean_source_path(v)

    @field_validator("source_sha")
    @classmethod
    def _sha(cls, v: str | None) -> str | None:
        return clean_source_sha(v)

    def _check_source(self) -> None:
        if (self.source_repo is None) != (self.source_path is None):
            raise ValueError("source_repo and source_path are given together")
        if self.source_sha is not None and self.source_repo is None:
            raise ValueError("source_sha needs source_repo and source_path")

    def _check_sha_names_source(self) -> None:
        """An update's rule: ``source_sha`` — even a null, which would clear
        the commit a mirrored record holds — is a publish's commit, and only a
        publish naming the record's source may move it."""
        if "source_sha" in self.model_fields_set and not self.has_source:
            raise ValueError(
                "source_sha is a publish's commit; name source_repo and "
                "source_path with it"
            )

    @property
    def has_source(self) -> bool:
        return self.source_repo is not None


# ---------------------------------------------------------------------------
# The versioned-content rules
# ---------------------------------------------------------------------------


class SourcedRecord(Protocol):
    """The columns every versioned, publishable record carries."""

    source_repo: str | None
    source_path: str | None
    source_sha: str | None
    current_version: int
    updated_by: str | None
    updated_at: Any


#: ``(via_device, via_session)`` of a record's version: the coord device the
#: write came through and the session the client reported.
Provenance = tuple[UUID | None, str | None]
NO_PROVENANCE: Provenance = (None, None)


def write_provenance(ctx: StoreContext) -> Provenance:
    """Who is writing this version: the device from the verified token, and
    the session the client reported (a label, never proof)."""
    return (ctx.access.via_device, change_log.reported_session(ctx.request))


async def current_provenance(
    db: AsyncSession,
    records: Iterable[Any],
    *,
    record_model: Any,
    version_model: Any,
    record_fk: Any,
) -> dict[UUID, Provenance]:
    """Who wrote each record's CURRENT version, in one query.

    ``record_fk`` is the version table's column naming its record
    (``PageVersion.page_id``)."""
    ids = [r.id for r in records]
    if not ids:
        return {}
    rows = await db.execute(
        select(record_fk, version_model.via_device, version_model.via_session)
        .join(
            record_model,
            (record_model.id == record_fk)
            & (record_model.current_version == version_model.version),
        )
        .where(record_fk.in_(ids))
    )
    return {record_id: (device, session) for record_id, device, session in rows.all()}


def refuse_source_mismatch(
    record: SourcedRecord, payload: SourceFields, *, noun: str
) -> None:
    """409 ``source_mismatch`` when ``payload`` names a source ``record`` does
    not mirror — absent or different — so a publish never overwrites a
    hand-written record, nor one mirroring another file."""
    if not payload.has_source or (
        record.source_repo is not None
        and (record.source_repo, record.source_path)
        == (payload.source_repo, payload.source_path)
    ):
        return
    mirrored = (
        f"mirrors {record.source_repo}/{record.source_path}"
        if record.source_repo is not None
        else "was not published from a repository"
    )
    raise StoreRefused(
        409,
        "source_mismatch",
        f"This {noun} {mirrored}; a publish of "
        f"{payload.source_repo}/{payload.source_path} may not overwrite it.",
    )


def content_changes(
    record: SourcedRecord,
    payload: SourceFields,
    *,
    body_field: str = "body_md",
    stripped: tuple[str, ...] = ("title",),
) -> dict[str, Any]:
    """The fields an update would set on ``record``.

    The source identity was checked by :func:`refuse_source_mismatch` and is
    never changed here; ``source_sha`` stays because it IS content. New
    content in ``body_field`` that names no commit no longer mirrors the stored
    one, so the sha becomes unknown (the same rule a revert keeps). The
    ``stripped`` fields are compared and stored trimmed."""
    changes = payload.model_dump(exclude_unset=True)
    changes.pop("source_repo", None)
    changes.pop("source_path", None)
    stored_body = getattr(record, body_field)
    if (
        record.source_sha is not None
        and "source_sha" not in changes
        and changes.get(body_field, stored_body) != stored_body
    ):
        changes["source_sha"] = None
    for name in stripped:
        if name in changes and changes[name] is not None:
            changes[name] = changes[name].strip()
    return changes


def changes_anything(record: Any, changes: dict[str, Any]) -> bool:
    """Whether setting ``changes`` on ``record`` would change it at all."""
    return any(getattr(record, key) != value for key, value in changes.items())


def bump_version(
    record: SourcedRecord, changes: dict[str, Any], actor: str | None
) -> None:
    """Apply ``changes`` as a new version of ``record``."""
    for key, value in changes.items():
        setattr(record, key, value)
    record.current_version += 1
    record.updated_by = actor
    record.updated_at = func.now()


async def insert_or_refuse(
    ctx: StoreContext,
    record: Any,
    refusal: Callable[[], Awaitable[StoreRefused]],
) -> None:
    """Insert ``record`` under a savepoint; a unique-rule collision rolls the
    savepoint back and raises the :class:`StoreRefused` ``refusal`` builds —
    ``name_taken`` for a duplicate name, which is what lets the router offer a
    keyed create to the store's ``adopt_existing``."""
    try:
        async with ctx.db.begin_nested():
            ctx.db.add(record)
            await ctx.db.flush()
    except IntegrityError as exc:
        raise await refusal() from exc


def holds_content(record: Any, payload: BaseModel, fields: tuple[str, ...]) -> bool:
    """Whether ``record`` already holds exactly what ``payload`` carries in
    ``fields`` — every one normalised by the model as a stored record was."""
    return all(getattr(record, name) == getattr(payload, name) for name in fields)


# ---------------------------------------------------------------------------
# Versions and revert
# ---------------------------------------------------------------------------


async def versions_of(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    version_model: Any,
    record_fk: Any,
    record_id: UUID,
) -> list[Any]:
    """Every version row of one record, newest first."""
    rows = await db.execute(
        select(version_model)
        .where(record_fk == record_id, version_model.tenant_id == tenant_id)
        .order_by(version_model.version.desc())
    )
    return list(rows.scalars().all())


async def version_or_404(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    version_model: Any,
    record_fk: Any,
    record_id: UUID,
    version: int,
) -> Any:
    row = (
        (
            await db.execute(
                select(version_model).where(
                    record_fk == record_id,
                    version_model.tenant_id == tenant_id,
                    version_model.version == version,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "That version does not exist."},
        )
    return row


def restored_source(record: SourcedRecord, target_sha: str | None) -> dict[str, Any]:
    """The source fields a revert's update carries. A published record's
    version mirrored a commit; restoring its content restores the sha that
    content came from, so the record never claims to mirror a commit its body
    is not. A record with no source gets none."""
    if record.source_repo is None:
        return {}
    return {
        "source_repo": record.source_repo,
        "source_path": record.source_path,
        "source_sha": target_sha,
    }


async def log_revert(
    db: AsyncSession,
    *,
    access: OverviewAccess,
    request: Request,
    resource: str,
    before: Any,
    after: Any,
    reverted_to: int,
    audit_exclude: frozenset[str],
) -> None:
    """Record a revert that wrote a new version, and commit it. Logged as an
    update naming the version it restored, without the fields another table
    already keeps in full (the bodies, in the version table). ``before`` and
    ``after`` are the resource's read shapes; a revert to content identical
    to the current version wrote nothing and logs nothing."""
    if after.version == before.version:
        return
    exclude = set(audit_exclude)
    await change_log.record(
        db,
        tenant_id=access.tenant_id,
        resource=resource,
        record_id=after.id,
        action="update",
        source=change_log.change_source(request),
        **change_log.attribution(access, request),
        before=before.model_dump(mode="json", exclude=exclude),
        after={
            **after.model_dump(mode="json", exclude=exclude),
            "reverted_to_version": reverted_to,
        },
        version_before=before.version,
        version_after=after.version,
    )
    await db.commit()
