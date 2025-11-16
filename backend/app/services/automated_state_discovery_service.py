"""
Automated State Discovery Service

Analyzes automation sessions to discover states and transitions using visual analysis.
"""

import time
from collections import defaultdict
from datetime import datetime
from typing import Optional
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation import AutomationInputEvent
from app.models.automation_screenshot import AutomationScreenshot
from app.models.automation_session import AutomationSession
from app.models.discovered_state import DiscoveredState as DiscoveredStateModel
from app.models.state_transition import StateTransition as StateTransitionModel
from app.services.computer_vision_service import ComputerVisionService

logger = structlog.get_logger(__name__)


class AutomatedStateDiscoveryService:
    """
    Service for discovering states from automation sessions using visual analysis.

    This service implements a computer vision-based algorithm that:
    1. Clusters screenshots by visual similarity (perceptual hashing)
    2. Extracts stable UI regions (StateImages) from each cluster
    3. Builds co-occurrence matrix to find which StateImages appear together
    4. Assembles DiscoveredStates from co-occurring StateImages
    5. Infers StateTransitions from input events and state changes
    """

    def __init__(self, cv_service: ComputerVisionService):
        self.cv_service = cv_service

    async def discover_states_from_session(
        self,
        session_id: UUID,
        db: AsyncSession,
        config: Optional[dict] = None
    ) -> dict:
        """
        Main state discovery pipeline.

        Steps:
        1. Load all screenshots for session (ordered by timestamp)
        2. Generate perceptual hashes if not cached
        3. Cluster screenshots by visual similarity
        4. Extract StateImages from each cluster
        5. Build co-occurrence matrix
        6. Assemble DiscoveredStates
        7. Infer StateTransitions from input events
        8. Persist results to database

        Args:
            session_id: UUID of automation session
            db: Database session
            config: Optional configuration dict with parameters:
                - similarity_threshold: float (default 0.90)
                - min_stability: float (default 0.95)
                - min_region_size: tuple[int, int] (default (20, 20))
                - cooccurrence_threshold: float (default 0.80)

        Returns:
            {
                'states': list[DiscoveredState],
                'state_images': list[StateImage],
                'transitions': list[StateTransition],
                'statistics': {...}
            }
        """
        start_time = time.time()

        # Default configuration
        if config is None:
            config = {}
        similarity_threshold = config.get('similarity_threshold', 0.90)
        min_stability = config.get('min_stability', 0.95)
        min_region_size = config.get('min_region_size', (20, 20))
        cooccurrence_threshold = config.get('cooccurrence_threshold', 0.80)

        logger.info(
            "state_discovery_started",
            session_id=str(session_id),
            config=config
        )

        # Update session status
        session_result = await db.execute(
            select(AutomationSession).where(AutomationSession.id == session_id)
        )
        session = session_result.scalar_one_or_none()
        if not session:
            raise ValueError(f"Session {session_id} not found")

        session.state_discovery_status = "running"
        session.state_discovery_started_at = datetime.utcnow()
        await db.commit()

        try:
            # Step 1: Load all screenshots ordered by timestamp
            logger.info("loading_screenshots", session_id=str(session_id))
            screenshot_result = await db.execute(
                select(AutomationScreenshot)
                .where(AutomationScreenshot.session_id == session_id)
                .order_by(AutomationScreenshot.timestamp)
            )
            screenshots = list(screenshot_result.scalars().all())

            if len(screenshots) == 0:
                logger.warning("no_screenshots_found", session_id=str(session_id))
                return {
                    'states': [],
                    'state_images': [],
                    'transitions': [],
                    'statistics': {
                        'screenshot_count': 0,
                        'state_count': 0,
                        'transition_count': 0,
                        'processing_time_ms': (time.time() - start_time) * 1000
                    }
                }

            logger.info("screenshots_loaded", count=len(screenshots))

            # Step 2: Generate perceptual hashes for all screenshots
            logger.info("generating_perceptual_hashes")
            await self._generate_perceptual_hashes(screenshots, db)

            # Step 3: Cluster screenshots by visual similarity
            logger.info("clustering_screenshots")
            clusters = await self.cluster_screenshots_by_similarity(
                screenshots,
                similarity_threshold
            )
            logger.info("clustering_complete", cluster_count=len(clusters))

            # Step 4: Extract StateImages from each cluster
            logger.info("extracting_state_images")
            all_state_images = []
            for cluster_id, cluster_screenshots in clusters.items():
                state_images = await self.extract_state_images_from_cluster(
                    cluster_screenshots,
                    cluster_id,
                    min_stability,
                    min_region_size
                )
                all_state_images.extend(state_images)

            logger.info("state_images_extracted", count=len(all_state_images))

            # Step 5: Build co-occurrence matrix
            logger.info("building_cooccurrence_matrix")
            cooccurrence_matrix = await self.build_cooccurrence_matrix(
                all_state_images,
                screenshots
            )

            # Step 6: Assemble DiscoveredStates from StateImages
            logger.info("assembling_discovered_states")
            states = await self.assemble_discovered_states(
                all_state_images,
                cooccurrence_matrix,
                cooccurrence_threshold,
                screenshots
            )
            logger.info("states_assembled", count=len(states))

            # Step 7: Load input events and infer transitions
            logger.info("loading_input_events")
            input_event_result = await db.execute(
                select(AutomationInputEvent)
                .where(AutomationInputEvent.session_id == session_id)
                .order_by(AutomationInputEvent.timestamp)
            )
            input_events = list(input_event_result.scalars().all())

            logger.info("inferring_transitions")
            transitions = await self.infer_state_transitions(
                states,
                input_events,
                screenshots
            )
            logger.info("transitions_inferred", count=len(transitions))

            # Step 8: Persist results to database
            logger.info("saving_results")
            await self.save_analysis_results(
                session_id,
                states,
                transitions,
                db
            )

            # Update session status
            session.state_discovery_status = "completed"
            session.state_discovery_completed_at = datetime.utcnow()
            await db.commit()

            processing_time_ms = (time.time() - start_time) * 1000

            logger.info(
                "state_discovery_completed",
                session_id=str(session_id),
                states=len(states),
                transitions=len(transitions),
                processing_time_ms=processing_time_ms
            )

            return {
                'states': states,
                'state_images': all_state_images,
                'transitions': transitions,
                'statistics': {
                    'screenshot_count': len(screenshots),
                    'cluster_count': len(clusters),
                    'state_image_count': len(all_state_images),
                    'state_count': len(states),
                    'transition_count': len(transitions),
                    'processing_time_ms': processing_time_ms
                }
            }

        except Exception as e:
            logger.error(
                "state_discovery_failed",
                session_id=str(session_id),
                error=str(e),
                error_type=type(e).__name__
            )
            session.state_discovery_status = "failed"
            session.state_discovery_error = str(e)
            await db.commit()
            raise

    async def _generate_perceptual_hashes(
        self,
        screenshots: list[AutomationScreenshot],
        db: AsyncSession
    ) -> None:
        """
        Generate perceptual hashes for screenshots that don't have them cached.
        Stores hash in automation_metadata['perceptual_hash'].
        """
        for screenshot in screenshots:
            # Check if hash already exists
            if screenshot.automation_metadata.get('perceptual_hash'):
                continue

            # Download screenshot and generate hash
            try:
                image_bytes = await self.cv_service.download_screenshot_from_s3(
                    screenshot.storage_path
                )
                phash = await self.cv_service.generate_perceptual_hash(image_bytes)

                # Cache hash in metadata
                screenshot.automation_metadata['perceptual_hash'] = phash

                logger.debug(
                    "generated_hash",
                    screenshot_id=str(screenshot.id),
                    hash=phash
                )

            except Exception as e:
                logger.error(
                    "failed_to_generate_hash",
                    screenshot_id=str(screenshot.id),
                    error=str(e)
                )
                # Continue with other screenshots
                continue

        # Commit all hash updates
        await db.commit()

    async def cluster_screenshots_by_similarity(
        self,
        screenshots: list[AutomationScreenshot],
        similarity_threshold: float = 0.90
    ) -> dict[str, list[AutomationScreenshot]]:
        """
        Group visually similar screenshots using hierarchical clustering.

        Algorithm:
        1. Start with each screenshot as its own cluster
        2. For each screenshot, compare with all other clusters
        3. If similarity > threshold, merge into existing cluster
        4. Otherwise, create new cluster

        Args:
            screenshots: List of screenshots to cluster
            similarity_threshold: Minimum similarity to group together (0.0 to 1.0)

        Returns:
            {
                "cluster_0": [screenshot1, screenshot2, ...],
                "cluster_1": [screenshot5, screenshot6, ...],
            }
        """
        if not screenshots:
            return {}

        clusters: dict[str, list[AutomationScreenshot]] = {}
        cluster_representatives: dict[str, str] = {}  # cluster_id -> representative hash
        next_cluster_id = 0

        for screenshot in screenshots:
            # Get hash from metadata
            phash = screenshot.automation_metadata.get('perceptual_hash')
            if not phash:
                logger.warning(
                    "missing_hash",
                    screenshot_id=str(screenshot.id)
                )
                # Put in its own cluster
                cluster_id = f"cluster_{next_cluster_id}"
                clusters[cluster_id] = [screenshot]
                next_cluster_id += 1
                continue

            # Try to find matching cluster
            best_cluster = None
            best_similarity = 0.0

            for cluster_id, rep_hash in cluster_representatives.items():
                similarity = await self.cv_service.calculate_similarity(
                    phash,
                    rep_hash
                )

                if similarity > best_similarity:
                    best_similarity = similarity
                    best_cluster = cluster_id

            # If similarity is high enough, add to existing cluster
            if best_cluster and best_similarity >= similarity_threshold:
                clusters[best_cluster].append(screenshot)
                logger.debug(
                    "added_to_cluster",
                    screenshot_id=str(screenshot.id),
                    cluster=best_cluster,
                    similarity=best_similarity
                )
            else:
                # Create new cluster
                cluster_id = f"cluster_{next_cluster_id}"
                clusters[cluster_id] = [screenshot]
                cluster_representatives[cluster_id] = phash
                next_cluster_id += 1
                logger.debug(
                    "created_cluster",
                    screenshot_id=str(screenshot.id),
                    cluster=cluster_id
                )

        return clusters

    async def extract_state_images_from_cluster(
        self,
        cluster_screenshots: list[AutomationScreenshot],
        cluster_id: str,
        min_stability: float = 0.95,
        min_region_size: tuple[int, int] = (20, 20)
    ) -> list[dict]:
        """
        Extract StateImages from a cluster of similar screenshots.

        Args:
            cluster_screenshots: Screenshots in this cluster
            cluster_id: ID of the cluster
            min_stability: Minimum stability score for regions
            min_region_size: Minimum (width, height) for regions

        Returns:
            List of StateImage dicts with:
            {
                'cluster_id': str,
                'x': int, 'y': int,
                'width': int, 'height': int,
                'pixel_hash': str,
                'stability_score': float,
                'screenshot_ids': list[UUID]
            }
        """
        if len(cluster_screenshots) < 2:
            # Need at least 2 screenshots to find stable regions
            logger.debug(
                "cluster_too_small",
                cluster_id=cluster_id,
                size=len(cluster_screenshots)
            )
            return []

        try:
            # Download all screenshots in cluster
            screenshot_bytes = []
            screenshot_ids = []
            for screenshot in cluster_screenshots:
                try:
                    img_bytes = await self.cv_service.download_screenshot_from_s3(
                        screenshot.storage_path
                    )
                    screenshot_bytes.append(img_bytes)
                    screenshot_ids.append(screenshot.id)
                except Exception as e:
                    logger.error(
                        "failed_to_download",
                        screenshot_id=str(screenshot.id),
                        error=str(e)
                    )
                    continue

            if len(screenshot_bytes) < 2:
                return []

            # Find stable regions
            stable_regions = await self.cv_service.find_stable_regions(
                screenshot_bytes,
                min_stability,
                min_region_size
            )

            # Convert to StateImage format
            state_images = []
            for region in stable_regions:
                state_images.append({
                    'cluster_id': cluster_id,
                    'x': region['x'],
                    'y': region['y'],
                    'width': region['width'],
                    'height': region['height'],
                    'pixel_hash': region['pixel_hash'],
                    'stability_score': region['stability_score'],
                    'screenshot_ids': screenshot_ids
                })

            logger.debug(
                "extracted_state_images",
                cluster_id=cluster_id,
                count=len(state_images)
            )

            return state_images

        except Exception as e:
            logger.error(
                "failed_to_extract_state_images",
                cluster_id=cluster_id,
                error=str(e)
            )
            return []

    async def build_cooccurrence_matrix(
        self,
        state_images: list[dict],
        screenshots: list[AutomationScreenshot]
    ) -> list[list[float]]:
        """
        Build matrix showing which StateImages appear together.

        For each screenshot, we track which StateImages are present
        (by matching screenshot_ids), then count how often each pair appears together.

        Args:
            state_images: List of StateImage dicts
            screenshots: All screenshots

        Returns:
            NxN matrix where matrix[i][j] = co-occurrence frequency of
            state_images[i] and state_images[j] (normalized by screenshot count)
        """
        n = len(state_images)
        if n == 0:
            return []

        # Initialize matrix
        matrix = [[0.0 for _ in range(n)] for _ in range(n)]

        # Build screenshot_id -> state_image indices mapping
        screenshot_to_images = defaultdict(list)
        for idx, state_image in enumerate(state_images):
            for screenshot_id in state_image['screenshot_ids']:
                screenshot_to_images[screenshot_id].append(idx)

        # Count co-occurrences
        screenshot_count = len(screenshots)
        for screenshot in screenshots:
            # Get indices of state images in this screenshot
            image_indices = screenshot_to_images.get(screenshot.id, [])

            # Increment co-occurrence for all pairs
            for i in image_indices:
                for j in image_indices:
                    matrix[i][j] += 1.0

        # Normalize by screenshot count
        if screenshot_count > 0:
            for i in range(n):
                for j in range(n):
                    matrix[i][j] /= screenshot_count

        logger.debug(
            "cooccurrence_matrix_built",
            size=n,
            screenshot_count=screenshot_count
        )

        return matrix

    async def assemble_discovered_states(
        self,
        state_images: list[dict],
        cooccurrence_matrix: list[list[float]],
        threshold: float = 0.80,
        screenshots: list[AutomationScreenshot] = None
    ) -> list[dict]:
        """
        Group StateImages into DiscoveredStates using graph clustering.

        Algorithm:
        1. Build graph where nodes are StateImages
        2. Add edge if co-occurrence > threshold
        3. Find connected components (groups of highly co-occurring images)
        4. Filter out universal elements (appear in >80% of screenshots)
        5. Each component becomes a DiscoveredState

        Args:
            state_images: List of StateImage dicts
            cooccurrence_matrix: Co-occurrence frequencies
            threshold: Minimum co-occurrence to group together
            screenshots: All screenshots (for filtering universal elements)

        Returns:
            List of DiscoveredState dicts
        """
        if not state_images:
            return []

        n = len(state_images)

        # Filter out universal elements (appear in >80% of screenshots)
        if screenshots:
            filtered_indices = []
            screenshot_count = len(screenshots)
            for idx, state_image in enumerate(state_images):
                appearance_rate = len(state_image['screenshot_ids']) / screenshot_count
                if appearance_rate <= 0.80:  # Not universal
                    filtered_indices.append(idx)
                else:
                    logger.debug(
                        "filtered_universal_element",
                        index=idx,
                        appearance_rate=appearance_rate
                    )
        else:
            filtered_indices = list(range(n))

        # Build adjacency graph using union-find
        parent = {i: i for i in filtered_indices}

        def find(x):
            if parent[x] != x:
                parent[x] = find(parent[x])
            return parent[x]

        def union(x, y):
            px, py = find(x), find(y)
            if px != py:
                parent[px] = py

        # Add edges for high co-occurrence
        for i in filtered_indices:
            for j in filtered_indices:
                if i < j and cooccurrence_matrix[i][j] >= threshold:
                    union(i, j)

        # Group by connected components
        components = defaultdict(list)
        for i in filtered_indices:
            root = find(i)
            components[root].append(i)

        # Build DiscoveredStates from components
        states = []
        for state_idx, component_indices in enumerate(components.values()):
            # Get all state images in this component
            component_images = [state_images[i] for i in component_indices]

            # Collect all screenshot IDs
            all_screenshot_ids = set()
            for img in component_images:
                all_screenshot_ids.update(img['screenshot_ids'])

            # Find representative screenshot (first one chronologically)
            representative_screenshot_id = None
            if screenshots:
                for screenshot in screenshots:
                    if screenshot.id in all_screenshot_ids:
                        representative_screenshot_id = screenshot.id
                        break

            # Calculate timestamps
            screenshot_map = {s.id: s for s in screenshots} if screenshots else {}
            component_screenshots = [
                screenshot_map[sid]
                for sid in all_screenshot_ids
                if sid in screenshot_map
            ]

            if component_screenshots:
                timestamp_first_seen = min(s.timestamp for s in component_screenshots)
                timestamp_last_seen = max(s.timestamp for s in component_screenshots)
            else:
                timestamp_first_seen = datetime.utcnow()
                timestamp_last_seen = datetime.utcnow()

            states.append({
                'state_id': f"state_{state_idx}",
                'name': None,
                'confidence': 1.0,
                'metadata': {
                    'state_image_count': len(component_images),
                    'screenshot_count': len(all_screenshot_ids),
                    'component_size': len(component_indices)
                },
                'screenshot_ids': list(all_screenshot_ids),
                'state_images': component_images,
                'representative_screenshot_id': representative_screenshot_id,
                'timestamp_first_seen': timestamp_first_seen,
                'timestamp_last_seen': timestamp_last_seen
            })

        logger.info(
            "states_assembled",
            state_count=len(states),
            components=len(components)
        )

        return states

    async def infer_state_transitions(
        self,
        states: list[dict],
        input_events: list[AutomationInputEvent],
        screenshots: list[AutomationScreenshot]
    ) -> list[dict]:
        """
        Infer state transitions from input events and state changes.

        Algorithm:
        1. Build timeline of (timestamp, state_id, screenshot_id)
        2. For each input event:
           - Find state before event (last screenshot before event)
           - Find state after event (first screenshot after event)
           - If states differ, record transition

        Args:
            states: List of DiscoveredState dicts
            input_events: List of input events
            screenshots: All screenshots

        Returns:
            List of StateTransition dicts
        """
        if not states or not screenshots:
            return []

        # Build screenshot_id -> state_id mapping
        screenshot_to_state = {}
        for state in states:
            for screenshot_id in state['screenshot_ids']:
                screenshot_to_state[screenshot_id] = state['state_id']

        # Sort screenshots by timestamp
        sorted_screenshots = sorted(screenshots, key=lambda s: s.timestamp)

        # Infer transitions from input events
        transitions = []
        transition_set = set()  # To avoid duplicates: (from_state, to_state, event_type)

        for event in input_events:
            # Find screenshot before event
            before_screenshot = None
            for screenshot in reversed(sorted_screenshots):
                if screenshot.timestamp <= event.timestamp:
                    before_screenshot = screenshot
                    break

            # Find screenshot after event
            after_screenshot = None
            for screenshot in sorted_screenshots:
                if screenshot.timestamp > event.timestamp:
                    after_screenshot = screenshot
                    break

            if not before_screenshot or not after_screenshot:
                continue

            # Get states
            from_state_id = screenshot_to_state.get(before_screenshot.id)
            to_state_id = screenshot_to_state.get(after_screenshot.id)

            if not from_state_id or not to_state_id:
                continue

            # If states differ, record transition
            if from_state_id != to_state_id:
                transition_key = (from_state_id, to_state_id, event.event_type)
                if transition_key not in transition_set:
                    transition_set.add(transition_key)
                    transitions.append({
                        'from_state_id': from_state_id,
                        'to_state_id': to_state_id,
                        'trigger_event_id': event.id,
                        'event_type': event.event_type,
                        'timestamp': event.timestamp,
                        'confidence': 1.0,
                        'metadata': {}
                    })

        logger.info(
            "transitions_inferred",
            transition_count=len(transitions),
            unique_transitions=len(transition_set)
        )

        return transitions

    async def save_analysis_results(
        self,
        session_id: UUID,
        states: list[dict],
        transitions: list[dict],
        db: AsyncSession
    ) -> None:
        """
        Persist analysis results to database.

        Args:
            session_id: Session ID
            states: List of DiscoveredState dicts
            transitions: List of StateTransition dicts
            db: Database session
        """
        # Delete existing results for this session
        await db.execute(
            select(DiscoveredStateModel)
            .where(DiscoveredStateModel.session_id == session_id)
        )
        existing_states = (await db.execute(
            select(DiscoveredStateModel)
            .where(DiscoveredStateModel.session_id == session_id)
        )).scalars().all()

        for state in existing_states:
            await db.delete(state)

        # Create state_id -> database ID mapping
        state_id_to_db_id = {}

        # Save DiscoveredStates
        for state_dict in states:
            state_model = DiscoveredStateModel(
                session_id=session_id,
                state_id=state_dict['state_id'],
                name=state_dict.get('name'),
                confidence=state_dict['confidence'],
                state_metadata=state_dict['metadata'],
                screenshot_ids=state_dict['screenshot_ids'],
                state_images=state_dict['state_images']
            )
            db.add(state_model)
            await db.flush()  # Get the ID
            state_id_to_db_id[state_dict['state_id']] = state_model.id

        # Save StateTransitions
        for transition_dict in transitions:
            from_state_db_id = state_id_to_db_id.get(transition_dict['from_state_id'])
            to_state_db_id = state_id_to_db_id.get(transition_dict['to_state_id'])

            if not from_state_db_id or not to_state_db_id:
                logger.warning(
                    "missing_state_for_transition",
                    from_state=transition_dict['from_state_id'],
                    to_state=transition_dict['to_state_id']
                )
                continue

            transition_model = StateTransitionModel(
                session_id=session_id,
                from_state_id=from_state_db_id,
                to_state_id=to_state_db_id,
                trigger_event_id=transition_dict.get('trigger_event_id'),
                event_type=transition_dict.get('event_type'),
                confidence=transition_dict['confidence'],
                timestamp=transition_dict['timestamp'],
                transition_metadata=transition_dict.get('metadata', {})
            )
            db.add(transition_model)

        await db.commit()

        logger.info(
            "results_saved",
            session_id=str(session_id),
            state_count=len(states),
            transition_count=len(transitions)
        )


# Singleton instance factory
_service_instance: AutomatedStateDiscoveryService | None = None


def get_automated_state_discovery_service(
    cv_service: ComputerVisionService = None
) -> AutomatedStateDiscoveryService:
    """Get or create singleton service instance."""
    global _service_instance
    if _service_instance is None:
        from app.services.computer_vision_service import get_cv_service
        cv = cv_service or get_cv_service()
        _service_instance = AutomatedStateDiscoveryService(cv)
    return _service_instance
