"""Drop the writer-less testing / visual-regression / video-capture store.

Revision ID: testing_runs_02_drop_unwritten_store
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-09

Phase 3 of plan
``2026-11-06-verification-stores-nothing-writes-are-deleted-and-their-open-write-doors-close``
(K-D4). The code that read and wrote these tables is deleted in the same PR:
the ``/api/v1/testing/runs`` routers, the visual-regression routers, the
unmounted testing WebSocket, their services, CRUD, schemas, repository and ORM
models. The ``/api/v1/testing/historical`` routes that read
``historical_results``, ``action_frames`` and ``video_capture_sessions`` were
deleted by Phase 2 (qontinui-web#2185).

Why dropping is safe
------------------------------------------------------------------------------
Phase 0's production census (coord finding ``45c41d86``, 2026-11-08, Door A,
read-only) measured twelve of these tables at ``count(*) = 0`` with
``pg_stat_user_tables.n_tup_ins = 0`` and ``n_tup_del = 0`` (stats never
reset): no row was ever inserted, so none was inserted and later deleted.
No ``/testing`` or ``/visual`` route got a non-OPTIONS request in the 14-day
web log window. K-D4 therefore takes its "an empty table is dropped outright"
arm: no ``retired_<name>`` rename and no burn-in gate.

The census did not list ``frame_index`` and ``input_events``, but it settles
them too. Each has a NOT NULL ``video_capture_session_id`` under an enforced
FK into ``video_capture_sessions``, which never received an insert, so neither
can ever have held a row. Nothing in qontinui-web constructs either model.

That census is a reading from one day, so ``upgrade()`` re-checks it: it locks
every table ``ACCESS EXCLUSIVE``, counts it, and RAISES, dropping nothing, if
any holds a row. A table that gained rows belongs in K-D4's rename arm, which
is a re-plan, not something this revision may decide.

What is dropped
------------------------------------------------------------------------------
In schema ``project``: ``software_test_runs`` and its eight FK dependents
(``coverage_snapshots``, ``historical_results``, ``path_discoveries``,
``test_deficiencies``, ``test_screenshots``, ``transition_executions``,
``visual_baselines``, ``visual_comparison_results``), plus
``transition_reliability`` and the whole video-capture set
(``video_capture_sessions``, ``action_frames``, ``frame_index``,
``input_events``).

In schema ``public``: the eight enum types only those tables used
(``_DROPPED_ENUMS``), checked unused by any other column before the drop.
``input_event_type_enum`` stays: ``automation_input_events`` uses it too.

Removed cross-schema FK: ``project.software_test_runs.runner_connection_id``
-> ``coord.device_connections.id`` goes with its table, for the decoupling
plan, which tracked it in ``WRITE_PATH_FOLLOWUP``. No kept table held an FK
into the set, so no orphan id column is left behind.

Mechanics
------------------------------------------------------------------------------
1. Lock, then the emptiness check (above).
2. Every FOREIGN KEY between tables of the set is dropped first, found in
   ``pg_constraint`` rather than by name (most were created unnamed), so the
   drops below are order-independent. Matched in schema ``project`` only;
   nothing in ``coord.*`` is altered. An FK from any other schema into the set
   would make ``DROP TABLE`` (no CASCADE) fail loudly rather than be missed.
3. ``op.drop_table`` per table, ``schema="project"``, which also drops each
   table's indexes, sequences and outbound FKs.
4. ``DROP TYPE`` for the eight enums, refusing if any column still uses one.

``downgrade()`` re-creates the dropped schema exactly as ``pg_dump`` saw it at
the parent revision (``_RESTORE_SQL``), so the reversal check's before/after
schema comparison holds. By the precondition above the tables were empty, so
there is no data to restore.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "testing_runs_02_drop_unwritten_store"
down_revision: str | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The drop set, all in schema ``project``.
_DROPPED_TABLES: tuple[str, ...] = (
    "visual_comparison_results",
    "visual_baselines",
    "test_screenshots",
    "test_deficiencies",
    "coverage_snapshots",
    "path_discoveries",
    "historical_results",
    "transition_executions",
    "software_test_runs",
    "transition_reliability",
    "action_frames",
    "frame_index",
    "input_events",
    "video_capture_sessions",
)

#: Enum types in schema ``public`` used only by the dropped tables.
_DROPPED_ENUMS: tuple[str, ...] = (
    "deficiencyseverity",
    "deficiencystatus",
    "deficiencytype",
    "reviewdecision",
    "testrunstatus",
    "testscreenshottype",
    "transitionexecutionstatus",
    "visualcomparisonstatus",
)

_SQL_ARRAY = "ARRAY[" + ", ".join(f"'{t}'" for t in _DROPPED_TABLES) + "]"
_ENUM_ARRAY = "ARRAY[" + ", ".join(f"'{t}'" for t in _DROPPED_ENUMS) + "]"

#: Lock every table, then refuse to drop anything if any of them holds a row.
_ASSERT_EMPTY_SQL = f"""
DO $$
DECLARE
    tbl text;
    n bigint;
    nonempty text[] := ARRAY[]::text[];
BEGIN
    FOREACH tbl IN ARRAY {_SQL_ARRAY} LOOP
        IF to_regclass(format('project.%I', tbl)) IS NULL THEN
            RAISE EXCEPTION
                'testing_runs_02: project.% does not exist; the drop set no '
                'longer matches the schema', tbl;
        END IF;
        EXECUTE format('LOCK TABLE project.%I IN ACCESS EXCLUSIVE MODE', tbl);
    END LOOP;
    FOREACH tbl IN ARRAY {_SQL_ARRAY} LOOP
        EXECUTE format('SELECT count(*) FROM project.%I', tbl) INTO n;
        IF n > 0 THEN
            nonempty := nonempty || format('%s=%s', tbl, n);
        END IF;
    END LOOP;
    IF array_length(nonempty, 1) IS NOT NULL THEN
        RAISE EXCEPTION
            'testing_runs_02: refusing to drop non-empty table(s) %; K-D4 '
            'renames a table with rows to retired_<name> instead, which needs '
            'a re-plan', nonempty;
    END IF;
