"""Plan difficulty — how hard a plan is to vet and implement.

A plan is rated on two axes, then folded into one level:

* **conceptual** — how much reasoning it takes to get the design right:
  concurrency and ordering, consistency and migrations, security and tenancy,
  contracts crossing several repos, and how much deliberation (alternatives,
  trade-offs, open questions) the plan itself records.
* **implementation** — how much there is to build: phases, repos touched,
  distinct files named, and the size of the plan.

The three levels are a MODEL-ROUTING vocabulary, not a grade:

* ``high``   — vet and implement with the strongest model tier (Fable 5.1).
* ``medium`` — well suited to Opus 5.
* ``low``    — a fast tier is enough (Sonnet 5.0, DeepSeek Flash 4.1,
  Gemini 3.8 Flash).

**A declared stamp wins.** A plan whose header carries ``**Difficulty:** high``
(or ``medium`` / ``low``) records an author's or vetter's judgement, which is
better evidence than any lexical heuristic; the computed axes are still
reported beside it so a reader can see where the two disagree.

The computation is pure, deterministic and body-only. The upsert rates a plan
whenever its body is written, and ``GET /plan-library/difficulty`` re-rates
every plan row stored under an older :data:`RUBRIC_VERSION` (or none) before it
answers — so bumping the version is the whole of a re-rating.

The thresholds were calibrated on 2026-09-18 against the 1,777 plans on
``qontinui-dev-notes`` ``origin/main`` at ``34665300``, which rate 20% high,
52% medium and 28% low under version 1.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

DifficultyLevel = Literal["low", "medium", "high"]
DifficultySource = Literal["declared", "computed"]

#: Bump whenever a threshold, weight or signal changes, then backfill. Stored
#: beside every rating so a row rated under an older rubric is identifiable.
RUBRIC_VERSION = 1

#: The model tier each level routes to — display copy, served so every
#: consumer (the console, /candidates readers) says the same thing.
MODEL_TIERS: dict[str, str] = {
    "high": "Fable 5.1",
    "medium": "Opus 5",
    "low": "Sonnet 5.0 / DeepSeek Flash 4.1 / Gemini 3.8 Flash",
}

#: The harness selector each level routes to — MACHINE-READABLE, unlike
#: :data:`MODEL_TIERS`, which is display copy and must never be parsed (its
#: ``low`` value names three alternatives). The values are the Claude Code
#: Agent tool's ``model`` parameter (``sonnet`` / ``opus`` / ``haiku`` /
#: ``fable``); :data:`MODEL_SELECTOR_VOCABULARY` names that vocabulary, and a
#: consumer whose harness does not match it treats the map as ABSENT rather
#: than guessing. ``haiku`` is deliberately unmapped: the ``low`` tier was
#: calibrated on Sonnet 5.0 and names no Haiku model.
#:
#: Kept adjacent to :data:`MODEL_TIERS` so an edit to one prompts a check of
#: the other; both are served together on ``GET /plan-library``,
#: ``/plan-library/candidates`` and ``/plan-library/difficulty`` (plan
#: ``2026-09-22-route-plan-sweeps-by-difficulty``). Every
#: :data:`DifficultyLevel` must have an entry — a level added without one is a
#: test failure, not a ``KeyError`` in a sweep.
MODEL_SELECTORS: dict[str, str] = {
    "high": "fable",
    "medium": "opus",
    "low": "sonnet",
}

#: Names the selector vocabulary :data:`MODEL_SELECTORS` is written in. A
#: second harness is an added key under a new vocabulary, not a rename.
MODEL_SELECTOR_VOCABULARY = "claude_code_agent_tool_v1"

# ─────────────────────────── declared stamp ───────────────────────────

#: ``Difficulty: high`` at line start, tolerating a blockquote marker, bold
#: markup around the key and/or the value, and a bullet. Only the header region
#: is searched (see :data:`_HEADER_LINES`) so a plan that merely DISCUSSES
#: difficulty in its body does not stamp itself.
#:
#: ⚠️ Horizontal whitespace only — ``[ \t]``, never ``\s``. Under MULTILINE a
#: ``\s*`` at ``^`` crosses newlines, and two adjacent ones can split one blank
#: run in quadratically many ways at every line start: a body of 3,000 blank
#: lines took 18 s to rate (review of the first cut, 2026-09-18). For the
#: same reason every optional ``*`` run OWNS the whitespace after it
#: (``(?:\*+[ \t]*)?``): a bare ``\**`` between two ``[ \t]*`` runs can be
#: empty, which makes them adjacent again — one 200,000-space line took 142 s.
#: ``tests/test_plan_difficulty.py`` ``TestPathologicalBodies`` pins both.
_DECLARED_RE = re.compile(
    r"^[ \t]*(?:>[ \t]*)?(?:[-*][ \t]+)?(?:\*+[ \t]*)?difficulty"
    r"[ \t]*(?:\*+[ \t]*)?:[ \t]*(?:\*+[ \t]*)?(high|medium|low)\b",
    re.IGNORECASE | re.MULTILINE,
)
_HEADER_LINES = 60

# ───────────────────────────── signals ─────────────────────────────

_FENCE_RE = re.compile(r"^(```|~~~).*?^\1", re.MULTILINE | re.DOTALL)

#: A phase/wave/step heading. Numbered and lettered forms both count
#: (``## Phase 2``, ``### Phase 3b``, ``## Wave 1``).
_PHASE_RE = re.compile(
    r"^#{2,4}\s+(?:phase|wave|step|stage)\s+([0-9]+[a-z]?|[a-z])\b",
    re.IGNORECASE | re.MULTILINE,
)

#: The repositories this fleet changes. A closed list rather than a pattern:
#: ``qontinui-[a-z-]+`` also matches container names, crate names and CLI
#: binaries (``qontinui-canonical-postgres``, ``ui-bridge-inject``), and each
#: false repo is worth two implementation points. ``qontinui`` alone is left
#: out — it names the product far more often than the core library.
#: ``qontinui-dev-notes`` is left out too: it is where plans LIVE.
KNOWN_REPOS: frozenset[str] = frozenset(
    {
        "multistate",
        "qontinui-claude-config",
        "qontinui-cloud-control",
        "qontinui-coord",
        "qontinui-demo-stage",
        "qontinui-design-tokens",
        "qontinui-devtools",
        "qontinui-docs",
        "qontinui-finetune",
        "qontinui-gym",
        "qontinui-hal-mcp",
        "qontinui-inspect",
        "qontinui-lib-mcp",
        "qontinui-mcp",
        "qontinui-mobile",
        "qontinui-navigation",
        "qontinui-prm",
        "qontinui-research",
        "qontinui-runner",
        "qontinui-schemas",
        "qontinui-setup-mcp",
        "qontinui-stack",
        "qontinui-supervisor",
        "qontinui-train",
        "qontinui-web",
        "qontinui-web-mcp",
        "qontinui-workflow-ui",
        "qontinui-workflow-utils",
        "qontinui-wrappers",
        "ui-bridge",
        "ui-bridge-auto",
        "ui-bridge-mcp",
        "wrappers-registry",
    }
)
_REPO_TOKEN_RE = re.compile(r"(?<![\w/-])[a-z][a-z-]*[a-z](?![\w-])")
#: Horizontal whitespace only, for the reason on :data:`_DECLARED_RE`.
_REPOS_LINE_RE = re.compile(
    r"^[ \t]*(?:>[ \t]*)?(?:\*+[ \t]*)?repos?[ \t]*(?:\*+[ \t]*)?:[ \t]*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)

#: A file path: at least one directory separator and an extension.
_PATH_RE = re.compile(r"(?<![\w/.-])(?:[\w.-]+/)+[\w.-]+\.[a-z]{1,5}\b")

#: Conceptual families. A family counts once it is mentioned at least
#: :data:`_FAMILY_MIN_HITS` times — a single passing mention is not a design
#: concern the plan has to reason about.
_FAMILIES: dict[str, re.Pattern[str]] = {
    "concurrency": re.compile(
        r"\b(race|racing|concurren\w*|lock(?:s|ed|ing)?|lease|mutex|deadlock|"
        r"atomic\w*|idempoten\w*|reentran\w*|interleav\w*|serializ\w*)\b",
        re.IGNORECASE,
    ),
    "consistency": re.compile(
        r"\b(invariant\w*|consisten\w*|transaction\w*|backfill\w*|migration\w*|"
        r"alembic|schema change|drift\w*|diverg\w*|reconcil\w*)\b",
        re.IGNORECASE,
    ),
    "security": re.compile(
        # Not ``auth\w*``: that also matches "author", "authored" and
        # "authority", which every plan in this corpus says.
        r"\b(authn|authz|authenticat\w*|authoriz\w*|credential\w*|jwt|nonce|"
        r"secret\w*|permission\w*|"
        r"tenant isolation|cross-tenant|privilege\w*|rls|encrypt\w*)\b",
        re.IGNORECASE,
    ),
    "distributed": re.compile(
        r"\b(state machine|protocol|fan-?out|eventual\w*|retry|retries|"
        r"timeout\w*|backpressure|queue\w*|ordering|cache invalidation|"
        r"at-least-once|exactly-once)\b",
        re.IGNORECASE,
    ),
}
_FAMILY_MIN_HITS = 3

#: Deliberation markers — the plan records choices it had to make.
_DELIBERATION_RE = re.compile(
    r"(design decision|trade-?off|alternative\w*|rejected|open question|"
    r"option [a-d]\b|considered and|why not\b|unknown\w*|ambigu\w*|"
    r"risk\w*|failure mode)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class PlanDifficulty:
    """One plan's rating. ``level`` is what routes work; the rest explains it."""

    level: DifficultyLevel
    conceptual: DifficultyLevel
    implementation: DifficultyLevel
    source: DifficultySource
    rubric_version: int
    signals: dict[str, object] = field(default_factory=dict)


