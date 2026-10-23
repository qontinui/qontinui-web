"""The presentation scope's rules, without a database.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3). Covers
``app.services.presentation_scope`` (owner and term normalisation, the two
defaults, the fold) and the write schema's validation:

* **Owners** — a GitHub owner is compared trimmed, without ``@`` and
  lower-cased, and anything that is not an owner login is refused at the write
  and skipped in coord's list.
* **Terms** — folded exactly as the frontend matches them, so the server's
  de-duplication and the client's matching agree.
* **The first-party default** — the owners of the tenant's REGISTERED
  repositories, read from coord's tenant-scoped ``/pr-merge/repos``; every way
  that read can fail is a typed UNKNOWN, never an empty list.
* **The confidential-term default** — the viewer's OTHER projects' names,
  minus a name the active project shares.
* **The fold** — configured owners win outright (an explicit ``[]``
  included); the terms are always the union with the viewer's names.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints import operations
from app.models.presentation_scope import (
    MAX_CONFIDENTIAL_TERM_LENGTH,
    MAX_CONFIDENTIAL_TERMS,
    MAX_FIRST_PARTY_OWNERS,
)
from app.schemas.presentation import PresentationScopeWrite
from app.services import presentation_scope as rules
from app.services.coord_identity import CoordIdentity, CoordTenant

# ===========================================================================
# Owners
# ===========================================================================


@pytest.mark.parametrize(
    ("raw", "owner"),
    [
        ("qontinui", "qontinui"),
        ("  Qontinui  ", "qontinui"),
        ("@Acme-Corp", "acme-corp"),
        ("a", "a"),
        ("a" * 39, "a" * 39),
        ("a" * 40, None),
        ("-acme", None),
        ("acme-", None),
        ("ac--me", None),
        ("acme corp", None),
        ("acme/web", None),
        ("", None),
        (None, None),
        (42, None),
    ],
)
def test_normalize_owner_presentation(raw: object, owner: str | None) -> None:
    assert rules.normalize_owner(raw) == owner


@pytest.mark.parametrize(
    ("repo", "owner"),
    [
        ("qontinui/qontinui-web", "qontinui"),
        ("Qontinui/Qontinui-Web", "qontinui"),
        ("https://github.com/Acme-Corp/site", "acme-corp"),
        ("https://www.github.com/acme-corp/site.git", "acme-corp"),
        ("git@github.com:acme-corp/site.git", "acme-corp"),
        ("qontinui-web", None),
        ("qontinui/", None),
        ("/qontinui-web", None),
        ("not an owner/web", None),
        (None, None),
    ],
)
def test_owner_of_repo_presentation(repo: object, owner: str | None) -> None:
    assert rules.owner_of_repo(repo) == owner


def test_registered_repo_owners_are_distinct_and_sorted_presentation() -> None:
    payload = {
        "repos": [
            {"repo": "qontinui/qontinui-web", "role": "app"},
            {"repo": "Qontinui/qontinui-coord"},
            {"repo": "acme-corp/site"},
            {"repo": "no-owner"},
            {"role": "missing repo"},
        ],
        "total": 5,
    }
    assert rules.registered_repo_owners(payload) == ["acme-corp", "qontinui"]


@pytest.mark.parametrize(
    "payload",
    [None, [], {"total": 0}, {"repos": "nope"}, {"repos": ["qontinui/web"]}],
)
def test_a_repository_list_this_build_cannot_read_is_refused_presentation(
    payload: Any,
) -> None:
    """An unreadable shape is UNKNOWN for the caller, never "no repositories"."""
    with pytest.raises(ValueError):
        rules.registered_repo_owners(payload)


def test_an_empty_repository_list_is_an_answer_presentation() -> None:
    assert rules.registered_repo_owners({"repos": [], "total": 0}) == []


# ===========================================================================
# Terms
# ===========================================================================


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("Acme Corp", "ACME-corp"),
        ("Acme Corp", "acmecorp"),
        ("Café Noir", "cafe noir"),
        ("Ｆｕｌｌｗｉｄｔｈ", "fullwidth"),
        ("Zürich AG", "zurich-ag"),
    ],
)
def test_match_key_folds_like_the_frontend_presentation(left: str, right: str) -> None:
    """The same fold as ``normalizeForMatch`` in
    ``frontend/src/components/presentation/redaction.ts``."""
    assert rules.match_key(left) == rules.match_key(right)
    assert rules.match_key(left)


def test_match_key_keeps_other_scripts_presentation() -> None:
    assert rules.match_key("株式会社 Ω") == "株式会社ω"


def test_dedupe_terms_keeps_the_first_spelling_presentation() -> None:
    assert rules.dedupe_terms(
        ["  Acme   Corp ", "ACME-corp", "Globex", "--", "", "globex"]
    ) == ["Acme Corp", "Globex"]


# ===========================================================================
# The viewer's other projects
# ===========================================================================

ACTIVE = UUID("00000000-0000-0000-0000-00000000000a")
OTHER = UUID("00000000-0000-0000-0000-00000000000b")
THIRD = UUID("00000000-0000-0000-0000-00000000000c")


def _identity(
    *memberships: tuple[UUID, str, str | None], home: UUID | None = ACTIVE
) -> CoordIdentity:
    return CoordIdentity(
        operator_id=None,
        home_tenant_id=home,
        email="operator@example.com",
        roles=("admin",),
        tenants=tuple(
            CoordTenant(
                tenant_id=tid, slug=slug, roles=("admin",), display_name=display
            )
            for tid, slug, display in memberships
        ),
        is_admin=True,
    )


def test_the_viewer_names_are_their_other_projects_presentation() -> None:
    identity = _identity(
        (ACTIVE, "our-project", "Our Project"),
        (OTHER, "acme-corp", "Acme Corp"),
        (THIRD, "globex", None),
    )
    # "Acme Corp" and "acme-corp" fold to one key: the display name is kept.
    assert rules.viewer_other_tenant_names(identity, ACTIVE) == [
        "Acme Corp",
        "globex",
    ]


def test_a_name_the_active_project_shares_is_not_a_term_presentation() -> None:
    """Withholding a name the active project also carries would withhold the
    project's own titles while telling the other party apart from nobody."""
    identity = _identity(
        (ACTIVE, "qontinui", "Qontinui"),
        (OTHER, "qontinui-2", "QONTINUI"),
    )
    assert rules.viewer_other_tenant_names(identity, ACTIVE) == ["qontinui-2"]


