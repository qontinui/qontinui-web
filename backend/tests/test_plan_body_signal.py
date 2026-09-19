"""The two body signals: the corpus-independent screen, and the tri-state.

Plan ``2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans``,
Phases 1, 2 and 5a. Unit-level; the wire shape these produce is asserted in
``test_operations_plans_proxy.py``.

What these tests deliberately do NOT assert
===========================================

The screen's measured quality — **recall 90.4%, precision 27.6%**, on 1366
dated work units, on ONE device, on 2026-09-02 — is recorded below as a dated
observation and nowhere asserted. Recall is a property of one corpus on one
day; pinning it as an invariant would red the build the next time somebody
authors a batch of plans, which is a corpus change and not a regression in
this code. What IS asserted is the MECHANISM: absent ``source_path`` ⇒
``never_scanned``, a machine-local one ⇒ ``scanned_locally``, a canonical one
⇒ ``scanned``.

The same discipline applies to the verdict. Each ``unknown`` arm is asserted
by construction — build the state, read the reason — never by counting how
many rows on some real page came back unknown.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.services.plan_body_signal import (
    PLAN_ARTIFACT_KIND,
    UNKNOWN,
    BodyKnowledge,
    CaptureDial,
    derive_body_provenance,
    resolve_body_knowledge,
)

# ---------------------------------------------------------------------------
# Dated observation, 2026-09-02, device `merytshost` (a ONE-device fleet, so
# there is no second census to tighten this with). Coord's work-unit list,
# paged to exhaustion, against the union of `qontinui-dev-notes` origin/main
# and every `*/plans/*.md` on disk:
#
#   dated plan-shaped work units          1366
#   of those with no `.md` anywhere         52   (31 still non-terminal)
#   has a `.md`     AND `source_path`     1191   = 90.6%
#   has no `.md`    AND `source_path`        5   =  9.6%
#   screen flags (`source_path` absent)     170, of which 47 truly bodyless
#     => recall 90.4%, precision 27.6%
#
# The 5 in the third row are why `scanned` is not proof of a body: their
# `source_path` names a file that exists on no machine.
# ---------------------------------------------------------------------------

#: The specimen from the plan's §2.2 — filed by a session that discovered a
#: defect while implementing a different plan, listed as a Plan from that
#: moment, and never given a document.
SPECIMEN_SLUG = "2026-09-01-coord-post-respawn-duplicates-child-session-on-retry"


class TestDeriveBodyProvenance:
    """Phase 1 + Phase 5a — the screen, from ``metadata`` alone."""

    @pytest.mark.parametrize(
        "metadata",
        [
            None,
            {},
            {"handler": "respawn", "severity": "high"},
            {"source_path": ""},
            {"source_path": "   "},
            {"source_path": None},
            {"source_path": 42},
            "not a mapping at all",
            [],
        ],
        ids=[
            "null-metadata",
            "empty-object",
            "discovery-writeup-without-a-path",
            "blank-path",
            "whitespace-path",
            "null-path",
            "non-string-path",
            "metadata-is-a-string",
            "metadata-is-a-list",
        ],
    )
    def test_absent_source_path_is_never_scanned(self, metadata):
        """No ``source_path`` ⇒ no scanner ever saw a file for this unit.

        coord applies no schema to ``metadata``, so the non-mapping and
        non-string rows are shapes this must survive, not hypotheticals.
        """
        assert derive_body_provenance(metadata) == "never_scanned"

    @pytest.mark.parametrize(
        "source_path",
        [
            "/home/spinak/Projects/qontinui-root/qontinui-dev-notes/plans/x.md",
            "D:/qontinui-root/qontinui-dev-notes/plans/2026-09-01-x.md",
            "D:\\qontinui-root\\qontinui-dev-notes\\plans\\2026-09-01-x.md",
            "plans/2026-09-01-x.md",
            "./qontinui-dev-notes/plans/nested/2026-09-01-x.md",
        ],
        ids=["posix", "windows-forward", "windows-back", "relative", "nested"],
    )
    def test_canonical_plans_directory_is_scanned(self, source_path):
        assert derive_body_provenance({"source_path": source_path}) == "scanned"

    @pytest.mark.parametrize(
        "source_path",
        [
            # Phase 5a's own case: a session worktree is not a place another
            # machine can resolve, so this must NOT read as `scanned`.
            "/home/spinak/Projects/qontinui-root/agent-worktrees/"
            "01a0624f/qontinui-dev-notes/plans/2026-09-01-x.md",
            "D:\\qontinui-root\\agent-worktrees\\abc\\plans\\x.md",
            # ...and "outside a canonical plans/ directory" is the other half.
            "/home/spinak/notes/2026-09-01-x.md",
            "C:/scratch/x.md",
            # A FILE named `plans` is not a plans directory.
            "/home/spinak/notes/plans",
        ],
        ids=[
            "agent-worktrees-posix",
            "agent-worktrees-windows",
            "not-under-plans",
            "scratch-dir",
            "file-named-plans",
        ],
    )
    def test_machine_local_paths_are_scanned_locally(self, source_path):
        assert derive_body_provenance({"source_path": source_path}) == "scanned_locally"

    def test_the_specimen_shape_is_flagged(self):
        """§2.2's unit carried a genuine write-up and no ``source_path``.

        This is the row an operator picked off the console on 2026-09-02 and
        sent a session at. The screen would have flagged it on 2026-09-01, the
        day it was filed.
        """
        specimen_metadata = {
            "handler": "post_respawn",
            "evidence": "duplicate child session on retry",
            "why_not_mechanical": "the retry path re-enters spawn",
            "severity": "high",
        }
        assert derive_body_provenance(specimen_metadata) == "never_scanned"


def _knowledge(
    *,
    present: set[str] | None = None,
    corpus: int = 5,
    capture: CaptureDial | None = None,
) -> BodyKnowledge:
    """A resolved :class:`BodyKnowledge` without touching the database."""
    from app.services.plan_body_signal import _miss_reason

    dial = capture or CaptureDial(
        level="record", resolved_scope="tenant", readable=True
    )
    return BodyKnowledge(
        slugs_with_artifact=frozenset(present or set()),
        miss_reason=_miss_reason(dial, corpus),
        artifact_surface_readable=True,
        capture=dial,
        org_plan_artifact_count=corpus,
    )


class TestTriStateVerdict:
    """Phase 2 — ``true`` / ``false`` / ``"unknown"``, and each unknown arm."""

    def test_a_hit_is_true(self):
        k = _knowledge(present={SPECIMEN_SLUG})
        assert k.has_body(SPECIMEN_SLUG) is True
        assert k.unknown_reason(SPECIMEN_SLUG) is None

    def test_a_miss_with_a_live_populated_corpus_is_false(self):
        """The ONLY state in which absence is evidence."""
        k = _knowledge(present={"some-other-slug"}, corpus=1400)
        assert k.has_body(SPECIMEN_SLUG) is False
        assert k.unknown_reason(SPECIMEN_SLUG) is None

    @pytest.mark.parametrize(
        ("dial", "expected_reason"),
        [
            (CaptureDial.unreadable(), "capture_unreadable"),
            (
                CaptureDial(level="off", resolved_scope="none", readable=True),
                "capture_never_configured",
            ),
            (
                CaptureDial(level="off", resolved_scope="tenant", readable=True),
                "capture_off",
            ),
            (
                CaptureDial(
                    level="something_else", resolved_scope="system", readable=True
                ),
                "capture_off",
            ),
        ],
        ids=["unreadable", "never-configured", "turned-off", "unknown-level"],
    )
    def test_capture_arms_make_a_miss_unknown(self, dial, expected_reason):
        """ "Nobody ever wrote a row" and "somebody turned it off" are DIFFERENT.

        Neither is ``false``, but they are not the same fact either, and the
        fleet-policy wire type carries ``resolved_scope`` precisely so a
        consumer cannot collapse them.
        """
        k = _knowledge(corpus=1400, capture=dial)
        assert k.has_body(SPECIMEN_SLUG) == UNKNOWN
        assert k.unknown_reason(SPECIMEN_SLUG) == expected_reason

    def test_empty_org_corpus_makes_every_miss_unknown(self):
        """V4, the scope arm — the one that would fire for a real operator.

        ``/plans`` is tenant-scoped; ``agent.work_artifacts`` is
        organization-scoped. A viewer whose org has never received a body-sync
        write cannot distinguish "no body" from "not my org", so a page of
        ``false`` here would be a page of false accusations aimed at the wrong
        operator.
        """
        k = _knowledge(corpus=0)
        assert k.miss_reason == "empty_corpus_for_org"
        assert k.has_body(SPECIMEN_SLUG) == UNKNOWN
        assert k.unknown_reason(SPECIMEN_SLUG) == "empty_corpus_for_org"

    def test_a_hit_stays_true_under_every_unknown_arm(self):
        """An artifact row exists. Nothing about the dial unmakes that."""
        for dial in (
            CaptureDial.unreadable(),
            CaptureDial(level="off", resolved_scope="none", readable=True),
        ):
            k = _knowledge(present={SPECIMEN_SLUG}, corpus=0, capture=dial)
            assert k.has_body(SPECIMEN_SLUG) is True
            assert k.unknown_reason(SPECIMEN_SLUG) is None

    @pytest.mark.parametrize("slug", [None, ""], ids=["missing", "blank"])
    def test_a_row_with_no_slug_is_unjoinable_not_a_miss(self, slug):
        k = _knowledge(corpus=1400)
        assert k.has_body(slug) == UNKNOWN
        assert k.unknown_reason(slug) == "unjoinable_row"

    def test_capture_is_reported_before_the_empty_corpus(self):
        """Root cause, not symptom: a dial that is off EXPLAINS an empty corpus."""
        k = _knowledge(
            corpus=0,
            capture=CaptureDial(level="off", resolved_scope="tenant", readable=True),
        )
        assert k.miss_reason == "capture_off"

    def test_the_signal_block_reports_zero_as_a_measurement(self):
        block = _knowledge(corpus=0).as_signal_block()
        assert block["org_plan_artifact_count"] == 0
        assert block["artifact_surface_readable"] is True
        assert block["capture_readable"] is True
        assert block["miss_reason"] == "empty_corpus_for_org"


def _user():
    return SimpleNamespace(id=uuid4())


def _live_dial() -> CaptureDial:
    return CaptureDial(level="record", resolved_scope="tenant", readable=True)


@pytest.mark.asyncio
class TestResolveBodyKnowledge:
    """The resolver itself — two bounded queries, and one fail-closed exit."""

    async def test_joins_one_page_in_two_queries_not_n(self):
        org = SimpleNamespace(id=uuid4())
        slugs = [f"2026-09-0{i}-plan" for i in range(1, 6)]
        with (
            patch(
                "app.services.plan_body_signal.resolve_personal_organization",
                AsyncMock(return_value=org),
            ),
            patch(
                "app.services.plan_body_signal.crud.count_artifacts",
                AsyncMock(return_value=1400),
            ) as count,
            patch(
                "app.services.plan_body_signal.crud.work_unit_slugs_with_artifacts",
                AsyncMock(return_value={slugs[0]}),
            ) as join,
        ):
            k = await resolve_body_knowledge(
                object(), _user(), slugs=slugs, capture=_live_dial()
            )

        assert count.await_count == 1
        assert join.await_count == 1
        assert join.await_args.kwargs["kind"] == PLAN_ARTIFACT_KIND
        assert join.await_args.kwargs["org_id"] == org.id
        # De-duplicated and sorted — a page may repeat a slug, and the query
        # should not.
        assert join.await_args.kwargs["slugs"] == sorted(slugs)
        assert k.has_body(slugs[0]) is True
        assert k.has_body(slugs[1]) is False

    async def test_no_personal_organization_is_the_null_bucket_not_a_failure(self):
        """``None`` from the resolver is a real scope, and reads normally."""
        with (
            patch(
                "app.services.plan_body_signal.resolve_personal_organization",
                AsyncMock(return_value=None),
            ),
            patch(
                "app.services.plan_body_signal.crud.count_artifacts",
                AsyncMock(return_value=3),
            ) as count,
            patch(
                "app.services.plan_body_signal.crud.work_unit_slugs_with_artifacts",
                AsyncMock(return_value=set()),
            ),
        ):
            k = await resolve_body_knowledge(
                object(), _user(), slugs=["a"], capture=_live_dial()
            )

        assert count.await_args.kwargs["org_id"] is None
        assert k.artifact_surface_readable is True
        assert k.has_body("a") is False

    async def test_a_failed_org_lookup_is_unknown_never_false(self):
        """The 503 arm.

        ``plan_library._resolve_org_id`` answers 503 rather than degrading
        into the shared NULL bucket. This route inherits the READING, not the
        status code: a page of work units must still render, with an unknown
        badge on every row.
        """
        with patch(
            "app.services.plan_body_signal.resolve_personal_organization",
            AsyncMock(side_effect=RuntimeError("statement timeout")),
        ):
            k = await resolve_body_knowledge(
                object(), _user(), slugs=["a", "b"], capture=_live_dial()
            )

        assert k.artifact_surface_readable is False
        assert k.miss_reason == "artifact_surface_unavailable"
        assert k.org_plan_artifact_count is None  # not measured — never 0
        for slug in ("a", "b"):
            assert k.has_body(slug) == UNKNOWN
            assert k.unknown_reason(slug) == "artifact_surface_unavailable"

    async def test_a_failed_artifact_query_is_unknown_never_false(self):
        with (
            patch(
                "app.services.plan_body_signal.resolve_personal_organization",
                AsyncMock(return_value=SimpleNamespace(id=uuid4())),
            ),
            patch(
                "app.services.plan_body_signal.crud.count_artifacts",
                AsyncMock(side_effect=RuntimeError("pool exhausted")),
            ),
        ):
            k = await resolve_body_knowledge(
                object(), _user(), slugs=["a"], capture=_live_dial()
            )

        assert k.has_body("a") == UNKNOWN
        assert k.unknown_reason("a") == "artifact_surface_unavailable"

    async def test_no_principal_is_unknown_and_asks_nothing(self):
        """`None` is "no organization-scoped principal", not the NULL bucket.

        `/plans` is gated on a coord-resolvable bearer, which is a wider door
        than the plan library's dual-auth tree — so this is reachable without
        the route being unauthenticated. Scoping such a request to the shared
        NULL bucket would report one principal's corpus as another's.
        """
        with (
            patch(
                "app.services.plan_body_signal.resolve_personal_organization",
                AsyncMock(),
            ) as org,
            patch(
                "app.services.plan_body_signal.crud.count_artifacts", AsyncMock()
            ) as count,
        ):
            k = await resolve_body_knowledge(
                object(), None, slugs=["a"], capture=_live_dial()
            )

        org.assert_not_awaited()
        count.assert_not_awaited()
        assert k.artifact_surface_readable is False
        assert k.miss_reason == "no_org_principal"
        assert k.org_plan_artifact_count is None
        assert k.has_body("a") == UNKNOWN
        assert k.unknown_reason("a") == "no_org_principal"

    async def test_an_empty_page_asks_the_join_for_nothing(self):
        """No slugs is not a reason to query for slugs."""
        with (
            patch(
                "app.services.plan_body_signal.resolve_personal_organization",
                AsyncMock(return_value=None),
            ),
            patch(
                "app.services.plan_body_signal.crud.count_artifacts",
                AsyncMock(return_value=0),
            ),
            patch(
                "app.services.plan_body_signal.crud.work_unit_slugs_with_artifacts",
                AsyncMock(return_value=set()),
            ) as join,
        ):
            k = await resolve_body_knowledge(
                object(), _user(), slugs=[], capture=_live_dial()
            )

        assert join.await_args.kwargs["slugs"] == []
        assert k.miss_reason == "empty_corpus_for_org"
