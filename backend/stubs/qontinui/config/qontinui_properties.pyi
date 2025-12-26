"""Type stubs for qontinui.config.qontinui_properties module."""

from pathlib import Path
from typing import Any

from pydantic import BaseModel

class QontinuiProperties(BaseModel):
    """Qontinui configuration properties."""

    def model_dump(self, **kwargs: Any) -> dict[str, Any]: ...
    def to_yaml(self) -> str: ...
    @classmethod
    def from_yaml(cls, path: Path) -> QontinuiProperties: ...
