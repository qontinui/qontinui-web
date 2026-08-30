"""coord.prompt_document_versions — the two landed-write annotations

Revision ID: pdann_01
Revises: cgaudit_01
Create Date: 2026-08-29

Originally cut against ``session_repo_01_session_artifacts``, which was the
single head at authoring time. ``coord_agent_questions_audience`` and then
``cgaudit_01`` landed on that same parent while this branch was in flight, so
the declared parent was moved to main's new head rather than left to fork the
chain — the ``alembic-single-head`` gate's whole subject.

Phase 4's data path, plan
``D:/qontinui-root/plans/2026-08-27-tenant-level-agent-authorable-stores.md``.

Hand-authored; never ``alembic revision --autogenerate`` (served policy
``production-and-cost`` ``alembic-sole-authorship``). coord authors zero
``coord.*`` DDL, so every column its writer or reader touches lands here first.

What this adds, and to WHICH table only
=======================================

Two nullable columns on ``coord.prompt_document_versions`` — the version
snapshot — and on **nothing else**::

    loosening         BOOLEAN  NULL
    notification_ref  UUID     NULL

Both are properties of ONE WRITE, not of the document:

* ``loosening`` is coord's direction verdict for the edit that produced this
  version. Under the tenant's ``policy_write`` dial at ``full`` a classified
  loosening LANDS rather than being held as a proposal (Phase 3), and that is
  the write an operator most wants at the top of the review feed — an agent
  editing the rules it is judged by. The verdict belongs to the version that
  was classified; a later version can carry the opposite verdict.
* ``notification_ref`` is the ``coord.findings.finding_id`` the write call
  carried, so the feed row reaches the author's stated reasoning in one click
  instead of the operator correlating two surfaces by timestamp (Phase 2).

**This does NOT violate the parent/snapshot widening rule**, and the direction
is worth stating because ``pdaw_01`` and ``pdtier_01`` both widened both
tables. ``fleet_res_tel_02`` wrote the rule into the versions table's own
``COMMENT ON TABLE`` as *"any migration that adds a payload column to the
PARENT must add it here too"* — parent → snapshot, because a snapshot missing
a payload column is an audit trail that lies while still reporting as
versioned. There is no converse rule, and there could not be: a per-write
annotation has no parent-level meaning. ``coord.prompt_documents.loosening``
would have to mean "was the most recent write a loosening", which is a
derived, silently-staleable copy of the head snapshot's value — exactly the
two-columns-one-fact hazard ``pdtier_02``'s WARNING block is about.

Why ``notification_ref`` is ``UUID`` and not ``TEXT``
====================================================

Because that is what a coord finding id IS in this schema. ``coord_findings``
declares ``finding_id UUID PRIMARY KEY DEFAULT gen_random_uuid()``, and the
plan fixes the reference as *"the ``finding_id`` of a coord finding posted by
the same session"*. ``TEXT`` would admit a malformed id that no read can ever
resolve, and would push the only validation into the Rust caller; ``UUID``
makes an unresolvable value unrepresentable at the column.

The type is also load-bearing in the direction ``pdaw_01`` warns about:
``ADD COLUMN IF NOT EXISTS`` is **type-blind**, matching on name alone, so a
pre-existing ``notification_ref`` of another type makes the ADD a silent no-op
and leaves the wrong type in place. coord reads these off the row into
``Option<bool>`` / ``Option<Uuid>``, and a type mismatch **panics** in
``tokio_postgres::Row::get`` rather than raising a SQLSTATE coord can degrade
on. Repair a wrong-typed column with an explicit ``ALTER COLUMN … TYPE`` in a
new revision; re-running ``upgrade()`` will not fix it.

Why there is deliberately NO foreign key to ``coord.findings``
==============================================================

``coord.findings`` is an EXPIRING store — ``FINDINGS_TTL_DEFAULT = "14 days"``
(``findings.rs:34``) — and a version row is immutable history that must outlive
the finding it cites. An FK gives only two behaviours and both are wrong here:

* ``ON DELETE RESTRICT``/``NO ACTION`` makes the annotation block TTL expiry,
  turning an ephemeral coordination channel into a permanent one;
* ``ON DELETE CASCADE`` (or ``SET NULL``) silently erases the annotation — or
  the whole version row — when the finding expires, so the audit trail quietly
  loses the record that a write was ever explained.

So the reference is a SOFT link, and a read that cannot resolve it is expected
rather than exceptional: past the TTL the ref is a durable statement that a
notification existed, not a promise that its body is still fetchable. The
frontend already encodes the same posture from its end — ``notificationHref``
returns ``null`` for an absent ref so no link is rendered rather than a broken
one.

No index either. The only read is "the annotations for the versions I already
selected", which arrives via the existing ``document_id``/``version_number``
access path; an index on a column nothing filters by is write cost with no
reader.

Nullable, no default, NO BACKFILL — absent is not ``false``
===========================================================

``NULL`` is a third state on ``loosening`` and it is the whole contract of this
column: it means *"no direction verdict exists for this write"*. It is a
statement about what RAN, not about the write, and it has several ordinary
causes — the version was produced by a path the classifier does not sit on (an
operator PATCH, a clause recompile, a seed rewrite), or by a coord build that
predates the classification at all. ``false`` means the opposite: the classifier
ran on this write and found no widening. Those are different facts and the
schema must be able to tell them apart — ``fleet_res_tel_03``'s formulation,
applied here.

There is no fourth state, and nothing downstream should imply one. coord holds
the value as ``Option<bool>`` and omits the field entirely when it is ``None``,
so the wire vocabulary a consumer ever sees is ``true`` / ``false`` / absent.

Concretely:

* ``NOT NULL DEFAULT false`` would assert, of every version ever written, that
  coord classified it and cleared it. Every pre-existing row would become a
  false negative that no later read could distinguish from a real verdict.
* A **backfill** does the same thing to history: nothing classified those
  writes, so writing any value onto them manufactures a verdict.

The consumer chain is built to preserve the distinction end to end. The web
proxy ``list_prompt_document_writes`` OMITS the key from a write dict when
coord's version row does not carry it, and the shipped frontend's
``looseningClassificationPresent`` (``_lib/writes.ts``) counts ``true`` and
``false`` only — so it can say "coord classified these and none was a
loosening" exactly when a verdict really arrived. A default or a backfill here
would defeat both, silently, one layer below where either could notice: the
column would report a verdict for every row and the page would believe it.

Deploy ordering — this is the ADD, so it goes FIRST
===================================================

An ADD lands before its consumer; a DROP lands after its last reader is gone.
``pdtier_02``'s docstring is the post-mortem that states that rule, and the
whole reason it exists: ``pdtier_01`` did both directions in one revision, so
one half was necessarily mis-ordered, and the drop half refused every agent
policy write in production for as long as it was live.

This revision is purely the ADD half. It lands and is verified in production
BEFORE the coord change that writes and serves these columns deploys. While it
is in flight the coord side degrades gracefully on its own — the same
``coord_column_exists(tx, "prompt_document_versions", …)`` probe the tier work
already uses — so neither ordering breaks a write; this one merely avoids a
window in which coord's INSERT names a column that is not there.

Nothing reads these columns on the day this lands, and every existing row keeps
``NULL`` on both, which is what makes landing ahead of the consumer a no-op
rather than a behaviour change.

Idempotency: raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the house
convention for ``coord.*`` tables. Both columns are nullable with no default,
so each ADD is a catalogue update with no table rewrite.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "pdann_01"
down_revision: str | Sequence[str] | None = "cgaudit_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The snapshot table ONLY — see "which table only" in the docstring. Named once
# so the upgrade and the downgrade cannot name different tables.
_TABLE = "coord.prompt_document_versions"

# (column, SQL type) pairs, in one list, so an ADD without its matching DROP is
# unrepresentable. `pdaw_01` used the same shape for the same reason.
_COLUMNS: tuple[tuple[str, str], ...] = (
    ("loosening", "BOOLEAN"),
    ("notification_ref", "UUID"),
)


def upgrade() -> None:
    """Add both annotations to the version snapshot table."""
    for column, sql_type in _COLUMNS:
        op.execute(f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS {column} {sql_type}")

    # The comments carry the facts the names cannot: that NULL is a third state
    # on `loosening`, and that `notification_ref` is a soft link into an
    # EXPIRING table.
    #
    # NOTE: no ``:word`` tokens in these strings. alembic routes op.execute of a
    # plain string through SQLAlchemy's ``text()``, which reads ``:kind`` as a
    # BIND PARAMETER and then dies demanding a value for it. `pdaw_01` was bitten
    # by exactly that and the reversibility gate caught it.
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_versions.loosening IS
        'Coord''s direction verdict for the edit that produced THIS version. '
        'TRUE = the write granted or widened authority (it landed rather than '
        'being held, under the tenant''s policy_write dial at full). FALSE = the '
        'classifier ran on this write and found no widening. NULL = no verdict '
        'exists — the version came from a path the classifier does not sit on '
        '(operator PATCH, clause recompile, seed rewrite) or from a build that '
        'predates the classification. That is a statement about what ran, not '
        'about the write. NULL is NOT false, and every consumer preserves the '
        'difference: coord omits the field rather than serving null, the web '
        'proxy omits the key rather than defaulting it, and the operator feed '
        'counts TRUE/FALSE only — so it says "none of these was a loosening" '
        'exactly when a verdict really arrived.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.prompt_document_versions.notification_ref IS
        'The coord.findings.finding_id the write call supplied, carried into the '
        'emitted notification payload so a landed write reaches its author''s '
        'stated reasoning in one click. A SOFT link on purpose — findings expire '
        '(FINDINGS_TTL_DEFAULT ~14 days) while a version row is immutable '
        'history, so a foreign key would either block TTL expiry or erase the '
        'annotation when it fires. An unresolvable ref past the TTL is expected: '
        'it still records that a notification existed. NULL = none supplied, or '
        'a coord build that does not carry one.'
        """
    )


