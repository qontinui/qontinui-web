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
* **Counts are STRICT non-negative integers that fit BIGINT** (also mirrored
  by a CHECK), and ``counts_are_floors`` is a strict boolean: ``true`` or
  ``"12"`` for a count, or ``"false"`` / ``1`` for the flag, is a 422 rather
  than a coerced value — a runner serializing the wrong type is a bug to see,
  not to paper over.
* **A ``measured`` reading must carry both counts, and no other state may.**
  A ``measured`` row without ``behind`` would render as "0 behind" to any
  reader that defaults a missing number, which is the false zero the whole plan
  exists to remove; a count on an unmeasured state is a number nobody measured.
* **The floor rule is enforced where it is decidable here.** A ``measured``
  reading whose ref age is unknown (``ref_age_secs: null``) MUST report
  ``counts_are_floors: true`` — counts against a ref of unknown age are lower
  bounds, and a reader must never take a floor of 0/0 as "in step". An
  unmeasured state carries no ref age and no floors (``ref_age_secs: null``,
  ``counts_are_floors: false``). The 6-hour freshness threshold itself is the
  runner's (``SCAN_REF_FRESH_WITHIN``) and is deliberately not re-judged here.
* **``unknown`` and ``not_a_git_work_tree`` must say why** (non-empty
  ``detail``). The runner's own type guarantees it ("an unexplained UNKNOWN is
  the same dead end as the silence this type replaces"), so a report without
  one is malformed rather than merely terse.
* **``observed_at`` must carry a timezone**: a naive timestamp cannot be
  ordered against another without guessing the runner's zone.
* **``observed_at`` may not be more than** :data:`MAX_FUTURE_SKEW_SECS` **ahead
  of this server's clock.** ``observed_at`` is the upsert's ordering key (an
  older reading never replaces a newer one), so one far-future report would
  otherwise outrank every honest report after it and freeze the row. The
  bound is the runner's clock skew we tolerate; past it the runner's clock is
  wrong and the report says so in a 422 rather than being stored.

