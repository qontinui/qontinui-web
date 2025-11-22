--
-- PostgreSQL database dump
--

\restrict yBjt2b7CTdCENjBhRSRheuLCatdwpA89JfbPhZlJl86naPvt4pxT6x6OGn8DUxn

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: actiontype; Type: TYPE; Schema: public; Owner: qontinui
--

CREATE TYPE public.actiontype AS ENUM (
    'created',
    'modified',
    'deleted',
    'shared',
    'commented',
    'locked',
    'unlocked',
    'viewed',
    'exported',
    'imported'
);


ALTER TYPE public.actiontype OWNER TO qontinui;

--
-- Name: resourcetype; Type: TYPE; Schema: public; Owner: qontinui
--

CREATE TYPE public.resourcetype AS ENUM (
    'workflow',
    'state',
    'image',
    'transition',
    'action',
    'project'
);


ALTER TYPE public.resourcetype OWNER TO qontinui;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id integer NOT NULL,
    user_id uuid NOT NULL,
    action_type public.actiontype NOT NULL,
    resource_type public.resourcetype NOT NULL,
    resource_id character varying NOT NULL,
    resource_name character varying,
    changes json,
    metadata json,
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.activity_logs OWNER TO qontinui;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


ALTER TABLE public.alembic_version OWNER TO qontinui;

--
-- Name: analysis_jobs; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.analysis_jobs (
    id uuid NOT NULL,
    annotation_set_id uuid NOT NULL,
    analyzers_used json NOT NULL,
    parameters json,
    fusion_enabled integer NOT NULL,
    fusion_config json,
    status character varying NOT NULL,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    error_message text,
    total_elements_found integer,
    total_fused_elements integer,
    analyzer_statistics json,
    created_at timestamp without time zone NOT NULL,
    created_by_id uuid NOT NULL
);


ALTER TABLE public.analysis_jobs OWNER TO qontinui;

--
-- Name: analyzer_results; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.analyzer_results (
    id uuid NOT NULL,
    analysis_job_id uuid NOT NULL,
    analyzer_name character varying NOT NULL,
    analyzer_type character varying NOT NULL,
    analyzer_version character varying,
    elements_found integer,
    confidence double precision,
    analyzer_metadata json,
    execution_time_ms integer
);


ALTER TABLE public.analyzer_results OWNER TO qontinui;

--
-- Name: annotation_sets; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.annotation_sets (
    id uuid NOT NULL,
    screenshot_name character varying NOT NULL,
    screenshot_url character varying NOT NULL,
    image_width integer NOT NULL,
    image_height integer NOT NULL,
    screenshots json,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    created_by_id uuid NOT NULL,
    notes text,
    boundary_width integer NOT NULL
);


ALTER TABLE public.annotation_sets OWNER TO qontinui;

--
-- Name: annotations; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.annotations (
    id uuid NOT NULL,
    annotation_set_id uuid NOT NULL,
    screenshot_index integer NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    label character varying,
    description text,
    reason text,
    extra_data json,
    "order" integer
);


ALTER TABLE public.annotations OWNER TO qontinui;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    user_id uuid,
    action character varying NOT NULL,
    resource_type character varying,
    resource_id character varying,
    log_metadata json,
    ip_address character varying,
    created_at timestamp without time zone
);


ALTER TABLE public.audit_logs OWNER TO qontinui;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_logs_id_seq OWNER TO qontinui;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: automation_input_events; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.automation_input_events (
    id bigint NOT NULL,
    session_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    "timestamp" timestamp without time zone NOT NULL,
    mouse_x integer,
    mouse_y integer,
    mouse_button character varying(20),
    drag_from_x integer,
    drag_from_y integer,
    drag_to_x integer,
    drag_to_y integer,
    drag_duration double precision,
    drag_path_points jsonb,
    drag_avg_speed double precision,
    drag_max_speed double precision,
    text_typed text,
    character_count integer,
    screenshot_before_id uuid,
    screenshot_after_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.automation_input_events OWNER TO qontinui;

--
-- Name: automation_input_events_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.automation_input_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.automation_input_events_id_seq OWNER TO qontinui;

--
-- Name: automation_input_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.automation_input_events_id_seq OWNED BY public.automation_input_events.id;


--
-- Name: automation_logs; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.automation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    sequence_number integer NOT NULL,
    level character varying(50) NOT NULL,
    message text NOT NULL,
    log_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE public.automation_logs OWNER TO qontinui;

--
-- Name: automation_screenshots; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.automation_screenshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    storage_path character varying(500) NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    content_type character varying(100) DEFAULT 'image/png'::character varying NOT NULL,
    automation_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    presigned_url character varying(2048),
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE public.automation_screenshots OWNER TO qontinui;

--
-- Name: automation_sessions; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.automation_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id integer,
    user_id uuid NOT NULL,
    runner_version character varying(100) NOT NULL,
    runner_os character varying(100) NOT NULL,
    runner_hostname character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    configuration_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone
);


ALTER TABLE public.automation_sessions OWNER TO qontinui;

--
-- Name: automation_videos; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.automation_videos (
    id integer NOT NULL,
    session_id character varying NOT NULL,
    user_id uuid NOT NULL,
    project_id integer,
    s3_key character varying NOT NULL,
    duration_seconds integer,
    fps integer,
    quality character varying,
    file_size_bytes integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.automation_videos OWNER TO qontinui;

--
-- Name: automation_videos_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.automation_videos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.automation_videos_id_seq OWNER TO qontinui;

--
-- Name: automation_videos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.automation_videos_id_seq OWNED BY public.automation_videos.id;


--
-- Name: detected_elements; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.detected_elements (
    id uuid NOT NULL,
    analyzer_result_id uuid NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    confidence double precision NOT NULL,
    label character varying,
    element_type character varying,
    screenshot_index integer NOT NULL,
    element_metadata json
);


ALTER TABLE public.detected_elements OWNER TO qontinui;

--
-- Name: device_sessions; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.device_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    device_fingerprint character varying(255) NOT NULL,
    ip_address character varying(45) NOT NULL,
    user_agent text NOT NULL,
    accept_language character varying(255),
    is_trusted boolean DEFAULT false NOT NULL,
    first_seen timestamp without time zone DEFAULT now() NOT NULL,
    last_seen timestamp without time zone DEFAULT now() NOT NULL,
    last_ip character varying(45) NOT NULL,
    device_name character varying(255),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    verification_token text,
    verification_sent_at timestamp without time zone,
    country character varying(100),
    city character varying(100)
);


ALTER TABLE public.device_sessions OWNER TO qontinui;

--
-- Name: fused_elements; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.fused_elements (
    id uuid NOT NULL,
    analysis_job_id uuid NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    confidence double precision NOT NULL,
    votes integer NOT NULL,
    sources json NOT NULL,
    source_confidences json NOT NULL,
    label character varying,
    element_type character varying,
    screenshot_index integer NOT NULL,
    element_metadata json
);


ALTER TABLE public.fused_elements OWNER TO qontinui;

--
-- Name: organization_invitations; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.organization_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email character varying NOT NULL,
    role character varying DEFAULT 'member'::character varying NOT NULL,
    invited_by uuid,
    token character varying NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    accepted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.organization_invitations OWNER TO qontinui;

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    slug character varying NOT NULL,
    description text,
    owner_id uuid NOT NULL,
    avatar_url character varying,
    settings json DEFAULT '{}'::json NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.organizations OWNER TO qontinui;

