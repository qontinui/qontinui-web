"""Fleet-fresh P5 schemas — app config + test-host designation.

The read/write shapes behind the fleet UI:

* app config editor (update strategy + build/start commands),
* per-(device, app) freshness badges,
* designate-test-host + auto_fresh toggle (``coord.test_targets`` writes).
"""

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime


class UpdateStrategyEnum(StrEnum):
    """How the runner keeps a designated host's build of an app current."""

    PULL_ONLY = "pull_only"  # keep source at upstream HEAD; no rebuild
    PULL_BUILD = "pull_build"  # pull, run build_command, restart via start_command


class AppConfig(BaseModel):
    """Registered app + its fleet-fresh config (``project.apps``)."""

    model_config = ConfigDict(from_attributes=True)

    app_id: str
    display_name: str
    repo_root: str
    update_strategy: UpdateStrategyEnum
    build_command: str | None = None
    start_command: str | None = None


class AppConfigUpdate(BaseModel):
    """Partial update of an app's fleet-fresh config.

    Only the fields the operator edits from the fleet UI. ``None`` leaves a
    field unchanged (build/start commands can be cleared by sending an empty
    string).
    """

    update_strategy: UpdateStrategyEnum | None = None
    build_command: str | None = None
    start_command: str | None = None


class TestTargetDesignation(BaseModel):
    """Body for designating a device as a test host for an app."""

    auto_fresh: bool = Field(
        False,
        description="When true, the runner keeps this device's build of the "
        "app current (auto-pull + optional rebuild).",
    )


class TestTargetRow(BaseModel):
    """A designated (device, app) test host, joined with device + freshness."""

    device_id: UUID
    app_id: str
    auto_fresh: bool
    device_name: str
    hostname: str
    derived_status: str
    # Freshness of the deployed build on this device for this app, sourced
    # from ``project.app_deploy_state`` (written by the runner's auto-fresh
    # engine). ``None`` when the device has never published deploy state.
    freshness: str | None = None
    deployed_sha: str | None = None
    deployed_at: IsoDatetime | None = None
    created_at: IsoDatetime
    updated_at: IsoDatetime


class FreshnessRow(BaseModel):
    """Per-(device, app) deployment freshness (``project.app_deploy_state``)."""

    device_id: UUID
    app_id: str
    device_name: str
    hostname: str
    freshness: str
    deployed_sha: str | None = None
    deployed_at: IsoDatetime
    # Error message from the runner's auto-fresh engine when
    # ``freshness == 'failed'`` — surfaced as a tooltip in the fleet UI.
    last_error: str | None = None
    updated_at: IsoDatetime
