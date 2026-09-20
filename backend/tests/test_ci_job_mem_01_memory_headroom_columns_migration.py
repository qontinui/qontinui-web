"""Schema + round-trip test for the ``ci_job_mem_01`` revision.

Phase 1 of plan ``2026-09-20-ci-memory-headroom-in-the-dev-ops-console`` adds
nine memory-headroom columns to ``coord.ci_job_observations``. The DDL is one
ALTER; the contract is everything around it, and **none of it is visible from a
passing ``upgrade``** — which matters more here than for a normal revision,
because the consumer is in another repo and every way it could notice a
violation has been deliberately disabled:

1. **The column NAMES are an interface, and a typo is silent forever.** coord's
   Phase 2 arm reaches these over ``pg_error::is_missing_schema_object``, which
   swallows SQLSTATE 42703 so a coord deploy landing ahead of this migration
   degrades to a logged no-op instead of erroring. The same swallow makes a
   MISSPELLED column indistinguishable from one that has not shipped yet: there
   is no error, in either repo, ever. An explicit assertion is the only pin.
2. **The TYPES are an interface too, and ``IF NOT EXISTS`` is type-blind.** It
   matches on name alone, so a column of the right name and the wrong type
   makes the ADD a silent no-op and leaves the wrong type in place — where
   coord's ``row.get`` panics rather than returning a degradable SQLSTATE.
   Re-running ``upgrade()`` does not repair that, so the type is asserted by
   name from the catalogue.
3. **Every column nullable, no column defaulted, and NULL is never 0.** This is
   the load-bearing rule of the whole revision, and on this axis it has teeth
   pointing in two directions at once: ``min_mem_avail_mb = 0`` renders as *a
   job that ran out of memory* while ``peak_swap_used_mb = 0`` renders as *a
   job that never touched swap* — opposite claims about the SAME absence, both
   fabricated. The job this surface exists to catch is the one the kernel OOM
   killer takes, whose log carries no ``[sample]`` line at all, and it must
   read UNKNOWN on all nine.

   Nullability alone does not defend that. A plain nullable ``DEFAULT 0``
   leaves the column nullable and still writes a 0 into every INSERT that omits
   it — which is every row coord's sampler writes until its Phase 2 arm ships.
   The no-default state is what makes an unsampled job read unknown rather than
   as a job that peacefully used no swap.
4. **``resource_source`` carries NO CHECK, on purpose.** The vocabulary is open
   (``job_log`` today, a producer-pushed ``step_summary`` plausibly later) and
   ingest is best-effort, so a CHECK violation would fail the whole UPSERT and
   discard the job's timing, conclusion and outcome over a *provenance label*.
   It sits on the free-text side of the split this table already makes for
   ``outcome`` and ``duration_band``. A later edit "tightening" it to a CHECKed
   enum is the regression this asserts against.
5. **``mem_total_mb`` is expected to be NULL** — ``resource-sampler.sh``
   resolves ``used``/``available`` from ``free``'s ``Mem:`` row by column name
   and never reads ``total``, so there is no ``mem_total=`` key in the wire
   format. A row carrying every other reading and a NULL here is the normal
   state, not a broken write, and the round-trip below writes exactly that row.
6. **Up -> down -> up leaves no residue and does not touch data.**
   ``downgrade()`` removes nine columns; it must leave the TABLE (which belongs
   to ``coord_ci_job_observations_01``) and every pre-existing observation row
   alone.
7. **Every column carries its ``COMMENT``.** The ADDs and the downgrade are
   generated from one list while the comments are nine HAND-WRITTEN blocks, so
   a tenth column is added, removed and type-checked by everything here and
   lands undocumented unless someone writes one. Those comments are the only
   place the NULL-is-UNKNOWN rule and the system-wide-not-RSS warning are
   recorded in the DATABASE — the revision's docstring ships nowhere an
   operator sees, and ``\\d+`` is where a human meets this schema.

``migration-reversal.yml`` walks the chain against an EMPTY database, so it
proves the SQL parses and nothing more: no row exists there to survive a
round-trip, and it asserts nothing about which columns arrived with which type.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=localhost:5433`` if 5432 is not the
one accepting the test credentials.

Use that variable, **not** ``DATABASE_URL``: ``conftest.py`` overwrites
``os.environ["DATABASE_URL"]`` unconditionally at import time from
``QONTINUI_TEST_PG``, so setting ``DATABASE_URL`` on the command line is
silently discarded and every database-backed test below skips against 5432 —
which looks exactly like a green run in the summary line.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

# Pinned explicitly rather than "head" so a later revision landing on top
# cannot silently change what this test walks. `_PARENT_REVISION_ID` MUST equal
# the revision's own `down_revision` — the first test below enforces it,
# because a stale pin rewinds too far and replays unrelated non-idempotent
# revisions, surfacing as someone else's `DuplicateTable`.
#
# The parent is the repo's single local alembic head at authoring time, derived
# on `origin/main` at 83c9ea5f7 (576 revisions, exactly 1 head). The family
# prefix says nothing about the chain edge, and on a busy repo that head moves:
# read `down_revision` rather than inferring it, and re-point both together.
_REVISION_ID = "ci_job_mem_01"
_PARENT_REVISION_ID = "plan_library_07_plan_difficulty"
_REVISION_FILENAME = "ci_job_mem_01_memory_headroom_columns.py"

_TABLE = "ci_job_observations"

# (column, information_schema.data_type). The type strings are PostgreSQL's own
# spellings. `ADD COLUMN IF NOT EXISTS` matches on NAME alone, so a column of
# the right name and the wrong type is a silent no-op here and a panic in
# coord's `row.get` — this table is the only place that can fail loudly.
# DDL spelling -> the `information_schema.columns.data_type` spelling Postgres
# reports for it. Small on purpose: it covers exactly the types this revision
# uses, and a type added without an entry here fails loudly in the seam test
# rather than silently comparing unequal.
_INFORMATION_SCHEMA_TYPE: dict[str, str] = {
    "INTEGER": "integer",
    "BIGINT": "bigint",
    "TEXT": "text",
}

_EXPECTED: tuple[tuple[str, str], ...] = (
    ("peak_swap_used_mb", "integer"),
    ("swap_total_mb", "integer"),
    ("min_mem_avail_mb", "integer"),
    ("peak_mem_used_mb", "integer"),
    ("mem_total_mb", "integer"),
    ("min_disk_avail_mb", "integer"),
    ("resource_sample_count", "integer"),
    ("resource_span_secs", "integer"),
    ("resource_source", "text"),
)

# The same nine, spelled as the revision's own DDL spells them — this is what
# the module-constant guard compares against, so a name or type edited in one
# place and not the other cannot pass.
#
# Only THIS tuple is pinned to the revision's `_MEMORY_COLUMNS`; `_EXPECTED`
# above is pinned to nothing, and it is what every live-schema walk iterates.
# So a tenth column fails the revision-list guard, gets added here to fix it,
# and is then absent from `_EXPECTED` — where its omission is silent, because
# `_assert_columns_present` only checks the names it was handed. The two are
# reconciled by `test_the_two_column_tables_describe_the_same_nine` below.
_EXPECTED_DDL: tuple[tuple[str, str], ...] = (
    ("peak_swap_used_mb", "INTEGER"),
    ("swap_total_mb", "INTEGER"),
    ("min_mem_avail_mb", "INTEGER"),
    ("peak_mem_used_mb", "INTEGER"),
    ("mem_total_mb", "INTEGER"),
    ("min_disk_avail_mb", "INTEGER"),
    ("resource_sample_count", "INTEGER"),
    ("resource_span_secs", "INTEGER"),
    ("resource_source", "TEXT"),
)

# The seven columns on which a 0 would be a FABRICATED MEASUREMENT rather than
# a reading — every peak, floor and ceiling. `resource_sample_count` is
# deliberately absent: 0 there is a real and load-bearing reading (the log was
# fetched and carried no `[sample]` line, which is the OOM signature, with every
# peak on the row NULL), so a comment forbidding it would be false.
# `resource_source` is TEXT and the rule does not apply to it at all.
_NEVER_ZERO_COLUMNS: tuple[str, ...] = (
    "peak_swap_used_mb",
    "swap_total_mb",
    "min_mem_avail_mb",
    "peak_mem_used_mb",
    "mem_total_mb",
    "min_disk_avail_mb",
    "resource_span_secs",
)

# The latest measured green main run of coord-db-tests, written as coord's
# Phase 2 arm will write it. EVERY value below was reduced from that run's OWN
# job log — `gh api repos/qontinui/qontinui-coord/actions/jobs/103609425712/logs`
# (run 34714587244, workflow CI, branch main, conclusion success, 2026-09-12),
# 77 `[sample]` lines — and NOT from the illustrative sample line that appears
# in the sampler's own documentation. An earlier draft of this block mixed the
# two, which is the exact defect class this revision exists to close: a value
# presented as measured whose provenance cannot carry it. Anything not in that
# reduction is absent here rather than invented.
#
# `mem_total_mb` is None on purpose and is the most load-bearing value here:
# resource-sampler.sh never reads `total` off free's `Mem:` row, so there is no
# `mem_total=` key in the wire format and memory headroom is not computable.
# NULL is how the schema says that, on a row where every other reading arrived.
#
# `min_disk_avail_mb` is 27705 — the floor of the `disk_avail=` key, which all
# 77 sample lines carry (range 27705..29552 M, declining monotonically as the
# build fills the disk).
#
# Two earlier drafts of this one constant were both wrong, and the second is
# worth recording because it was wrong in the direction this file is about.
# Draft one copied 31204 from the sampler's DOCUMENTATION example — a fabricated
# measurement. Draft two replaced it with None on the stated ground that "the
# reduction did not carry a disk floor", which was FALSE: the reduction was
# never re-read for that key, so an absence was asserted rather than observed.
# Substituting an unverified UNKNOWN for an unverified number is not a fix; it
# is the same defect wearing the opposite costume, and it happened inside the
# comment block whose entire subject is values whose provenance cannot carry
# them. The log settled it in one API call, which is what should have happened
# both times.
#
# The arithmetic is the point of the rest, and the ceiling is where it bites:
# 7981/12287 = 64.95%. NOT /12288 — `fallocate -l 12G` yields 12,288 MiB and
# `mkswap` spends one page on the swap header, so `free -m` reports 12287. A
# band or fixture pinned to the round number is wrong on day one, which is why
# `swap_total_mb` is stored per row instead of assumed. With a 194 MB floor,
# the plan's bands put this run in `breach` on a run GitHub reported GREEN —
# the whole claim this surface has to be able to make.
_GREEN_RUN_PEAK_SWAP_MB = 7_981
_GREEN_RUN_SWAP_TOTAL_MB = 12_287
_GREEN_RUN_MIN_MEM_AVAIL_MB = 194
_GREEN_RUN_PEAK_MEM_USED_MB = 7_743
_GREEN_RUN_MIN_DISK_AVAIL_MB = 27_705
_GREEN_RUN_SAMPLE_COUNT = 77
# First-to-last parsed `[sample]` line: 19:36:39 -> 20:02:01 = 1522 s. That is
# the definition `resource_span_secs`'s own COMMENT gives, so it is the one
# fixtured here. Note it is NOT the sampler summary table's `(n-1) * INTERVAL`
# arithmetic, which gives 76 x 20 = 1520 on this run — loop jitter puts the two
# 2 s apart, and coord Phase 2 writes the first-to-last form the column
# describes.
_GREEN_RUN_SPAN_SECS = 1_522
# The job itself: 2026-09-12T19:35:04Z -> 20:02:14Z. The span MUST be shorter —
# sampling starts inside the step and ends before the job does — and the gap is
# the evidence `resource_span_secs`'s COMMENT describes. An earlier draft left
# this at 1450 against a 1520 span, i.e. a sample window longer than the job it
# was taken inside, which is impossible and which no assertion here catches.
_GREEN_RUN_DURATION_SECS = 1_630


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _expected_comment(column: str) -> str:
    """The body the revision's own source emits for ``column``.

    Read from the ONE author rather than copied here: a second copy of nine
    prose blocks is the divergence such an assertion exists to catch, and the
    reader collapses the doubled apostrophes exactly as the SQL parser does.
    """
    return comment_body_from_source(_revision_source(), f"coord.{_TABLE}.{column}")


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` names the revision's real parent."""
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _revision_source(),
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins {_PARENT_REVISION_ID!r}. Re-point both together — "
        f"and the `Revises:` header in the revision docstring with them."
    )


