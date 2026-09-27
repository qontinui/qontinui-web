"""The plan difficulty rubric (``app.services.plan_difficulty``) — pure, no DB.

Plan ``2026-09-18-plan-library-difficulty-field``. What these pin:

* the rubric is TOTAL — every body, including ``""``, gets a rating;
* a declared ``Difficulty:`` stamp overrides the computed level, but only in
  the header — the STRUCTURAL region before the first sub-H1 heading, capped
  only when a plan has no such heading — and never from inside fenced code;
* the two axes fold into the routing level with conceptual difficulty
  dominating (the table in ``_fold``);
* the repo count reads only real repository names, so a crate, container or
  CLI name that merely LOOKS like a repo cannot inflate a rating.
"""

from __future__ import annotations

import time
from typing import get_args

import pytest

from app.services.plan_difficulty import (
    _HEADER_MAX_LINES,
    MODEL_SELECTOR_VOCABULARY,
    MODEL_SELECTORS,
    MODEL_TIERS,
    RUBRIC_VERSION,
    DifficultyLevel,
    _fold,
    compute_difficulty,
)

_REPOS = ("qontinui-coord", "qontinui-runner", "qontinui-web", "qontinui-schemas")


def _heavy_plan() -> str:
    """A plan that should rate ``high`` on both axes: many phases across four
    repos, many files, and sustained concurrency / consistency / security /
    distributed-systems reasoning with recorded trade-offs."""
    parts = [
        "# Rework the lease protocol",
        "",
        f"**Repos:** {', '.join(_REPOS)}",
        "",
        "## Design decisions",
        "Trade-off: we rejected option A; the alternative risks a race.",
        "Open question: the ordering of retries under a timeout is ambiguous.",
        "Why not a mutex? The failure mode is a deadlock across the protocol.",
    ]
    concern = (
        "The race between the lock holder and the lease renewal breaks an "
        "invariant; the migration and backfill must stay consistent; the "
        "auth credential and JWT nonce are a permission boundary; retry "
        "ordering in the queue under a timeout is a state machine."
    )
    for n in range(1, 8):
        parts += [
            "",
            f"## Phase {n}",
            concern,
            f"- `crates/coord/src/mod{n}.rs`",
            f"- `src-tauri/src/lease/part{n}.rs`",
            f"- `backend/app/crud/thing{n}.py`",
            f"- `frontend/src/components/Thing{n}.tsx`",
        ]
    parts += [f"filler line {i}" for i in range(400)]
    return "\n".join(parts)


class TestTotality:
    def test_an_empty_body_is_rated_low_and_computed(self) -> None:
        rating = compute_difficulty("")
        assert rating.level == "low"
        assert rating.conceptual == "low"
        assert rating.implementation == "low"
        assert rating.source == "computed"
        assert rating.rubric_version == RUBRIC_VERSION

    def test_a_small_single_repo_fix_is_low(self) -> None:
        body = (
            "# Fix a typo in the console copy\n\n"
            "**Repos:** qontinui-web\n\n"
            "## Phase 1\nChange one string in `frontend/src/a/b.tsx`.\n"
        )
        assert compute_difficulty(body).level == "low"

    def test_a_heavy_plan_is_high_on_both_axes(self) -> None:
        rating = compute_difficulty(_heavy_plan())
        assert rating.conceptual == "high", rating.signals
        assert rating.implementation == "high", rating.signals
        assert rating.level == "high"

    def test_signals_explain_the_rating(self) -> None:
        signals = compute_difficulty(_heavy_plan()).signals
        assert signals["phases"] == 7
        assert signals["repos"] == sorted(_REPOS)
        assert set(signals["concept_families"]) == {  # type: ignore[arg-type]
            "concurrency",
            "consistency",
            "security",
            "distributed",
        }
        assert signals["computed_level"] == "high"

    def test_every_level_names_a_model_tier(self) -> None:
        assert set(MODEL_TIERS) == {"low", "medium", "high"}
        assert MODEL_TIERS["high"] == "Fable 5.1"
        assert MODEL_TIERS["medium"] == "Opus 5"


class TestModelSelectors:
    """The machine-readable routing map (plan
    ``2026-09-22-route-plan-sweeps-by-difficulty``). A level added without a
    selector must fail HERE, not as a ``KeyError`` in a sweep at 03:00."""

    #: The Claude Code Agent tool's ``model`` values — the vocabulary
    #: :data:`MODEL_SELECTOR_VOCABULARY` names.
    _AGENT_TOOL_MODELS = frozenset({"sonnet", "opus", "haiku", "fable"})

    def test_every_difficulty_level_has_a_tier_and_a_selector(self) -> None:
        levels = set(get_args(DifficultyLevel))
        assert levels == {"low", "medium", "high"}
        assert set(MODEL_TIERS) == levels
        assert set(MODEL_SELECTORS) == levels

    def test_every_selector_is_an_agent_tool_model(self) -> None:
        assert set(MODEL_SELECTORS.values()) <= self._AGENT_TOOL_MODELS

    def test_the_selectors_follow_the_calibrated_tiers(self) -> None:
        # ``low`` was calibrated on Sonnet; ``haiku`` is deliberately unmapped.
        assert MODEL_SELECTORS == {"high": "fable", "medium": "opus", "low": "sonnet"}

    def test_the_vocabulary_is_named(self) -> None:
        assert MODEL_SELECTOR_VOCABULARY == "claude_code_agent_tool_v1"


