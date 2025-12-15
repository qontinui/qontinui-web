"""Tests for JSON configuration validator."""


from app.services.json_validator import JSONConfigValidator


def _make_minimal_config(
    states: list | None = None,
    images: list | None = None,
    workflows: list | None = None,
    transitions: list | None = None,
) -> dict:
    """Create a minimal valid configuration for testing."""
    return {
        "version": "1.0.0",
        "metadata": {
            "name": "Test Config",
            "created": "2025-01-01T00:00:00Z",
            "modified": "2025-01-01T00:00:00Z",
        },
        "images": images or [],
        "workflows": workflows or [],
        "states": states or [],
        "transitions": transitions or [],
        "categories": [],
        "settings": {},
    }


def _make_image(image_id: str, name: str = "test.png") -> dict:
    """Create a minimal valid image."""
    return {
        "id": image_id,
        "name": name,
        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "format": "png",
        "width": 1,
        "height": 1,
    }


def _make_state(
    state_id: str,
    name: str,
    identifying_images: list | None = None,
    is_initial: bool = False,
) -> dict:
    """Create a minimal valid state."""
    return {
        "id": state_id,
        "name": name,
        "identifyingImages": identifying_images or [],
        "position": {"x": 0, "y": 0},
        "isInitial": is_initial,
    }


def _make_state_image(image_id: str, threshold: float = 0.9) -> dict:
    """Create a state image reference."""
    return {
        "imageId": image_id,
        "threshold": threshold,
        "required": True,
        "tags": [],
    }


def _make_workflow(workflow_id: str, name: str) -> dict:
    """Create a minimal valid workflow."""
    return {
        "id": workflow_id,
        "name": name,
        "version": "1.0.0",
        "format": "graph",
        "actions": [],
        "connections": {},
    }


def _make_transition(
    transition_id: str,
    name: str,
    from_state: str | None = None,
    to_state: str | None = None,
    processes: list | None = None,
) -> dict:
    """Create a minimal valid transition."""
    return {
        "id": transition_id,
        "type": "OutgoingTransition",
        "name": name,
        "processes": processes or [],
        "fromState": from_state,
        "toState": to_state,
        "activateStates": [],
        "deactivateStates": [],
    }


