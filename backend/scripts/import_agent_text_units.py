#!/usr/bin/env python3
"""Import a ``.claude/`` corpus into ``project.agent_text_units``.

Phase 5 of plan ``2026-08-20-fleet-served-agent-skills``. This is the tool that
turns the two content-free placeholder rows into a working corpus, and it writes
the **fleet-default layer** (``organization_id IS NULL``) by default — the layer
that is what "all users in a fleet have the same tools" actually means.

What it reads
=============

One config repo, named with ``--source``::

    <source>/.claude/commands/<name>.md     -> kind=command, files {"<name>.md": ...}
    <source>/.claude/skills/<name>/**       -> kind=skill,   files {<rel path>: ...}

**Both counts are enumerated at run time and NEVER hardcoded.** The same rule
``fleet_commands.rs:21-22`` states for the runner's embedded set: the plan's own
"~40 commands" was already low by 2x before it was implemented, and a literal
here would be a fact with an expiry date. Whatever is on disk is the corpus.

Underscore-prefixed units (``_gate-registration``, ``_loop-control``) are
imported with ``is_invocable=false``. They are copy-source specs other units
paste from — ``.claude/commands/`` has no include mechanism — so the corpus must
carry them, and the harness must never offer them as ``/_gate-registration``.
The DB CHECK ``ck_agent_text_unit_underscore_not_invocable`` refuses the other
pairing outright, so this is not a convention: importing one as invocable is
rejected by Postgres.

Idempotence
===========

Re-running writes a new version ONLY for a unit whose text actually changed.
The comparison is the canonical ``agent-text-unit-files/v1`` digest computed
over both the on-disk map and the stored map; see
``AgentTextUnitService.import_units``, which owns the rule. ``--dry-run``
performs the full comparison, reports it, and rolls back.

Text normalization
==================

Every file is read as **strict UTF-8** and its CRLF line endings are collapsed
to LF before it is stored. Both halves are deliberate:

* Strict UTF-8 with no fallback — a byte this model cannot carry is the plan's
  own falsification condition ("if any of the 9 skills needs a file the model
  cannot carry, the unified text model is wrong"), so it must be an error that
  names the file, never a lossy decode nobody reads.
* LF — the corpus is checked out on Windows, and a ``.sh`` provisioned with CRLF
  fails under ``bash`` in ways that read as a logic bug. The digest is
  CR-insensitive either way, so this changes what is STORED, not what compares
  equal.

Provenance
==========

Each unit records the repo-relative path it came from and the commit of the
source repo. The commit is decided **per unit**: a unit whose own files are all
clean at ``HEAD`` gets ``HEAD`` even when the tree is dirty elsewhere, and a
unit with a modified or untracked file gets ``None``, because no commit honestly
describes the bytes that were read. There is no ``"dirty"`` sentinel — absence
is the honest encoding and the DB CHECK would refuse a sentinel anyway.

Self-referential paths
======================

A skill that tells the agent to run its script by a path into the operator's
config-repo checkout is broken by provisioning alone: a non-operator device has
no such checkout. That is the exact silent-improvisation failure this plan
exists to close, surviving the fix. This importer does not rewrite such a path —
rewriting would make the stored text differ from the source the provenance
claims — it **reports** it, and ``--strict-paths`` turns the report into a
non-zero exit so a CI or a pre-seed check can gate on it.

Run it::

    python -m scripts.import_agent_text_units --source D:/qontinui-root/qontinui-claude-config --dry-run
    python -m scripts.import_agent_text_units --source ... --organization-id <uuid>
    python -m scripts.import_agent_text_units --source ... --json

Exit codes: 0 on success; 1 on a validation refusal, an unreadable corpus, or
``--strict-paths`` with findings.
"""

from __future__ import annotations

import argparse
import asyncio
import gzip
import json
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

# Allow ``python scripts/import_agent_text_units.py`` (not just ``-m``).
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models.agent_text_unit import (  # noqa: E402
    KIND_COMMAND,
    KIND_SKILL,
    entrypoint_path,
)
from app.services.agent_text_unit_service import (  # noqa: E402
    AgentTextUnitImportItem,
    AgentTextUnitImportReport,
    AgentTextUnitIndexResponse,
    AgentTextUnitListResponse,
    AgentTextUnitMetadata,
    AgentTextUnitResponse,
    AgentTextUnitService,
    AgentTextUnitValidationError,
    ImportOutcome,
    Pagination,
)