def test_a_viewer_with_one_project_brings_no_names_presentation() -> None:
    assert (
        rules.viewer_other_tenant_names(_identity((ACTIVE, "solo", None)), ACTIVE) == []
    )


# ===========================================================================
# The registered-repository read
# ===========================================================================


@pytest.fixture()
def coord_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, UUID | None]]:
    """Records every coord read the rules module makes."""
    calls: list[tuple[str, UUID | None]] = []

    async def default(path: str, *, tenant_id: UUID | None = None, **_: Any) -> Any:
        calls.append((path, tenant_id))
        return {"repos": [{"repo": "qontinui/qontinui-web"}], "total": 1}

    monkeypatch.setattr(rules, "_proxy_coord_get", default)
    return calls


@pytest.mark.asyncio
async def test_the_read_asks_coord_for_the_tenant_repo_list_presentation(
    coord_calls: list[tuple[str, UUID | None]],
) -> None:
    read = await rules.read_registered_repo_owners(
        _identity((ACTIVE, "a", None)), ACTIVE
    )
    assert read == rules.OwnersRead(owners=("qontinui",), unknown_reason=None)
    # The tenant-scoped list, never the fleet-wide `/coord/canonical-repos`.
    assert coord_calls == [("/pr-merge/repos", ACTIVE)]


@pytest.mark.asyncio
async def test_a_project_coord_did_not_resolve_is_not_read_presentation(
    coord_calls: list[tuple[str, UUID | None]],
) -> None:
    """Coord scopes the list to ITS effective tenant; when that is not the
    tenant this backend resolved, the list would be another project's."""
    identity = _identity((ACTIVE, "a", None), (OTHER, "b", None), home=OTHER)
    read = await rules.read_registered_repo_owners(identity, ACTIVE)
    assert read == rules.OwnersRead(owners=None, unknown_reason="tenant_scope_mismatch")
    assert coord_calls == []


def _raiser(exc: BaseException) -> Any:
    async def fake(path: str, **_: Any) -> Any:
        raise exc

    return fake


@pytest.mark.parametrize(
    ("exc", "reason"),
    [
        (
            operations._coord_unreachable(operations.CoordTransportUnavailable),
            "coord_unreachable",
        ),
        (
            operations._coord_timeout(
                operations.CoordTransportUnavailable, write=False
            ),
            "coord_unreachable",
        ),
        (HTTPException(status_code=503, detail="down"), "coord_refused"),
        (HTTPException(status_code=403, detail="no"), "coord_refused"),
        (httpx.ReadError("reset"), "coord_unreachable"),
        (json.JSONDecodeError("not json", "<html>", 0), "coord_unreadable"),
    ],
)
@pytest.mark.asyncio
async def test_every_failed_read_is_a_typed_unknown_presentation(
    monkeypatch: pytest.MonkeyPatch, exc: BaseException, reason: str
) -> None:
    monkeypatch.setattr(rules, "_proxy_coord_get", _raiser(exc))
    read = await rules.read_registered_repo_owners(
        _identity((ACTIVE, "a", None)), ACTIVE
    )
    assert read.owners is None
    assert read.unknown_reason == reason


@pytest.mark.asyncio
async def test_a_list_coord_sent_malformed_is_unknown_presentation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def malformed(path: str, **_: Any) -> Any:
        return {"repos": "not a list"}

    monkeypatch.setattr(rules, "_proxy_coord_get", malformed)
    read = await rules.read_registered_repo_owners(
        _identity((ACTIVE, "a", None)), ACTIVE
    )
    assert read == rules.OwnersRead(owners=None, unknown_reason="coord_unreadable")