def _revision_module():
    """Import the revision file directly — it only imports ``alembic.op``."""
    return load_revision_module(_revision_path(), "_ci_job_mem_01_under_test")


def test_the_revision_names_the_columns_coord_reads_from_one_list() -> None:
    """The nine names and types, read off the revision's own constants.

    This is the guard that has no runtime backstop anywhere. coord's Phase 2
    arm reaches these columns through `is_missing_schema_object`, which swallows
    42703 precisely so a coord deploy that lands ahead of the migration degrades
    to a logged no-op instead of erroring — and the same swallow means a
    MISSPELLED column is indistinguishable from one that has not shipped yet.
    Reading the module's constants (rather than grepping the DDL text) also pins
    that the upgrade's ADDs and the downgrade's removals are generated from ONE
    list, which is what makes "add and remove the same nine" mechanical instead
    of a convention.
    """
    module = _revision_module()
    assert module._TABLE == f"coord.{_TABLE}", (
        "the revision must widen coord.ci_job_observations; the memory axis "
        "belongs on the per-job row that already carries duration_secs, "
        "runner_labels, self_hosted and conclusion — every join this surface "
        "needs — rather than on a sibling table that would duplicate its key, "
        "its reaper and its backfill for no capability"
    )
    assert tuple(module._MEMORY_COLUMNS) == _EXPECTED_DDL, (
        "the revision's column list drifted from what coord's ci_job_sampler "
        "will write. These names are an INTERFACE across two repos and 42703 "
        "is swallowed on the reading side, so drift here idles forever in "
        "silence rather than failing."
    )


