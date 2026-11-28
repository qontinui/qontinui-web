"""Schema-level regression for the per-machine CI-node consent surface.

Plan ``2026-08-07-runner-local-ci-parity-and-web-configuration`` §Phase 4.
``CiNodeConfig`` mirrors the runner's Rust ``CiNodeSettings``; these tests pin
the properties that make it a CONSENT surface rather than a preferences blob,
so a later "convenience" edit has to delete a test to weaken them:

1. The defaults are the RUNNER's defaults — off, empty allowlist, capacity
   unset (``None``: the runner derives it from the host, qontinui-runner#1684),
   20 GiB. A machine nobody has configured must round-trip as the posture the
   runner actually ships with, never a friendlier one — and never pinned to a
   number the web invented.
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
    assert cfg.max_concurrent_builds is None
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


@pytest.mark.parametrize("value", [0, 65, -1])
def test_concurrent_builds_stay_within_a_sane_band(value: int) -> None:
    with pytest.raises(ValidationError):
        CiNodeConfig(max_concurrent_builds=value)


@pytest.mark.parametrize("value", [1, 3, 64])
def test_an_explicit_concurrency_is_kept_as_an_override(value: int) -> None:
    assert CiNodeConfig(max_concurrent_builds=value).max_concurrent_builds == value


def test_unset_concurrency_round_trips_as_none() -> None:
    """``None`` ("use the host's suggestion") survives the stored JSON envelope
    — as an explicit ``null`` or as an absent key — and never comes back as a
    number."""
    original = CiNodeConfig(enabled=True, repo_allowlist=["qontinui/qontinui-web"])
    stored = original.model_dump(mode="json")
    assert stored["max_concurrent_builds"] is None
    assert CiNodeConfig.model_validate(stored) == original
    stored.pop("max_concurrent_builds")
    assert CiNodeConfig.model_validate(stored).max_concurrent_builds is None


def test_coord_payload_omits_an_unset_concurrency() -> None:
    """Deploy-order guard: a coord predating the Option-typed relay reads the
    field as ``u32`` and refuses a ``null``; an absent key falls back to its
    default there and reads as ``None`` on a newer coord."""
    body = CiNodeConfig(enabled=True).coord_payload()
    assert "max_concurrent_builds" not in body
    # Every other field is still carried, including the falsy/empty ones.
    assert body == {"enabled": True, "repo_allowlist": [], "min_free_disk_gb": 20}


def test_coord_payload_carries_an_explicit_concurrency() -> None:
    body = CiNodeConfig(max_concurrent_builds=4).coord_payload()
    assert body["max_concurrent_builds"] == 4
    expected = CiNodeConfig(max_concurrent_builds=4).model_dump(mode="json")
    # An unset ``model_access`` / ``canonical_converge`` is omitted too — see
    # their own tests below.
    expected.pop("model_access")
    expected.pop("canonical_converge")
    assert body == expected


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


# ---------------------------------------------------------------------------
# model_access — the device-scope off-switch (plan
# ``2026-10-13-ci-node-runs-model-dependent-eval-steps`` D6 / Phase 4)
# ---------------------------------------------------------------------------


def test_model_access_defaults_to_not_set_here() -> None:
    """``None`` is "this surface never spoke", NOT the runner's ``True``: an
    absent value must leave the runner's stored consent alone."""
    assert CiNodeConfig().model_access is None


def test_coord_payload_omits_an_unset_model_access() -> None:
    """An absent key is "no change" on the runner, so a save that never touched
    the switch cannot re-enable a device its owner switched off there."""
    body = CiNodeConfig(enabled=True).coord_payload()
    assert "model_access" not in body


@pytest.mark.parametrize("value", [True, False])
def test_coord_payload_carries_an_explicit_model_access(value: bool) -> None:
    body = CiNodeConfig(model_access=value).coord_payload()
    assert body["model_access"] is value


@pytest.mark.parametrize("value", [True, False, None])
def test_model_access_round_trips_through_the_stored_json_envelope(
    value: bool | None,
) -> None:
    original = CiNodeConfig(enabled=True, model_access=value)
    stored = original.model_dump(mode="json")
    assert stored["model_access"] is value
    assert CiNodeConfig.model_validate(stored) == original