Clocks: this server's clock is the only one trusted for LIVENESS. Freshness is
judged from ``received_at`` alone; ``observed_at`` only orders readings and is
shown beside ``observed_skew_secs`` so a skewed runner clock is visible.
"""

from datetime import UTC, datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
    model_validator,
)

from app.schemas.base import IsoDatetime

#: The runner's ``ScanDivergenceState``, as it serializes.
ScanRootState = Literal["measured", "not_scanning", "not_a_git_work_tree", "unknown"]

#: PostgreSQL BIGINT ceiling — the columns' range. The runner sends ``u64``.
_BIGINT_MAX = 2**63 - 1

#: Git object ids are 40 (SHA-1) or 64 (SHA-256) hex characters.
_SHA_MAX = 64

#: How far ahead of this server's clock ``observed_at`` may be. Five minutes
#: absorbs ordinary NTP drift; anything more is a broken runner clock, and
#: storing it would let that reading outrank every honest report after it.
MAX_FUTURE_SKEW_SECS = 300


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
    behind: StrictInt | None = Field(None, ge=0, le=_BIGINT_MAX)
    #: Commits on the scanned HEAD that ``default_ref`` lacks.
    ahead: StrictInt | None = Field(None, ge=0, le=_BIGINT_MAX)
    #: Seconds since ``default_ref`` was last known refreshed; null = unknown.
    ref_age_secs: StrictInt | None = Field(None, ge=0, le=_BIGINT_MAX)
    #: ``True`` when the ref was stale or of unknown age, so the counts are
    #: LOWER BOUNDS — a floor of 0 must never be read as "in step".
    counts_are_floors: StrictBool
    #: One line naming why the state is what it is.
    detail: str | None = Field(None, max_length=4096)
    #: When the runner took the reading (RFC 3339, with an offset). The
    #: ordering key between reports; never used to judge liveness.
    observed_at: AwareDatetime

    @field_validator("observed_at")
    @classmethod
    def _not_from_the_future(cls, value: datetime) -> datetime:
        ahead = (value - datetime.now(UTC)).total_seconds()
        if ahead > MAX_FUTURE_SKEW_SECS:
            raise ValueError(
                f"observed_at is {int(ahead)} s ahead of this server's clock "
                f"(the limit is {MAX_FUTURE_SKEW_SECS} s). The reporting "
                "runner's clock is skewed; fix its time sync. A future-dated "
                "reading is refused because it would outrank every honest "
                "report after it."
            )
        return value

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
            if self.ref_age_secs is not None or self.counts_are_floors:
                raise ValueError(
                    f"only a 'measured' reading carries a ref age or floors; "
                    f"state '{self.state}' must send ref_age_secs: null and "
                    "counts_are_floors: false."
                )
        if (
            self.state == "measured"
            and self.ref_age_secs is None
            and not self.counts_are_floors
        ):
            raise ValueError(
                "a 'measured' reading with ref_age_secs: null must report "
                "counts_are_floors: true — counts against a ref of unknown age "
                "are lower bounds, and 0/0 would otherwise read as 'in step'."
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
    """One device's stored reading, with the read route's VERDICT on top.

    ``state`` / ``detail`` are the verdict a reader should key on, not the
    stored values. ``state`` is ``unknown`` with:

    * an ``observation_stale:`` detail once the device has not reported within
      ``fresh_within_secs`` (by ``received_at``);
    * a ``reading_superseded:`` detail when the device's latest report was
      observed before the stored reading (a clock step-back or a
      late-delivered report), so the stored reading may not be what it reports
      now (``last_report_applied: false``);
    * a ``ref_stale:`` detail for a ``measured`` floor reading that is 0
      behind.

    Precedence: ``observation_stale`` > ``reading_superseded`` > ``ref_stale``.
    What the device actually sent is in ``reported_state`` /
    ``reported_detail``. The counts and ``ref_age_secs`` are served as reported
    whatever the verdict — a reader keying on ``state`` does not trust them
    when it is ``unknown``.
    """

    #: The verified device token's ``device_id`` claim — never a body field.
    device_id: UUID
    #: The VERDICT: ``reported_state`` when the device is fresh, its latest
    #: report was applied, and the reading is not a 0-behind floor; otherwise
    #: ``"unknown"``.
    state: ScanRootState
    #: Why ``state`` is what it is: ``reported_detail`` when the verdict is the
    #: reported state, otherwise an ``observation_stale: ...``,
    #: ``reading_superseded: ...`` or ``ref_stale: ...`` line (in that order of
    #: precedence).
    detail: str | None
    #: The state the device reported, verbatim.
    reported_state: ScanRootState
    #: The detail the device reported, verbatim.
    reported_detail: str | None
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
    #: The runner's clock, when it took the stored reading. Orders readings;
    #: never used to judge liveness.
    observed_at: IsoDatetime
    #: This server's clock, at the device's latest report — including a report
    #: that was declined as out of order, since the device demonstrably
    #: reported. The ONLY stamp liveness is judged from.
    received_at: IsoDatetime
    #: Whether the device's latest report was applied. ``False``: its latest
    #: report was observed before the stored reading, so the stored reading may
    #: not be what it says now and ``state`` is ``unknown`` /
    #: ``reading_superseded``.
    last_report_applied: bool
    #: The ``observed_at`` of the device's latest report, applied or not.
    last_report_observed_at: IsoDatetime
    #: ``received_at - observed_at`` in seconds. Near zero for a healthy
    #: runner. Large and positive: the runner's clock is behind this server's,
    #: or the stored reading is older than the device's last contact (a newer
    #: report was delivered before an older one). Negative: the runner's clock
    #: is ahead (bounded by the write-side limit of 300 s).
    observed_skew_secs: int
    #: Seconds since this server last heard from the device
    #: (``now - received_at``), never negative.
    observation_age_secs: int
    #: ``observation_age_secs <= fresh_within_secs``.
    observation_fresh: bool


#: A roll-up's verdict: ``measured`` when at least one of its devices has a
#: ``measured`` VERDICT, otherwise ``unknown``.
ScanRootRollupState = Literal["measured", "unknown"]


class ScanRootSourceRollup(BaseModel):
    """Every device feeding ONE scan source, folded to the corpus's question.

    Any feeder can add a plan to the corpus, so how far behind the corpus is
    is bounded by its LEAST-behind current feeder: ``min_behind``. It is drawn
    only from rows whose ``state`` VERDICT is ``measured`` — a device that went
    quiet, was contradicted, or reported a 0-behind floor contributes no
    number, so a stale feeder's old low reading cannot understate the gap.

    The roll-up still names EVERY feeder, because a lagging device is not
    harmless just because a current one exists: it can write an older body
    over a newer head. ``lagging_device_ids`` are the measured devices
    reporting more commits behind than ``min_behind``; ``unmeasured_device_ids``
    are the rest, whose rows say why.
    """

    #: The artifact upsert's ``source_repo`` form, as the devices reported it.
    #: ``null`` groups the readings that named none.
    source_repo: str | None
    #: ``unknown`` when no device here has a ``measured`` verdict.
    state: ScanRootRollupState
    #: A ``no_measured_reading:`` line when ``unknown``; null when ``measured``.
    detail: str | None
    #: Every device whose stored reading names this ``source_repo``.
    device_count: int
    #: How many of them have a ``measured`` verdict.
    measured_count: int
    #: The fewest commits behind among the ``measured`` verdicts. ``null`` when
    #: ``unknown`` — NOT 0: no current feeder established any distance.
    min_behind: int | None
    #: ``True`` when every device reporting ``min_behind`` counted against a
    #: stale or unaged ref, so the minimum is itself a LOWER BOUND ("at least
    #: N"). ``null`` exactly when ``min_behind`` is.
    min_behind_is_floor: bool | None
    #: The ``measured`` devices reporting exactly ``min_behind``.
    least_behind_device_ids: list[UUID]
    #: The ``measured`` devices reporting more than ``min_behind`` (for a floor
    #: row: at least that many).
    lagging_device_ids: list[UUID]
    #: Devices whose verdict is anything but ``measured``.
    unmeasured_device_ids: list[UUID]


class ScanRootListResponse(BaseModel):
    """Every device's latest reading for the caller's organization.

    Served by ``GET /plan-library/scan-roots`` and, identically, as
    ``corpus_health.scan_roots`` on every plan-library list page and on
    ``/candidates`` — one builder renders all three.
    """

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
    #: One roll-up per distinct ``source_repo`` over ``rows`` — named sources
    #: in order, then the ``null`` group. Empty exactly when ``rows`` is, and
    #: then ``state`` is ``unknown``: an empty roll-up is not "no drift".
    by_source_repo: list[ScanRootSourceRollup]


class ScanRootReportResponse(BaseModel):
    """The stored row after a report."""

    #: ``True`` on this device's first report for the organization.
    created: bool
    #: ``False`` when the report was observed EARLIER than the stored reading
    #: (a late delivery, or a runner clock that stepped back). Its reading was
    #: not stored, but the report still refreshed ``received_at`` (the device
    #: demonstrably reported) and marked the row ``last_report_applied: false``,
    #: so ``row`` reads ``state: "unknown"`` / ``reading_superseded`` until a
    #: newer report applies.
    applied: bool
    row: ScanRootRow