END $$;
"""

#: Drop every FK (in schema ``project``) that references a table in the set.
_DROP_INBOUND_FKS_SQL = f"""
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT con.conname, src.relname AS src_table
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
        JOIN pg_class dst ON dst.oid = con.confrelid
        JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
        WHERE con.contype = 'f'
          AND src_ns.nspname = 'project'
          AND dst_ns.nspname = 'project'
          AND dst.relname = ANY({_SQL_ARRAY})
    LOOP
        EXECUTE format(
            'ALTER TABLE project.%I DROP CONSTRAINT %I', r.src_table, r.conname
        );
        RAISE NOTICE 'testing_runs_02: dropped FK %.%', r.src_table, r.conname;
    END LOOP;
END $$;
"""

#: Drop the enums, refusing if any column anywhere still uses one.
_DROP_ENUMS_SQL = f"""
DO $$
DECLARE
    typ text;
    users text;
BEGIN
    FOREACH typ IN ARRAY {_ENUM_ARRAY} LOOP
        SELECT string_agg(format('%s.%s.%s', ns.nspname, c.relname, a.attname), ', ')
        INTO users
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        JOIN pg_namespace tns ON tns.oid = t.typnamespace
        WHERE tns.nspname = 'public' AND t.typname = typ
          AND a.attnum > 0 AND NOT a.attisdropped;
        IF users IS NOT NULL THEN
            RAISE EXCEPTION
                'testing_runs_02: enum public.% is still used by %', typ, users;
        END IF;
        EXECUTE format('DROP TYPE public.%I', typ);
    END LOOP;
END $$;
"""

#: The exact DDL of everything ``upgrade()`` removes, taken from ``pg_dump
#: --schema-only`` of a database at the parent revision (Postgres 17) and
#: diffed against one at this revision: the 8 enum types, then the 14
#: tables with their sequences, defaults, constraints, indexes, FKs and
#: comments, in that order. Only ``downgrade()`` reaches it.
_RESTORE_SQL = """
CREATE TYPE public.deficiencyseverity AS ENUM (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'INFO'
);

CREATE TYPE public.deficiencystatus AS ENUM (
    'NEW',
    'TRIAGED',
    'ASSIGNED',
    'IN_PROGRESS',
    'RESOLVED',
    'CLOSED',
    'WONT_FIX'
);

CREATE TYPE public.deficiencytype AS ENUM (
    'CRASH',
    'TIMEOUT',
    'VISUAL',
    'FUNCTIONAL',
    'PERFORMANCE',
    'DATA',
    'ACCESSIBILITY',
    'SECURITY'
);

CREATE TYPE public.reviewdecision AS ENUM (
    'APPROVED',
    'REJECTED',
    'NEW_BASELINE'
);

CREATE TYPE public.testrunstatus AS ENUM (
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'TIMEOUT'
);

CREATE TYPE public.testscreenshottype AS ENUM (
    'STATE_VERIFICATION',
    'ACTION_RESULT',
    'FAILURE',
    'BEFORE_ACTION',
    'AFTER_ACTION'
);

CREATE TYPE public.transitionexecutionstatus AS ENUM (
    'SUCCESS',
    'FAILED',
    'TIMEOUT',
    'SKIPPED',
    'ERROR'
);

CREATE TYPE public.visualcomparisonstatus AS ENUM (
    'PASSED',
    'FAILED',
    'PENDING_REVIEW',
    'APPROVED_AS_NEW',
    'NO_BASELINE'
);

CREATE SEQUENCE project.action_frames_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE project.frame_index_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE project.historical_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE project.input_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE project.video_capture_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE project.action_frames (
    id integer NOT NULL,
    video_capture_session_id integer NOT NULL,
    snapshot_action_id integer NOT NULL,
    frame_number integer NOT NULL,
    timestamp_ms bigint NOT NULL,
    frame_type character varying(20) NOT NULL,
    cached_frame_path text,
    cache_storage_backend character varying(20)
);

CREATE TABLE project.coverage_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid,
    project_id uuid NOT NULL,
    workflow_id character varying(255),
    snapshot_time timestamp with time zone NOT NULL,
    transitions_covered integer NOT NULL,
    transitions_total integer NOT NULL,
    coverage_percentage numeric(5,2) NOT NULL,
    states_covered integer NOT NULL,
    states_total integer NOT NULL,
    state_coverage_percentage numeric(5,2) NOT NULL,
    paths_discovered integer NOT NULL,
    unique_paths integer NOT NULL,
    coverage_map jsonb NOT NULL,
    state_coverage_map jsonb NOT NULL,
    uncovered_transitions jsonb NOT NULL,
    uncovered_states jsonb NOT NULL,
    snapshot_metadata jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE project.frame_index (
    id bigint NOT NULL,
    video_capture_session_id integer NOT NULL,
    frame_number integer NOT NULL,
    timestamp_ms bigint NOT NULL,
    byte_offset bigint,
    is_keyframe boolean NOT NULL,
    frame_hash character varying(64)
);

CREATE TABLE project.historical_results (
    id bigint NOT NULL,
    snapshot_run_id integer,
    snapshot_action_id integer,
    video_capture_session_id integer,
    pattern_id character varying(255),
    pattern_name character varying(255),
    action_type character varying(50) NOT NULL,
    active_states text[],
    success boolean NOT NULL,
    match_count integer,
    best_match_score numeric(5,4),
    duration_ms numeric(10,3),
    match_x integer,
    match_y integer,
    match_width integer,
    match_height integer,
    frame_timestamp_ms bigint,
    frame_number integer,
    result_data_json jsonb NOT NULL,
    workflow_id integer,
    project_id uuid,
    recorded_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    test_run_id uuid,
    sequence_number integer
);

