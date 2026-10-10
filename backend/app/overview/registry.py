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

from app.overview.estimates import estimate_store
from app.overview.files import FileRead, file_store
from app.overview.intent_documents import (
    IntentDocumentCreate,
    IntentDocumentRead,
    IntentDocumentUpdate,
    intent_document_store,
)
from app.overview.milestones import milestone_store
from app.overview.pages import PageCreate, PageRead, PageUpdate, page_store
from app.overview.phase_progress import phase_progress_store
from app.overview.resource import ResourceSpec
from app.schemas.overview import (
    EstimateCreate,
    EstimateRead,
    EstimateUpdate,
    MilestoneCreate,
    MilestoneRead,
    MilestoneUpdate,
    OverviewSettingsRead,
    OverviewSettingsWrite,
    PhaseProgressRead,
    PhaseProgressUpdate,
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
                "read carries no graph (content is null). A phase whose code a "
                "content write keeps keeps its id and its progress; progress "
                "(actual dates, gate outcomes) is written through phase_progress, "
                "never through content. Derived figures: GET "
                "/estimates/{id}/rollup and /estimates/{id}/forecast. Money is "
                "integer micros."
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
            name="phase_progress",
            path="phase-progress",
            title="Phase progress",
            description=(
                "What actually happened in each phase of an estimate: actual "
                "start and end, and the gate's outcome (pending / passed / "
                "failed / waived, with the date it was decided and a note). "
                "The id is the phase's id; the plan fields beside them are the "
                "estimate's and read-only here. Versioned apart from the "
                "estimate, so recording progress never conflicts with an "
                "estimate save. A list reads one estimate's phases: "
                "?estimate_id=, else the baseline. No create or delete — "
                "phases come from the estimate's plan. The phases table itself "
                "is owned by estimates."
            ),
            permission="editing_roles",
            read_model=PhaseProgressRead,
            update_model=PhaseProgressUpdate,
            operations=frozenset({"list", "get", "update"}),
            list_filters=("estimate_id",),
            store=phase_progress_store,
        ),
        ResourceSpec(
            name="milestones",
            path="milestones",
            title="Milestones",
            description=(
                "Dated markers on the Timeline — pilots, first value, any other "
                "milestone — each optionally tied to a phase of this project's "
                "estimate (a phase that goes detaches it, as a logged write). "
                "A milestone is done exactly when it has a completed_date. "
                "Filters: phase_id (repeatable; 'none' for unphased), status."
            ),
            permission="editing_roles",
            read_model=MilestoneRead,
            create_model=MilestoneCreate,
            update_model=MilestoneUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            list_filters=("phase_id", "status"),
            store=milestone_store,
            tables=("milestones",),
        ),
        ResourceSpec(
            name="pages",
            path="pages",
            title="Documents and wiki pages",
            description=(
                "Markdown documents and wiki pages, with full version history "
                "(GET /pages/{id}/versions, POST …/versions/{n}/revert) and "
                "backlinks (GET /pages/{id}/backlinks). Filters: kind, slug, q "
                "(full-text), source_repo + source_path (exact: the repository "
                "file a published page mirrors). A list read carries no bodies "
                "(body_md is null). A page published from a repository carries "
                "source_repo/source_path/source_sha; a PATCH naming a source "
                "refuses a page with none or another (409 source_mismatch), and "
                "a keyed create colliding on a source converges on that page. "
                "via_device/via_session say which device and reported session "
                "wrote the current version."
            ),
            permission="editing_roles",
            read_model=PageRead,
            create_model=PageCreate,
            update_model=PageUpdate,
            operations=frozenset({"list", "get", "create", "update", "delete"}),
            list_filters=("kind", "slug", "q", "source_repo", "source_path"),
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
