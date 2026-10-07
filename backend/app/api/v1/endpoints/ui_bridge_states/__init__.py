"""API endpoints for UI Bridge state discovery and management.

Provides endpoints to:
- Discover states from render logs and save to database
- Manage state configurations per project
- Update state descriptions and acceptance criteria
- Manage domain knowledge and link it to states

``router`` composes the sub-routers in the order their routes were registered
when this was one module; ``tests/api/test_ui_bridge_states_route_table.py``
pins that order. Keep it when adding a route.
"""

from fastapi import APIRouter

from . import (
    configs,
    domain_knowledge,
    exploration_sessions,
    runner_commands,
    transitions,
)

router = APIRouter()
router.include_router(configs.router)
router.include_router(domain_knowledge.router)
router.include_router(runner_commands.discover_router)
router.include_router(exploration_sessions.router)
router.include_router(transitions.router)
router.include_router(configs.export_router)
router.include_router(runner_commands.pathfind_router)
router.include_router(configs.full_router)