def _strip_fences(body: str) -> str:
    """Drop fenced code — a pasted log or diff is not the plan's prose."""
    return _FENCE_RE.sub("", body)


def _declared(prose: str) -> DifficultyLevel | None:
    """The header stamp, from the first :data:`_HEADER_LINES` lines of
    ``prose`` — the body with fences ALREADY stripped, so a fence that opens
    in the header and closes below it cannot leak a stamp."""
    header = "\n".join(prose.splitlines()[:_HEADER_LINES])
    m = _DECLARED_RE.search(header)
    return m.group(1).lower() if m else None  # type: ignore[return-value]


def _repos(prose: str) -> list[str]:
    """Repos the plan CHANGES: the ``Repos:`` line when present, else every
    repo the prose names (a looser reading, but the only one available)."""
    m = _REPOS_LINE_RE.search(prose)
    source = m.group(1) if m else prose
    return sorted({t for t in _REPO_TOKEN_RE.findall(source) if t in KNOWN_REPOS})


def _bucket(score: int, medium_at: int, high_at: int) -> DifficultyLevel:
    if score >= high_at:
        return "high"
    if score >= medium_at:
        return "medium"
    return "low"


def _fold(
    conceptual: DifficultyLevel, implementation: DifficultyLevel
) -> DifficultyLevel:
    """Fold the two axes into the routing level.

    Conceptual difficulty dominates: a model that cannot hold the design gets
    it wrong however small the diff, while a large but mechanical change is
    well within a mid tier. So a conceptually ``high`` plan is ``high``, a
    ``medium`` one is lifted to ``high`` only by a ``high`` build, and a
    conceptually ``low`` plan is capped at ``medium`` however big it is.
    """
    if conceptual == "high":
        return "high"
    if conceptual == "medium":
        return "high" if implementation == "high" else "medium"
    return "low" if implementation == "low" else "medium"