CREATE TABLE project.input_events (
    id bigint NOT NULL,
    video_capture_session_id integer NOT NULL,
    timestamp_ms bigint NOT NULL,
    event_type character varying(50) NOT NULL,
    mouse_x integer,
    mouse_y integer,
    mouse_button smallint,
    scroll_dx integer,
    scroll_dy integer,
    key_code character varying(50),
    key_name character varying(50),
    key_char character varying(10),
    shift_pressed boolean,
    ctrl_pressed boolean,
    alt_pressed boolean,
    meta_pressed boolean,
    event_data_json jsonb
);

CREATE TABLE project.path_discoveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    path_hash character varying(64) NOT NULL,
    path_sequence jsonb NOT NULL,
    path_length integer NOT NULL,
    unique_states_visited integer NOT NULL,
    unique_transitions_used integer NOT NULL,
    discovered_at timestamp with time zone NOT NULL,
    execution_time_ms integer,
    success boolean NOT NULL,
    end_state character varying(255),
    is_cyclic boolean NOT NULL,
    cycle_detected_at integer,
    occurrence_count integer NOT NULL,
    last_traversed_at timestamp with time zone NOT NULL,
    path_metadata jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE project.software_test_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    runner_connection_id integer,
    workflow_id character varying(255),
    status public.testrunstatus NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    total_transitions integer NOT NULL,
    successful_transitions integer NOT NULL,
    failed_transitions integer NOT NULL,
    skipped_transitions integer NOT NULL,
    coverage_percentage numeric(5,2) NOT NULL,
    unique_paths_found integer NOT NULL,
    unique_states_visited integer NOT NULL,
    configuration_snapshot jsonb NOT NULL,
    test_mode character varying(50),
    max_duration_seconds integer NOT NULL,
    seed_value character varying(255),
    error_summary text,
    deficiencies_found integer NOT NULL,
    runner_metadata jsonb NOT NULL,
    tags jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE project.test_deficiencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    transition_execution_id uuid,
    assigned_to_user_id uuid,
    severity public.deficiencyseverity NOT NULL,
    deficiency_type public.deficiencytype NOT NULL,
    category character varying(100),
    title character varying(500) NOT NULL,
    description text NOT NULL,
    screenshot_urls jsonb NOT NULL,
    video_url character varying(500),
    reproduction_steps jsonb NOT NULL,
    reproduction_rate numeric(5,2),
    reproducible boolean NOT NULL,
    environment_info jsonb NOT NULL,
    preconditions jsonb NOT NULL,
    status public.deficiencystatus NOT NULL,
    resolution character varying(100),
    assigned_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    occurrence_count integer NOT NULL,
    external_ticket_id character varying(255),
    external_ticket_url character varying(500),
    tags jsonb NOT NULL,
    custom_fields jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone
);

CREATE TABLE project.test_screenshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    transition_execution_id uuid,
    deficiency_id uuid,
    screenshot_type public.testscreenshottype NOT NULL,
    storage_path character varying(1000) NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    screenshot_metadata jsonb NOT NULL,
    description text,
    state_name character varying(500),
    perceptual_hash character varying(256),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE project.transition_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    transition_id character varying(255) NOT NULL,
    transition_name character varying(500),
    sequence_number integer NOT NULL,
    status public.transitionexecutionstatus NOT NULL,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    execution_time_ms integer,
    error_type character varying(100),
    error_message text,
    error_stacktrace text,
    screenshot_urls jsonb NOT NULL,
    video_url character varying(500),
    source_state character varying(255),
    target_state character varying(255),
    actual_state character varying(255),
    state_match boolean,
    input_data jsonb NOT NULL,
    output_data jsonb NOT NULL,
    path_sequence jsonb NOT NULL,
    path_depth integer,
    action_count integer NOT NULL,
    retry_count integer NOT NULL,
    execution_metadata jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE project.transition_reliability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    workflow_id character varying(255),
    transition_id character varying(255) NOT NULL,
    total_executions integer NOT NULL,
    successful_executions integer NOT NULL,
    failed_executions integer NOT NULL,
    timeout_executions integer NOT NULL,
    success_rate numeric(5,2) NOT NULL,
    avg_execution_time_ms integer,
    min_execution_time_ms integer,
    max_execution_time_ms integer,
    stddev_execution_time_ms numeric(10,2),
    first_executed_at timestamp with time zone,
    last_executed_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    failure_patterns jsonb NOT NULL,
    common_errors jsonb NOT NULL,
    consecutive_successes integer NOT NULL,
    consecutive_failures integer NOT NULL,
    is_flaky boolean NOT NULL,
    flakiness_score numeric(5,2),
    reliability_metadata jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_calculated_at timestamp with time zone NOT NULL
);

