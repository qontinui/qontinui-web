"""`COORD_URL` is overloaded; device identity gets its own knob.

`COORD_URL` addresses three independent trust relationships at once: the
admin/service-token bridge (whose shared secret is paired with exactly ONE
coord), the operator proxy routes, and the device-identity surface — JWKS
verification of device tokens plus the device-routing reads behind the
runner proxy.

Measured 2026-08-25 on the operator box: the runner was paired to the fleet
coord while the backend's `COORD_URL` pointed at a local coord container.
Both coords published the SAME `kid` over DIFFERENT keys, so every device
token was rejected — and repointing `COORD_URL` was not available as a fix,
because the local admin secret authenticated against the local coord (200)
and was rejected by the fleet coord (401), which would have fail-fast-ed the
backend at boot in `strategy_client.startup()`.

See plan `2026-08-25-coord-jwt-kid-collides-across-environments`.
"""

from __future__ import annotations

import pytest

from app.core.config import (
    coord_device_base,
    coord_device_setting_name,
    coord_device_split_active,
    settings,
)


def test_unset_means_same_as_coord_url() -> None:
    """The default must be a no-op for every existing deployment."""
    assert settings.COORD_DEVICE_URL is None, (
        "the shipped default must be unset, or existing deployments change"
    )
    assert coord_device_base() == settings.COORD_URL.rstrip("/")


def test_set_overrides_only_the_device_surface(monkeypatch: pytest.MonkeyPatch) -> None:
    """Setting it must not disturb `COORD_URL` itself.

    The admin bridge, the operator proxy routes and the strategy client all
    keep reading `COORD_URL`; only the device-identity readers follow this.
    """
    monkeypatch.setattr(settings, "COORD_DEVICE_URL", "https://coord.example.io")
    assert coord_device_base() == "https://coord.example.io"
    # ...and the admin-bridge setting is untouched.
    assert settings.COORD_URL != "https://coord.example.io"


def test_trailing_slash_is_normalised(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both readers concatenate a leading-slash path onto this base.

    `coord_device.py` builds `f"{coord_device_base()}{path}"` and the JWKS
    client builds `f"{base}/coord/auth/jwks"`, so a trailing slash would
    produce a double slash and, on some gateways, a 404.
    """
    monkeypatch.setattr(settings, "COORD_DEVICE_URL", "https://coord.example.io/")
    assert coord_device_base() == "https://coord.example.io"


def test_empty_string_falls_back_rather_than_producing_a_bare_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty value is a mis-set var, not a request for a relative URL.

    `COORD_DEVICE_URL=` in a .env parses as `""`, and a naive
    `or`-less read would yield `f"{''}{path}"` — a schemeless URL that
    httpx rejects at request time, far from the cause.
    """
    monkeypatch.setattr(settings, "COORD_DEVICE_URL", "")
    assert coord_device_base() == settings.COORD_URL.rstrip("/")


def test_setting_name_follows_the_value_actually_in_force(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The name must track `coord_device_base`, not be written out by hand.

    A rejection handler tells the operator which knob to turn. Naming
    `COORD_URL` on a split box names the ONE setting that must not be
    repointed (see this module's docstring: the admin secret 401s against
    the other coord), which is the same class of misdirection the whole
    classification exists to remove.
    """
    assert coord_device_setting_name() == "COORD_URL"

    monkeypatch.setattr(settings, "COORD_DEVICE_URL", "https://coord.example.io")
    assert coord_device_setting_name() == "COORD_DEVICE_URL"
    assert coord_device_base() == "https://coord.example.io"

    # An empty value falls back, so the name must fall back with it — the two
    # answers are read together and a disagreement would be worse than either.
    monkeypatch.setattr(settings, "COORD_DEVICE_URL", "")
    assert coord_device_setting_name() == "COORD_URL"
    assert coord_device_base() == settings.COORD_URL.rstrip("/")


def test_split_is_a_different_coord_not_merely_a_set_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Setting the override to COORD_URL's own value is not a split.

    The split posture carries a real consequence (tokens minted through the
    admin bridge fail this backend's own verifier), so claiming it for a
    redundant-but-identical spelling would be a false alarm — and a boot-time
    warning that cries wolf is the failure mode this whole plan is about.
    """
    assert coord_device_split_active() is False

    monkeypatch.setattr(settings, "COORD_DEVICE_URL", settings.COORD_URL)
    assert coord_device_split_active() is False

    # ...including when only a trailing slash differs.
    monkeypatch.setattr(settings, "COORD_DEVICE_URL", settings.COORD_URL + "/")
    assert coord_device_split_active() is False

    monkeypatch.setattr(settings, "COORD_DEVICE_URL", "https://coord.example.io")
    assert coord_device_split_active() is True
