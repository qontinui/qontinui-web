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

The slug census (Phase 1 of
``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``)
=================================================================

``censuses`` is OPTIONAL and defaults to empty, because a runner that sends no
census is the ENTIRE CURRENT FLEET and must keep succeeding. It is accepted
here before anything sends it on purpose: ``extra="forbid"`` turns an unknown
key into a 422 that refuses the WHOLE report, and the runner's report body is
built from its configuration, so such a 422 would silence that device on every
attempt, forever. The web half therefore lands, and deploys, first.

What it carries and why each rule is a 422 rather than a stored value:

* **``digest`` is ``sha256`` over the SORTED, NEWLINE-JOINED stems**
  (:func:`slug_census_digest`) — a cross-repo wire contract, recomputed here.
  A ``slugs`` list that disagrees with its own ``digest`` is a 422: storing a
  set this server cannot vouch for is the same class of defect as storing a
  count nobody measured.
* **``slugs: null`` with a ``digest`` means "unchanged since my last report".**
  The stems are ~100 KB and the report is a per-cycle heartbeat, so the device
  re-sends them only when the digest moves. The stored set is KEPT when the
  digest matches what is stored, and **cleared to UNKNOWN when it does not** —
  see ``app.crud.plan_scan_root``. That asymmetry is the integrity property.
* **Past :data:`SLUG_CENSUS_MAX` stems the census is TRUNCATED, and a truncated
  census is a FLOOR in exactly the sense ``counts_are_floors`` already means on
  this report**: what it names is a lower bound, and an absence from it
  establishes nothing. No second word is minted for this. The fleet already
  landed one honesty vocabulary (``min_behind``, ``min_behind_is_floor``,
  ``counts_are_floors``, ``observation_fresh``); a synonym for an idea that
  already has a name is the defect this plan family exists to stop.
* **A census is ABSENT, never empty, when the enumeration did not run.** An
  idle or failed scan cycle sends no entry for that source. ``count: 0`` is the
  claim that the side really holds no plans — a reading, not a silence — which
  is why ``not_scanning`` (nothing is scanned at all) may carry no census.
* **At most one census per ``source``**, and therefore at most two: two
  listings of the same side leave "which one is stored" to statement order.
* **All three spellings of "no census" are accepted, and are one state**: the
  key omitted, ``[]``, and an explicit ``censuses: null``. The third is the
  runner's stated discipline for this very struct — *"Every optional field
  serializes as an explicit ``null`` rather than being omitted"* — so refusing
  it would 422 the whole report of a conforming device on every idle cycle,
  forever. Coercing a null to a value is otherwise wrong on this route; it is
  right for THIS container because "absent" and "empty" already denote the
  same state here (the field is *"OPTIONAL, and empty by default"*). The
  absent-never-empty rule above is enforced **per ENTRY** — a source whose
  enumeration did not run sends no entry — and is untouched by it.
