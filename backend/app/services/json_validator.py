"""Validator for JSON configuration import/export.

Supports both v1.x (legacy) and v2.x (current) configuration formats.
"""

import base64
import hashlib
import re
from typing import Any

from pydantic import ValidationError

from app.schemas.export import QontinuiConfig, ValidationResult


class JSONConfigValidator:
    """
    Validates JSON configuration for import/export.

    Ensures configuration data matches the expected schema and all
    references between elements are valid.

    Supports:
    - v2.0.0 - v2.9.x: Current format with stateImages, workflows
    - v1.0.0: Legacy format (deprecated, limited support)
    """

    # Supported version ranges
    SUPPORTED_VERSION_PATTERN = re.compile(r"^(1\.0\.0|2\.\d+\.\d+)$")

    SUPPORTED_IMAGE_FORMATS = ["png", "jpg", "jpeg", "gif", "bmp"]

    SUPPORTED_ACTION_TYPES = [
        # Find actions
        "FIND",
        "RAG_FIND",
        # Mouse actions
        "MOUSE_MOVE",
        "MOUSE_DOWN",
        "MOUSE_UP",
        "MOUSE_SCROLL",
        "CLICK",
        "DOUBLE_CLICK",
        "RIGHT_CLICK",
        "DRAG",
        "SCROLL",
        # Keyboard actions
        "KEY_PRESS",
        "KEY_DOWN",
        "KEY_UP",
        "TYPE",
        # Shell actions
        "SHELL",
        "SHELL_SCRIPT",
        # AI actions
        "AI_PROMPT",
        "RUN_PROMPT_SEQUENCE",
        # Other actions
        "VANISH",
        "GO_TO_STATE",
        "RUN_WORKFLOW",
        "EXISTS",
        "SCREENSHOT",
        "CONDITION",
        "LOOP",
        # Control flow
        "IF",
        "SWITCH",
        "TRY_CATCH",
        "BREAK",
        "CONTINUE",
        # Data operations
        "SET_VARIABLE",
        "GET_VARIABLE",
        "MATH_OPERATION",
        "STRING_OPERATION",
        "FILTER",
        "MAP",
        "REDUCE",
        "SORT",
        # Code execution
        "CODE_BLOCK",
        "CUSTOM_FUNCTION",
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

        # Check version first
        version = config_data.get("version", "")
        if not self.SUPPORTED_VERSION_PATTERN.match(version):
            errors.append(f"Unsupported version: {version}. Supported: 1.0.0 or 2.x.x")
            return ValidationResult(valid=False, errors=errors, warnings=warnings)

        # Determine format based on version
        is_v2 = version.startswith("2.")

        if is_v2:
            return self._validate_v2_configuration(config_data)
        else:
            return self._validate_v1_configuration(config_data)

    def _validate_v2_configuration(
        self, config_data: dict[str, Any]
    ) -> ValidationResult:
        """Validate v2.x configuration format using qontinui-schemas."""
        errors: list[str] = []
        warnings: list[str] = []

        try:
            # Use Pydantic validation from qontinui-schemas
            config = QontinuiConfig.model_validate(config_data)

            # Additional semantic validation
            image_ids = self._validate_images_v2(config, errors, warnings)
            workflow_ids = self._validate_workflows_v2(
                config, errors, warnings, image_ids
            )
            state_ids = self._validate_states_v2(config, errors, warnings, image_ids)
            self._validate_transitions_v2(
                config, errors, warnings, workflow_ids, state_ids
            )
            self._check_orphaned_workflows_v2(config, warnings, workflow_ids)

        except ValidationError as e:
            for error in e.errors():
                loc = " -> ".join(str(x) for x in error["loc"])
                errors.append(f"Schema validation error at {loc}: {error['msg']}")

        except Exception as e:
            errors.append(f"Unexpected validation error: {str(e)}")

        return ValidationResult(
            valid=len(errors) == 0, errors=errors, warnings=warnings
        )

    def _validate_images_v2(
        self,
        config: QontinuiConfig,
        errors: list[str],
        warnings: list[str],
    ) -> set[str]:
        """Validate all images in v2 configuration."""
        image_ids: set[str] = set()

        for image in config.images:
            if image.id in image_ids:
                errors.append(f"Duplicate image ID: {image.id}")
            image_ids.add(image.id)

            if image.format.value not in self.SUPPORTED_IMAGE_FORMATS:
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

    def _validate_workflows_v2(
        self,
        config: QontinuiConfig,
        errors: list[str],
        warnings: list[str],
        image_ids: set[str],
    ) -> set[str]:
        """Validate all workflows in v2 configuration."""
        workflow_ids: set[str] = set()

        for workflow in config.workflows:
            if workflow.id in workflow_ids:
                errors.append(f"Duplicate workflow ID: {workflow.id}")
            workflow_ids.add(workflow.id)

            if workflow.format != "graph":
                errors.append(
                    f"Invalid workflow format: {workflow.format}. Must be 'graph'"
                )

            # Validate actions
            action_ids: set[str] = set()
            for action in workflow.actions:
                if action.id in action_ids:
                    errors.append(
                        f"Duplicate action ID in workflow {workflow.id}: {action.id}"
                    )
                action_ids.add(action.id)

                if action.type not in self.SUPPORTED_ACTION_TYPES:
                    warnings.append(
                        f"Unknown action type in workflow {workflow.id}: {action.type}"
                    )

                # Check image references in action config
                self._check_action_image_refs(
                    action.config, image_ids, errors, workflow.id, action.id
                )

            # Validate connections reference valid action IDs
            if workflow.connections:
                for source_id in workflow.connections.root.keys():
                    if source_id not in action_ids:
                        errors.append(
                            f"Workflow {workflow.id}: connection source "
                            f"'{source_id}' not found in actions"
                        )

        return workflow_ids

    def _check_action_image_refs(
        self,
        config: dict[str, Any],
        image_ids: set[str],
        errors: list[str],
        workflow_id: str,
        action_id: str,
    ) -> None:
        """Check image references in action configuration."""
        if not isinstance(config, dict):
            return

        # Check target.imageId
        target = config.get("target")
        if isinstance(target, dict) and target.get("type") == "image":
            image_id = target.get("imageId")
            if image_id and image_id not in image_ids:
                errors.append(
                    f"Workflow {workflow_id}, action {action_id}: "
                    f"references non-existent image: {image_id}"
                )

    def _validate_states_v2(
        self,
        config: QontinuiConfig,
        errors: list[str],
        warnings: list[str],
        image_ids: set[str],
    ) -> set[str]:
        """Validate all states in v2 configuration."""
        state_ids: set[str] = set()
        initial_states = 0

        for state in config.states:
            if state.id in state_ids:
                errors.append(f"Duplicate state ID: {state.id}")
            state_ids.add(state.id)

            if state.is_initial:
                initial_states += 1

            # Validate stateImages
            for state_image in state.state_images:
                # Check pattern image references
                for pattern in state_image.patterns:
                    if pattern.image_id and pattern.image_id not in image_ids:
                        errors.append(
                            f"State {state.id}, stateImage {state_image.id}: "
                            f"pattern references non-existent image: {pattern.image_id}"
                        )

                # Validate monitors (should be non-negative integers)
                if state_image.monitors:
                    for monitor_idx in state_image.monitors:
                        if monitor_idx < 0:
                            errors.append(
                                f"State {state.id}, stateImage {state_image.id}: "
                                f"invalid monitor index: {monitor_idx}"
                            )

        if initial_states == 0 and len(config.states) > 0:
            warnings.append("No initial state defined")
        elif initial_states > 1:
            warnings.append("Multiple initial states defined (may be intentional)")

        return state_ids

    def _validate_transitions_v2(
        self,
        config: QontinuiConfig,
        errors: list[str],
        warnings: list[str],
        workflow_ids: set[str],
        state_ids: set[str],
    ) -> None:
        """Validate all transitions in v2 configuration."""
        for transition in config.transitions:
            # Validate workflow references
            for workflow_id in transition.workflows:
                if workflow_id not in workflow_ids:
                    errors.append(
                        f"Transition {transition.id}: "
                        f"references non-existent workflow: {workflow_id}"
                    )

            # Validate state references based on transition type
            if transition.type.value == "OutgoingTransition":
                # OutgoingTransition has fromState and toState
                from_state = getattr(transition, "from_state", None)
                to_state = getattr(transition, "to_state", None)

                if from_state and from_state not in state_ids:
                    errors.append(
                        f"Transition {transition.id}: "
                        f"references non-existent fromState: {from_state}"
                    )

                if to_state and to_state not in state_ids:
                    errors.append(
                        f"Transition {transition.id}: "
                        f"references non-existent toState: {to_state}"
                    )

                # Check activate/deactivate states
                activate_states = getattr(transition, "activate_states", [])
                for state_id in activate_states:
                    if state_id not in state_ids:
                        errors.append(
                            f"Transition {transition.id}: "
                            f"activateStates references non-existent state: {state_id}"
                        )

                deactivate_states = getattr(transition, "deactivate_states", [])
                for state_id in deactivate_states:
                    if state_id not in state_ids:
                        errors.append(
                            f"Transition {transition.id}: "
                            f"deactivateStates references non-existent state: {state_id}"
                        )

            elif transition.type.value == "IncomingTransition":
                # IncomingTransition has toState
                to_state = getattr(transition, "to_state", None)
                if to_state and to_state not in state_ids:
                    errors.append(
                        f"Transition {transition.id}: "
                        f"references non-existent toState: {to_state}"
                    )

    def _check_orphaned_workflows_v2(
        self,
        config: QontinuiConfig,
        warnings: list[str],
        workflow_ids: set[str],
    ) -> None:
        """Check for workflows not used in any transition."""
        used_workflows: set[str] = set()

        for transition in config.transitions:
            used_workflows.update(transition.workflows)

        # Also check initialStateIds in workflows (Main workflows)
        for workflow in config.workflows:
            if workflow.initial_state_ids:
                # This is a Main workflow, don't mark as orphaned
                used_workflows.add(workflow.id)

        orphaned_workflows = workflow_ids - used_workflows
        if orphaned_workflows:
            # Filter out internal/system workflows
            public_orphaned = set()
            for wf in config.workflows:
                if wf.id in orphaned_workflows:
                    visibility = getattr(wf, "visibility", None)
                    if visibility is None or visibility.value == "public":
                        public_orphaned.add(wf.id)

            if public_orphaned:
                warnings.append(
                    f"Orphaned workflows not used in any transition: {public_orphaned}"
                )

    # =========================================================================
    # Legacy v1.x validation (deprecated)
    # =========================================================================

    def _validate_v1_configuration(
        self, config_data: dict[str, Any]
    ) -> ValidationResult:
        """
        Validate legacy v1.x configuration format.

        Note: v1.x format is deprecated. Consider migrating to v2.x.
        """
        errors: list[str] = []
        warnings: list[str] = []

        warnings.append(
            "Configuration uses deprecated v1.x format. "
            "Consider migrating to v2.x for full feature support."
        )

        # Basic structure validation
        required_fields = ["version", "metadata", "images", "states", "transitions"]
        for field in required_fields:
            if field not in config_data:
                errors.append(f"Missing required field: {field}")

        if errors:
            return ValidationResult(valid=False, errors=errors, warnings=warnings)

        # Validate images
        image_ids: set[str] = set()
        for image in config_data.get("images", []):
            if not isinstance(image, dict):
                errors.append("Invalid image format")
                continue
            image_id = image.get("id")
            if image_id:
                if image_id in image_ids:
                    errors.append(f"Duplicate image ID: {image_id}")
                image_ids.add(image_id)

        # Validate states (v1 uses identifyingImages)
        state_ids: set[str] = set()
        for state in config_data.get("states", []):
            if not isinstance(state, dict):
                errors.append("Invalid state format")
                continue
            state_id = state.get("id")
            if state_id:
                if state_id in state_ids:
                    errors.append(f"Duplicate state ID: {state_id}")
                state_ids.add(state_id)

            # v1 format uses identifyingImages
            for img in state.get("identifyingImages", []):
                img_id = img.get("imageId") if isinstance(img, dict) else None
                if img_id and img_id not in image_ids:
                    errors.append(
                        f"State {state_id}: references non-existent image: {img_id}"
                    )

        # Validate transitions (v1 uses processes)
        workflow_ids: set[str] = set()
        for wf in config_data.get("workflows", config_data.get("processes", [])):
            if isinstance(wf, dict):
                wf_id = wf.get("id")
                if wf_id:
                    workflow_ids.add(wf_id)

        for transition in config_data.get("transitions", []):
            if not isinstance(transition, dict):
                continue
            # v1 uses processes, v2 uses workflows
            wf_ids = transition.get("processes") or transition.get("workflows") or []
            for wf_id in wf_ids:
                if wf_id not in workflow_ids:
                    errors.append(
                        f"Transition references non-existent workflow: {wf_id}"
                    )

        return ValidationResult(
            valid=len(errors) == 0, errors=errors, warnings=warnings
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
                valid=False, errors=[f"Invalid JSON: {str(e)}"], warnings=[]
            )