#: Where the corpus lives inside the source repo.
CLAUDE_DIR = ".claude"
COMMANDS_DIR = f"{CLAUDE_DIR}/commands"
SKILLS_DIR = f"{CLAUDE_DIR}/skills"

#: Substrings that make a provisioned unit's instructions unfollowable on a
#: device that has no operator checkout. A superset of the runner's
#: ``fleet_commands.rs:318`` ``FORBIDDEN`` list, which misses the config-repo
#: `.claude` case entirely — the one that broke `coord-pr-label`.
NON_PROVISIONABLE_PATH_MARKERS: tuple[str, ...] = (
    "qontinui-claude-config/.claude",
    "qontinui-dev-notes/plans",
    "qontinui-root/plans",
    "D:/qontinui-root",
    "D:\\qontinui-root",
)

#: Filesystem debris that is not corpus text. Matched on the file NAME, so it
#: catches the entry wherever in a skill tree it turns up.
IGNORED_FILE_NAMES = frozenset({".DS_Store", "Thumbs.db", ".gitkeep"})

#: Directory names never descended into.
IGNORED_DIR_NAMES = frozenset({".git", "__pycache__", "node_modules", ".pytest_cache"})


class CorpusError(RuntimeError):
    """The corpus on disk could not be read as a text corpus."""


@dataclass
class PathFinding:
    """One unit file that names a path a provisioned session cannot follow."""

    kind: str
    name: str
    file_path: str
    marker: str
    line_number: int


@dataclass
class Corpus:
    """Everything one scan of a ``.claude/`` tree produced."""

    items: list[AgentTextUnitImportItem] = field(default_factory=list)
    head_commit: str | None = None
    #: Units whose commit was suppressed because their own files are dirty.
    dirty_units: list[str] = field(default_factory=list)
    path_findings: list[PathFinding] = field(default_factory=list)

    def by_kind(self) -> dict[str, list[AgentTextUnitImportItem]]:
        out: dict[str, list[AgentTextUnitImportItem]] = {}
        for item in self.items:
            out.setdefault(item.kind, []).append(item)
        return out

    def total_bytes(self) -> int:
        return sum(
            len(text.encode("utf-8"))
            for item in self.items
            for text in item.files.values()
        )

    def file_count(self) -> int:
        return sum(len(item.files) for item in self.items)


# =============================================================================
# Reading the corpus
# =============================================================================


def read_unit_text(path: Path) -> str:
    """Read one corpus file as LF-normalized, strict UTF-8 text."""
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise CorpusError(f"Cannot read {path}: {exc}") from exc
    if b"\x00" in raw:
        raise CorpusError(
            f"{path} contains a NUL byte — it is binary, and the text-unit "
            "model carries text only"
        )
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CorpusError(
            f"{path} is not valid UTF-8 ({exc}) — the text-unit model carries "
            "text only. This is the plan's falsification condition, not a file "
            "to skip."
        ) from exc
    return text.replace("\r\n", "\n").replace("\r", "\n")


def git_head_commit(repo: Path) -> str | None:
    """Full 40-char ``HEAD``, or ``None`` when ``repo`` is not a git checkout."""
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    sha = out.stdout.strip()
    return sha if len(sha) == 40 and all(c in "0123456789abcdef" for c in sha) else None


def _git_show_prefix(repo: Path) -> str:
    """``repo``'s path relative to its git toplevel, e.g. ``"sub/dir/"``.

    ``git status --porcelain`` reports paths relative to the **repository root**,
    while everything else here is relative to ``--source``. They are the same
    string only when ``--source`` IS the root; when it is a subdirectory of a
    larger checkout they differ by exactly this prefix, and comparing them
    without it would silently report every unit as clean.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--show-prefix"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def git_dirty_paths(repo: Path) -> set[str]:
    """Source-relative POSIX paths that differ from ``HEAD``, untracked included.

    Returns an empty set when git cannot answer, which looks like "clean" and is
    not — so the caller must never read it alone. ``git_head_commit`` returning
    ``None`` is what says "no commit describes anything here", and this set is
    only consulted once a commit exists.

    An untracked *directory* is reported collapsed, as ``.claude/skills/x/``;
    ``_is_dirty`` therefore treats a trailing-slash entry as a prefix, which is
    also what makes a corpus that is present but wholly untracked come back with
    no commit rather than with the enclosing repo's.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "status", "--porcelain", "--", CLAUDE_DIR],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return set()
    if out.returncode != 0:
        return set()

    prefix = _git_show_prefix(repo)
    dirty: set[str] = set()
    for line in out.stdout.splitlines():
        if len(line) < 4:
            continue
        entry = line[3:]
        # A rename reports "old -> new"; the new path is the one on disk.
        if " -> " in entry:
            entry = entry.split(" -> ", 1)[1]
        entry = entry.strip().strip('"')
        if prefix and entry.startswith(prefix):
            entry = entry[len(prefix) :]
        dirty.add(entry)
    return dirty