CREATE TABLE project.video_capture_sessions (
    id integer NOT NULL,
    session_id character varying(36) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_ms bigint,
    video_width integer NOT NULL,
    video_height integer NOT NULL,
    video_fps double precision NOT NULL,
    video_codec character varying(50) NOT NULL,
    video_format character varying(10) NOT NULL,
    total_frames integer,
    storage_backend character varying(20) NOT NULL,
    video_path text NOT NULL,
    video_size_bytes bigint,
    compressed_video_path text,
    compressed_video_size_bytes bigint,
    monitor_id integer,
    monitor_name character varying(255),
    monitor_scale_factor double precision,
    snapshot_run_id integer,
    workflow_id integer,
    project_id uuid,
    created_by uuid,
    is_complete boolean NOT NULL,
    is_processed boolean NOT NULL,
    metadata_json jsonb,
    tags text[],
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE project.visual_baselines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    state_name character varying(500) NOT NULL,
    workflow_id character varying(500),
    storage_path character varying(1000) NOT NULL,
    thumbnail_path character varying(1000),
    width integer NOT NULL,
    height integer NOT NULL,
    file_size_bytes integer,
    perceptual_hash character varying(256),
    version integer NOT NULL,
    is_active boolean NOT NULL,
    approved_by_user_id uuid,
    approved_at timestamp with time zone,
    approval_notes text,
    comparison_settings jsonb NOT NULL,
    source_test_run_id uuid,
    source_screenshot_id uuid,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE project.visual_comparison_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_run_id uuid NOT NULL,
    baseline_id uuid,
    screenshot_id uuid NOT NULL,
    transition_execution_id uuid,
    state_name character varying(500) NOT NULL,
    comparison_algorithm character varying(50) NOT NULL,
    similarity_score double precision NOT NULL,
    threshold_used double precision NOT NULL,
    status public.visualcomparisonstatus NOT NULL,
    diff_image_path character varying(1000),
    diff_regions jsonb NOT NULL,
    execution_time_ms integer,
    reviewed_by_user_id uuid,
    reviewed_at timestamp with time zone,
    review_decision public.reviewdecision,
    review_notes text,
    deficiency_id uuid,
    error_message text,
    created_at timestamp with time zone NOT NULL
);

ALTER SEQUENCE project.action_frames_id_seq OWNED BY project.action_frames.id;

ALTER SEQUENCE project.frame_index_id_seq OWNED BY project.frame_index.id;

ALTER SEQUENCE project.historical_results_id_seq OWNED BY project.historical_results.id;

ALTER SEQUENCE project.input_events_id_seq OWNED BY project.input_events.id;

ALTER SEQUENCE project.video_capture_sessions_id_seq OWNED BY project.video_capture_sessions.id;

ALTER TABLE ONLY project.action_frames ALTER COLUMN id SET DEFAULT nextval('project.action_frames_id_seq'::regclass);

ALTER TABLE ONLY project.frame_index ALTER COLUMN id SET DEFAULT nextval('project.frame_index_id_seq'::regclass);

ALTER TABLE ONLY project.historical_results ALTER COLUMN id SET DEFAULT nextval('project.historical_results_id_seq'::regclass);

ALTER TABLE ONLY project.input_events ALTER COLUMN id SET DEFAULT nextval('project.input_events_id_seq'::regclass);

ALTER TABLE ONLY project.video_capture_sessions ALTER COLUMN id SET DEFAULT nextval('project.video_capture_sessions_id_seq'::regclass);

ALTER TABLE ONLY project.action_frames
    ADD CONSTRAINT action_frames_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.action_frames
    ADD CONSTRAINT uq_action_frames_session_action_type UNIQUE (video_capture_session_id, snapshot_action_id, frame_type);

ALTER TABLE ONLY project.coverage_snapshots
    ADD CONSTRAINT coverage_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.frame_index
    ADD CONSTRAINT frame_index_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.frame_index
    ADD CONSTRAINT uq_frame_index_session_frame UNIQUE (video_capture_session_id, frame_number);

ALTER TABLE ONLY project.historical_results
    ADD CONSTRAINT historical_results_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.input_events
    ADD CONSTRAINT input_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.path_discoveries
    ADD CONSTRAINT path_discoveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.software_test_runs
    ADD CONSTRAINT software_test_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.test_deficiencies
    ADD CONSTRAINT test_deficiencies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.test_screenshots
    ADD CONSTRAINT test_screenshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.transition_executions
    ADD CONSTRAINT transition_executions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.transition_reliability
    ADD CONSTRAINT transition_reliability_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.video_capture_sessions
    ADD CONSTRAINT video_capture_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.visual_baselines
    ADD CONSTRAINT visual_baselines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY project.visual_comparison_results
    ADD CONSTRAINT visual_comparison_results_pkey PRIMARY KEY (id);

CREATE INDEX idx_action_frames_action ON project.action_frames USING btree (snapshot_action_id);

CREATE INDEX idx_action_frames_session ON project.action_frames USING btree (video_capture_session_id);

CREATE INDEX idx_action_frames_type ON project.action_frames USING btree (frame_type);

CREATE INDEX idx_frame_index_keyframes ON project.frame_index USING btree (video_capture_session_id, is_keyframe);

CREATE INDEX idx_frame_index_session_frame ON project.frame_index USING btree (video_capture_session_id, frame_number);

CREATE INDEX idx_frame_index_session_timestamp ON project.frame_index USING btree (video_capture_session_id, timestamp_ms);

CREATE INDEX idx_historical_action_type_success ON project.historical_results USING btree (action_type, success);

CREATE INDEX idx_historical_pattern_states ON project.historical_results USING btree (pattern_id, active_states);

CREATE INDEX idx_historical_project_pattern ON project.historical_results USING btree (project_id, pattern_id);

CREATE INDEX idx_historical_selection ON project.historical_results USING btree (pattern_id, action_type, success, recorded_at);

CREATE INDEX idx_historical_test_run_pattern ON project.historical_results USING btree (test_run_id, pattern_id);

CREATE INDEX idx_historical_test_run_seq ON project.historical_results USING btree (test_run_id, sequence_number);

CREATE INDEX idx_historical_workflow_pattern ON project.historical_results USING btree (workflow_id, pattern_id);

CREATE INDEX idx_input_events_session_timestamp ON project.input_events USING btree (video_capture_session_id, timestamp_ms);

CREATE INDEX idx_input_events_type ON project.input_events USING btree (event_type);

CREATE INDEX idx_video_capture_sessions_project_id ON project.video_capture_sessions USING btree (project_id);

