"""
Recording metadata validation service.

Validates recording metadata from uploaded files.
"""

from datetime import datetime


class RecordingMetadataValidator:
    """Validates recording metadata structure and values."""

    REQUIRED_FIELDS = [
        "recordingId",
        "version",
        "recordingStartTime",
        "recordingEndTime",
        "duration",
        "frameRate",
        "totalFrames",
    ]

    @classmethod
    def validate(cls, metadata: dict) -> tuple[bool, list[str], list[str]]:
        """
        Validate recording metadata.

        Args:
            metadata: Recording metadata dict

        Returns:
            Tuple of (is_valid, errors, warnings)
        """
        errors: list[str] = []
        warnings: list[str] = []

        # Required fields
        for field in cls.REQUIRED_FIELDS:
            if field not in metadata:
                errors.append(f"Missing required field: {field}")

        # Version check
        if metadata.get("version") != "1.0":
            warnings.append(
                f"Unsupported version: {metadata.get('version')}. Expected 1.0"
            )

        # Time validation
        try:
            start = datetime.fromisoformat(
                metadata.get("recordingStartTime", "").replace("Z", "+00:00")
            )
            end = datetime.fromisoformat(
                metadata.get("recordingEndTime", "").replace("Z", "+00:00")
            )
            if end <= start:
                errors.append("recordingEndTime must be after recordingStartTime")
        except (ValueError, AttributeError):
            errors.append("Invalid datetime format for recording times")

        # Frame rate validation
        if metadata.get("frameRate", 0) <= 0:
            errors.append("frameRate must be positive")

        # Total frames validation
        if metadata.get("totalFrames", 0) <= 0:
            errors.append("totalFrames must be positive")

        return len(errors) == 0, errors, warnings
