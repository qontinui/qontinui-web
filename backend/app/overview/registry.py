"""Every editable overview resource, declared once.

Plan ``2026-09-20-overview-authoring-layer`` §2. The generic router
(:mod:`app.overview.router`) builds the CRUD routes for every entry that
names a store; the catalog route serves every entry's permission and JSON
Schemas to the frontend editing kit, so the form validates against exactly
what the API enforces. A new resource is an entry here plus its store (and a
migration if it owns tables) — not a new endpoint file.

``tests/test_overview_authoring.py`` asserts the registry is EXHAUSTIVE: every
table in the ``overview`` schema is owned by an entry or listed in
:data:`EXCLUDED_TABLES` with a reason. That is what stops a resource shipping
without audit or permissions.
"""

from __future__ import annotations

from app.costs.effort import (
    EffortEntryCreate,
    EffortEntryRead,
    EffortEntryUpdate,
    effort_entry_store,
)
from app.costs.entries import (
    CostEntryCreate,
    CostEntryRead,
    CostEntryUpdate,
    cost_entry_store,
)
from app.overview.estimates import estimate_store
from app.overview.files import FileRead, file_store
from app.overview.intent_documents import (
    IntentDocumentCreate,
    IntentDocumentRead,
    IntentDocumentUpdate,
    intent_document_store,
)
from app.overview.pages import PageCreate, PageRead, PageUpdate, page_store
from app.overview.resource import ResourceSpec
from app.schemas.overview import (
    EstimateCreate,
    EstimateRead,
    EstimateUpdate,
    OverviewSettingsRead,
    OverviewSettingsWrite,
)
from app.spend.resources import (
    RecurringCostCreate,
    RecurringCostRead,
    RecurringCostUpdate,
    SpendRuleCreate,
    SpendRuleRead,
    SpendRuleUpdate,
    VendorCreate,
    VendorRead,
    VendorUpdate,
    recurring_cost_store,
    spend_rule_store,
    vendor_store,
)