def test_the_two_column_tables_describe_the_same_nine() -> None:
    """`_EXPECTED` and `_EXPECTED_DDL` name the same columns, in the same order.

    Closes the one seam between the guards above and the walks below.
    `_EXPECTED_DDL` is pinned to the revision's `_MEMORY_COLUMNS`; nothing pins
    `_EXPECTED`, and `_EXPECTED` is what every live-schema assertion iterates.
    A tenth column would therefore fail the revision-list guard, be fixed by
    extending `_EXPECTED_DDL` alone, and then ship a column no walk in this file
    ever looked at — present, removed and round-tripped by the revision, and
    unchecked for type, nullability or default.

    It pins the TYPE as well as the name. The two spellings differ on purpose
    (``INTEGER`` in DDL, ``integer`` in ``information_schema``), so the compare
    goes through [`_INFORMATION_SCHEMA_TYPE`] rather than string equality.
    Without that, a type widened in ``_MEMORY_COLUMNS`` and ``_EXPECTED_DDL``
    together while ``_EXPECTED`` stayed at ``integer`` would be caught only by
    the live-schema walk — i.e. only when a Postgres is reachable — so the drift
    would ship green from a database-less CI run.
    """
    assert [name for name, _ in _EXPECTED] == [name for name, _ in _EXPECTED_DDL], (
        "the catalogue table and the DDL table list different columns; every "
        "live-schema walk below iterates the FORMER, so a column present only "
        "in the latter is added by the revision and asserted about by nothing"
    )

    unmapped = sorted(
        {ddl_type for _, ddl_type in _EXPECTED_DDL} - set(_INFORMATION_SCHEMA_TYPE)
    )
    assert not unmapped, (
        f"no information_schema spelling is mapped for {unmapped}; add it to "
        "_INFORMATION_SCHEMA_TYPE so the type pin below can compare it, rather "
        "than leaving the type unchecked in a database-less run"
    )
    assert [
        (name, _INFORMATION_SCHEMA_TYPE[ddl_type]) for name, ddl_type in _EXPECTED_DDL
    ] == list(_EXPECTED), (
        "the catalogue table and the DDL table disagree about a column's TYPE. "
        "Only the live-schema walk would otherwise catch that, and it skips "
        "without a Postgres — so the drift ships green from a database-less CI "
        "run"
    )


