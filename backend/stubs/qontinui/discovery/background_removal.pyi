"""Type stubs for qontinui.discovery.background_removal module."""

from typing import Any

class BackgroundRemovalConfig:
    """Configuration for background removal."""

    def __init__(self, **kwargs: Any) -> None: ...

def remove_backgrounds_from_base64(
    base64_screenshots: list[str],
    config: BackgroundRemovalConfig | None = None,
    debug: bool = False,
) -> tuple[list[str], dict[str, Any]]: ...
