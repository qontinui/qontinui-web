"""Tests for the idempotent ``.claude/`` corpus importer.

Phase 5 of plan ``2026-08-20-fleet-served-agent-skills``. Two halves:

* ``AgentTextUnitService.import_units`` against the real test database — the
  layer that owns "did the text change?", and therefore owns whether a re-import
  is a no-op or a wall of spurious version bumps;
* ``scripts/import_agent_text_units.py``'s pure corpus discovery — reading a
  ``.claude/`` tree off disk, normalizing it, and deciding provenance.

**The load-bearing test is ``test_reimport_writes_zero_versions``**, and its
fixture is chosen, not arbitrary. It carries a three-file skill whose paths sort
DIFFERENTLY under the two orders the two sides of the comparison arrive in:

* byte order (what ``agent-text-unit-files/v1`` mandates) —
  ``SKILL.md`` < ``set-label-selftest.sh`` < ``set-label.sh``, because ``-``
  (0x2D) precedes ``.`` (0x2E);
* JSONB's own key order (what a row read back from Postgres yields) — shortest
  first, so ``SKILL.md`` < ``set-label.sh`` < ``set-label-selftest.sh``.

A digest that did not sort canonically would agree with itself on the way in and
disagree on the way out, and every re-import would bump every multi-file skill.
That fixture is what makes the test fail when the canonicalization is broken
rather than pass vacuously — it is copied from the real ``coord-pr-label``
skill, which is exactly the shape the fleet ships.
"""

from __future__ import annotations

import subprocess
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.agent_text_unit import (
    KIND_COMMAND,
    KIND_SKILL,
    AgentTextUnit,
    AgentTextUnitVersion,
)
from app.services.agent_text_unit_service import (
    AgentTextUnitCreate,
    AgentTextUnitImportItem,
    AgentTextUnitService,
    AgentTextUnitUpdate,
    AgentTextUnitValidationError,
    compute_files_checksum,
    validate_provenance,
    validate_unit_name,
)
from scripts import import_agent_text_units as importer

# A real 40-char SHA shape. The DB CHECK refuses anything else.
COMMIT_A = "a" * 40
COMMIT_B = "b" * 40


def _command_item(
    name: str = "vet-plan", body: str = "# vet\n"
) -> AgentTextUnitImportItem:
    return AgentTextUnitImportItem(
        kind=KIND_COMMAND,
        name=name,
        files={f"{name}.md": body},
        is_invocable=not name.startswith("_"),
        source_path=f".claude/commands/{name}.md",
        source_commit=COMMIT_A,
    )


def _skill_item(
    name: str = "coord-pr-label", marker: str = "v1"
) -> AgentTextUnitImportItem:
    """The three-file shape whose byte order and JSONB order disagree.

    See the module docstring: this is what makes the idempotency test bite.
    """
    return AgentTextUnitImportItem(
        kind=KIND_SKILL,
        name=name,
        # Inserted in the order the real importer produces — `sorted()` over the
        # directory listing, i.e. byte order — which is NOT the order Postgres
        # gives the map back in. That mismatch is the whole point of the
        # fixture; matching the two would make the test pass vacuously.
        files={
            "SKILL.md": f"# {name} {marker}\n",
            "set-label-selftest.sh": f"#!/usr/bin/env bash\necho selftest {marker}\n",
            "set-label.sh": f"#!/usr/bin/env bash\necho {marker}\n",
        },
        source_path=f".claude/skills/{name}/",
        source_commit=COMMIT_A,
    )


def _corpus(marker: str = "v1") -> list[AgentTextUnitImportItem]:
    """A small corpus with every shape the real one has: a command, a
    multi-file skill, and a copy-source spec."""
    return [
        _command_item("vet-plan", f"# vet {marker}\n"),
        _command_item("implement-plan", f"# implement {marker}\n"),
        AgentTextUnitImportItem(
            kind=KIND_COMMAND,
            name="_gate-registration",
            files={"_gate-registration.md": f"# spec {marker}\n"},
            is_invocable=False,
            source_path=".claude/commands/_gate-registration.md",
            source_commit=COMMIT_A,
        ),
        _skill_item("coord-pr-label", marker),
    ]