def test_the_fixture_run_is_physically_possible() -> None:
    """The sampled span must fit inside the job, and the peaks inside the ceiling.

    No other assertion in this file looks at the fixture's internal coherence,
    and that gap is measured rather than hypothetical: round 2 of review moved
    `_GREEN_RUN_SPAN_SECS` from 1400 to 1522 and left `duration_secs` at 1450,
    producing a sample window LONGER than the job it was taken inside. Nothing
    failed. A fixture that cannot physically exist is a worse witness than no
    fixture, because every round-trip below then demonstrates the impossible.

    These are properties of the RUN, not of the schema, so they need no
    database and never skip.
    """
    assert _GREEN_RUN_SPAN_SECS < _GREEN_RUN_DURATION_SECS, (
        f"the sampled span ({_GREEN_RUN_SPAN_SECS}s) is not shorter than the "
        f"job it was sampled inside ({_GREEN_RUN_DURATION_SECS}s). Sampling "
        "starts inside the step and stops before the job ends, so the gap is "
        "the evidence resource_span_secs' COMMENT describes — inverted here, "
        "it asserts something that cannot have happened"
    )
    assert _GREEN_RUN_PEAK_SWAP_MB < _GREEN_RUN_SWAP_TOTAL_MB, (
        f"peak swap ({_GREEN_RUN_PEAK_SWAP_MB}M) is not below the ceiling it "
        f"was measured against ({_GREEN_RUN_SWAP_TOTAL_MB}M); a ratio consumer "
        "would render over 100% headroom used"
    )
    assert _GREEN_RUN_SAMPLE_COUNT > 1, (
        "a span between the first and last sample needs at least two samples"
    )
    # Every peak this fixture claims came off the same reduction, so a None
    # here is a key the log genuinely did not carry -- today only mem_total,
    # and that absence is the whole point of the mem_total_mb column.
    assert _GREEN_RUN_MIN_DISK_AVAIL_MB is not None, (
        "min_disk_avail_mb is None, but all 77 sample lines of the fixtured "
        "run carry a disk_avail= key. An absence asserted without re-reading "
        "the reduction is the defect this block exists to document"
    )


def test_the_revision_comments_every_column_it_adds() -> None:
    """Each of the nine carries a ``COMMENT ON COLUMN`` in the revision source.

    The ADDs and the downgrade are generated from `_MEMORY_COLUMNS`; the
    comments are **nine hand-written blocks** that are not. So a tenth column
    added to that list is added, removed, type-checked and round-tripped by
    everything else in this file, and lands with no comment at all.

    That matters more here than tidiness, because these comments are the only
    place three rules are written into the database itself: NULL is UNKNOWN and
    never 0; `peak_mem_used_mb` is SYSTEM-WIDE and not a process resident set;
    and `mem_total_mb` is expected to be NULL because the sampler emits no
    `mem_total=` key. coord reads these columns across a repo boundary through
    a swallowed 42703, the revision's docstring is not shipped anywhere an
    operator sees, and ``\\d+`` is where a human meets this schema.

    Structural rather than database-backed: it never skips, which is the point
    — the walks below skip wholesale when no Postgres is reachable.
    """
    source = _revision_source()
    for name, _ in _EXPECTED_DDL:
        marker = f"COMMENT ON COLUMN coord.{_TABLE}.{name} IS"
        assert marker in source, (
            f"{name} is added by the revision's one column list but carries no "
            f"COMMENT; the comments are hand-written blocks rather than "
            f"generated from that list, so a new column lands bare unless one "
            f"is written for it"
        )
        assert _expected_comment(name).strip(), (
            f"{name}'s COMMENT body is empty; an empty comment records nothing "
            f"and reads as documented to anyone checking for one"
        )


def test_every_comment_says_null_is_unknown_and_never_zero() -> None:
    """Each comment states the one rule a column NAME cannot carry.

    Not prose-policing: this rule is the whole revision. `min_mem_avail_mb = 0`
    asserts *a job that ran out of memory* and `peak_swap_used_mb = 0` asserts
    *a job that never touched swap* — opposite claims about the same absence —
    and the job this surface exists to catch is the one whose log carries no
    `[sample]` line at all. A reader meeting the schema in ``\\d+`` has the
    comment and nothing else.

    The never-0 half runs over `_NEVER_ZERO_COLUMNS` rather than all nine:
    `resource_sample_count = 0` is a REAL reading (the log was fetched and
    carried no `[sample]` line, every peak on the row NULL), so a comment
    forbidding a 0 there would be false — and a test that demanded one would
    force a false comment into the database.
    """
    for name, _ in _EXPECTED_DDL:
        body = _expected_comment(name)
        assert "NULL = UNKNOWN" in body, (
            f"coord.{_TABLE}.{name}'s COMMENT does not say NULL = UNKNOWN; "
            f"without it a consumer has nothing in the database telling it "
            f"that an absent reading is not a measured zero"
        )

    for name in _NEVER_ZERO_COLUMNS:
        body = _expected_comment(name)
        assert "never 0" in body or "NEVER 0" in body, (
            f"coord.{_TABLE}.{name}'s COMMENT does not say the column is never "
            f"0 on an absent reading; on this axis a fabricated 0 does not "
            f"merely lose information, it inverts the claim"
        )


