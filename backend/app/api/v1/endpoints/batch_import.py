"""
Batch Import Endpoint

Endpoint for batch importing annotation files from a server directory.
"""

import hashlib
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

import structlog
from app.api import deps
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()
logger = structlog.get_logger(__name__)

# Allowed base directories for batch import (security measure)
ALLOWED_IMPORT_PATHS = [
    "/data/annotations",
    "/data/training",
    "/tmp/imports",
]

# For Windows development
if os.name == "nt":
    ALLOWED_IMPORT_PATHS.extend(
        [
            "C:\\data\\annotations",
            "C:\\data\\training",
            os.path.expanduser("~\\Downloads"),
        ]
    )


class FileInfo(BaseModel):
    """Information about a file to import."""

    filename: str
    path: str
    size: int
    format: str | None = None


class BatchImportRequest(BaseModel):
    """Request to batch import from a directory."""

    directory: str = Field(..., min_length=1)
    format: str = Field(default="auto", pattern="^(auto|coco|yolo|csv)$")
    recursive: bool = Field(default=False)
    screenshot_width: int = Field(default=1920, ge=1, le=10000)
    screenshot_height: int = Field(default=1080, ge=1, le=10000)
    skip_duplicates: bool = Field(default=True)

    @field_validator("directory")
    @classmethod
    def validate_directory(cls, v: str) -> str:
        """Validate directory path for security."""
        # Normalize path
        normalized = os.path.normpath(v)

        # Check for path traversal
        if ".." in normalized:
            raise ValueError("Path traversal not allowed")

        # Check if path is under allowed directories
        is_allowed = any(
            normalized.startswith(os.path.normpath(allowed))
            for allowed in ALLOWED_IMPORT_PATHS
        )

        if not is_allowed:
            raise ValueError(
                f"Directory must be under one of: {', '.join(ALLOWED_IMPORT_PATHS)}"
            )

        return normalized


class ImportedElement(BaseModel):
    """An imported annotation element."""

    id: str
    label: str
    element_type: str
    bbox: dict[str, int]
    confidence: float = 0.0
    is_ground_truth: bool = False
    description: str | None = None
    reasoning: str | None = None


class FileImportResult(BaseModel):
    """Result of importing a single file."""

    filename: str
    status: str  # "success" | "error" | "skipped"
    element_count: int = 0
    error: str | None = None
    format: str | None = None


class BatchImportResponse(BaseModel):
    """Response from batch import."""

    success: bool
    total_files: int
    successful_files: int
    failed_files: int
    skipped_files: int
    total_elements: int
    elements: list[ImportedElement]
    file_results: list[FileImportResult]


class ListFilesResponse(BaseModel):
    """Response listing files in a directory."""

    directory: str
    files: list[FileInfo]
    total_count: int
    supported_count: int


def detect_format(content: str, filename: str) -> str:
    """Detect the format of an annotation file."""
    ext = Path(filename).suffix.lower()

    # Try to detect from content
    content_stripped = content.strip()

    if content_stripped.startswith("{"):
        try:
            data = json.loads(content_stripped)
            if "annotations" in data and "categories" in data:
                return "coco"
            return "json"
        except json.JSONDecodeError:
            pass

    # YOLO format: class_id x_center y_center width height
    lines = content_stripped.split("\n")
    if lines and all(
        len(line.split()) == 5 and line.split()[0].isdigit()
        for line in lines[:5]
        if line.strip()
    ):
        return "yolo"

    # CSV format
    if "," in content_stripped and (ext == ".csv" or content_stripped.count(",") > 2):
        return "csv"

    # Fall back to extension
    if ext == ".json":
        return "coco"
    elif ext == ".txt":
        return "yolo"
    elif ext == ".csv":
        return "csv"

    return "unknown"


def parse_coco(content: str) -> list[ImportedElement]:
    """Parse COCO format annotations."""
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}")

    if "annotations" not in data:
        raise ValueError("Missing 'annotations' key in COCO format")

    # Build category map
    categories = {c["id"]: c["name"] for c in data.get("categories", [])}

    elements = []
    for ann in data["annotations"]:
        bbox = ann.get("bbox", [0, 0, 0, 0])
        if len(bbox) < 4:
            continue

        cat_id = ann.get("category_id", 0)
        label = categories.get(cat_id, f"class_{cat_id}")

        elements.append(
            ImportedElement(
                id=str(uuid4()),
                label=label,
                element_type=ann.get("attributes", {}).get("element_type", "other"),
                bbox={
                    "x": int(bbox[0]),
                    "y": int(bbox[1]),
                    "width": int(bbox[2]),
                    "height": int(bbox[3]),
                },
                confidence=ann.get("score", 0.0),
                is_ground_truth=ann.get("attributes", {}).get("is_ground_truth", False),
                description=ann.get("attributes", {}).get("description"),
                reasoning=ann.get("attributes", {}).get("reasoning"),
            )
        )

    return elements