def _is_dirty(rel_path: str, dirty: set[str]) -> bool:
    """True when ``rel_path`` is itself dirty or sits under a dirty directory."""
    if rel_path in dirty:
        return True
    return any(d.endswith("/") and rel_path.startswith(d) for d in dirty)


def scan_path_findings(
    kind: str, name: str, files: dict[str, str]
) -> list[PathFinding]:
    """Report text that names a path a provisioned session cannot follow."""
    findings: list[PathFinding] = []
    for file_path, text in sorted(files.items()):
        for lineno, line in enumerate(text.split("\n"), start=1):
            for marker in NON_PROVISIONABLE_PATH_MARKERS:
                if marker in line:
                    findings.append(
                        PathFinding(
                            kind=kind,
                            name=name,
                            file_path=file_path,
                            marker=marker,
                            line_number=lineno,
                        )
                    )
    return findings


def discover_corpus(source: Path) -> Corpus:
    """Enumerate every unit under ``<source>/.claude/``.

    Never assumes a count: the corpus is whatever the directories hold at the
    moment of the scan.
    """
    claude = source / CLAUDE_DIR
    if not claude.is_dir():
        raise CorpusError(
            f"No {CLAUDE_DIR}/ under {source} — point --source at the root of a "
            "config repo, not at its .claude directory"
        )

    head = git_head_commit(source)
    dirty = git_dirty_paths(source) if head else set()

    corpus = Corpus(head_commit=head)

    commands_dir = claude / "commands"
    if commands_dir.is_dir():
        for md in sorted(commands_dir.glob("*.md")):
            if md.name in IGNORED_FILE_NAMES or not md.is_file():
                continue
            name = md.stem
            rel = f"{COMMANDS_DIR}/{md.name}"
            files = {entrypoint_path(KIND_COMMAND, name): read_unit_text(md)}
            corpus.items.append(
                _build_item(
                    corpus,
                    kind=KIND_COMMAND,
                    name=name,
                    files=files,
                    source_path=rel,
                    head=head,
                    unit_dirty=_is_dirty(rel, dirty),
                )
            )

    skills_dir = claude / "skills"
    if skills_dir.is_dir():
        for skill in sorted(p for p in skills_dir.iterdir() if p.is_dir()):
            if skill.name in IGNORED_DIR_NAMES:
                continue
            files = {}
            unit_dirty = False
            for f in sorted(skill.rglob("*")):
                if not f.is_file() or f.name in IGNORED_FILE_NAMES:
                    continue
                if any(
                    part in IGNORED_DIR_NAMES for part in f.relative_to(skill).parts
                ):
                    continue
                rel_in_unit = f.relative_to(skill).as_posix()
                files[rel_in_unit] = read_unit_text(f)
                rel_in_repo = f"{SKILLS_DIR}/{skill.name}/{rel_in_unit}"
                unit_dirty = unit_dirty or _is_dirty(rel_in_repo, dirty)
            if not files:
                continue
            corpus.items.append(
                _build_item(
                    corpus,
                    kind=KIND_SKILL,
                    name=skill.name,
                    files=files,
                    # A skill is a DIRECTORY, so its provenance is one.
                    source_path=f"{SKILLS_DIR}/{skill.name}/",
                    head=head,
                    unit_dirty=unit_dirty,
                )
            )

    if not corpus.items:
        raise CorpusError(f"{claude} holds no commands and no skills")
    return corpus


def _build_item(
    corpus: Corpus,
    *,
    kind: str,
    name: str,
    files: dict[str, str],
    source_path: str,
    head: str | None,
    unit_dirty: bool,
) -> AgentTextUnitImportItem:
    """Assemble one candidate, recording its provenance and path findings."""
    if unit_dirty:
        corpus.dirty_units.append(f"{kind}/{name}")
    corpus.path_findings.extend(scan_path_findings(kind, name, files))
    return AgentTextUnitImportItem(
        kind=kind,
        name=name,
        files=files,
        # The corpus's human marker for a copy-source spec IS the leading
        # underscore; this is the machine-readable half of the same fact, and
        # the DB CHECK refuses the two disagreeing.
        is_invocable=not name.startswith("_"),
        source_path=source_path,
        # No commit honestly describes a dirty unit's bytes. Absence, never a
        # sentinel — the CHECK would refuse one and a consumer would have to
        # parse it.
        source_commit=None if unit_dirty else head,
    )


