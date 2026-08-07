"""Schema-level regression for the per-machine CI-node consent surface.

Plan ``2026-08-07-runner-local-ci-parity-and-web-configuration`` §Phase 4.
``CiNodeConfig`` mirrors the runner's Rust ``CiNodeSettings``; these tests pin
the properties that make it a CONSENT surface rather than a preferences blob,
so a later "convenience" edit has to delete a test to weaken them:

1. The defaults are the RUNNER's defaults — off, empty allowlist, 1 build, 20
   GiB. A machine nobody has configured must round-trip as the posture the
   runner actually ships with, never a friendlier one.
2. There is no wildcard. ``*`` and ``all`` are rejected with their own message,
   because "allow everything" is precisely the affordance this feature must
   not have and a caller reaching for it deserves to be told so.
3. Entries are the two forms the runner's admission check matches (``owner/name``
   or a bare repo name) and nothing else — the value ends up governing what
   executes on someone's machine.
4. The disk floor cannot be set to 0 from this surface. Disabling a safety
   floor remotely should not be one keystroke; the runner's settings.json
   remains the escape hatch for anyone who truly means it.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.devenv import CI_NODE_MAX_ALLOWLIST_ENTRIES, CiNodeConfig


def test_defaults_match_the_runner_defaults() -> None:
    cfg = CiNodeConfig()
    assert cfg.enabled is False
    assert cfg.repo_allowlist == []
    assert cfg.max_concurrent_builds == 1
    assert cfg.min_free_disk_gb == 20


@pytest.mark.parametrize("entry", ["*", "qontinui/*", "*/*", "all"])
def test_wildcard_entries_are_rejected_with_their_own_message(entry: str) -> None:
    with pytest.raises(ValidationError) as exc:
        CiNodeConfig(repo_allowlist=[entry])
    assert "no wildcard" in str(exc.value)


@pytest.mark.parametrize(
    "entry",
    ["", "   ", "owner/name/extra", "owner name", "owner/na me", "a" * 201],
)
def test_malformed_entries_are_rejected(entry: str) -> None:
    with pytest.raises(ValidationError):
        CiNodeConfig(repo_allowlist=[entry])


def test_accepts_the_two_forms_the_runner_matches_and_dedupes() -> None:
    cfg = CiNodeConfig(
        repo_allowlist=[
            " qontinui/qontinui-web ",
            "qontinui-web",
            "qontinui/qontinui-web",
        ]
    )
    # Trimmed, order-preserving, duplicate dropped (not an error — pasting the
    # same repo twice is a slip, not an instruction).
    assert cfg.repo_allowlist == ["qontinui/qontinui-web", "qontinui-web"]


def test_allowlist_length_is_bounded() -> None:
    entries = [f"owner/repo-{i}" for i in range(CI_NODE_MAX_ALLOWLIST_ENTRIES + 1)]
    with pytest.raises(ValidationError):
        CiNodeConfig(repo_allowlist=entries)


def test_disk_floor_cannot_be_disabled_from_this_surface() -> None:
    with pytest.raises(ValidationError):
        CiNodeConfig(min_free_disk_gb=0)
    assert CiNodeConfig(min_free_disk_gb=1).min_free_disk_gb == 1


def test_concurrent_builds_stay_within_a_sane_band() -> None:
    with pytest.raises(ValidationError):
        CiNodeConfig(max_concurrent_builds=0)
    with pytest.raises(ValidationError):
        CiNodeConfig(max_concurrent_builds=65)


def test_round_trips_through_the_stored_json_envelope() -> None:
    """The JSONB column stores ``model_dump(mode="json")`` and reads it back."""
    original = CiNodeConfig(
        enabled=True,
        max_concurrent_builds=2,
        repo_allowlist=["qontinui/qontinui-web"],
        min_free_disk_gb=40,
    )
    assert CiNodeConfig.model_validate(original.model_dump(mode="json")) == original


def test_an_unknown_stored_key_does_not_break_the_read() -> None:
    """A config written by a newer schema must still load on an older one.

    The runner's ``CiNodeSettings`` is the authority for the shape and will
    gain fields. A stored envelope carrying one this build does not know must
    degrade to "ignored", not to a 500 on the machines page.
    """
    cfg = CiNodeConfig.model_validate(
        {
            "enabled": True,
            "max_concurrent_builds": 1,
            "repo_allowlist": [],
            "min_free_disk_gb": 20,
            "some_future_knob": 7,
        }
    )
    assert cfg.enabled is True