"""

import hashlib
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Annotated, Literal, Self
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

#: The two sides a stem census can be listed from, as the runner serializes
#: them. ``ref`` is the fetched default branch the plan adapter's WORK-UNIT
#: half reads (``read_ref_dir`` in ``plan_workunit_adapter/ref_scan.rs``);
#: ``work_tree`` is the directory its BODY SYNC half reads (``scan_one_root``
#: in ``plan_workunit_adapter/body_push.rs``) — the half that fills the corpus
#: this census exists to measure. They are deliberately two sources: the halves
#: scan different things, which is why one device holds both answers and
#: nothing else in the fleet holds either.
SlugCensusSource = Literal["ref", "work_tree"]

#: The most stems one census may carry on the wire. The corpus is ~1826 stems
#: today, so this is headroom rather than a trim; a device past it sends the
#: first ``SLUG_CENSUS_MAX`` in sorted order and says ``truncated: true``.
SLUG_CENSUS_MAX = 5000

#: The most censuses one report may carry — one per :data:`SlugCensusSource`.
SLUG_CENSUS_MAX_PER_REPORT = 2

#: A plan stem is a slug, and the bound is **the one a stem actually has to
#: pass**: the plan-library write door caps ``slug`` at 512
#: (``WorkArtifactUpsert.slug`` in ``app.schemas.plan_library``). The stored
#: column itself is ``Text`` — unbounded (``app.models.work_artifact``) — and
#: the 255 this constant used to carry is ``work_unit_slug``'s bound, a
#: DIFFERENT column. A 256-512 character stem is therefore a legal artifact
#: slug, and refusing it here would 422 the whole report of any device whose
#: stem list comes from a directory listing — permanently, since that body is
#: built from its configuration. (Longest stem on ``qontinui-dev-notes``
#: ``origin/main`` measured 2026-09-15: 135 characters.)
_SLUG_MAX = 512

#: ``sha256`` renders as 64 lowercase hex characters.
_SHA256_HEX_RE = re.compile(r"\A[0-9a-f]{64}\Z")

#: One stem, as the device listed it.
SlugCensusStem = Annotated[str, Field(min_length=1, max_length=_SLUG_MAX)]


def slug_census_digest(slugs: Iterable[str]) -> str:
    """The census digest, defined ONCE for both repos.

    ``sha256`` over the stems **sorted and joined with a single ``\\n``**, no
    trailing newline, encoded UTF-8. The sort is by code point — Python's
    default and Rust's ``[String]::sort`` (byte order over UTF-8 is code-point
    order) — so the runner and this server agree byte for byte.

    The digest covers the stems **as sent**: a truncated census digests the
    prefix it transmitted, not the set it enumerated. That is what lets this
    server verify exactly what it stored rather than take the device's word for
    it, which :class:`PlanSlugCensus` does on every census carrying ``slugs``.
    """
    return hashlib.sha256("\n".join(sorted(slugs)).encode("utf-8")).hexdigest()


class PlanSlugCensus(BaseModel):
    """One side's plan-stem listing, as the device that scans enumerated it.

    This is the denominator the plan corpus has never had. Every shipped
    capture surface counts a numerator; none owns a denominator, so the fleet
    has never been able to answer *"of the plans that exist, how many did the
    corpus capture?"* — and the naive answers computed off a single git ref
    have read 76.5% and 101.8% for the same corpus. The set the device
    enumerated, carried per ``source`` and joined by ``source_repo``, is what
    makes the answer a SET DIFFERENCE instead.

    Read the module docstring for the four rules (digest, the withheld-set
    heartbeat, the truncation floor, and absent-never-empty) and why each is a
    422 rather than a coerced value.
    """

    model_config = ConfigDict(extra="forbid")

    #: Which side this listing is of. At most one census per source per report.
    source: SlugCensusSource
    #: What ``default_ref`` pointed at when a ``ref`` census was listed. Null
    #: for a ``work_tree`` census, whose HEAD the report already carries as
    #: ``head_sha``.
    ref_sha: str | None = Field(None, max_length=_SHA_MAX)
    #: How many stems the device ENUMERATED on this side — exact, and not
    #: bounded by :data:`SLUG_CENSUS_MAX`. When ``truncated``, it exceeds
    #: ``len(slugs)``: it is the SET that is a floor, not this number.
    count: StrictInt = Field(..., ge=0, le=_BIGINT_MAX)
    #: ``sha256`` over the sorted, newline-joined ``slugs`` AS SENT — see
    #: :func:`slug_census_digest`. Required even when ``slugs`` is withheld:
    #: it is what a withheld set is re-asserted BY.
    digest: str = Field(..., min_length=64, max_length=64)
    #: The stems. SORTED as stored — :meth:`_census_is_coherent` sorts them, so
    #: the documented order is ENFORCED rather than merely asserted. The digest
    #: is over the sorted form either way, so an unsorted list with a correct
    #: digest is normalized rather than refused. ``null`` is not "no stems" —
    #: it is "unchanged since my last report, and ``digest`` says which set I
    #: mean".
    slugs: list[SlugCensusStem] | None = Field(None, max_length=SLUG_CENSUS_MAX)
    #: ``True`` when the device had more than :data:`SLUG_CENSUS_MAX` stems and
    #: sent the sorted prefix. The set is then a FLOOR in the sense
    #: ``counts_are_floors`` already means: membership proves existence,
    #: absence proves nothing.
    truncated: StrictBool

    @field_validator("digest")
    @classmethod
    def _digest_is_lowercase_sha256(cls, value: str) -> str:
        if not _SHA256_HEX_RE.match(value):
            raise ValueError(
                "digest must be 64 lowercase hex characters (sha256 over the "
                "sorted, newline-joined stems). An unparseable digest cannot "
                "be compared with the stored one, so a withheld set could "
                "neither be kept nor honestly cleared."
            )
        return value

    @model_validator(mode="after")
    def _census_is_coherent(self) -> Self:
        if self.slugs is None:
            # A withheld set is re-asserted by its digest alone; nothing below
            # is decidable without the stems.
            return self
        if len(set(self.slugs)) != len(self.slugs):
            duplicates = sorted({s for s in self.slugs if self.slugs.count(s) > 1})[:5]
            raise ValueError(
                f"a census is a SET of stems; these repeat: "
                f"{', '.join(duplicates)}. A duplicate makes 'count' and the "
                "digest disagree about what was enumerated."
            )
        expected = slug_census_digest(self.slugs)
        if self.digest != expected:
            raise ValueError(
                f"digest {self.digest} does not match the stems sent "
                f"(sha256 over the sorted, newline-joined slugs is {expected}). "
                "The digest is the cross-repo wire contract this server "
                "verifies rather than trusts."
            )
        if self.truncated:
            if self.count <= len(self.slugs):
                raise ValueError(
                    f"a truncated census must have enumerated more stems than "
                    f"it sent; count {self.count} with {len(self.slugs)} slugs "
                    "claims a truncation that did not happen."
                )
        elif self.count != len(self.slugs):
            raise ValueError(
                f"an untruncated census must send every stem it counted: "
                f"count {self.count}, {len(self.slugs)} slugs. Set "
                "'truncated: true' if the set really was cut, so a reader "
                "treats it as a floor rather than as the whole side."
            )
        # Normalize to the order this field documents and the digest is taken
        # over. It was the one invariant this module stated and did not
        # enforce, on a cross-repo contract field: "sorted" by convention alone
        # drifts, and the digest cannot catch the drift because it is computed
        # over ``sorted()`` on both sides.
        self.slugs = sorted(self.slugs)
        return self


#: The census list, with its per-report cap carried on the ANNOTATION rather
#: than on the field. That is what lets ``ScanRootReport.censuses`` be
#: NULLABLE — a constraint on a union is not applicable, and the nullability is
#: required: an explicit ``censuses: null`` is the runner's own wire discipline
#: for this struct.
CensusList = Annotated[
    list[PlanSlugCensus], Field(max_length=SLUG_CENSUS_MAX_PER_REPORT)
]


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
    #: The stem listings this cycle enumerated — at most one per
    #: :data:`SlugCensusSource`. OPTIONAL, and empty by default: a runner that
    #: sends none is the entire current fleet and must keep succeeding. An
    #: enumeration that did not run sends no entry, never a zero.
    #:
    #: **All three spellings of "no census" are accepted and are the same
    #: stored state**: the key omitted, ``[]``, and an explicit ``null``. The
    #: last one is not a convenience — it is the runner's stated wire
    #: discipline for this very struct: *"Every optional field serializes as an
    #: explicit ``null`` rather than being omitted"*
    #: (``ScanRootReport`` in ``plan_workunit_adapter/body_push.rs``, where all
    #: twelve optional fields are ``Option<T>`` with no ``skip_serializing_if``).
    #: A runner half that follows it ships ``Option<Vec<PlanSlugCensus>>`` =
    #: ``None`` on every idle cycle, and refusing that spelling would 422 the
    #: WHOLE report of such a device on every idle cycle, forever — the exact
    #: permanent mute the deploy-ordering gate exists to prevent, in the one
    #: field the gate was built for.
    censuses: CensusList | None = Field(default_factory=list)

    @field_validator("censuses", mode="before")
    @classmethod
    def _absent_census_list_is_empty(cls, value: object) -> object:
        """Map an explicit ``censuses: null`` onto the empty list.

        Coercing ``null`` to a value is normally the wrong move on this route —
        every other rule here is a 422 rather than a defaulted value, because a
        count nobody measured must not be invented. It is right **here
        specifically**, and only because of what this container is: "no census"
        and "empty census list" are the SAME state by the module docstring's
        own rule (the field is *"OPTIONAL, and empty by default"*), so nothing
        is being invented — the two spellings already denote one state.

        The absent-never-empty rule the module enforces is a rule about an
        ENTRY, not about this container: a SOURCE whose enumeration did not run
        sends no entry for that source, and ``census_fields`` stores that as
        NULL/UNKNOWN. That per-entry rule is untouched here, and a
        ``not_scanning`` report still may carry no entry at all.
        """
        return [] if value is None else value

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
        # ``censuses`` is normalized to a list by ``_absent_census_list_is_empty``
        # above; the ``or []`` is what says so to a type checker.
        censuses = self.censuses or []
        sources = [census.source for census in censuses]
        repeated = sorted({s for s in sources if sources.count(s) > 1})
        if repeated:
            raise ValueError(
                f"at most one census per source; these repeat: "
                f"{', '.join(repeated)}. Two listings of one side leave which "
                "is stored to statement order."
            )
        if self.state == "not_scanning" and censuses:
            raise ValueError(
                "state 'not_scanning' carries no census: nothing was "
                f"enumerated, so {', '.join(sources)} would be a count nobody "
                "took. An enumeration that did not run is ABSENT, never zero."
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
#: COMPARABLE reading (fresh, applied, carrying a count) and the fewest commits
#: behind is not a floor of 0; otherwise ``unknown``.
ScanRootRollupState = Literal["measured", "unknown"]


class ScanRootSourceRollup(BaseModel):
    """Every device feeding ONE scan source, folded to the corpus's question.

    Any feeder can add a plan to the corpus, so how far behind the corpus is
    is bounded by its LEAST-behind current feeder. ``min_behind`` is NOT a
    ceiling on what the corpus lacks: it bounds the least-behind COMPARABLE
    feeder's distance from BELOW ("at least 41" may really be 300), and only
    an exact value bounds the corpus — and then only as of that ref. Every
    claim here is taken over the COMPARISON SET: readings that are fresh,
    applied (not contradicted by a later, declined report) and carry a count
    — a ``measured`` verdict, or a 0-behind floor the verdict marks
    ``ref_stale``. A silent or contradicted device's old number stays out, and
    a device in ``unmeasured_device_ids`` may be less behind than anything
    stated.

    The roll-up names EVERY feeder, because a lagging device is not harmless
    just because a current one exists: it can write an older body over a newer
    head. The four id lists PARTITION the devices, and a device is placed as
    least-behind or lagging only when the readings ORDER it: all comparable
    devices on one ``ref_sha`` that is either fresh or, if stale, with every
    device reporting ``ahead == 0``. Counts against different refs do not order
    devices (exactly 3 behind a five-hour-old ref can be 13 behind the ref
    another device is exactly 5 behind). On a fresh ref the order holds AS OF
    that ref: a lagging device carrying commits of its own may already hold
    some merged since, within the runner's window. On an active repository
    devices fetch at different moments, so placement is often empty: an empty
    ``lagging_device_ids`` means NOT ESTABLISHED, never "none lagging".
    """

    #: The artifact upsert's ``source_repo`` form, as the devices reported it.
    #: ``null`` groups the readings that named none.
    source_repo: str | None
    #: ``unknown`` when no device here has a comparable reading, or when the
    #: fewest commits behind is a FLOOR of 0 — "at least 0 behind" establishes
    #: no distance, and must never read as "measured, 0 behind".
    state: ScanRootRollupState
    #: A ``no_comparable_reading:``, ``ref_stale:`` (a zero floor on one shared
    #: ref that is stale or of unknown age) or ``refs_not_shared:`` (a zero
    #: floor across different or unidentified refs) line when ``unknown``;
    #: null when ``measured``.
    detail: str | None
    #: Every device whose stored reading names this ``source_repo``.
    device_count: int
    #: How many of them have a COMPARABLE reading (see the class docstring).
    comparable_count: int
    #: The fewest commits behind among the comparable readings, each against
    #: its own device's ref — a LOWER BOUND on how far behind the least-behind
    #: COMPARABLE device is (a device in ``unmeasured_device_ids`` may be less
    #: behind). ``null`` when ``unknown`` — NOT 0: nothing established a
    #: distance (including a floor of 0, which establishes none).
    min_behind: int | None
    #: ``False`` only when every comparable device counted against the SAME
    #: ``ref_sha`` and at least one of them had fetched it within the runner's
    #: freshness window at the time of its reading — exact against a ref fetched
    #: within six hours of that reading (so up to ~6 h 45 min old now), the
    #: runner's definition of an exact count, and NOT against the live tip,
    #: which this server never knows. Otherwise ``True``: "at least N".
    #: ``null`` exactly when ``min_behind`` is.
    min_behind_is_floor: bool | None
    #: Comparable devices at the fewest commits behind, when the readings ORDER
    #: the comparable devices (one shared ``ref_sha`` that is fresh, or stale
    #: with every device at ``ahead == 0``). Empty otherwise. On a fresh ref the
    #: order holds as of that ref (see the class docstring). Kept when the
    #: roll-up is ``unknown`` for a floor of 0: the order is still established.
    least_behind_device_ids: list[UUID]
    #: Comparable devices above the fewest commits behind among the comparable
    #: readings, under the same ordering condition (and likewise kept when the
    #: roll-up is ``unknown`` for a floor of 0). Empty when unordered — NOT
    #: ESTABLISHED, never "none lagging".
    lagging_device_ids: list[UUID]
    #: Comparable devices the readings do not order: EVERY one of them when
    #: they counted against different or unidentified refs, or against one stale ref
    #: while some device reports anything but ``ahead == 0`` (commits of its
    #: own, or no ``ahead`` at all). Empty when ordered.
    lag_unknown_device_ids: list[UUID]
    #: Devices with no comparable reading: silent, contradicted, not scanning,
    #: not a git work tree, or unknown — plus a ``measured`` row carrying no
    #: ``behind``, which the write door refuses, so a stored one is corrupt. (A
    #: row with a ``behind`` but no ``ahead``, refused alike, stays comparable,
    #: and on a stale shared ref leaves EVERY comparable device unordered — see
    #: ``lag_unknown_device_ids``.)
    unmeasured_device_ids: list[UUID]


class ScanRootListResponse(BaseModel):
    """Every device's latest reading for the caller's organization.

    Served by ``GET /plan-library/scan-roots`` and, through the same builder,
    as ``corpus_health.scan_roots`` on every plan-library list page and on
    ``/candidates`` — where a failed read degrades to ``read_failed`` instead
    of an error.
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
