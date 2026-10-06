"""Route-table snapshot for the ``ui_bridge_states`` router package.

Plan ``2026-10-04-web-ui-bridge-states-endpoint-inlines-its-crud-and-discovery``
Phase 3 split ``endpoints/ui_bridge_states.py`` into a package of sub-routers.
The OpenAPI snapshot cannot catch a function rename (``export_openapi.py``
canonicalizes operationIds from path and method), so this test freezes what it
does not: each route's endpoint function name, alongside method, full mounted
path, response model, status code and tags — and the order the routes are
registered in, which ``__init__`` reproduces by interleaving the sub-routers.

``EXPECTED_ROUTES`` is a checked-in literal generated from the PRE-split
module at ``446844ba5``. Do not regenerate it from the package: a literal
computed from the code under test pins nothing.
"""

from fastapi.routing import APIRoute

ENDPOINT_PACKAGE = "app.api.v1.endpoints.ui_bridge_states"

TAGS = ("ui-bridge-states",)

# (method, mounted path, endpoint.__name__, response_model.__name__ | None,
#  status_code, tags) — in registration order.
EXPECTED_ROUTES: list[tuple[str, str, str, str | None, int, tuple[str, ...]]] = [
    (
        "GET",
        "/api/v1/projects/{project_id}/ui-bridge-configs",
        "list_state_configs",
        "UIBridgeStateConfigListResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}",
        "get_state_config",
        "UIBridgeStateConfigWithStates",
        200,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/ui-bridge-configs",
        "create_state_config",
        "UIBridgeStateConfigResponse",
        201,
        ("ui-bridge-states",),
    ),
    (
        "PATCH",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}",
        "update_state_config",
        "UIBridgeStateConfigResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "DELETE",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}",
        "delete_state_config",
        None,
        204,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/states",
        "list_states",
        "UIBridgeStateListResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}",
        "get_state",
        "UIBridgeStateResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "PATCH",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}",
        "update_state",
        "UIBridgeStateResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}/knowledge",
        "link_domain_knowledge",
        "UIBridgeStateResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "DELETE",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/states/{state_id}/knowledge/{knowledge_id}",
        "unlink_domain_knowledge",
        None,
        204,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/domain-knowledge",
        "list_domain_knowledge",
        "DomainKnowledgeListResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/domain-knowledge",
        "create_domain_knowledge",
        "DomainKnowledgeResponse",
        201,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/domain-knowledge/{knowledge_id}",
        "get_domain_knowledge",
        "DomainKnowledgeResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "PATCH",
        "/api/v1/projects/{project_id}/domain-knowledge/{knowledge_id}",
        "update_domain_knowledge",
        "DomainKnowledgeResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "DELETE",
        "/api/v1/projects/{project_id}/domain-knowledge/{knowledge_id}",
        "delete_domain_knowledge",
        None,
        204,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/ui-bridge-discover",
        "discover_and_save_states",
        "UIBridgeDiscoverAndSaveResponse",
        201,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/exploration-sessions",
        "list_exploration_sessions",
        "ExplorationSessionListResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/exploration-sessions",
        "create_exploration_session",
        "ExplorationSessionResponse",
        201,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/exploration-sessions/{session_id}",
        "get_exploration_session",
        "ExplorationSessionWithRenders",
        200,
        ("ui-bridge-states",),
    ),
    (
        "PATCH",
        "/api/v1/projects/{project_id}/exploration-sessions/{session_id}",
        "update_exploration_session",
        "ExplorationSessionResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/exploration-sessions/{session_id}/renders",
        "append_renders_to_session",
        "ExplorationSessionResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "DELETE",
        "/api/v1/projects/{project_id}/exploration-sessions/{session_id}",
        "delete_exploration_session",
        None,
        204,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/transitions",
        "list_transitions",
        "UIBridgeTransitionListResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/transitions",
        "create_transition",
        "UIBridgeTransitionResponse",
        201,
        ("ui-bridge-states",),
    ),
    (
        "PATCH",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/transitions/{transition_id}",
        "update_transition",
        "UIBridgeTransitionResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "DELETE",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/transitions/{transition_id}",
        "delete_transition",
        None,
        204,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/export",
        "export_config",
        "ExportResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "POST",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/pathfind",
        "pathfind",
        "PathfindingResponse",
        200,
        ("ui-bridge-states",),
    ),
    (
        "GET",
        "/api/v1/projects/{project_id}/ui-bridge-configs/{config_id}/full",
        "get_state_config_full",
        "UIBridgeStateConfigWithStatesAndTransitions",
        200,
        ("ui-bridge-states",),
    ),
]


def _mounted_routes() -> list[tuple[str, str, str, str | None, int, tuple[str, ...]]]:
    from app.main import app

    rows: list[tuple[str, str, str, str | None, int, tuple[str, ...]]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if not route.endpoint.__module__.startswith(ENDPOINT_PACKAGE):
            continue
        model = route.response_model
        for method in sorted(route.methods):
            rows.append(
                (
                    method,
                    route.path,
                    route.endpoint.__name__,
                    model.__name__ if model is not None else None,
                    route.status_code,
                    tuple(route.tags),
                )
            )
    return rows


def test_route_table_matches_the_pre_split_snapshot() -> None:
    assert sorted(_mounted_routes()) == sorted(EXPECTED_ROUTES)


def test_route_registration_order_is_unchanged() -> None:
    assert _mounted_routes() == EXPECTED_ROUTES


def test_snapshot_covers_all_29_routes() -> None:
    assert len(EXPECTED_ROUTES) == 29
    assert all(r[5] == TAGS for r in EXPECTED_ROUTES)