--
-- Name: patterns; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.patterns (
    id integer NOT NULL,
    snapshot_run_id integer NOT NULL,
    pattern_id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    screenshot_path character varying(500) NOT NULL,
    region json NOT NULL,
    active_states json NOT NULL,
    confidence integer NOT NULL,
    metadata json NOT NULL
);


ALTER TABLE public.patterns OWNER TO qontinui;

--
-- Name: patterns_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.patterns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.patterns_id_seq OWNER TO qontinui;

--
-- Name: patterns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.patterns_id_seq OWNED BY public.patterns.id;


--
-- Name: project_access_control; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.project_access_control (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id integer NOT NULL,
    user_id uuid,
    organization_id uuid,
    permission_level character varying DEFAULT 'view'::character varying NOT NULL,
    created_by uuid,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_user_or_org CHECK ((((user_id IS NOT NULL) AND (organization_id IS NULL)) OR ((user_id IS NULL) AND (organization_id IS NOT NULL))))
);


ALTER TABLE public.project_access_control OWNER TO qontinui;

--
-- Name: project_comments; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.project_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id integer NOT NULL,
    workflow_id character varying,
    action_id character varying,
    author_id uuid NOT NULL,
    content text NOT NULL,
    "position" json,
    mentions json,
    resolved boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp without time zone,
    parent_comment_id uuid,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    metadata json
);


ALTER TABLE public.project_comments OWNER TO qontinui;

--
-- Name: project_locks; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.project_locks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id integer NOT NULL,
    user_id uuid NOT NULL,
    resource_type public.resourcetype NOT NULL,
    resource_id character varying NOT NULL,
    acquired_at timestamp without time zone NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    auto_release boolean DEFAULT true NOT NULL,
    metadata json
);


ALTER TABLE public.project_locks OWNER TO qontinui;

--
-- Name: projects; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.projects (
    id integer NOT NULL,
    name character varying NOT NULL,
    description text,
    configuration json NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamp without time zone,
    updated_at timestamp without time zone,
    organization_id uuid
);


ALTER TABLE public.projects OWNER TO qontinui;

--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.projects_id_seq OWNER TO qontinui;

--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;


--
-- Name: screenshot_input_associations; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.screenshot_input_associations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    screenshot_id uuid NOT NULL,
    log_id uuid NOT NULL,
    input_type character varying(100) NOT NULL,
    input_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    timestamp_diff_ms integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE public.screenshot_input_associations OWNER TO qontinui;

--
-- Name: screenshots; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.screenshots (
    id integer NOT NULL,
    snapshot_run_id integer NOT NULL,
    screenshot_path character varying(500) NOT NULL,
    active_states json NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    state_hash character varying(64) NOT NULL,
    metadata json NOT NULL
);


ALTER TABLE public.screenshots OWNER TO qontinui;

--
-- Name: screenshots_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.screenshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.screenshots_id_seq OWNER TO qontinui;

--
-- Name: screenshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.screenshots_id_seq OWNED BY public.screenshots.id;


--
-- Name: session_activities; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.session_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    jti character varying NOT NULL,
    first_login_at timestamp without time zone NOT NULL,
    last_activity_at timestamp without time zone NOT NULL,
    absolute_expiry_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.session_activities OWNER TO qontinui;

--
-- Name: snapshot_runs; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.snapshot_runs (
    id integer NOT NULL,
    run_id character varying(255) NOT NULL,
    run_name character varying(255) NOT NULL,
    project_id integer,
    workflow_id integer,
    "timestamp" timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    states json NOT NULL,
    metadata json NOT NULL,
    tags json NOT NULL,
    num_screenshots integer NOT NULL,
    num_patterns integer NOT NULL,
    description text
);


ALTER TABLE public.snapshot_runs OWNER TO qontinui;

--
-- Name: snapshot_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.snapshot_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.snapshot_runs_id_seq OWNER TO qontinui;

--
-- Name: snapshot_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.snapshot_runs_id_seq OWNED BY public.snapshot_runs.id;


--
-- Name: storage_usage; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.storage_usage (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    file_type character varying NOT NULL,
    file_size bigint NOT NULL,
    file_path character varying NOT NULL,
    project_id integer,
    created_at timestamp without time zone
);


ALTER TABLE public.storage_usage OWNER TO qontinui;

--
-- Name: storage_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.storage_usage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.storage_usage_id_seq OWNER TO qontinui;

--
-- Name: storage_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.storage_usage_id_seq OWNED BY public.storage_usage.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.subscriptions (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    stripe_customer_id character varying,
    stripe_subscription_id character varying,
    stripe_price_id character varying,
    tier character varying NOT NULL,
    status character varying NOT NULL,
    current_period_start timestamp without time zone,
    current_period_end timestamp without time zone,
    cancel_at_period_end boolean,
    canceled_at timestamp without time zone,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


ALTER TABLE public.subscriptions OWNER TO qontinui;

--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subscriptions_id_seq OWNER TO qontinui;

--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying DEFAULT 'member'::character varying NOT NULL,
    permissions json DEFAULT '{}'::json NOT NULL,
    invited_by uuid,
    joined_at timestamp without time zone DEFAULT now() NOT NULL,
    last_active_at timestamp without time zone
);


ALTER TABLE public.team_members OWNER TO qontinui;

--
-- Name: usage_metrics; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.usage_metrics (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    metric_type character varying NOT NULL,
    value numeric NOT NULL,
    "timestamp" timestamp without time zone,
    metric_metadata json
);


ALTER TABLE public.usage_metrics OWNER TO qontinui;

--
-- Name: usage_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: qontinui
--

CREATE SEQUENCE public.usage_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usage_metrics_id_seq OWNER TO qontinui;

--
-- Name: usage_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: qontinui
--

ALTER SEQUENCE public.usage_metrics_id_seq OWNED BY public.usage_metrics.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: qontinui
--

CREATE TABLE public.users (
    username character varying NOT NULL,
    full_name character varying,
    is_beta boolean NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    company character varying,
    phone character varying,
    avatar_url character varying,
    email_verification_token character varying,
    subscription_tier character varying NOT NULL,
    id uuid NOT NULL,
    email character varying(320) NOT NULL,
    hashed_password character varying(1024) NOT NULL,
    is_active boolean NOT NULL,
    is_superuser boolean NOT NULL,
    is_verified boolean NOT NULL,
    login_count integer DEFAULT 0 NOT NULL,
    remember_me_usage_count integer DEFAULT 0 NOT NULL,
    last_login_at timestamp without time zone,
    last_device_fingerprint text,
    automation_streaming_enabled boolean DEFAULT false NOT NULL,
    automation_sessions_limit integer,
    automation_sessions_used integer DEFAULT 0 NOT NULL,
    automation_sessions_reset_at timestamp with time zone
);


ALTER TABLE public.users OWNER TO qontinui;

--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: automation_input_events id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_input_events ALTER COLUMN id SET DEFAULT nextval('public.automation_input_events_id_seq'::regclass);


--
-- Name: automation_videos id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_videos ALTER COLUMN id SET DEFAULT nextval('public.automation_videos_id_seq'::regclass);


--
-- Name: patterns id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.patterns ALTER COLUMN id SET DEFAULT nextval('public.patterns_id_seq'::regclass);


--
-- Name: projects id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: screenshots id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.screenshots ALTER COLUMN id SET DEFAULT nextval('public.screenshots_id_seq'::regclass);


--
-- Name: snapshot_runs id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.snapshot_runs ALTER COLUMN id SET DEFAULT nextval('public.snapshot_runs_id_seq'::regclass);


