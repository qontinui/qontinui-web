"""Validator for JSON configuration import/export."""

import base64
import hashlib
from typing import Any

from app.schemas.export import ConfigurationExport, ValidationResult


class JSONConfigValidator:
    """
    Validates JSON configuration for import/export.

    Ensures configuration data matches the expected schema and all
    references between elements are valid.
    """

    SUPPORTED_VERSIONS = ["1.0.0"]
    SUPPORTED_IMAGE_FORMATS = ["png", "jpg", "jpeg", "gif", "bmp"]
    SUPPORTED_ACTION_TYPES = [
        "FIND",
        "CLICK",
        "DOUBLE_CLICK",
        "RIGHT_CLICK",
        "TYPE",
        "KEY_PRESS",
        "DRAG",
        "SCROLL",
        "WAIT",
        "VANISH",
        "EXISTS",
        "MOVE",
        "SCREENSHOT",
        "CONDITION",
        "LOOP",
    ]

    def validate_configuration(self, config_data: dict[str, Any]) -> ValidationResult:
        """
        Validate a configuration dictionary against the schema.

        Args:
            config_data: Configuration dictionary to validate

        Returns:
            ValidationResult with errors and warnings
        """
        errors: list[str] = []
        warnings: list[str] = []

        try:
            config = ConfigurationExport(**config_data)

            if config.version not in self.SUPPORTED_VERSIONS:
                errors.append(f"Unsupported version: {config.version}")

            image_ids = self._validate_images(config, errors, warnings)
            workflow_ids = self._validate_workflows(config, errors, warnings, image_ids)
            state_ids = self._validate_states(config, errors, warnings, image_ids)
            self._validate_transitions(config, errors, workflow_ids, state_ids)
            self._check_orphaned_workflows(config, warnings, workflow_ids)

        except Exception as e:
            errors.append(f"Schema validation error: {str(e)}")

        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings
        )

    def validate_json_string(self, json_string: str) -> ValidationResult:
        """
        Validate a JSON string by parsing and validating it.

        Args:
            json_string: JSON string to validate

        Returns:
            ValidationResult with errors and warnings
        """
        import json

        try:
            config_data = json.loads(json_string)
            return self.validate_configuration(config_data)
        except json.JSONDecodeError as e:
            return ValidationResult(
                valid=False,
                errors=[f"Invalid JSON: {str(e)}"],
                warnings=[]
            )

    def _validate_images(
        self,
        config: ConfigurationExport,
        errors: list[str],
        warnings: list[str]
    ) -> set[str]:
        """
        Validate all images in the configuration.

        Args:
            config: Configuration to validate
            errors: List to append errors to
            warnings: List to append warnings to

        Returns:
            Set of valid image IDs
        """
        image_ids: set[str] = set()

        for image in config.images:
            if image.id in image_ids:
                errors.append(f"Duplicate image ID: {image.id}")
            image_ids.add(image.id)

            if image.format not in self.SUPPORTED_IMAGE_FORMATS:
                errors.append(f"Unsupported image format: {image.format}")

            try:
                base64.b64decode(image.data)
            except Exception:
                errors.append(f"Invalid base64 data for image: {image.id}")

            if image.hash:
                calculated_hash = hashlib.sha256(image.data.encode()).hexdigest()
                if calculated_hash != image.hash:
                    warnings.append(f"Hash mismatch for image: {image.id}")

        return image_ids

    def _validate_workflows(
        self,
        config: ConfigurationExport,
        errors: list[str],
        warnings: list[str],
        image_ids: set[str]
    ) -> set[str]:
        """
        Validate all workflows in the configuration.

        Args:
            config: Configuration to validate
            errors: List to append errors to
            warnings: List to append warnings to
            image_ids: Set of valid image IDs

        Returns:
            Set of valid workflow IDs
        """
        workflow_ids: set[str] = set()

        for workflow in config.workflows:
            if workflow.id in workflow_ids:
                errors.append(f"Duplicate workflow ID: {workflow.id}")
            workflow_ids.add(workflow.id)

            if workflow.format != "graph":
                errors.append(
                    f"Invalid workflow format: {workflow.format}. Must be 'graph'"
                )

            self._validate_actions(workflow, errors, warnings, image_ids)
            self._validate_connections(workflow, errors)

        return workflow_ids

    def _validate_actions(
        self,
        workflow: Any,
        errors: list[str],
        warnings: list[str],
        image_ids: set[str]
    ) -> None:
        """
        Validate all actions in a workflow.

        Args:
            workflow: Workflow to validate actions for
            errors: List to append errors to
            warnings: List to append warnings to
            image_ids: Set of valid image IDs
        """
        for action in workflow.actions:
            if action.type not in self.SUPPORTED_ACTION_TYPES:
                warnings.append(f"Unknown action type: {action.type}")

            if isinstance(action.config, dict):
                target = action.config.get("target")
                if target and target.get("type") == "image":
                    image_id = target.get("imageId")
                    if image_id and image_id not in image_ids:
                        errors.append(
                            f"Action references non-existent image: {image_id}"
                        )

    def _validate_connections(self, workflow: Any, errors: list[str]) -> None:
        """
        Validate workflow connections structure.

        Args:
            workflow: Workflow to validate connections for
            errors: List to append errors to
        """
        if not isinstance(workflow.connections, dict):
            errors.append(f"Workflow {workflow.id}: connections must be a dict")
            return

        for source_id, conn_types in workflow.connections.items():
            if not isinstance(conn_types, dict):
                errors.append(
                    f"Workflow {workflow.id}: connections[{source_id}] must be a dict"
                )
                continue

            for conn_type, conn_list in conn_types.items():
                if not isinstance(conn_list, list):
                    errors.append(
                        f"Workflow {workflow.id}: "
                        f"connections[{source_id}][{conn_type}] must be a list"
                    )

    def _validate_states(
        self,
        config: ConfigurationExport,
        errors: list[str],
        warnings: list[str],
        image_ids: set[str]
    ) -> set[str]:
        """
        Validate all states in the configuration.

        Args:
            config: Configuration to validate
            errors: List to append errors to
            warnings: List to append warnings to
            image_ids: Set of valid image IDs

        Returns:
            Set of valid state IDs
        """
        state_ids: set[str] = set()
        initial_states = 0

        for state in config.states:
            if state.id in state_ids:
                errors.append(f"Duplicate state ID: {state.id}")
            state_ids.add(state.id)

            if state.isInitial:
                initial_states += 1

            for state_image in state.identifyingImages:
                if state_image.imageId not in image_ids:
                    errors.append(
                        f"State references non-existent image: {state_image.imageId}"
                    )

                if not 0 <= state_image.threshold <= 1:
                    errors.append(f"Invalid threshold value: {state_image.threshold}")

        if initial_states == 0 and len(config.states) > 0:
            warnings.append("No initial state defined")
        elif initial_states > 1:
            errors.append("Multiple initial states defined")

        return state_ids

    def _validate_transitions(
        self,
        config: ConfigurationExport,
        errors: list[str],
        workflow_ids: set[str],
        state_ids: set[str]
    ) -> None:
        """
        Validate all transitions in the configuration.

        Args:
            config: Configuration to validate
            errors: List to append errors to
            workflow_ids: Set of valid workflow IDs
            state_ids: Set of valid state IDs
        """
        for transition in config.transitions:
            for workflow_id in transition.processes:
                if workflow_id not in workflow_ids:
                    errors.append(
                        f"Transition references non-existent workflow: {workflow_id}"
                    )

            if transition.fromState and transition.fromState not in state_ids:
                errors.append(
                    f"Transition references non-existent fromState: {transition.fromState}"
                )

            if transition.toState and transition.toState not in state_ids:
                errors.append(
                    f"Transition references non-existent toState: {transition.toState}"
                )

            for state_id in transition.activateStates:
                if state_id not in state_ids:
                    errors.append(
                        f"Transition references non-existent state to activate: {state_id}"
                    )

            for state_id in transition.deactivateStates:
                if state_id not in state_ids:
                    errors.append(
                        f"Transition references non-existent state to deactivate: {state_id}"
                    )

    def _check_orphaned_workflows(
        self,
        config: ConfigurationExport,
        warnings: list[str],
        workflow_ids: set[str]
    ) -> None:
        """
        Check for workflows not used in any transition.

        Args:
            config: Configuration to check
            warnings: List to append warnings to
            workflow_ids: Set of all workflow IDs
        """
        used_workflows: set[str] = set()
        for transition in config.transitions:
            used_workflows.update(transition.processes)

        orphaned_workflows = workflow_ids - used_workflows
        if orphaned_workflows:
            warnings.append(
                f"Orphaned workflows not used in any transition: {orphaned_workflows}"
            )
