"""
Testing API endpoints package.

This package provides REST API endpoints for software testing results:
- Runner -> Backend: Reporting test results (test runs, transitions, deficiencies, screenshots)
- Web Frontend -> Backend: Querying test history and analytics

The endpoints are split into modules by responsibility:
- runner_endpoints: Endpoints for the Qontinui Runner to report results
- query_endpoints: Endpoints for the web frontend to query test data
- deficiency_endpoints: Endpoints for deficiency management
"""

from fastapi import APIRouter

from .deficiency_endpoints import router as deficiency_router
from .query_endpoints import router as query_router
from .runner_endpoints import router as runner_router

# Create the main router that combines all sub-routers
router = APIRouter()

# Include all sub-routers
# Runner endpoints: create runs, report transitions/deficiencies, upload screenshots
router.include_router(runner_router)

# Query endpoints: list/get runs, coverage trends, reliability stats
router.include_router(query_router)

# Deficiency endpoints: list/get/update deficiencies, add comments
router.include_router(deficiency_router)

__all__ = ["router"]