CREATE INDEX idx_video_capture_sessions_snapshot_run_id ON project.video_capture_sessions USING btree (snapshot_run_id);

CREATE INDEX idx_video_capture_sessions_started_at ON project.video_capture_sessions USING btree (started_at);

CREATE INDEX idx_video_capture_sessions_workflow_id ON project.video_capture_sessions USING btree (workflow_id);

CREATE INDEX ix_action_frames_id ON project.action_frames USING btree (id);

CREATE INDEX ix_action_frames_snapshot_action_id ON project.action_frames USING btree (snapshot_action_id);

CREATE INDEX ix_action_frames_video_capture_session_id ON project.action_frames USING btree (video_capture_session_id);

CREATE INDEX ix_coverage_snapshots_coverage_percentage ON project.coverage_snapshots USING btree (coverage_percentage);

CREATE INDEX ix_coverage_snapshots_project_id ON project.coverage_snapshots USING btree (project_id);

CREATE INDEX ix_coverage_snapshots_snapshot_time ON project.coverage_snapshots USING btree (snapshot_time);

CREATE INDEX ix_coverage_snapshots_test_run_id ON project.coverage_snapshots USING btree (test_run_id);

CREATE INDEX ix_coverage_snapshots_workflow_id ON project.coverage_snapshots USING btree (workflow_id);

CREATE INDEX ix_frame_index_id ON project.frame_index USING btree (id);

CREATE INDEX ix_frame_index_is_keyframe ON project.frame_index USING btree (is_keyframe);

CREATE INDEX ix_frame_index_timestamp_ms ON project.frame_index USING btree (timestamp_ms);

CREATE INDEX ix_frame_index_video_capture_session_id ON project.frame_index USING btree (video_capture_session_id);

CREATE INDEX ix_historical_results_action_type ON project.historical_results USING btree (action_type);

CREATE INDEX ix_historical_results_id ON project.historical_results USING btree (id);

CREATE INDEX ix_historical_results_pattern_id ON project.historical_results USING btree (pattern_id);

CREATE INDEX ix_historical_results_project_id ON project.historical_results USING btree (project_id);

CREATE INDEX ix_historical_results_recorded_at ON project.historical_results USING btree (recorded_at);

CREATE INDEX ix_historical_results_snapshot_action_id ON project.historical_results USING btree (snapshot_action_id);

CREATE INDEX ix_historical_results_snapshot_run_id ON project.historical_results USING btree (snapshot_run_id);

CREATE INDEX ix_historical_results_success ON project.historical_results USING btree (success);

CREATE INDEX ix_historical_results_test_run_id ON project.historical_results USING btree (test_run_id);

CREATE INDEX ix_historical_results_video_capture_session_id ON project.historical_results USING btree (video_capture_session_id);

CREATE INDEX ix_historical_results_workflow_id ON project.historical_results USING btree (workflow_id);

CREATE INDEX ix_input_events_event_type ON project.input_events USING btree (event_type);

CREATE INDEX ix_input_events_id ON project.input_events USING btree (id);

CREATE INDEX ix_input_events_timestamp_ms ON project.input_events USING btree (timestamp_ms);

CREATE INDEX ix_input_events_video_capture_session_id ON project.input_events USING btree (video_capture_session_id);

CREATE INDEX ix_path_discoveries_discovered_at ON project.path_discoveries USING btree (discovered_at);

CREATE INDEX ix_path_discoveries_path_hash ON project.path_discoveries USING btree (path_hash);

CREATE INDEX ix_path_discoveries_success ON project.path_discoveries USING btree (success);

CREATE INDEX ix_path_discoveries_test_run_id ON project.path_discoveries USING btree (test_run_id);

CREATE INDEX ix_software_test_runs_project_id ON project.software_test_runs USING btree (project_id);

CREATE INDEX ix_software_test_runs_runner_connection_id ON project.software_test_runs USING btree (runner_connection_id);

CREATE INDEX ix_software_test_runs_started_at ON project.software_test_runs USING btree (started_at);

CREATE INDEX ix_software_test_runs_status ON project.software_test_runs USING btree (status);

CREATE INDEX ix_software_test_runs_workflow_id ON project.software_test_runs USING btree (workflow_id);

CREATE INDEX ix_test_deficiencies_assigned_to_user_id ON project.test_deficiencies USING btree (assigned_to_user_id);

CREATE INDEX ix_test_deficiencies_deficiency_type ON project.test_deficiencies USING btree (deficiency_type);

CREATE INDEX ix_test_deficiencies_first_seen_at ON project.test_deficiencies USING btree (first_seen_at);

CREATE INDEX ix_test_deficiencies_severity ON project.test_deficiencies USING btree (severity);

CREATE INDEX ix_test_deficiencies_status ON project.test_deficiencies USING btree (status);

CREATE INDEX ix_test_deficiencies_test_run_id ON project.test_deficiencies USING btree (test_run_id);

CREATE INDEX ix_test_deficiencies_transition_execution_id ON project.test_deficiencies USING btree (transition_execution_id);

CREATE INDEX ix_test_screenshots_captured_at ON project.test_screenshots USING btree (captured_at);

CREATE INDEX ix_test_screenshots_deficiency_id ON project.test_screenshots USING btree (deficiency_id);

CREATE INDEX ix_test_screenshots_perceptual_hash ON project.test_screenshots USING btree (perceptual_hash);

CREATE INDEX ix_test_screenshots_screenshot_type ON project.test_screenshots USING btree (screenshot_type);

CREATE INDEX ix_test_screenshots_state_name ON project.test_screenshots USING btree (state_name);

CREATE INDEX ix_test_screenshots_test_run_id ON project.test_screenshots USING btree (test_run_id);

CREATE INDEX ix_test_screenshots_transition_execution_id ON project.test_screenshots USING btree (transition_execution_id);