def parse_yolo(
    content: str,
    width: int,
    height: int,
    classes: list[str] | None = None,
) -> list[ImportedElement]:
    """Parse YOLO format annotations."""
    default_classes = [
        "button",
        "input",
        "link",
        "icon",
        "label",
        "container",
        "checkbox",
        "radio",
        "dropdown",
        "menu",
        "tab",
        "image",
        "other",
    ]
    class_names = classes or default_classes

    elements = []
    for line in content.strip().split("\n"):
        line = line.strip()
        if not line:
            continue

        parts = line.split()
        if len(parts) < 5:
            continue

        try:
            class_id = int(parts[0])
            x_center = float(parts[1])
            y_center = float(parts[2])
            w = float(parts[3])
            h = float(parts[4])
            confidence = float(parts[5]) if len(parts) > 5 else 0.0
        except (ValueError, IndexError):
            continue

        # Convert normalized coordinates to absolute
        x = int((x_center - w / 2) * width)
        y = int((y_center - h / 2) * height)
        box_w = int(w * width)
        box_h = int(h * height)

        label = (
            class_names[class_id]
            if class_id < len(class_names)
            else f"class_{class_id}"
        )

        elements.append(
            ImportedElement(
                id=str(uuid4()),
                label=label,
                element_type=label if label in default_classes else "other",
                bbox={"x": x, "y": y, "width": box_w, "height": box_h},
                confidence=confidence,
                is_ground_truth=False,
            )
        )

    return elements


def parse_csv(content: str) -> list[ImportedElement]:
    """Parse CSV format annotations."""
    lines = content.strip().split("\n")
    if not lines:
        return []

    # Detect header
    header = lines[0].lower()
    has_header = "label" in header or "x" in header or "bbox" in header

    if has_header:
        headers = [h.strip().lower() for h in lines[0].split(",")]
        data_lines = lines[1:]
    else:
        # Assume default order: label, x, y, width, height, type, confidence
        headers = ["label", "x", "y", "width", "height", "element_type", "confidence"]
        data_lines = lines

    elements = []
    for line in data_lines:
        if not line.strip():
            continue

        values = [v.strip().strip('"') for v in line.split(",")]
        row = dict(zip(headers, values, strict=False))

        try:
            x = int(float(row.get("x", 0)))
            y = int(float(row.get("y", 0)))
            width = int(float(row.get("width", 0)))
            height = int(float(row.get("height", 0)))
        except ValueError:
            continue

        if width <= 0 or height <= 0:
            continue

        elements.append(
            ImportedElement(
                id=str(uuid4()),
                label=row.get("label", "unknown"),
                element_type=row.get("element_type", row.get("type", "other")),
                bbox={"x": x, "y": y, "width": width, "height": height},
                confidence=float(row.get("confidence", 0)),
                is_ground_truth=row.get("is_ground_truth", "").lower()
                in ("true", "1", "yes"),
                description=row.get("description"),
                reasoning=row.get("reasoning"),
            )
        )

    return elements


def import_file(
    filepath: str,
    format: str,
    screenshot_width: int,
    screenshot_height: int,
) -> tuple[list[ImportedElement], str]:
    """Import a single annotation file."""
    with open(filepath, encoding="utf-8") as f:
        content = f.read()

    filename = os.path.basename(filepath)

    # Detect format if auto
    detected_format = format
    if format == "auto":
        detected_format = detect_format(content, filename)

    if detected_format == "coco" or detected_format == "json":
        elements = parse_coco(content)
        return elements, "coco"
    elif detected_format == "yolo":
        elements = parse_yolo(content, screenshot_width, screenshot_height)
        return elements, "yolo"
    elif detected_format == "csv":
        elements = parse_csv(content)
        return elements, "csv"
    else:
        raise ValueError(f"Unknown format: {detected_format}")