# ===========================================================================
# The fold
# ===========================================================================

_REGISTERED = rules.OwnersRead(owners=("qontinui",), unknown_reason=None)
_UNKNOWN = rules.OwnersRead(owners=None, unknown_reason="coord_unreachable")


def test_with_nothing_configured_the_registered_owners_apply_presentation() -> None:
    scope = rules.effective_scope(
        configured_owners=None,
        configured_terms=(),
        registered=_REGISTERED,
        viewer_names=["Acme Corp"],
    )
    assert scope.first_party_owners == ("qontinui",)
    assert scope.first_party_owners_source == "registered_repos"
    assert scope.first_party_owners_unknown_reason is None
    assert scope.confidential_terms == ("Acme Corp",)


def test_unknown_registered_owners_stay_unknown_presentation() -> None:
    scope = rules.effective_scope(
        configured_owners=None,
        configured_terms=(),
        registered=_UNKNOWN,
        viewer_names=[],
    )
    assert scope.first_party_owners is None
    assert scope.first_party_owners_unknown_reason == "coord_unreachable"


@pytest.mark.parametrize("configured", [["acme-labs"], []])
def test_configured_owners_win_even_when_empty_presentation(
    configured: list[str],
) -> None:
    for registered in (_REGISTERED, _UNKNOWN):
        scope = rules.effective_scope(
            configured_owners=configured,
            configured_terms=(),
            registered=registered,
            viewer_names=[],
        )
        assert scope.first_party_owners == tuple(configured)
        assert scope.first_party_owners_source == "configured"
        assert scope.first_party_owners_unknown_reason is None


def test_the_terms_are_always_the_union_presentation() -> None:
    """A saved list never stops withholding the viewer's other projects."""
    scope = rules.effective_scope(
        configured_owners=["qontinui"],
        configured_terms=["Initech", "acme corp"],
        registered=_REGISTERED,
        viewer_names=["Acme Corp", "Globex"],
    )
    assert scope.confidential_terms == ("Initech", "acme corp", "Globex")


# ===========================================================================
# The write schema
# ===========================================================================


def _write(**body: Any) -> PresentationScopeWrite:
    return PresentationScopeWrite.model_validate(
        {
            "first_party_owners": None,
            "confidential_terms": [],
            "expected_version": 0,
            **body,
        }
    )


def test_owners_are_stored_normalised_presentation() -> None:
    write = _write(first_party_owners=[" @Qontinui ", "qontinui", "Acme-Corp"])
    assert write.first_party_owners == ["qontinui", "acme-corp"]


@pytest.mark.parametrize("bad", ["acme corp", "acme/web", "", "-x"])
def test_a_non_owner_is_refused_presentation(bad: str) -> None:
    with pytest.raises(ValidationError, match="is not a GitHub user or organization"):
        _write(first_party_owners=[bad])


def test_null_owners_mean_use_the_registered_repositories_presentation() -> None:
    assert _write(first_party_owners=None).first_party_owners is None
    assert _write(first_party_owners=[]).first_party_owners == []


def test_too_many_owners_are_refused_presentation() -> None:
    owners = [f"owner-{i}" for i in range(MAX_FIRST_PARTY_OWNERS + 1)]
    with pytest.raises(ValidationError, match="first-party owners"):
        _write(first_party_owners=owners)


def test_terms_are_stored_clean_and_distinct_presentation() -> None:
    write = _write(confidential_terms=["  Acme   Corp ", "ACME-corp", "Globex"])
    assert write.confidential_terms == ["Acme Corp", "Globex"]


@pytest.mark.parametrize("bad", ["", "   ", "--", "!!!"])
def test_a_term_that_names_nothing_is_refused_presentation(bad: str) -> None:
    with pytest.raises(ValidationError, match="would match nothing"):
        _write(confidential_terms=[bad])


def test_an_overlong_term_is_refused_presentation() -> None:
    with pytest.raises(ValidationError, match="characters"):
        _write(confidential_terms=["x" * (MAX_CONFIDENTIAL_TERM_LENGTH + 1)])


def test_too_many_terms_are_refused_presentation() -> None:
    terms = [f"term {i}" for i in range(MAX_CONFIDENTIAL_TERMS + 1)]
    with pytest.raises(ValidationError, match="confidential terms"):
        _write(confidential_terms=terms)


def test_the_write_names_every_field_and_no_other_presentation() -> None:
    with pytest.raises(ValidationError):
        PresentationScopeWrite.model_validate(
            {"confidential_terms": [], "expected_version": 0}
        )
    with pytest.raises(ValidationError):
        PresentationScopeWrite.model_validate(
            {"first_party_owners": None, "confidential_terms": []}
        )
    with pytest.raises(ValidationError):
        _write(tenant_id=str(uuid4()))
    with pytest.raises(ValidationError):
        _write(expected_version=-1)