def test_a_row_saved_before_the_switch_reads_as_not_set() -> None:
    """A JSONB envelope written before the field existed has no such key."""
    cfg = CiNodeConfig.model_validate(
        {
            "enabled": True,
            "repo_allowlist": [],
            "min_free_disk_gb": 20,
        }
    )
    assert cfg.model_access is None
    assert "model_access" not in cfg.coord_payload()


# Values pydantic's LAX ``bool`` would read as a boolean. A consent or grant
# arriving as one of these is refused rather than forwarded as an explicit
# choice nobody made as a boolean (measured before ``StrictBool``:
# ``{"canonical_converge": "yes"}`` reached ``coord_payload`` as ``True``).
_LAX_BOOLEANS = ["yes", "on", "1", 1, "true", "no", "off", "0", 0, "false"]


@pytest.mark.parametrize("value", [*_LAX_BOOLEANS, "sometimes"])
def test_model_access_accepts_only_a_real_boolean(value: object) -> None:
    with pytest.raises(ValidationError):
        CiNodeConfig(model_access=value)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# canonical_converge — the device's toolchain-convergence GRANT (plan
# ``2026-11-28-a-coord-relayed-ci-node-directive-revokes-the-canonical-convergence-grant``
# Phase 3). Absent means KEEP the device's current grant; only an explicit
# ``True`` (grant) / ``False`` (revoke) travels.
# ---------------------------------------------------------------------------


def test_canonical_converge_defaults_to_not_set_here() -> None:
    """``None`` is "this surface never spoke", NOT the runner's ``False``: an
    absent value must leave the grant the device holds alone, whichever way
    it was set."""
    assert CiNodeConfig().canonical_converge is None


def test_coord_payload_omits_an_unset_canonical_converge() -> None:
    """An absent key is KEEP on the runner, so a save that never touched the
    grant can neither revoke one its owner set on the machine nor grant one."""
    body = CiNodeConfig(enabled=True, model_access=True).coord_payload()
    assert "canonical_converge" not in body
    # Only the grant is dropped: the other consent still travels.
    assert body["model_access"] is True


@pytest.mark.parametrize("value", [True, False])
def test_coord_payload_carries_an_explicit_canonical_converge(value: bool) -> None:
    body = CiNodeConfig(canonical_converge=value).coord_payload()
    assert body["canonical_converge"] is value


@pytest.mark.parametrize("value", [True, False, None])
def test_canonical_converge_round_trips_through_the_stored_json_envelope(
    value: bool | None,
) -> None:
    original = CiNodeConfig(enabled=True, canonical_converge=value)
    stored = original.model_dump(mode="json")
    assert stored["canonical_converge"] is value
    restored = CiNodeConfig.model_validate(stored)
    assert restored == original
    assert restored.canonical_converge is value


def test_a_row_saved_before_the_grant_reads_as_not_set() -> None:
    """A JSONB envelope written before the field existed has no such key, and
    must forward none — never a revoke the owner did not make."""
    cfg = CiNodeConfig.model_validate(
        {
            "enabled": True,
            "repo_allowlist": [],
            "min_free_disk_gb": 20,
            "model_access": False,
        }
    )
    assert cfg.canonical_converge is None
    assert "canonical_converge" not in cfg.coord_payload()


@pytest.mark.parametrize("value", [*_LAX_BOOLEANS, "sometimes"])
def test_canonical_converge_accepts_only_a_real_boolean(value: object) -> None:
    with pytest.raises(ValidationError):
        CiNodeConfig(canonical_converge=value)  # type: ignore[arg-type]


@pytest.mark.parametrize("field", ["model_access", "canonical_converge"])
def test_a_json_boolean_still_parses(field: str) -> None:
    """Strictness refuses look-alikes, not booleans: a JSON body (the route's
    input) and a stored JSONB envelope (``model_validate``) both still load."""
    assert (
        getattr(CiNodeConfig.model_validate_json(f'{{"{field}": true}}'), field) is True
    )
    assert getattr(CiNodeConfig.model_validate({field: False}), field) is False
