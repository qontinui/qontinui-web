"""
Tests for JSON export functionality and qontinui Pydantic schema compatibility.

This test suite ensures that:
1. Exported JSON configs have the correct structure
2. FIND actions export with proper target structure
3. Workflows export with correct format field ('graph')
4. Exported JSON validates against qontinui Pydantic schemas
5. All required fields are present
"""

import pytest
# Import qontinui-schemas Pydantic models
from qontinui_schemas.config.models import (Action, ClickActionConfig,
                                            FindActionConfig, TypeActionConfig,
                                            Workflow, get_typed_config)


class TestFindActionExport:
    """Test FIND action export with proper target structure."""

    def test_find_action_with_image_target(self):
        """Test FIND action with image target exports correctly."""
        action_data = {
            "id": "action_1",
            "type": "FIND",
            "name": "Find Login Button",
            "config": {
                "target": {
                    "type": "image",
                    "imageId": "img_login_btn",
                    "searchOptions": {"similarity": 0.9, "timeout": 5000},
                }
            },
            "position": [100, 100],
        }

        # Validate with Pydantic
        action = Action.model_validate(action_data)
        assert action.id == "action_1"
        assert action.type == "FIND"
        assert action.name == "Find Login Button"

        # Validate config structure
        typed_config = get_typed_config(action)
        assert isinstance(typed_config, FindActionConfig)
        assert typed_config.target.type == "image"
        assert typed_config.target.image_id == "img_login_btn"
        assert typed_config.target.search_options.similarity == 0.9
        assert typed_config.target.search_options.timeout == 5000

    def test_find_action_with_text_target(self):
        """Test FIND action with text target exports correctly."""
        action_data = {
            "id": "action_2",
            "type": "FIND",
            "config": {
                "target": {
                    "type": "text",
                    "text": "Submit",
                    "searchOptions": {"similarity": 0.85},
                    "textOptions": {"ocrEngine": "TESSERACT", "caseSensitive": False},
                }
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)

        assert isinstance(typed_config, FindActionConfig)
        assert typed_config.target.type == "text"
        assert typed_config.target.text == "Submit"
        assert typed_config.target.text_options.ocr_engine == "TESSERACT"
        assert typed_config.target.text_options.case_sensitive is False

    def test_find_action_with_coordinates_target(self):
        """Test FIND action with coordinates target exports correctly."""
        action_data = {
            "id": "action_3",
            "type": "FIND",
            "config": {
                "target": {"type": "coordinates", "coordinates": {"x": 500, "y": 300}}
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)

        assert isinstance(typed_config, FindActionConfig)
        assert typed_config.target.type == "coordinates"
        assert typed_config.target.coordinates.x == 500
        assert typed_config.target.coordinates.y == 300

    def test_find_action_with_state_string_target(self):
        """Test FIND action with state string target exports correctly."""
        action_data = {
            "id": "action_4",
            "type": "FIND",
            "config": {
                "target": {
                    "type": "stateString",
                    "stateId": "state_1",
                    "stringIds": ["str_1", "str_2"],
                    "useAll": False,
                }
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)

        assert isinstance(typed_config, FindActionConfig)
        assert typed_config.target.type == "stateString"
        assert typed_config.target.state_id == "state_1"
        assert typed_config.target.string_ids == ["str_1", "str_2"]
        assert typed_config.target.use_all is False

    def test_find_action_with_search_options_both_levels(self):
        """Test FIND action with search options at both target and config level."""
        # This tests the current schema structure where searchOptions can be:
        # 1. In the target (for image/text targets)
        # 2. At the config level (for FindActionConfig)
        action_data = {
            "id": "action_5a",
            "type": "FIND",
            "config": {
                "target": {
                    "type": "image",
                    "imageId": "img_with_options",
                    "searchOptions": {"similarity": 0.9},
                }
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)

        assert isinstance(typed_config, FindActionConfig)
        assert typed_config.target.search_options.similarity == 0.9

    def test_find_action_with_search_options_at_config_level(self):
        """Test FIND action with search options at config level only."""
        action_data = {
            "id": "action_5b",
            "type": "FIND",
            "config": {
                "target": {"type": "image", "imageId": "img_no_options"},
                "searchOptions": {
                    "similarity": 0.95,
                    "timeout": 10000,
                    "searchRegions": [{"x": 0, "y": 0, "width": 500, "height": 500}],
                    "strategy": "FIRST",
                    "maxMatchesToActOn": 1,
                    "polling": {"interval": 500, "maxAttempts": 20},
                },
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)

        assert isinstance(typed_config, FindActionConfig)
        # Verify config-level search options
        assert typed_config.search_options.similarity == 0.95
        assert typed_config.search_options.timeout == 10000
        assert len(typed_config.search_options.search_regions) == 1
        assert typed_config.search_options.strategy == "FIRST"
        assert typed_config.search_options.polling.interval == 500
        assert typed_config.search_options.polling.max_attempts == 20

    def test_find_action_missing_target_fails(self):
        """Test that FIND action without target fails validation."""
        action_data = {"id": "action_bad", "type": "FIND", "config": {}}

        with pytest.raises(Exception):  # Should raise validation error
            action = Action.model_validate(action_data)
            get_typed_config(action)


class TestWorkflowExport:
    """Test workflow export with correct format field."""

    def test_workflow_graph_format(self):
        """Test workflow exports with 'graph' format."""
        workflow_data = {
            "id": "workflow_1",
            "name": "Test Workflow",
            "version": "1.0.0",
            "format": "graph",
            "actions": [
                {
                    "id": "action_1",
                    "type": "FIND",
                    "config": {"target": {"type": "image", "imageId": "img_1"}},
                    "position": [100, 100],
                },
                {
                    "id": "action_2",
                    "type": "CLICK",
                    "config": {"target": {"type": "currentPosition"}},
                    "position": [200, 100],
                },
            ],
            "connections": {
                "action_1": {
                    "main": [[{"action": "action_2", "type": "main", "index": 0}]]
                },
                "action_2": {"main": []},
            },
        }

        workflow = Workflow.model_validate(workflow_data)
        assert workflow.id == "workflow_1"
        assert workflow.name == "Test Workflow"
        assert workflow.version == "1.0.0"
        assert workflow.format == "graph"
        assert len(workflow.actions) == 2
        assert workflow.connections is not None

    def test_workflow_with_metadata(self):
        """Test workflow with metadata exports correctly."""
        workflow_data = {
            "id": "workflow_2",
            "name": "Login Workflow",
            "version": "2.0.0",
            "format": "graph",
            "actions": [],
            "connections": {},
            "metadata": {
                "author": "Test Author",
                "description": "Automated login workflow",
                "created": "2025-01-01T00:00:00Z",
                "updated": "2025-01-02T00:00:00Z",
            },
            "tags": ["login", "authentication"],
        }

        workflow = Workflow.model_validate(workflow_data)
        assert workflow.metadata.author == "Test Author"
        assert workflow.metadata.description == "Automated login workflow"
        assert len(workflow.tags) == 2

    def test_workflow_with_variables(self):
        """Test workflow with variables exports correctly."""
        workflow_data = {
            "id": "workflow_3",
            "name": "Workflow with Variables",
            "version": "1.0.0",
            "format": "graph",
            "actions": [],
            "connections": {},
            "variables": {
                "local": {"username": "testuser", "counter": 0},
                "process": {"session_id": "abc123"},
                "global": {"api_key": "secret"},
            },
        }

        workflow = Workflow.model_validate(workflow_data)
        assert workflow.variables.local["username"] == "testuser"
        assert workflow.variables.process["session_id"] == "abc123"
        assert workflow.variables.global_vars["api_key"] == "secret"

    def test_workflow_with_settings(self):
        """Test workflow with execution settings."""
        workflow_data = {
            "id": "workflow_4",
            "name": "Workflow with Settings",
            "version": "1.0.0",
            "format": "graph",
            "actions": [],
            "connections": {},
            "settings": {
                "timeout": 30000,
                "retryCount": 3,
                "continueOnError": True,
                "parallelExecution": False,
                "maxParallelActions": 1,
            },
        }

        workflow = Workflow.model_validate(workflow_data)
        assert workflow.settings.timeout == 30000
        assert workflow.settings.retry_count == 3
        assert workflow.settings.continue_on_error is True
        assert workflow.settings.parallel_execution is False

    def test_workflow_missing_format_defaults_to_graph(self):
        """Test that workflow defaults to 'graph' format."""
        workflow_data = {
            "id": "workflow_5",
            "name": "Default Format Workflow",
            "version": "1.0.0",
            "actions": [],
            "connections": {},
        }

        workflow = Workflow.model_validate(workflow_data)
        assert workflow.format == "graph"

    def test_workflow_invalid_format_fails(self):
        """Test that invalid format fails validation."""
        workflow_data = {
            "id": "workflow_bad",
            "name": "Bad Format Workflow",
            "version": "1.0.0",
            "format": "sequential",  # Invalid - only 'graph' is allowed
            "actions": [],
            "connections": {},
        }

        with pytest.raises(Exception):  # Should raise validation error
            Workflow.model_validate(workflow_data)

    def test_workflow_missing_connections_fails(self):
        """Test that workflow without connections fails validation."""
        workflow_data = {
            "id": "workflow_no_conn",
            "name": "No Connections Workflow",
            "version": "1.0.0",
            "format": "graph",
            "actions": [],
            # Missing connections field
        }

        with pytest.raises(Exception):  # Should raise validation error
            Workflow.model_validate(workflow_data)


class TestActionConfigExport:
    """Test various action config exports."""

    def test_click_action_with_target(self):
        """Test CLICK action exports correctly."""
        action_data = {
            "id": "click_1",
            "type": "CLICK",
            "config": {
                "target": {"type": "image", "imageId": "img_button"},
                "mouseButton": "LEFT",
                "numberOfClicks": 1,
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)
        assert isinstance(typed_config, ClickActionConfig)
        assert typed_config.target.type == "image"
        assert typed_config.mouse_button == "LEFT"
        assert typed_config.number_of_clicks == 1

    def test_type_action_with_text(self):
        """Test TYPE action exports correctly."""
        action_data = {
            "id": "type_1",
            "type": "TYPE",
            "config": {"text": "Hello, World!", "typeDelay": 50},
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)
        assert isinstance(typed_config, TypeActionConfig)
        assert typed_config.text == "Hello, World!"
        assert typed_config.type_delay == 50


class TestCompleteConfigExport:
    """Test complete configuration export with multiple workflows and actions."""

    def test_complete_workflow_validates(self):
        """Test a complete realistic workflow validates correctly."""
        workflow_data = {
            "id": "complete_workflow",
            "name": "Complete Login Workflow",
            "version": "1.0.0",
            "format": "graph",
            "actions": [
                {
                    "id": "find_username",
                    "type": "FIND",
                    "name": "Find Username Field",
                    "config": {
                        "target": {
                            "type": "image",
                            "imageId": "img_username_field",
                            "searchOptions": {"similarity": 0.9, "timeout": 5000},
                        }
                    },
                    "position": [100, 100],
                },
                {
                    "id": "click_username",
                    "type": "CLICK",
                    "name": "Click Username Field",
                    "config": {
                        "target": {"type": "currentPosition"},
                        "mouseButton": "LEFT",
                        "numberOfClicks": 1,
                    },
                    "position": [200, 100],
                },
                {
                    "id": "type_username",
                    "type": "TYPE",
                    "name": "Type Username",
                    "config": {"text": "testuser", "interval": 50},
                    "position": [300, 100],
                },
                {
                    "id": "find_password",
                    "type": "FIND",
                    "name": "Find Password Field",
                    "config": {
                        "target": {"type": "image", "imageId": "img_password_field"}
                    },
                    "position": [100, 200],
                },
                {
                    "id": "click_password",
                    "type": "CLICK",
                    "name": "Click Password Field",
                    "config": {"target": {"type": "currentPosition"}},
                    "position": [200, 200],
                },
                {
                    "id": "type_password",
                    "type": "TYPE",
                    "name": "Type Password",
                    "config": {"text": "password123", "interval": 50},
                    "position": [300, 200],
                },
                {
                    "id": "find_submit",
                    "type": "FIND",
                    "name": "Find Submit Button",
                    "config": {
                        "target": {
                            "type": "text",
                            "text": "Login",
                            "textOptions": {
                                "ocrEngine": "TESSERACT",
                                "caseSensitive": False,
                            },
                        }
                    },
                    "position": [100, 300],
                },
                {
                    "id": "click_submit",
                    "type": "CLICK",
                    "name": "Click Submit Button",
                    "config": {"target": {"type": "currentPosition"}},
                    "position": [200, 300],
                },
            ],
            "connections": {
                "find_username": {
                    "main": [[{"action": "click_username", "type": "main", "index": 0}]]
                },
                "click_username": {
                    "main": [[{"action": "type_username", "type": "main", "index": 0}]]
                },
                "type_username": {
                    "main": [[{"action": "find_password", "type": "main", "index": 0}]]
                },
                "find_password": {
                    "main": [[{"action": "click_password", "type": "main", "index": 0}]]
                },
                "click_password": {
                    "main": [[{"action": "type_password", "type": "main", "index": 0}]]
                },
                "type_password": {
                    "main": [[{"action": "find_submit", "type": "main", "index": 0}]]
                },
                "find_submit": {
                    "main": [[{"action": "click_submit", "type": "main", "index": 0}]]
                },
                "click_submit": {"main": []},
            },
            "metadata": {
                "author": "Test Suite",
                "description": "Complete login automation workflow",
                "created": "2025-01-01T00:00:00Z",
            },
            "variables": {"local": {"username": "testuser", "password": "password123"}},
            "settings": {"timeout": 30000, "retryCount": 3, "continueOnError": False},
        }

        # Validate the entire workflow
        workflow = Workflow.model_validate(workflow_data)

        # Verify structure
        assert workflow.id == "complete_workflow"
        assert workflow.format == "graph"
        assert len(workflow.actions) == 8

        # Verify all actions validate
        for action in workflow.actions:
            typed_config = get_typed_config(action)
            assert typed_config is not None

        # Verify connections structure
        assert len(workflow.connections.root) == 8
        assert len(workflow.connections.get_connections("find_username", "main")) == 1
        assert len(workflow.connections.get_connections("click_submit", "main")) == 0

    def test_multiple_workflows_validate(self):
        """Test multiple workflows in a configuration."""
        workflows_data = [
            {
                "id": "workflow_1",
                "name": "Workflow 1",
                "version": "1.0.0",
                "format": "graph",
                "actions": [
                    {
                        "id": "action_1",
                        "type": "CLICK",
                        "config": {"target": {"type": "currentPosition"}},
                        "position": [100, 100],
                    }
                ],
                "connections": {"action_1": {"main": []}},
            },
            {
                "id": "workflow_2",
                "name": "Workflow 2",
                "version": "1.0.0",
                "format": "graph",
                "actions": [
                    {
                        "id": "action_2",
                        "type": "TYPE",
                        "config": {"text": "test", "interval": 50},
                        "position": [200, 200],
                    }
                ],
                "connections": {"action_2": {"main": []}},
            },
        ]

        # Validate each workflow
        for workflow_data in workflows_data:
            workflow = Workflow.model_validate(workflow_data)
            assert workflow.format == "graph"
            assert len(workflow.actions) == 1


class TestBackwardCompatibility:
    """Test handling of legacy formats and backward compatibility."""

    def test_camel_case_field_names(self):
        """Test that camelCase field names are handled correctly."""
        # Pydantic models use populate_by_name to support both snake_case and camelCase
        action_data = {
            "id": "action_compat",
            "type": "FIND",
            "config": {
                "target": {
                    "type": "image",
                    "imageId": "img_1",  # camelCase
                    "searchOptions": {
                        "similarity": 0.9,
                        "maxMatchesToActOn": 3,  # camelCase
                    },
                }
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)
        assert typed_config.target.image_id == "img_1"
        assert typed_config.target.search_options.max_matches_to_act_on == 3

    def test_snake_case_field_names(self):
        """Test that snake_case field names are also supported."""
        action_data = {
            "id": "action_snake",
            "type": "FIND",
            "config": {
                "target": {
                    "type": "image",
                    "image_id": "img_2",  # snake_case
                    "search_options": {
                        "similarity": 0.85,
                        "max_matches_to_act_on": 5,  # snake_case
                    },
                }
            },
        }

        action = Action.model_validate(action_data)
        typed_config = get_typed_config(action)
        assert typed_config.target.image_id == "img_2"
        assert typed_config.target.search_options.max_matches_to_act_on == 5


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_action_with_minimal_config(self):
        """Test action with only required fields."""
        action_data = {
            "id": "minimal",
            "type": "CLICK",
            "config": {"target": {"type": "currentPosition"}},
        }

        action = Action.model_validate(action_data)
        assert action.id == "minimal"
        assert action.type == "CLICK"

    def test_workflow_with_empty_actions(self):
        """Test workflow with no actions."""
        workflow_data = {
            "id": "empty_workflow",
            "name": "Empty Workflow",
            "version": "1.0.0",
            "format": "graph",
            "actions": [],
            "connections": {},
        }

        workflow = Workflow.model_validate(workflow_data)
        assert len(workflow.actions) == 0

    def test_action_with_null_optional_fields(self):
        """Test that null optional fields are handled correctly."""
        action_data = {
            "id": "null_fields",
            "type": "FIND",
            "name": None,  # Optional field
            "config": {
                "target": {
                    "type": "image",
                    "imageId": "img_1",
                    "searchOptions": None,  # Optional field
                }
            },
            "position": None,  # Optional field
        }

        action = Action.model_validate(action_data)
        assert action.name is None
        assert action.position is None