def downgrade() -> None:
    """Drop both annotations. Exact inverse, and safe — which is not automatic.

    ``coord_prompt_docs_05_intent_kinds`` is the counterexample in this same
    directory and is worth naming, because "a downgrade is just the inverse
    DDL" is precisely the assumption it disproves. That revision widens a CHECK
    vocabulary, so its downgrade must NARROW one — and a narrowed CHECK cannot
    coexist with rows that violate it, so the downgrade DELETES documents. That
    is why it restores SEVEN values rather than the original six: restoring six
    would have deleted every ``claude_settings`` row, which a revision about
    intent kinds never created and has no business destroying. Its downgrade is
    lossy by construction and had to be reasoned about value by value.

    This one is not, for three structural reasons:

    1. **Nothing outside these two columns is touched.** No constraint is
       narrowed, no vocabulary shrinks, so no pre-existing row can become
       invalid and no DELETE is ever needed.
    2. **Every value in them was created by this revision's own window.** The
       columns did not exist before it, so a drop cannot discard a fact that
       predates it — the exact property ``pdtier_02``'s downgrade could NOT
       claim, because its shim window let the deployed build write the boolean
       it was restoring.
    3. **They are derived annotations, not source data.** ``loosening`` is
       recomputable by re-running the direction classifier over (before, after)
       bodies that are themselves still stored here; ``notification_ref`` points
       at a row in an expiring table, so it is not a durable record either way.

    What a downgrade DOES cost, stated rather than glossed: annotations recorded
    while it was live are gone, so the operator feed loses its loosening marks
    and notification links for those versions and reverts to the unclassified
    presentation. That degrades a display; it destroys no history and refuses no
    write. Re-running ``upgrade()`` restores the columns empty, not the marks.
    """
    for column, _sql_type in _COLUMNS:
        op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {column}")