class TestDeclaredStamp:
    @pytest.mark.parametrize(
        "line",
        [
            "**Difficulty:** high",
            "Difficulty: HIGH",
            "> **Difficulty: high**",
            "- **Difficulty**: high (cross-repo protocol change)",
        ],
    )
    def test_a_header_stamp_overrides_the_computed_level(self, line: str) -> None:
        rating = compute_difficulty(f"# Tiny plan\n\n{line}\n\nOne line.\n")
        assert rating.level == "high"
        assert rating.source == "declared"
        # The axes stay COMPUTED beside it, so a disagreement is visible.
        assert rating.conceptual == "low"
        assert rating.signals["computed_level"] == "low"

    def test_a_stamp_can_lower_the_level_too(self) -> None:
        body = _heavy_plan().replace(
            "# Rework the lease protocol",
            "# Rework the lease protocol\n\n**Difficulty:** low",
        )
        rating = compute_difficulty(body)
        assert rating.level == "low"
        assert rating.source == "declared"
        assert rating.signals["computed_level"] == "high"

    def test_a_stamp_below_the_header_is_ignored(self) -> None:
        # The header ends at the first sub-H1 heading; a stamp under it is
        # body prose that merely DISCUSSES difficulty.
        body = "# Plan\n## Body\n" + "prose\n" * 80 + "Difficulty: high\n"
        rating = compute_difficulty(body)
        assert rating.source == "computed"
        assert rating.level == "low"

    def test_a_stamp_past_line_60_of_a_heading_free_header_is_now_found(
        self,
    ) -> None:
        # Rubric v1 read only the first 60 lines and ignored this stamp. The
        # header is now structural, so with no heading above it the stamp is
        # inside the header — recorded here so the change is not absorbed.
        body = "# Plan\n" + "prose\n" * 80 + "Difficulty: high\n"
        rating = compute_difficulty(body)
        assert rating.source == "declared"
        assert rating.level == "high"

    def test_a_stamp_under_a_391_line_status_blockquote_is_found(self) -> None:
        body = (
            "# Plan\n"
            + "> **Status: SHIPPED.** history line\n" * 391
            + "**Difficulty:** high\n\n## Why\n\nOne line.\n"
        )
        lines = body.splitlines()
        # 1-based line 393: past line 390, below every blockquote line.
        assert lines[392] == "**Difficulty:** high"
        rating = compute_difficulty(body)
        assert rating.source == "declared"
        assert rating.level == "high"

    def test_a_stamp_after_the_first_heading_is_not_found(self) -> None:
        body = "# Plan\n\n**Date:** 2026-09-22\n\n## Why\n\nDifficulty: high\n"
        assert compute_difficulty(body).source == "computed"

    def test_a_deeper_first_heading_also_ends_the_header(self) -> None:
        body = "# Plan\n\n### Context\n\nDifficulty: high\n\n## Why\n"
        assert compute_difficulty(body).source == "computed"

    @pytest.mark.parametrize(
        "body",
        [
            "# P\n##x\n**Difficulty:** high\n## Why\n",
            "# P\n> ## x\n**Difficulty:** high\n## Why\n",
            "# P\n```text\n## inside\n```\n**Difficulty:** high\n## Why\n",
        ],
        ids=["hashes-without-space", "quoted-heading", "heading-inside-fence"],
    )
    def test_a_line_that_only_looks_like_a_heading_does_not_end_the_header(
        self, body: str
    ) -> None:
        assert compute_difficulty(body).source == "declared"

    def test_a_sub_h1_title_of_a_plan_with_no_h1_is_skipped(self) -> None:
        body = "\n## Plan title\n\n**Difficulty:** high\n\n## Why\n\nOne line.\n"
        rating = compute_difficulty(body)
        assert rating.source == "declared"
        assert rating.level == "high"

    def test_crlf_bodies_find_the_heading_and_the_stamp(self) -> None:
        found = "# P\r\n**Difficulty:** high\r\n## Why\r\n"
        assert compute_difficulty(found).source == "declared"
        below = "# P\r\n## Why\r\n**Difficulty:** high\r\n"
        assert compute_difficulty(below).source == "computed"

    def test_seven_hashes_is_not_a_heading(self) -> None:
        body = "# Plan\n####### not a heading\nDifficulty: high\n"
        assert compute_difficulty(body).source == "declared"

    def test_a_heading_free_body_stops_at_the_cap(self) -> None:
        inside = "# Plan\n" + "prose\n" * (_HEADER_MAX_LINES - 2) + "Difficulty: high\n"
        assert len(inside.splitlines()) == _HEADER_MAX_LINES
        assert compute_difficulty(inside).source == "declared"
        outside = (
            "# Plan\n" + "prose\n" * (_HEADER_MAX_LINES - 1) + "Difficulty: high\n"
        )
        assert len(outside.splitlines()) == _HEADER_MAX_LINES + 1
        assert compute_difficulty(outside).source == "computed"

    def test_a_found_header_is_never_truncated_at_the_cap(self) -> None:
        body = (
            "# Plan\n"
            + "> history\n" * (_HEADER_MAX_LINES + 100)
            + "**Difficulty:** low\n\n## Why\n"
        )
        assert compute_difficulty(body).source == "declared"

    def test_a_stamp_inside_a_code_fence_is_ignored(self) -> None:
        body = "# Plan\n\n```text\nDifficulty: high\n```\n"
        assert compute_difficulty(body).source == "computed"

    def test_a_word_that_is_not_a_level_is_ignored(self) -> None:
        assert compute_difficulty("Difficulty: extreme\n").source == "computed"