REGISTRY: dict[str, ResourceSpec] = {
    spec.name: spec
    for spec in (
        ResourceSpec(
            name="intent_documents",
            path="intent-documents",
            title="The project's description",
            description=(
                "What the project is, what it is working towards, how success "
                "is measured and who it is for. Stored in coord as the tenant's "
                "intent documents; addressed '<kind>:<name>'."
            ),
            permission="coord_admin",
            read_model=IntentDocumentRead,
            create_model=IntentDocumentCreate,
            update_model=IntentDocumentUpdate,
            operations=frozenset({"list", "get", "create", "update"}),
            list_filters=("kind",),
            store=intent_document_store,
        ),
        ResourceSpec(
            name="estimates",
            path="estimates",
            title="Estimates",
            description=(
                "The estimate a project is approved against: a head row and its "
                "content graph (roles, phases with tasks and per-role efforts, "
                "the phase x role FTE matrix, price tiers, cost lines, calendar "
                "breaks). 'content' on a create or update replaces the whole "
                "graph in the same version as the head fields beside it; a list "
                "read carries no graph (content is null). Derived figures: GET "
                "/estimates/{id}/rollup. Money is integer micros."
            ),
            permission="editing_roles",
            read_model=EstimateRead,
            create_model=EstimateCreate,
            update_model=EstimateUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            store=estimate_store,
            tables=(
                "estimates",
                "phases",
                "phase_tasks",
                "roles",
                "task_efforts",
                "phase_allocations",
                "price_tiers",
                "cost_lines",
                "calendar_breaks",
            ),
        ),
        ResourceSpec(
            name="pages",
            path="pages",
            title="Documents and wiki pages",
            description=(
                "Markdown documents and wiki pages, with full version history "
                "(GET /pages/{id}/versions, POST …/versions/{n}/revert) and "
                "backlinks (GET /pages/{id}/backlinks). Filters: kind, slug, q "
                "(full-text). A list read carries no bodies (body_md is null)."
            ),
            permission="editing_roles",
            read_model=PageRead,
            create_model=PageCreate,
            update_model=PageUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            list_filters=("kind", "slug", "q"),
            store=page_store,
            tables=("pages", "page_versions", "page_links"),
            audit_exclude=frozenset({"body_md"}),
        ),
        ResourceSpec(
            name="files",
            path="files",
            title="Uploaded files",
            description=(
                "Uploaded files. Upload is multipart POST /files (fields: file, "
                "optional page_id); download is GET /files/{id}/content. Types: "
                "pdf, docx, xlsx, pptx, png, jpg, md, csv; 25 MB each, 1 GB per "
                "project. Filters: page_id, q (filename)."
            ),
            permission="editing_roles",
            read_model=FileRead,
            # "create" is served by the multipart upload route, not the
            # generic JSON one (no create_model, so none is mounted).
            operations=frozenset({"list", "get", "create", "delete"}),
            list_filters=("page_id", "q"),
            store=file_store,
            tables=("files",),
        ),
        ResourceSpec(
            name="vendors",
            path="spend/vendors",
            title="Vendors",
            description=(
                "Who the project pays. A vendor carries no money: its figures "
                "come from its connector (connector + non-secret "
                'connector_config, e.g. {"org": "qontinui"}) or from its '
                "recurring costs. Credentials never go here."
            ),
            permission="project_admin",
            read_model=VendorRead,
            create_model=VendorCreate,
            update_model=VendorUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            store=vendor_store,
            tables=("vendors",),
        ),
        ResourceSpec(
            name="spend_rules",
            path="spend/rules",
            title="Spend alert rules",
            description=(
                "Alert thresholds for one vendor (vendor_id) or org-wide "
                "(vendor_id null): monthly_ceiling_micros with "
                "mtd_thresholds_pct, daily_abs_micros, spike_multiplier over "
                "median_window_days, and product_filter (which provider "
                "products the rule counts). Money is integer micros. Filter: "
                "vendor_id."
            ),
            permission="project_admin",
            read_model=SpendRuleRead,
            create_model=SpendRuleCreate,
            update_model=SpendRuleUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            list_filters=("vendor_id",),
            store=spend_rule_store,
            tables=("spend_rules",),
        ),
        ResourceSpec(
            name="recurring_costs",
            path="spend/recurring-costs",
            title="Recurring costs",
            description=(
                "A provider invoice amount with no billing API, entered from "
                "the invoice: unit_amount_micros x quantity, charged monthly "
                "or annually from start_date (an annual entry renews on "
                "renews_on when set). Materialised on read; never estimated. "
                "Filter: vendor_id."
            ),
            permission="project_admin",
            read_model=RecurringCostRead,
            create_model=RecurringCostCreate,
            update_model=RecurringCostUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            list_filters=("vendor_id",),
            store=recurring_cost_store,
            tables=("recurring_costs",),
        ),
        ResourceSpec(
            name="cost_entries",
            path="costs/entries",
            title="Cost entries",
            description=(
                "Costs as entered from an invoice (source manual: fully "
                "editable) and as providers reported them (source connector / "
                "recurring: only phase_id and fx_rate_to_base can change, 422 "
                "provider_reported_field; DELETE is 409 provider_reported). "
                "Amount is signed integer micros in currency; fx_rate_to_base "
                "is base units per unit of currency. A multi-day entry is "
                "spread per day in the amortized view. Filters: vendor_id, "
                "phase_id (or 'none'), source, from, to, limit (default 500, "
                "at most 5000; every row: GET /costs/ledger)."
            ),
            permission="project_admin",
            read_model=CostEntryRead,
            create_model=CostEntryCreate,
            update_model=CostEntryUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            list_filters=("vendor_id", "phase_id", "source", "from", "to", "limit"),
            store=cost_entry_store,
            tables=("cost_entries",),
        ),
        ResourceSpec(
            name="effort_entries",
            path="costs/effort-entries",
            title="Logged time",
            description=(
                "Time worked on the project, in hours (at most 24 per person "
                "per day). Any member may log, edit and delete their own time; "
                "whoever may edit the overview may write anybody's (403 "
                "not_your_entry otherwise; 'editable' on every entry says "
                "which). Time for someone else is named by 'person' (free "
                "text) or by account (person_user_id) — by account only for a "
                "project admin, since coord answers membership to admins only "
                "(422 membership_unverified otherwise; 422 not_a_member for a "
                "non-member). Under labour_billing day_rates an entry names its "
                "role_code and is priced from the baseline estimate's day rate "
                "when logged (422 role_not_priced when it has none); the rate "
                "is kept on the entry so later rate edits do not rewrite "
                "history. Filters: from, to, phase_id (or 'none'), "
                "person_user_id, mine=true, limit (default 500, at most "
                "5000; every row: GET /costs/ledger)."
            ),
            permission="member_self",
            read_model=EffortEntryRead,
            create_model=EffortEntryCreate,
            update_model=EffortEntryUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            list_filters=("from", "to", "phase_id", "person_user_id", "mine", "limit"),
            store=effort_entry_store,
            tables=("effort_entries",),
            # Per-caller, not part of the record: who may edit it depends on
            # who is reading.
            audit_derived=frozenset({"editable"}),
        ),
        ResourceSpec(
            name="settings",
            path="settings",
            title="Project settings",
            description=(
                "Currency, working-day assumptions, and editing_roles — which "
                "roles may edit the overview. Only an administrator may change "
                "them, since they decide who else may."
            ),
            permission="project_admin",
            read_model=OverviewSettingsRead,
            update_model=OverviewSettingsWrite,
            operations=frozenset({"get", "update"}),
            tables=("settings",),
        ),
    )
}

#: ``overview.*`` tables no resource owns, each with the reason. Adding a table
#: to the schema without adding it to an entry or here fails the
#: exhaustiveness test.
EXCLUDED_TABLES: dict[str, str] = {
    "change_log": "the audit trail itself — every resource writes it, none edits it",
    "cost_import_runs": "system-written: one row per ingest attempt",
    "spend_alerts": "system-written by the spend_evaluate scheduler task",
    "spend_push_deliveries": "system-written: the alert pushes and their receipts",
    "import_tokens": (
        "a credential table: minted, listed and revoked only through "
        "/spend/import-tokens, never generic CRUD"
    ),
    "spend_alert_preferences": (
        "each user's own switch, written through /spend/alert-preferences"
    ),
}