CREATE INDEX ix_transition_executions_status ON project.transition_executions USING btree (status);

CREATE INDEX ix_transition_executions_test_run_id ON project.transition_executions USING btree (test_run_id);

CREATE INDEX ix_transition_executions_transition_id ON project.transition_executions USING btree (transition_id);

CREATE INDEX ix_transition_reliability_is_flaky ON project.transition_reliability USING btree (is_flaky);

CREATE INDEX ix_transition_reliability_last_executed_at ON project.transition_reliability USING btree (last_executed_at);

CREATE INDEX ix_transition_reliability_project_id ON project.transition_reliability USING btree (project_id);

CREATE INDEX ix_transition_reliability_success_rate ON project.transition_reliability USING btree (success_rate);

CREATE INDEX ix_transition_reliability_transition_id ON project.transition_reliability USING btree (transition_id);

CREATE INDEX ix_transition_reliability_workflow_id ON project.transition_reliability USING btree (workflow_id);

CREATE INDEX ix_video_capture_sessions_id ON project.video_capture_sessions USING btree (id);

CREATE INDEX ix_video_capture_sessions_project_id ON project.video_capture_sessions USING btree (project_id);

CREATE UNIQUE INDEX ix_video_capture_sessions_session_id ON project.video_capture_sessions USING btree (session_id);

CREATE INDEX ix_video_capture_sessions_snapshot_run_id ON project.video_capture_sessions USING btree (snapshot_run_id);

CREATE INDEX ix_video_capture_sessions_started_at ON project.video_capture_sessions USING btree (started_at);

CREATE INDEX ix_video_capture_sessions_workflow_id ON project.video_capture_sessions USING btree (workflow_id);

CREATE INDEX ix_visual_baselines_approved_by_user_id ON project.visual_baselines USING btree (approved_by_user_id);

CREATE INDEX ix_visual_baselines_is_active ON project.visual_baselines USING btree (is_active);

CREATE INDEX ix_visual_baselines_perceptual_hash ON project.visual_baselines USING btree (perceptual_hash);

CREATE INDEX ix_visual_baselines_project_id ON project.visual_baselines USING btree (project_id);

CREATE INDEX ix_visual_baselines_state_name ON project.visual_baselines USING btree (state_name);

CREATE INDEX ix_visual_baselines_workflow_id ON project.visual_baselines USING btree (workflow_id);

CREATE INDEX ix_visual_comparison_results_baseline_id ON project.visual_comparison_results USING btree (baseline_id);

CREATE INDEX ix_visual_comparison_results_deficiency_id ON project.visual_comparison_results USING btree (deficiency_id);

CREATE INDEX ix_visual_comparison_results_reviewed_by_user_id ON project.visual_comparison_results USING btree (reviewed_by_user_id);

CREATE INDEX ix_visual_comparison_results_screenshot_id ON project.visual_comparison_results USING btree (screenshot_id);

CREATE INDEX ix_visual_comparison_results_state_name ON project.visual_comparison_results USING btree (state_name);

CREATE INDEX ix_visual_comparison_results_status ON project.visual_comparison_results USING btree (status);

CREATE INDEX ix_visual_comparison_results_test_run_id ON project.visual_comparison_results USING btree (test_run_id);

CREATE INDEX ix_visual_comparison_results_transition_execution_id ON project.visual_comparison_results USING btree (transition_execution_id);

