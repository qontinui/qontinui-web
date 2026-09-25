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

from app.overview.intent_documents import (
    IntentDocumentCreate,
    IntentDocumentRead,
    IntentDocumentUpdate,
    intent_document_store,
)
from app.overview.resource import ResourceSpec
from app.schemas.overview import (
    EstimateCreate,
    EstimateSummary,
    EstimateUpdate,
    OverviewSettingsRead,
    OverviewSettingsWrite,
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
                "The estimate a project is approved against. Its routes are "
                "hand-written in app/api/v1/endpoints/overview.py until the "
                "plan's Phase 3 refits it onto this contract; the entry is "
                "here so its permission is served like every other resource's."
            ),
            permission="editing_roles",
            read_model=EstimateSummary,
            create_model=EstimateCreate,
            update_model=EstimateUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
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
}
