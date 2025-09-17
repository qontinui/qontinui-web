from typing import Dict, Any, Optional
from datetime import datetime
import json
import hashlib
from app.schemas.export import ConfigurationExport, Metadata
from app.models.project import Project
from app.models.user import User
from app.services.json_validator import JSONConfigValidator


class ExportImportService:
    """Service for exporting and importing project configurations"""
    
    def __init__(self):
        self.validator = JSONConfigValidator()
    
    def export_project(self, project: Project, user: User) -> Dict[str, Any]:
        """Export a project configuration to JSON format"""
        
        # Get existing configuration or create default
        config = project.configuration or self._get_default_configuration()
        
        # Update metadata
        metadata = config.get("metadata", {})
        metadata.update({
            "name": project.name,
            "description": project.description or "",
            "author": user.username,
            "modified": datetime.utcnow().isoformat() + "Z"
        })
        
        # Ensure created timestamp exists
        if "created" not in metadata:
            metadata["created"] = project.created_at.isoformat() + "Z"
        
        config["metadata"] = metadata
        
        # Add version if not present
        if "version" not in config:
            config["version"] = "1.0.0"
        
        # Calculate hashes for images if present
        if "images" in config:
            for image in config["images"]:
                if "data" in image and "hash" not in image:
                    image["hash"] = hashlib.sha256(
                        image["data"].encode()
                    ).hexdigest()
        
        # Validate before export
        validation_result = self.validator.validate_configuration(config)
        if not validation_result.valid:
            raise ValueError(f"Configuration validation failed: {validation_result.errors}")
        
        return config
    
    def import_project(
        self, 
        project: Project, 
        config_data: Dict[str, Any],
        merge: bool = False
    ) -> Dict[str, Any]:
        """Import a JSON configuration into a project"""
        
        # Validate configuration
        validation_result = self.validator.validate_configuration(config_data)
        if not validation_result.valid:
            raise ValueError(f"Configuration validation failed: {validation_result.errors}")
        
        if merge and project.configuration:
            # Merge with existing configuration
            merged_config = self._merge_configurations(
                project.configuration, 
                config_data
            )
            return merged_config
        else:
            # Replace configuration
            return config_data
    
    def _merge_configurations(
        self, 
        existing: Dict[str, Any], 
        new: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Merge two configurations intelligently"""
        
        merged = existing.copy()
        
        # Update version and metadata
        merged["version"] = new.get("version", existing.get("version", "1.0.0"))
        merged["metadata"] = new.get("metadata", existing.get("metadata", {}))
        merged["metadata"]["modified"] = datetime.utcnow().isoformat() + "Z"
        
        # Merge images (by ID)
        existing_images = {img["id"]: img for img in existing.get("images", [])}
        for new_image in new.get("images", []):
            existing_images[new_image["id"]] = new_image
        merged["images"] = list(existing_images.values())
        
        # Merge processes (by ID)
        existing_processes = {p["id"]: p for p in existing.get("processes", [])}
        for new_process in new.get("processes", []):
            existing_processes[new_process["id"]] = new_process
        merged["processes"] = list(existing_processes.values())
        
        # Merge states (by ID)
        existing_states = {s["id"]: s for s in existing.get("states", [])}
        for new_state in new.get("states", []):
            existing_states[new_state["id"]] = new_state
        merged["states"] = list(existing_states.values())
        
        # Merge transitions (by ID)
        existing_transitions = {t["id"]: t for t in existing.get("transitions", [])}
        for new_transition in new.get("transitions", []):
            existing_transitions[new_transition["id"]] = new_transition
        merged["transitions"] = list(existing_transitions.values())
        
        # Merge settings (deep merge)
        merged["settings"] = self._deep_merge_dicts(
            existing.get("settings", {}),
            new.get("settings", {})
        )
        
        return merged
    
    def _deep_merge_dicts(self, dict1: Dict, dict2: Dict) -> Dict:
        """Deep merge two dictionaries"""
        result = dict1.copy()
        for key, value in dict2.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge_dicts(result[key], value)
            else:
                result[key] = value
        return result
    
    def _get_default_configuration(self) -> Dict[str, Any]:
        """Get a default empty configuration"""
        return {
            "version": "1.0.0",
            "metadata": {
                "name": "New Configuration",
                "description": "",
                "created": datetime.utcnow().isoformat() + "Z",
                "modified": datetime.utcnow().isoformat() + "Z",
                "tags": [],
                "targetApplication": ""
            },
            "images": [],
            "processes": [],
            "states": [],
            "transitions": [],
            "settings": {
                "execution": {
                    "defaultTimeout": 10000,
                    "defaultRetryCount": 3,
                    "actionDelay": 100,
                    "failureStrategy": "stop"
                },
                "recognition": {
                    "defaultThreshold": 0.9,
                    "searchAlgorithm": "template_matching",
                    "multiScaleSearch": True,
                    "colorSpace": "rgb"
                },
                "logging": {
                    "level": "info",
                    "screenshotOnError": True,
                    "consoleOutput": True
                },
                "performance": {
                    "maxParallelActions": 1,
                    "cacheImages": True,
                    "optimizeSearch": True
                }
            }
        }