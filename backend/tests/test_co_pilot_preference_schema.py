"""Schema-level regression for the §4.5 UI Bridge co-pilot preference.

The preference rides inside ``users.preferences`` JSONB so the field is
durable across sessions and devices (per §4.5). These tests pin three
properties:

1. ``UserPreferences`` defaults ``ui_bridge_co_pilot_enabled`` to ``False``.
   Default-OFF is the consent posture the design demands — the relay
   listener must never mount without an explicit user grant.

2. ``UserPreferencesUpdate`` accepts the field, including ``False`` (the
   user revoking the preference from the banner's "Disable for this
   account" link must round-trip; an `exclude_unset` dump of an update
   that omits the field MUST NOT silently regress an already-true row).

3. The merge step the endpoint performs — ``{**existing, **update}`` —
   actually flips a previously-true preference back to ``False`` when
   the request body sets it to ``False``. This is the path the Stop /
   "Disable for this account" affordance walks; if the merge code
   mistakenly used ``exclude_none`` instead of ``exclude_unset``, the
   user could never turn the preference off again, defeating the
   reversibility safety rail.
"""

from __future__ import annotations

from app.schemas.user import UserPreferences, UserPreferencesUpdate


def test_default_co_pilot_preference_is_false() -> None:
    prefs = UserPreferences()
    assert prefs.ui_bridge_co_pilot_enabled is False


def test_can_round_trip_enabled_true() -> None:
    prefs = UserPreferences(ui_bridge_co_pilot_enabled=True)
    assert prefs.ui_bridge_co_pilot_enabled is True
    # also from raw dict (the row's JSONB shape)
    prefs2 = UserPreferences(**{"ui_bridge_co_pilot_enabled": True})
    assert prefs2.ui_bridge_co_pilot_enabled is True


def test_update_with_only_co_pilot_field_excludes_unset() -> None:
    update = UserPreferencesUpdate(ui_bridge_co_pilot_enabled=True)
    dumped = update.model_dump(exclude_unset=True)
    assert dumped == {"ui_bridge_co_pilot_enabled": True}


def test_update_omitting_co_pilot_field_does_not_emit_it() -> None:
    update = UserPreferencesUpdate()
    dumped = update.model_dump(exclude_unset=True)
    # MUST be empty so the merge below does not regress an already-true row
    assert "ui_bridge_co_pilot_enabled" not in dumped


def test_endpoint_style_merge_can_flip_true_to_false() -> None:
    """Simulate the endpoint's `{**existing, **update_data}` merge.

    Stop-button path: user previously opted in, then clicks "Disable for
    this account". Body is ``{ui_bridge_co_pilot_enabled: false}``. The
    merged preferences row MUST surface that.
    """
    existing: dict = {
        "product_mode": "ai",
        "ui_bridge_co_pilot_enabled": True,
    }
    update = UserPreferencesUpdate(ui_bridge_co_pilot_enabled=False)
    update_data = update.model_dump(exclude_unset=True)
    merged = {**existing, **update_data}
    assert merged["ui_bridge_co_pilot_enabled"] is False
    # product_mode untouched
    assert merged["product_mode"] == "ai"


def test_endpoint_style_merge_can_flip_false_to_true() -> None:
    """Opt-in path: previously default (no key), now explicitly true."""
    existing: dict = {}
    update = UserPreferencesUpdate(ui_bridge_co_pilot_enabled=True)
    update_data = update.model_dump(exclude_unset=True)
    merged = {**existing, **update_data}
    assert merged["ui_bridge_co_pilot_enabled"] is True


def test_unset_update_does_not_regress_existing_true() -> None:
    """A PUT that only changes ``product_mode`` MUST NOT silently zero out
    the co-pilot opt-in. Critical because the same endpoint serves every
    preference write — a stale dropdown PUT'ing only ``product_mode`` would
    otherwise revoke consent.
    """
    existing: dict = {"ui_bridge_co_pilot_enabled": True}
    update = UserPreferencesUpdate(product_mode="visual")
    update_data = update.model_dump(exclude_unset=True)
    merged = {**existing, **update_data}
    assert merged["ui_bridge_co_pilot_enabled"] is True
    assert merged["product_mode"] == "visual"


def test_user_preferences_from_jsonb_with_only_co_pilot_key() -> None:
    """Reading a row that was stored with only the co-pilot key set still
    materializes ``product_mode=None`` (its declared default).
    """
    prefs = UserPreferences(**{"ui_bridge_co_pilot_enabled": True})
    assert prefs.product_mode is None
    assert prefs.ui_bridge_co_pilot_enabled is True
