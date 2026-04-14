"""
State Discovery Service for automation session analysis.

Orchestrates state discovery by delegating to specialized services for clustering,
detection, and transition analysis.
"""

import time
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.schemas.state_discovery import StateDiscoveryResponse
from app.services.state_clusterer import StateClusterer
from app.services.state_detector import StateDetector
from app.services.transition_analyzer import TransitionAnalyzer

logger = structlog.get_logger(__name__)


class StateDiscoveryService:
    """
    Facade service for discovering states from automation sessions.

    This service orchestrates the state discovery process by delegating to:
    - StateClusterer: Groups screenshots into states
    - StateDetector: Associates input events with states
    - TransitionAnalyzer: Creates state transitions
    """

    def __init__(
        self,
        clusterer: StateClusterer | None = None,
        detector: StateDetector | None = None,
        analyzer: TransitionAnalyzer | None = None,
    ) -> None:
        """
        Initialize the state discovery service.

        Args:
            clusterer: Service for clustering screenshots (defaults to StateClusterer)
            detector: Service for detecting input-state associations (defaults to StateDetector)
            analyzer: Service for analyzing transitions (defaults to TransitionAnalyzer)
        """
        self.clusterer = clusterer or StateClusterer()
        self.detector = detector or StateDetector()
        self.analyzer = analyzer or TransitionAnalyzer()

    async def discover_states_from_session(
        self,
        session_id: UUID,
        db: AsyncSession,
        algorithm: str = "timestamp_clustering",
        parameters: dict[str, Any] | None = None,
    ) -> StateDiscoveryResponse:
        """
        Discover states from an automation session.

        Args:
            session_id: Automation session ID
            db: Database session
            algorithm: Algorithm to use for state discovery
            parameters: Algorithm-specific parameters

        Returns:
            StateDiscoveryResponse with discovered states and transitions

        Raises:
            ValueError: If session not found or algorithm unknown
        """
        start_time = time.time()
        logger.info(
            "state_discovery_started",
            session_id=str(session_id),
            algorithm=algorithm,
        )

        # Verify session exists
        session_result = await db.execute(
            select(AutomationSession).where(AutomationSession.id == session_id)
        )
        session = session_result.scalar_one_or_none()
        if not session:
            raise ValueError(f"Session {session_id} not found")

        # Default parameters
        if parameters is None:
            parameters = {}

        # Route to appropriate algorithm
        if algorithm == "timestamp_clustering":
            result = await self._timestamp_clustering_algorithm(
                session_id, db, parameters
            )
        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")

        # Calculate processing time
        processing_time_ms = (time.time() - start_time) * 1000
        result.processing_time_ms = processing_time_ms

        logger.info(
            "state_discovery_completed",
            session_id=str(session_id),
            total_states=result.total_states,
            total_transitions=result.total_transitions,
            processing_time_ms=processing_time_ms,
        )

        return result

    async def _timestamp_clustering_algorithm(
        self,
        session_id: UUID,
        db: AsyncSession,
        parameters: dict[str, Any],
    ) -> StateDiscoveryResponse:
        """
        Timestamp-based clustering algorithm implementation.

        Groups screenshots by temporal proximity and associates input events
        with their surrounding screenshots to create a state graph.

        Parameters:
            - state_threshold_seconds: Minimum time gap to consider new state (default: 2.0)
            - max_input_distance_seconds: Max time between input and screenshot (default: 5.0)

        Args:
            session_id: Automation session ID
            db: Database session
            parameters: Algorithm parameters

        Returns:
            StateDiscoveryResponse with discovered states
        """
        state_threshold = parameters.get("state_threshold_seconds", 2.0)
        max_input_distance = parameters.get("max_input_distance_seconds", 5.0)

        # Step 1: Cluster screenshots into states
        states = await self.clusterer.cluster_by_timestamp(
            session_id=session_id,
            db=db,
            state_threshold_seconds=state_threshold,
        )

        # If no states, return empty result
        if not states:
            return StateDiscoveryResponse(
                session_id=session_id,
                total_states=0,
                total_transitions=0,
                states=[],
                algorithm="timestamp_clustering",
                parameters=parameters,
                processing_time_ms=0.0,
            )

        # Step 2: Load input events
        input_events = await self.detector.load_input_events(session_id, db)

        # Load screenshots for reference (needed for both detection and transition analysis)
        screenshot_result = await db.execute(
            select(AutomationScreenshot)
            .where(AutomationScreenshot.session_id == session_id)
            .order_by(AutomationScreenshot.timestamp)
        )
        screenshots = list(screenshot_result.scalars().all())

        # Step 3: Associate input events with states
        self.detector.associate_inputs_with_states(
            states=states,
            input_events=input_events,
            screenshots=screenshots,
            max_distance_seconds=max_input_distance,
        )

        # Step 4: Create transitions based on input events
        total_transitions = self.analyzer.create_transitions(
            states=states,
            input_events=input_events,
            screenshots=screenshots,
        )

        return StateDiscoveryResponse(
            session_id=session_id,
            total_states=len(states),
            total_transitions=total_transitions,
            states=states,
            algorithm="timestamp_clustering",
            parameters=parameters,
            processing_time_ms=0.0,
        )


# Singleton instance
state_discovery_service = StateDiscoveryService()