@router.get("/import/list-files", response_model=ListFilesResponse)
async def list_importable_files(
    directory: str,
    recursive: bool = False,
    current_user=Depends(deps.get_current_active_user_async),
) -> Any:
    """List annotation files in a directory that can be imported."""
    logger.info(
        "list_importable_files",
        user_id=str(current_user.id),
        directory=directory,
        recursive=recursive,
    )

    # Validate directory
    try:
        request = BatchImportRequest(directory=directory, recursive=recursive)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not os.path.isdir(request.directory):
        raise HTTPException(status_code=404, detail="Directory not found")

    supported_extensions = {".json", ".txt", ".csv"}
    files: list[FileInfo] = []

    if recursive:
        for root, _, filenames in os.walk(request.directory):
            for filename in filenames:
                ext = Path(filename).suffix.lower()
                if ext in supported_extensions:
                    filepath = os.path.join(root, filename)
                    files.append(
                        FileInfo(
                            filename=filename,
                            path=filepath,
                            size=os.path.getsize(filepath),
                            format=ext[1:],  # Remove dot
                        )
                    )
    else:
        for filename in os.listdir(request.directory):
            filepath = os.path.join(request.directory, filename)
            if os.path.isfile(filepath):
                ext = Path(filename).suffix.lower()
                if ext in supported_extensions:
                    files.append(
                        FileInfo(
                            filename=filename,
                            path=filepath,
                            size=os.path.getsize(filepath),
                            format=ext[1:],
                        )
                    )

    # Sort by filename
    files.sort(key=lambda f: f.filename)

    return ListFilesResponse(
        directory=request.directory,
        files=files,
        total_count=len(files),
        supported_count=len(files),
    )


@router.post("/import/batch", response_model=BatchImportResponse)
async def batch_import_annotations(
    request: BatchImportRequest,
    db: AsyncSession = Depends(deps.get_async_db),
    current_user=Depends(deps.get_current_active_user_async),
) -> Any:
    """Batch import annotation files from a directory."""
    logger.info(
        "batch_import_annotations",
        user_id=str(current_user.id),
        directory=request.directory,
        format=request.format,
        recursive=request.recursive,
    )

    if not os.path.isdir(request.directory):
        raise HTTPException(status_code=404, detail="Directory not found")

    supported_extensions = {".json", ".txt", ".csv"}
    files_to_import: list[str] = []

    if request.recursive:
        for root, _, filenames in os.walk(request.directory):
            for filename in filenames:
                ext = Path(filename).suffix.lower()
                if ext in supported_extensions:
                    files_to_import.append(os.path.join(root, filename))
    else:
        for filename in os.listdir(request.directory):
            filepath = os.path.join(request.directory, filename)
            if os.path.isfile(filepath):
                ext = Path(filename).suffix.lower()
                if ext in supported_extensions:
                    files_to_import.append(filepath)

    # Sort files for consistent ordering
    files_to_import.sort()

    all_elements: list[ImportedElement] = []
    file_results: list[FileImportResult] = []
    existing_hashes: set[str] = set()

    successful = 0
    failed = 0
    skipped = 0

    for filepath in files_to_import:
        filename = os.path.basename(filepath)

        try:
            elements, detected_format = import_file(
                filepath,
                request.format,
                request.screenshot_width,
                request.screenshot_height,
            )

            # Filter duplicates if requested
            if request.skip_duplicates:
                new_elements = []
                for el in elements:
                    # Create hash from label and bbox
                    hash_str = f"{el.label}-{el.bbox['x']}-{el.bbox['y']}-{el.bbox['width']}-{el.bbox['height']}"
                    element_hash = hashlib.md5(hash_str.encode()).hexdigest()

                    if element_hash not in existing_hashes:
                        existing_hashes.add(element_hash)
                        new_elements.append(el)

                elements = new_elements

            if elements:
                all_elements.extend(elements)
                file_results.append(
                    FileImportResult(
                        filename=filename,
                        status="success",
                        element_count=len(elements),
                        format=detected_format,
                    )
                )
                successful += 1
            else:
                file_results.append(
                    FileImportResult(
                        filename=filename,
                        status="skipped",
                        element_count=0,
                        error="No valid annotations found",
                    )
                )
                skipped += 1

        except Exception as e:
            logger.warning(
                "batch_import_file_error",
                filename=filename,
                error=str(e),
            )
            file_results.append(
                FileImportResult(
                    filename=filename,
                    status="error",
                    error=str(e),
                )
            )
            failed += 1

    logger.info(
        "batch_import_complete",
        user_id=str(current_user.id),
        total_files=len(files_to_import),
        successful=successful,
        failed=failed,
        skipped=skipped,
        total_elements=len(all_elements),
    )

    return BatchImportResponse(
        success=failed == 0,
        total_files=len(files_to_import),
        successful_files=successful,
        failed_files=failed,
        skipped_files=skipped,
        total_elements=len(all_elements),
        elements=all_elements,
        file_results=file_results,
    )
