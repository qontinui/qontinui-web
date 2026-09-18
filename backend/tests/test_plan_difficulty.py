"""The plan difficulty rubric (``app.services.plan_difficulty``) — pure, no DB.

Plan ``2026-09-18-plan-library-difficulty-field``. What these pin:

* the rubric is TOTAL — every body, including ``""``, gets a rating;
* a declared ``Difficulty:`` stamp overrides the computed level, but only in
  the header, and never from inside fenced code;
* the two axes fold into the routing level with conceptual difficulty
  dominating (the table in ``_fold``);
* the repo count reads only real repository names, so a crate, container or
  CLI name that merely LOOKS like a repo cannot inflate a rating.
"""

from __future__ import annotations

import time

import pytest

from app.services.plan_difficulty import (
    MODEL_TIERS,
    RUBRIC_VERSION,
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
        body = "# Plan\n" + "prose\n" * 80 + "Difficulty: high\n"
        rating = compute_difficulty(body)
        assert rating.source == "computed"
        assert rating.level == "low"

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