class TestFold:
    @pytest.mark.parametrize(
        ("conceptual", "implementation", "level"),
        [
            ("high", "low", "high"),
            ("high", "high", "high"),
            ("medium", "high", "high"),
            ("medium", "medium", "medium"),
            ("medium", "low", "medium"),
            ("low", "high", "medium"),
            ("low", "medium", "medium"),
            ("low", "low", "low"),
        ],
    )
    def test_conceptual_difficulty_dominates(
        self, conceptual: str, implementation: str, level: str
    ) -> None:
        assert _fold(conceptual, implementation) == level  # type: ignore[arg-type]


class TestRepoCount:
    def test_repo_lookalikes_are_not_repos(self) -> None:
        body = (
            "Touches ui-bridge-inject, qontinui-canonical-postgres, "
            "qontinui-dev-notes and the qontinui-web-wt-foo worktree.\n"
        )
        assert compute_difficulty(body).signals["repos"] == []

    def test_the_repos_line_wins_over_prose_mentions(self) -> None:
        body = (
            "**Repos:** qontinui-web\n\n"
            "Background: qontinui-coord and qontinui-runner behave like this.\n"
        )
        assert compute_difficulty(body).signals["repos"] == ["qontinui-web"]

    def test_a_path_under_a_repo_names_that_repo(self) -> None:
        body = "Edit `qontinui-web/backend/app/x.py` and `ui-bridge/src/y.ts`.\n"
        assert compute_difficulty(body).signals["repos"] == [
            "qontinui-web",
            "ui-bridge",
        ]


class TestPathologicalBodies:
    """Every shape that made a first-cut regex super-linear, at 200k chars.

    The budget is generous (the measured worst is ~0.25 s) so a slow CI box
    cannot flake it, and tight enough that the quadratic cases — 3,000 blank
    lines took 18 s, one 200,000-space line 142 s — fail it by orders of
    magnitude.
    """

    @pytest.mark.parametrize(
        "body",
        [
            "\n" * 200_000,
            "\r\n" * 200_000,
            " " * 200_000,
            "\t" * 200_000,
            "* " * 200_000,
            "> " * 200_000,
            "> ** \n" * 50_000,
            "Difficulty" + " " * 200_000,
            "**Difficulty" + " *" * 200_000,
            "Repos:" + " " * 200_000,
            "**Repos" + " *" * 200_000,
            "a/" * 200_000 + "b" * 200_000,
            "```\n" * 200_000,
            # A LATE heading: the structural header region grows to the
            # whole body before it, so each of these walks ~200k chars.
            "\n" * 200_000 + "## x\n",
            "> ** \n" * 50_000 + "## x\n",
            "* \n" * 100_000 + "## x\n",
            "> \n" * 100_000 + "## x\n",
            "**Difficulty" + " *" * 200_000 + "\n## x\n",
        ],
        ids=[
            "blank-lines",
            "crlf-lines",
            "spaces",
            "tabs",
            "star-space",
            "quote-space",
            "quote-bold-lines",
            "difficulty-then-spaces",
            "bold-difficulty-then-star-space",
            "repos-then-spaces",
            "bold-repos-then-star-space",
            "long-path",
            "unclosed-fences",
            "blank-lines-then-late-heading",
            "quote-bold-lines-then-late-heading",
            "star-space-lines-then-late-heading",
            "quote-space-lines-then-late-heading",
            "bold-difficulty-then-star-space-then-late-heading",
        ],
    )
    def test_rating_is_linear(self, body: str) -> None:
        start = time.perf_counter()
        compute_difficulty(body)
        assert time.perf_counter() - start < 3.0


class TestSecurityFamily:
    def test_author_is_not_auth(self) -> None:
        body = "The author authored this; authority says so. " * 5
        assert "security" not in compute_difficulty(body).signals["concept_families"]  # type: ignore[operator]

    def test_authentication_still_counts(self) -> None:
        body = "authentication, authorization, the credential. " * 2
        assert "security" in compute_difficulty(body).signals["concept_families"]  # type: ignore[operator]


class TestDeclaredStampFences:
    def test_a_fence_opening_in_the_header_and_closing_below_it_hides_its_stamp(
        self,
    ) -> None:
        body = "# Plan\n\n```text\nDifficulty: high\n" + "x\n" * 80 + "```\n"
        assert compute_difficulty(body).source == "computed"