# =============================================================================
# Fetch-budget measurement
# =============================================================================


#: The runner's fetch budget for one corpus resolve, in seconds.
#: ``agent_commands/mod.rs:62`` ``FETCH_TIMEOUT``. Mirrored here so the report
#: states the throughput a real link has to sustain, not an abstract byte count.
FETCH_TIMEOUT_SECONDS = 4.0


@dataclass(frozen=True)
class WirePayload:
    """What one corpus resolve actually costs on the wire, all four ways.

    The runner fetches the corpus on the **spawn critical path** inside
    ``FETCH_TIMEOUT_SECONDS`` and resolution is fail-soft — a link too slow to
    finish degrades to cache and then to the runner's embedded defaults, so an
    oversized corpus does not error, it silently disappears. Plan
    ``2026-08-20-fleet-served-agent-skills`` Phase 5 requires that budget to be
    re-sized against a MEASURED payload before the corpus is imported, which is
    what these four numbers are for:

    * ``full`` / ``full_gzip`` — ``GET /api/v1/agent-text-units``, bodies
      included. What a cold client pays.
    * ``index`` / ``index_gzip`` — ``GET /api/v1/agent-text-units/index``, the
      metadata projection. What a warm client pays to learn whether it needs to
      pay anything else.

    Both gzip numbers are level 6, matching the ``GZipMiddleware`` configured in
    ``app/main.py``.
    """

    full: int
    full_gzip: int
    index: int
    index_gzip: int

    def throughput_kbs(self, payload_bytes: int) -> float:
        """KB/s a link must sustain to deliver ``payload_bytes`` in the budget."""
        return payload_bytes / FETCH_TIMEOUT_SECONDS / 1024


def _gzip_bytes(payload: bytes) -> int:
    """Size after gzip level 6 — the level ``app/main.py`` configures."""
    return len(gzip.compress(payload, compresslevel=6))


def measure_wire_payload(items: list[AgentTextUnitImportItem]) -> WirePayload:
    """Serialize both list projections and measure them, plain and gzipped.

    Builds the ACTUAL response objects rather than estimating from the corpus's
    on-disk bytes: JSON escaping and the per-unit envelope are real bytes on the
    spawn critical path, and the point of the exercise is that the budget be
    sized against what crosses the wire.
    """
    now = datetime.now(UTC)
    responses = [
        AgentTextUnitResponse(
            id=str(uuid4()),
            organization_id=None,
            created_by_user_id=None,
            kind=item.kind,
            name=item.name,
            files=item.files,
            entrypoint=entrypoint_path(item.kind, item.name),
            checksum=f"sha256-{'0' * 64}",
            is_shared=item.is_shared,
            is_invocable=item.is_invocable,
            current_version=1,
            source="fleet",
            source_path=item.source_path,
            source_commit=item.source_commit,
            created_at=now,
            updated_at=now,
        )
        for item in items
    ]
    pagination = Pagination(total=len(items), limit=500, offset=0, has_more=False)

    full = (
        AgentTextUnitListResponse(items=responses, pagination=pagination)
        .model_dump_json()
        .encode("utf-8")
    )
    index = (
        AgentTextUnitIndexResponse(
            items=[
                AgentTextUnitMetadata(
                    id=r.id,
                    organization_id=r.organization_id,
                    kind=r.kind,
                    name=r.name,
                    entrypoint=r.entrypoint,
                    checksum=r.checksum,
                    file_paths=sorted(r.files),
                    byte_count=sum(len(t.encode("utf-8")) for t in r.files.values()),
                    is_shared=r.is_shared,
                    is_invocable=r.is_invocable,
                    current_version=r.current_version,
                    source=r.source,
                    source_path=r.source_path,
                    source_commit=r.source_commit,
                    created_at=r.created_at,
                    updated_at=r.updated_at,
                )
                for r in responses
            ],
            pagination=pagination,
        )
        .model_dump_json()
        .encode("utf-8")
    )

    return WirePayload(
        full=len(full),
        full_gzip=_gzip_bytes(full),
        index=len(index),
        index_gzip=_gzip_bytes(index),
    )