def test_the_system_wide_and_no_denominator_warnings_are_in_the_comments() -> None:
    """Two facts a consumer gets wrong by default, pinned into the COMMENTs.

    `peak_mem_used_mb` is `free -m` over the whole runner. The sampler has no
    `ps`, no `/proc/<pid>/status` and no cgroup read, so per-process rustc RSS
    is never measured by this pipeline — while the dossier that motivated the
    plan is full of rustc RSS figures from a different hand method. A consumer
    that reads this column as rustc's resident set is comparing two different
    quantities with nothing anywhere to stop it.

    `mem_total_mb` has no producer at all until the plan's Phase 5, so memory
    headroom as a percentage is not computable. The failure mode is a consumer
    inventing a hardcoded 7 GB denominator, which would silently become wrong
    the day `coord-db-tests` moves to the self-hosted box — the exact day the
    metric matters most.
    """
    peak = _expected_comment("peak_mem_used_mb")
    assert "SYSTEM-WIDE" in peak and "NOT a process resident set" in peak, (
        "peak_mem_used_mb's COMMENT must say it is system-wide and not a "
        "process resident set; the column is deliberately not named "
        "peak_rss_mb and the comment is the only place that reasoning reaches "
        "a reader of the schema"
    )
    total = _expected_comment("mem_total_mb")
    assert "EXPECTED TO BE NULL" in total, (
        "mem_total_mb's COMMENT must say NULL is the expected state; a reader "
        "who takes it for a broken write goes looking for a bug instead of for "
        "the missing mem_total= key"
    )
    assert "hardcoded 7 GB" in total, (
        "mem_total_mb's COMMENT must name the fabrication it forbids; "
        "'renders unknown' without the counter-example is advice a consumer "
        "under deadline reads past"
    )
    swap_total = _expected_comment("swap_total_mb")
    assert "NULLIF(swap_total_mb, 0)" in swap_total, (
        "swap_total_mb is the DENOMINATOR of every swap-headroom ratio and no "
        "CHECK forbids a 0; the guard obligation SQL cannot express has to be "
        "stated where the consumer meets the column"
    )


def test_the_revision_generates_its_removals_from_the_same_list() -> None:
    """Every column is both ADDed idempotently and removed, in the two spellings.

    A structural guard beside the round-trip walk below, which proves the same
    agreement behaviourally but only for the columns that exist TODAY. This one
    reads the generated SQL, so it also pins the two per-clause guards the
    round-trip cannot see the absence of: `IF NOT EXISTS` on every ADD (the
    guard is per-clause, so one missing clause aborts the whole re-run) and
    `IF EXISTS` on every removal.

    Together with the list assertion above — which pins `_EXPECTED_DDL` against
    the revision's own `_MEMORY_COLUMNS` — a tenth column cannot reach
    `upgrade()` without also reaching `downgrade()` and this file.
    """
    module = _revision_module()
    add_sql = module._add_columns(module._TABLE)
    drop_sql = module._drop_columns(module._TABLE)
    for name, sql_type in _EXPECTED_DDL:
        assert f"ADD COLUMN IF NOT EXISTS {name} {sql_type}" in add_sql, (
            f"{name} is not added idempotently; the IF NOT EXISTS guard is "
            f"per-clause, so one missing clause aborts the whole re-run"
        )
        assert f"DROP COLUMN IF EXISTS {name}" in drop_sql, (
            f"{name} is added by upgrade() but not removed by downgrade(); "
            f"the residue would survive as a column coord may still read"
        )


def test_the_downgrade_helper_is_reachable_only_from_downgrade() -> None:
    """`_drop_columns` must not be called from `upgrade()`.

    `scripts/ci/check_coord_column_drops.py` scans the UPGRADE PATH — the module
    minus `downgrade()` and minus every module-level helper reachable ONLY from
    it — for `coord.*` drops, and an unresolved drop site is a violation on its
    own before any manifest is consulted. `_drop_columns` builds its SQL from a
    loop variable, so it resolves to nothing the scanner can name; reached from
    `upgrade()` it would be scanned fail-closed and red the required
    `coord-column-drop-guard` check on a revision that drops nothing at all.
    """
    source = _revision_source()
    upgrade_start = source.index("\ndef upgrade()")
    downgrade_start = source.index("\ndef downgrade()")
    assert upgrade_start < downgrade_start
    assert "_drop_columns" not in source[upgrade_start:downgrade_start], (
        "_drop_columns is referenced from the upgrade path; the column-drop "
        "guard excludes downgrade-only helpers and scans everything else "
        "fail-closed, so this reds a required check on an additive revision"
    )
    assert "_drop_columns" in source[downgrade_start:], (
        "downgrade() no longer calls _drop_columns, so the nine columns it "
        "added are not removed"
    )
    # The span scan above cannot see a call from `_add_columns` into
    # `_drop_columns`: both are defined ABOVE `upgrade()`, so such a call lies
    # outside [upgrade_start, downgrade_start) and would pass while making the
    # helper reachable from the upgrade path — precisely what reds the required
    # `coord-column-drop-guard` check. Counting closes that: the only two
    # mentions in the whole module are the `def` and the one call in
    # `downgrade()`.
    assert source.count("_drop_columns") == 2, (
        f"_drop_columns is mentioned {source.count('_drop_columns')} times; "
        "exactly two are expected (its `def`, and the single call in "
        "downgrade()). A third mention may make it reachable from the upgrade "
        "path even when the span scan above passes"
    )


