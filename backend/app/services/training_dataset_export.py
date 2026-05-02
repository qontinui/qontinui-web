"""Training dataset exporter — write a DB-backed TrainingDataset to disk.

Unlike :mod:`app.services.dataset_export_service`, which produces an
annotations-only ZIP for users to download, this exporter materializes the
full dataset (images + labels) on the local filesystem so a training script
(YOLO, COCO consumers, etc.) can read it directly. It is the prerequisite
for the ARQ training task: the worker calls
``TrainingDatasetExporter.export_yolo(dataset_id, work_dir)`` and then hands
``work_dir`` to ultralytics / detectron2 / etc.

Output formats:

* :meth:`export_yolo` — directory tree with ``images/{train,val}/``,
  ``labels/{train,val}/``, ``classes.txt``, and ``data.yaml``. Class IDs
  are derived from sorted ``element_type`` values; annotations whose
  ``element_type`` is ``None`` fall back to ``ElementType.UNKNOWN``.
* :meth:`export_coco` — single ``annotations.json`` plus an ``images/``
  directory. No train/val split (COCO consumers handle that themselves
  via the ``annotations`` / ``images`` lists).

YOLO bbox normalization: source annotations are pixel-space COCO
(``x``, ``y``, ``width``, ``height``); we convert to YOLO's center-form
normalized 0-1 (``cx = (x + w/2) / img.width``, etc.).
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any, cast
from uuid import UUID

import structlog
from qontinui_schemas.common import utc_now
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training_dataset import (
    ElementType,
    TrainingDataset,
    TrainingDatasetAnnotation,
    TrainingDatasetImage,
)
from app.repositories.training_dataset import TrainingDatasetRepository
from app.services.storage import ObjectStorageService

logger = structlog.get_logger(__name__)


# Default train/val split when ``train_split`` is not provided in the
# dataset's ``export_metadata``. Matches the YOLOv8 convention.
_DEFAULT_TRAIN_SPLIT = 0.8

# Deterministic shuffle seed when ``random_seed`` is not configured on the
# dataset. Stable seed lets tests assert specific train/val membership.
_DEFAULT_SHUFFLE_SEED = 42


class TrainingDatasetExporter:
    """Export a TrainingDataset from the DB to a local directory.

    The exporter is stateless aside from the injected ``db`` and
    ``object_storage`` handles, so the same instance can be reused for
    multiple datasets within an ARQ task.
    """

    def __init__(self, db: AsyncSession, object_storage: ObjectStorageService):
        self.db = db
        self.object_storage = object_storage

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def export_yolo(self, dataset_id: UUID, dest_dir: Path) -> Path:
        """Write a YOLO-format dataset rooted at ``dest_dir``.

        Layout::

            dest_dir/
              images/
                train/{image_id}.jpg
                val/{image_id}.jpg
              labels/
                train/{image_id}.txt   # one line per annotation
                val/{image_id}.txt
              classes.txt              # one class name per line
              data.yaml                # YOLO config (nc, names, train, val)

        Each label line is ``<class_id> <cx> <cy> <w> <h>`` with all
        bbox values normalized 0-1.

        Raises ``ValueError`` if the dataset has no images or no
        annotations — there is nothing meaningful to train on.
        """
        dataset, images, annotations_by_image = await self._load_dataset(dataset_id)

        # Class index from sorted element_type values. Annotations with no
        # element_type fall back to UNKNOWN so they still get a class.
        classes = self._build_class_index(annotations_by_image)

        # Skip images with no annotations rather than emit them as YOLO
        # background samples — simpler, and the annotation set is the point
        # of the dataset.
        labeled_images = [img for img in images if annotations_by_image.get(str(img.id))]
        if not labeled_images:
            raise ValueError(
                f"dataset {dataset_id} has images but none have annotations"
            )

        # Train/val split. Shuffle deterministically so reruns of the same
        # dataset produce the same split (important for reproducible eval).
        train_split = self._resolve_train_split(dataset)
        seed = self._resolve_shuffle_seed(dataset)
        train_images, val_images = self._split_train_val(
            labeled_images, train_split=train_split, seed=seed
        )

        # Build directory tree.
        dest_dir = Path(dest_dir)
        for split in ("train", "val"):
            (dest_dir / "images" / split).mkdir(parents=True, exist_ok=True)
            (dest_dir / "labels" / split).mkdir(parents=True, exist_ok=True)

        # Write images + labels for both splits. Image extension is forced
        # to .jpg in the filename per the spec, but the bytes themselves
        # are passed through unmodified — YOLO ingests by extension lookup,
        # so calling a PNG ".jpg" works in practice. (We don't re-encode
        # to avoid pulling in Pillow as a hot-path dependency.)
        for split, split_images in (("train", train_images), ("val", val_images)):
            for img in split_images:
                self._write_image(img, dest_dir / "images" / split)
                self._write_label(
                    img,
                    annotations_by_image[str(img.id)],
                    classes,
                    dest_dir / "labels" / split,
                )

        # classes.txt — one name per line, index = class_id.
        classes_path = dest_dir / "classes.txt"
        classes_path.write_text("\n".join(classes) + "\n", encoding="utf-8")

        # data.yaml — keep it minimal. Hand-written rather than yaml.dump'd
        # to avoid a PyYAML dependency for a 6-line file and to control
        # quoting (YOLO is picky about names being quoted strings).
        names_block = "\n".join(f'  {i}: "{name}"' for i, name in enumerate(classes))
        data_yaml = (
            f"# YOLO dataset config — auto-generated\n"
            f"# Dataset: {dataset.name} ({dataset.id})\n"
            f"# Generated: {utc_now().isoformat()}\n"
            f"\n"
            f"path: {dest_dir.resolve().as_posix()}\n"
            f"train: images/train\n"
            f"val: images/val\n"
            f"\n"
            f"nc: {len(classes)}\n"
            f"names:\n"
            f"{names_block}\n"
        )
        (dest_dir / "data.yaml").write_text(data_yaml, encoding="utf-8")

        logger.info(
            "yolo_export_complete",
            dataset_id=str(dataset_id),
            dest_dir=str(dest_dir),
            classes=len(classes),
            train_count=len(train_images),
            val_count=len(val_images),
        )
        return dest_dir

    async def export_coco(self, dataset_id: UUID, dest_dir: Path) -> Path:
        """Write a COCO-format dataset rooted at ``dest_dir``.

        Layout::

            dest_dir/
              images/
                {image_id}.jpg
              annotations.json   # COCO JSON: images, annotations, categories

        COCO doesn't carry a built-in train/val split — downstream
        consumers slice the ``images`` and ``annotations`` lists
        themselves. We emit every labeled image into a single flat
        directory.
        """
        dataset, images, annotations_by_image = await self._load_dataset(dataset_id)

        labeled_images = [img for img in images if annotations_by_image.get(str(img.id))]
        if not labeled_images:
            raise ValueError(
                f"dataset {dataset_id} has images but none have annotations"
            )

        dest_dir = Path(dest_dir)
        images_dir = dest_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        # COCO uses int IDs (not UUIDs). Build a stable mapping from the
        # DB UUID to a 1-based integer for both images and annotations.
        image_id_map: dict[str, int] = {}
        coco_images: list[dict[str, Any]] = []
        for idx, img in enumerate(labeled_images, start=1):
            image_id_map[str(img.id)] = idx
            self._write_image(img, images_dir)
            coco_images.append(
                {
                    "id": idx,
                    "file_name": f"{img.id}.jpg",
                    "width": int(img.width),
                    "height": int(img.height),
                }
            )

        # Categories: derive from element_type the same way YOLO does so
        # the two formats share class IDs. COCO IDs are 1-based by
        # convention.
        classes = self._build_class_index(annotations_by_image)
        coco_categories = [
            {"id": i + 1, "name": name, "supercategory": "gui"}
            for i, name in enumerate(classes)
        ]
        class_to_coco_id = {name: i + 1 for i, name in enumerate(classes)}

        coco_annotations: list[dict[str, Any]] = []
        next_ann_id = 1
        for img in labeled_images:
            mapped_image_id = image_id_map[str(img.id)]
            for ann in annotations_by_image[str(img.id)]:
                class_name = self._annotation_class_name(ann)
                coco_annotations.append(
                    {
                        "id": next_ann_id,
                        "image_id": mapped_image_id,
                        "category_id": class_to_coco_id[class_name],
                        "bbox": [
                            int(ann.x),
                            int(ann.y),
                            int(ann.width),
                            int(ann.height),
                        ],
                        "area": int(ann.width) * int(ann.height),
                        "iscrowd": 0,
                    }
                )
                next_ann_id += 1

        coco_doc = {
            "info": {
                "description": dataset.name,
                "version": dataset.dataset_version or "1.0",
                "year": utc_now().year,
                "contributor": "qontinui",
                "date_created": utc_now().isoformat(),
            },
            "images": coco_images,
            "annotations": coco_annotations,
            "categories": coco_categories,
        }
        (dest_dir / "annotations.json").write_text(
            json.dumps(coco_doc, indent=2), encoding="utf-8"
        )

        logger.info(
            "coco_export_complete",
            dataset_id=str(dataset_id),
            dest_dir=str(dest_dir),
            images=len(labeled_images),
            annotations=len(coco_annotations),
            categories=len(coco_categories),
        )
        return dest_dir

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _load_dataset(
        self,
        dataset_id: UUID,
    ) -> tuple[
        TrainingDataset,
        list[TrainingDatasetImage],
        dict[str, list[TrainingDatasetAnnotation]],
    ]:
        """Fetch dataset, images, and annotations grouped by image ID.

        Raises ``ValueError`` for a missing dataset or one that has no
        images / no annotations at all.
        """
        dataset = await TrainingDatasetRepository.get_by_id(self.db, dataset_id)
        if dataset is None:
            raise ValueError(f"dataset {dataset_id} not found")

        images = await TrainingDatasetRepository.get_all_images(self.db, dataset_id)
        if not images:
            raise ValueError(f"dataset {dataset_id} has no images")

        annotations = await TrainingDatasetRepository.get_all_annotations(
            self.db, dataset_id
        )
        if not annotations:
            raise ValueError(f"dataset {dataset_id} has no annotations")

        annotations_by_image: dict[str, list[TrainingDatasetAnnotation]] = defaultdict(
            list
        )
        for ann in annotations:
            annotations_by_image[str(ann.image_id)].append(ann)

        return dataset, images, annotations_by_image

    def _build_class_index(
        self,
        annotations_by_image: dict[str, list[TrainingDatasetAnnotation]],
    ) -> list[str]:
        """Build the sorted list of class names.

        Class IDs are positions in this list (0-based for YOLO; +1 for
        COCO category IDs). Annotations with ``element_type=None`` map
        to :class:`ElementType.UNKNOWN` so every annotation has a class.
        """
        names: set[str] = set()
        for anns in annotations_by_image.values():
            for ann in anns:
                names.add(self._annotation_class_name(ann))
        return sorted(names)

    @staticmethod
    def _annotation_class_name(ann: TrainingDatasetAnnotation) -> str:
        """Return the class name for an annotation.

        Falls back to ``ElementType.UNKNOWN.value`` when ``element_type``
        is None — keeps every annotation in the training set rather than
        silently dropping unlabeled boxes.
        """
        element_type = ann.element_type
        if element_type is None:
            return ElementType.UNKNOWN.value
        # SQLAlchemy returns the StrEnum instance; ``.value`` gives the
        # short string ("button", "icon", ...) which is what we want as
        # a class name.
        if hasattr(element_type, "value"):
            return str(element_type.value)
        return str(element_type)

    @staticmethod
    def _resolve_train_split(dataset: TrainingDataset) -> float:
        """Read ``train_split`` from ``export_metadata``, default 0.8.

        Clamped to (0, 1) — a 0.0 or 1.0 split would empty one of the
        sets, which the YOLO trainer treats as a config error.
        """
        metadata = cast(dict[str, Any], dataset.export_metadata or {})
        raw = metadata.get("train_split", _DEFAULT_TRAIN_SPLIT)
        try:
            value = float(raw)
        except (TypeError, ValueError):
            value = _DEFAULT_TRAIN_SPLIT
        if not 0.0 < value < 1.0:
            value = _DEFAULT_TRAIN_SPLIT
        return value

    @staticmethod
    def _resolve_shuffle_seed(dataset: TrainingDataset) -> int:
        """Read ``random_seed`` from ``export_metadata``, default 42."""
        metadata = cast(dict[str, Any], dataset.export_metadata or {})
        raw = metadata.get("random_seed", _DEFAULT_SHUFFLE_SEED)
        try:
            return int(raw)
        except (TypeError, ValueError):
            return _DEFAULT_SHUFFLE_SEED

    @staticmethod
    def _split_train_val(
        images: list[TrainingDatasetImage],
        *,
        train_split: float,
        seed: int,
    ) -> tuple[list[TrainingDatasetImage], list[TrainingDatasetImage]]:
        """Deterministic train/val split.

        Always assigns at least one image to each split so YOLO doesn't
        fail with "no validation data" — required for tiny test datasets.
        """
        ordered = sorted(images, key=lambda img: str(img.id))
        rng = random.Random(seed)
        rng.shuffle(ordered)

        n = len(ordered)
        train_count = int(n * train_split)
        # Guarantee at least one in each split if we have ≥2 images.
        if n >= 2:
            train_count = max(1, min(n - 1, train_count))
        else:
            train_count = n  # single-image dataset → all training
        return ordered[:train_count], ordered[train_count:]

    def _write_image(
        self,
        img: TrainingDatasetImage,
        dest_dir: Path,
    ) -> Path:
        """Download an image from object storage and write it to ``dest_dir``.

        File is named ``{image_id}.jpg`` regardless of source extension —
        downstream code (label files, COCO JSON) keys on that exact name.
        """
        storage_path = str(img.storage_path)
        data = self.object_storage.download_file(storage_path)
        target = dest_dir / f"{img.id}.jpg"
        target.write_bytes(data)
        return target

    def _write_label(
        self,
        img: TrainingDatasetImage,
        annotations: list[TrainingDatasetAnnotation],
        classes: list[str],
        dest_dir: Path,
    ) -> Path:
        """Write the YOLO label file for ``img``.

        One line per annotation: ``<class_id> <cx> <cy> <w> <h>`` with
        bbox values normalized to [0, 1] by the source image dimensions.
        """
        class_index = {name: i for i, name in enumerate(classes)}
        img_w = float(img.width)
        img_h = float(img.height)

        lines: list[str] = []
        for ann in annotations:
            class_name = self._annotation_class_name(ann)
            class_id = class_index[class_name]
            cx = (float(ann.x) + float(ann.width) / 2.0) / img_w
            cy = (float(ann.y) + float(ann.height) / 2.0) / img_h
            w = float(ann.width) / img_w
            h = float(ann.height) / img_h
            lines.append(
                f"{class_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"
            )

        target = dest_dir / f"{img.id}.txt"
        target.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return target
