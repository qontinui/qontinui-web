"""
Unified State Discovery Facade

Provides both simple and advanced state discovery algorithms through a unified interface.

- SIMPLE algorithm: Fast, uses basic clustering with perceptual hashing
- ADVANCED algorithm: Slower, uses OCR + DBSCAN + SSIM for more accurate state identification

ARCHITECTURE OVERVIEW
=====================
This web service facade is designed to coordinate state discovery workflows, but NOT to
perform heavy computer vision analysis directly. The intended architecture follows this
separation of concerns:

WEB SERVICE RESPONSIBILITIES (this module):
- Store raw automation data (screenshots, recordings, metadata)
- Coordinate workflow and orchestration
- Perform lightweight operations (data retrieval, result formatting)
- Display and serve discovery results to frontend
- Manage database persistence

QONTINUI LIBRARY RESPONSIBILITIES (delegated via runner):
- Heavy CV analysis: pixel stability, perceptual hashing, SSIM comparisons
- State region detection (DifferentialConsistencyDetector)
- Pixel stability analysis (PixelStabilityAnalyzer)
- State object construction with OCR (StateBuilder)
- All computationally intensive image processing

FUTURE MIGRATION PATH
======================
Currently, this service performs CV operations directly for prototyping/development.
In production, heavy CV operations should be:
1. Packaged as jobs/tasks submitted to the qontinui library
2. Run locally via the qontinui runner (not in web service process)
3. Results stored back to database for web service to display

This separation ensures:
- Web service remains responsive and lightweight
- CV operations leverage optimized library code
- No duplication of complex CV logic between web and library
- Easier testing and maintenance of CV algorithms
"""

from enum import Enum
from typing import Optional, Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
import structlog

logger = structlog.get_logger(__name__)


class DiscoveryAlgorithm(str, Enum):
    """Available state discovery algorithms"""
    SIMPLE = "simple"  # Fast, uses basic perceptual hashing clustering
    ADVANCED = "advanced"  # Slower, uses OCR + DBSCAN + SSIM


