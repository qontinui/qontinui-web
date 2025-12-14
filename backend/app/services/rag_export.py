"""Service for exporting projects in RAG-optimized format.

This service converts project configurations into a format optimized for
vector databases and LLM-based automation with retrieval augmentation.
"""

import hashlib
from datetime import UTC, datetime
from typing import Any

import httpx

from app.models.project import Project
from app.models.user import User
from app.schemas.rag_export import (
    BoundingBox,
    EmbeddingConfig,
    RAGAction,
    RAGConfigExport,
    RAGElement,
    RAGExportRequest,
    RAGMetadata,
    RAGState,
    RAGTransition,
    RAGWorkflow,
    TransferStatus,
)


class RAGExportService:
    """
    Service for exporting project configurations in RAG-optimized format.

    Converts standard Qontinui configurations into a format suitable for:
    - Vector database indexing (Chroma, Pinecone, etc.)
    - Semantic search over UI elements
    - LLM-based automation with retrieval
    """

    def __init__(self) -> None:
        """Initialize the RAG export service."""
        pass

    async def export_project_as_rag(
        self,
        project: Project,
        user: User,
        request: RAGExportRequest | None = None,
    ) -> RAGConfigExport:
        """
        Export a project configuration in RAG-optimized format.

        Args:
            project: The project to export
            user: The user performing the export
            request: Optional export configuration

        Returns:
            RAG-optimized configuration export

        Raises:
            ValueError: If project configuration is invalid
        """
        if request is None:
            request = RAGExportRequest()

        # Extract configuration from project (handle SQLAlchemy Column types)
        config_data = project.configuration
        if config_data is None:
            config_data = {}
        config: dict[str, Any] = config_data  # type: ignore[assignment]

        # Build embedding configuration
        embedding_config = EmbeddingConfig()
        if request.embedding_model:
            embedding_config.model_name = request.embedding_model

        # Build metadata (extract values from SQLAlchemy model)
        project_name: str = str(project.name)
        project_description: str | None = str(project.description) if project.description else None
        project_created_at: datetime = project.created_at  # type: ignore[assignment]

        metadata = RAGMetadata(
            project_name=project_name,
            project_id=str(project.id),
            description=project_description,
            author=user.username,
            created_at=project_created_at,
            exported_at=datetime.now(UTC),
            target_application=config.get("metadata", {}).get("targetApplication"),
            tags=config.get("metadata", {}).get("tags", []),
            embedding_config=embedding_config,
            version="1.0.0",
        )

        # Convert elements (from images in config)
        elements = self._convert_elements_to_rag(
            config.get("images", []),
            tags_filter=request.tags_filter,
        )

        # Convert states
        states = self._convert_states_to_rag(config.get("states", []))

        # Convert workflows
        workflows = self._convert_workflows_to_rag(config.get("workflows", []))

        # Convert transitions
        transitions = self._convert_transitions_to_rag(config.get("transitions", []))

        return RAGConfigExport(
            metadata=metadata,
            elements=elements,
            states=states,
            workflows=workflows,
            transitions=transitions,
        )

    def _convert_elements_to_rag(
        self,
        images: list[dict[str, Any]],
        tags_filter: list[str] | None = None,
    ) -> list[RAGElement]:
        """
        Convert image data to RAG elements.

        Args:
            images: List of image dictionaries from config
            tags_filter: Only include elements with these tags

        Returns:
            List of RAG elements
        """
        elements: list[RAGElement] = []

        for image in images:
            # Generate hash for deduplication
            element_hash = self._generate_element_hash(image)

            # Extract tags
            tags = image.get("tags", [])
            if tags_filter and not any(tag in tags_filter for tag in tags):
                continue

            # Build bounding box if available
            bounding_box = None
            if "boundingBox" in image:
                bb = image["boundingBox"]
                bounding_box = BoundingBox(
                    x=bb.get("x", 0),
                    y=bb.get("y", 0),
                    width=bb.get("width", 0),
                    height=bb.get("height", 0),
                )

            # Create RAG element (always include image data for automation)
            element = RAGElement(
                element_id=image.get("id", ""),
                element_hash=element_hash,
                element_type=image.get("type", "image"),
                name=image.get("name"),
                description=image.get("description"),
                semantic_tags=tags,
                image_data=image.get("data"),
                bounding_box=bounding_box,
                ocr_text=image.get("ocrText"),
                confidence_score=image.get("confidence"),
                metadata={
                    "width": image.get("width"),
                    "height": image.get("height"),
                    "format": image.get("format"),
                    "original_hash": image.get("hash"),
                },
            )

            elements.append(element)

        return elements

    def _convert_states_to_rag(self, states: list[dict[str, Any]]) -> list[RAGState]:
        """
        Convert state definitions to RAG format.

        Args:
            states: List of state dictionaries from config

        Returns:
            List of RAG states
        """
        rag_states: list[RAGState] = []

        for state in states:
            # Extract identifying element IDs
            identifying_images = state.get("identifyingImages", [])
            identifying_element_ids = [
                img.get("imageId", "") for img in identifying_images
            ]

            # Build semantic context from description and tags
            description = state.get("description", "")
            semantic_context = f"{state.get('name', '')}: {description}"

            rag_state = RAGState(
                state_id=state.get("id", ""),
                name=state.get("name", ""),
                description=description,
                identifying_element_ids=identifying_element_ids,
                is_initial=state.get("isInitial", False),
                is_final=state.get("isFinal", False),
                semantic_context=semantic_context,
                position=state.get("position"),
            )

            rag_states.append(rag_state)

        return rag_states

    def _convert_workflows_to_rag(
        self, workflows: list[dict[str, Any]]
    ) -> list[RAGWorkflow]:
        """
        Convert workflow definitions to RAG format.

        Args:
            workflows: List of workflow dictionaries from config

        Returns:
            List of RAG workflows
        """
        rag_workflows: list[RAGWorkflow] = []

        for workflow in workflows:
            # Convert actions
            actions = self._convert_actions_to_rag(workflow.get("actions", []))

            # Build semantic intent from metadata
            metadata = workflow.get("metadata", {})
            description = metadata.get("description") or workflow.get("description")
            semantic_intent = f"{workflow.get('name', '')}: {description or ''}"

            rag_workflow = RAGWorkflow(
                workflow_id=workflow.get("id", ""),
                name=workflow.get("name", ""),
                description=description,
                category=workflow.get("category"),
                actions=actions,
                initial_state_ids=workflow.get("initialStateIds", []),
                semantic_intent=semantic_intent,
                tags=workflow.get("tags", []),
                version=workflow.get("version", "1.0.0"),
            )

            rag_workflows.append(rag_workflow)

        return rag_workflows

    def _convert_actions_to_rag(self, actions: list[dict[str, Any]]) -> list[RAGAction]:
        """
        Convert action definitions to RAG format.

        Args:
            actions: List of action dictionaries

        Returns:
            List of RAG actions
        """
        rag_actions: list[RAGAction] = []

        for action in actions:
            config = action.get("config", {})

            # Extract target element ID if available
            target_element_id = config.get("imageId") or config.get("targetImageId")

            # Build description from action type and config
            action_type = action.get("type", "")
            description = self._build_action_description(action_type, config)

            execution = action.get("execution", {})

            rag_action = RAGAction(
                action_id=action.get("id", ""),
                action_type=action_type,
                name=action.get("name"),
                target_element_id=target_element_id,
                config=config,
                description=description,
                timeout=execution.get("timeout"),
                retry_count=execution.get("retryCount"),
            )

            rag_actions.append(rag_action)

        return rag_actions

    def _convert_transitions_to_rag(
        self, transitions: list[dict[str, Any]]
    ) -> list[RAGTransition]:
        """
        Convert transition definitions to RAG format.

        Args:
            transitions: List of transition dictionaries

        Returns:
            List of RAG transitions
        """
        rag_transitions: list[RAGTransition] = []

        for transition in transitions:
            rag_transition = RAGTransition(
                transition_id=transition.get("id", ""),
                transition_type=transition.get("type", ""),
                name=transition.get("name", ""),
                description=transition.get("description"),
                from_state_id=transition.get("fromState"),
                to_state_id=transition.get("toState"),
                trigger_element_ids=[],  # Could be extracted from processes
                workflow_ids=transition.get("processes", []),
                activate_state_ids=transition.get("activateStates", []),
                deactivate_state_ids=transition.get("deactivateStates", []),
                stays_visible=transition.get("staysVisible", False),
                timeout=transition.get("timeout", 10000),
                retry_count=transition.get("retryCount", 3),
            )

            rag_transitions.append(rag_transition)

        return rag_transitions

    def _generate_element_hash(self, image: dict[str, Any]) -> str:
        """
        Generate SHA-256 hash for an element.

        Args:
            image: Image dictionary

        Returns:
            SHA-256 hash string
        """
        # Use existing hash if available
        if "hash" in image:
            hash_value: str = str(image["hash"])
            return hash_value

        # Generate hash from image data
        if "data" in image:
            return hashlib.sha256(image["data"].encode()).hexdigest()

        # Fallback to ID-based hash
        return hashlib.sha256(image.get("id", "").encode()).hexdigest()

    def _build_action_description(
        self, action_type: str, config: dict[str, Any]
    ) -> str:
        """
        Build natural language description of an action.

        Args:
            action_type: Type of action
            config: Action configuration

        Returns:
            Natural language description
        """
        descriptions = {
            "click": f"Click on the element at location {config.get('location', 'unknown')}",
            "type": f"Type text: {config.get('text', '')}",
            "wait": f"Wait for {config.get('duration', 0)}ms",
            "navigate": f"Navigate to URL: {config.get('url', '')}",
            "scroll": f"Scroll {config.get('direction', 'down')} by {config.get('amount', 0)} pixels",
            "hover": "Hover over the element",
            "drag": f"Drag from {config.get('from', '')} to {config.get('to', '')}",
            "screenshot": "Capture screenshot",
            "assert": f"Assert condition: {config.get('condition', '')}",
        }

        return descriptions.get(
            action_type, f"Execute {action_type} action with config: {config}"
        )

    async def transfer_to_runner(
        self,
        project_id: str,
        runner_url: str,
        config: RAGConfigExport,
        timeout: int = 30,
    ) -> TransferStatus:
        """
        Transfer RAG configuration to a connected runner.

        Args:
            project_id: Project ID
            runner_url: Runner HTTP endpoint URL
            config: RAG configuration to transfer
            timeout: HTTP timeout in seconds

        Returns:
            Transfer status result
        """
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                # Prepare payload
                payload = {
                    "project_id": project_id,
                    "config": config.model_dump(mode="json"),
                    "config_type": "rag",
                }

                # Send to runner
                response = await client.post(
                    f"{runner_url}/api/load-rag-config",
                    json=payload,
                )

                if response.status_code == 200:
                    return TransferStatus(
                        success=True,
                        message="RAG configuration transferred successfully",
                        runner_url=runner_url,
                        transferred_at=datetime.now(UTC),
                    )
                else:
                    return TransferStatus(
                        success=False,
                        message=f"Transfer failed with status {response.status_code}",
                        runner_url=runner_url,
                        error_details=response.text,
                    )

        except httpx.TimeoutException:
            return TransferStatus(
                success=False,
                message="Transfer timed out",
                runner_url=runner_url,
                error_details=f"Request exceeded {timeout}s timeout",
            )
        except httpx.RequestError as e:
            return TransferStatus(
                success=False,
                message="Transfer failed due to network error",
                runner_url=runner_url,
                error_details=str(e),
            )
        except Exception as e:
            return TransferStatus(
                success=False,
                message="Transfer failed due to unexpected error",
                runner_url=runner_url,
                error_details=str(e),
            )