# =============================================================================
# Reporting
# =============================================================================


def format_report(
    corpus: Corpus,
    report: AgentTextUnitImportReport,
    payload: WirePayload,
) -> str:
    """The human report. Counts by kind, bytes, and every unit that changed."""
    lines: list[str] = []
    layer = (
        f"account {report.organization_id}"
        if report.organization_id
        else "fleet default (organization_id IS NULL)"
    )
    mode = "DRY RUN — nothing written" if report.dry_run else "APPLIED"
    lines.append(f"agent-text-unit import: {mode}")
    lines.append(f"  layer:  {layer}")
    lines.append(
        "  source commit: " + (corpus.head_commit or "<none — not a git checkout>")
    )

    lines.append("")
    lines.append("Corpus read from disk (enumerated, never assumed):")
    for kind, items in sorted(corpus.by_kind().items()):
        kind_bytes = sum(
            len(t.encode("utf-8")) for i in items for t in i.files.values()
        )
        kind_files = sum(len(i.files) for i in items)
        non_invocable = [i.name for i in items if not i.is_invocable]
        lines.append(
            f"  {kind:<8} {len(items):>4} units  {kind_files:>4} files  "
            f"{kind_bytes:>9,} bytes"
        )
        if non_invocable:
            lines.append(
                "           non-invocable (copy-source specs): "
                + ", ".join(sorted(non_invocable))
            )
    lines.append(
        f"  {'TOTAL':<8} {len(corpus.items):>4} units  {corpus.file_count():>4} "
        f"files  {corpus.total_bytes():>9,} bytes"
    )

    lines.append("")
    lines.append("Outcome:")
    lines.append(f"  created:              {report.created}")
    lines.append(f"  updated (new version): {report.updated}")
    lines.append(f"  unchanged:            {report.unchanged}")
    lines.append(f"  provenance refreshed: {report.provenance_refreshed}")
    lines.append(f"  versions written:     {report.versions_written}")

    changed = [
        r
        for r in report.results
        if r.outcome in (ImportOutcome.CREATED, ImportOutcome.UPDATED)
    ]
    if changed:
        lines.append("")
        lines.append(
            "Units this run would write:" if report.dry_run else "Units written:"
        )
        for r in sorted(changed, key=lambda r: (r.kind, r.name)):
            version = (
                f"v{r.new_version}"
                if r.outcome is ImportOutcome.CREATED
                else f"v{r.previous_version} -> v{r.new_version}"
            )
            invocable = "" if r.is_invocable else "  [non-invocable]"
            lines.append(
                f"  {r.outcome.value:<9} {r.kind}/{r.name} "
                f"({r.file_count} file(s), {r.byte_count:,} bytes) {version}"
                f"{invocable}"
            )

    if corpus.dirty_units:
        lines.append("")
        lines.append(
            f"Provenance withheld ({len(corpus.dirty_units)} unit(s) dirty in the "
            "source tree — source_commit=NULL, no commit describes these bytes):"
        )
        for u in sorted(corpus.dirty_units):
            lines.append(f"  {u}")

    if corpus.path_findings:
        lines.append("")
        lines.append(
            f"Non-provisionable path references ({len(corpus.path_findings)}). A "
            "session provisioned on a device with no config-repo checkout cannot "
            "follow these:"
        )
        for f in corpus.path_findings:
            lines.append(
                f"  {f.kind}/{f.name}:{f.file_path}:{f.line_number} -> {f.marker}"
            )

    lines.append("")
    lines.append(
        f"Fetch budget (agent_commands/mod.rs FETCH_TIMEOUT = "
        f"{FETCH_TIMEOUT_SECONDS:g}s, one GET):"
    )
    lines.append(
        f"  {'projection':<28} {'bytes':>11}  {'KB/s needed':>12}   share of full"
    )
    for label, size in (
        ("full list", payload.full),
        ("full list, gzip -6", payload.full_gzip),
        ("index (no files)", payload.index),
        ("index, gzip -6", payload.index_gzip),
    ):
        share = size / payload.full * 100 if payload.full else 0.0
        lines.append(
            f"  {label:<28} {size:>11,}  "
            f"{payload.throughput_kbs(size):>12,.0f}   {share:>6.1f}%"
        )
    return "\n".join(lines)