class StateDiscoveryFacade:
    """
    Facade for unified access to state discovery algorithms.

    Provides a consistent interface to both simple (perceptual hashing-based)
    and advanced (OCR/DBSCAN/SSIM-based) state discovery implementations.
    """

    def __init__(self, algorithm: DiscoveryAlgorithm = DiscoveryAlgorithm.SIMPLE):
        """
        Initialize the facade with the specified algorithm.

        Args:
            algorithm: Which discovery algorithm to use
        """
        self.algorithm = algorithm
        self._service = None

        # Lazy load the appropriate service
        if algorithm == DiscoveryAlgorithm.SIMPLE:
            logger.info("state_discovery_facade_initialized", algorithm="simple")
        else:
            logger.info("state_discovery_facade_initialized", algorithm="advanced")

    def _get_simple_service(self):
        """Lazy load simple algorithm service"""
        if self._service is None:
            from app.services.automated_state_discovery_service import get_automated_state_discovery_service
            from app.services.computer_vision_service import get_cv_service
            cv = get_cv_service()
            self._service = get_automated_state_discovery_service(cv)
        return self._service

    def _get_advanced_service(self):
        """Lazy load advanced algorithm service"""
        if self._service is None:
            from app.services.state_discovery_service import StateDiscoveryService
            self._service = StateDiscoveryService()
        return self._service

    async def discover_from_automation_session(
        self,
        session_id: UUID,
        db: AsyncSession,
        config: Optional[dict] = None
    ) -> dict:
        """
        Discover states from an automation session.

        Args:
            session_id: UUID of the automation session
            db: Database session
            config: Optional algorithm-specific configuration:
                Simple algorithm:
                    - similarity_threshold: float (default 0.90)
                    - min_stability: float (default 0.95)
                    - min_region_size: tuple[int, int] (default (20, 20))
                    - cooccurrence_threshold: float (default 0.80)
                Advanced algorithm:
                    - clustering_eps: float (default 0.3)
                    - min_samples: int (default 2)
                    - similarity_threshold: float (default 0.85)

        Returns:
            Dict with discovered states, transitions, and statistics:
            {
                'states': list[DiscoveredState],
                'state_images': list[StateImage],  # Simple algorithm only
                'transitions': list[StateTransition],
                'statistics': {
                    'screenshot_count': int,
                    'state_count': int,
                    'transition_count': int,
                    'processing_time_ms': float
                }
            }
        """
        if config is None:
            config = {}

        logger.info(
            "discover_from_automation_session_started",
            session_id=str(session_id),
            algorithm=self.algorithm.value
        )

        if self.algorithm == DiscoveryAlgorithm.SIMPLE:
            service = self._get_simple_service()
            return await service.discover_states_from_session(session_id, db, config)
        else:
            # Advanced algorithm - convert session to recording-like format
            service = self._get_advanced_service()
            return await self._discover_advanced_from_session(service, session_id, db, config)

    async def discover_from_recording(
        self,
        recording_id: UUID,
        db: AsyncSession,
        config: Optional[dict] = None
    ) -> dict:
        """
        Discover states from an uploaded recording.

        Args:
            recording_id: UUID of the recording
            db: Database session
            config: Optional algorithm-specific configuration

        Returns:
            Dict with discovered states and transitions
        """
        if config is None:
            config = {}

        logger.info(
            "discover_from_recording_started",
            recording_id=str(recording_id),
            algorithm=self.algorithm.value
        )

        if self.algorithm == DiscoveryAlgorithm.ADVANCED:
            service = self._get_advanced_service()
            return await service.discover_states_from_recording(recording_id, db, config)
        else:
            # Simple algorithm - convert recording to session-like format
            service = self._get_simple_service()
            return await self._discover_simple_from_recording(service, recording_id, db, config)

    async def _discover_advanced_from_session(
        self,
        service,
        session_id: UUID,
        db: AsyncSession,
        config: dict
    ) -> dict:
        """
        Adapter to use advanced algorithm on automation session.

        Note: The advanced algorithm expects frames from a recording/clustering system.
        This adapter loads screenshots from the session and converts them to the
        expected format for the advanced algorithm.
        """
        from app.models.automation_screenshot import AutomationScreenshot
        from sqlalchemy import select

        # Load all screenshots for the session
        screenshot_result = await db.execute(
            select(AutomationScreenshot)
            .where(AutomationScreenshot.session_id == session_id)
            .order_by(AutomationScreenshot.timestamp)
        )
        screenshots = list(screenshot_result.scalars().all())

        if not screenshots:
            logger.warning("no_screenshots_for_advanced_algorithm", session_id=str(session_id))
            return {
                'states': [],
                'transitions': [],
                'statistics': {
                    'screenshot_count': 0,
                    'state_count': 0,
                    'transition_count': 0,
                    'processing_time_ms': 0
                }
            }

        # Convert screenshots to frames format expected by advanced algorithm
        frames_data = []
        for idx, screenshot in enumerate(screenshots):
            frame_data = {
                'id': str(screenshot.id),
                's3_key': screenshot.storage_path,
                'relative_time_ms': int((screenshot.timestamp - screenshots[0].timestamp).total_seconds() * 1000),
                'window_title': screenshot.automation_metadata.get('window_title'),
                'window_bounds': screenshot.automation_metadata.get('window_bounds'),
                'url': screenshot.automation_metadata.get('url'),
            }
            frames_data.append(frame_data)

        # TODO [ARCHITECTURE]: This clustering logic should be delegated to qontinui library
        # - Instead of performing perceptual hashing here, submit frames to library
        # - Library's DifferentialConsistencyDetector should handle clustering
        # - Web service should just coordinate and store results

        # Cluster frames using simple perceptual hashing (reuse from simple algorithm)
        from app.services.computer_vision_service import get_cv_service
        cv_service = get_cv_service()

        # Generate hashes and cluster
        clusters = {}
        cluster_id = 0
        threshold = config.get('similarity_threshold', 0.85)

        for frame in frames_data:
            # Simple clustering: each significant visual change is a new cluster
            # For now, just put all frames in one cluster - the advanced algorithm
            # will do its own clustering using DBSCAN
            if cluster_id not in clusters:
                clusters[cluster_id] = []
            clusters[cluster_id].append(frame)

        # TODO [ARCHITECTURE]: State identification should be delegated to qontinui library
        # - Pass cluster data to library's StateBuilder
        # - Library performs OCR, region detection, state construction
        # - Web service receives and stores the resulting state objects

        # Run advanced algorithm
        states = await service.identify_states_from_clusters(clusters, frames_data)

        # Convert to standard format
        return {
            'states': states,
            'transitions': [],  # Advanced algorithm doesn't compute transitions from sessions
            'statistics': {
                'screenshot_count': len(screenshots),
                'state_count': len(states),
                'transition_count': 0,
                'processing_time_ms': 0
            }
        }

    async def _discover_simple_from_recording(
        self,
        service,
        recording_id: UUID,
        db: AsyncSession,
        config: dict
    ) -> dict:
        """
        Adapter to use simple algorithm on uploaded recording.

        Note: This would require converting recording frames to AutomationScreenshot format.
        For now, this is not implemented as recordings typically use the advanced algorithm.
        """
        logger.warning(
            "simple_algorithm_not_supported_for_recordings",
            recording_id=str(recording_id)
        )
        raise NotImplementedError(
            "Simple algorithm is designed for automation sessions. "
            "Use ADVANCED algorithm for uploaded recordings."
        )


# Factory functions for easy instantiation
def get_state_discovery_facade(
    algorithm: DiscoveryAlgorithm = DiscoveryAlgorithm.SIMPLE
) -> StateDiscoveryFacade:
    """
    Get a state discovery facade instance.

    Args:
        algorithm: Which algorithm to use (SIMPLE or ADVANCED)

    Returns:
        Configured StateDiscoveryFacade instance
    """
    return StateDiscoveryFacade(algorithm)


def get_simple_discovery_facade() -> StateDiscoveryFacade:
    """Get facade configured for simple algorithm"""
    return StateDiscoveryFacade(DiscoveryAlgorithm.SIMPLE)


def get_advanced_discovery_facade() -> StateDiscoveryFacade:
    """Get facade configured for advanced algorithm"""
    return StateDiscoveryFacade(DiscoveryAlgorithm.ADVANCED)
