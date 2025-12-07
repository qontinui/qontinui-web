"""Service for exporting and importing project configurations."""

import hashlib
from datetime import UTC, datetime
from typing import Any

from app.models.project import Project
from app.models.user import User
from app.services.json_validator import JSONConfigValidator


class ExportImportService:
    """
    Service for exporting and importing project configurations.

    Handles conversion between internal project data and standardized JSON
    configuration format, including validation and transformation.
    """

    def __init__(self) -> None:
        """Initialize the export/import service with a validator."""
        self.validator = JSONConfigValidator()

    def export_project(self, project: Project, user: User) -> dict[str, Any]:
        """
        Export a project configuration to standardized JSON format.

        Args:
            project: The project to export
            user: The user performing the export (for metadata)

        Returns:
            Validated configuration dictionary ready for export

        Raises:
            ValueError: If configuration validation fails
        """
        config: dict[str, Any] = project.configuration or self._get_default_configuration()  # type: ignore[assignment]

        metadata = config.get("metadata", {})
        metadata.update(
            {
                "name": project.name,
                "description": project.description or "",
                "author": user.username,
                "modified": datetime.now(UTC).isoformat(),
            }
        )

        if "created" not in metadata:
            metadata["created"] = project.created_at.isoformat()

        config["metadata"] = metadata

        if "version" not in config:
            config["version"] = "1.0.0"

        self._calculate_image_hashes(config)
        self._ensure_workflow_schema(config)

        validation_result = self.validator.validate_configuration(config)
        if not validation_result.valid:
            raise ValueError(
                f"Configuration validation failed: {', '.join(validation_result.errors)}"
            )

        return config

    def import_project(
        self, project: Project, config_data: dict[str, Any], merge: bool = False
    ) -> dict[str, Any]:
        """
        Import a JSON configuration into a project.

        Args:
            project: The project to import into
            config_data: The configuration data to import
            merge: Whether to merge with existing configuration (default: False)

        Returns:
            The final configuration (merged or replaced)

        Raises:
            ValueError: If configuration validation fails
        """
        validation_result = self.validator.validate_configuration(config_data)
        if not validation_result.valid:
            raise ValueError(
                f"Configuration validation failed: {', '.join(validation_result.errors)}"
            )

        if merge and project.configuration:
            existing_config: dict[str, Any] = project.configuration  # type: ignore[assignment]
            return self._merge_configurations(existing_config, config_data)

        return config_data

    def _calculate_image_hashes(self, config: dict[str, Any]) -> None:
        """
        Calculate SHA-256 hashes for images that don't have one.

        Args:
            config: Configuration dictionary (modified in place)
        """
        for image in config.get("images", []):
            if "data" in image and "hash" not in image:
                image["hash"] = hashlib.sha256(image["data"].encode()).hexdigest()

    def _ensure_workflow_schema(self, config: dict[str, Any]) -> None:
        """
        Ensure all workflows match the Pydantic schema exactly.

        Ensures:
        - format field is "graph"
        - connections field exists with correct structure
        - version field exists
        - actions have valid positions

        Args:
            config: Configuration dictionary (modified in place)
        """
        for workflow in config.get("workflows", []):
            workflow["format"] = "graph"

            if "version" not in workflow:
                workflow["version"] = "1.0.0"

            if not isinstance(workflow.get("connections"), dict):
                workflow["connections"] = {}

            for source_id, conn_types in list(workflow["connections"].items()):
                if not isinstance(conn_types, dict):
                    workflow["connections"][source_id] = {}
                else:
                    for conn_type, conn_list in list(conn_types.items()):
                        if not isinstance(conn_list, list):
                            conn_types[conn_type] = []

            if not isinstance(workflow.get("actions"), list):
                workflow["actions"] = []

            for action in workflow["actions"]:
                if (
                    not isinstance(action.get("position"), list | tuple)
                    or len(action.get("position", [])) != 2
                ):
                    action["position"] = [0, 0]

    def _merge_configurations(
        self, existing: dict[str, Any], new: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Merge two configurations intelligently.

        Args:
            existing: Current configuration
            new: New configuration to merge in

        Returns:
            Merged configuration dictionary
        """
        merged = existing.copy()

        merged["version"] = new.get("version", existing.get("version", "1.0.0"))
        merged["metadata"] = new.get("metadata", existing.get("metadata", {}))
        merged["metadata"]["modified"] = datetime.now(UTC).isoformat()

        merged["images"] = self._merge_by_id(
            existing.get("images", []), new.get("images", [])
        )
        merged["workflows"] = self._merge_by_id(
            existing.get("workflows", []), new.get("workflows", [])
        )
        merged["states"] = self._merge_by_id(
            existing.get("states", []), new.get("states", [])
        )
        merged["transitions"] = self._merge_by_id(
            existing.get("transitions", []), new.get("transitions", [])
        )

        existing_categories = set(existing.get("categories", []))
        new_categories = set(new.get("categories", []))
        merged["categories"] = sorted(existing_categories | new_categories)

        merged["settings"] = self._deep_merge_dicts(
            existing.get("settings", {}), new.get("settings", {})
        )

        return merged

    def _merge_by_id(
        self, existing_items: list[dict[str, Any]], new_items: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Merge two lists of items by ID, with new items overwriting existing ones.

        Args:
            existing_items: Current list of items
            new_items: New list of items to merge in

        Returns:
            Merged list of items
        """
        items_by_id = {item["id"]: item for item in existing_items}
        for new_item in new_items:
            items_by_id[new_item["id"]] = new_item
        return list(items_by_id.values())

    def _deep_merge_dicts(
        self, dict1: dict[str, Any], dict2: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Deep merge two dictionaries recursively.

        Args:
            dict1: Base dictionary
            dict2: Dictionary to merge in (takes precedence)

        Returns:
            Merged dictionary
        """
        result = dict1.copy()
        for key, value in dict2.items():
            if (
                key in result
                and isinstance(result[key], dict)
                and isinstance(value, dict)
            ):
                result[key] = self._deep_merge_dicts(result[key], value)
            else:
                result[key] = value
        return result

    def _get_default_configuration(self) -> dict[str, Any]:
        """
        Get a default empty configuration structure.

        Returns:
            Default configuration dictionary
        """
        now = datetime.now(UTC).isoformat()

        return {
            "version": "1.0.0",
            "metadata": {
                "name": "New Configuration",
                "description": "",
                "created": now,
                "modified": now,
                "tags": [],
                "targetApplication": "",
            },
            "images": [],
            "workflows": [],
            "states": [],
            "transitions": [],
            "categories": ["main"],
            "settings": {
                "execution": {
                    "defaultTimeout": 10000,
                    "defaultRetryCount": 3,
                    "actionDelay": 100,
                    "failureStrategy": "stop",
                },
                "recognition": {
                    "defaultThreshold": 0.9,
                    "searchAlgorithm": "template_matching",
                    "multiScaleSearch": True,
                    "colorSpace": "rgb",
                },
                "logging": {
                    "level": "info",
                    "screenshotOnError": True,
                    "consoleOutput": True,
                },
                "performance": {
                    "maxParallelActions": 1,
                    "cacheImages": True,
                    "optimizeSearch": True,
                },
            },
        }
