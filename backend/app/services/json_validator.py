import base64
import hashlib
import json
from typing import Any

from app.schemas.export import ConfigurationExport, ValidationResult


class JSONConfigValidator:
    """Validates JSON configuration for import/export"""

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
        """Validate a configuration dictionary"""
        errors = []
        warnings = []

        try:
            # Parse configuration using Pydantic schema
            config = ConfigurationExport(**config_data)

            # Validate version
            if config.version not in self.SUPPORTED_VERSIONS:
                errors.append(f"Unsupported version: {config.version}")

            # Validate images
            image_ids = set()
            for image in config.images:
                if image.id in image_ids:
                    errors.append(f"Duplicate image ID: {image.id}")
                image_ids.add(image.id)

                if image.format not in self.SUPPORTED_IMAGE_FORMATS:
                    errors.append(f"Unsupported image format: {image.format}")

                # Validate base64 encoding
                try:
                    base64.b64decode(image.data)
                except Exception:
                    errors.append(f"Invalid base64 data for image: {image.id}")

                # Verify hash if provided
                if image.hash:
                    calculated_hash = hashlib.sha256(image.data.encode()).hexdigest()
                    if calculated_hash != image.hash:
                        warnings.append(f"Hash mismatch for image: {image.id}")

            # Validate processes
            process_ids = set()
            for process in config.processes:
                if process.id in process_ids:
                    errors.append(f"Duplicate process ID: {process.id}")
                process_ids.add(process.id)

                for action in process.actions:
                    if action.type not in self.SUPPORTED_ACTION_TYPES:
                        errors.append(f"Unsupported action type: {action.type}")

                    # Validate image references in actions
                    if (
                        action.config.target
                        and action.config.target.get("type") == "image"
                    ):
                        image_id = action.config.target.get("imageId")
                        if image_id and image_id not in image_ids:
                            errors.append(
                                f"Action references non-existent image: {image_id}"
                            )

            # Validate states
            state_ids = set()
            initial_states = 0
            for state in config.states:
                if state.id in state_ids:
                    errors.append(f"Duplicate state ID: {state.id}")
                state_ids.add(state.id)

                if state.isInitial:
                    initial_states += 1

                # Validate image references in states
                for state_image in state.identifyingImages:
                    if state_image.imageId not in image_ids:
                        errors.append(
                            f"State references non-existent image: {state_image.imageId}"
                        )

                    if not 0 <= state_image.threshold <= 1:
                        errors.append(
                            f"Invalid threshold value: {state_image.threshold}"
                        )

            if initial_states == 0 and len(config.states) > 0:
                warnings.append("No initial state defined")
            elif initial_states > 1:
                errors.append("Multiple initial states defined")

            # Validate transitions
            for transition in config.transitions:
                # Validate process references
                for process_id in transition.processes:
                    if process_id not in process_ids:
                        errors.append(
                            f"Transition references non-existent process: {process_id}"
                        )

                # Validate state references
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

            # Check for orphaned elements
            used_processes = set()
            for transition in config.transitions:
                used_processes.update(transition.processes)

            orphaned_processes = process_ids - used_processes
            if orphaned_processes:
                warnings.append(
                    f"Orphaned processes not used in any transition: {orphaned_processes}"
                )

        except Exception as e:
            errors.append(f"Schema validation error: {str(e)}")

        return ValidationResult(
            valid=len(errors) == 0, errors=errors, warnings=warnings
        )

    def validate_json_string(self, json_string: str) -> ValidationResult:
        """Validate a JSON string"""
        try:
            config_data = json.loads(json_string)
            return self.validate_configuration(config_data)
        except json.JSONDecodeError as e:
            return ValidationResult(
                valid=False, errors=[f"Invalid JSON: {str(e)}"], warnings=[]
            )