def compute_difficulty(body: str) -> PlanDifficulty:
    """Rate ``body``. Total: every string, including ``""``, gets a rating."""
    prose = _strip_fences(body)
    lines = [ln for ln in prose.splitlines() if ln.strip()]

    phases = len({p.lower() for p in _PHASE_RE.findall(prose)})
    repos = _repos(prose)
    paths = len(set(_PATH_RE.findall(prose)))
    size = len(lines)

    families = {name: len(rx.findall(prose)) for name, rx in _FAMILIES.items()}
    live_families = sorted(n for n, c in families.items() if c >= _FAMILY_MIN_HITS)
    deliberation = len(_DELIBERATION_RE.findall(prose))

    # Implementation: volume of work.
    impl_score = (
        min(phases, 8)
        + 2 * max(len(repos) - 1, 0)
        + min(paths // 8, 4)
        + min(size // 120, 4)
    )
    # Conceptual: reasoning load.
    concept_score = (
        2 * len(live_families)
        + min(deliberation // 4, 4)
        + (2 if len(repos) >= 3 else 0)
    )

    conceptual = _bucket(concept_score, medium_at=6, high_at=11)
    implementation = _bucket(impl_score, medium_at=6, high_at=14)
    computed = _fold(conceptual, implementation)
    declared = _declared(prose)

    signals: dict[str, object] = {
        "phases": phases,
        "repos": repos,
        "file_paths": paths,
        "lines": size,
        "concept_families": live_families,
        "deliberation_markers": deliberation,
        "conceptual_score": concept_score,
        "implementation_score": impl_score,
        "computed_level": computed,
    }
    return PlanDifficulty(
        level=declared or computed,
        conceptual=conceptual,
        implementation=implementation,
        source="declared" if declared else "computed",
        rubric_version=RUBRIC_VERSION,
        signals=signals,
    )