@pytest_asyncio.fixture
async def imp_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """A committing session over the test engine, cleaned up afterwards.

    Both layers are swept: the importer's normal target is the fleet-default
    layer (``organization_id IS NULL``), which no org filter would reach.
    """
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session
        await session.rollback()
        await session.execute(
            delete(AgentTextUnit).where(
                or_(
                    AgentTextUnit.organization_id.is_(None),
                    AgentTextUnit.name.like("imp-%"),
                )
            )
        )
        await session.commit()


@pytest.fixture
def service() -> AgentTextUnitService:
    return AgentTextUnitService()


async def _version_count(db: AsyncSession) -> int:
    """Total version rows across the fleet layer."""
    result = await db.execute(
        select(func.count())
        .select_from(AgentTextUnitVersion)
        .join(
            AgentTextUnit,
            AgentTextUnit.id == AgentTextUnitVersion.agent_text_unit_id,
        )
        .where(AgentTextUnit.organization_id.is_(None))
    )
    return result.scalar() or 0


def _forget(db: AsyncSession) -> None:
    """Drop the identity map so the next read genuinely hits Postgres.

    Load bearing, not hygiene. SQLAlchemy hands back the instance it already
    holds, carrying the Python ``dict`` this process built, in the order this
    process built it. Every assertion about JSONB's key order — and the
    idempotency test that depends on the digest surviving that order — would
    then be comparing a dict with itself, and would still pass with the
    canonical sort removed. A re-import is a new process; these tests have to
    be one too.
    """
    db.expunge_all()


async def _unit(db: AsyncSession, kind: str, name: str) -> AgentTextUnit:
    _forget(db)
    result = await db.execute(
        select(AgentTextUnit).where(
            AgentTextUnit.organization_id.is_(None),
            AgentTextUnit.kind == kind,
            AgentTextUnit.name == name,
        )
    )
    unit = result.scalar_one_or_none()
    assert unit is not None, f"{kind}/{name} not stored"
    return unit


# =============================================================================
# Idempotence — the property the whole phase turns on
# =============================================================================