ALTER TABLE ONLY project.action_frames
    ADD CONSTRAINT action_frames_snapshot_action_id_fkey FOREIGN KEY (snapshot_action_id) REFERENCES project.snapshot_actions(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.action_frames
    ADD CONSTRAINT action_frames_video_capture_session_id_fkey FOREIGN KEY (video_capture_session_id) REFERENCES project.video_capture_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.coverage_snapshots
    ADD CONSTRAINT coverage_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.coverage_snapshots
    ADD CONSTRAINT coverage_snapshots_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES project.software_test_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.frame_index
    ADD CONSTRAINT frame_index_video_capture_session_id_fkey FOREIGN KEY (video_capture_session_id) REFERENCES project.video_capture_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.historical_results
    ADD CONSTRAINT fk_historical_results_test_run_id FOREIGN KEY (test_run_id) REFERENCES project.software_test_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.historical_results
    ADD CONSTRAINT historical_results_project_id_fkey FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.historical_results
    ADD CONSTRAINT historical_results_snapshot_action_id_fkey FOREIGN KEY (snapshot_action_id) REFERENCES project.snapshot_actions(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.historical_results
    ADD CONSTRAINT historical_results_snapshot_run_id_fkey FOREIGN KEY (snapshot_run_id) REFERENCES project.snapshot_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.historical_results
    ADD CONSTRAINT historical_results_video_capture_session_id_fkey FOREIGN KEY (video_capture_session_id) REFERENCES project.video_capture_sessions(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.input_events
    ADD CONSTRAINT input_events_video_capture_session_id_fkey FOREIGN KEY (video_capture_session_id) REFERENCES project.video_capture_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.path_discoveries
    ADD CONSTRAINT path_discoveries_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES project.software_test_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.software_test_runs
    ADD CONSTRAINT software_test_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.software_test_runs
    ADD CONSTRAINT software_test_runs_runner_connection_id_fkey FOREIGN KEY (runner_connection_id) REFERENCES coord.device_connections(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.test_deficiencies
    ADD CONSTRAINT test_deficiencies_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.test_deficiencies
    ADD CONSTRAINT test_deficiencies_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES project.software_test_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.test_deficiencies
    ADD CONSTRAINT test_deficiencies_transition_execution_id_fkey FOREIGN KEY (transition_execution_id) REFERENCES project.transition_executions(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.test_screenshots
    ADD CONSTRAINT test_screenshots_deficiency_id_fkey FOREIGN KEY (deficiency_id) REFERENCES project.test_deficiencies(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.test_screenshots
    ADD CONSTRAINT test_screenshots_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES project.software_test_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.test_screenshots
    ADD CONSTRAINT test_screenshots_transition_execution_id_fkey FOREIGN KEY (transition_execution_id) REFERENCES project.transition_executions(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.transition_executions
    ADD CONSTRAINT transition_executions_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES project.software_test_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.transition_reliability
    ADD CONSTRAINT transition_reliability_project_id_fkey FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.video_capture_sessions
    ADD CONSTRAINT video_capture_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.video_capture_sessions
    ADD CONSTRAINT video_capture_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.video_capture_sessions
    ADD CONSTRAINT video_capture_sessions_snapshot_run_id_fkey FOREIGN KEY (snapshot_run_id) REFERENCES project.snapshot_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.visual_baselines
    ADD CONSTRAINT visual_baselines_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.visual_baselines
    ADD CONSTRAINT visual_baselines_project_id_fkey FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.visual_baselines
    ADD CONSTRAINT visual_baselines_source_screenshot_id_fkey FOREIGN KEY (source_screenshot_id) REFERENCES project.test_screenshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.visual_baselines
    ADD CONSTRAINT visual_baselines_source_test_run_id_fkey FOREIGN KEY (source_test_run_id) REFERENCES project.software_test_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.visual_comparison_results
    ADD CONSTRAINT visual_comparison_results_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES project.visual_baselines(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.visual_comparison_results
    ADD CONSTRAINT visual_comparison_results_deficiency_id_fkey FOREIGN KEY (deficiency_id) REFERENCES project.test_deficiencies(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.visual_comparison_results
    ADD CONSTRAINT visual_comparison_results_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY project.visual_comparison_results
    ADD CONSTRAINT visual_comparison_results_screenshot_id_fkey FOREIGN KEY (screenshot_id) REFERENCES project.test_screenshots(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.visual_comparison_results
    ADD CONSTRAINT visual_comparison_results_test_run_id_fkey FOREIGN KEY (test_run_id) REFERENCES project.software_test_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY project.visual_comparison_results
    ADD CONSTRAINT visual_comparison_results_transition_execution_id_fkey FOREIGN KEY (transition_execution_id) REFERENCES project.transition_executions(id) ON DELETE SET NULL;

COMMENT ON COLUMN project.coverage_snapshots.coverage_map IS '{transition_id: execution_count, ...}';

COMMENT ON COLUMN project.coverage_snapshots.state_coverage_map IS '{state_id: visit_count, ...}';

COMMENT ON COLUMN project.coverage_snapshots.uncovered_states IS 'Array of state IDs';

COMMENT ON COLUMN project.coverage_snapshots.uncovered_transitions IS 'Array of transition IDs';

COMMENT ON COLUMN project.historical_results.sequence_number IS 'Order of recognition within the test run';

COMMENT ON COLUMN project.path_discoveries.cycle_detected_at IS 'Step number where cycle detected';

COMMENT ON COLUMN project.path_discoveries.path_hash IS 'SHA256 of path_sequence for quick lookup';

COMMENT ON COLUMN project.path_discoveries.path_sequence IS 'Array of {state: "", transition: ""}';

COMMENT ON COLUMN project.software_test_runs.seed_value IS 'For reproducible random exploration';

COMMENT ON COLUMN project.software_test_runs.test_mode IS 'exploration, regression, coverage, stress';

COMMENT ON COLUMN project.software_test_runs.workflow_id IS 'Workflow identifier from project configuration';

COMMENT ON COLUMN project.test_deficiencies.category IS 'Custom categorization';

COMMENT ON COLUMN project.test_deficiencies.environment_info IS 'OS, browser, screen res, etc.';

COMMENT ON COLUMN project.test_deficiencies.external_ticket_id IS 'JIRA, GitHub, etc.';

COMMENT ON COLUMN project.test_deficiencies.preconditions IS 'Required setup';

COMMENT ON COLUMN project.test_deficiencies.reproduction_rate IS 'Percentage (0-100)';

COMMENT ON COLUMN project.test_deficiencies.reproduction_steps IS 'Array of step descriptions';

COMMENT ON COLUMN project.test_deficiencies.resolution IS 'fixed, duplicate, wont_fix, cannot_reproduce';

COMMENT ON COLUMN project.test_deficiencies.screenshot_urls IS 'Array of S3 URLs';

COMMENT ON COLUMN project.test_screenshots.captured_at IS 'When the screenshot was captured';

COMMENT ON COLUMN project.test_screenshots.description IS 'Optional description of what the screenshot shows';

COMMENT ON COLUMN project.test_screenshots.height IS 'Image height in pixels';

COMMENT ON COLUMN project.test_screenshots.perceptual_hash IS 'Perceptual hash for quick visual comparison filtering';

COMMENT ON COLUMN project.test_screenshots.screenshot_metadata IS 'Additional metadata (confidence scores, match locations, etc.)';

COMMENT ON COLUMN project.test_screenshots.screenshot_type IS 'Type of screenshot (state_verification, action_result, etc.)';

COMMENT ON COLUMN project.test_screenshots.state_name IS 'State name for matching against visual baselines';

COMMENT ON COLUMN project.test_screenshots.storage_path IS 'S3/MinIO storage key';

COMMENT ON COLUMN project.test_screenshots.width IS 'Image width in pixels';

COMMENT ON COLUMN project.transition_executions.actual_state IS 'Where we actually ended up';

COMMENT ON COLUMN project.transition_executions.execution_time_ms IS 'Calculated duration in milliseconds';

COMMENT ON COLUMN project.transition_executions.input_data IS 'Variables/context at start';

COMMENT ON COLUMN project.transition_executions.output_data IS 'Variables/context at end';

COMMENT ON COLUMN project.transition_executions.path_depth IS 'How deep in exploration';

COMMENT ON COLUMN project.transition_executions.path_sequence IS 'Array of state IDs visited';

COMMENT ON COLUMN project.transition_executions.screenshot_urls IS 'Array of S3 URLs';

COMMENT ON COLUMN project.transition_executions.sequence_number IS 'Order within test run';

COMMENT ON COLUMN project.transition_executions.state_match IS 'Did we reach expected state?';

COMMENT ON COLUMN project.transition_executions.transition_id IS 'From workflow configuration';

COMMENT ON COLUMN project.transition_reliability.common_errors IS 'Array of {error: "", count: N}';

COMMENT ON COLUMN project.transition_reliability.failure_patterns IS '{error_type: count, ...}';

COMMENT ON COLUMN project.transition_reliability.flakiness_score IS '0-100, higher = more flaky';

COMMENT ON COLUMN project.transition_reliability.is_flaky IS 'Auto-calculated';

COMMENT ON COLUMN project.transition_reliability.success_rate IS 'Percentage';

COMMENT ON COLUMN project.visual_baselines.approval_notes IS 'Optional notes explaining the approval';

COMMENT ON COLUMN project.visual_baselines.approved_at IS 'When the baseline was approved';

COMMENT ON COLUMN project.visual_baselines.comparison_settings IS 'Comparison configuration:
        {
            "algorithm": "ssim" | "pixel_diff" | "perceptual_hash",
            "threshold": float (0.0-1.0),
            "ignore_regions": [{"x": int, "y": int, "width": int, "height": int, "name": str}]
        }';

COMMENT ON COLUMN project.visual_baselines.file_size_bytes IS 'File size in bytes';

COMMENT ON COLUMN project.visual_baselines.height IS 'Image height in pixels';

COMMENT ON COLUMN project.visual_baselines.is_active IS 'Whether this is the active baseline for this state';

COMMENT ON COLUMN project.visual_baselines.perceptual_hash IS 'Perceptual hash for quick comparison filtering';

COMMENT ON COLUMN project.visual_baselines.source_screenshot_id IS 'Screenshot this baseline was created from';

COMMENT ON COLUMN project.visual_baselines.source_test_run_id IS 'Test run this baseline was created from (if auto-created)';

COMMENT ON COLUMN project.visual_baselines.state_name IS 'State name used to match screenshots to this baseline';

COMMENT ON COLUMN project.visual_baselines.storage_path IS 'S3/MinIO storage path for baseline image';

COMMENT ON COLUMN project.visual_baselines.thumbnail_path IS 'S3/MinIO storage path for thumbnail preview';

COMMENT ON COLUMN project.visual_baselines.version IS 'Version number of this baseline (incremented on updates)';

COMMENT ON COLUMN project.visual_baselines.width IS 'Image width in pixels';

COMMENT ON COLUMN project.visual_baselines.workflow_id IS 'Optional workflow ID to scope baseline to specific workflow';

COMMENT ON COLUMN project.visual_comparison_results.comparison_algorithm IS 'Algorithm used: ssim, pixel_diff, or perceptual_hash';

COMMENT ON COLUMN project.visual_comparison_results.deficiency_id IS 'Deficiency created from this failed comparison';

COMMENT ON COLUMN project.visual_comparison_results.diff_image_path IS 'S3/MinIO path for diff visualization image';

COMMENT ON COLUMN project.visual_comparison_results.diff_regions IS 'List of diff regions detected:
        [{"x": int, "y": int, "width": int, "height": int, "change_percentage": float}]';

COMMENT ON COLUMN project.visual_comparison_results.error_message IS 'Error message if comparison failed to execute';

COMMENT ON COLUMN project.visual_comparison_results.execution_time_ms IS 'Time taken to perform comparison in milliseconds';

COMMENT ON COLUMN project.visual_comparison_results.review_decision IS 'Decision made during review: approved, rejected, new_baseline';

COMMENT ON COLUMN project.visual_comparison_results.review_notes IS 'Notes explaining the review decision';

COMMENT ON COLUMN project.visual_comparison_results.reviewed_at IS 'When the comparison was reviewed';

COMMENT ON COLUMN project.visual_comparison_results.similarity_score IS 'Similarity score from 0.0 to 1.0 (1.0 = identical)';

COMMENT ON COLUMN project.visual_comparison_results.state_name IS 'State name this comparison was for';

COMMENT ON COLUMN project.visual_comparison_results.status IS 'Result status: passed, failed, pending_review, approved_as_new, no_baseline';

COMMENT ON COLUMN project.visual_comparison_results.threshold_used IS 'Threshold that was used for pass/fail determination';
"""


def upgrade() -> None:
    op.execute(_ASSERT_EMPTY_SQL)
    op.execute(_DROP_INBOUND_FKS_SQL)
    op.drop_table("visual_comparison_results", schema="project")
    op.drop_table("visual_baselines", schema="project")
    op.drop_table("test_screenshots", schema="project")
    op.drop_table("test_deficiencies", schema="project")
    op.drop_table("coverage_snapshots", schema="project")
    op.drop_table("path_discoveries", schema="project")
    op.drop_table("historical_results", schema="project")
    op.drop_table("transition_executions", schema="project")
    op.drop_table("software_test_runs", schema="project")
    op.drop_table("transition_reliability", schema="project")
    op.drop_table("action_frames", schema="project")
    op.drop_table("frame_index", schema="project")
    op.drop_table("input_events", schema="project")
    op.drop_table("video_capture_sessions", schema="project")
    op.execute(_DROP_ENUMS_SQL)


def downgrade() -> None:
    op.execute(_RESTORE_SQL)
