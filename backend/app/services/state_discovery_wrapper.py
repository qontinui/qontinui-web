"""
State Discovery Wrapper Service

Provides a unified interface for state discovery that routes to the appropriate
implementation based on the algorithm parameter.

This wrapper supports:
- "timestamp_clustering": Simple timestamp-based algorithm
- "computer_vision": Advanced computer vision with perceptual hashing
"""

import time
from typing import Any, Optional
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_session import AutomationSession
from app.schemas.state_discovery import StateDiscoveryResponse

logger = structlog.get_logger(__name__)


class StateDiscoveryWrapperService:
    """
    Unified wrapper for state discovery algorithms.

    Routes requests to the appropriate implementation based on algorithm choice.
    """

    async def discover_states_from_session(
        self,
        session_id: UUID,
        db: AsyncSession,
        algorithm: str = "timestamp_clustering",
        parameters: Optional[dict[str, Any]] = None,
    ) -> StateDiscoveryResponse:
        """
        Discover states from an automation session.

        Args:
            session_id: Automation session UUID
            db: Database session
            algorithm: Algorithm to use ("timestamp_clustering" or "computer_vision")
            parameters: Algorithm-specific parameters

        Returns:
            StateDiscoveryResponse with discovered states and transitions

        Raises:
            ValueError: If session not found
            NotImplementedError: If algorithm not supported
        """
        start_time = time.time()

        # Verify session exists
        result = await db.execute(
            select(AutomationSession).where(AutomationSession.id == session_id)
        )
        session = result.scalar_one_or_none()

        if not session:
            raise ValueError(f"Session {session_id} not found")

        # Route to appropriate implementation
        if algorithm == "timestamp_clustering":
            # Use simple timestamp-based clustering (fast, basic)
            from app.services.timestamp_clustering_service import (
                discover_states_timestamp_clustering
            )

            result = await discover_states_timestamp_clustering(
                session_id=session_id,
                db=db,
                parameters=parameters or {},
            )

        elif algorithm == "computer_vision":
            # Use advanced computer vision analysis (slower, more accurate)
            from app.services.automated_state_discovery_service import (
                get_automated_state_discovery_service,
            )
            from app.services.computer_vision_service import get_cv_service

            cv_service = get_cv_service()
            discovery_service = get_automated_state_discovery_service(cv_service)

            result = await discovery_service.discover_states_from_session(
                session_id=session_id,
                db=db,
                config=parameters or {},
            )

        else:
            raise NotImplementedError(
                f"Algorithm '{algorithm}' is not supported. "
                f"Supported algorithms: timestamp_clustering, computer_vision"
            )

        # Add processing time
        processing_time_ms = (time.time() - start_time) * 1000
        result.processing_time_ms = processing_time_ms
        result.algorithm = algorithm
        result.parameters = parameters or {}

        logger.info(
            "state_discovery_completed",
            session_id=str(session_id),
            algorithm=algorithm,
            total_states=result.total_states,
            total_transitions=result.total_transitions,
            processing_time_ms=processing_time_ms,
        )

        return result


# Singleton instance
state_discovery_service = StateDiscoveryWrapperService()