class TestStateValidation:
    """Test state validation logic."""

    def test_state_with_identifying_images_is_valid(self):
        """Test that a state with identifying images passes validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            states=[
                _make_state(
                    "state_1",
                    "Login Screen",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=True,
                )
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is True
        assert len(result.errors) == 0

    def test_state_without_identifying_images_fails_validation(self):
        """Test that a state without identifying images fails validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            states=[
                _make_state(
                    "state_1",
                    "Empty State",
                    identifying_images=[],
                    is_initial=True,
                )
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("no identifying images" in error for error in result.errors)
        assert any("Empty State" in error for error in result.errors)

    def test_multiple_states_without_images_reports_all_errors(self):
        """Test that all states without images are reported."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            states=[
                _make_state(
                    "state_1", "State One", identifying_images=[], is_initial=True
                ),
                _make_state("state_2", "State Two", identifying_images=[]),
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        # Should have two errors, one for each state
        state_errors = [e for e in result.errors if "no identifying images" in e]
        assert len(state_errors) == 2
        assert any("State One" in error for error in state_errors)
        assert any("State Two" in error for error in state_errors)

    def test_state_with_nonexistent_image_reference_fails(self):
        """Test that referencing a non-existent image fails validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[],  # No images
            states=[
                _make_state(
                    "state_1",
                    "State with Bad Reference",
                    identifying_images=[_make_state_image("nonexistent_img")],
                    is_initial=True,
                )
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("non-existent image" in error for error in result.errors)

    def test_state_with_invalid_threshold_fails(self):
        """Test that invalid threshold values fail validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            states=[
                _make_state(
                    "state_1",
                    "State with Bad Threshold",
                    identifying_images=[_make_state_image("img_1", threshold=1.5)],
                    is_initial=True,
                )
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("Invalid threshold" in error for error in result.errors)

    def test_duplicate_state_ids_fails(self):
        """Test that duplicate state IDs fail validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            states=[
                _make_state(
                    "state_1",
                    "First State",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=True,
                ),
                _make_state(
                    "state_1",  # Duplicate ID
                    "Second State",
                    identifying_images=[_make_state_image("img_1")],
                ),
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("Duplicate state ID" in error for error in result.errors)

    def test_multiple_initial_states_fails(self):
        """Test that multiple initial states fail validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            states=[
                _make_state(
                    "state_1",
                    "First Initial",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=True,
                ),
                _make_state(
                    "state_2",
                    "Second Initial",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=True,
                ),
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("Multiple initial states" in error for error in result.errors)

    def test_no_initial_state_is_warning(self):
        """Test that no initial state is a warning, not an error."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            states=[
                _make_state(
                    "state_1",
                    "Non-initial State",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=False,
                ),
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is True  # Still valid
        assert any("No initial state" in warning for warning in result.warnings)


class TestTransitionValidation:
    """Test transition validation logic."""

    def test_valid_transition(self):
        """Test that a valid transition passes validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            workflows=[_make_workflow("workflow_1", "Test Workflow")],
            states=[
                _make_state(
                    "state_1",
                    "From State",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=True,
                ),
                _make_state(
                    "state_2",
                    "To State",
                    identifying_images=[_make_state_image("img_1")],
                ),
            ],
            transitions=[
                _make_transition(
                    "trans_1",
                    "Test Transition",
                    from_state="state_1",
                    to_state="state_2",
                    processes=["workflow_1"],
                )
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is True

    def test_transition_with_nonexistent_workflow_fails(self):
        """Test that referencing a non-existent workflow fails."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            workflows=[],  # No workflows
            states=[
                _make_state(
                    "state_1",
                    "State",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=True,
                ),
            ],
            transitions=[
                _make_transition(
                    "trans_1",
                    "Bad Transition",
                    processes=["nonexistent_workflow"],
                )
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("non-existent workflow" in error for error in result.errors)

    def test_transition_with_nonexistent_state_fails(self):
        """Test that referencing a non-existent state fails."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
            states=[
                _make_state(
                    "state_1",
                    "Existing State",
                    identifying_images=[_make_state_image("img_1")],
                    is_initial=True,
                ),
            ],
            transitions=[
                _make_transition(
                    "trans_1",
                    "Bad Transition",
                    from_state="state_1",
                    to_state="nonexistent_state",
                )
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("non-existent toState" in error for error in result.errors)


class TestWorkflowValidation:
    """Test workflow validation logic."""

    def test_valid_workflow(self):
        """Test that a valid workflow passes validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            workflows=[_make_workflow("workflow_1", "Test Workflow")],
        )

        result = validator.validate_configuration(config)

        assert result.valid is True

    def test_workflow_with_invalid_format_fails(self):
        """Test that non-graph format fails validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            workflows=[
                {
                    "id": "workflow_1",
                    "name": "Bad Workflow",
                    "version": "1.0.0",
                    "format": "sequential",  # Invalid
                    "actions": [],
                    "connections": {},
                }
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("Invalid workflow format" in error for error in result.errors)

    def test_orphaned_workflow_is_warning(self):
        """Test that unused workflow is a warning, not an error."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            workflows=[_make_workflow("orphan_workflow", "Orphan")],
            transitions=[],  # No transitions use the workflow
        )

        result = validator.validate_configuration(config)

        assert result.valid is True  # Still valid
        assert any("Orphaned workflows" in warning for warning in result.warnings)


class TestImageValidation:
    """Test image validation logic."""

    def test_valid_image(self):
        """Test that a valid image passes validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[_make_image("img_1")],
        )

        result = validator.validate_configuration(config)

        assert result.valid is True

    def test_duplicate_image_ids_fails(self):
        """Test that duplicate image IDs fail validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[
                _make_image("img_1", "first.png"),
                _make_image("img_1", "second.png"),  # Duplicate ID
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("Duplicate image ID" in error for error in result.errors)

    def test_unsupported_image_format_fails(self):
        """Test that unsupported image format fails validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config(
            images=[
                {
                    "id": "img_1",
                    "name": "test.webp",
                    "data": "dGVzdA==",
                    "format": "webp",  # Unsupported
                    "width": 1,
                    "height": 1,
                }
            ],
        )

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("Unsupported image format" in error for error in result.errors)


class TestVersionValidation:
    """Test version validation logic."""

    def test_supported_version(self):
        """Test that supported version passes validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config()

        result = validator.validate_configuration(config)

        assert result.valid is True

    def test_unsupported_version_fails(self):
        """Test that unsupported version fails validation."""
        validator = JSONConfigValidator()
        config = _make_minimal_config()
        config["version"] = "99.0.0"

        result = validator.validate_configuration(config)

        assert result.valid is False
        assert any("Unsupported version" in error for error in result.errors)