--
-- Name: storage_usage id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.storage_usage ALTER COLUMN id SET DEFAULT nextval('public.storage_usage_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: usage_metrics id; Type: DEFAULT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.usage_metrics ALTER COLUMN id SET DEFAULT nextval('public.usage_metrics_id_seq'::regclass);


--
-- Data for Name: activity_logs; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.activity_logs (id, project_id, user_id, action_type, resource_type, resource_id, resource_name, changes, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.alembic_version (version_num) FROM stdin;
3dc9c2bf5574
d42d46b1738d
d703626068d7
e1f2g3h4i5j6
f9593625b747
z9fc6936875
\.


--
-- Data for Name: analysis_jobs; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.analysis_jobs (id, annotation_set_id, analyzers_used, parameters, fusion_enabled, fusion_config, status, started_at, completed_at, error_message, total_elements_found, total_fused_elements, analyzer_statistics, created_at, created_by_id) FROM stdin;
\.


--
-- Data for Name: analyzer_results; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.analyzer_results (id, analysis_job_id, analyzer_name, analyzer_type, analyzer_version, elements_found, confidence, analyzer_metadata, execution_time_ms) FROM stdin;
\.


--
-- Data for Name: annotation_sets; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.annotation_sets (id, screenshot_name, screenshot_url, image_width, image_height, screenshots, created_at, updated_at, created_by_id, notes, boundary_width) FROM stdin;
40b4e718-eb82-4a38-97b7-99a27b1711fc	black-desert (4).png	/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/787918a0-13fd-4cbb-862b-e8e15a5318ac.png	1920	1080	[{"name": "black-desert (4).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/787918a0-13fd-4cbb-862b-e8e15a5318ac.png", "width": 1920, "height": 1080}, {"name": "black-desert (5).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/68d772c5-e45f-4ec6-a2e7-2f7e34666f8c.png", "width": 1920, "height": 1080}, {"name": "black-desert (6).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/6496e9e9-d6a5-4102-94f9-952c1bb9a27a.png", "width": 1920, "height": 1080}, {"name": "black-desert (7).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/91d2a26d-8e8e-4533-b138-b3247ab50cd6.png", "width": 1920, "height": 1080}, {"name": "black-desert (8).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/d26e1fe9-7c11-44ac-9803-a23299f84185.png", "width": 1920, "height": 1080}, {"name": "black-desert (1).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/0a3d700b-f084-44a3-b736-26441bf7d990.png", "width": 1920, "height": 1080}, {"name": "black-desert (2).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/c4554075-a9ec-419c-b03b-48d9545e5eb9.png", "width": 1920, "height": 1080}, {"name": "black-desert (3).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/4583f6ae-a79c-422f-9607-36f5ee536543.png", "width": 1920, "height": 1080}]	2025-11-13 21:02:29.178543	2025-11-13 21:02:32.727664	94b892f5-14b7-4a82-8900-92208789f23b		5
52e4487b-0f0f-4bd9-aeeb-11e4e4265b1c	black-desert (3).png	/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/5eb4d1df-ae61-42b6-bc6c-2a192f2cf120.png	1920	1080	[{"name": "black-desert (3).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/5eb4d1df-ae61-42b6-bc6c-2a192f2cf120.png", "width": 1920, "height": 1080}, {"name": "black-desert (4).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/c3457902-baee-4eeb-a5e6-457dc1842594.png", "width": 1920, "height": 1080}, {"name": "black-desert (5).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/f0fceff8-850a-4bd1-9149-daddacb09cad.png", "width": 1920, "height": 1080}, {"name": "black-desert (6).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/bcabe225-93b9-44ec-8bb4-f49809ec45da.png", "width": 1920, "height": 1080}, {"name": "black-desert (7).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/8d189a5c-8454-4bec-a378-ba951bb61c7d.png", "width": 1920, "height": 1080}, {"name": "black-desert (8).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/fe86aaa5-655f-4309-8955-27a8c47d40bc.png", "width": 1920, "height": 1080}, {"name": "black-desert (1).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/4fe68367-0b0e-4b71-94f8-aee231fd478b.png", "width": 1920, "height": 1080}, {"name": "black-desert (2).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/1a4a5601-23b6-498f-a6ca-098585cda53c.png", "width": 1920, "height": 1080}]	2025-11-13 21:07:26.304508	2025-11-13 21:07:26.304512	94b892f5-14b7-4a82-8900-92208789f23b		5
61d57b8e-d009-4330-807b-4a41dfb1fee5	black-desert (1).png	/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/56efd4ee-f4ed-4259-9a9a-395dc666736d.png	1920	1080	[{"name": "black-desert (1).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/56efd4ee-f4ed-4259-9a9a-395dc666736d.png", "width": 1920, "height": 1080}, {"name": "black-desert (2).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/f01d6516-94d5-468f-851d-ea88882f7ca4.png", "width": 1920, "height": 1080}, {"name": "black-desert (3).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/75d04aca-eb99-4f35-ada4-ce1fb32d5ae6.png", "width": 1920, "height": 1080}, {"name": "black-desert (4).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/a0515931-d0f6-49d3-a8c4-6320d503582a.png", "width": 1920, "height": 1080}, {"name": "black-desert (5).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/70d87830-03bf-4807-ac9e-ab3ef03ad3eb.png", "width": 1920, "height": 1080}, {"name": "black-desert (6).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/2136b63b-a778-405d-bb51-a45818276ac2.png", "width": 1920, "height": 1080}, {"name": "black-desert (7).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/f96804b6-8c14-40bd-9c42-8af4f925bf97.png", "width": 1920, "height": 1080}, {"name": "black-desert (8).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/c262451e-f48f-4d4a-8105-b60afe8071b2.png", "width": 1920, "height": 1080}]	2025-11-13 21:10:11.864062	2025-11-13 21:10:11.864066	94b892f5-14b7-4a82-8900-92208789f23b		5
a8ad29bd-55e7-43b0-b0c2-ce727dfa89d4	black-desert (4).png	/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/5714b7e3-d7aa-4845-bef4-ef29a25b0a7c.png	1920	1080	[{"name": "black-desert (4).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/5714b7e3-d7aa-4845-bef4-ef29a25b0a7c.png", "width": 1920, "height": 1080}, {"name": "black-desert (5).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/8b32d4b9-6272-4ed6-98e1-f0912eca6a89.png", "width": 1920, "height": 1080}, {"name": "black-desert (6).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/13784c08-811c-4dbc-ab1e-9685b775360e.png", "width": 1920, "height": 1080}, {"name": "black-desert (7).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/6e0d3a10-c8d7-4f05-a3f3-dc9cddd728aa.png", "width": 1920, "height": 1080}, {"name": "black-desert (8).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/7c377657-8a21-47d4-a1cc-de77a022940a.png", "width": 1920, "height": 1080}, {"name": "black-desert (1).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/2a03448f-27ae-48a1-a6c2-c1fbb0dc9632.png", "width": 1920, "height": 1080}, {"name": "black-desert (2).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/77763ca8-d64a-47b8-b0fe-c7287182d988.png", "width": 1920, "height": 1080}, {"name": "black-desert (3).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/82754077-ac64-4d88-99da-5148e1606241.png", "width": 1920, "height": 1080}]	2025-11-13 20:56:09.424283	2025-11-13 20:56:13.419674	94b892f5-14b7-4a82-8900-92208789f23b		5
d8c765b8-4ad2-44bb-9f9d-84ff574315fe	black-desert (4).png	/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/82f1c361-b291-4809-8c0d-43248e958603.png	1920	1080	[{"name": "black-desert (4).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/82f1c361-b291-4809-8c0d-43248e958603.png", "width": 1920, "height": 1080}, {"name": "black-desert (5).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/7d9e6009-18a2-4f66-b18b-4aed1913b9cd.png", "width": 1920, "height": 1080}, {"name": "black-desert (6).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/f022da0f-6204-4761-af33-c97d353cd0d1.png", "width": 1920, "height": 1080}, {"name": "black-desert (7).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/c55b495c-860b-4156-8fed-406ad6b5bc22.png", "width": 1920, "height": 1080}, {"name": "black-desert (8).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/65953ee1-7a29-4b19-aeb7-a92783d6c1c1.png", "width": 1920, "height": 1080}, {"name": "black-desert (1).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/b4b9dbf2-595c-4d71-aff9-1275b93f16a8.png", "width": 1920, "height": 1080}, {"name": "black-desert (2).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/11c379c4-6914-49b2-ae3f-5bc8a4464b13.png", "width": 1920, "height": 1080}, {"name": "black-desert (3).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/ded069a5-6191-4e72-82e8-fdbfc74b1105.png", "width": 1920, "height": 1080}]	2025-11-13 21:25:46.401753	2025-11-13 21:25:46.401757	94b892f5-14b7-4a82-8900-92208789f23b		5
c9d3f655-fd05-4f2a-ac6c-b75a6b21e81e	black-desert (4).png	/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/15e5a6f8-56e7-4af0-8ab0-57f5be6acead.png	1920	1080	[{"name": "black-desert (4).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/15e5a6f8-56e7-4af0-8ab0-57f5be6acead.png", "width": 1920, "height": 1080}, {"name": "black-desert (5).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/6c7d2776-a243-460c-9017-83bc87fb59f9.png", "width": 1920, "height": 1080}, {"name": "black-desert (6).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/be4b0174-1fab-4ba2-9150-6c7dc2304e7c.png", "width": 1920, "height": 1080}, {"name": "black-desert (7).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/fe58e228-58de-491c-bf7e-3f89ccb9d590.png", "width": 1920, "height": 1080}, {"name": "black-desert (8).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/567e381f-17bb-45d2-9846-63ee065130d4.png", "width": 1920, "height": 1080}, {"name": "black-desert (1).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/88bfa76a-c098-4078-b469-051028cd095b.png", "width": 1920, "height": 1080}, {"name": "black-desert (2).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/fb137a63-b785-40c3-9b31-b5123b922eba.png", "width": 1920, "height": 1080}, {"name": "black-desert (3).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/52f5cf05-1035-42cc-bb25-880d248d50e0.png", "width": 1920, "height": 1080}]	2025-11-14 05:41:30.063111	2025-11-14 05:41:34.859572	94b892f5-14b7-4a82-8900-92208789f23b		5
f63fa3c3-cee4-4156-bc4e-075e43f1ed56	black-desert (6).png	/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/5e6cf894-cd1e-49a0-8419-b9114e8c8869.png	1920	1080	[{"name": "black-desert (6).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/5e6cf894-cd1e-49a0-8419-b9114e8c8869.png", "width": 1920, "height": 1080}, {"name": "black-desert (7).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/2550ee04-5f1f-498f-8d7f-0a3b2008a7b2.png", "width": 1920, "height": 1080}, {"name": "black-desert (8).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/9c21854c-c94b-432c-80d1-b64a6da57904.png", "width": 1920, "height": 1080}, {"name": "black-desert (1).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/fa2b1e73-b856-43b8-b279-9896787b3bad.png", "width": 1920, "height": 1080}, {"name": "black-desert (2).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/7bef1b90-ec38-4701-83c0-e8ff6b6dffe3.png", "width": 1920, "height": 1080}, {"name": "black-desert (3).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/81cef268-d206-45cd-8c21-18592ef4a24c.png", "width": 1920, "height": 1080}, {"name": "black-desert (4).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/cee3dad8-3398-4bf7-90df-4097d08e49c4.png", "width": 1920, "height": 1080}, {"name": "black-desert (5).png", "url": "/uploads/annotations/94b892f5-14b7-4a82-8900-92208789f23b/0064ef21-b4e2-42b3-b2d1-1af2d6e50537.png", "width": 1920, "height": 1080}]	2025-11-14 06:44:49.367528	2025-11-14 20:00:38.398021	94b892f5-14b7-4a82-8900-92208789f23b		5
\.


--
-- Data for Name: annotations; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.annotations (id, annotation_set_id, screenshot_index, x, y, width, height, label, description, reason, extra_data, "order") FROM stdin;
13ea5cd1-6183-461c-bcce-0773092aad90	a8ad29bd-55e7-43b0-b0c2-ce727dfa89d4	0	107	201	25	27	\N	\N	\N	null	0
dc23d121-1ffb-4357-b3fa-874db9cdfe68	a8ad29bd-55e7-43b0-b0c2-ce727dfa89d4	0	163	205	22	23	\N	\N	\N	null	1
483be4cd-a0b4-469c-b1e2-c9b7f32d1961	40b4e718-eb82-4a38-97b7-99a27b1711fc	0	106	205	24	19	\N	\N	\N	null	0
45532c95-8bff-433f-966f-c40888e8edc7	40b4e718-eb82-4a38-97b7-99a27b1711fc	0	161	205	24	22	\N	\N	\N	null	1
bac8569d-b518-4dac-83b1-ed43921a5da5	52e4487b-0f0f-4bd9-aeeb-11e4e4265b1c	0	103	205	28	22	\N	\N	\N	null	0
3339d798-76fb-42ea-a2c1-32c2991b8616	61d57b8e-d009-4330-807b-4a41dfb1fee5	0	106	203	24	22	\N	\N	\N	null	0
dc61b23b-e602-45c7-8186-187f8620a765	d8c765b8-4ad2-44bb-9f9d-84ff574315fe	0	105	205	24	21	\N	\N	\N	null	0
cc874381-2ed5-4153-8c6b-f9abf8cea49e	c9d3f655-fd05-4f2a-ac6c-b75a6b21e81e	0	106	202	26	25	\N	\N	\N	null	0
87d2378c-152d-4078-a759-57a8b69b4511	c9d3f655-fd05-4f2a-ac6c-b75a6b21e81e	0	161	204	26	23	\N	\N	\N	null	1
ee2e8d96-ebfe-4519-8f6c-f006a53075f7	f63fa3c3-cee4-4156-bc4e-075e43f1ed56	0	100	137	21	19	\N	\N	\N	null	0
32898dc9-0942-41db-8d8c-4cff9a209dc7	f63fa3c3-cee4-4156-bc4e-075e43f1ed56	0	104	204	26	23	\N	\N	\N	null	1
21850108-dd52-48b1-aea6-edcb253ecad6	f63fa3c3-cee4-4156-bc4e-075e43f1ed56	0	161	206	25	23	\N	\N	\N	null	2
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.audit_logs (id, user_id, action, resource_type, resource_id, log_metadata, ip_address, created_at) FROM stdin;
\.


--
-- Data for Name: automation_input_events; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.automation_input_events (id, session_id, event_type, "timestamp", mouse_x, mouse_y, mouse_button, drag_from_x, drag_from_y, drag_to_x, drag_to_y, drag_duration, drag_path_points, drag_avg_speed, drag_max_speed, text_typed, character_count, screenshot_before_id, screenshot_after_id, created_at) FROM stdin;
\.


--
-- Data for Name: automation_logs; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.automation_logs (id, session_id, sequence_number, level, message, log_data, "timestamp", created_at) FROM stdin;
\.


--
-- Data for Name: automation_screenshots; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.automation_screenshots (id, session_id, name, storage_path, width, height, content_type, automation_metadata, "timestamp", presigned_url, created_at) FROM stdin;
\.


--
-- Data for Name: automation_sessions; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.automation_sessions (id, project_id, user_id, runner_version, runner_os, runner_hostname, status, configuration_snapshot, created_at, ended_at) FROM stdin;
\.


--
-- Data for Name: automation_videos; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.automation_videos (id, session_id, user_id, project_id, s3_key, duration_seconds, fps, quality, file_size_bytes, created_at) FROM stdin;
\.


--
-- Data for Name: detected_elements; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.detected_elements (id, analyzer_result_id, x, y, width, height, confidence, label, element_type, screenshot_index, element_metadata) FROM stdin;
\.


--
-- Data for Name: device_sessions; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.device_sessions (id, user_id, device_fingerprint, ip_address, user_agent, accept_language, is_trusted, first_seen, last_seen, last_ip, device_name, created_at, updated_at, email_verified, verification_token, verification_sent_at, country, city) FROM stdin;
\.


--
-- Data for Name: fused_elements; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.fused_elements (id, analysis_job_id, x, y, width, height, confidence, votes, sources, source_confidences, label, element_type, screenshot_index, element_metadata) FROM stdin;
\.


--
-- Data for Name: organization_invitations; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.organization_invitations (id, organization_id, email, role, invited_by, token, expires_at, accepted_at, created_at) FROM stdin;
\.


--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.organizations (id, name, slug, description, owner_id, avatar_url, settings, is_active, created_at, updated_at) FROM stdin;
54173d2b-7640-404a-9665-1058af26aaf3	admin's Organization	admin-personal	Personal organization for admin	94b892f5-14b7-4a82-8900-92208789f23b	\N	{}	t	2025-11-12 15:52:55.383869	2025-11-12 15:52:55.383869
\.


--
-- Data for Name: patterns; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.patterns (id, snapshot_run_id, pattern_id, name, type, screenshot_path, region, active_states, confidence, metadata) FROM stdin;
\.


--
-- Data for Name: project_access_control; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.project_access_control (id, project_id, user_id, organization_id, permission_level, created_by, expires_at, created_at) FROM stdin;
0af7107e-d067-499c-9de0-9df3712c27e7	2	\N	54173d2b-7640-404a-9665-1058af26aaf3	admin	94b892f5-14b7-4a82-8900-92208789f23b	\N	2025-11-13 20:47:49.864618
88daa7a4-6b05-44e9-bc0a-0f344b3db774	1	\N	54173d2b-7640-404a-9665-1058af26aaf3	admin	94b892f5-14b7-4a82-8900-92208789f23b	\N	2025-11-13 20:47:48.784306
\.


--
-- Data for Name: project_comments; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.project_comments (id, project_id, workflow_id, action_id, author_id, content, "position", mentions, resolved, resolved_by, resolved_at, parent_comment_id, created_at, updated_at, metadata) FROM stdin;
\.


--
-- Data for Name: project_locks; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.project_locks (id, project_id, user_id, resource_type, resource_id, acquired_at, expires_at, auto_release, metadata) FROM stdin;
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.projects (id, name, description, configuration, owner_id, created_at, updated_at, organization_id) FROM stdin;
2	New Automation 11/13/2025	A new automation workflow	{}	94b892f5-14b7-4a82-8900-92208789f23b	2025-11-13 20:47:49.864618	2025-11-13 20:47:49.864622	54173d2b-7640-404a-9665-1058af26aaf3
1	New Automation 11/13/2025	A new automation workflow	{"name": "New Automation 11/13/2025", "images": [], "screenshots": [], "workflows": [], "states": [], "transitions": [], "categories": ["Main", "Transitions"], "settings": {"mouse": {"click_hold_duration": 100, "click_release_delay": 50, "click_safety_release": true, "double_click_interval": 300, "drag_start_delay": 100, "drag_end_delay": 100, "drag_default_duration": 500, "move_default_duration": 500, "safety_release_delay": 50}, "keyboard": {"key_hold_duration": 50, "key_release_delay": 50, "typing_interval": 50, "hotkey_hold_duration": 100, "hotkey_press_interval": 50}, "find": {"default_timeout": 30000, "default_retry_count": 0, "search_interval": 500}, "wait": {"pause_before_action": 0, "pause_after_action": 0}, "execution": {"default_timeout": 10000, "default_retry_count": 0, "action_delay": 100, "failure_strategy": "continue"}, "recognition": {"default_threshold": 0.7, "multi_scale_search": false, "color_space": "rgb", "edge_detection": false, "ocr_enabled": false}}, "schedules": [], "executionRecords": [], "metadata": {"lastSaved": "2025-11-15T19:26:33.732Z", "version": "1.0.0"}}	94b892f5-14b7-4a82-8900-92208789f23b	2025-11-13 20:47:48.784306	2025-11-15 19:26:44.432289	54173d2b-7640-404a-9665-1058af26aaf3
\.


--
-- Data for Name: screenshot_input_associations; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.screenshot_input_associations (id, screenshot_id, log_id, input_type, input_data, timestamp_diff_ms, created_at) FROM stdin;
\.


--
-- Data for Name: screenshots; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.screenshots (id, snapshot_run_id, screenshot_path, active_states, "timestamp", width, height, state_hash, metadata) FROM stdin;
\.


--
-- Data for Name: session_activities; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.session_activities (id, user_id, jti, first_login_at, last_activity_at, absolute_expiry_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: snapshot_runs; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.snapshot_runs (id, run_id, run_name, project_id, workflow_id, "timestamp", created_at, updated_at, states, metadata, tags, num_screenshots, num_patterns, description) FROM stdin;
\.


--
-- Data for Name: storage_usage; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.storage_usage (id, user_id, file_type, file_size, file_path, project_id, created_at) FROM stdin;
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: team_members; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.team_members (id, organization_id, user_id, role, permissions, invited_by, joined_at, last_active_at) FROM stdin;
be371038-4e62-4d46-808e-a7ec0dbdf089	54173d2b-7640-404a-9665-1058af26aaf3	94b892f5-14b7-4a82-8900-92208789f23b	owner	{}	\N	2025-11-12 15:52:55.383869	\N
\.


--
-- Data for Name: usage_metrics; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.usage_metrics (id, user_id, metric_type, value, "timestamp", metric_metadata) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: qontinui
--

COPY public.users (username, full_name, is_beta, created_at, updated_at, company, phone, avatar_url, email_verification_token, subscription_tier, id, email, hashed_password, is_active, is_superuser, is_verified, login_count, remember_me_usage_count, last_login_at, last_device_fingerprint, automation_streaming_enabled, automation_sessions_limit, automation_sessions_used, automation_sessions_reset_at) FROM stdin;
admin	\N	f	2025-11-12 15:52:55.383869	2025-11-12 15:55:05.186802	\N	\N	\N	\N	free	94b892f5-14b7-4a82-8900-92208789f23b	admin@qontinui.com	$argon2id$v=19$m=65536,t=3,p=4$xjOpJfSmO+Gx0vV/2HEClA$PIh9ro6y4RGnx2J2ewGLKAO+zqy/RJQDeVfiZsAR1vI	t	t	t	0	0	\N	\N	f	\N	0	\N
testuser	Test User	f	2025-11-16 16:24:29.999254	2025-11-16 16:24:36.458429	\N	\N	\N	\N	free	707e6611-404a-4a8f-abe7-bb95199eed8e	test@example.com	$argon2id$v=19$m=65536,t=3,p=4$MRyBR+cijNKoERUosNgjCw$RH8BDnCbJ8hGJ/cuklu+I2x1eMBqI5zNYqrfEz6KmKc	t	f	t	0	0	\N	\N	f	\N	0	\N
\.


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 1, false);


--
-- Name: automation_input_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.automation_input_events_id_seq', 1, false);


--
-- Name: automation_videos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.automation_videos_id_seq', 1, false);


--
-- Name: patterns_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.patterns_id_seq', 1, false);


--
-- Name: projects_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.projects_id_seq', 2, true);


--
-- Name: screenshots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.screenshots_id_seq', 1, false);


--
-- Name: snapshot_runs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.snapshot_runs_id_seq', 1, false);


--
-- Name: storage_usage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.storage_usage_id_seq', 1, false);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.subscriptions_id_seq', 1, false);


--
-- Name: usage_metrics_id_seq; Type: SEQUENCE SET; Schema: public; Owner: qontinui
--

SELECT pg_catalog.setval('public.usage_metrics_id_seq', 1, false);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: analysis_jobs analysis_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.analysis_jobs
    ADD CONSTRAINT analysis_jobs_pkey PRIMARY KEY (id);


--
-- Name: analyzer_results analyzer_results_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.analyzer_results
    ADD CONSTRAINT analyzer_results_pkey PRIMARY KEY (id);


--
-- Name: annotation_sets annotation_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.annotation_sets
    ADD CONSTRAINT annotation_sets_pkey PRIMARY KEY (id);


--
-- Name: annotations annotations_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT annotations_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_input_events automation_input_events_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_input_events
    ADD CONSTRAINT automation_input_events_pkey PRIMARY KEY (id);


--
-- Name: automation_logs automation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_screenshots automation_screenshots_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_screenshots
    ADD CONSTRAINT automation_screenshots_pkey PRIMARY KEY (id);


--
-- Name: automation_sessions automation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_pkey PRIMARY KEY (id);


--
-- Name: automation_videos automation_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_videos
    ADD CONSTRAINT automation_videos_pkey PRIMARY KEY (id);


--
-- Name: detected_elements detected_elements_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.detected_elements
    ADD CONSTRAINT detected_elements_pkey PRIMARY KEY (id);


--
-- Name: device_sessions device_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.device_sessions
    ADD CONSTRAINT device_sessions_pkey PRIMARY KEY (id);


--
-- Name: fused_elements fused_elements_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.fused_elements
    ADD CONSTRAINT fused_elements_pkey PRIMARY KEY (id);


--
-- Name: organization_invitations organization_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: patterns patterns_pattern_id_key; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.patterns
    ADD CONSTRAINT patterns_pattern_id_key UNIQUE (pattern_id);


--
-- Name: patterns patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.patterns
    ADD CONSTRAINT patterns_pkey PRIMARY KEY (id);


--
-- Name: project_access_control project_access_control_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_access_control
    ADD CONSTRAINT project_access_control_pkey PRIMARY KEY (id);


--
-- Name: project_comments project_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_pkey PRIMARY KEY (id);


--
-- Name: project_locks project_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_locks
    ADD CONSTRAINT project_locks_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: screenshot_input_associations screenshot_input_associations_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.screenshot_input_associations
    ADD CONSTRAINT screenshot_input_associations_pkey PRIMARY KEY (id);


--
-- Name: screenshots screenshots_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.screenshots
    ADD CONSTRAINT screenshots_pkey PRIMARY KEY (id);


--
-- Name: session_activities session_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.session_activities
    ADD CONSTRAINT session_activities_pkey PRIMARY KEY (id);


--
-- Name: snapshot_runs snapshot_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.snapshot_runs
    ADD CONSTRAINT snapshot_runs_pkey PRIMARY KEY (id);


--
-- Name: snapshot_runs snapshot_runs_run_id_key; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.snapshot_runs
    ADD CONSTRAINT snapshot_runs_run_id_key UNIQUE (run_id);


--
-- Name: storage_usage storage_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.storage_usage
    ADD CONSTRAINT storage_usage_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_user_id_key; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: organization_invitations uq_invitation_token; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT uq_invitation_token UNIQUE (token);


--
-- Name: team_members uq_org_user; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT uq_org_user UNIQUE (organization_id, user_id);


--
-- Name: organizations uq_organization_slug; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT uq_organization_slug UNIQUE (slug);


--
-- Name: usage_metrics usage_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_invitation_email; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_invitation_email ON public.organization_invitations USING btree (email);


--
-- Name: idx_invitation_org; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_invitation_org ON public.organization_invitations USING btree (organization_id);


--
-- Name: idx_invitation_token; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_invitation_token ON public.organization_invitations USING btree (token);


--
-- Name: idx_org_slug; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_org_slug ON public.organizations USING btree (slug);


--
-- Name: idx_org_user; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_org_user ON public.team_members USING btree (organization_id, user_id);


--
-- Name: idx_project_access_org; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_project_access_org ON public.project_access_control USING btree (organization_id);


--
-- Name: idx_project_access_project; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_project_access_project ON public.project_access_control USING btree (project_id);


--
-- Name: idx_project_access_user; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_project_access_user ON public.project_access_control USING btree (user_id);


--
-- Name: idx_team_member_org; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_team_member_org ON public.team_members USING btree (organization_id);


--
-- Name: idx_team_member_user; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX idx_team_member_user ON public.team_members USING btree (user_id);


--
-- Name: ix_activity_logs_action_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_activity_logs_action_type ON public.activity_logs USING btree (action_type);


--
-- Name: ix_activity_logs_created_at; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_activity_logs_created_at ON public.activity_logs USING btree (created_at);


--
-- Name: ix_activity_logs_project_created; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_activity_logs_project_created ON public.activity_logs USING btree (project_id, created_at);


--
-- Name: ix_activity_logs_project_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_activity_logs_project_id ON public.activity_logs USING btree (project_id);


--
-- Name: ix_activity_logs_resource_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_activity_logs_resource_id ON public.activity_logs USING btree (resource_id);


--
-- Name: ix_activity_logs_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_activity_logs_user_id ON public.activity_logs USING btree (user_id);


--
-- Name: ix_analysis_jobs_annotation_set_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_analysis_jobs_annotation_set_id ON public.analysis_jobs USING btree (annotation_set_id);


--
-- Name: ix_analysis_jobs_status; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_analysis_jobs_status ON public.analysis_jobs USING btree (status);


--
-- Name: ix_analyzer_results_analysis_job_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_analyzer_results_analysis_job_id ON public.analyzer_results USING btree (analysis_job_id);


--
-- Name: ix_analyzer_results_analyzer_name; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_analyzer_results_analyzer_name ON public.analyzer_results USING btree (analyzer_name);


--
-- Name: ix_analyzer_results_analyzer_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_analyzer_results_analyzer_type ON public.analyzer_results USING btree (analyzer_type);


--
-- Name: ix_annotation_sets_screenshot_name; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_annotation_sets_screenshot_name ON public.annotation_sets USING btree (screenshot_name);


--
-- Name: ix_annotations_screenshot_index; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_annotations_screenshot_index ON public.annotations USING btree (screenshot_index);


--
-- Name: ix_annotations_set_screenshot; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_annotations_set_screenshot ON public.annotations USING btree (annotation_set_id, screenshot_index);


--
-- Name: ix_audit_logs_created_at; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_audit_logs_created_at ON public.audit_logs USING btree (created_at);


--
-- Name: ix_audit_logs_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_audit_logs_id ON public.audit_logs USING btree (id);


--
-- Name: ix_audit_logs_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: ix_automation_input_events_event_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_input_events_event_type ON public.automation_input_events USING btree (event_type);


--
-- Name: ix_automation_input_events_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_input_events_id ON public.automation_input_events USING btree (id);


--
-- Name: ix_automation_input_events_session_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_input_events_session_id ON public.automation_input_events USING btree (session_id);


--
-- Name: ix_automation_input_events_session_timestamp; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_input_events_session_timestamp ON public.automation_input_events USING btree (session_id, "timestamp");


--
-- Name: ix_automation_logs_event_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_logs_event_type ON public.automation_logs USING gin (log_data);


--
-- Name: ix_automation_logs_level; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_logs_level ON public.automation_logs USING btree (level);


--
-- Name: ix_automation_logs_session_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_logs_session_id ON public.automation_logs USING btree (session_id);


--
-- Name: ix_automation_logs_session_sequence; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_logs_session_sequence ON public.automation_logs USING btree (session_id, sequence_number);


--
-- Name: ix_automation_logs_timestamp; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_logs_timestamp ON public.automation_logs USING btree ("timestamp");


--
-- Name: ix_automation_screenshots_name; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_screenshots_name ON public.automation_screenshots USING btree (name);


--
-- Name: ix_automation_screenshots_session_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_screenshots_session_id ON public.automation_screenshots USING btree (session_id);


--
-- Name: ix_automation_screenshots_timestamp; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_screenshots_timestamp ON public.automation_screenshots USING btree ("timestamp");


--
-- Name: ix_automation_sessions_project_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_sessions_project_id ON public.automation_sessions USING btree (project_id);


--
-- Name: ix_automation_sessions_status; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_sessions_status ON public.automation_sessions USING btree (status);


--
-- Name: ix_automation_sessions_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_sessions_user_id ON public.automation_sessions USING btree (user_id);


--
-- Name: ix_automation_videos_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_videos_id ON public.automation_videos USING btree (id);


--
-- Name: ix_automation_videos_project_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_videos_project_id ON public.automation_videos USING btree (project_id);


--
-- Name: ix_automation_videos_s3_key; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE UNIQUE INDEX ix_automation_videos_s3_key ON public.automation_videos USING btree (s3_key);


--
-- Name: ix_automation_videos_session_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE UNIQUE INDEX ix_automation_videos_session_id ON public.automation_videos USING btree (session_id);


--
-- Name: ix_automation_videos_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_automation_videos_user_id ON public.automation_videos USING btree (user_id);


--
-- Name: ix_detected_elements_analyzer_result_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_detected_elements_analyzer_result_id ON public.detected_elements USING btree (analyzer_result_id);


--
-- Name: ix_detected_elements_analyzer_screenshot; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_detected_elements_analyzer_screenshot ON public.detected_elements USING btree (analyzer_result_id, screenshot_index);


--
-- Name: ix_detected_elements_element_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_detected_elements_element_type ON public.detected_elements USING btree (element_type);


--
-- Name: ix_detected_elements_screenshot_index; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_detected_elements_screenshot_index ON public.detected_elements USING btree (screenshot_index);


--
-- Name: ix_device_sessions_device_fingerprint; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_device_sessions_device_fingerprint ON public.device_sessions USING btree (device_fingerprint);


--
-- Name: ix_device_sessions_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_device_sessions_user_id ON public.device_sessions USING btree (user_id);


--
-- Name: ix_device_sessions_verification_token; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_device_sessions_verification_token ON public.device_sessions USING btree (verification_token);


--
-- Name: ix_fused_elements_analysis_job_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_fused_elements_analysis_job_id ON public.fused_elements USING btree (analysis_job_id);


--
-- Name: ix_fused_elements_confidence; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_fused_elements_confidence ON public.fused_elements USING btree (confidence);


--
-- Name: ix_fused_elements_element_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_fused_elements_element_type ON public.fused_elements USING btree (element_type);


--
-- Name: ix_fused_elements_job_screenshot; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_fused_elements_job_screenshot ON public.fused_elements USING btree (analysis_job_id, screenshot_index);


--
-- Name: ix_fused_elements_screenshot_index; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_fused_elements_screenshot_index ON public.fused_elements USING btree (screenshot_index);


--
-- Name: ix_fused_elements_votes; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_fused_elements_votes ON public.fused_elements USING btree (votes);


--
-- Name: ix_organizations_name; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_organizations_name ON public.organizations USING btree (name);


--
-- Name: ix_patterns_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_patterns_id ON public.patterns USING btree (id);


--
-- Name: ix_patterns_pattern_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_patterns_pattern_id ON public.patterns USING btree (pattern_id);


--
-- Name: ix_patterns_snapshot_run_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_patterns_snapshot_run_id ON public.patterns USING btree (snapshot_run_id);


--
-- Name: ix_patterns_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_patterns_type ON public.patterns USING btree (type);


--
-- Name: ix_project_comments_action_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_comments_action_id ON public.project_comments USING btree (action_id);


--
-- Name: ix_project_comments_author_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_comments_author_id ON public.project_comments USING btree (author_id);


--
-- Name: ix_project_comments_created_at; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_comments_created_at ON public.project_comments USING btree (created_at);


--
-- Name: ix_project_comments_parent_comment_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_comments_parent_comment_id ON public.project_comments USING btree (parent_comment_id);


--
-- Name: ix_project_comments_project_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_comments_project_id ON public.project_comments USING btree (project_id);


--
-- Name: ix_project_comments_resolved; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_comments_resolved ON public.project_comments USING btree (resolved);


--
-- Name: ix_project_comments_workflow_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_comments_workflow_id ON public.project_comments USING btree (workflow_id);


--
-- Name: ix_project_locks_expires_at; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_locks_expires_at ON public.project_locks USING btree (expires_at);


--
-- Name: ix_project_locks_project_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_locks_project_id ON public.project_locks USING btree (project_id);


--
-- Name: ix_project_locks_project_resource; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_locks_project_resource ON public.project_locks USING btree (project_id, resource_id);


--
-- Name: ix_project_locks_resource_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_locks_resource_id ON public.project_locks USING btree (resource_id);


--
-- Name: ix_project_locks_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_project_locks_user_id ON public.project_locks USING btree (user_id);


--
-- Name: ix_projects_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_projects_id ON public.projects USING btree (id);


--
-- Name: ix_projects_organization_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_projects_organization_id ON public.projects USING btree (organization_id);


--
-- Name: ix_screenshot_input_assoc_log; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_screenshot_input_assoc_log ON public.screenshot_input_associations USING btree (log_id);


--
-- Name: ix_screenshot_input_assoc_screenshot; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_screenshot_input_assoc_screenshot ON public.screenshot_input_associations USING btree (screenshot_id);


--
-- Name: ix_screenshot_input_associations_input_type; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_screenshot_input_associations_input_type ON public.screenshot_input_associations USING btree (input_type);


--
-- Name: ix_screenshots_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_screenshots_id ON public.screenshots USING btree (id);


--
-- Name: ix_screenshots_snapshot_run_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_screenshots_snapshot_run_id ON public.screenshots USING btree (snapshot_run_id);


--
-- Name: ix_screenshots_state_hash; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_screenshots_state_hash ON public.screenshots USING btree (state_hash);


--
-- Name: ix_session_activities_jti; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE UNIQUE INDEX ix_session_activities_jti ON public.session_activities USING btree (jti);


--
-- Name: ix_session_activities_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_session_activities_user_id ON public.session_activities USING btree (user_id);


--
-- Name: ix_snapshot_runs_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_snapshot_runs_id ON public.snapshot_runs USING btree (id);


--
-- Name: ix_snapshot_runs_project_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_snapshot_runs_project_id ON public.snapshot_runs USING btree (project_id);


--
-- Name: ix_snapshot_runs_run_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_snapshot_runs_run_id ON public.snapshot_runs USING btree (run_id);


--
-- Name: ix_snapshot_runs_workflow_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_snapshot_runs_workflow_id ON public.snapshot_runs USING btree (workflow_id);


--
-- Name: ix_storage_usage_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_storage_usage_id ON public.storage_usage USING btree (id);


--
-- Name: ix_storage_usage_user_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_storage_usage_user_id ON public.storage_usage USING btree (user_id);


--
-- Name: ix_subscriptions_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_subscriptions_id ON public.subscriptions USING btree (id);


--
-- Name: ix_subscriptions_stripe_customer_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_subscriptions_stripe_customer_id ON public.subscriptions USING btree (stripe_customer_id);


--
-- Name: ix_subscriptions_stripe_subscription_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_subscriptions_stripe_subscription_id ON public.subscriptions USING btree (stripe_subscription_id);


--
-- Name: ix_usage_metrics_id; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_usage_metrics_id ON public.usage_metrics USING btree (id);


--
-- Name: ix_usage_metrics_timestamp; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_usage_metrics_timestamp ON public.usage_metrics USING btree ("timestamp");


--
-- Name: ix_users_automation_streaming_enabled; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_users_automation_streaming_enabled ON public.users USING btree (automation_streaming_enabled);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_last_login_at; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE INDEX ix_users_last_login_at ON public.users USING btree (last_login_at);


--
-- Name: ix_users_username; Type: INDEX; Schema: public; Owner: qontinui
--

CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);