def report_as_json(
    corpus: Corpus,
    report: AgentTextUnitImportReport,
    payload: WirePayload,
) -> str:
    return json.dumps(
        {
            "dry_run": report.dry_run,
            "organization_id": report.organization_id,
            "source_commit": corpus.head_commit,
            "corpus": {
                "units": len(corpus.items),
                "files": corpus.file_count(),
                "bytes": corpus.total_bytes(),
                "by_kind": {
                    kind: {
                        "units": len(items),
                        "files": sum(len(i.files) for i in items),
                        "bytes": sum(
                            len(t.encode("utf-8"))
                            for i in items
                            for t in i.files.values()
                        ),
                        "non_invocable": sorted(
                            i.name for i in items if not i.is_invocable
                        ),
                    }
                    for kind, items in sorted(corpus.by_kind().items())
                },
            },
            "outcome": {
                "created": report.created,
                "updated": report.updated,
                "unchanged": report.unchanged,
                "provenance_refreshed": report.provenance_refreshed,
                "versions_written": report.versions_written,
            },
            "dirty_units": sorted(corpus.dirty_units),
            "path_findings": [
                {
                    "kind": f.kind,
                    "name": f.name,
                    "file": f.file_path,
                    "line": f.line_number,
                    "marker": f.marker,
                }
                for f in corpus.path_findings
            ],
            "fetch_budget": {
                "timeout_seconds": FETCH_TIMEOUT_SECONDS,
                "full_bytes": payload.full,
                "full_gzip_bytes": payload.full_gzip,
                "index_bytes": payload.index,
                "index_gzip_bytes": payload.index_gzip,
                "kbs_required": {
                    "full": round(payload.throughput_kbs(payload.full), 1),
                    "full_gzip": round(payload.throughput_kbs(payload.full_gzip), 1),
                    "index": round(payload.throughput_kbs(payload.index), 1),
                    "index_gzip": round(payload.throughput_kbs(payload.index_gzip), 1),
                },
            },
            "results": [r.model_dump(mode="json") for r in report.results],
        },
        indent=2,
    )


# =============================================================================
# Entry point
# =============================================================================


async def run_import(
    *,
    source: Path,
    database_url: str,
    organization_id: UUID | None,
    dry_run: bool,
    change_description: str | None,
) -> tuple[Corpus, AgentTextUnitImportReport, WirePayload]:
    corpus = discover_corpus(source)
    payload = measure_wire_payload(corpus.items)

    engine = create_async_engine(database_url, echo=False)
    try:
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with maker() as session:
            report = await AgentTextUnitService().import_units(
                session,
                organization_id,
                corpus.items,
                user_id=None,
                change_description=change_description,
                dry_run=dry_run,
            )
    finally:
        await engine.dispose()
    return corpus, report, payload


def _async_dsn(url: str) -> str:
    """Force the asyncpg driver — the app's DSN is often the sync spelling."""
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    return url


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Import a .claude/ corpus into project.agent_text_units, idempotently."
        )
    )
    parser.add_argument(
        "--source",
        required=True,
        type=Path,
        help="Root of the config repo holding .claude/ (NOT the .claude dir).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compare against the store and report; write nothing.",
    )
    parser.add_argument(
        "--organization-id",
        type=UUID,
        default=None,
        help=(
            "Write that account's override layer. Omit for the fleet-default "
            "layer (organization_id IS NULL), which is the normal target."
        ),
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Override the DSN. Defaults to the app settings' DATABASE_URL.",
    )
    parser.add_argument(
        "--change-description",
        default=None,
        help="Recorded on every version this run appends.",
    )
    parser.add_argument(
        "--strict-paths",
        action="store_true",
        help=(
            "Exit non-zero when a unit names a path a provisioned session "
            "cannot follow (they are always reported)."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the report as JSON instead of prose.",
    )
    args = parser.parse_args(argv)

    if args.database_url:
        dsn = _async_dsn(args.database_url)
    else:
        from app.core.config import settings

        dsn = _async_dsn(str(settings.DATABASE_URL))

    try:
        corpus, report, payload = asyncio.run(
            run_import(
                source=args.source,
                database_url=dsn,
                organization_id=args.organization_id,
                dry_run=args.dry_run,
                change_description=args.change_description,
            )
        )
    except (CorpusError, AgentTextUnitValidationError) as exc:
        print(f"import_agent_text_units: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(report_as_json(corpus, report, payload))
    else:
        print(format_report(corpus, report, payload))

    if args.strict_paths and corpus.path_findings:
        print(
            f"import_agent_text_units: STRICT failure — "
            f"{len(corpus.path_findings)} non-provisionable path reference(s)",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