# ---------------------------------------------------------------------------
# Live-schema walks.
# ---------------------------------------------------------------------------


def _columns(engine: Engine) -> dict[str, tuple[str, str, str | None]]:
    """``{column: (data_type, is_nullable, column_default)}`` for the table.

    One bulk read rather than the harness's per-column ``column_info``: the
    round-trip walk calls this three times over nine columns, and
    [`_assert_columns_absent`] needs the whole set rather than one column.
    """
    sql = text(
        """
        SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'coord' AND table_name = :t
        """
    )
    with engine.connect() as conn:
        return {
            r[0]: (r[1], r[2], r[3])
            for r in conn.execute(sql, {"t": _TABLE}).fetchall()
        }


def _assert_columns_present(engine: Engine) -> None:
    """All nine columns, right type, nullable, and carrying no default."""
    cols = _columns(engine)
    for name, expected_type in _EXPECTED:
        assert name in cols, f"coord.{_TABLE} is missing {name}"
        data_type, nullable, default = cols[name]
        assert data_type == expected_type, (
            f"coord.{_TABLE}.{name} is {data_type}, expected {expected_type}. "
            f"ADD COLUMN IF NOT EXISTS is type-blind, so a wrong type is a "
            f"silent no-op here and a panic in coord's row.get"
        )
        assert nullable == "YES", (
            f"coord.{_TABLE}.{name} is NOT NULL; NULL is how this schema says "
            f"'no sample was parsed', and on this axis a manufactured number "
            f"is an assertion about the job rather than a missing detail"
        )
        # Nullability alone does not defend the NULL-is-never-0 rule: a plain
        # `DEFAULT 0` leaves the column nullable and still writes a 0 into
        # every INSERT that omits it, which is every row coord's sampler writes
        # until its Phase 2 arm ships. Worse, the two zeros disagree with each
        # other — `peak_swap_used_mb = 0` says the job never touched swap while
        # `min_mem_avail_mb = 0` says it ran out of memory.
        assert default is None, (
            f"coord.{_TABLE}.{name} carries DEFAULT {default}; a default on "
            f"this axis manufactures a reading nothing measured, and the "
            f"OOM-killed job this surface exists to catch is exactly the one "
            f"that omits every resource column"
        )


def _assert_columns_commented(engine: Engine) -> None:
    """Each column's ``col_description`` is what the revision's source emits.

    Compared against the revision rather than a copy pasted here, so the
    assertion cannot drift from the thing it describes.

    Worth a live read on top of the structural guard above, which only proves
    the source CONTAINS the blocks: the nine ``COMMENT ON COLUMN`` statements
    are unguarded ``op.execute`` calls replayed on every re-run, and nothing
    else in this file notices if they stop arriving, land on the wrong column,
    or are truncated by an edit to the adjacent-literal runs.
    """
    for name, _ in _EXPECTED:
        actual = column_comment(engine, _TABLE, name)
        assert actual == _expected_comment(name), (
            f"coord.{_TABLE}.{name}'s COMMENT is not what the revision emits.\n"
            f"  in the database: {actual!r}\n"
            f"  in the revision: {_expected_comment(name)!r}\n"
            f"These comments are the only place NULL-is-UNKNOWN, "
            f"system-wide-not-RSS and the missing memory denominator are "
            f"recorded in the database itself; coord reads these columns from "
            f"another repo through a swallowed 42703, so nothing at runtime "
            f"would notice."
        )


def _assert_columns_absent(engine: Engine) -> None:
    """No residue after downgrade."""
    cols = _columns(engine)
    for name, _ in _EXPECTED:
        assert name not in cols, f"coord.{_TABLE}.{name} survived downgrade()"


def _seed_job_row(engine: Engine, job_id: int) -> None:
    """One pre-existing observation row, as an already-live database would have.

    Only the NOT NULL columns plus the duration half of the metric: this row
    predates the memory axis, which is the whole point of it — it is what the
    round-trip walk below checks survives untouched.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.ci_job_observations
                    (repo, job_id, run_id, run_attempt, workflow_name,
                     job_name, self_hosted, outcome, duration_secs)
                VALUES ('qontinui/qontinui-coord', :j, 34714587244, 1, 'CI',
                        'coord-db-tests', false, 'pass', :dur)
                """
            ),
            {"j": job_id, "dur": _GREEN_RUN_DURATION_SECS},
        )


