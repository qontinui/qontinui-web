"""project.co_occurrence_observations — backfill app_id for the runner corpus

Revision ID: obsappfill_01
Revises: probe_base_01
Create Date: 2026-08-14

Phase 3 of plan ``2026-08-14-f1-observation-app-scoping`` (web PR **B**, the
first of that plan's three PRs). ``appid_01_co_occurrence_app_id`` added the
``app_id`` column on 2026-07-27 and nothing has written it since, so it is
``NULL`` on 100% of rows. This revision attributes that historical corpus to
``qontinui-runner``.

This SUPERSEDES appid_01's "NOT backfilled — deliberately"
==========================================================

``appid_01_co_occurrence_app_id`` states, in its own docstring, under the
heading *"Nullable, and NOT backfilled — deliberately"*:

    "Existing rows carry no app attribution and there is no source of truth
    from which to derive one … Any backfill would be a guess written into a
    column that consumers must be able to trust, so historical rows keep
    ``NULL`` and mean exactly 'app unknown'."

**That paragraph is superseded by this revision and must not be read as the
live contract.** Its premise — "there is no source of truth from which to
derive one" — was true *in general* and false *for this corpus*. It reasoned
about the columns available on the row (``runner_instance`` identifies a
process, not an app, which remains correct); it did not reason about the
producer, which is where the attribution actually is. The rest of appid_01
stands unchanged: the column is still nullable, ``NULL`` still means "app
unknown", and consumers must still treat it as un-attributed. What changed is
only that, after this revision, there are no ``NULL`` rows *left* that were
written before the producer existed.

Why this is provable, not a guess
=================================

Every row in the table demonstrably originated from ``qontinui-runner``. The
proof is a closed enumeration of the write paths, verified against
``qontinui-runner`` ``origin/main`` = ``41569ea9`` on 2026-08-14:

1. **One writer.** ``enqueue_observation``
   (``qontinui-runner:src-tauri/src/state_discovery/capture.rs``) holds the
   only ``INSERT INTO co_occurrence_observations`` in the tree.
2. **One call site.** That function is called exactly once, from
   ``qontinui-runner:src-tauri/src/mcp/ui_bridge/elements.rs:2746``, inside
   the snapshot handler's fire-and-forget ``tokio::spawn``.
3. **That call site can only reach the runner's own frontend.** The handler
   obtains its snapshot through ``ui_bridge_request_sync``, which dispatches
   by ``window_label`` — the runner's own webview — never by app. The
   separate WS/app-registry dispatch path (``try_ws_dispatch_for_app``),
   which is the only way another registered app could answer, is not used by
   snapshot capture. The call site's own comment says so:
   *"the caller has no scope knowledge the snapshot doesn't already carry."*
4. **The native-capture fallback writes nothing.** Element-less snapshots
   early-return on the ``elements.is_empty()`` guard at ``capture.rs:109``,
   before any INSERT — so that path cannot have produced rows either.
5. **There is no ingest endpoint.** ``/observations/snapshot`` is a *read*
   endpoint, not a write path; no HTTP surface accepts observations from an
   external producer.

Paths 1–5 exhaust the ways a row can exist. Therefore ``app_id IS NULL``
today is not "app unknown" in the epistemic sense appid_01 meant; it is
"nobody had written the column yet", and the app is known to be
``qontinui-runner``.

The guard: valid ONLY while the runner is the sole producer
===========================================================

The predicate is deliberately unbounded (``WHERE app_id IS NULL``, no
``captured_at`` ceiling), which is correct only because the enumeration above
holds *right now*. Two consequences, both load-bearing:

* **This migration must be applied BEFORE the runner starts stamping
  ``app_id``** (that is Phase 2 of the same plan, runner PR A, which lands
  *after* this one for exactly this reason). Once the producer ships, an
  absent or unregistered ``appId`` on the snapshot writes ``NULL``
  **deliberately**, meaning "app unknown" in the full appid_01 sense. From
  that moment an unbounded ``WHERE app_id IS NULL`` would overwrite a
  deliberate NULL with a fabricated attribution — a confidently-wrong,
  permanent write. Re-running this revision after Phase 2 has deployed would
  do precisely that.
* **Any second capture entry point invalidates the proof.** Wiring
  qontinui-web or qontinui-supervisor into capture (a recorded follow-up of
  the same plan) breaks step 3 of the enumeration. That work must not start
  before this migration has been applied, and whoever does it must not reuse
  this unbounded predicate.

Accepted residual: rows captured between this migration applying and Phase 2
deploying stay ``NULL``. They are runner-produced but un-attributed, so the
strict app-scoped query in Phase 4 will not see them. That is
under-attribution, never mis-attribution — the safe direction — and the
window is one deploy wide. A follow-up sweep can claim them bounded by
``captured_at`` against the then-known producer deploy time.

No index work
=============

None is needed. ``appid_01`` already widened ``idx_observations_spec`` to
``(spec_id, app_id, captured_at) WHERE invalidated_at IS NULL``. This
revision only rewrites a column value.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# ``down_revision`` chains off the single web head at authoring time
# (``probe_base_01``, computed with the ``alembic-heads-pr`` gate's own
# offline scan: 487 revisions, exactly one head). Keep this on ONE physical
# line and ``revision`` at column 0 — that gate parses both with line-anchored
# regexes under ``re.M``, so a wrapped tuple silently drops parents and
# manufactures a phantom extra head.
revision: str = "obsappfill_01"
down_revision: str | Sequence[str] | None = "probe_base_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Attribute every un-attributed observation to ``qontinui-runner``.

    Safe to re-run **only until the Phase 2 producer deploys** — see the
    module docstring's guard. After that point a ``NULL`` is a deliberate
    "app unknown" and must never be overwritten.
    """
    op.execute("SET search_path TO project, public")
    op.execute(
        "UPDATE co_occurrence_observations SET app_id = 'qontinui-runner' "
        "WHERE app_id IS NULL"
    )


def downgrade() -> None:
    """Restore ``NULL`` for every row currently attributed to the runner.

    **This is lossy and cannot be otherwise.** The downgrade cannot
    distinguish a row this migration backfilled from a row the Phase 2
    producer legitimately stamped ``'qontinui-runner'`` later — the column
    holds the same value in both cases and there is no provenance marker to
    separate them. Running this after the producer has shipped therefore
    discards *stated* attribution alongside the *inferred* attribution it was
    meant to undo, and re-running ``upgrade()`` will not restore the
    distinction (it re-attributes every NULL, including any that were
    deliberate).

    It is kept only so the revision is reversible in the alembic sense. Prefer
    stepping the chain back on a scratch database, not on a corpus anyone
    reads.
    """
    op.execute("SET search_path TO project, public")
    op.execute(
        "UPDATE co_occurrence_observations SET app_id = NULL "
        "WHERE app_id = 'qontinui-runner'"
    )
