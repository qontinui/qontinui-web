"""
Dataset processing service for image import and storage operations.

Handles dataset import from ZIP files, image hashing, and storage operations.
"""

import hashlib
import io
import json
import os
import zipfile
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from app.models.training_dataset import (AnnotationSource, DatasetSource,
                                         ElementType, TrainingDataset,
                                         TrainingDatasetAnnotation,
                                         TrainingDatasetImage)
from app.repositories.training_dataset import TrainingDatasetRepository
from app.services.object_storage import object_storage
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class DatasetProcessingService:
    """Service for processing and importing dataset images."""

    @staticmethod
    def compute_image_hash(content: bytes) -> str:
        """Compute SHA256 hash of image content."""
        return hashlib.sha256(content).hexdigest()

    @staticmethod
    async def import_from_zip(
        db: AsyncSession,
        file_content: bytes,
        name: str,
        created_by_id: UUID,
        description: str | None = None,
    ) -> dict[str, Any]:
        """
        Import a training dataset from a ZIP file.

        The ZIP file should contain:
        - manifest.jsonl: Line-delimited JSON with image metadata
        - images/: Directory containing image files
        - annotations/: Directory containing annotation JSON files
        - metadata.json (optional): Export metadata

        Returns:
            Dictionary with dataset_id, images_imported, annotations_imported,
            warnings, and errors.
        """
        warnings: list[str] = []
        errors: list[str] = []
        images_imported = 0
        annotations_imported = 0

        # Create dataset
        dataset = TrainingDataset(
            name=name,
            description=description,
            source=DatasetSource.RUNNER_EXPORT,
            created_by_id=created_by_id,
        )
        db.add(dataset)
        await db.flush()

        try:
            with zipfile.ZipFile(io.BytesIO(file_content), "r") as zf:
                names = zf.namelist()

                # Find manifest
                manifest_path: str | None = None
                for n in names:
                    if n.endswith("manifest.jsonl"):
                        manifest_path = n
                        break

                if not manifest_path:
                    raise ValueError("ZIP file must contain manifest.jsonl")

                # Read metadata if present
                metadata_path: str | None = None
                for n in names:
                    if n.endswith("metadata.json"):
                        metadata_path = n
                        break

                if metadata_path:
                    with zf.open(metadata_path) as mf:
                        metadata = json.load(mf)
                        dataset.export_metadata = metadata
                        dataset.dataset_version = metadata.get("version")

                # Process manifest
                with zf.open(manifest_path) as mf:
                    for line in mf:
                        result = await DatasetProcessingService._process_manifest_entry(
                            db=db,
                            dataset=dataset,
                            entry_line=line,
                            zf=zf,
                            names=names,
                        )
                        if result["success"]:
                            images_imported += result["images"]
                            annotations_imported += result["annotations"]
                        if result.get("warning"):
                            warnings.append(result["warning"])
                        if result.get("error"):
                            errors.append(result["error"])

            # Update stats
            dataset.total_images = images_imported  # type: ignore[assignment]
            dataset.total_annotations = annotations_imported  # type: ignore[assignment]

            await db.commit()

            return {
                "dataset_id": str(dataset.id),
                "images_imported": images_imported,
                "annotations_imported": annotations_imported,
                "warnings": warnings,
                "errors": errors,
            }

        except zipfile.BadZipFile:
            await db.rollback()
            raise ValueError("Invalid ZIP file")
        except Exception as e:
            await db.rollback()
            logger.error("import_failed", error=str(e))
            raise

    @staticmethod
    async def _process_manifest_entry(
        db: AsyncSession,
        dataset: TrainingDataset,
        entry_line: bytes,
        zf: zipfile.ZipFile,
        names: list[str],
    ) -> dict[str, Any]:
        """Process a single manifest entry."""
        result: dict[str, Any] = {
            "success": False,
            "images": 0,
            "annotations": 0,
            "warning": None,
            "error": None,
        }

        try:
            entry = json.loads(entry_line.decode("utf-8"))

            # Find image file
            image_filename = entry.get("image_path", entry.get("filename"))
            if not image_filename:
                result["warning"] = f"Entry missing image_path: {entry}"
                return result

            # Try to find the image in the ZIP
            image_path: str | None = None
            for n in names:
                if n.endswith(image_filename) or n.endswith(
                    os.path.basename(image_filename)
                ):
                    image_path = n
                    break

            if not image_path:
                result["warning"] = f"Image not found in ZIP: {image_filename}"
                return result

            # Read image
            with zf.open(image_path) as img_file:
                image_content = img_file.read()

            # Compute hash
            image_hash = DatasetProcessingService.compute_image_hash(image_content)

            # Check if image already exists in this dataset
            existing = await TrainingDatasetRepository.get_image_by_hash(
                db,
                dataset.id,  # type: ignore[arg-type]
                image_hash,
            )
            if existing:
                result["warning"] = f"Duplicate image skipped: {image_filename}"
                return result

            # Upload to storage
            storage_key = f"training-datasets/{dataset.id}/{image_hash}/{os.path.basename(image_filename)}"
            object_storage.backend.upload_file(
                file_obj=io.BytesIO(image_content),
                key=storage_key,
                content_type="image/png",
            )

            # Get image dimensions (would need PIL in production)
            width = entry.get("width", 1920)
            height = entry.get("height", 1080)

            # Create image record
            image = TrainingDatasetImage(
                dataset_id=dataset.id,
                image_hash=image_hash,
                filename=os.path.basename(image_filename),
                width=width,
                height=height,
                storage_path=storage_key,
                action_id=entry.get("action_id"),
                action_type=entry.get("action_type"),
                active_states=entry.get("active_states"),
                timestamp=(
                    datetime.fromisoformat(entry["timestamp"])
                    if entry.get("timestamp")
                    else None
                ),
            )
            db.add(image)
            await db.flush()
            result["images"] = 1

            # Process annotations
            annotation_filename = entry.get("annotation_path")
            if annotation_filename:
                ann_count = await DatasetProcessingService._process_annotations(
                    db=db,
                    dataset=dataset,
                    image=image,
                    annotation_filename=annotation_filename,
                    zf=zf,
                    names=names,
                )
                result["annotations"] = ann_count

            result["success"] = True
            return result

        except json.JSONDecodeError as e:
            result["warning"] = f"Invalid JSON in manifest line: {str(e)}"
            return result
        except Exception as e:
            result["warning"] = f"Error processing entry: {str(e)}"
            return result

    @staticmethod
    async def _process_annotations(
        db: AsyncSession,
        dataset: TrainingDataset,
        image: TrainingDatasetImage,
        annotation_filename: str,
        zf: zipfile.ZipFile,
        names: list[str],
    ) -> int:
        """Process annotations for an image."""
        annotations_imported = 0

        # Find annotation file
        ann_path: str | None = None
        for n in names:
            if n.endswith(annotation_filename) or n.endswith(
                os.path.basename(annotation_filename)
            ):
                ann_path = n
                break

        if not ann_path:
            return 0

        with zf.open(ann_path) as ann_file:
            ann_data = json.load(ann_file)

            for ann in ann_data.get(
                "annotations", [ann_data] if "bbox" in ann_data else []
            ):
                bbox = ann.get("bbox", ann.get("bounding_box", {}))
                x: float
                y: float
                w: float
                h: float
                if isinstance(bbox, dict):
                    x = bbox.get("x", 0)
                    y = bbox.get("y", 0)
                    w = bbox.get("width", 50)
                    h = bbox.get("height", 50)
                elif isinstance(bbox, list) and len(bbox) >= 4:
                    x, y, w, h = bbox[:4]
                else:
                    continue

                # Parse source
                source_str = ann.get("source", "user_click")
                try:
                    source = AnnotationSource(source_str)
                except ValueError:
                    source = AnnotationSource.USER_CLICK

                # Parse element type
                element_type_str = ann.get("element_type")
                element_type: ElementType | None = None
                if element_type_str:
                    try:
                        element_type = ElementType(element_type_str)
                    except ValueError:
                        element_type = ElementType.UNKNOWN

                annotation = TrainingDatasetAnnotation(
                    dataset_id=dataset.id,
                    image_id=image.id,
                    x=int(x),
                    y=int(y),
                    width=int(w),
                    height=int(h),
                    category_id=ann.get("category_id", 1),
                    category_name=ann.get("category_name", "gui_element"),
                    confidence=ann.get("confidence", 1.0),
                    source=source,
                    element_type=element_type,
                    verified=ann.get("verified", False),
                    inference_metadata=ann.get("inference_metadata"),
                )
                db.add(annotation)
                annotations_imported += 1

        return annotations_imported

    @staticmethod
    def get_image_file(
        storage_path: str,
    ) -> bytes:
        """Get image file content from storage."""
        return object_storage.backend.download_file(storage_path)  # type: ignore[return-value]

    @staticmethod
    def delete_image_file(storage_path: str) -> bool:
        """Delete image file from storage."""
        try:
            object_storage.backend.delete_file(storage_path)
            return True
        except Exception as e:
            logger.warning(
                "failed_to_delete_image_file", path=storage_path, error=str(e)
            )
            return False

    @staticmethod
    async def delete_all_images_for_dataset(
        db: AsyncSession,
        dataset_id: str,
    ) -> None:
        """Delete all image files for a dataset from storage."""
        images = await TrainingDatasetRepository.get_all_images(db, dataset_id)
        for image in images:
            DatasetProcessingService.delete_image_file(image.storage_path)  # type: ignore[arg-type]


# Singleton instance
dataset_processing_service = DatasetProcessingService()
