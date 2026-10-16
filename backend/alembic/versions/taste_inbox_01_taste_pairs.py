"""web.taste_pairs + web.taste_label_clock + web.taste_settings — the taste inbox

Revision ID: taste_inbox_01
Revises: route_serving_method_idx_01
Create Date: 2026-10-15

Phase 23 of plan ``2026-10-13-image-generation-and-visual-judgment``
(qontinui-dev-notes/plans). Three tables in the EXISTING web-owned ``web``
schema: the queue of pairwise taste questions the operator answers
asynchronously, the per-tenant label-feed clock, and the per-tenant weekly
labelling budget. Product data, not
orchestration: no ``coord.*`` relation is created, altered or referenced, so
``[policy: alembic-sole-authorship]``'s coord ordering is not engaged.

``down_revision`` is this repo's single alembic head at authoring time; if
another revision lands first, re-point it at the new head and move the
``Revises:`` line above with it (``tests/test_taste_inbox_01_migration.py``
reads the parent from ``down_revision`` itself). Do NOT author an ``alembic
merge`` revision.

Tables
======
``web.taste_pairs``
    One pairwise question: images ``asset_a_sha256`` and ``asset_b_sha256``
    from the tenant's content-addressed store (``web.image_assets``,
    ``image_assets_01``), for the slot ``(repo, slot_id)`` — both NULL for a
    calibration pair that serves no slot. ``capture_a_sha256`` /
    ``capture_b_sha256`` are the in-situ captures of each image on its page
    (Phase 18), both or neither. ``source`` is where the question came from
    (``calibration`` | ``active_learning`` | ``post_hoc``), ``uncertainty``
    (0..1) how unsure its pusher was, ``context`` why it was pushed. The
    answer: ``label`` (``a`` | ``b`` | ``both_bad``) with ``labelled_at`` —
    both or neither — the reason chips (``reasons``, a JSON array), an
    optional ``comment``, an optional ``edit_note`` and an optional edited
    image (``edit_asset_sha256``), and the labeller (``labeller_user_id``).
    ``skipped_at`` / ``skip_count`` move a pair to the back of the queue
    without answering it. ``first_labelled_at`` is when the pair was FIRST
    answered (kept across an undo and a relabel): the weekly budget charges a
    pair once, in that week. ``change_seq`` is the pair's position in the
    tenant's label feed (``GET /taste/labels``), drawn from
    ``web.taste_label_clock`` on every label and every undo. ``undone_*``
    record the most recent undo: when, by whom, whether it removed another
    labeller's answer (``undone_forced``), and the answer it removed
    (``undone_label``, a JSON object) — so an undo is never a silent erase.

``web.taste_label_clock``
    One row per tenant: ``last_seq``, the last label-feed position handed
    out. A label write increments it with ``INSERT … ON CONFLICT DO UPDATE``
    and holds the row lock until it commits, so per tenant the positions are
    handed out in COMMIT order: a reader that has seen position N can never
    later meet a newly committed write below N. That is what lets the taste
    twin page the feed by position without skipping a late commit.

``web.taste_settings``
    One row per tenant: ``weekly_budget``, how many labels the inbox asks for
    in a week. No row means the API's declared default.

Design notes
============

* **Tenant isolation is a constraint.** Every image a pair names is
  referenced through a composite FK ``(tenant_id, <sha>) →
  web.image_assets (tenant_id, sha256)`` — the key Phase 13's
  ``uq_image_assets_tenant_sha256`` provides — so a pair can only name images
  its own tenant holds. The two compared images CASCADE (the pair is about
  them); a capture or an attached edit does not (NO ACTION): an image still
  in use as evidence is not deleted out from under a label.

* **One row per question.** ``uq_taste_pairs_pair`` is unique over the
  tenant, the slot (NULL as ``''``) and the UNORDERED pair
  (``LEAST``/``GREATEST`` of the two hashes): (A, B) and (B, A) are one
  question, so a re-push answers with the existing row instead of a
  duplicate card.

* **The labeller FK** points at ``auth.users`` with ``ON DELETE SET NULL``,
  as the memory store's user facet does: deleting a user keeps their labels
  (the taste twin's training data) and forgets who gave them.

* **CHECK constraints carry explicit stable names** (``ck_taste_*``), so a
  later widening — a new source, a new label — can ``DROP CONSTRAINT <known
  name>``.

Locking: the tables are created EMPTY, but their FKs point at two LIVE
tables, ``web.image_assets`` and ``auth.users``, and creating an FK takes a
SHARE ROW EXCLUSIVE lock on the referenced table (no scan: the referencing
table is empty). Login and the image store write those tables, so the wait is
bounded: every statement that creates or drops such an FK runs under
``SET LOCAL lock_timeout = '3s'`` and a blocked apply fails fast instead of
queueing writers behind it (``SET LOCAL … = DEFAULT`` restores it; ``RESET``
is not an admitted statement). The indexes are built on the table this
revision just created, which coord's migration classifier admits as a
new-table claim.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly. Writes **no rows**.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "taste_inbox_01"
down_revision: str = "route_serving_method_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``web.taste_pairs``, ``web.taste_label_clock`` and
    ``web.taste_settings``."""
    # Bound the wait for the referenced tables' locks (module docstring).
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS web.taste_pairs (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID NOT NULL,
            repo               VARCHAR(200),
            slot_id            VARCHAR(200),
            asset_a_sha256     VARCHAR(64) NOT NULL,
            asset_b_sha256     VARCHAR(64) NOT NULL,
            capture_a_sha256   VARCHAR(64),
            capture_b_sha256   VARCHAR(64),
            source             VARCHAR(16) NOT NULL
                CONSTRAINT ck_taste_pairs_source
                CHECK (source IN ('calibration', 'active_learning', 'post_hoc')),
            uncertainty        DOUBLE PRECISION
                CONSTRAINT ck_taste_pairs_uncertainty
                CHECK (uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 1)),
            context            JSONB NOT NULL DEFAULT '{}'::jsonb
                CONSTRAINT ck_taste_pairs_context_object
                CHECK (jsonb_typeof(context) = 'object'),
            pushed_by          VARCHAR(32) NOT NULL,
            skipped_at         TIMESTAMPTZ,
            skip_count         INTEGER NOT NULL DEFAULT 0
                CONSTRAINT ck_taste_pairs_skip_count
                CHECK (skip_count >= 0),
            label              VARCHAR(16)
                CONSTRAINT ck_taste_pairs_label
                CHECK (label IS NULL OR label IN ('a', 'b', 'both_bad')),
            reasons            JSONB NOT NULL DEFAULT '[]'::jsonb
                CONSTRAINT ck_taste_pairs_reasons_array
                CHECK (jsonb_typeof(reasons) = 'array'),
            comment            TEXT
                CONSTRAINT ck_taste_pairs_comment_length
                CHECK (comment IS NULL OR char_length(comment) <= 2000),
            edit_note          TEXT
                CONSTRAINT ck_taste_pairs_edit_note_length
                CHECK (edit_note IS NULL OR char_length(edit_note) <= 2000),
            edit_asset_sha256  VARCHAR(64),
            labeller_user_id   UUID
                CONSTRAINT fk_taste_pairs_labeller
                REFERENCES auth.users (id) ON DELETE SET NULL,
            labelled_at        TIMESTAMPTZ,
            first_labelled_at  TIMESTAMPTZ,
            change_seq         BIGINT,
            undone_at          TIMESTAMPTZ,
            undone_by_user_id  UUID
                CONSTRAINT fk_taste_pairs_undone_by
                REFERENCES auth.users (id) ON DELETE SET NULL,
            undone_forced      BOOLEAN NOT NULL DEFAULT false,
            undone_label       JSONB,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_taste_pairs_distinct_assets
                CHECK (asset_a_sha256 <> asset_b_sha256),
            CONSTRAINT ck_taste_pairs_slot_whole
                CHECK ((repo IS NULL) = (slot_id IS NULL)),
            CONSTRAINT ck_taste_pairs_captures_paired
                CHECK ((capture_a_sha256 IS NULL) = (capture_b_sha256 IS NULL)),
            CONSTRAINT ck_taste_pairs_label_time
                CHECK ((label IS NULL) = (labelled_at IS NULL)),
            CONSTRAINT ck_taste_pairs_labelled_first
                CHECK (label IS NULL OR first_labelled_at IS NOT NULL),
            CONSTRAINT ck_taste_pairs_labelled_seq
                CHECK (label IS NULL OR change_seq IS NOT NULL),
            CONSTRAINT ck_taste_pairs_undo_whole
                CHECK ((undone_at IS NULL) = (undone_label IS NULL)),
            CONSTRAINT ck_taste_pairs_undo_object
                CHECK (undone_label IS NULL OR jsonb_typeof(undone_label) = 'object'),
            CONSTRAINT fk_taste_pairs_asset_a
                FOREIGN KEY (tenant_id, asset_a_sha256)
                REFERENCES web.image_assets (tenant_id, sha256) ON DELETE CASCADE,
            CONSTRAINT fk_taste_pairs_asset_b
                FOREIGN KEY (tenant_id, asset_b_sha256)
                REFERENCES web.image_assets (tenant_id, sha256) ON DELETE CASCADE,
            CONSTRAINT fk_taste_pairs_capture_a
                FOREIGN KEY (tenant_id, capture_a_sha256)
                REFERENCES web.image_assets (tenant_id, sha256),
            CONSTRAINT fk_taste_pairs_capture_b
                FOREIGN KEY (tenant_id, capture_b_sha256)
                REFERENCES web.image_assets (tenant_id, sha256),
            CONSTRAINT fk_taste_pairs_edit_asset
                FOREIGN KEY (tenant_id, edit_asset_sha256)
                REFERENCES web.image_assets (tenant_id, sha256)
        )
        """
    )

    # One row per unordered pair of images per slot (a calibration pair's
    # slot is NULL, compared as '').
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_taste_pairs_pair
            ON web.taste_pairs (
                tenant_id,
                COALESCE(repo, ''),
                COALESCE(slot_id, ''),
                LEAST(asset_a_sha256, asset_b_sha256),
                GREATEST(asset_a_sha256, asset_b_sha256)
            )
        """
    )

    # The queue read (unanswered pairs) and the budget read (labels this week).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_taste_pairs_pending
            ON web.taste_pairs (tenant_id, created_at)
            WHERE label IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_taste_pairs_labelled
            ON web.taste_pairs (tenant_id, labelled_at)
            WHERE label IS NOT NULL
        """
    )

    # The label feed's position: unique per tenant, the twin's page key.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_taste_pairs_change_seq
            ON web.taste_pairs (tenant_id, change_seq)
            WHERE change_seq IS NOT NULL
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS web.taste_label_clock (
            tenant_id  UUID PRIMARY KEY,
            last_seq   BIGINT NOT NULL
                CONSTRAINT ck_taste_label_clock_positive
                CHECK (last_seq >= 1)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS web.taste_settings (
            tenant_id           UUID PRIMARY KEY,
            weekly_budget       INTEGER NOT NULL
                CONSTRAINT ck_taste_settings_budget
                CHECK (weekly_budget BETWEEN 1 AND 1000),
            updated_by_user_id  UUID
                CONSTRAINT fk_taste_settings_updated_by
                REFERENCES auth.users (id) ON DELETE SET NULL,
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the three tables. The ``web`` schema and ``web.image_assets`` (an
    earlier revision's) stay; the images the pairs named are not touched.
    Dropping the FKs locks the referenced tables, so the wait is bounded as
    in the upgrade."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS web.taste_settings")
    op.execute("DROP TABLE IF EXISTS web.taste_label_clock")
    op.execute("DROP INDEX IF EXISTS web.uq_taste_pairs_change_seq")
    op.execute("DROP INDEX IF EXISTS web.ix_taste_pairs_labelled")
    op.execute("DROP INDEX IF EXISTS web.ix_taste_pairs_pending")
    op.execute("DROP INDEX IF EXISTS web.uq_taste_pairs_pair")
    op.execute("DROP TABLE IF EXISTS web.taste_pairs")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
