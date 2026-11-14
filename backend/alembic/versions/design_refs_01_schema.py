"""design_refs schema — the design reference library store and judgement layer

Revision ID: design_refs_01
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-13

Phase 1 of plan
``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``
(qontinui-dev-notes/plans), with the plan's Phase 1b store additions
(``capture_job``, ``review_state`` / ``quality`` on every curated record, the
``correction`` log) folded in, as that phase directs while Phase 1 is unshipped.
Hand-authored — never ``alembic revision --autogenerate`` (served policy
``production-and-cost`` ``alembic-sole-authorship``). Product data, not
orchestration: no ``coord.*`` relation is created, altered or referenced, so
that policy's coord ordering is not engaged.

``down_revision`` is this repo's single alembic head at authoring time; if
another revision lands first, re-point it at the new head and move the
``Revises:`` line above with it. Do NOT author an ``alembic merge`` revision.

The ORM mirror is ``app/models/design_refs.py``; the test database is built
from those models, so ``tests/test_design_refs_01_migration.py`` upgrades a
real database to this revision and compares it with the models: tables and
columns with their nullability (equal), CHECK and UNIQUE constraints by name
(equal), indexes (every declared one present), and the seeds.

Tables (all in the new ``design_refs`` schema; every one has a primary key so
the schema can join the logical-replication publication)
=========================================================================
Global vocabularies — no ``tenant_id``; seeded here; writable only by a
qontinui superuser through the API:

* ``style_family`` — the pilot's five families plus ``other``.
* ``perception_dimension`` — the 17 starting bipolar dimensions, each with
  anchor texts at scores 1, 4, 7 and 10; ``version`` bumps on an anchor change
  and every rating records the version it was made under.
* ``personality_trait`` — the seven personality-profile traits.

Records — every row carries ``tenant_id`` (no FK: tenants live in coord's own
deployment; every query filters on it) and ``tier`` (``private`` | ``public``,
NOT NULL, CHECKed), the gate for every read:

* ``blob`` — each verified object in object storage (key, sha256, size).
  Keys are ``design-refs/<tier>/<tenant>/sha256/<h[:2]>/<h><ext>``
  (``ck_blob_key_shape``), so a private and a public record never share a blob.
* ``site`` — domain, product, site context (industry, business type,
  audience, positioning, price tier, intended personality, style family,
  ``context_state``) and ``split`` (``reference`` | ``holdout``, NULL until the
  context is first confirmed; immutable afterwards — the API refuses a change
  and ``trg_site_split_immutable`` refuses one that reaches SQL any other way).
* ``page``, ``flow``, ``capture``, ``component`` — the record tree, cascading
  from ``site`` so a takedown's row deletion reaches every level.
* ``capture_source``, ``replay_bundle`` — source copies and the HAR bundle;
  their blobs are ``private/`` whatever the record's tier
  (``ck_replay_bundle_key_private``; ``capture_source.parts`` is checked by
  the API).
* ``asset_fingerprint`` — perceptual / content hashes for the asset guard.
* ``description`` — text, controlled facets, a client-computed
  ``vector(384)`` embedding with ``embedding_model``, and a STORED generated
  tsvector (the ``coord_memory_records`` pattern: HNSW cosine + GIN).

Judgements — tenant-scoped, append-only except for takedown, no overall grade
anywhere (every judgement is per dimension):

* ``perception_rating`` (score CHECK 1–10; an AI rating must carry evidence),
  ``comparison`` (``a_id <> b_id``; the dimension is NOT NULL),
  ``site_personality`` (value CHECK 0–100; only an operator row is
  ``confirmed``), ``design_principle``, ``design_principle_evidence`` (PK
  ``(principle_id, evidence_kind, evidence_id, role)``), ``judge_bench_run``.

Intake and curation (Phase 1b store):

* ``capture_job`` — the worker queue with a ``claimed_until`` lease; a
  reproduction is always private (``ck_capture_job_reproduction_private``).
* ``correction`` — the append-only edit log.
* ``do_not_capture`` — the takedown list the worker honours.

Design notes
============
* Closed sets are TEXT + named CHECK, not PG enums (they evolve without
  ``ALTER TYPE``), and each CHECK has a stable ``ck_*`` name the ORM declares
  identically.
* FKs run only inside the schema. The polymorphic judgement targets
  (``target_id``, ``a_id`` / ``b_id``, ``evidence_id``) have none; the
  takedown code removes the rows that name a removed record.
* The HNSW index needs pgvector >= 0.5.0, asserted first (the
  ``coord_memory_records`` precondition).
* Idempotent: every DDL statement is ``IF NOT EXISTS`` / ``OR REPLACE`` and
  every seed ``ON CONFLICT DO NOTHING``, so re-running the body is a no-op.
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "design_refs_01"
down_revision: str = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# HNSW index support landed in pgvector 0.5.0.
_MIN_PGVECTOR = (0, 5, 0)


def _pgvector_version() -> tuple[int, ...] | None:
    row = (
        op.get_bind()
        .execute(sa.text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))
        .scalar()
    )
    if row is None:
        return None
    parts = re.findall(r"\d+", str(row))
    return tuple(int(p) for p in parts) if parts else None


def _assert_pgvector_supports_hnsw() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    version = _pgvector_version()
    if version is not None and version < _MIN_PGVECTOR:
        op.execute("ALTER EXTENSION vector UPDATE")
        version = _pgvector_version()
    if version is None or version < _MIN_PGVECTOR:
        found = ".".join(str(p) for p in version) if version else "absent"
        raise RuntimeError(
            "design_refs_01 requires pgvector >= 0.5.0 for the HNSW index on "
            f"design_refs.description; installed version is {found}."
        )


def upgrade() -> None:
    """Create the design_refs schema, its 22 tables and the seeded vocabularies."""
    _assert_pgvector_supports_hnsw()
    op.execute("CREATE SCHEMA IF NOT EXISTS design_refs")

    # design_refs.style_family
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.style_family (
            key VARCHAR(64) NOT NULL,
            label TEXT NOT NULL,
            description TEXT,
            active BOOLEAN DEFAULT true NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (key)
        )
        """
    )
    # design_refs.perception_dimension
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.perception_dimension (
            key VARCHAR(64) NOT NULL,
            pole_high TEXT NOT NULL,
            pole_low TEXT NOT NULL,
            anchors JSONB NOT NULL,
            version INTEGER DEFAULT 1 NOT NULL,
            active BOOLEAN DEFAULT true NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (key),
            CONSTRAINT ck_perception_dimension_version CHECK (version >= 1),
            CONSTRAINT ck_perception_dimension_anchors CHECK (jsonb_typeof(anchors) = 'object' AND anchors ?& array['1', '4', '7', '10'])
        )
        """
    )
    # design_refs.personality_trait
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.personality_trait (
            key VARCHAR(64) NOT NULL,
            description TEXT NOT NULL,
            version INTEGER DEFAULT 1 NOT NULL,
            active BOOLEAN DEFAULT true NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (key),
            CONSTRAINT ck_personality_trait_version CHECK (version >= 1)
        )
        """
    )
    # design_refs.blob
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.blob (
            key TEXT NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            sha256 VARCHAR(64) NOT NULL,
            size BIGINT NOT NULL,
            content_type TEXT,
            verified_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (key),
            CONSTRAINT ck_blob_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_blob_key_shape CHECK (key LIKE 'design-refs/' || tier || '/' || tenant_id::text || '/sha256/%'),
            CONSTRAINT ck_blob_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_blob_size CHECK (size >= 0)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_blob_tenant ON design_refs.blob (tenant_id)
        """
    )
    # design_refs.site
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.site (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            domain TEXT NOT NULL,
            product_name TEXT,
            industry TEXT,
            business_type TEXT,
            audience TEXT,
            positioning TEXT,
            price_tier VARCHAR(16) DEFAULT 'unknown' NOT NULL,
            intended_personality TEXT,
            style_family VARCHAR(64),
            context_state VARCHAR(16) DEFAULT 'proposed' NOT NULL,
            context_confirmed_by UUID,
            context_confirmed_at TIMESTAMP WITH TIME ZONE,
            split VARCHAR(16),
            split_assigned_at TIMESTAMP WITH TIME ZONE,
            tags JSONB DEFAULT '[]'::jsonb NOT NULL,
            review_state VARCHAR(16) DEFAULT 'pending' NOT NULL,
            quality VARCHAR(16),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_site_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_site_review_state CHECK (review_state IN ('pending', 'approved', 'rejected')),
            CONSTRAINT ck_site_quality CHECK (quality IS NULL OR quality IN ('exemplar', 'ok', 'anti_pattern')),
            CONSTRAINT ck_site_price_tier CHECK (price_tier IN ('budget', 'mid', 'premium', 'luxury', 'unknown')),
            CONSTRAINT ck_site_context_state CHECK (context_state IN ('proposed', 'confirmed')),
            CONSTRAINT ck_site_split CHECK (split IS NULL OR split IN ('reference', 'holdout')),
            CONSTRAINT ck_site_split_after_confirmation CHECK (split IS NULL OR context_state = 'confirmed'),
            CONSTRAINT ck_site_context_confirmed_at CHECK ((context_state = 'confirmed') = (context_confirmed_at IS NOT NULL)),
            CONSTRAINT ck_site_tags_array CHECK (jsonb_typeof(tags) = 'array'),
            CONSTRAINT uq_site_tenant_tier_domain UNIQUE (tenant_id, tier, domain),
            CONSTRAINT fk_site_style_family FOREIGN KEY(style_family) REFERENCES design_refs.style_family (key) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_site_tenant_domain ON design_refs.site (tenant_id, domain)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_site_tenant_family_split ON design_refs.site (tenant_id, style_family, split)
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION design_refs.site_split_immutable() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.split IS NOT NULL AND NEW.split IS DISTINCT FROM OLD.split THEN
                RAISE EXCEPTION 'design_refs.site.split is immutable once assigned'
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE OR REPLACE TRIGGER trg_site_split_immutable
            BEFORE UPDATE OF split ON design_refs.site
            FOR EACH ROW EXECUTE FUNCTION design_refs.site_split_immutable()
        """
    )
    # design_refs.capture_job
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.capture_job (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            url TEXT NOT NULL,
            domain TEXT NOT NULL,
            scope_kind VARCHAR(16) NOT NULL,
            crawl_depth SMALLINT,
            flow_goal TEXT,
            notes TEXT,
            source VARCHAR(16) NOT NULL,
            submitter_kind VARCHAR(16) NOT NULL,
            submitter_id TEXT,
            is_reproduction BOOLEAN DEFAULT false NOT NULL,
            state VARCHAR(16) NOT NULL,
            claimed_by TEXT,
            claimed_until TIMESTAMP WITH TIME ZONE,
            derived_tier VARCHAR(16),
            tier_reason JSONB,
            error TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_capture_job_scope_kind CHECK (scope_kind IN ('page', 'crawl', 'flow')),
            CONSTRAINT ck_capture_job_source CHECK (source IN ('operator', 'cli', 'mcp', 'discovery')),
            CONSTRAINT ck_capture_job_state CHECK (state IN ('proposed', 'rejected', 'queued', 'running', 'done', 'failed', 'cancelled')),
            CONSTRAINT ck_capture_job_derived_tier CHECK (derived_tier IS NULL OR derived_tier IN ('private', 'public')),
            CONSTRAINT ck_capture_job_crawl_depth CHECK ((scope_kind = 'crawl') = (crawl_depth IS NOT NULL)),
            CONSTRAINT ck_capture_job_crawl_depth_range CHECK (crawl_depth IS NULL OR crawl_depth BETWEEN 1 AND 10),
            CONSTRAINT ck_capture_job_flow_goal CHECK ((scope_kind = 'flow') = (flow_goal IS NOT NULL)),
            CONSTRAINT ck_capture_job_reproduction_private CHECK (NOT is_reproduction OR derived_tier IS NULL OR derived_tier = 'private')
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_capture_job_tenant_state ON design_refs.capture_job (tenant_id, state, created_at)
        """
    )
    # design_refs.page
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.page (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            site_id UUID NOT NULL,
            capture_job_id UUID,
            url TEXT NOT NULL,
            title TEXT,
            page_type TEXT,
            page_job TEXT,
            captured_at TIMESTAMP WITH TIME ZONE,
            viewports JSONB DEFAULT '[]'::jsonb NOT NULL,
            capture_basis JSONB DEFAULT '{}'::jsonb NOT NULL,
            tags JSONB DEFAULT '[]'::jsonb NOT NULL,
            review_state VARCHAR(16) DEFAULT 'pending' NOT NULL,
            quality VARCHAR(16),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_page_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_page_review_state CHECK (review_state IN ('pending', 'approved', 'rejected')),
            CONSTRAINT ck_page_quality CHECK (quality IS NULL OR quality IN ('exemplar', 'ok', 'anti_pattern')),
            CONSTRAINT ck_page_viewports CHECK (jsonb_typeof(viewports) = 'array'),
            CONSTRAINT ck_page_capture_basis CHECK (jsonb_typeof(capture_basis) = 'object'),
            CONSTRAINT ck_page_tags_array CHECK (jsonb_typeof(tags) = 'array'),
            CONSTRAINT fk_page_site FOREIGN KEY(site_id) REFERENCES design_refs.site (id) ON DELETE CASCADE,
            CONSTRAINT fk_page_capture_job FOREIGN KEY(capture_job_id) REFERENCES design_refs.capture_job (id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_page_tenant_site ON design_refs.page (tenant_id, site_id)
        """
    )
    # design_refs.flow
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.flow (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            site_id UUID NOT NULL,
            name TEXT NOT NULL,
            goal TEXT,
            steps JSONB DEFAULT '[]'::jsonb NOT NULL,
            tags JSONB DEFAULT '[]'::jsonb NOT NULL,
            review_state VARCHAR(16) DEFAULT 'pending' NOT NULL,
            quality VARCHAR(16),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_flow_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_flow_review_state CHECK (review_state IN ('pending', 'approved', 'rejected')),
            CONSTRAINT ck_flow_quality CHECK (quality IS NULL OR quality IN ('exemplar', 'ok', 'anti_pattern')),
            CONSTRAINT ck_flow_steps CHECK (jsonb_typeof(steps) = 'array'),
            CONSTRAINT ck_flow_tags_array CHECK (jsonb_typeof(tags) = 'array'),
            CONSTRAINT fk_flow_site FOREIGN KEY(site_id) REFERENCES design_refs.site (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_flow_tenant_site ON design_refs.flow (tenant_id, site_id)
        """
    )
    # design_refs.capture
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.capture (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            page_id UUID NOT NULL,
            run_id UUID NOT NULL,
            viewport TEXT NOT NULL,
            interaction_state TEXT DEFAULT 'default' NOT NULL,
            screenshot_key TEXT,
            structure_key TEXT,
            styles_key TEXT,
            a11y_key TEXT,
            tokens JSONB DEFAULT '{}'::jsonb NOT NULL,
            layout_bands JSONB DEFAULT '[]'::jsonb NOT NULL,
            motion_summary JSONB DEFAULT '{}'::jsonb NOT NULL,
            facets JSONB DEFAULT '{}'::jsonb NOT NULL,
            element_cap_reached TEXT,
            opt_out_signals JSONB DEFAULT '[]'::jsonb NOT NULL,
            logged_in BOOLEAN DEFAULT false NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_capture_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_capture_screenshot_key_tier CHECK (screenshot_key IS NULL OR screenshot_key LIKE 'design-refs/' || tier || '/%'),
            CONSTRAINT ck_capture_structure_key_tier CHECK (structure_key IS NULL OR structure_key LIKE 'design-refs/' || tier || '/%'),
            CONSTRAINT ck_capture_styles_key_tier CHECK (styles_key IS NULL OR styles_key LIKE 'design-refs/' || tier || '/%'),
            CONSTRAINT ck_capture_a11y_key_tier CHECK (a11y_key IS NULL OR a11y_key LIKE 'design-refs/' || tier || '/%'),
            CONSTRAINT ck_capture_facets CHECK (jsonb_typeof(facets) = 'object'),
            CONSTRAINT ck_capture_tokens CHECK (jsonb_typeof(tokens) = 'object'),
            CONSTRAINT fk_capture_page FOREIGN KEY(page_id) REFERENCES design_refs.page (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_capture_tenant_page ON design_refs.capture (tenant_id, page_id)
        """
    )
    # design_refs.capture_source
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.capture_source (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            page_id UUID NOT NULL,
            run_id UUID NOT NULL,
            viewport TEXT NOT NULL,
            parts JSONB DEFAULT '{}'::jsonb NOT NULL,
            missing JSONB DEFAULT '[]'::jsonb NOT NULL,
            logged_in BOOLEAN DEFAULT false NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_capture_source_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_capture_source_parts CHECK (jsonb_typeof(parts) = 'object'),
            CONSTRAINT ck_capture_source_missing CHECK (jsonb_typeof(missing) = 'array'),
            CONSTRAINT uq_capture_source_page_run_viewport UNIQUE (page_id, run_id, viewport),
            CONSTRAINT fk_capture_source_page FOREIGN KEY(page_id) REFERENCES design_refs.page (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_capture_source_tenant_page ON design_refs.capture_source (tenant_id, page_id)
        """
    )
    # design_refs.replay_bundle
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.replay_bundle (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            page_id UUID NOT NULL,
            run_id UUID NOT NULL,
            bundle_key TEXT NOT NULL,
            manifest JSONB DEFAULT '{}'::jsonb NOT NULL,
            truncated BOOLEAN DEFAULT false NOT NULL,
            recorded_at TIMESTAMP WITH TIME ZONE,
            worker_version TEXT,
            replay_miss_count INTEGER,
            logged_in BOOLEAN DEFAULT false NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_replay_bundle_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_replay_bundle_key_private CHECK (bundle_key LIKE 'design-refs/private/%'),
            CONSTRAINT ck_replay_bundle_key_zip CHECK (bundle_key LIKE '%.zip'),
            CONSTRAINT ck_replay_bundle_manifest CHECK (jsonb_typeof(manifest) = 'object'),
            CONSTRAINT ck_replay_bundle_miss_count CHECK (replay_miss_count IS NULL OR replay_miss_count >= 0),
            CONSTRAINT uq_replay_bundle_page_run UNIQUE (page_id, run_id),
            CONSTRAINT fk_replay_bundle_page FOREIGN KEY(page_id) REFERENCES design_refs.page (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_replay_bundle_tenant_page ON design_refs.replay_bundle (tenant_id, page_id)
        """
    )
    # design_refs.component
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.component (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            page_id UUID NOT NULL,
            capture_id UUID,
            role TEXT,
            bbox JSONB DEFAULT '{}'::jsonb NOT NULL,
            structure JSONB DEFAULT '{}'::jsonb NOT NULL,
            styles JSONB DEFAULT '{}'::jsonb NOT NULL,
            tokens JSONB DEFAULT '{}'::jsonb NOT NULL,
            states JSONB DEFAULT '[]'::jsonb NOT NULL,
            crop_key TEXT,
            tags JSONB DEFAULT '[]'::jsonb NOT NULL,
            review_state VARCHAR(16) DEFAULT 'pending' NOT NULL,
            quality VARCHAR(16),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_component_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_component_review_state CHECK (review_state IN ('pending', 'approved', 'rejected')),
            CONSTRAINT ck_component_quality CHECK (quality IS NULL OR quality IN ('exemplar', 'ok', 'anti_pattern')),
            CONSTRAINT ck_component_crop_key_tier CHECK (crop_key IS NULL OR crop_key LIKE 'design-refs/' || tier || '/%'),
            CONSTRAINT ck_component_bbox CHECK (jsonb_typeof(bbox) = 'object'),
            CONSTRAINT ck_component_tokens CHECK (jsonb_typeof(tokens) = 'object'),
            CONSTRAINT ck_component_states CHECK (jsonb_typeof(states) = 'array'),
            CONSTRAINT ck_component_tags_array CHECK (jsonb_typeof(tags) = 'array'),
            CONSTRAINT fk_component_page FOREIGN KEY(page_id) REFERENCES design_refs.page (id) ON DELETE CASCADE,
            CONSTRAINT fk_component_capture FOREIGN KEY(capture_id) REFERENCES design_refs.capture (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_component_tenant_page ON design_refs.component (tenant_id, page_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_component_tenant_role ON design_refs.component (tenant_id, role)
        """
    )
    # design_refs.asset_fingerprint
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.asset_fingerprint (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            capture_id UUID NOT NULL,
            asset_class VARCHAR(16) NOT NULL,
            source_url TEXT,
            phash VARCHAR(64),
            dhash VARCHAR(64),
            canonical_hash VARCHAR(64),
            content_hash VARCHAR(64),
            shingles JSONB DEFAULT '[]'::jsonb NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_asset_fingerprint_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_asset_fingerprint_class CHECK (asset_class IN ('image', 'svg', 'icon', 'font', 'text')),
            CONSTRAINT ck_asset_fingerprint_shingles CHECK (jsonb_typeof(shingles) = 'array'),
            CONSTRAINT fk_asset_fingerprint_capture FOREIGN KEY(capture_id) REFERENCES design_refs.capture (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_fingerprint_content_hash ON design_refs.asset_fingerprint (tenant_id, content_hash)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_fingerprint_phash ON design_refs.asset_fingerprint (tenant_id, phash)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_asset_fingerprint_tenant_capture ON design_refs.asset_fingerprint (tenant_id, capture_id)
        """
    )
    # design_refs.description
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.description (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            tier VARCHAR(16) NOT NULL,
            level VARCHAR(16) NOT NULL,
            target_id UUID NOT NULL,
            body TEXT NOT NULL,
            facets JSONB DEFAULT '{}'::jsonb NOT NULL,
            embedding VECTOR(384),
            embedding_model TEXT,
            body_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english'::regconfig, body)) STORED NOT NULL,
            generator TEXT,
            evidence JSONB DEFAULT '[]'::jsonb NOT NULL,
            review_state VARCHAR(16) DEFAULT 'pending' NOT NULL,
            quality VARCHAR(16),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_description_tier CHECK (tier IN ('private', 'public')),
            CONSTRAINT ck_description_review_state CHECK (review_state IN ('pending', 'approved', 'rejected')),
            CONSTRAINT ck_description_quality CHECK (quality IS NULL OR quality IN ('exemplar', 'ok', 'anti_pattern')),
            CONSTRAINT ck_description_level CHECK (level IN ('site', 'page', 'flow', 'component')),
            CONSTRAINT ck_description_facets CHECK (jsonb_typeof(facets) = 'object'),
            CONSTRAINT ck_description_evidence CHECK (jsonb_typeof(evidence) = 'array'),
            CONSTRAINT ck_description_embedding_model CHECK ((embedding IS NULL) = (embedding_model IS NULL))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_description_body_tsv ON design_refs.description USING gin (body_tsv)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_description_embedding_hnsw ON design_refs.description USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_description_facets ON design_refs.description USING gin (facets)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_description_tenant_target ON design_refs.description (tenant_id, level, target_id)
        """
    )
    # design_refs.perception_rating
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.perception_rating (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            target_kind VARCHAR(16) NOT NULL,
            target_id UUID NOT NULL,
            dimension_key VARCHAR(64) NOT NULL,
            dimension_version INTEGER NOT NULL,
            score SMALLINT NOT NULL,
            rater_kind VARCHAR(16) NOT NULL,
            rater_id TEXT NOT NULL,
            context_page_id UUID,
            context_viewport TEXT,
            confidence VARCHAR(16),
            positive_evidence JSONB DEFAULT '[]'::jsonb NOT NULL,
            negative_evidence JSONB DEFAULT '[]'::jsonb NOT NULL,
            explanation TEXT,
            answer_ms INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_perception_rating_target_kind CHECK (target_kind IN ('site', 'page', 'component')),
            CONSTRAINT ck_perception_rating_rater_kind CHECK (rater_kind IN ('operator', 'ai')),
            CONSTRAINT ck_perception_rating_confidence CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
            CONSTRAINT ck_perception_rating_score CHECK (score BETWEEN 1 AND 10),
            CONSTRAINT ck_perception_rating_evidence_arrays CHECK (jsonb_typeof(positive_evidence) = 'array' AND jsonb_typeof(negative_evidence) = 'array'),
            CONSTRAINT ck_perception_rating_ai_evidence CHECK (rater_kind <> 'ai' OR jsonb_array_length(positive_evidence) + jsonb_array_length(negative_evidence) > 0),
            CONSTRAINT ck_perception_rating_answer_ms CHECK (answer_ms IS NULL OR (answer_ms >= 0 AND rater_kind = 'operator')),
            CONSTRAINT fk_perception_rating_dimension FOREIGN KEY(dimension_key) REFERENCES design_refs.perception_dimension (key) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_perception_rating_target ON design_refs.perception_rating (tenant_id, target_kind, target_id, dimension_key, created_at)
        """
    )
    # design_refs.comparison
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.comparison (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            target_kind VARCHAR(16) NOT NULL,
            a_id UUID NOT NULL,
            b_id UUID NOT NULL,
            dimension_key VARCHAR(64) NOT NULL,
            dimension_version INTEGER NOT NULL,
            winner VARCHAR(8) NOT NULL,
            explanation TEXT,
            rater_kind VARCHAR(16) NOT NULL,
            rater_id TEXT NOT NULL,
            shown_order VARCHAR(16),
            context_viewport TEXT,
            trial_id UUID,
            answer_ms INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_comparison_target_kind CHECK (target_kind IN ('site', 'page', 'component')),
            CONSTRAINT ck_comparison_winner CHECK (winner IN ('a', 'b', 'tie')),
            CONSTRAINT ck_comparison_rater_kind CHECK (rater_kind IN ('operator', 'ai')),
            CONSTRAINT ck_comparison_shown_order CHECK (shown_order IS NULL OR shown_order IN ('a_first', 'b_first')),
            CONSTRAINT ck_comparison_distinct CHECK (a_id <> b_id),
            CONSTRAINT ck_comparison_answer_ms CHECK (answer_ms IS NULL OR (answer_ms >= 0 AND rater_kind = 'operator')),
            CONSTRAINT fk_comparison_dimension FOREIGN KEY(dimension_key) REFERENCES design_refs.perception_dimension (key) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_comparison_a ON design_refs.comparison (tenant_id, target_kind, a_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_comparison_b ON design_refs.comparison (tenant_id, target_kind, b_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_comparison_trial ON design_refs.comparison (tenant_id, trial_id)
        """
    )
    # design_refs.site_personality
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.site_personality (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            site_id UUID NOT NULL,
            trait_key VARCHAR(64) NOT NULL,
            value SMALLINT NOT NULL,
            rater_kind VARCHAR(16) NOT NULL,
            rater_id TEXT NOT NULL,
            state VARCHAR(16) NOT NULL,
            evidence JSONB DEFAULT '[]'::jsonb NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_site_personality_rater_kind CHECK (rater_kind IN ('operator', 'ai')),
            CONSTRAINT ck_site_personality_state CHECK (state IN ('proposed', 'confirmed')),
            CONSTRAINT ck_site_personality_value CHECK (value BETWEEN 0 AND 100),
            CONSTRAINT ck_site_personality_confirmed_by_operator CHECK (state <> 'confirmed' OR rater_kind = 'operator'),
            CONSTRAINT ck_site_personality_evidence CHECK (jsonb_typeof(evidence) = 'array'),
            CONSTRAINT fk_site_personality_site FOREIGN KEY(site_id) REFERENCES design_refs.site (id) ON DELETE CASCADE,
            CONSTRAINT fk_site_personality_trait FOREIGN KEY(trait_key) REFERENCES design_refs.personality_trait (key) ON DELETE RESTRICT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_site_personality_site_trait ON design_refs.site_personality (tenant_id, site_id, trait_key, created_at)
        """
    )
    # design_refs.design_principle
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.design_principle (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            statement TEXT NOT NULL,
            scope JSONB DEFAULT '{}'::jsonb NOT NULL,
            status VARCHAR(16) DEFAULT 'proposed' NOT NULL,
            proposed_by_kind VARCHAR(16) NOT NULL,
            proposed_by_id TEXT NOT NULL,
            approved_by UUID,
            approved_at TIMESTAMP WITH TIME ZONE,
            retired_reason TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_design_principle_status CHECK (status IN ('proposed', 'approved', 'retired')),
            CONSTRAINT ck_design_principle_proposed_by_kind CHECK (proposed_by_kind IN ('operator', 'ai')),
            CONSTRAINT ck_design_principle_scope CHECK (jsonb_typeof(scope) = 'object'),
            CONSTRAINT ck_design_principle_approved_whole CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
            CONSTRAINT ck_design_principle_retired_reason CHECK (status <> 'retired' OR retired_reason IS NOT NULL)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_design_principle_tenant_status ON design_refs.design_principle (tenant_id, status)
        """
    )
    # design_refs.design_principle_evidence
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.design_principle_evidence (
            principle_id UUID NOT NULL,
            evidence_kind VARCHAR(32) NOT NULL,
            evidence_id UUID NOT NULL,
            role VARCHAR(16) NOT NULL,
            tenant_id UUID NOT NULL,
            site_ids UUID[] NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            CONSTRAINT pk_design_principle_evidence PRIMARY KEY (principle_id, evidence_kind, evidence_id, role),
            CONSTRAINT ck_design_principle_evidence_role CHECK (role IN ('supports', 'counterexample')),
            CONSTRAINT ck_design_principle_evidence_kind CHECK (evidence_kind IN ('perception_rating', 'comparison')),
            CONSTRAINT ck_design_principle_evidence_sites CHECK (cardinality(site_ids) >= 1),
            CONSTRAINT fk_design_principle_evidence_principle FOREIGN KEY(principle_id) REFERENCES design_refs.design_principle (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_design_principle_evidence_target ON design_refs.design_principle_evidence (tenant_id, evidence_kind, evidence_id)
        """
    )
    # design_refs.judge_bench_run
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.judge_bench_run (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            model TEXT NOT NULL,
            prompt_version TEXT NOT NULL,
            n_pairs INTEGER NOT NULL,
            verdict VARCHAR(16) NOT NULL,
            pair_agreement FLOAT,
            pair_agreement_ci_low FLOAT,
            pair_agreement_ci_high FLOAT,
            unknown_rate FLOAT,
            rating_spearman JSONB DEFAULT '{}'::jsonb NOT NULL,
            krippendorff_alpha FLOAT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_judge_bench_run_verdict CHECK (verdict IN ('measured', 'unknown')),
            CONSTRAINT ck_judge_bench_run_n_pairs CHECK (n_pairs >= 0),
            CONSTRAINT ck_judge_bench_run_measured CHECK (verdict = 'unknown' OR pair_agreement IS NOT NULL),
            CONSTRAINT ck_judge_bench_run_agreement CHECK (pair_agreement IS NULL OR pair_agreement BETWEEN 0 AND 1),
            CONSTRAINT ck_judge_bench_run_unknown_rate CHECK (unknown_rate IS NULL OR unknown_rate BETWEEN 0 AND 1),
            CONSTRAINT ck_judge_bench_run_spearman CHECK (jsonb_typeof(rating_spearman) = 'object')
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_judge_bench_run_tenant ON design_refs.judge_bench_run (tenant_id, created_at)
        """
    )
    # design_refs.correction
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.correction (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            target_kind VARCHAR(32) NOT NULL,
            target_id UUID NOT NULL,
            field TEXT NOT NULL,
            from_value JSONB,
            to_value JSONB,
            actor_kind VARCHAR(16) NOT NULL,
            actor_id TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_correction_target_kind CHECK (target_kind IN ('site', 'page', 'flow', 'component', 'description', 'capture_job', 'site_personality', 'design_principle')),
            CONSTRAINT ck_correction_actor_kind CHECK (actor_kind IN ('operator', 'ai'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_correction_target ON design_refs.correction (tenant_id, target_kind, target_id)
        """
    )
    # design_refs.do_not_capture
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS design_refs.do_not_capture (
            id UUID DEFAULT gen_random_uuid() NOT NULL,
            tenant_id UUID NOT NULL,
            domain TEXT NOT NULL,
            path_prefix TEXT DEFAULT '' NOT NULL,
            reason TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_do_not_capture_entry UNIQUE (tenant_id, domain, path_prefix)
        )
        """
    )
    # ── seeds ──
    op.execute(
        """
        INSERT INTO design_refs.style_family (key, label) VALUES
            ('luxury_premium', 'Luxury / premium'),
            ('modern_saas', 'Modern SaaS'),
            ('architecture_editorial', 'Architecture / editorial'),
            ('corporate_professional', 'Corporate / professional'),
            ('creative_experimental', 'Creative / experimental'),
            ('other', 'Other')
        ON CONFLICT (key) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO design_refs.perception_dimension (key, pole_high, pole_low, anchors) VALUES
            ('premium', 'premium', 'cheap', '{"1": "Reads as cheap: stock imagery, crowded offers, default type and colour.", "4": "Serviceable but budget-leaning: some care, several bargain-bin cues.", "7": "Reads as quality: restrained palette, considered imagery, few lapses.", "10": "Unmistakably premium: every surface signals cost and care."}'::jsonb),
            ('refined', 'refined', 'unpolished', '{"1": "Unpolished: misalignments, inconsistent spacing, rough edges everywhere.", "4": "Mostly rough with some tidy areas; finishing is uneven.", "7": "Refined on the whole; small details occasionally slip.", "10": "Fully refined: alignment, spacing and detail are exact throughout."}'::jsonb),
            ('crafted', 'crafted', 'generic', '{"1": "Generic: a template used as-is, nothing made for this product.", "4": "Template-based with light customisation.", "7": "Clearly made for this product, with a few stock parts.", "10": "Crafted end to end: bespoke decisions visible in every section."}'::jsonb),
            ('intelligent', 'intelligent', 'superficial', '{"1": "Superficial: decoration with no information structure behind it.", "4": "Some useful structure under mostly surface-level styling.", "7": "Information is organised thoughtfully; styling serves it.", "10": "Deeply intelligent: structure, hierarchy and content reinforce each other."}'::jsonb),
            ('thoughtful', 'thoughtful', 'arbitrary', '{"1": "Arbitrary: choices look random and contradict each other.", "4": "Some choices have a reason, many do not.", "7": "Most choices have a visible reason.", "10": "Every choice reads as deliberate and justified."}'::jsonb),
            ('editorial', 'editorial', 'promotional', '{"1": "Promotional: hard sell, banners, urgency and offers dominate.", "4": "Sales-led with some editorial passages.", "7": "Editorial in tone, with occasional promotional blocks.", "10": "Fully editorial: content leads, selling is implicit."}'::jsonb),
            ('comfortable', 'comfortable', 'uncomfortable', '{"1": "Uncomfortable: strain to read, cramped, jarring motion or contrast.", "4": "Usable but tiring in places.", "7": "Comfortable to read and move through, minor friction.", "10": "Effortless: reading and navigating feel easy throughout."}'::jsonb),
            ('welcoming', 'welcoming', 'cold', '{"1": "Cold: distant, impersonal, nothing invites the visitor in.", "4": "Neutral leaning cold.", "7": "Friendly and inviting with some reserve.", "10": "Warmly welcoming from the first screen."}'::jsonb),
            ('calm', 'calm', 'chaotic', '{"1": "Chaotic: competing focal points, noise, no resting place for the eye.", "4": "Busy, with a few calm regions.", "7": "Mostly calm; a few busy moments.", "10": "Completely calm: clear focus and generous rest."}'::jsonb),
            ('playful', 'playful', 'serious', '{"1": "Entirely serious: formal, sober, no levity.", "4": "Mostly serious with a light touch here and there.", "7": "Playful in tone and detail, still composed.", "10": "Thoroughly playful: humour and whimsy throughout."}'::jsonb),
            ('elegant', 'elegant', 'clumsy', '{"1": "Clumsy: heavy, awkward proportions and transitions.", "4": "Some grace, often awkward.", "7": "Elegant overall, an occasional heavy-handed moment.", "10": "Effortlessly elegant: proportion and motion are graceful."}'::jsonb),
            ('minimal', 'minimal', 'cluttered', '{"1": "Cluttered: everything competes for space.", "4": "Dense, some breathing room.", "7": "Minimal with a few dense areas.", "10": "Strictly minimal: only what is needed is present."}'::jsonb),
            ('distinctive', 'distinctive', 'generic', '{"1": "Indistinguishable from many sites in its category.", "4": "Familiar with one or two recognisable traits.", "7": "Recognisable; a clear own voice with some convention.", "10": "Unmistakable: could not be mistaken for anyone else."}'::jsonb),
            ('harmonious', 'harmonious', 'inconsistent', '{"1": "Inconsistent: components, colours and type disagree across pages.", "4": "Some shared system, frequent departures.", "7": "Harmonious with occasional inconsistencies.", "10": "Fully harmonious: one system, applied everywhere."}'::jsonb),
            ('trustworthy', 'trustworthy', 'suspicious', '{"1": "Suspicious: dark patterns, unclear ownership, alarming claims.", "4": "Some doubt: missing proof, pushy patterns.", "7": "Trustworthy with minor doubts.", "10": "Fully trustworthy: transparent, credible, proof where needed."}'::jsonb),
            ('professional', 'professional', 'amateur', '{"1": "Amateur: obvious beginner mistakes throughout.", "4": "Semi-professional; several amateur tells.", "7": "Professional with small slips.", "10": "Fully professional execution."}'::jsonb),
            ('confident', 'confident', 'uncertain', '{"1": "Uncertain: hedging copy, timid hierarchy, no clear point of view.", "4": "Some conviction, often hesitant.", "7": "Confident, with occasional hedging.", "10": "Fully confident: bold hierarchy and a clear point of view."}'::jsonb)
        ON CONFLICT (key) DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO design_refs.personality_trait (key, description) VALUES
            ('sophistication', 'How cultivated and refined the character of the design is.'),
            ('warmth', 'How friendly and emotionally warm the design feels.'),
            ('minimalism', 'How reduced the design is to essentials.'),
            ('playfulness', 'How much humour, whimsy and lightness the design carries.'),
            ('confidence', 'How assertive and self-assured the voice of the design is.'),
            ('approachability', 'How easy the design is to approach for a newcomer.'),
            ('experimental_character', 'How far the design departs from convention on purpose.')
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    """Drop every design_refs table, the split trigger function and the schema."""
    op.execute("DROP TABLE IF EXISTS design_refs.do_not_capture")
    op.execute("DROP TABLE IF EXISTS design_refs.correction")
    op.execute("DROP TABLE IF EXISTS design_refs.judge_bench_run")
    op.execute("DROP TABLE IF EXISTS design_refs.design_principle_evidence")
    op.execute("DROP TABLE IF EXISTS design_refs.design_principle")
    op.execute("DROP TABLE IF EXISTS design_refs.site_personality")
    op.execute("DROP TABLE IF EXISTS design_refs.comparison")
    op.execute("DROP TABLE IF EXISTS design_refs.perception_rating")
    op.execute("DROP TABLE IF EXISTS design_refs.description")
    op.execute("DROP TABLE IF EXISTS design_refs.asset_fingerprint")
    op.execute("DROP TABLE IF EXISTS design_refs.component")
    op.execute("DROP TABLE IF EXISTS design_refs.replay_bundle")
    op.execute("DROP TABLE IF EXISTS design_refs.capture_source")
    op.execute("DROP TABLE IF EXISTS design_refs.capture")
    op.execute("DROP TABLE IF EXISTS design_refs.flow")
    op.execute("DROP TABLE IF EXISTS design_refs.page")
    op.execute("DROP TABLE IF EXISTS design_refs.capture_job")
    op.execute("DROP TABLE IF EXISTS design_refs.site")
    op.execute("DROP FUNCTION IF EXISTS design_refs.site_split_immutable()")
    op.execute("DROP TABLE IF EXISTS design_refs.blob")
    op.execute("DROP TABLE IF EXISTS design_refs.personality_trait")
    op.execute("DROP TABLE IF EXISTS design_refs.perception_dimension")
    op.execute("DROP TABLE IF EXISTS design_refs.style_family")
    op.execute("DROP SCHEMA IF EXISTS design_refs")
