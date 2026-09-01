"""coord.device_resource_samples — the socket-census lane (per-listener TCP states)

Revision ID: fleet_res_tel_05_socket_census
Revises: pmf_scope_cols_01
Create Date: 2026-09-01

Phase 2a of plan
``2026-08-31-devops-runner-9876-accept-path-starved-by-close-wait-sockets``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so the six
columns coord's reader and the runner's publisher will read and write land
here, in qontinui-web, and this revision must merge **before** the coord PR that
reads them. Hand-authored; ``alembic revision --autogenerate`` was not run and
is never run against ``coord.*``.

Why these columns exist
=======================

On 2026-08-31 a steward reported that the runner's port-9876 listener had
stopped accepting, holding 148 ``CLOSE_WAIT`` sockets against a known-zero
baseline, while the supervisor (9875) and frontend (3001) on the same host
connected normally. **Vetting refuted both halves of that account**, and this
revision exists because of what the refutation needed rather than because of
the account itself. Read this carefully — the wrong version of this story is
what the column comments below are worded to prevent:

* **The ``CLOSE_WAIT`` population is not a leak.** Measured on a live runner:
  60 full HTTP request/response cycles produce **zero**; 40 bare TCP
  connect-then-close (no request sent) produce **40**, which drain
  **sub-second**. Server-side ``TIME_WAIT`` rising is positive proof the
  server closes correctly. The listener is stock ``axum::serve`` on hyper,
  which tears the connection down on peer FIN and cannot be configured
  otherwise here.
* **The connect failures were IPv6.** ~2056 ms matches the fleet's documented
  ``[::1]`` *failure* cost (2057 ms), not its IPv4 *success* cost (2133 ms),
  and the recorded error was a Windows refusal. The runner binds the IPv4
  loopback only, so an IPv6-resolving probe is refused by an absent listener.
  The two "healthy neighbours" bind dual-stack, so they differed from the
  subject in exactly the variable under test and scoped nothing.
* Prior art had already settled this once: an earlier SHIPPED plan recorded
  the same signal as *"a transient snapshot, not a standing leak … no fix
  should be premised on socket leakage."*

**What survives is the reason the question took a day to answer: no fleet
surface could show any of it.** ``coord.device_resource_samples`` carries CPU,
load, memory, commit, swap, disk, build slots, queue depth, CI job counts and
(since ``fleet_res_tel_04``) the thread/PID saturation lane. It has **no
socket-state dimension at all**: no ``CLOSE_WAIT``, no per-listener connection
census, nothing keyed to a port. Every hypothesis had to be re-derived by hand
from live ``ss`` runs, and the incident's own hand census could not even
distinguish a server-side socket from a client-side one — see the local/remote
section below, which is the single most important thing these columns do.

This revision is the storage for that missing dimension. It is the
**measurement** half only.

Reporting, NOT ranking — and this is a constraint, not a default
================================================================

The plan states it as a design constraint inherited from the sibling telemetry
plans: *"this is a **reporting** dimension. It must not gate dispatch."*

That is a real difference from ``fleet_res_tel_04``, which added a THIRD
admission axis (``lane_saturation``, worst-of at the ``headroom`` layer, read by
coord's dispatch ranking). Nothing here feeds ``lane_pressure()``,
``pressure_sql``, ``lane_saturation`` or ``saturation_sql``, and nothing here
belongs in ``headroom``. A consumer that wires a socket count into an admission
verdict has changed the plan, not implemented it — and it would then be bound by
``db_tests::sql_and_rust_pressure_agree``, which pins the Rust and SQL spellings
of the verdict equal and which nothing below touches.

The reason is the failure mode: a machine whose ``ss`` probe is unavailable
reports NULL on every column here, and a NULL folded into a worst-of verdict
either silently reads as healthy or removes a machine from dispatch on the
strength of a missing instrument. Neither is acceptable for a dimension whose
publisher does not exist yet.

NULL is not zero — and here it is LOAD-BEARING, not incidental
==============================================================

**Every column below is nullable, with NO DEFAULT and NO ``NOT NULL``. Do not
"tidy" that.** A future author reading a table of counts will be tempted to add
``DEFAULT 0`` so the column is never null. That would destroy the dimension.

An unmeasured count MUST be SQL NULL. A zero and an absent reading are
**different facts**:

* ``sock_close_wait_local = 0`` asserts *"we looked at this listener and there
  are no half-closed sockets"* — the healthy reading, and the exact reading the
  baseline in this plan's evidence carries.
* ``sock_close_wait_local IS NULL`` asserts *"we do not know"* — no ``ss``, no
  ``netstat``, a publisher predating the probe, or a probe that failed.

Conflating them is not a hypothetical. It is precisely what made the 2026-08-27
saturation dimension invisible, and ``fleet_res_tel_04`` writes the rule out at
length for its own columns: a fabricated ``0`` *"does not merely misreport — it
inverts the reading."* The inversion is sharper here, because the whole point of
this lane is to distinguish a listener with 148 stuck sockets from one with
none, and ``DEFAULT 0`` would write the second answer onto every row sent by a
publisher that cannot probe at all — which is **every runner on the fleet**
until the publisher ships.

Note that ``0`` is a legitimate stored value, and an important one: it is the
baseline the plan's growth measurement is taken against. So the rule is not
"zero is forbidden" — it is "zero must be MEASURED". Only a publisher that
actually ran a probe may write one.

This is the fifth spelling of the same fleet rule:

* ``fleet_res_tel_01`` — every metric column nullable, NULL on an unprobed lane
  (*"a probe that fails must degrade to NULL, never to a fabricated zero"*);
* ``fleet_res_tel_03`` — NULL means "no override", where ``0`` would *disable*
  the guard the column names;
* ``fleet_res_tel_04`` — NULL on the saturation counts, where ``0`` renders as
  perfectly idle on the axis built to catch a box at 99.3%;
* ``process_health.rs`` — ``UNMEASURED = -1`` on the Prometheus gauges, because
  Prometheus has no NULL.

Why LOCAL and REMOTE ``CLOSE_WAIT`` are two columns and not one
===============================================================

This is the column pair that carries the diagnosis, and collapsing it would
throw the finding away.

``CLOSE_WAIT`` means *the peer sent FIN and this side has not closed its
descriptor*. Which side is leaking is entirely determined by which end of the
socket the probe port sits on:

* ``sock_close_wait_local`` — the probe port is the **local** port, so the
  socket is **server-side** and the fd belongs to the runner. A *sustained*
  population here would indict the runner. Note carefully that the 2026-08-31
  reading did **not** establish one: a transient count is the ordinary result
  of bare TCP probes arriving, and it drains sub-second. Only a count that
  persists across samples means anything.
* ``sock_close_wait_remote`` — the probe port is the **remote** port, so the
  socket is **client-side** and the fd belongs to some probe process on the same
  box (a health-check script, a monitoring loop). These do not starve the
  listener's accept path at all; they indict the CLIENT.

A single summed ``close_wait`` column reads identically in both cases while
naming two different culprits in two different processes. Sockets are also
counted from the perspective of the whole host, not one process, so a probe run
on the same machine as the listener sees both ends of a loopback connection —
which is exactly the arrangement on this fleet, where ``:9876`` is probed from
``127.0.0.1``. The split is what makes the census legible from that vantage.

``sock_established_local`` and ``sock_time_wait_local`` are the controls. They
are the denominator that turns a raw ``CLOSE_WAIT`` count into a verdict about
the listener rather than about traffic volume, and ``TIME_WAIT`` specifically
distinguishes a listener that is churning connections normally from one that has
stopped reaping. All three ``*_local`` columns are counted on the same side, so
they are comparable with each other; ``sock_close_wait_remote`` is NOT and must
never be summed into them.

``sock_probe_port`` — the census is scoped to ONE listener
==========================================================

Every count on the row is *"on this port"*, and without the port the numbers
are uninterpretable. It is a column rather than a constant because this fleet
runs several runners per box: ``9876`` is the primary and ``9877`` / ``9878``
are secondaries (``runner-instances.md``), and the whole diagnosis on 2026-08-31
depended on the counts being attributable to one of them while its neighbours
read clean.

NULL here means the row carries **no socket census at all**, which is the state
of every row until the publisher ships. A row with a NULL ``sock_probe_port``
and non-NULL counts is malformed — the counts have no subject — and a consumer
should treat that combination as unmeasured rather than guessing a port.

The scope is per (device, lane, port). A device that wants a census on two
listeners emits two rows, on the existing ``(device_id, lane, lane_instance)``
anchor, exactly as the CI publishers already do with ``lane_instance``. Nothing
here adds a new anchor dimension, and nothing here changes the anchor index.

``sock_source`` is provenance, and it gets NO CHECK
===================================================

``'ss'`` | ``'netstat'`` | ``'unavailable'``, or NULL.

The instruments disagree in ways that change what the numbers mean.
``ss -tan`` reads ``/proc/net/tcp`` through the netlink ``sock_diag`` interface
and reports every socket the kernel holds; ``netstat -an`` on Windows is a
different implementation with different truncation behaviour under load, and it
is the only one available on the ``host`` lane of this fleet. A publisher that
tries ``ss``, fails, and falls back to ``netstat`` emits numbers on a different
footing with **nothing else in the row saying so** — the identical hazard
``fleet_res_tel_04`` documents for ``saturation_source``, and the reason that
column exists.

``'unavailable'`` is the third value and it is not a nuisance case: it is the
publisher stating *"I ran, and neither instrument was reachable"*, which is
strictly more informative than NULL (*"nothing said anything"*). A row may
therefore legitimately carry ``sock_source = 'unavailable'`` with all four
counts NULL, and that is a MEASUREMENT — it tells an operator the probe is
wired up and the tooling is missing, not that the runner predates the feature.

No CHECK constraint, on the same two grounds ``fleet_res_tel_04`` argues for
``saturation_source``, and by the split ``fleet_res_tel_01`` drew between
CHECKed ``lane`` (a closed set of resource pools) and free-text ``source``
(provenance whose vocabulary grows with publishers):

1. **The set is open.** A Windows-native arm (``GetExtendedTcpTable``), a
   ``/proc/net/tcp`` direct reader, or a container runtime that reports neither
   are all plausible additions, and a CHECK would force a migration per
   publisher class.
2. **A CHECK would cost the numbers this plan exists to capture.** Ingest is
   best-effort by contract (``fleet_res_tel_01``: persist failures log WARN and
   the handler still returns 200), and a CHECK violation fails the whole INSERT
   — so an unrecognised *provenance label* would discard the memory, disk,
   build-slot and saturation metrics on the same row. Rejecting a sample because
   we did not recognise the name of the instrument that took it is backwards
   during an incident, which is the only time these rows matter.

Validated app-side at the door instead, the same stance ``fleet_res_tel_03``
takes for the control columns' ranges.

Types are chosen by the consumer, not here
==========================================

The five numeric columns (the port plus the four counts) are ``INTEGER``,
**not** ``BIGINT``, and this is deliberate
divergence from ``fleet_res_tel_04`` rather than an oversight.

``fleet_res_tel_04`` chose ``BIGINT`` because coord reads its columns with
``row.get(...)`` into ``Option<i64>``, and an ``i64`` read off an ``INTEGER``
column is a **runtime type error** in tokio-postgres — not a widening. The same
constraint applies in the other direction, and the deciding fact is what the
neighbouring columns on THIS table already do: ``cpu_cores``,
``build_slots_total``, ``build_slots_busy``, ``build_queue_depth`` and
``ci_jobs_running`` are all ``INTEGER`` (``fleet_res_tel_01``) and coord reads
every one of them as ``Option<i32>`` (``device_resource_samples.rs``). A socket
census belongs with those, not with the byte counters.

It is also correct at the value level rather than merely conventional. A port is
bounded by 65535. A per-listener socket count is bounded by the process
descriptor ceiling, which is ~10^4-10^6 — unlike a kernel task table, it does
not scale by orders of magnitude between machine classes, and 148 was the
incident reading.

**So the coord side must read these as ``Option<i32>``.** That is an interface
obligation this file cannot enforce, stated here because the failure is a panic
rather than a degrade.

``IF NOT EXISTS`` on the ADDs is **type-blind** — it matches on name alone, so a
column of the right name and wrong type makes the ADD a silent no-op and leaves
the wrong type in place, where ``row.get`` will **panic** rather than return a
degradable SQLSTATE. Re-running ``upgrade()`` is not a repair for that; fix it
with an explicit ``ALTER COLUMN … TYPE`` in a new revision.

Degrade obligation on the coord side
====================================

Unchanged from ``fleet_res_tel_01``, and it runs the other way: the coord PR
that reads these columns must degrade on a missing column
(``pg_error::is_missing_schema_object``, SQLSTATE 42703) so a coord deploy that
lands ahead of this migration fails open rather than erroring. Note that
``is_missing_schema_object`` swallowing 42703 also means a **typo'd column name
idles forever with no error** — so the names above are an interface, and the
coord side must match them exactly rather than relying on a failure to notice.

No new index
============

Deliberately, and for the same reason ``fleet_res_tel_04`` gives. These columns
are read on rows the anchor index (``idx_device_resource_samples_anchor_sampled``)
already selects, and the heap tuple is fetched anyway. Nothing filters or orders
*by* them — this lane feeds no ranking at all, by design (see "Reporting, NOT
ranking" above), so there is not even a candidate ORDER BY. An extra index on an
append-only table written every 30 s would cost maintenance on every insert to
serve no query.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. Every column is nullable with no default, so
each ADD is a catalogue update with no table rewrite; the brief
``ACCESS EXCLUSIVE`` lock is immeasurable on this table.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_res_tel_05_socket_census"
down_revision: str | Sequence[str] | None = "pmf_scope_cols_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The family *name* carries the lineage (`fleet_res_tel_04` is the sibling that
# added the saturation columns to this same table); the down_revision does NOT.
# `fleet_res_tel_04` has not been the chain head since 2026-08-27 and pointing
# at it would fork the graph — which `alembic-graph-pr.yml`'s `alembic-heads-pr`
# job (a required check on `web-protect-main`) fails the PR for.
#
# down_revision is therefore the LOCAL head at authoring time, computed with the
# repo's own gate: `python scripts/ci/count_alembic_heads.py` over 521 revision
# files reported `HEAD_COUNT=1 / HEAD=pmf_scope_cols_01` at origin/main
# `e9f7496a`.
#
# It is NOT `coordtouch_01`, which this revision was originally briefed to
# revise. `coordtouch_01` is not a head and has not been one for some time —
# `grantorig_01_operator_roles_grant_origin.py` already revises it, so pointing
# here would have produced an immediate two-head fork. Read `down_revision` off
# a live head computation, never off a name or a brief.
#
# That head can MOVE between authoring and the first CI run; `fleet_res_tel_04`
# was re-pointed twice for exactly that reason. A stale local head is expected
# on a busy repo, which is why the fork check is a REQUIRED status check and not
# a lint — rebase onto the new head when it fires.

_TABLE = "coord.device_resource_samples"

# The one column list, spelled once. The upgrade's ADDs and the downgrade's
# DROPs are generated from it so they cannot drift into different sets — the
# same construction `fleet_res_tel_03` and `fleet_res_tel_04` use.
#
# INTEGER, not BIGINT: see "Types are chosen by the consumer" in the docstring.
# The coord reader must use `Option<i32>`.
_SOCKET_CENSUS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("sock_probe_port", "INTEGER"),
    ("sock_close_wait_local", "INTEGER"),
    ("sock_close_wait_remote", "INTEGER"),
    ("sock_established_local", "INTEGER"),
    ("sock_time_wait_local", "INTEGER"),
    ("sock_source", "TEXT"),
)


def _add_columns(table: str) -> str:
    """One ALTER carrying every column, so the table can never get a subset."""
    adds = ",\n            ".join(
        f"ADD COLUMN IF NOT EXISTS {name} {sql_type}"
        for name, sql_type in _SOCKET_CENSUS_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {adds}"


def _drop_columns(table: str) -> str:
    """The exact inverse of [`_add_columns`], over the same one list."""
    drops = ",\n            ".join(
        f"DROP COLUMN IF EXISTS {name}" for name, _ in _SOCKET_CENSUS_COLUMNS
    )
    return f"ALTER TABLE {table}\n            {drops}"


def upgrade() -> None:
    """Add the six socket-census columns to coord.device_resource_samples.

    Every column is NULLABLE with NO DEFAULT. That is the load-bearing property
    of this revision, not tidiness — see the module docstring's "NULL is not
    zero" section before changing it.
    """
    op.execute(_add_columns(_TABLE))

    # Column comments carry what a name cannot: which side of the socket each
    # count is taken from, that NULL is never zero here, and — for sock_source —
    # that the counts are uninterpretable without knowing the instrument. `\\d+`
    # is where a human meets this schema; the docstring above ships nowhere an
    # operator sees.
    #
    # NOTE for a future editor: the `''` inside these bodies are SQL's escaped
    # apostrophe and must stay BARE. Writing them `\'\'` is inert to Python in a
    # non-raw triple-quoted string, so Postgres receives identical SQL either
    # way — but `_alembic_harness.comment_body_from_source` strips SQL string
    # literals and asserts the remainder is blank, and a stray backslash
    # survives that strip and aborts it.
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.sock_probe_port IS
            'The single listener port this row''s socket census was taken on — '
            '9876 (primary runner), 9877 / 9878 (secondaries). Every sock_* '
            'count on the row is scoped to THIS port and is meaningless '
            'without it. NULL = the row carries no socket census at all, which '
            'is every row until a publisher ships. A NULL port with non-NULL '
            'counts is malformed (counts with no subject) and a consumer must '
            'read it as unmeasured rather than guess a port. A device censusing '
            'two listeners emits two rows on the existing (device_id, lane, '
            'lane_instance) anchor; this adds no anchor dimension. INTEGER: '
            'coord reads it as Option<i32>, like every other INTEGER on this '
            'table (cpu_cores, build_slots_*, ci_jobs_running).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.sock_close_wait_local IS
            'Sockets in CLOSE_WAIT where sock_probe_port is the LOCAL port — '
            'i.e. SERVER-side, the listener''s own process owns the descriptor. '
            'The peer sent FIN and this side has not yet closed its fd. A '
            'TRANSIENT count here is ORDINARY - bare TCP probes (a port check '
            'that sends no request) produce it one-for-one and it drains sub-second; '
            'full HTTP request/response cycles produce none. Only a count that '
            'PERSISTS across samples indicts the listener. The 2026-08-31 '
            'reading of 148 was NOT such a leak - vetting refuted it by '
            'measurement, and an earlier plan had already recorded the same '
            'signal as transient. NULL = not probed '
            '(no ss, no netstat, or a publisher predating the probe). NEVER a '
            'fabricated 0 — a MEASURED 0 is the healthy baseline this plan''s '
            'growth figure is taken against, so 0 and NULL are different facts '
            'and only a publisher that actually ran a probe may write the 0. '
            'REPORTING ONLY: this must not gate dispatch or feed lane_pressure '
            '/ lane_saturation / headroom.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.sock_close_wait_remote IS
            'Sockets in CLOSE_WAIT where sock_probe_port is the REMOTE port — '
            'i.e. CLIENT-side, some probe process on this box owns the '
            'descriptor, not the listener. Split from sock_close_wait_local '
            'because the two name different culprits in different processes '
            'while a summed column reads identically for both: a client-side '
            'leak does not starve the listener''s accept path at all. The split '
            'is what makes a loopback census legible, since a probe on the same '
            'host as the listener sees BOTH ends of every 127.0.0.1 connection. '
            'Not comparable with the *_local columns and must never be summed '
            'into them. NULL = not probed, never a fabricated 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.sock_established_local IS
            'Sockets in ESTABLISHED where sock_probe_port is the LOCAL port. A '
            'control, not a symptom: it is the denominator that turns a raw '
            'CLOSE_WAIT count into a verdict about the LISTENER rather than '
            'about traffic volume. Same side as sock_close_wait_local and '
            'sock_time_wait_local, so the three are comparable with each other. '
            'NULL = not probed, never a fabricated 0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.sock_time_wait_local IS
            'Sockets in TIME_WAIT where sock_probe_port is the LOCAL port. The '
            'second control: TIME_WAIT is the normal terminal state of a '
            'connection the SERVER closed, so it distinguishes a listener '
            'churning connections healthily from one that has stopped reaping '
            'them. A high CLOSE_WAIT beside a near-zero TIME_WAIT is the '
            'signature of the 2026-08-31 fault; a high CLOSE_WAIT beside a high '
            'TIME_WAIT is ordinary load. NULL = not probed, never a fabricated '
            '0.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.sock_source IS
            'Which instrument produced the sock_* counts: ss | netstat | '
            'unavailable, or NULL when unrecorded. Not bookkeeping — ss reads '
            'the kernel''s sockets over netlink sock_diag while Windows netstat '
            'is a different implementation with different truncation behaviour '
            'under load, and it is the only one available on this fleet''s host '
            'lane, so a publisher that tries ss, fails and falls back emits '
            'numbers on a different footing with nothing else in the row saying '
            'so (the hazard saturation_source exists for, one lane over). '
            'The value ''unavailable'' is a MEASUREMENT, not an absence: it '
            'means the '
            'publisher ran and neither instrument was reachable, which is '
            'strictly more informative than NULL (nothing said anything) — so a '
            'row may carry sock_source = ''unavailable'' with all four counts '
            'NULL. Free text, NOT CHECKed: the set is open (a Windows-native '
            'GetExtendedTcpTable arm or a /proc/net/tcp reader are plausible '
            'additions) and a CHECK violation would fail the whole best-effort '
            'INSERT, discarding the memory, disk and saturation metrics on the '
            'row over a provenance label. Validated app-side at the door, the '
            'same split as this table''s CHECKed lane vs free-text source.'
        """
    )


def downgrade() -> None:
    """Drop the six socket-census columns. Exact reverse of upgrade().

    The COMMENTs go with the columns — a column comment has no independent
    existence to drop. The TABLE belongs to ``fleet_res_tel_01`` and is left
    alone, as are all pre-existing sample rows.
    """
    op.execute(_drop_columns(_TABLE))