def _job_row(engine: Engine, job_id: int) -> tuple:
    """The pre-memory columns of a seeded row.

    Deliberately not the memory columns: they do not exist after downgrade, and
    the point of this read is that the columns predating the revision survive
    the walk untouched.
    """
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT repo, run_id, workflow_name, job_name, outcome,
                       duration_secs
                  FROM coord.ci_job_observations
                 WHERE job_id = :j
                """
            ),
            {"j": job_id},
        ).fetchone()
    assert row is not None, "the seeded observation row vanished"
    return tuple(row)


def _read_memory_columns(engine: Engine, job_id: int) -> tuple:
    """The nine memory columns of one row, in `_EXPECTED` order."""
    projection = ", ".join(name for name, _ in _EXPECTED)
    with engine.connect() as conn:
        row = conn.execute(
            text(
                f"SELECT {projection} FROM coord.ci_job_observations WHERE job_id = :j"
            ),
            {"j": job_id},
        ).fetchone()
    assert row is not None, f"no observation row for job_id {job_id}"
    return tuple(row)


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def test_an_unsampled_job_and_a_sampled_one_round_trip(_admin_url: str) -> None:
    """Both halves of the contract, on two rows of the same table.

    Four properties in one walk, since every database-backed test here replays
    the whole chain into its own ephemeral database and a second replay costs
    real wall-clock for what an extra query answers for free:

    * the nine columns arrive with the right types, nullable and undefaulted;
    * a job with no parsed sample reads NULL on all nine — the OOM-killed case,
      which must render UNKNOWN rather than as a job that quietly used no swap;
    * the measured green run round-trips intact, `mem_total_mb` NULL and all,
      because `resource-sampler.sh` emits no `mem_total=` key;
    * no CHECK governs `resource_source`, so a provenance label nobody has
      named yet cannot take a whole best-effort UPSERT down with it.

    There is deliberately no separate "upgrade adds the columns" test: this one
    upgrades and asserts that shape before doing anything else.
    """
    with ephemeral_database(_admin_url, "ci_job_mem_01_rtp") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)

        # (1) The unsampled job. Written exactly as coord's sampler writes a
        # row today — no resource columns mentioned at all.
        _seed_job_row(engine, 1)
        assert _read_memory_columns(engine, 1) == (None,) * len(_EXPECTED), (
            "a job whose log carried no [sample] line must read NULL on every "
            "resource column. This is the OOM-killed case the whole surface "
            "exists to catch: a 0 in peak_swap_used_mb would assert the job "
            "never touched swap, and a 0 in min_mem_avail_mb that it ran out "
            "of memory — opposite claims about the same absence"
        )

        # (2) The measured green run, written as Phase 2 will write it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.ci_job_observations
                        (repo, job_id, run_id, run_attempt, workflow_name,
                         job_name, runner_labels, self_hosted, conclusion,
                         outcome, duration_secs,
                         peak_swap_used_mb, swap_total_mb, min_mem_avail_mb,
                         peak_mem_used_mb, mem_total_mb, min_disk_avail_mb,
                         resource_sample_count, resource_span_secs,
                         resource_source)
                    VALUES ('qontinui/qontinui-coord', 2, 34714587244, 1, 'CI',
                            'coord-db-tests', ARRAY['ubuntu-latest'], false,
                            'success', 'pass', :dur,
                            :swap, :swap_total, :mem_avail, :mem_used, NULL,
                            :disk, :count, :span, 'job_log')
                    """
                ),
                {
                    "dur": _GREEN_RUN_DURATION_SECS,
                    "swap": _GREEN_RUN_PEAK_SWAP_MB,
                    "swap_total": _GREEN_RUN_SWAP_TOTAL_MB,
                    "mem_avail": _GREEN_RUN_MIN_MEM_AVAIL_MB,
                    "mem_used": _GREEN_RUN_PEAK_MEM_USED_MB,
                    "disk": _GREEN_RUN_MIN_DISK_AVAIL_MB,
                    "count": _GREEN_RUN_SAMPLE_COUNT,
                    "span": _GREEN_RUN_SPAN_SECS,
                },
            )

        assert _read_memory_columns(engine, 2) == (
            _GREEN_RUN_PEAK_SWAP_MB,
            _GREEN_RUN_SWAP_TOTAL_MB,
            _GREEN_RUN_MIN_MEM_AVAIL_MB,
            _GREEN_RUN_PEAK_MEM_USED_MB,
            None,
            _GREEN_RUN_MIN_DISK_AVAIL_MB,
            _GREEN_RUN_SAMPLE_COUNT,
            _GREEN_RUN_SPAN_SECS,
            "job_log",
        ), (
            "the measured green run did not round-trip. mem_total_mb in "
            "particular must stay NULL: resource-sampler.sh resolves used and "
            "available from free's Mem: row by name and never reads total, so "
            "there is no mem_total= key to parse — a row with every other "
            "reading and a NULL here is the normal state, not a broken write"
        )

        # `resource_source` is free text, and that is a decision the revision
        # argues rather than an omission. `step_summary` is in the documented
        # vocabulary with NO shipped producer, and a third class is a plausible
        # outcome of a later phase. A CHECKed enum would reject the whole
        # best-effort UPSERT over an unrecognised PROVENANCE LABEL, discarding
        # the timing, conclusion and outcome on the same row — which is exactly
        # backwards for the jobs that matter most.
        #
        # Asserted from the catalogue rather than by inserting each label: the
        # catalogue answers for every value at once, including the ones nobody
        # has thought of, which is the actual property being defended.
        with engine.connect() as conn:
            checks = conn.execute(
                text(
                    """
                    SELECT c.conname, pg_get_constraintdef(c.oid)
                      FROM pg_constraint c
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid
                       AND a.attnum = ANY (c.conkey)
                     WHERE c.conrelid = 'coord.ci_job_observations'::regclass
                       AND c.contype = 'c'
                       AND a.attname = 'resource_source'
                    """
                )
            ).fetchall()
        assert checks == [], (
            f"a CHECK now governs resource_source ({checks}); it sits on the "
            f"free-text side of the split this table already makes for outcome "
            f"and duration_band, and tightening it to an enum breaks "
            f"best-effort ingest for exactly the rows that matter most"
        )

        # And behaviourally: a label with no producer anywhere is storable.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.ci_job_observations
                        (repo, job_id, run_id, workflow_name, job_name,
                         self_hosted, outcome, resource_source)
                    VALUES ('qontinui/qontinui-coord', 3, 34714587244, 'CI',
                            'coord-db-tests', false, 'pass', 'step_summary')
                    """
                )
            )


def test_a_null_reading_is_distinguishable_from_zero(_admin_url: str) -> None:
    """NULL ("not sampled") and 0 stay two different values on every column.

    This is the rule the whole revision rests on, and on this axis a fabricated
    0 does not merely lose information — it inverts the reading, in two
    directions at once. `peak_swap_used_mb = 0` renders as a job that never
    touched swap; `min_mem_avail_mb = 0` renders as a job that ran out of
    memory. A NOT NULL DEFAULT 0 added later would make the OOM-killed job —
    the one whose log carries no `[sample]` line at all — report both of those
    contradictory claims at once, with nothing anywhere raising an error.
    """
    with ephemeral_database(_admin_url, "ci_job_mem_01_nz") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_job_row(engine, 1)

        with engine.connect() as conn:
            unset = conn.execute(
                text(
                    """
                    SELECT peak_swap_used_mb IS NULL, swap_total_mb IS NULL,
                           min_mem_avail_mb IS NULL, peak_mem_used_mb IS NULL,
                           mem_total_mb IS NULL, min_disk_avail_mb IS NULL,
                           resource_sample_count IS NULL,
                           resource_span_secs IS NULL,
                           resource_source IS NULL
                      FROM coord.ci_job_observations WHERE job_id = 1
                    """
                )
            ).fetchone()
        assert unset == (True,) * len(_EXPECTED), (
            "a job that published no resource reading must read as NULL, not "
            "as a defaulted 0 — every consumer must render it UNKNOWN, and an "
            "unknown input must never fire the pre-cliff detector"
        )

        # 0 is storable and distinct, on both directions of the rule: a job
        # that genuinely never swapped is a legitimate reading, and so is a
        # parsed log that carried no [sample] line (resource_sample_count = 0
        # with every peak NULL).
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.ci_job_observations
                       SET peak_swap_used_mb = 0, min_mem_avail_mb = 0,
                           resource_sample_count = 0, resource_span_secs = 0
                     WHERE job_id = 1
                    """
                )
            )
        with engine.connect() as conn:
            zeroed = conn.execute(
                text(
                    """
                    SELECT peak_swap_used_mb, peak_swap_used_mb IS NULL,
                           min_mem_avail_mb, min_mem_avail_mb IS NULL,
                           resource_sample_count, resource_sample_count IS NULL,
                           resource_span_secs, resource_span_secs IS NULL
                      FROM coord.ci_job_observations WHERE job_id = 1
                    """
                )
            ).fetchone()
        assert zeroed == (0, False, 0, False, 0, False, 0, False), (
            "0 must be storable and distinct from NULL: a job that genuinely "
            "never touched swap, and a log that was read and carried no "
            "[sample] line, are real readings rather than the absence of one"
        )


