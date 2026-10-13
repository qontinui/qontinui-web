"""web.image_assets + web.image_slot_candidates — the content-addressed image store

Revision ID: image_assets_01
Revises: queueanchor_01
Create Date: 2026-10-13

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``
(qontinui-dev-notes/plans). Two tables in the EXISTING web-owned ``web``
schema (``bridge_audit_log_01`` created it): the store every generated,
derived, captured and exemplar image of a tenant lands in, and the record of
which of those images were proposed for which image slot. Product data, not
orchestration: no ``coord.*`` relation is created, altered or referenced, so
``[policy: alembic-sole-authorship]``'s coord ordering is not engaged.

``down_revision`` is this repo's single alembic head at authoring time; if
another revision lands first, re-point it at the new head and move the
``Revises:`` line above with it (``tests/test_image_assets_01_migration.py``
reads the parent from ``down_revision`` itself, so it needs no edit). Do NOT
author an ``alembic merge`` revision.

Tables
======
``web.image_assets``
    One row per (tenant, image), unique on ``(tenant_id, sha256)``. The
    server computes ``sha256`` from the uploaded bytes and reads
    ``mime_type``, ``width`` and ``height`` from them; the client's filename
    and Content-Type are never trusted. ``storage_key`` is the object's key,
    ``image-assets/{tenant_id}/sha256/{h[:2]}/{h}{ext}`` — it names the
    tenant, so an object is NEVER shared across tenants: one tenant's erasure
    cannot break another's asset, and a write cannot reveal whether another
    tenant holds the same image. ``kind`` is how the image entered
    (``candidate`` | ``derivative`` | ``capture`` | ``exemplar``);
    ``provenance`` is the generator's record, kept verbatim.

``web.image_slot_candidates``
    An asset proposed for one image slot (``slot_id``) of one repo, with the
    recipe that produced it (``recipe_hash``), the measured values
    (``values``), the judge panel's votes and margins (``judge``) and where it
    stands (``status``: ``candidate`` | ``chosen`` | ``rejected`` |
    ``shipped``). Unique on ``(tenant_id, repo, slot_id, asset_sha256)``.

Design notes
============

* **Tenant isolation is a constraint, not only a predicate.** The candidate
  references its asset through the composite FK ``(tenant_id, asset_sha256)
  → web.image_assets (tenant_id, sha256)``, so a candidate row can only name
  an image ITS OWN tenant holds — the database refuses the cross-tenant
  reference the API also refuses. ``ON DELETE CASCADE``: a candidate is a
  statement about an asset and goes with it.

* **No FK on ``tenant_id``.** Tenants live in coord's own deployment; a
  cross-schema FK would re-couple what the web/coord schema boundary
  separated (the ``overview.*`` reasoning). Every query filters on it.

* **At most one ``chosen`` candidate per slot** —
  ``uq_image_slot_candidates_one_chosen``, a partial unique index, because
  "the slot's chosen asset" is singular to every reader (the compile step
  regenerates a slot that has none). The API makes a choice atomic by
  returning the slot's previous choice to ``candidate`` in the same
  transaction.

* **CHECK constraints carry explicit stable names** (``ck_image_assets_*``,
  ``ck_image_slot_candidates_*``) so a later widening — a new accepted image
  format, a new kind — can ``DROP CONSTRAINT <known name>``.

Locking: both tables are created EMPTY in this transaction and the only FK
runs between them, so no lock is taken on a live relation and no
``lock_timeout`` bracket is needed. The one index outside the table bodies
(the partial unique index) is built on the table this revision just created,
which coord's migration classifier admits as a new-table claim.

Idempotency: every statement uses ``IF NOT EXISTS`` / ``IF EXISTS``, so a
partially-applied run re-runs cleanly and downgrade → upgrade is a no-op on a
fresh database. Writes **no rows**.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "image_assets_01"
down_revision: str = "queueanchor_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``web.image_assets`` and ``web.image_slot_candidates``."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS web.image_assets (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id    UUID NOT NULL,
            sha256       VARCHAR(64) NOT NULL
                CONSTRAINT ck_image_assets_sha256_hex
                CHECK (sha256 ~ '^[0-9a-f]{64}$'),
            storage_key  VARCHAR(512) NOT NULL,
            mime_type    VARCHAR(32) NOT NULL
                CONSTRAINT ck_image_assets_mime_type
                CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/gif',
                                     'image/webp', 'image/avif')),
            width        INTEGER NOT NULL,
            height       INTEGER NOT NULL,
            byte_size    BIGINT NOT NULL
                CONSTRAINT ck_image_assets_byte_size_positive
                CHECK (byte_size > 0),
            provenance   JSONB NOT NULL DEFAULT '{}'::jsonb
                CONSTRAINT ck_image_assets_provenance_object
                CHECK (jsonb_typeof(provenance) = 'object'),
            kind         VARCHAR(16) NOT NULL
                CONSTRAINT ck_image_assets_kind
                CHECK (kind IN ('candidate', 'derivative', 'capture', 'exemplar')),
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_image_assets_dimensions_positive
                CHECK (width > 0 AND height > 0),
            CONSTRAINT uq_image_assets_tenant_sha256 UNIQUE (tenant_id, sha256)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS web.image_slot_candidates (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            repo          VARCHAR(200) NOT NULL,
            slot_id       VARCHAR(200) NOT NULL,
            asset_sha256  VARCHAR(64) NOT NULL,
            recipe_hash   VARCHAR(128),
            values        JSONB NOT NULL DEFAULT '{}'::jsonb
                CONSTRAINT ck_image_slot_candidates_values_object
                CHECK (jsonb_typeof(values) = 'object'),
            judge         JSONB NOT NULL DEFAULT '{}'::jsonb
                CONSTRAINT ck_image_slot_candidates_judge_object
                CHECK (jsonb_typeof(judge) = 'object'),
            status        VARCHAR(16) NOT NULL DEFAULT 'candidate'
                CONSTRAINT ck_image_slot_candidates_status
                CHECK (status IN ('candidate', 'chosen', 'rejected', 'shipped')),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_image_slot_candidates_slot_asset
                UNIQUE (tenant_id, repo, slot_id, asset_sha256),
            CONSTRAINT fk_image_slot_candidates_asset
                FOREIGN KEY (tenant_id, asset_sha256)
                REFERENCES web.image_assets (tenant_id, sha256)
                ON DELETE CASCADE
        )
        """
    )

    # At most one chosen candidate per slot. Partial, because a slot holds any
    # number of candidate / rejected / shipped rows.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_image_slot_candidates_one_chosen
            ON web.image_slot_candidates (tenant_id, repo, slot_id)
            WHERE status = 'chosen'
        """
    )


def downgrade() -> None:
    """Drop both tables (candidates first: they reference the assets).

    The ``web`` schema itself is left in place — it predates this revision and
    holds other tables. The stored objects are not touched: a downgrade is a
    schema operation, and an object whose row is gone is re-adopted by the
    next upload of the same bytes (``file_exists``)."""
    op.execute("DROP INDEX IF EXISTS web.uq_image_slot_candidates_one_chosen")
    op.execute("DROP TABLE IF EXISTS web.image_slot_candidates")
    op.execute("DROP TABLE IF EXISTS web.image_assets")
