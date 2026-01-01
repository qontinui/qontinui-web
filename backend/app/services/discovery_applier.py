"""
Discovery Applier Service

Applies accepted discoveries to project configurations.

When a user accepts a discovery, this service updates the project configuration
based on the discovery type, creates an edit command for audit trail, and
optionally creates a version snapshot.
"""

from copy import deepcopy
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.project import get_project, update_project
from app.crud.version import create_command
from app.models.discovery import Discovery
from app.models.project import Project
from app.schemas.project import ProjectUpdate
from app.schemas.version import EditCommandCreate
from app.services.version_history_service import VersionHistoryService

logger = structlog.get_logger(__name__)


class DiscoveryApplier:
    """
    Applies accepted discoveries to project configurations.

    Discovery Types:
    - new_element: Add a new expected element to a state
    - timing_update: Update expected duration for a transition
    - flaky_detection: Mark an item as flaky in config metadata
    - unexpected_element: Add an unexpected element to a state
    - new_transition: Add a new transition to the config
    """

    @staticmethod
    async def apply_discovery(
        db: AsyncSession,
        discovery: Discovery,
        user_id: UUID,
        create_version_snapshot: bool = True,
    ) -> bool:
        """
        Apply a discovery to its related project configuration.

        Args:
            db: Database session
            discovery: The discovery to apply
            user_id: ID of the user applying the discovery
            create_version_snapshot: Whether to create a version snapshot after applying

        Returns:
            True if successfully applied, False otherwise
        """
        discovery_type = discovery.discovery_type
        discovery_data = discovery.discovery_data

        logger.info(
            "applying_discovery",
            discovery_id=str(discovery.id),
            discovery_type=discovery_type,
            project_id=str(discovery.project_id),
        )

        # Get the project
        project = await get_project(db, discovery.project_id)
        if not project:
            logger.error(
                "project_not_found",
                discovery_id=str(discovery.id),
                project_id=str(discovery.project_id),
            )
            return False

        # Make a deep copy of configuration to modify
        # The configuration is stored as JSON in the database
        raw_config = project.configuration
        if raw_config and isinstance(raw_config, dict):
            config: dict[str, Any] = deepcopy(raw_config)
        else:
            config = {}

        # Apply based on discovery type
        try:
            if discovery_type == "new_element":
                success = DiscoveryApplier._apply_new_element(
                    config, discovery_data, discovery
                )
            elif discovery_type == "timing_update":
                success = DiscoveryApplier._apply_timing_update(
                    config, discovery_data, discovery
                )
            elif discovery_type == "flaky_detection":
                success = DiscoveryApplier._apply_flaky_detection(
                    config, discovery_data, discovery
                )
            elif discovery_type == "unexpected_element":
                success = DiscoveryApplier._apply_unexpected_element(
                    config, discovery_data, discovery
                )
            elif discovery_type == "new_transition":
                success = DiscoveryApplier._apply_new_transition(
                    config, discovery_data, discovery
                )
            else:
                logger.warning(
                    "unknown_discovery_type",
                    discovery_id=str(discovery.id),
                    discovery_type=discovery_type,
                )
                return False

            if not success:
                return False

            # Update the project configuration
            project_update = ProjectUpdate(configuration=config)
            await update_project(db, project, project_update)

            # Create edit command for audit trail
            await DiscoveryApplier._create_edit_command(db, discovery, project, user_id)

            # Create version snapshot if requested
            if create_version_snapshot:
                comment = f"Applied discovery: {discovery.title}"
                await VersionHistoryService.create_version_snapshot(
                    db, discovery.project_id, user_id, comment
                )

            logger.info(
                "discovery_applied",
                discovery_id=str(discovery.id),
                discovery_type=discovery_type,
                project_id=str(discovery.project_id),
            )
            return True

        except Exception as e:
            logger.exception(
                "discovery_apply_failed",
                discovery_id=str(discovery.id),
                discovery_type=discovery_type,
                error=str(e),
            )
            return False

    @staticmethod
    def _apply_new_element(
        config: dict[str, Any],
        data: dict[str, Any],
        discovery: Discovery,
    ) -> bool:
        """
        Add a new expected element to a state.

        Expected discovery_data:
        - state_id: ID of the state to add the element to
        - element_description: Description of the element
        - element_data: Optional additional element data (bounding_box, template, etc.)
        """
        state_id = data.get("state_id")
        element_description = data.get("element_description")
        element_data = data.get("element_data", {})

        if not state_id or not element_description:
            logger.warning(
                "missing_required_fields_for_new_element",
                discovery_id=str(discovery.id),
                state_id=state_id,
                element_description=element_description,
            )
            return False

        # Initialize states dict if needed
        if "states" not in config:
            config["states"] = {}

        # Initialize state if needed
        if state_id not in config["states"]:
            config["states"][state_id] = {"expected_elements": []}

        state = config["states"][state_id]

        # Initialize expected_elements list if needed
        if "expected_elements" not in state:
            state["expected_elements"] = []

        # Check if element already exists (by description)
        existing = [
            e
            for e in state["expected_elements"]
            if e.get("description") == element_description
        ]
        if existing:
            logger.info(
                "element_already_exists",
                discovery_id=str(discovery.id),
                state_id=state_id,
                element_description=element_description,
            )
            return True  # Already exists, consider it a success

        # Add the new element
        new_element = {
            "description": element_description,
            "added_from_discovery": str(discovery.id),
            **element_data,
        }
        state["expected_elements"].append(new_element)

        logger.info(
            "applied_new_element",
            discovery_id=str(discovery.id),
            state_id=state_id,
            element=element_description,
        )
        return True

    @staticmethod
    def _apply_timing_update(
        config: dict[str, Any],
        data: dict[str, Any],
        discovery: Discovery,
    ) -> bool:
        """
        Update expected duration for a transition.

        Expected discovery_data:
        - transition_id: ID of the transition to update
        - observed_duration_ms: New expected duration in milliseconds
        - from_state_id: Optional source state ID (for finding transition)
        - to_state_id: Optional target state ID (for finding transition)
        """
        transition_id = data.get("transition_id")
        new_duration_ms = data.get("observed_duration_ms")
        from_state_id = data.get("from_state_id")
        to_state_id = data.get("to_state_id")

        if not new_duration_ms:
            logger.warning(
                "missing_duration_for_timing_update",
                discovery_id=str(discovery.id),
            )
            return False

        # Initialize transitions list if needed
        if "transitions" not in config:
            config["transitions"] = []

        # Find the transition by ID or by from/to states
        transition_found = False
        for transition in config["transitions"]:
            if transition_id and transition.get("id") == transition_id:
                transition["expected_duration_ms"] = new_duration_ms
                transition["timing_updated_from_discovery"] = str(discovery.id)
                transition_found = True
                break
            elif (
                from_state_id
                and to_state_id
                and transition.get("from_state") == from_state_id
                and transition.get("to_state") == to_state_id
            ):
                transition["expected_duration_ms"] = new_duration_ms
                transition["timing_updated_from_discovery"] = str(discovery.id)
                transition_found = True
                break

        if not transition_found:
            logger.warning(
                "transition_not_found_for_timing_update",
                discovery_id=str(discovery.id),
                transition_id=transition_id,
                from_state_id=from_state_id,
                to_state_id=to_state_id,
            )
            # Still return True - we'll add metadata about the expected timing
            # even if the transition doesn't exist yet
            if "timing_metadata" not in config:
                config["timing_metadata"] = {}
            key = transition_id or f"{from_state_id}->{to_state_id}"
            config["timing_metadata"][key] = {
                "expected_duration_ms": new_duration_ms,
                "added_from_discovery": str(discovery.id),
            }

        logger.info(
            "applied_timing_update",
            discovery_id=str(discovery.id),
            transition_id=transition_id,
            duration_ms=new_duration_ms,
        )
        return True

    @staticmethod
    def _apply_flaky_detection(
        config: dict[str, Any],
        data: dict[str, Any],
        discovery: Discovery,
    ) -> bool:
        """
        Mark an item as flaky in config metadata.

        Expected discovery_data:
        - item_type: "transition" or "template" or "element"
        - item_id: ID of the item
        - success_rate: Observed success rate (0.0 to 1.0)
        - failure_count: Optional number of failures observed
        - total_runs: Optional total number of runs observed
        """
        item_type = data.get("item_type")
        item_id = data.get("item_id")
        success_rate = data.get("success_rate")

        if not item_type or not item_id:
            logger.warning(
                "missing_fields_for_flaky_detection",
                discovery_id=str(discovery.id),
            )
            return False

        # Initialize flaky_items metadata
        if "flaky_items" not in config:
            config["flaky_items"] = {}

        if item_type not in config["flaky_items"]:
            config["flaky_items"][item_type] = {}

        # Add or update flaky marker
        config["flaky_items"][item_type][item_id] = {
            "success_rate": success_rate,
            "failure_count": data.get("failure_count"),
            "total_runs": data.get("total_runs"),
            "marked_from_discovery": str(discovery.id),
            "confidence": discovery.confidence,
        }

        logger.info(
            "applied_flaky_detection",
            discovery_id=str(discovery.id),
            item_type=item_type,
            item_id=item_id,
            success_rate=success_rate,
        )
        return True

    @staticmethod
    def _apply_unexpected_element(
        config: dict[str, Any],
        data: dict[str, Any],
        discovery: Discovery,
    ) -> bool:
        """
        Add an unexpected element to a state.

        Unexpected elements are elements that consistently appear in a state
        but were not originally expected. Tracking them helps with debugging
        and can indicate UI changes.

        Expected discovery_data:
        - state_id: ID of the state
        - element_description: Description of the unexpected element
        - element_data: Optional additional element data
        """
        state_id = data.get("state_id")
        element_description = data.get("element_description")
        element_data = data.get("element_data", {})

        if not state_id or not element_description:
            logger.warning(
                "missing_required_fields_for_unexpected_element",
                discovery_id=str(discovery.id),
            )
            return False

        # Initialize states dict if needed
        if "states" not in config:
            config["states"] = {}

        # Initialize state if needed
        if state_id not in config["states"]:
            config["states"][state_id] = {}

        state = config["states"][state_id]

        # Initialize unexpected_elements list if needed
        if "unexpected_elements" not in state:
            state["unexpected_elements"] = []

        # Check if element already exists
        existing = [
            e
            for e in state["unexpected_elements"]
            if e.get("description") == element_description
        ]
        if existing:
            logger.info(
                "unexpected_element_already_tracked",
                discovery_id=str(discovery.id),
                state_id=state_id,
                element_description=element_description,
            )
            return True

        # Add the unexpected element
        new_element = {
            "description": element_description,
            "added_from_discovery": str(discovery.id),
            "runs_observed": discovery.runs_observed,
            **element_data,
        }
        state["unexpected_elements"].append(new_element)

        logger.info(
            "applied_unexpected_element",
            discovery_id=str(discovery.id),
            state_id=state_id,
            element=element_description,
        )
        return True

    @staticmethod
    def _apply_new_transition(
        config: dict[str, Any],
        data: dict[str, Any],
        discovery: Discovery,
    ) -> bool:
        """
        Add a new transition to the config.

        Expected discovery_data:
        - from_state_id: Source state ID
        - to_state_id: Target state ID
        - action_sequence: Optional list of actions for the transition
        - transition_name: Optional name for the transition
        - expected_duration_ms: Optional expected duration
        """
        from_state_id = data.get("from_state_id")
        to_state_id = data.get("to_state_id")

        if not from_state_id or not to_state_id:
            logger.warning(
                "missing_state_ids_for_new_transition",
                discovery_id=str(discovery.id),
            )
            return False

        # Initialize transitions list if needed
        if "transitions" not in config:
            config["transitions"] = []

        # Check if transition already exists
        existing = [
            t
            for t in config["transitions"]
            if t.get("from_state") == from_state_id and t.get("to_state") == to_state_id
        ]
        if existing:
            logger.info(
                "transition_already_exists",
                discovery_id=str(discovery.id),
                from_state=from_state_id,
                to_state=to_state_id,
            )
            return True

        # Create new transition
        new_transition: dict[str, Any] = {
            "from_state": from_state_id,
            "to_state": to_state_id,
            "added_from_discovery": str(discovery.id),
        }

        # Add optional fields
        if data.get("transition_name"):
            new_transition["name"] = data["transition_name"]
        if data.get("action_sequence"):
            new_transition["actions"] = data["action_sequence"]
        if data.get("expected_duration_ms"):
            new_transition["expected_duration_ms"] = data["expected_duration_ms"]

        config["transitions"].append(new_transition)

        logger.info(
            "applied_new_transition",
            discovery_id=str(discovery.id),
            from_state=from_state_id,
            to_state=to_state_id,
        )
        return True

    @staticmethod
    async def _create_edit_command(
        db: AsyncSession,
        discovery: Discovery,
        project: Project,
        user_id: UUID,
    ) -> None:
        """Create an edit command entry for audit trail."""
        command_data = EditCommandCreate(
            project_id=project.id,  # type: ignore[arg-type]
            command_type="update",
            entity_type="configuration",
            entity_id=f"discovery:{discovery.id}",
            payload={
                "discovery_id": str(discovery.id),
                "discovery_type": discovery.discovery_type,
                "discovery_title": discovery.title,
                "discovery_data": discovery.discovery_data,
                "applied_at": "auto",
            },
        )

        await create_command(db, command_data, user_id)