def test_up_down_up_leaves_no_residue_and_keeps_the_job_row(
    _admin_url: str,
) -> None:
    """The full walk: a live observation row survives, and downgrade cleans up.

    ``downgrade()`` ALTERs the table coord's ci_job_sampler UPSERTs every 120 s
    and retains for 30 days, so the assertion that the TABLE and its rows
    survive is not ceremony — an over-broad drop here destroys the fleet's
    whole per-job CI history, and the table belongs to
    ``coord_ci_job_observations_01``, not to this revision.
    """
    with ephemeral_database(_admin_url, "ci_job_mem_01_ud") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_job_row(engine, 1)
        _assert_columns_present(engine)
        before = _job_row(engine, 1)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_columns_absent(engine)
        assert table_exists(engine, "coord", _TABLE), (
            "downgrade() dropped the observations TABLE; it owns nine columns "
            "there, not the table — that belongs to coord_ci_job_observations_01"
        )
        assert _job_row(engine, 1) == before, (
            "downgrade() disturbed a live observation row; it must remove "
            "columns, not data"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        # Removing a column takes its comment with it, so this is the restore
        # path rather than the replay one: the re-added columns must be
        # documented again, not merely present again.
        _assert_columns_commented(engine)
        assert _job_row(engine, 1) == before

        # The re-added columns are NULL for the row that predates them, which
        # is the honest record: while they did not exist nothing could have
        # been parsed, so there is nothing to backfill from the row itself.
        # This is also the steady state for every job until coord's Phase 2 arm
        # ships — and the reason every consumer must already render UNKNOWN.
        assert _read_memory_columns(engine, 1) == (None,) * len(_EXPECTED)


def test_upgrade_is_idempotent(_admin_url: str) -> None:
    """`ADD COLUMN IF NOT EXISTS` — a re-run of upgrade() is a no-op.

    The house convention for `coord.*` tables, and worth an assertion because
    the guard is per-clause: one missing `IF NOT EXISTS` in a nine-clause ALTER
    makes the whole statement abort on the re-run. The re-run also replays the
    nine `COMMENT ON COLUMN` statements, which are not themselves guarded and
    must stay safe to repeat — so the replayed comments are read back too,
    rather than only asserted to have not aborted the run.
    """
    with ephemeral_database(_admin_url, "ci_job_mem_01_id") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_columns_present(engine)
        _assert_columns_commented(engine)
