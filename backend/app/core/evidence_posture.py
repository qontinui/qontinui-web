"""Evidence posture of every device-JWT-admitted write route.

Phase 3 of plan
``2026-09-20-nothing-checks-that-an-agent-writable-evidence-store-ships-its-vocabulary-and-a-correction-verb``.

Why this table exists
---------------------
An agent holds a coord device JWT, not a Cognito token, so the routes it can
write through are exactly the write-method routes whose dependency tree admits
a device JWT. Five times in four weeks one of those stores turned out to take a
durable assertion on the first write and offer no way to correct it, and each
time an agent found out by being burned. The per-store fixes were right and
could not find the next store. This table does: every such route must carry
exactly one row, and ``tests/test_evidence_posture.py`` walks the LIVE
``app.routes`` to fail the build on a route with no row.

The four postures (plan D2)
---------------------------
``Read``
    A write method that mutates nothing durable (a query sent as ``POST`` for
    its body).
``Ephemeral(reason)``
    A write that asserts nothing a later reader relies on — a lease, a
    credential rotation, an access counter. ``reason`` is non-empty.
``Evidence(closed_fields, correction, …)``
    A durable assertion. ``correction`` says how a WRONG write through this
    door is corrected:

    * ``Verb(verb, admits, first)`` — a correct-forward verb exists, and
      ``admits`` names the record states it accepts. Mounting is not
      correction: a verb that refuses every state a wrong write ends up in is
      not one, so a row carrying a ``Verb`` names its ``store`` (a key of
      :data:`STORES`) and the test asserts ``admits`` meets that store's
      TERMINAL states (plan D2 test iii). ``first`` names a verb that must run
      before it, when the correction is two steps.
    * ``SupersedeArg(property, how)`` — corrected by re-posting through the
      SAME door, addressed by ``property``.
    * ``AppendOnlyByDesign(reason)`` — a log whose rows are never rewritten,
      on purpose. ``reason`` is non-empty.
    * ``Gap(tracked_by, what)`` — no correction verb today. ``tracked_by``
      names the plan stem that owns closing it. A gap is a legal, COUNTED
      value: the test pins the count, so a new gap cannot land unnoticed and a
      fixed one must be claimed by lowering the pin.

    A door can make more than one assertion with different correction
    stories — the plan-library upsert's body is a version log, while the
    ``kind`` it files the row under is part of the row's identity. Those
    extra assertions ride in ``aspects``, each with its own correction, and
    each aspect's ``Gap`` counts toward the pin exactly as a row's does.

``closed_fields`` (plan D3) are the request-body properties that accept a
closed set, as dotted JSON paths (``records[].kind``). The test holds them
EQUAL to the enum-bearing properties of the route's body schema, so a closed
field the schema serves cannot be forgotten here, and one declared here must
really be served. A field that IS closed but whose schema serves no enum (the
handler checks it by hand) is declared in ``unserved_closed_fields`` with the
plan stem that owns serving it — pinned by its own ratchet.

Scope limits — what this table does NOT check
----------------------------------------------
* **Writes this backend proxies to coord are out of scope.** A route that
  forwards a device's write to coord (the ``/operations`` proxies) does not
  resolve a device principal HERE, so it is not in the population; its
  posture belongs to coord's own tables (plan Phases 1–2).
* **Closed fields are checked on request-BODY schemas only.** A closed set
  carried in a path or query parameter, or parsed out of a free-text body
  (the plan-library ``**Difficulty:**`` stamp), is not seen by the
  enum-equality test; review of the row is where one is caught (plan D3).
* **The verifier scan reads call SPELLINGS, not bindings.** It resolves a
  direct name, an attribute path and an ``import … as`` alias, but a
  verifier (or a ``verify_token`` receiver) bound through a local assignment
  (``client = coord_jwks_client``) or reached through a getter
  (``get_client().verify_token(...)``) is not recognised.
* **The posture is a judgement.** The tests force a decision per route and
  check its shape; they cannot check that the decision is right.

Population, precisely
---------------------
A route is in the population iff it answers ``POST``/``PUT``/``PATCH``/
``DELETE`` and its dependency tree — walked RECURSIVELY, because
``route.dependant.dependencies`` lists direct dependencies only and a device
dependency behind a wrapper would otherwise be silently omitted — contains one
of :func:`device_jwt_admitting_dependencies`. That set is itself checked: the
test scans ``app/`` for every function that verifies a coord device JWT and
requires each to be in the set or explicitly declared not to be a route
dependency. The table is keyed by ``(METHOD, full path)`` exactly as
``app.routes`` spells it.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final

if TYPE_CHECKING:
    from fastapi.dependencies.models import Dependant
    from starlette.routing import BaseRoute

#: This plan. Owns every gap no other plan owns.
EVIDENCE_POSTURE_PLAN: Final = (
    "2026-09-20-nothing-checks-that-an-agent-writable-evidence-store-ships-"
    "its-vocabulary-and-a-correction-verb"
)
#: Owns the specification family on the plan library — its per-kind
#: ``status`` lifecycles are checked by a model validator, not an enum.
SPEC_FRONT_END_PLAN: Final = "2026-10-09-spec-front-end-of-the-software-factory"
#: Owns plan-library artifact soft-delete (qontinui-web #1545).
JUNK_ROW_PLAN: Final = (
    "2026-09-12-plan-library-has-no-delete-so-a-junk-row-is-permanent"
)
#: Owns the plan-library edge retract/correct verbs (qontinui-web #1459).
EDGE_CORRECTION_PLAN: Final = (
    "2026-09-20-a-recorded-delivery-scope-is-permanent-so-a-mis-declared-"
    "phase-is-uncorrectable"
)

WRITE_METHODS: Final = frozenset({"POST", "PUT", "PATCH", "DELETE"})

_V1: Final = "/api/v1"


# ───────────────────────────── correction arms ─────────────────────────────


@dataclass(frozen=True)
class Verb:
    """A correct-forward verb, ``"METHOD /api/v1/path"`` as ``app.routes``
    spells it, and the record states it accepts."""

    verb: str
    admits: tuple[str, ...]
    #: A verb that must run first, when the correction is two steps.
    first: str | None = None

    def sentence(self) -> str:
        steps = f"{self.first}, then {self.verb}" if self.first else self.verb
        return (
            f"CORRECT A WRONG WRITE WITH: {steps} "
            f"(accepts a record that is {' | '.join(self.admits)})"
        )


@dataclass(frozen=True)
class SupersedeArg:
    """Corrected by re-posting through the same door, addressed by
    ``property``; ``how`` says what the re-post replaces."""

    property: str
    how: str

    def sentence(self) -> str:
        return f"CORRECT A WRONG WRITE by re-posting with {self.property}: {self.how}"


@dataclass(frozen=True)
class AppendOnlyByDesign:
    """A log whose rows are never rewritten, on purpose."""

    reason: str

    def sentence(self) -> str:
        return f"APPEND-ONLY BY DESIGN: {self.reason}"


@dataclass(frozen=True)
class Gap:
    """No correction verb today. ``tracked_by`` is the owning plan stem."""

    tracked_by: str
    what: str

    def sentence(self) -> str:
        return (
            "NO CORRECTION VERB TODAY — a wrong write through this door is "
            f"permanent: {self.what} (tracked: {self.tracked_by})"
        )


Correction = Verb | SupersedeArg | AppendOnlyByDesign | Gap


@dataclass(frozen=True)
class Store:
    """A store's record states, and which of them are TERMINAL — states a
    record rests in with nothing automatic left to move it. A correction verb
    that admits none of them corrects nothing a wrong write ends up as."""

    states: tuple[str, ...]
    terminal: tuple[str, ...]


#: Every store a ``Verb`` row corrects into.
STORES: Final[dict[str, Store]] = {
    # A live record is NOT terminal: consolidation supersedes it and decay
    # tombstones it, automatically. A verb that admitted only ``live`` could
    # not correct a wrong record the lifecycle had already folded away.
    "memory_records": Store(
        states=("live", "superseded", "tombstoned"),
        terminal=("superseded", "tombstoned"),
    ),
    # A toggle: nothing automatic moves either state, so both are terminal.
    # ``never_held`` is the pre-toggle state and is not.
    "memory_lifecycle_hold": Store(
        states=("never_held", "held", "released"),
        terminal=("held", "released"),
    ),
}


# ───────────────────────────── postures ─────────────────────────────


@dataclass(frozen=True)
class Read:
    """A write method that mutates nothing durable."""

    reason: str


@dataclass(frozen=True)
class Ephemeral:
    """A write that asserts nothing a later reader relies on."""

    reason: str


@dataclass(frozen=True)
class Evidence:
    """A durable assertion, and how a wrong one is corrected."""

    closed_fields: tuple[str, ...]
    correction: Correction
    #: Further assertions the same door makes whose correction differs from
    #: ``correction`` — ``(aspect, correction)``.
    aspects: tuple[tuple[str, Correction], ...] = ()
    #: Closed fields whose schema serves NO enum — ``(field, tracked_by)``.
    unserved_closed_fields: tuple[tuple[str, str], ...] = ()
    #: The body model as ``"module:Name"``, for a route that validates its
    #: body by hand and so declares no body parameter FastAPI can see.
    body_model: str | None = None
    #: The :data:`STORES` key a ``Verb`` correction acts on — required when
    #: any correction on the row is a ``Verb``.
    store: str | None = None

    def corrections(self) -> Iterator[tuple[str | None, Correction]]:
        """The row's correction, then each aspect's."""
        yield None, self.correction
        yield from self.aspects


Posture = Read | Ephemeral | Evidence


# ───────────────────────────── the table ─────────────────────────────

_MEMORY_SUPERSEDE = f"POST {_V1}/memory/records/{{memory_id}}/supersede"
_MEMORY_DELETE = f"DELETE {_V1}/memory/records/{{memory_id}}"
_TESTING = f"{_V1}/testing/runs"

#: One row per device-JWT-admitted write route. Classified by reading each
#: handler, not its summary.
ROUTE_POSTURE: Final[dict[tuple[str, str], Posture]] = {
    # ── plan library ────────────────────────────────────────────────────
    ("POST", f"{_V1}/plan-library"): Evidence(
        closed_fields=("captured_by", "kind"),
        # ``status`` is CLOSED for a spec kind only (its per-kind lifecycle,
        # ``WorkArtifactUpsert._spec_kind_rules``) and opaque for every other
        # kind, so the body schema cannot serve it as one enum. The per-kind
        # sets ARE served, on ``GET /plan-library/vocabulary`` as
        # ``status[kind=<kind>]``.
        unserved_closed_fields=(("status", SPEC_FRONT_END_PLAN),),
        correction=AppendOnlyByDesign(
            "the body is a version log — a changed body appends a new version "
            "and never rewrites an old one, so a wrong body is corrected by "
            "re-upserting the right one under the same (kind, slug, "
            "source_repo) and the wrong version stays readable as history"
        ),
        aspects=(
            (
                "kind",
                Gap(
                    tracked_by=JUNK_ROW_PLAN,
                    what=(
                        "an agent-written wrong kind. kind is part of the row "
                        "identity (organization, kind, slug, source_repo), so "
                        "re-upserting under the right kind creates the correct "
                        "row BESIDE an orphaned wrong-kind row that no "
                        "device-reachable verb removes. PATCH /plan-library/"
                        "{id}/kind is operator-only by design (it sets "
                        "kind_locked; module invariant 7) — the correction is "
                        "soft-delete + re-upsert, and the soft-delete is "
                        "qontinui-web #1545"
                    ),
                ),
            ),
        ),
    ),
    ("POST", f"{_V1}/plan-library/{{artifact_id}}/edges"): Evidence(
        closed_fields=("relation",),
        correction=Gap(
            tracked_by=EDGE_CORRECTION_PLAN,
            what=(
                "a recorded provenance edge (e.g. a wrong relation — "
                "'supersedes' where 'spawned_followup' or 'depends_on' was "
                "meant) cannot be retracted or corrected on main; the "
                "PUT/DELETE /plan-library/edges/{edge_id} verbs are "
                "qontinui-web #1459. Read GET /plan-library/vocabulary BEFORE "
                "writing"
            ),
        ),
    ),
    ("PATCH", f"{_V1}/plan-library/edges/{{edge_id}}"): Evidence(
        closed_fields=(),
        correction=Gap(
            tracked_by=EDGE_CORRECTION_PLAN,
            what=(
                "a claim on an open spawned_followup: re-claiming to a "
                "different artifact is a 409 by design (silently re-pointing "
                "would erase the first claim), and no verb retracts a wrong "
                "claim on main; the edge correct/retract verbs are "
                "qontinui-web #1459"
            ),
        ),
    ),
    ("POST", f"{_V1}/plan-library/scan-roots"): Evidence(
        closed_fields=("censuses[].source", "state"),
        correction=SupersedeArg(
            property="observed_at",
            how=(
                "one reading per (organization, device); a later report with "
                "a newer observed_at replaces the stored reading, and an older "
                "one is recorded as received but not applied"
            ),
        ),
        # ``report_scan_root`` validates the raw body itself (it records a
        # refusal before answering 422), so FastAPI sees no body parameter.
        body_model="app.schemas.plan_library_scan_roots:ScanRootReport",
    ),
    # ── session repository ──────────────────────────────────────────────
    ("POST", f"{_V1}/session-repository"): Evidence(
        closed_fields=("body_source", "closeout_state", "state", "tenant_source"),
        correction=SupersedeArg(
            property="claude_session_id + account_label",
            how=(
                "re-posting the same session identity overwrites exactly the "
                "fields supplied (omitted fields are left alone), and a new "
                "body re-archives under a server-computed digest"
            ),
        ),
        aspects=(
            (
                "identity",
                Gap(
                    tracked_by=EVIDENCE_POSTURE_PLAN,
                    what=(
                        "a wrong claude_session_id or account_label. The pair "
                        "IS the row identity, so re-posting under the right "
                        "one files a second row beside an orphan that no "
                        "device-reachable verb removes"
                    ),
                ),
            ),
        ),
    ),
    # ── memory ──────────────────────────────────────────────────────────
    #
    # Two correction paths, and which one applies turns on the CONTENT:
    #
    # * Content changes → ``supersede`` directly. It accepts a record in any
    #   state (``get_record`` filters none; ``mark_superseded`` guards only
    #   the TARGET's liveness), and the request carries its own kind / scope /
    #   anchors / embedding.
    # * Content unchanged (a wrong kind, scope, anchor or embedding on the
    #   right text) → ``supersede`` on a LIVE record answers 409: the insert
    #   dedups on content_hash among LIVE rows and hands back the record's own
    #   id ("replacement content is identical"). DELETE first: the tombstone
    #   is not live, so the same content inserts a new row, and the tombstone
    #   then points at it through ``superseded_by`` — correct-forward with
    #   provenance, where a bare re-POST would mint an unlinked row.
    ("POST", f"{_V1}/memory/records"): Evidence(
        closed_fields=(
            "records[].anchors[].type",
            "records[].kind",
            "records[].links[].relation",
            "records[].scope",
        ),
        store="memory_records",
        correction=Verb(
            verb=_MEMORY_SUPERSEDE, admits=("live", "superseded", "tombstoned")
        ),
        aspects=(
            (
                "unchanged content",
                Verb(
                    verb=_MEMORY_SUPERSEDE, first=_MEMORY_DELETE, admits=("tombstoned",)
                ),
            ),
        ),
    ),
    ("POST", f"{_V1}/memory/records/{{memory_id}}/supersede"): Evidence(
        closed_fields=("anchors[].type", "kind", "scope"),
        store="memory_records",
        # A wrong successor is itself superseded, forward, by the same verb.
        correction=Verb(
            verb=_MEMORY_SUPERSEDE, admits=("live", "superseded", "tombstoned")
        ),
        aspects=(
            (
                "unchanged content",
                Verb(
                    verb=_MEMORY_SUPERSEDE, first=_MEMORY_DELETE, admits=("tombstoned",)
                ),
            ),
        ),
    ),
    ("DELETE", f"{_V1}/memory/records/{{memory_id}}"): Evidence(
        closed_fields=(),
        store="memory_records",
        # A wrongly tombstoned record is corrected forward by superseding it
        # with its own content: not live, so no dedup 409, and the tombstone
        # points at the live successor through ``superseded_by``.
        correction=Verb(verb=_MEMORY_SUPERSEDE, admits=("tombstoned",)),
    ),
    ("PUT", f"{_V1}/memory/records/{{memory_id}}/hold"): Evidence(
        closed_fields=(),
        store="memory_lifecycle_hold",
        correction=Verb(
            verb=f"DELETE {_V1}/memory/records/{{memory_id}}/hold",
            admits=("held",),
        ),
    ),
    ("DELETE", f"{_V1}/memory/records/{{memory_id}}/hold"): Evidence(
        closed_fields=(),
        store="memory_lifecycle_hold",
        correction=Verb(
            verb=f"PUT {_V1}/memory/records/{{memory_id}}/hold",
            admits=("released", "never_held"),
        ),
    ),
    ("POST", f"{_V1}/memory/jobs/{{job_id}}/result"): Evidence(
        closed_fields=(),
        store="memory_records",
        # Success lands ON memory records. A wrong synthesized mental_model
        # row is corrected by superseding it with the right text (content
        # changes); a wrong embedding leaves the content unchanged, so its
        # target takes the two-step path.
        correction=Verb(
            verb=_MEMORY_SUPERSEDE, admits=("live", "superseded", "tombstoned")
        ),
        aspects=(
            (
                "embedding",
                Verb(
                    verb=_MEMORY_SUPERSEDE, first=_MEMORY_DELETE, admits=("tombstoned",)
                ),
            ),
            (
                "failure",
                AppendOnlyByDesign(
                    "a posted failure marks the job 'failed', which is terminal "
                    "— a re-post answers 409 and no verb reopens it. It is not "
                    "rewritten because it does not need to be: a failed job "
                    "sits outside the live-input dedup index (enqueue_jobs), "
                    "so memory_reindex (a still-unembedded row) or the "
                    "lifecycle pass (a still-qualifying cluster) enqueues a "
                    "fresh job for the same input on its next tick"
                ),
            ),
        ),
    ),
    ("POST", f"{_V1}/memory/query"): Ephemeral(
        "a retrieval query sent as POST for its body; its one durable side "
        "effect is bump_access, an access counter on the returned rows that "
        "feeds ranking and asserts nothing a reader relies on as a fact"
    ),
    ("POST", f"{_V1}/memory/graph"): Read(
        "a bounded graph traversal sent as POST for its body; it inserts, "
        "updates and deletes nothing"
    ),
    ("POST", f"{_V1}/memory/jobs/claim"): Ephemeral(
        "claims queue jobs for this worker — a lease the reaper requeues when "
        "it lapses, asserting nothing a later reader relies on"
    ),
    # ── testing (runner → backend reports; ``get_runner_user``) ──────────
    ("POST", _TESTING): Evidence(
        closed_fields=(),
        correction=Gap(
            tracked_by=EVIDENCE_POSTURE_PLAN,
            what=(
                "a mis-created test run: its project, name, description and "
                "workflow/configuration metadata are fixed at creation — PUT "
                "…/complete finalizes status, completed_at, error_summary and "
                "metrics — and no "
                "device-reachable verb deletes or re-describes a run"
            ),
        ),
    ),
    ("POST", f"{_TESTING}/{{run_id}}/transitions"): Evidence(
        closed_fields=(),
        # ``_process_transition`` looks a row up by (test_run_id,
        # sequence_number) and UPDATES it in place — not an append-only log.
        correction=SupersedeArg(
            property="transitions[].sequence_number",
            how=(
                "re-posting a transition with the same sequence_number "
                "overwrites its status, started_at, completed_at, duration, "
                "error_type, error_message, from_state/to_state and metadata "
                "in place. It does NOT rewrite transition_name, the derived "
                "transition_id, action_count or retry_count (set on first "
                "write only). And every post adds its batch size to the run's "
                "total_transitions and its per-outcome counts to "
                "successful/failed_transitions, so a correcting "
                "re-post double-counts them. Nothing resets all three by "
                "itself: PUT …/coverage resets only total_transitions (from "
                "total_transitions_executed); PUT …/complete resets "
                "total/successful/failed only for the keys final_metrics "
                "carries (total_transitions_executed / successful_transitions "
                "/ failed_transitions) — send all three"
            ),
        ),
        unserved_closed_fields=(
            # Plain ``str`` checked by ``field_validator`` lists.
            ("transitions[].error_type", EVIDENCE_POSTURE_PLAN),
            ("transitions[].status", EVIDENCE_POSTURE_PLAN),
        ),
    ),
    ("POST", f"{_TESTING}/{{run_id}}/deficiencies"): Evidence(
        closed_fields=(),
        correction=Gap(
            tracked_by=EVIDENCE_POSTURE_PLAN,
            what=(
                "a reported deficiency (severity, type, title, linked "
                "transition) cannot be changed or withdrawn by a device; "
                "PATCH /testing/deficiencies/{id} is operator-only"
            ),
        ),
        unserved_closed_fields=(
            ("deficiencies[].deficiency_type", EVIDENCE_POSTURE_PLAN),
            ("deficiencies[].severity", EVIDENCE_POSTURE_PLAN),
        ),
    ),
    ("PUT", f"{_TESTING}/{{run_id}}/coverage"): Evidence(
        closed_fields=(),
        correction=SupersedeArg(
            property="run_id",
            how=(
                "a re-PUT replaces the run's coverage metrics and coverage "
                "maps wholesale, and also overwrites total_transitions, "
                "unique_paths_found and unique_states_visited"
            ),
        ),
    ),
    ("PUT", f"{_TESTING}/{{run_id}}/complete"): Evidence(
        closed_fields=(),
        correction=SupersedeArg(
            property="run_id",
            how=(
                "a re-PUT overwrites status and completed_at, and replaces "
                "configuration_snapshot.final_metrics and error_summary "
                "unconditionally; the run's counters and coverage fields "
                "(total/successful/failed transitions, coverage_percentage, "
                "deficiencies_found) are overwritten only for the keys "
                "final_metrics carries, otherwise kept. Nothing refuses a "
                "second completion"
            ),
        ),
        unserved_closed_fields=(("status", EVIDENCE_POSTURE_PLAN),),
    ),
    ("POST", f"{_TESTING}/{{run_id}}/screenshots"): Evidence(
        closed_fields=(),
        correction=Gap(
            tracked_by=EVIDENCE_POSTURE_PLAN,
            what=(
                "an uploaded screenshot and its metadata (the transition and "
                "state it evidences, its type) cannot be deleted or "
                "re-attached by a device"
            ),
        ),
        unserved_closed_fields=(("screenshot_type", EVIDENCE_POSTURE_PLAN),),
        # A multipart route: ``metadata`` arrives as a JSON string Form field
        # and is parsed into this model by hand.
        body_model="app.schemas.testing:ScreenshotMetadata",
    ),
    # ── devices / events / audit ────────────────────────────────────────
    ("POST", f"{_V1}/devices/{{device_id}}/machine-credential/self-mint"): Ephemeral(
        "issues the calling device a fresh dmk_ machine credential; it asserts "
        "no fact about the world, and the next rotation or an operator "
        "revocation replaces it"
    ),
    ("POST", f"{_V1}/events/workflow"): Evidence(
        closed_fields=(),
        correction=AppendOnlyByDesign(
            "device lifecycle telemetry — each row records that the device "
            "reported an event at a time; a later event, not an edit, is how "
            "a run's state moves on"
        ),
        unserved_closed_fields=(
            # A plain ``str`` checked by hand against WorkflowEventType; the
            # schema serves no enum, so the accepted set is learned only from
            # the 400 after a wrong write.
            ("event_type", EVIDENCE_POSTURE_PLAN),
        ),
    ),
    ("POST", f"{_V1}/events/phase-completed"): Evidence(
        closed_fields=("phase",),
        correction=AppendOnlyByDesign(
            "phase-result delivery log — repeated deliveries are recorded as "
            "additional rows by design, and a phase that ran again is a new "
            "result, not an edit of the old one"
        ),
    ),
    ("POST", f"{_V1}/users/me/co-pilot/activity"): Evidence(
        closed_fields=("execution_status",),
        correction=AppendOnlyByDesign(
            "an audit log of UI-Bridge commands the relay handled; rewriting a "
            "row would falsify the audit trail, so a later outcome is a new row"
        ),
    ),
}


# ───────────────────────────── derived views ─────────────────────────────


def gaps() -> list[tuple[tuple[str, str], str | None, Gap]]:
    """Every ``Gap`` in the table — ``(route key, aspect, gap)``."""
    found: list[tuple[tuple[str, str], str | None, Gap]] = []
    for key, posture in ROUTE_POSTURE.items():
        if isinstance(posture, Evidence):
            for aspect, correction in posture.corrections():
                if isinstance(correction, Gap):
                    found.append((key, aspect, correction))
    return found


def unserved_closed_fields() -> list[tuple[tuple[str, str], str, str]]:
    """Every declared closed field whose schema serves no enum."""
    return [
        (key, name, tracked_by)
        for key, posture in ROUTE_POSTURE.items()
        if isinstance(posture, Evidence)
        for name, tracked_by in posture.unserved_closed_fields
    ]


def correction_sentences(posture: Posture) -> list[str]:
    """The agent-facing sentences for one row — what the vocabulary route
    renders beside each plan-library write door."""
    if isinstance(posture, Read):
        return [f"READ: {posture.reason}"]
    if isinstance(posture, Ephemeral):
        return [f"EPHEMERAL: {posture.reason}"]
    return [
        (f"[{aspect}] " if aspect else "") + correction.sentence()
        for aspect, correction in posture.corrections()
    ]


# ───────────────────────────── population ─────────────────────────────


def device_jwt_admitting_dependencies() -> frozenset[Callable[..., Any]]:
    """Every FastAPI dependency that admits a coord device JWT.

    Imported lazily so ``app.core`` does not import the API layer at load.
    Checked for completeness by ``tests/test_evidence_posture.py``, which
    finds every function under ``app/`` that verifies a coord device JWT.
    """
    from app.api import deps
    from app.api.v1.endpoints.memory import get_memory_tenant
    from app.api.v1.endpoints.testing.deps import get_runner_user

    return frozenset(
        {
            deps.get_authenticated_device,
            deps.get_authenticated_device_user,
            deps.get_audit_actor_principal,
            deps.get_audit_actor_user,
            deps.get_audit_actor_user_id,
            deps.get_audit_actor_user_optional,
            deps.get_paired_device,
            deps.get_reporting_device,
            get_memory_tenant,
            get_runner_user,
        }
    )


def _admitting_in_tree(
    dependant: Dependant, admitting: frozenset[Callable[..., Any]]
) -> set[str]:
    """Names of admitting dependencies anywhere in ``dependant``'s tree.

    RECURSIVE on purpose: ``dependant.dependencies`` is direct only, and a
    device dependency one wrapper deep is exactly as admitting.
    """
    found: set[str] = set()
    for sub in dependant.dependencies:
        if sub.call in admitting:
            found.add(getattr(sub.call, "__name__", repr(sub.call)))
        found |= _admitting_in_tree(sub, admitting)
    return found


def device_writable_routes(
    routes: list[BaseRoute],
    admitting: frozenset[Callable[..., Any]] | None = None,
) -> dict[tuple[str, str], frozenset[str]]:
    """The population: ``(METHOD, path)`` → admitting callable names.

    ``admitting`` defaults to :func:`device_jwt_admitting_dependencies`; a
    test passes its own to probe the walk.
    """
    from fastapi.routing import APIRoute

    if admitting is None:
        admitting = device_jwt_admitting_dependencies()
    population: dict[tuple[str, str], frozenset[str]] = {}
    for route in routes:
        if not isinstance(route, APIRoute):
            continue
        methods = (route.methods or set()) & WRITE_METHODS
        if not methods:
            continue
        names = _admitting_in_tree(route.dependant, admitting)
        # The handler ITSELF may be an admitting callable (a route whose
        # endpoint verifies the device JWT in its own body is recognised by
        # adding it to the admitting set) — the tree walk covers only its
        # dependencies.
        if route.dependant.call in admitting:
            names.add(
                getattr(route.dependant.call, "__name__", repr(route.dependant.call))
            )
        if names:
            for method in methods:
                population[(method, route.path)] = frozenset(names)
    return population
