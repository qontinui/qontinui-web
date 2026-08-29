"""coord prompt_documents - restore ``agent_writable`` for the deploy window

Revision ID: pdtier_02
Revises: fleet_res_tel_04
Create Date: 2026-08-27

A DEPLOY-WINDOW SHIM, and it is meant to be short-lived
=======================================================

``pdtier_01`` added ``agent_write_tier`` **and dropped** ``agent_writable`` in
one revision. The add half was correctly ordered - coord must not read a column
before its migration lands. The **drop** half was not: a column may only be
dropped once every deployed consumer has stopped reading it, and coord had not.

Measured in production 2026-08-27, minutes after ``pdtier_01`` landed. Deployed
coord (``faf33f98``) still ran::

    SELECT agent_writable FROM coord.prompt_documents
     WHERE tenant_id = $1 AND kind = $2 AND name = $3

in ``policy_proposals::read_agent_writable`` - the **enforcement** read on every
agent prompt-document write. With the column gone it raises 42703, which
``is_missing_schema_object`` maps to ``FlagRead::SchemaMissing``, which
``resolve_agent_write`` resolves - deliberately, correctly - to DENY. So every
agent policy write in the fleet was refused fail-closed, with a message that
misdiagnosed its own cause ("coord is serving ahead of its qontinui-web
migration"; the truth was the exact reverse). Confirmed by probe: an append to
``audience_profile/example-audience`` returned that refusal verbatim.

This revision restores the column so the deployed build works again. It does
NOT undo ``pdtier_01``: ``agent_write_tier`` and
``coord.prompt_document_kind_tiers`` stay exactly as that revision left them.

What was NOT broken, so the blast radius is not overstated
==========================================================

Two of the three reads were already guarded, and the guards did their job:

* ``prompt_documents::apply_document_edit_tx`` probes
  ``information_schema.columns`` before its version-snapshot INSERT and takes a
  column-less branch when absent - so **operator edits kept working**.
* ``prompt_documents::decorate_summaries_access`` catches the query error and
  degrades the admin list to "access unknown" - **degraded display, not an
  outage**.

Only the enforcement read was unguarded, and it is the one that decides writes.

Backfill, and why it is exactly reversible today
================================================

============================  ======================
``agent_write_tier``          ``agent_writable``
============================  ======================
``'allow'``                   ``TRUE``
``'deny'``                    ``FALSE``
``'allow_with_notification'`` ``FALSE``
``NULL``                      ``NULL``
============================  ======================

``allow_with_notification`` collapsing to ``FALSE`` is the same lossy step
``pdtier_01``'s downgrade documents, and ``FALSE`` rather than ``TRUE`` so a
restoration can never silently widen authority.

**Today the collapse is unreachable, and that is worth stating rather than
assuming.** Nothing writes tiers yet: ``pdtier_01`` derived every value from the
old boolean, no coord door writes ``coord.prompt_document_kind_tiers`` at all,
and the coord consumer that would write ``allow_with_notification`` is still an
unlanded draft. So every stored tier is currently the image of a boolean, and
this backfill returns precisely the values ``pdaw_01`` held.

WARNING - READ THIS BEFORE WRITING ``pdtier_03`` (the real drop)
================================================================

This shim leaves TWO columns holding one fact, and during the window **the
deployed build writes only the boolean**: coord's tenant-admin PATCH sets
``agent_writable``, and the tier column is not updated with it. So the moment an
operator changes an agent-write setting while this shim is live, the tier goes
STALE, and the coord consumer that reads the tier would read a value the
operator never chose.

Therefore ``pdtier_03`` - the revision that finally drops ``agent_writable``,
once the coord consumer (qontinui-coord#1673) is DEPLOYED, not merely merged -
**must re-backfill the tier from the boolean before dropping it**::

    UPDATE coord.prompt_documents
       SET agent_write_tier = CASE WHEN agent_writable THEN 'allow' ELSE 'deny' END
     WHERE agent_writable IS NOT NULL

Dropping without that re-backfill silently reverts every operator decision made
during the window. Do not treat ``pdtier_01``'s forward migration as sufficient
just because it looks identical - it ran against a different state.

The ordering rule this whole pair exists to teach
=================================================

An ADD lands before its consumer. A DROP lands after its last reader is gone.
``pdtier_01`` did both in one revision, so one half was necessarily wrong. Split
them next time.

Hand-authored; never ``alembic revision --autogenerate`` (served policy
``production-and-cost`` ``alembic-sole-authorship``).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "pdtier_02"
down_revision: str | Sequence[str] | None = "fleet_res_tel_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Both tables, from one list - `pdaw_01` put the boolean on the parent AND the
# version snapshot, and `pdtier_01` dropped it from both.
_TABLES = ("coord.prompt_documents", "coord.prompt_document_versions")

_LEGACY_COLUMN = "agent_writable"
_TIER_COLUMN = "agent_write_tier"

# `pdaw_01`'s comment bodies, restored with the column so the catalog reads the
# same as it did before `pdtier_01` took them with the DROP.
_COMMENTS = {
    "coord.prompt_documents": (
        "Operator-controlled per-document agent write access. NULL = no operator "
        "opinion (the compile-time default decides)."
    ),
    "coord.prompt_document_versions": (
        "Snapshot of the parent agent_writable at the time this version was written."
    ),
}

# Guarded on the TIER column, because that is the one the UPDATE READS.
# `pdtier_01` shipped a defect of exactly this shape - a probe naming one table
# while the statement read another - and the fix was to gate on what is read.
_BACKFILL = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_attribute att
         WHERE att.attrelid = to_regclass('{table}')
           AND att.attname = '{tier}'
           AND att.attnum > 0
           AND NOT att.attisdropped
    ) THEN
        EXECUTE $sql$
            UPDATE {table}
               SET {legacy} = ({tier} = 'allow')
             WHERE {tier} IS NOT NULL
        $sql$;
    END IF;
END
$$
"""


def upgrade() -> None:
    """Restore the boolean and backfill it from the tier, on both tables."""
    for table in _TABLES:
        # IF NOT EXISTS so a re-run is a no-op. It is type-blind (matches on
        # name alone), which is safe here for the reason `pdtier_01` gave: the
        # only way a same-named column of another type exists is a hand edit,
        # and the UPDATE below would then fail loudly on the type rather than
        # quietly storing the wrong thing.
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {_LEGACY_COLUMN} BOOLEAN"
        )
        op.execute(
            _BACKFILL.format(table=table, tier=_TIER_COLUMN, legacy=_LEGACY_COLUMN)
        )
        op.execute(
            f"COMMENT ON COLUMN {table}.{_LEGACY_COLUMN} IS '{_COMMENTS[table]}'"
        )


def downgrade() -> None:
    """Drop the boolean again, returning to the state `pdtier_01` left.

    Lossless with respect to THIS revision: every value in `agent_writable` was
    derived from `agent_write_tier`, which is untouched and stays.

    NOT lossless with respect to the deploy window - see the WARNING block in
    the module docstring. If the deployed build wrote `agent_writable` while
    this shim was live, those operator decisions live ONLY in the boolean, and
    this downgrade discards them. Re-backfill the tier first if that applies.
    """
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {_LEGACY_COLUMN}")
