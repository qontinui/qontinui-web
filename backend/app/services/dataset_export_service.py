"""
Dataset export service for generating ML training format exports.

Handles export to COCO, YOLO, JSONL formats and manages export jobs.
"""

import io
import json
import os
import zipfile
from collections import defaultdict
from typing import Any
from uuid import UUID

import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training_dataset import (
    ExportFormat,
    ExportJobStatus,
    TrainingDataset,
    TrainingDatasetAnnotation,
    TrainingDatasetExportJob,
    TrainingDatasetImage,
)
from app.repositories.training_dataset import TrainingDatasetRepository
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


class DatasetExportService:
    """Service for exporting datasets to ML training formats."""

    @staticmethod
    async def start_export(
        db: AsyncSession,
        dataset: TrainingDataset,
        export_format: ExportFormat,
        created_by_id: UUID,
        include_images: bool = True,
        train_percent: float | None = None,
        val_percent: float | None = None,
        test_percent: float | None = None,
        random_seed: int | None = None,
        filters: dict[str, Any] | None = None,
    ) -> TrainingDatasetExportJob:
        """
        Start an export job for a dataset.

        NOTE: Images are NEVER included in exports to avoid AWS transfer costs.
        Users package local images via qontinui-runner.
        """
        # Create export job
        job = await TrainingDatasetRepository.create_export_job(
            db=db,
            dataset_id=dataset.id,  # type: ignore[arg-type]
            export_format=export_format,
            created_by_id=created_by_id,
            include_images=include_images,
            train_percent=train_percent,
            val_percent=val_percent,
            test_percent=test_percent,
            random_seed=random_seed,
            filters=filters,
        )

        # Process synchronously (in production, use background task/Celery)
        try:
            job.status = ExportJobStatus.PROCESSING
            await db.commit()

            # Generate export
            download_url = await DatasetExportService._generate_export(db, job, dataset)

            job.status = ExportJobStatus.COMPLETED
            job.download_url = download_url  # type: ignore[assignment]
            job.completed_at = utc_now()  # type: ignore[assignment]
            job.progress = 100  # type: ignore[assignment]
            await db.commit()

        except Exception as e:
            job.status = ExportJobStatus.FAILED
            job.error = str(e)  # type: ignore[assignment]
            await db.commit()
            logger.error("export_failed", error=str(e))

        await db.refresh(job)
        return job

    @staticmethod
    async def _generate_export(
        db: AsyncSession,
        job: TrainingDatasetExportJob,
        dataset: TrainingDataset,
    ) -> str:
        """Generate export file and return download URL."""
        # Get all images and annotations
        images = await TrainingDatasetRepository.get_all_images(db, dataset.id)  # type: ignore[arg-type]
        annotations = await TrainingDatasetRepository.get_all_annotations(
            db,
            dataset.id,  # type: ignore[arg-type]
        )

        # Build annotations by image
        annotations_by_image: dict[str, list[TrainingDatasetAnnotation]] = defaultdict(
            list
        )
        for ann in annotations:
            annotations_by_image[str(ann.image_id)].append(ann)

        # Create export based on format
        export_data: Any
        if job.format == ExportFormat.COCO:
            export_data = DatasetExportService._generate_coco_export(
                images, annotations, dataset
            )
        elif job.format == ExportFormat.YOLO:
            export_data = DatasetExportService._generate_yolo_export(
                images, annotations_by_image, dataset
            )
        elif job.format == ExportFormat.JSONL:
            export_data = DatasetExportService._generate_jsonl_export(
                images, annotations_by_image
            )
        else:
            export_data = DatasetExportService._generate_coco_export(
                images, annotations, dataset
            )

        # Create ZIP file
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            if isinstance(export_data, dict):
                zf.writestr("annotations.json", json.dumps(export_data, indent=2))
            elif isinstance(export_data, list):
                for item in export_data:
                    zf.writestr(item["path"], item["content"])

            # Always include image manifest for matching local files
            manifest = DatasetExportService._generate_image_manifest(images, dataset)
            zf.writestr("image_manifest.json", json.dumps(manifest, indent=2))

        # Upload export file
        zip_buffer.seek(0)
        export_key = f"exports/{dataset.id}/{job.id}/export.zip"
        url = object_storage.backend.upload_file(
            file_obj=zip_buffer,
            key=export_key,
            content_type="application/zip",
        )

        return url

    @staticmethod
    def _generate_image_manifest(
        images: list[TrainingDatasetImage],
        dataset: TrainingDataset,
    ) -> dict[str, Any]:
        """Generate manifest to help match local images with annotations."""
        return {
            "version": "1.0",
            "dataset_id": str(dataset.id),
            "dataset_name": dataset.name,
            "export_date": utc_now().isoformat(),
            "total_images": len(images),
            "images": [
                {
                    "filename": img.filename,
                    "image_hash": img.image_hash,
                    "width": img.width,
                    "height": img.height,
                    "action_id": img.action_id,
                    "action_type": img.action_type,
                    "active_states": img.active_states,
                    "timestamp": img.timestamp.isoformat() if img.timestamp else None,
                }
                for img in images
            ],
        }

    @staticmethod
    def _generate_coco_export(
        images: list[TrainingDatasetImage],
        annotations: list[TrainingDatasetAnnotation],
        dataset: TrainingDataset,
    ) -> dict[str, Any]:
        """Generate COCO format export."""
        coco: dict[str, Any] = {
            "info": {
                "description": dataset.name,
                "version": dataset.dataset_version or "1.0",
                "year": utc_now().year,
                "contributor": "qontinui",
                "date_created": utc_now().isoformat(),
            },
            "images": [],
            "annotations": [],
            "categories": [],
        }

        # Build category list
        categories: dict[int, str] = {}
        for ann in annotations:
            cat_id: int = ann.category_id  # type: ignore[assignment]
            cat_name: str = ann.category_name  # type: ignore[assignment]
            if cat_id not in categories:
                categories[cat_id] = cat_name

        coco["categories"] = [
            {"id": cat_id, "name": cat_name, "supercategory": "gui"}
            for cat_id, cat_name in categories.items()
        ]

        # Add images
        image_id_map: dict[str, int] = {}
        for idx, img in enumerate(images):
            image_id = idx + 1
            image_id_map[str(img.id)] = image_id
            coco["images"].append(
                {
                    "id": image_id,
                    "file_name": img.filename,
                    "width": img.width,
                    "height": img.height,
                }
            )

        # Add annotations
        for idx, ann in enumerate(annotations):
            mapped_image_id: int | None = image_id_map.get(str(ann.image_id))
            if not mapped_image_id:
                continue

            coco["annotations"].append(
                {
                    "id": idx + 1,
                    "image_id": mapped_image_id,
                    "category_id": ann.category_id,
                    "bbox": [ann.x, ann.y, ann.width, ann.height],
                    "area": ann.width * ann.height,
                    "iscrowd": 0,
                    "attributes": {
                        "confidence": ann.confidence,
                        "source": (
                            ann.source.value
                            if hasattr(ann.source, "value")
                            else str(ann.source)
                        ),
                        "element_type": (
                            ann.element_type.value
                            if ann.element_type and hasattr(ann.element_type, "value")
                            else None
                        ),
                    },
                }
            )

        return coco

    @staticmethod
    def _generate_yolo_export(
        images: list[TrainingDatasetImage],
        annotations_by_image: dict[str, list[TrainingDatasetAnnotation]],
        dataset: TrainingDataset,
    ) -> list[dict[str, str]]:
        """Generate YOLO format export with data.yaml and classes.txt."""
        files: list[dict[str, str]] = []

        # Collect all unique categories
        categories: dict[int, str] = {}
        for img in images:
            img_anns = annotations_by_image.get(str(img.id), [])
            for ann in img_anns:
                cat_id: int = ann.category_id  # type: ignore[assignment]
                cat_name: str = ann.category_name or f"class_{cat_id}"  # type: ignore[assignment]
                if cat_id not in categories:
                    categories[cat_id] = cat_name

        # Sort categories by ID for consistent ordering
        sorted_categories = sorted(categories.items(), key=lambda x: x[0])

        # Create class ID mapping (remap to 0-based sequential IDs)
        class_id_remap: dict[int, int] = {}
        class_names: list[str] = []
        for new_id, (orig_id, name) in enumerate(sorted_categories):
            class_id_remap[orig_id] = new_id
            class_names.append(name)

        # Generate classes.txt
        files.append(
            {
                "path": "classes.txt",
                "content": "\n".join(class_names),
            }
        )

        # Generate data.yaml (YOLO configuration)
        data_yaml_content = f"""# YOLO Dataset Configuration
# Dataset: {dataset.name}
# Exported: {utc_now().isoformat()}
#
# IMPORTANT: This export contains annotations only.
# Use qontinui-runner to package your local images.

# Path to dataset root (update after packaging images)
path: ./

# Train/val/test directories (create after packaging)
train: images/train
val: images/val
test: images/test

# Number of classes
nc: {len(class_names)}

# Class names
names:
{chr(10).join(f'  {i}: "{name}"' for i, name in enumerate(class_names))}
"""
        files.append(
            {
                "path": "data.yaml",
                "content": data_yaml_content,
            }
        )

        # Generate label files
        for img in images:
            img_anns = annotations_by_image.get(str(img.id), [])
            lines: list[str] = []

            for ann in img_anns:
                # YOLO format: class_id x_center y_center width height (normalized)
                ann_cat_id: int = ann.category_id  # type: ignore[assignment]
                remapped_class_id = class_id_remap.get(ann_cat_id, 0)
                x_center = (ann.x + ann.width / 2) / img.width
                y_center = (ann.y + ann.height / 2) / img.height
                norm_width = ann.width / img.width
                norm_height = ann.height / img.height

                lines.append(
                    f"{remapped_class_id} {x_center:.6f} {y_center:.6f} {norm_width:.6f} {norm_height:.6f}"
                )

            label_filename = os.path.splitext(img.filename)[0] + ".txt"
            files.append(
                {
                    "path": f"labels/{label_filename}",
                    "content": "\n".join(lines),
                }
            )

        # Generate README with instructions
        readme_content = f"""# YOLO Dataset Export

**Dataset:** {dataset.name}
**Exported:** {utc_now().strftime("%Y-%m-%d %H:%M:%S")} UTC
**Images:** {len(images)}
**Classes:** {len(class_names)}

## Important: Images Not Included

This export contains **annotations only**. Images are stored locally on your
machine by the Qontinui Runner to avoid cloud storage transfer costs.

## Packaging Your Dataset

Use the Qontinui Runner to package your local images with these annotations:

1. Open Qontinui Runner
2. Go to Settings > Dataset Export
3. Select this annotation export file
4. The runner will match and package your local images

Alternatively, manually copy images to match the label filenames:
- For each `labels/screenshot_001.txt`, place `images/screenshot_001.png`

## Directory Structure for Training

After packaging, organize as:

```
dataset/
|-- data.yaml
|-- images/
|   |-- train/
|   |-- val/
|   |-- test/
|-- labels/
    |-- train/
    |-- val/
    |-- test/
```

## Classes

{chr(10).join(f"{i}: {name}" for i, name in enumerate(class_names))}

## Using with Ultralytics YOLOv8

```python
from ultralytics import YOLO

model = YOLO('yolov8n.pt')
model.train(data='data.yaml', epochs=100)
```
"""
        files.append(
            {
                "path": "README.md",
                "content": readme_content,
            }
        )

        return files

    @staticmethod
    def _generate_jsonl_export(
        images: list[TrainingDatasetImage],
        annotations_by_image: dict[str, list[TrainingDatasetAnnotation]],
    ) -> list[dict[str, str]]:
        """Generate JSONL format export."""
        lines: list[str] = []

        for img in images:
            img_anns = annotations_by_image.get(str(img.id), [])
            entry = {
                "image": img.filename,
                "width": img.width,
                "height": img.height,
                "annotations": [
                    {
                        "bbox": [ann.x, ann.y, ann.width, ann.height],
                        "category_id": ann.category_id,
                        "category_name": ann.category_name,
                        "confidence": ann.confidence,
                        "source": (
                            ann.source.value
                            if hasattr(ann.source, "value")
                            else str(ann.source)
                        ),
                    }
                    for ann in img_anns
                ],
            }
            lines.append(json.dumps(entry))

        return [{"path": "annotations.jsonl", "content": "\n".join(lines)}]


# Singleton instance
dataset_export_service = DatasetExportService()