@pytest.mark.asyncio
class TestIdempotence:
    async def test_first_import_creates_every_unit_at_v1(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        items = _corpus()
        report = await service.import_units(imp_db, None, items)

        assert report.created == len(items)
        assert report.updated == 0
        assert report.unchanged == 0
        assert report.versions_written == len(items)
        assert all(r.new_version == 1 for r in report.results)
        assert await _version_count(imp_db) == len(items)

    async def test_reimport_writes_zero_versions(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        """THE test. A second pass over an unchanged corpus writes nothing.

        Asserted three ways, because the report agreeing with itself proves
        nothing: the report's own counters, the total version-row count in the
        database, and every unit's head pointer.
        """
        items = _corpus()
        first = await service.import_units(imp_db, None, items)
        assert first.versions_written == len(items)
        versions_after_first = await _version_count(imp_db)

        # A fresh item list with identical content, read back through a cold
        # identity map — the importer must key off the TEXT, not off object
        # identity, a cached digest, or the key order this process happened to
        # build.
        _forget(imp_db)
        second = await service.import_units(imp_db, None, _corpus())

        assert second.created == 0
        assert second.updated == 0
        assert second.unchanged == len(items)
        assert second.versions_written == 0
        assert second.provenance_refreshed == 0
        assert await _version_count(imp_db) == versions_after_first
        for item in items:
            unit = await _unit(imp_db, item.kind, item.name)
            assert unit.current_version == 1

    async def test_reimport_survives_the_json_key_reordering(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        """The multi-file skill specifically, read back out of Postgres.

        The stored map comes back in JSONB's key order, which for this unit is
        NOT byte order. If the canonical digest did not sort, this is the unit
        that would bump on every run.
        """
        skill = _skill_item()
        await service.import_units(imp_db, None, [skill])

        stored = await _unit(imp_db, KIND_SKILL, skill.name)
        stored_order = list(dict(stored.files).keys())
        candidate_order = list(skill.files)
        # The guard that keeps this test from passing vacuously: the two maps
        # being compared must actually arrive in different orders. If a future
        # fixture edit makes them agree, the canonical sort stops being what the
        # test exercises and this says so instead of going quietly green.
        assert stored_order != candidate_order, (
            "fixture no longer exercises the reordering it exists for — pick "
            f"paths whose JSONB order differs from scan order (got {stored_order})"
        )
        assert compute_files_checksum(dict(stored.files)) == compute_files_checksum(
            skill.files
        )

        _forget(imp_db)
        again = await service.import_units(imp_db, None, [_skill_item()])
        assert again.versions_written == 0
        assert again.unchanged == 1

    async def test_changed_text_appends_exactly_one_version(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, _corpus("v1"))
        before = await _version_count(imp_db)

        edited = _corpus("v1")
        edited[0] = _command_item("vet-plan", "# vet CHANGED\n")
        _forget(imp_db)
        report = await service.import_units(imp_db, None, edited)

        assert report.updated == 1
        assert report.unchanged == len(edited) - 1
        assert report.versions_written == 1
        assert await _version_count(imp_db) == before + 1

        unit = await _unit(imp_db, KIND_COMMAND, "vet-plan")
        assert unit.current_version == 2
        assert unit.files == {"vet-plan.md": "# vet CHANGED\n"}

    async def test_a_null_stored_checksum_is_repaired_not_bumped(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        """``atu_01`` nulls the checksum column, so this is the state every
        pre-existing row is in on the day the importer first runs.

        Comparing against the stored COLUMN would call that a change and bump
        the whole corpus once for nothing. The digest is recomputed from the
        stored files instead, so the column is quietly repaired.
        """
        item = _command_item()
        await service.import_units(imp_db, None, [item])
        unit = await _unit(imp_db, KIND_COMMAND, item.name)
        unit.checksum = None
        await imp_db.commit()
        before = await _version_count(imp_db)

        _forget(imp_db)
        report = await service.import_units(imp_db, None, [_command_item()])

        assert report.unchanged == 1
        assert report.versions_written == 0
        assert await _version_count(imp_db) == before
        repaired = await _unit(imp_db, KIND_COMMAND, item.name)
        assert repaired.checksum == compute_files_checksum(item.files)

    async def test_crlf_only_difference_is_not_a_change(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        """The digest is CR-insensitive by definition, so a corpus that
        round-tripped through a Windows checkout must not bump."""
        await service.import_units(imp_db, None, [_command_item("vet-plan", "a\nb\n")])
        before = await _version_count(imp_db)

        _forget(imp_db)
        report = await service.import_units(
            imp_db, None, [_command_item("vet-plan", "a\r\nb\r\n")]
        )
        assert report.unchanged == 1
        assert await _version_count(imp_db) == before

    async def test_dry_run_writes_nothing_but_reports_everything(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        items = _corpus()
        report = await service.import_units(imp_db, None, items, dry_run=True)

        assert report.dry_run is True
        assert report.created == len(items)
        assert report.versions_written == len(items)
        assert await _version_count(imp_db) == 0
        result = await imp_db.execute(
            select(func.count())
            .select_from(AgentTextUnit)
            .where(AgentTextUnit.organization_id.is_(None))
        )
        assert (result.scalar() or 0) == 0

    async def test_dry_run_over_an_existing_corpus_reports_the_diff(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, _corpus("v1"))
        edited = _corpus("v1")
        edited[0] = _command_item("vet-plan", "# vet CHANGED\n")
        edited.append(_command_item("brand-new", "# new\n"))

        _forget(imp_db)
        report = await service.import_units(imp_db, None, edited, dry_run=True)

        assert report.created == 1
        assert report.updated == 1
        assert report.unchanged == len(edited) - 2
        assert await _version_count(imp_db) == len(_corpus("v1"))


# =============================================================================
# Copy-source specs
# =============================================================================


@pytest.mark.asyncio
class TestCopySourceSpecs:
    async def test_underscore_units_are_imported_non_invocable(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, _corpus())
        spec = await _unit(imp_db, KIND_COMMAND, "_gate-registration")
        assert spec.is_invocable is False
        # Carried, not dropped: other units paste from it.
        assert spec.files["_gate-registration.md"].strip()

    async def test_importing_a_spec_as_invocable_is_refused(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        bad = AgentTextUnitImportItem(
            kind=KIND_COMMAND,
            name="_loop-control",
            files={"_loop-control.md": "# spec\n"},
            is_invocable=True,
        )
        with pytest.raises(AgentTextUnitValidationError, match="copy-source spec"):
            await service.import_units(imp_db, None, [bad])

    async def test_the_database_refuses_it_too(self, imp_db: AsyncSession) -> None:
        """Not a convention: the CHECK is what makes it impossible."""
        imp_db.add(
            AgentTextUnit(
                organization_id=None,
                kind=KIND_COMMAND,
                name="_loop-control",
                files={"_loop-control.md": "# spec\n"},
                is_invocable=True,
                current_version=1,
            )
        )
        with pytest.raises(IntegrityError):
            await imp_db.commit()
        await imp_db.rollback()


# =============================================================================
# Provenance
# =============================================================================


@pytest.mark.asyncio
class TestProvenance:
    async def test_provenance_is_recorded_on_create(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, _corpus())
        cmd = await _unit(imp_db, KIND_COMMAND, "vet-plan")
        assert cmd.source_path == ".claude/commands/vet-plan.md"
        assert cmd.source_commit == COMMIT_A
        skill = await _unit(imp_db, KIND_SKILL, "coord-pr-label")
        # A skill is a directory, so its provenance is one.
        assert skill.source_path == ".claude/skills/coord-pr-label/"

    async def test_a_moved_commit_refreshes_in_place_without_a_version(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        """The source repo moves for unrelated reasons all the time. Recording
        the newer commit must not be indistinguishable from an edit."""
        await service.import_units(imp_db, None, [_command_item()])
        before = await _version_count(imp_db)

        moved = _command_item()
        moved.source_commit = COMMIT_B
        _forget(imp_db)
        report = await service.import_units(imp_db, None, [moved])

        assert report.unchanged == 1
        assert report.versions_written == 0
        assert report.provenance_refreshed == 1
        assert await _version_count(imp_db) == before
        assert (await _unit(imp_db, KIND_COMMAND, "vet-plan")).source_commit == COMMIT_B

    async def test_a_dirty_unit_records_no_commit(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        item = _command_item()
        item.source_commit = None
        await service.import_units(imp_db, None, [item])
        stored = await _unit(imp_db, KIND_COMMAND, item.name)
        assert stored.source_path == ".claude/commands/vet-plan.md"
        assert stored.source_commit is None

    async def test_a_console_save_clears_provenance(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        """Once edited here the text is no longer a copy of that source, and a
        stale provenance would be a claim nobody can check."""
        await service.import_units(imp_db, None, [_command_item()])
        await service.upsert_unit(
            imp_db,
            None,
            AgentTextUnitCreate(
                kind=KIND_COMMAND,
                name="vet-plan",
                files={"vet-plan.md": "# edited in the console\n"},
            ),
            user_id=None,
        )
        stored = await _unit(imp_db, KIND_COMMAND, "vet-plan")
        assert stored.source_path is None
        assert stored.source_commit is None

    async def test_a_patch_of_files_clears_provenance(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, [_command_item()])
        await service.update_unit(
            imp_db,
            None,
            KIND_COMMAND,
            "vet-plan",
            AgentTextUnitUpdate(files={"vet-plan.md": "# patched\n"}),
            user_id=None,
        )
        stored = await _unit(imp_db, KIND_COMMAND, "vet-plan")
        assert stored.source_path is None

    async def test_a_metadata_only_patch_leaves_provenance_alone(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, [_command_item()])
        await service.update_unit(
            imp_db,
            None,
            KIND_COMMAND,
            "vet-plan",
            AgentTextUnitUpdate(is_shared=True),
            user_id=None,
        )
        stored = await _unit(imp_db, KIND_COMMAND, "vet-plan")
        assert stored.source_commit == COMMIT_A

    async def test_a_revert_clears_provenance(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, [_command_item()])
        await service.import_units(
            imp_db, None, [_command_item("vet-plan", "# changed\n")]
        )
        await service.revert_to_version(
            imp_db, None, KIND_COMMAND, "vet-plan", 1, user_id=None
        )
        stored = await _unit(imp_db, KIND_COMMAND, "vet-plan")
        assert stored.source_path is None
        assert stored.source_commit is None

    async def test_the_response_carries_both_fields(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        await service.import_units(imp_db, None, [_command_item()])
        response = await service.get_unit(imp_db, None, KIND_COMMAND, "vet-plan")
        assert response.source_path == ".claude/commands/vet-plan.md"
        assert response.source_commit == COMMIT_A
        # The ADJACENT field, which means something else entirely.
        assert response.source == "fleet"

    async def test_the_database_refuses_a_non_sha_commit(
        self, imp_db: AsyncSession
    ) -> None:
        imp_db.add(
            AgentTextUnit(
                organization_id=None,
                kind=KIND_COMMAND,
                name="imp-badsha",
                files={"imp-badsha.md": "# x\n"},
                source_commit="dirty",
                current_version=1,
            )
        )
        with pytest.raises(IntegrityError):
            await imp_db.commit()
        await imp_db.rollback()


class TestProvenanceValidation:
    """The write boundary, with no database in the way."""

    @pytest.mark.parametrize(
        "path,commit",
        [
            ("/abs/.claude/commands/x.md", None),
            ("D:/qontinui-root/.claude/commands/x.md", None),
            (".claude/../etc/passwd", None),
            (".claude\\commands\\x.md", None),
            ("   ", None),
            (None, "abc123"),
            (None, "A" * 40),
            (None, "a" * 39),
        ],
    )
    def test_provenance_validation_refusals(
        self, path: str | None, commit: str | None
    ) -> None:
        with pytest.raises(AgentTextUnitValidationError):
            validate_provenance(path, commit)

    def test_provenance_validation_accepts_the_real_shapes(self) -> None:
        validate_provenance(".claude/commands/vet-plan.md", COMMIT_A)
        validate_provenance(".claude/skills/coord-revive/", None)
        validate_provenance(None, None)


# =============================================================================
# Import-set hygiene + layering
# =============================================================================


@pytest.mark.asyncio
class TestImportSet:
    async def test_a_duplicate_unit_in_one_set_is_refused(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        with pytest.raises(AgentTextUnitValidationError, match="Duplicate"):
            await service.import_units(imp_db, None, [_command_item(), _command_item()])

    async def test_validation_runs_before_any_write(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        """A corpus import is one transaction, not N independent writes."""
        bad = AgentTextUnitImportItem(
            kind=KIND_COMMAND,
            name="imp-traversal",
            files={"../escape.md": "x", "imp-traversal.md": "y"},
        )
        with pytest.raises(AgentTextUnitValidationError):
            await service.import_units(imp_db, None, [_command_item(), bad])
        result = await imp_db.execute(
            select(func.count())
            .select_from(AgentTextUnit)
            .where(AgentTextUnit.organization_id.is_(None))
        )
        assert (result.scalar() or 0) == 0

    async def test_the_fleet_layer_is_the_default_target(
        self, imp_db: AsyncSession, service: AgentTextUnitService
    ) -> None:
        report = await service.import_units(imp_db, None, [_command_item()])
        assert report.organization_id is None
        assert (await _unit(imp_db, KIND_COMMAND, "vet-plan")).organization_id is None


# =============================================================================
# Corpus discovery (no database)
# =============================================================================


def _write(root: Path, rel: str, text: str, *, newline: str = "\n") -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.replace("\n", newline).encode("utf-8"))
    return path


def _make_corpus_tree(root: Path) -> None:
    _write(root, ".claude/commands/vet-plan.md", "# vet\nbody\n")
    _write(root, ".claude/commands/_loop-control.md", "# spec\n")
    _write(root, ".claude/skills/coord-revive/SKILL.md", "# revive\n")
    _write(root, ".claude/skills/coord-revive/coord-revive.sh", "#!/bin/bash\necho x\n")
    _write(root, ".claude/skills/preflight/SKILL.md", "# preflight\n")


class TestCorpusDiscovery:
    def test_it_enumerates_both_kinds(self, tmp_path: Path) -> None:
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)

        by_kind = corpus.by_kind()
        assert sorted(i.name for i in by_kind[KIND_COMMAND]) == [
            "_loop-control",
            "vet-plan",
        ]
        assert sorted(i.name for i in by_kind[KIND_SKILL]) == [
            "coord-revive",
            "preflight",
        ]
        assert corpus.file_count() == 5

    def test_a_command_is_the_single_file_case(self, tmp_path: Path) -> None:
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        cmd = next(i for i in corpus.items if i.name == "vet-plan")
        assert cmd.files == {"vet-plan.md": "# vet\nbody\n"}
        assert cmd.source_path == ".claude/commands/vet-plan.md"

    def test_a_skill_carries_its_siblings_relative_to_its_own_dir(
        self, tmp_path: Path
    ) -> None:
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        skill = next(i for i in corpus.items if i.name == "coord-revive")
        assert sorted(skill.files) == ["SKILL.md", "coord-revive.sh"]
        assert skill.source_path == ".claude/skills/coord-revive/"

    def test_underscore_units_come_back_non_invocable(self, tmp_path: Path) -> None:
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        spec = next(i for i in corpus.items if i.name == "_loop-control")
        assert spec.is_invocable is False
        assert all(i.is_invocable for i in corpus.items if not i.name.startswith("_"))

    def test_crlf_is_normalized_to_lf(self, tmp_path: Path) -> None:
        """A `.sh` provisioned with CRLF fails under bash in ways that read as
        a logic bug, and the corpus is checked out on Windows."""
        _make_corpus_tree(tmp_path)
        _write(
            tmp_path,
            ".claude/skills/coord-revive/coord-revive.sh",
            "#!/bin/bash\necho x\n",
            newline="\r\n",
        )
        corpus = importer.discover_corpus(tmp_path)
        skill = next(i for i in corpus.items if i.name == "coord-revive")
        assert "\r" not in skill.files["coord-revive.sh"]

    def test_a_non_utf8_file_is_an_error_not_a_skip(self, tmp_path: Path) -> None:
        """The plan's falsification condition: a file the model cannot carry
        must stop the import, not vanish from it."""
        _make_corpus_tree(tmp_path)
        (tmp_path / ".claude/skills/preflight/logo.bin").write_bytes(
            b"\xff\xfe\x00\x01"
        )
        with pytest.raises(importer.CorpusError):
            importer.discover_corpus(tmp_path)

    def test_an_empty_tree_is_an_error(self, tmp_path: Path) -> None:
        (tmp_path / ".claude").mkdir()
        with pytest.raises(importer.CorpusError):
            importer.discover_corpus(tmp_path)

    def test_a_missing_claude_dir_says_so(self, tmp_path: Path) -> None:
        with pytest.raises(importer.CorpusError, match=".claude"):
            importer.discover_corpus(tmp_path)

    def test_debris_is_not_corpus_text(self, tmp_path: Path) -> None:
        _make_corpus_tree(tmp_path)
        (tmp_path / ".claude/skills/preflight/.DS_Store").write_bytes(b"\x00junk")
        corpus = importer.discover_corpus(tmp_path)
        skill = next(i for i in corpus.items if i.name == "preflight")
        assert sorted(skill.files) == ["SKILL.md"]

    def test_every_discovered_name_passes_the_store_boundary(
        self, tmp_path: Path
    ) -> None:
        _make_corpus_tree(tmp_path)
        for item in importer.discover_corpus(tmp_path).items:
            validate_unit_name(item.name)

    def test_non_provisionable_paths_are_reported_not_rewritten(
        self, tmp_path: Path
    ) -> None:
        """Rewriting would make the stored text differ from the source the
        provenance claims. Reporting lets a gate refuse it instead."""
        _make_corpus_tree(tmp_path)
        _write(
            tmp_path,
            ".claude/skills/preflight/SKILL.md",
            "# preflight\nRun bash "
            "<workspace-root>/qontinui-claude-config/.claude/skills/preflight/x.sh\n",
        )
        corpus = importer.discover_corpus(tmp_path)

        assert [f.name for f in corpus.path_findings] == ["preflight"]
        finding = corpus.path_findings[0]
        assert finding.marker == "qontinui-claude-config/.claude"
        assert finding.line_number == 2
        # The text is carried through unchanged.
        skill = next(i for i in corpus.items if i.name == "preflight")
        assert "qontinui-claude-config/.claude" in skill.files["SKILL.md"]

    def test_a_clean_tree_stamps_head_on_every_unit(self, tmp_path: Path) -> None:
        _init_repo(tmp_path)
        _make_corpus_tree(tmp_path)
        _git(tmp_path, "add", "-A")
        _git(tmp_path, "commit", "-m", "corpus")

        corpus = importer.discover_corpus(tmp_path)
        assert corpus.head_commit is not None
        assert corpus.dirty_units == []
        assert all(i.source_commit == corpus.head_commit for i in corpus.items)

    def test_dirtiness_is_decided_per_unit_not_per_tree(self, tmp_path: Path) -> None:
        """A tree that is dirty somewhere else must not strip provenance from
        every unit — only from the ones whose own bytes no commit describes."""
        _init_repo(tmp_path)
        _make_corpus_tree(tmp_path)
        _git(tmp_path, "add", "-A")
        _git(tmp_path, "commit", "-m", "corpus")
        _write(tmp_path, ".claude/commands/vet-plan.md", "# vet EDITED\n")

        corpus = importer.discover_corpus(tmp_path)
        by_name = {i.name: i for i in corpus.items}
        assert corpus.dirty_units == ["command/vet-plan"]
        assert by_name["vet-plan"].source_commit is None
        assert by_name["coord-revive"].source_commit == corpus.head_commit

    def test_an_untracked_unit_gets_no_commit(self, tmp_path: Path) -> None:
        _init_repo(tmp_path)
        _make_corpus_tree(tmp_path)
        _git(tmp_path, "add", "-A")
        _git(tmp_path, "commit", "-m", "corpus")
        _write(tmp_path, ".claude/commands/brand-new.md", "# new\n")

        corpus = importer.discover_corpus(tmp_path)
        by_name = {i.name: i for i in corpus.items}
        assert by_name["brand-new"].source_commit is None
        assert by_name["vet-plan"].source_commit == corpus.head_commit

    def test_a_non_git_source_records_no_commit_anywhere(self, tmp_path: Path) -> None:
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        assert corpus.head_commit is None
        assert all(i.source_commit is None for i in corpus.items)

    def test_the_measured_payload_exceeds_the_on_disk_bytes(
        self, tmp_path: Path
    ) -> None:
        """JSON escaping and the per-unit envelope are real bytes on the spawn
        critical path, so the fetch budget must be sized against this number and
        not against the corpus's on-disk size."""
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        payload = importer.measure_wire_payload(corpus.items)
        assert payload.full > corpus.total_bytes()

    def test_the_index_projection_carries_no_body_text(self, tmp_path: Path) -> None:
        """The measured index must be smaller than the measured full listing by
        exactly the corpus text, and must contain none of it.

        Asserted as "smaller by at least the on-disk bytes" rather than as a
        ratio: on this deliberately tiny fixture the per-unit metadata envelope
        dwarfs four one-line files, so a percentage bound here would encode the
        fixture's shape instead of the property. The ratio that matters is
        measured on the real corpus in ``TestRealCorpus``.
        """
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        payload = importer.measure_wire_payload(corpus.items)
        assert payload.index < payload.full
        assert payload.full - payload.index >= corpus.total_bytes()

    def test_gzip_is_measured_and_smaller_than_plain(self, tmp_path: Path) -> None:
        """Both compressed numbers are real measurements, not a ratio applied to
        the plain ones."""
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        payload = importer.measure_wire_payload(corpus.items)
        assert payload.full_gzip < payload.full
        assert payload.index_gzip < payload.index

    def test_throughput_is_the_payload_over_the_runner_budget(
        self, tmp_path: Path
    ) -> None:
        """The report's KB/s column must be derived from the runner's own
        FETCH_TIMEOUT, not from a number typed into the formatter."""
        _make_corpus_tree(tmp_path)
        corpus = importer.discover_corpus(tmp_path)
        payload = importer.measure_wire_payload(corpus.items)
        assert payload.throughput_kbs(payload.full) == pytest.approx(
            payload.full / importer.FETCH_TIMEOUT_SECONDS / 1024
        )


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def _init_repo(repo: Path) -> None:
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "config", "commit.gpgsign", "false")


# =============================================================================
# The real corpus, when this machine has a checkout of it
# =============================================================================


def _find_real_config_repo() -> Path | None:
    """Locate a ``qontinui-claude-config`` checkout by walking up from here.

    Searched rather than computed from a fixed parent count: this file runs both
    from the primary checkout (``<root>/qontinui-web/backend/tests``) and from an
    allocated worktree (``<root>/agent-worktrees/<id>/qontinui-web/...``), and a
    hardcoded ``parents[N]`` is right in exactly one of them. Returning ``None``
    is a supported outcome — CI has no such checkout, and these tests skip.
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "qontinui-claude-config" / ".claude" / "commands"
        if candidate.is_dir():
            return candidate.parents[1]
    return None


_REAL_CONFIG_REPO = _find_real_config_repo()
_HAS_REAL_CORPUS = _REAL_CONFIG_REPO is not None


@pytest.mark.skipif(
    not _HAS_REAL_CORPUS,
    reason="no qontinui-claude-config checkout above this repo",
)
class TestRealCorpus:
    """Reads the fleet's actual `.claude/` tree.

    Asserts NO count — the corpus is whatever is on disk at the moment of the
    scan, which is the same rule `fleet_commands.rs:21-22` states for the
    runner's embedded set. What it asserts is the SHAPE: every unit clears the
    store's write boundary, and the copy-source specs come back non-invocable.
    """

    def test_the_whole_corpus_clears_the_store_boundary(self) -> None:
        assert _REAL_CONFIG_REPO is not None
        corpus = importer.discover_corpus(_REAL_CONFIG_REPO)
        assert corpus.items
        for item in corpus.items:
            validate_unit_name(item.name)
            validate_provenance(item.source_path, item.source_commit)

    def test_copy_source_specs_are_carried_and_non_invocable(self) -> None:
        assert _REAL_CONFIG_REPO is not None
        corpus = importer.discover_corpus(_REAL_CONFIG_REPO)
        specs = [i for i in corpus.items if i.name.startswith("_")]
        assert specs, "the corpus no longer carries any copy-source spec"
        assert all(not i.is_invocable for i in specs)

    def test_every_skill_carries_its_entrypoint(self) -> None:
        assert _REAL_CONFIG_REPO is not None
        corpus = importer.discover_corpus(_REAL_CONFIG_REPO)
        skills = [i for i in corpus.items if i.kind == KIND_SKILL]
        assert skills
        assert all("SKILL.md" in i.files for i in skills)

    def test_the_full_listing_does_not_fit_the_runners_fetch_budget(self) -> None:
        """The finding Phase 5 required be MEASURED before the corpus is
        imported, pinned so it cannot silently stop being true.

        Bounds, not equalities: the corpus is whatever is on disk at the moment
        of the scan (the `fleet_commands.rs:21-22` rule), so pinning 1,988,661
        would be pinning a timestamp. What must hold is the SHAPE of the finding
        — the full listing needs implausible sustained throughput on a spawn
        critical path, and the index needs almost none.
        """
        assert _REAL_CONFIG_REPO is not None
        corpus = importer.discover_corpus(_REAL_CONFIG_REPO)
        payload = importer.measure_wire_payload(corpus.items)

        # Measured 2026-08-25 over 87 units: 1,988,661 B -> 486 KB/s at 4 s.
        assert payload.throughput_kbs(payload.full) > 100

        # Measured the same run: 47,093 B (2.4% of the full listing) -> 11 KB/s,
        # and 4,823 B gzipped. Bounded loosely so corpus growth does not red the
        # suite before it invalidates the finding.
        assert payload.index < payload.full * 0.10
        assert payload.throughput_kbs(payload.index) < 50
        assert payload.index_gzip < payload.index


@pytest.mark.asyncio
@pytest.mark.skipif(
    not _HAS_REAL_CORPUS,
    reason="no qontinui-claude-config checkout above this repo",
)
async def test_the_real_corpus_imports_and_re_imports_clean(
    imp_db: AsyncSession, service: AgentTextUnitService
) -> None:
    """End to end on the real thing: import the fleet corpus, then import it
    again and assert the second pass writes ZERO versions."""
    assert _REAL_CONFIG_REPO is not None
    first = await service.import_units(
        imp_db, None, importer.discover_corpus(_REAL_CONFIG_REPO).items
    )
    assert first.created == len(first.results)
    after_first = await _version_count(imp_db)

    _forget(imp_db)
    second = await service.import_units(
        imp_db, None, importer.discover_corpus(_REAL_CONFIG_REPO).items
    )
    assert second.versions_written == 0
    assert second.unchanged == len(second.results)
    assert await _version_count(imp_db) == after_first
