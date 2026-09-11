"""Schemas for ``/api/v1/plan-library/scan-roots`` — per-device scan-source readings.

Revised Phase 2 of ``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.

The request is the runner's ``ScanDivergence``
(``qontinui-runner/src-tauri/src/plan_workunit_adapter/trigger.rs``) plus
``ref_age_secs``, ``counts_are_floors``, ``source_repo`` and ``observed_at``.
Field names are the wire contract the runner's ``report_scan_root`` POST sends —
do not rename them.

Validation rules, and why each is a 422 rather than a stored value:

* **``extra="forbid"``**, as on every plan-library request model: an unknown
  key is a 422 naming it. That is also what refuses a body-supplied
  ``device_id`` or ``organization_id`` — the device is the verified token's
  claim and the organization is the principal's, so the body has nowhere to
  put either.
* **``state`` is the four-value vocabulary**, mirrored by a Postgres CHECK.
* **Counts are non-negative and fit BIGINT**, also mirrored by a CHECK.
* **A ``measured`` reading must carry both counts, and no other state may.**
  A ``measured`` row without ``behind`` would render as "0 behind" to any
  reader that defaults a missing number, which is the false zero the whole plan
  exists to remove; a count on an unmeasured state is a number nobody measured.
* **``unknown`` and ``not_a_git_work_tree`` must say why** (non-empty
  ``detail``). The runner's own type guarantees it ("an unexplained UNKNOWN is
  the same dead end as the silence this type replaces"), so a report without
  one is malformed rather than merely terse.
* **``observed_at`` must carry a timezone**: a naive timestamp's age cannot be
  computed without guessing the runner's zone.
"""

from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.schemas.base import IsoDatetime

#: The runner's ``ScanDivergenceState``, as it serializes.
ScanRootState = Literal["measured", "not_scanning", "not_a_git_work_tree", "unknown"]

#: PostgreSQL BIGINT ceiling — the columns' range. The runner sends ``u64``.
_BIGINT_MAX = 2**63 - 1

#: Git object ids are 40 (SHA-1) or 64 (SHA-256) hex characters.
_SHA_MAX = 64


class ScanRootReport(BaseModel):
    """One device's reading of the directory its plan-library body sync scans."""

    model_config = ConfigDict(extra="forbid")

    state: ScanRootState
    #: The directory actually scanned, as configured.
    plans_dir: str | None = Field(None, max_length=4096)
    #: The git work-tree root containing ``plans_dir``.
    repo_root: str | None = Field(None, max_length=4096)
    #: The scan root in the artifact upsert's ``source_repo`` form
    #: (``<repo>/<dir relative to the repo root>``), so a reading can be joined
    #: to the artifacts that device writes.
    source_repo: str | None = Field(None, max_length=255)
    #: The repo's own default branch as a remote-tracking ref (``origin/main``).
    default_ref: str | None = Field(None, max_length=255)
    #: What ``default_ref`` pointed at, as of the clone's last fetch.
    ref_sha: str | None = Field(None, max_length=_SHA_MAX)
    #: What the scanned work tree's ``HEAD`` pointed at.
    head_sha: str | None = Field(None, max_length=_SHA_MAX)
    #: Commits on ``default_ref`` the scanned HEAD lacks.
    behind: int | None = Field(None, ge=0, le=_BIGINT_MAX)
    #: Commits on the scanned HEAD that ``default_ref`` lacks.
    ahead: int | None = Field(None, ge=0, le=_BIGINT_MAX)
    #: Seconds since ``default_ref`` was last known refreshed; null = unknown.
    ref_age_secs: int | None = Field(None, ge=0, le=_BIGINT_MAX)
    #: ``True`` when the ref was stale or of unknown age, so the counts are
    #: LOWER BOUNDS — a floor of 0 must never be read as "in step".
    counts_are_floors: bool
    #: One line naming why the state is what it is.
    detail: str | None = Field(None, max_length=4096)
    #: When the runner took the reading (RFC 3339, with an offset).
    observed_at: AwareDatetime

    @model_validator(mode="after")
    def _state_is_coherent(self) -> Self:
        if self.state == "measured":
            missing = [
                name
                for name, value in (("behind", self.behind), ("ahead", self.ahead))
                if value is None
            ]
            if missing:
                raise ValueError(
                    f"a 'measured' reading must carry both counts; missing: "
                    f"{', '.join(missing)}. A measured state with no count "
                    "would read as 0 behind, which is a claim nobody made."
                )
        else:
            present = [
                name
                for name, value in (("behind", self.behind), ("ahead", self.ahead))
                if value is not None
            ]
            if present:
                raise ValueError(
                    f"only a 'measured' reading carries counts; state "
                    f"'{self.state}' sent: {', '.join(present)}."
                )
        if self.state in ("unknown", "not_a_git_work_tree") and not (
            self.detail and self.detail.strip()
        ):
            raise ValueError(
                f"state '{self.state}' must carry a non-empty 'detail' naming "
                "why — an unexplained unknown is a dead end for the reader."
            )
        return self


class ScanRootRow(BaseModel):
    """One device's stored reading, plus how the read route judges its age."""

    #: The verified device token's ``device_id`` claim — never a body field.
    device_id: UUID
    state: ScanRootState
    plans_dir: str | None
    repo_root: str | None
    source_repo: str | None
    default_ref: str | None
    ref_sha: str | None
    head_sha: str | None
    behind: int | None
    ahead: int | None
    ref_age_secs: int | None
    counts_are_floors: bool
    detail: str | None
    #: The runner's clock.
    observed_at: IsoDatetime
    #: This server's clock, at the latest report.
    received_at: IsoDatetime
    #: Seconds from the OLDER of ``observed_at`` / ``received_at`` to now, never
    #: negative. The older one, so neither a runner clock running ahead nor a
    #: re-posted old reading can make a reading look fresher than it is.
    observation_age_secs: int
    #: ``observation_age_secs <= fresh_within_secs``.
    observation_fresh: bool
    #: ``state`` when the reading is fresh; ``"unknown"`` when it is not — a
    #: device that stopped reporting has not established anything about now.
    effective_state: ScanRootState
    #: ``detail`` when fresh; an ``observation_stale: ...`` line when not.
    effective_detail: str | None


class ScanRootListResponse(BaseModel):
    """Every device's latest reading for the caller's organization."""

    #: ``"reported"`` when at least one device has a row; ``"unknown"`` when
    #: none has — an empty list is NOT "every feeder is current".
    state: Literal["reported", "unknown"]
    #: Why the state is ``unknown``; null when ``reported``.
    detail: str | None
    #: The freshness window, in seconds (three 15-min runner heartbeats).
    fresh_within_secs: int
    #: ``len(rows)``.
    count: int
    #: How many rows are within the freshness window. ``count > 0`` with
    #: ``fresh_count == 0`` means every feeder has gone quiet.
    fresh_count: int
    rows: list[ScanRootRow]


class ScanRootReportResponse(BaseModel):
    """The stored row after a report."""

    #: ``True`` on this device's first report for the organization.
    created: bool
    row: ScanRootRow
