"""Embedding results processing for RAG builder.

This module handles the processing and storage of embedding results
from the runner, including job creation and project embedding storage.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.project import get_project, update_project
from app.models.embedding_generation_job import EmbeddingGenerationJob
from app.models.project_embedding import ProjectEmbedding
from app.schemas.project import ProjectUpdate
from app.services.embedding_service import apply_embedding_results_to_config

logger = structlog.get_logger(__name__)


class EmbeddingProcessor:
    """
    Processes embedding results from the runner and stores them.

    This class handles:
    - Creating job records for processing history
    - Applying embeddings to project configuration
    - Storing embeddings in the project_embeddings table for RAG Dashboard
    """

    async def process_embedding_results(
        self,
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        results: list[dict[str, Any]],
        total_processed: int,
        successful: int,
        failed: int,
        extract_dimensions_fn: Callable[[str], tuple[int, int] | None] | None = None,
    ) -> dict[str, Any]:
        """
        Process embedding results from the runner and store them.

        This method:
        1. Creates a job record for tracking in the Processing History tab
        2. Applies embeddings to the project configuration
        3. Stores embeddings in the project_embeddings table for RAG Dashboard

        Args:
            db: Database session
            project_id: Project ID
            user_id: User who triggered the processing
            results: List of embedding results from runner
            total_processed: Total count processed by runner
            successful: Successful count from runner
            failed: Failed count from runner
            extract_dimensions_fn: Optional function to extract image dimensions from data URLs

        Returns:
            Dict with applied count, failed count, and stored embeddings count
        """
        # Get project and config
        project = await get_project(db, project_id)
        if not project:
            raise ValueError("Project not found")

        config_data = project.configuration
        if config_data is None:
            config_data = {}
        config: dict[str, Any] = config_data  # type: ignore[assignment]

        # Create job record
        successful_count = sum(1 for r in results if r.get("success"))
        failed_count = len(results) - successful_count

        job = EmbeddingGenerationJob(
            project_id=project_id,
            user_id=user_id,
            status="completed",
            total_patterns=len(results),
            processed_patterns=successful_count,
            error_message=(
                f"{failed_count} embeddings failed" if failed_count > 0 else None
            ),
            job_metadata={
                "source": "runner",
                "embedding_model": "clip-vit-base-patch32",
                "embedding_version": "1.0.0",
                "total_received": total_processed,
                "successful": successful,
                "failed": failed,
            },
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
        )
        db.add(job)
        logger.info(
            "embedding_job_created",
            project_id=str(project_id),
            job_id=str(job.id) if job.id else "pending",
            total_patterns=len(results),
            successful=successful_count,
            failed=failed_count,
        )

        # Apply embedding results to config
        apply_result = apply_embedding_results_to_config(config, results)

        # Update project configuration in database
        project_update = ProjectUpdate(configuration=config)
        await update_project(db, project, project_update)

        # Store embeddings in project_embeddings table
        embeddings_stored = await self._store_project_embeddings(
            db, project_id, config, results, extract_dimensions_fn
        )

        await db.commit()

        logger.info(
            "embedding_results_processed",
            project_id=str(project_id),
            applied=apply_result["successful"],
            failed=apply_result["failed"],
            not_found=apply_result["not_found"],
            embeddings_stored=embeddings_stored,
        )

        return {
            "applied": apply_result["successful"],
            "failed": apply_result["failed"],
            "not_found": apply_result["not_found"],
            "embeddings_stored": embeddings_stored,
        }

    async def _store_project_embeddings(
        self,
        db: AsyncSession,
        project_id: UUID,
        config: dict[str, Any],
        results: list[dict[str, Any]],
        extract_dimensions_fn: Callable[[str], tuple[int, int] | None] | None = None,
    ) -> int:
        """
        Store embeddings in the ProjectEmbedding table for RAG Dashboard.

        Args:
            db: Database session
            project_id: Project ID
            config: Project configuration
            results: Embedding results from runner
            extract_dimensions_fn: Optional function to extract dimensions from data URLs

        Returns:
            Number of embeddings stored
        """
        # Build lookups for state and image metadata
        state_lookup: dict[str, dict[str, Any]] = {}
        state_image_lookup: dict[str, tuple[str, str, dict[str, Any]]] = {}
        image_lookup: dict[str, dict[str, Any]] = {}

        for state in config.get("states", []):
            state_id = state.get("id", "")
            state_name = state.get("name", "Unknown State")
            state_lookup[state_id] = state
            for state_image in state.get("stateImages", []):
                state_image_id = state_image.get("id")
                if state_image_id:
                    state_image_lookup[state_image_id] = (
                        state_id,
                        state_name,
                        state_image,
                    )

        for image in config.get("images", []):
            image_id = image.get("id")
            if image_id:
                image_lookup[image_id] = image

        # Delete existing embeddings for this project (replace with new ones)
        await db.execute(
            delete(ProjectEmbedding).where(ProjectEmbedding.project_id == project_id)
        )

        embeddings_stored = 0
        for result in results:
            if not result.get("success") or not result.get("image_embedding"):
                continue

            state_image_id = result.get("state_image_id")
            if state_image_id not in state_image_lookup:
                continue

            state_id, state_name, state_image = state_image_lookup[state_image_id]

            # Get pattern info from the first pattern in stateImage
            patterns = state_image.get("patterns", [])
            if not patterns:
                continue

            first_pattern = patterns[0]
            pattern_id = first_pattern.get("id", state_image_id)
            pattern_name = first_pattern.get("name") or state_image.get("name")
            image_id = first_pattern.get("imageId", "")

            # Get image data from image lookup
            image_data = image_lookup.get(image_id, {})
            image_width = image_data.get("width", 0)
            image_height = image_data.get("height", 0)

            # Get image storage path - prefer S3 keys
            image_storage_path = self._get_image_storage_path(
                image_data, image_id, extract_dimensions_fn
            )
            if image_storage_path.get("width"):
                image_width = image_width or image_storage_path["width"]
            if image_storage_path.get("height"):
                image_height = image_height or image_storage_path["height"]

            if not image_storage_path.get("path"):
                logger.warning(
                    "embedding_missing_storage_path",
                    project_id=str(project_id),
                    image_id=image_id,
                    pattern_id=pattern_id,
                )
                continue

            # Generate text description if not provided
            text_description = result.get("text_description")
            if not text_description and (pattern_name or result.get("ocr_text")):
                text_description = self._build_text_description(
                    pattern_name, result.get("ocr_text")
                )

            # Create ProjectEmbedding record
            embedding = ProjectEmbedding(
                project_id=project_id,
                pattern_id=pattern_id,
                pattern_name=pattern_name,
                state_id=state_id,
                state_name=state_name,
                image_id=image_id,
                image_storage_path=image_storage_path["path"],
                embedding=result.get("image_embedding"),
                text_embedding=result.get("text_embedding"),
                text_description=text_description,
                embedding_model="clip-vit-base-patch32",
                embedding_version="1.0.0",
                pattern_metadata={
                    "state_image_id": state_image_id,
                    "search_mode": state_image.get("searchMode", "default"),
                    "ocr_text": result.get("ocr_text"),
                    "ocr_confidence": result.get("ocr_confidence"),
                },
                image_width=image_width or 100,
                image_height=image_height or 100,
            )
            db.add(embedding)
            embeddings_stored += 1

        return embeddings_stored

    def _get_image_storage_path(
        self,
        image_data: dict[str, Any],
        image_id: str,
        extract_dimensions_fn: Callable[[str], tuple[int, int] | None] | None = None,
    ) -> dict[str, Any]:
        """
        Get the storage path for an image.

        Args:
            image_data: Image data from config
            image_id: Image ID
            extract_dimensions_fn: Function to extract dimensions from data URLs

        Returns:
            Dict with 'path', optionally 'width' and 'height'
        """
        result: dict[str, Any] = {"path": None}

        # Prefer S3 keys
        image_storage_path = image_data.get("s3_key") or image_data.get("s3Key")

        if not image_storage_path:
            url = image_data.get("url", "")
            if url and not url.startswith("data:"):
                # It's a file path or regular URL
                image_storage_path = url
            elif url.startswith("data:"):
                # Data URL - store a reference instead of the full base64
                image_storage_path = f"inline:{image_id}"

                # Extract dimensions if function provided
                if extract_dimensions_fn:
                    dimensions = extract_dimensions_fn(url)
                    if dimensions:
                        result["width"], result["height"] = dimensions

        result["path"] = image_storage_path
        return result

    def _build_text_description(
        self, pattern_name: str | None, ocr_text: str | None
    ) -> str | None:
        """
        Build a text description from pattern name and OCR text.

        Args:
            pattern_name: Pattern name
            ocr_text: OCR-extracted text

        Returns:
            Built description or None
        """
        parts = []
        if pattern_name:
            # Convert kebab-case/snake_case to readable text
            readable_name = pattern_name.replace("-", " ").replace("_", " ").strip()
            if readable_name:
                parts.append(readable_name)
        if ocr_text:
            ocr_clean = ocr_text.strip()
            if ocr_clean and (
                not pattern_name or ocr_clean.lower() not in pattern_name.lower()
            ):
                parts.append(f'with text "{ocr_clean}"')
        if parts:
            return " ".join(parts)
        return None


# Global instance
embedding_processor = EmbeddingProcessor()
