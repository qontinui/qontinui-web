"""Wire shapes of ``/api/v1/presentation/scope``.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3). The frontend's
presentation lens maps these snake_case fields to its camelCase
``PresentationScope``; the tenant-policy page's form reads and writes them.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.presentation_scope import (
    MAX_CONFIDENTIAL_TERM_LENGTH,
    MAX_CONFIDENTIAL_TERMS,
    MAX_FIRST_PARTY_OWNERS,
    MAX_SCOPE_VERSION,
)
from app.services.presentation_scope import (
    OwnersSource,
    UnknownReason,
    clean_term,
    match_key,
    normalize_owner,
)


def _storable(text: str) -> bool:
    """Whether Postgres ``text`` can hold ``text``: no NUL (which ``text``
    refuses) and no unpaired surrogate (which has no UTF-8 encoding). Either
    would pass validation and come back from the database as a 500 instead of
    a 422 -- the same refusal ``schemas/overview.py`` ``_no_nul`` makes."""
    if "\x00" in text:
        return False
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


class PresentationScopeWrite(BaseModel):
    """``PUT /presentation/scope`` — replaces the tenant's stored scope.

    A refusal names a confidential term by its position, never by its text:
    the terms are the names presentation mode exists to keep off screen.
    """

    model_config = ConfigDict(extra="forbid")

    first_party_owners: list[str] | None = Field(
        ...,
        description=(
            "GitHub owners whose repositories are this project's own, or null "
            "to use the owners of the project's registered repositories. An "
            "empty list withholds every title in presentation mode. Stored "
            "trimmed, without a leading @, lower-cased and de-duplicated."
        ),
    )
    confidential_terms: list[str] = Field(
        ...,
        description=(
            "Terms that withhold a title wherever they appear, matched "
            "ignoring case, accents, spacing and punctuation. Stored trimmed "
            "with whitespace collapsed; a term matching an earlier one is "
            "dropped. The viewer's other projects' names are always added on "
            "read and are never stored."
        ),
    )
    expected_version: int = Field(
        ...,
        ge=0,
        le=MAX_SCOPE_VERSION,
        description=(
            "The `configured.version` this edit was made against (0 when the "
            "project has never saved a scope). A write against a version that "
            "moved answers 409 `presentation_scope_conflict`."
        ),
    )
    expected_tenant_id: UUID = Field(
        ...,
        description=(
            "The `tenant_id` of the scope this edit was made against. It never "
            "chooses the row -- the write lands in the project this request "
            "resolves to -- it only refuses a write made for another project: "
            "when the two differ the answer is 409 "
            "`presentation_scope_tenant_mismatch` and nothing is written."
        ),
    )

    @field_validator("first_party_owners")
    @classmethod
    def _owners(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if len(value) > MAX_FIRST_PARTY_OWNERS:
            raise ValueError(
                f"at most {MAX_FIRST_PARTY_OWNERS} first-party owners may be named"
            )
        owners: list[str] = []
        for raw in value:
            owner = normalize_owner(raw)
            if owner is None:
                raise ValueError(f"{raw!r} is not a GitHub user or organization name")
            if owner not in owners:
                owners.append(owner)
        return owners

    @field_validator("confidential_terms")
    @classmethod
    def _terms(cls, value: list[str]) -> list[str]:
        if len(value) > MAX_CONFIDENTIAL_TERMS:
            raise ValueError(
                f"at most {MAX_CONFIDENTIAL_TERMS} confidential terms may be stored"
            )
        terms: list[str] = []
        keys: set[str] = set()
        for position, raw in enumerate(value, start=1):
            if not _storable(raw):
                raise ValueError(
                    f"confidential term {position} holds a character that cannot "
                    "be stored (a NUL or an unpaired surrogate)"
                )
            term = clean_term(raw)
            if len(term) > MAX_CONFIDENTIAL_TERM_LENGTH:
                raise ValueError(
                    f"confidential term {position} is longer than "
                    f"{MAX_CONFIDENTIAL_TERM_LENGTH} characters"
                )
            key = match_key(term)
            if not key:
                raise ValueError(
                    f"confidential term {position} has no letter or digit, so it "
                    "would match nothing"
                )
            if key not in keys:
                keys.add(key)
                terms.append(term)
        return terms


class PresentationScopeConfigured(BaseModel):
    """What the project has stored — the form's editable half."""

    first_party_owners: list[str] | None = Field(
        description="The stored owners, or null when none are configured."
    )
    confidential_terms: list[str]
    version: int = Field(description="0 when the project has never saved a scope.")
    updated_at: datetime | None
    updated_by: str | None = Field(
        description="The email of whoever saved it last, when that is known."
    )


class PresentationScopeDefaults(BaseModel):
    """What applies when nothing is configured, read fresh for this viewer."""

    registered_repo_owners: list[str] | None = Field(
        description=(
            "The owners of this project's registered repositories, or null "
            "when they could not be read."
        )
    )
    registered_repo_owners_unknown_reason: UnknownReason | None
    viewer_other_tenant_names: list[str] = Field(
        description=(
            "The names of the viewer's other projects. Always withheld for "
            "this viewer, whatever is configured."
        )
    )


class PresentationScopeOut(BaseModel):
    """The scope a presentation-mode render applies, and how it was reached."""

    tenant_id: UUID
    first_party_owners: list[str] | None = Field(
        description=(
            "The owners whose items may show their titles. Null means UNKNOWN "
            "(see first_party_owners_unknown_reason): withhold everything."
        )
    )
    first_party_owners_source: OwnersSource
    first_party_owners_unknown_reason: UnknownReason | None
    confidential_terms: list[str] = Field(
        description="The configured terms plus the viewer's other projects' names."
    )
    configured: PresentationScopeConfigured
    defaults: PresentationScopeDefaults
    can_edit: bool = Field(
        description=(
            "Whether this caller may PUT the scope: an admin of this project, "
            "or qontinui staff — the same rule the PUT enforces."
        )
    )