--
-- Name: activity_logs activity_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: analysis_jobs analysis_jobs_annotation_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.analysis_jobs
    ADD CONSTRAINT analysis_jobs_annotation_set_id_fkey FOREIGN KEY (annotation_set_id) REFERENCES public.annotation_sets(id) ON DELETE CASCADE;


--
-- Name: analysis_jobs analysis_jobs_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.analysis_jobs
    ADD CONSTRAINT analysis_jobs_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: analyzer_results analyzer_results_analysis_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.analyzer_results
    ADD CONSTRAINT analyzer_results_analysis_job_id_fkey FOREIGN KEY (analysis_job_id) REFERENCES public.analysis_jobs(id) ON DELETE CASCADE;


--
-- Name: annotation_sets annotation_sets_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.annotation_sets
    ADD CONSTRAINT annotation_sets_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: annotations annotations_annotation_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.annotations
    ADD CONSTRAINT annotations_annotation_set_id_fkey FOREIGN KEY (annotation_set_id) REFERENCES public.annotation_sets(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_input_events automation_input_events_screenshot_after_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_input_events
    ADD CONSTRAINT automation_input_events_screenshot_after_id_fkey FOREIGN KEY (screenshot_after_id) REFERENCES public.automation_screenshots(id) ON DELETE SET NULL;


--
-- Name: automation_input_events automation_input_events_screenshot_before_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_input_events
    ADD CONSTRAINT automation_input_events_screenshot_before_id_fkey FOREIGN KEY (screenshot_before_id) REFERENCES public.automation_screenshots(id) ON DELETE SET NULL;


--
-- Name: automation_input_events automation_input_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_input_events
    ADD CONSTRAINT automation_input_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.automation_sessions(id) ON DELETE CASCADE;


--
-- Name: automation_logs automation_logs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.automation_sessions(id) ON DELETE CASCADE;


--
-- Name: automation_screenshots automation_screenshots_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_screenshots
    ADD CONSTRAINT automation_screenshots_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.automation_sessions(id) ON DELETE CASCADE;


--
-- Name: automation_sessions automation_sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: automation_sessions automation_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: automation_videos automation_videos_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_videos
    ADD CONSTRAINT automation_videos_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: automation_videos automation_videos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.automation_videos
    ADD CONSTRAINT automation_videos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: detected_elements detected_elements_analyzer_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.detected_elements
    ADD CONSTRAINT detected_elements_analyzer_result_id_fkey FOREIGN KEY (analyzer_result_id) REFERENCES public.analyzer_results(id) ON DELETE CASCADE;


--
-- Name: device_sessions device_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.device_sessions
    ADD CONSTRAINT device_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: projects fk_projects_organization_id; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT fk_projects_organization_id FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: fused_elements fused_elements_analysis_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.fused_elements
    ADD CONSTRAINT fused_elements_analysis_job_id_fkey FOREIGN KEY (analysis_job_id) REFERENCES public.analysis_jobs(id) ON DELETE CASCADE;


--
-- Name: organization_invitations organization_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_invitations organization_invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: patterns patterns_snapshot_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.patterns
    ADD CONSTRAINT patterns_snapshot_run_id_fkey FOREIGN KEY (snapshot_run_id) REFERENCES public.snapshot_runs(id) ON DELETE CASCADE;


--
-- Name: project_access_control project_access_control_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_access_control
    ADD CONSTRAINT project_access_control_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_access_control project_access_control_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_access_control
    ADD CONSTRAINT project_access_control_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: project_access_control project_access_control_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_access_control
    ADD CONSTRAINT project_access_control_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_access_control project_access_control_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_access_control
    ADD CONSTRAINT project_access_control_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: project_comments project_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: project_comments project_comments_parent_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.project_comments(id) ON DELETE CASCADE;


--
-- Name: project_comments project_comments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_comments project_comments_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_locks project_locks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_locks
    ADD CONSTRAINT project_locks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_locks project_locks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.project_locks
    ADD CONSTRAINT project_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: screenshot_input_associations screenshot_input_associations_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.screenshot_input_associations
    ADD CONSTRAINT screenshot_input_associations_log_id_fkey FOREIGN KEY (log_id) REFERENCES public.automation_logs(id) ON DELETE CASCADE;


--
-- Name: screenshot_input_associations screenshot_input_associations_screenshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.screenshot_input_associations
    ADD CONSTRAINT screenshot_input_associations_screenshot_id_fkey FOREIGN KEY (screenshot_id) REFERENCES public.automation_screenshots(id) ON DELETE CASCADE;


--
-- Name: screenshots screenshots_snapshot_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.screenshots
    ADD CONSTRAINT screenshots_snapshot_run_id_fkey FOREIGN KEY (snapshot_run_id) REFERENCES public.snapshot_runs(id) ON DELETE CASCADE;


--
-- Name: session_activities session_activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.session_activities
    ADD CONSTRAINT session_activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: snapshot_runs snapshot_runs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.snapshot_runs
    ADD CONSTRAINT snapshot_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: storage_usage storage_usage_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.storage_usage
    ADD CONSTRAINT storage_usage_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: storage_usage storage_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.storage_usage
    ADD CONSTRAINT storage_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: team_members team_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: team_members team_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: usage_metrics usage_metrics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: qontinui
--

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict yBjt2b7CTdCENjBhRSRheuLCatdwpA89JfbPhZlJl86naPvt4pxT6x6OGn8DUxn

