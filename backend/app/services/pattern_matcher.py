"""
Pattern matching service for automation workflows.

Delegates pattern matching operations to the runner/API.
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

# qontinui-api base URL for pattern matching
QONTINUI_API_URL = "http://localhost:8001"


class PatternMatcher:
    """
    Manages pattern matching operations for automation workflows.

    Delegates to qontinui-api for actual pattern matching on screenshots.
    """

    def __init__(self, workflow_run_id: str, api_base_url: str | None = None):
        """
        Initialize pattern matcher.

        Args:
            workflow_run_id: Unique ID for this workflow execution run
            api_base_url: Optional custom qontinui-api URL
        """
        self.workflow_run_id = workflow_run_id
        self._api_url = api_base_url or QONTINUI_API_URL
        self._match_history: list[dict[str, Any]] = []

    # ========================================================================
    # Pattern Matching
    # ========================================================================

    async def find_pattern_async(
        self,
        template_path: str,
        screenshot_data: bytes | None = None,
        threshold: float = 0.8,
        max_matches: int = 10,
    ) -> dict[str, Any]:
        """
        Find pattern on screen using template matching (async version).

        Calls qontinui-api for pattern matching against current screenshot.

        Args:
            template_path: Path to template image file
            screenshot_data: Optional screenshot bytes to match against
            threshold: Match confidence threshold (0.0-1.0)
            max_matches: Maximum number of matches to return

        Returns:
            Match result dictionary with found locations
        """
        match_id = str(uuid4())
        start_time = datetime.now(UTC)

        try:
            async with httpx.AsyncClient() as client:
                # Prepare multipart form data
                files = {}
                data = {
                    "workflow_run_id": self.workflow_run_id,
                    "match_id": match_id,
                    "threshold": str(threshold),
                    "max_matches": str(max_matches),
                }

                # Add template image
                with open(template_path, "rb") as f:
                    files["template"] = (template_path, f.read(), "image/png")

                # Add screenshot if provided
                if screenshot_data:
                    files["screenshot"] = (
                        "screenshot.png",
                        screenshot_data,
                        "image/png",
                    )

                response = await client.post(
                    f"{self._api_url}/api/v1/pattern-match",
                    files=files,
                    data=data,
                    timeout=30.0,
                )
                response.raise_for_status()
                api_result = response.json()

                result = {
                    "success": True,
                    "match_id": match_id,
                    "matches": api_result.get("matches", []),
                    "best_match": api_result.get("best_match"),
                    "confidence": api_result.get("confidence", 0.0),
                    "execution_time_ms": (
                        datetime.now(UTC) - start_time
                    ).total_seconds()
                    * 1000,
                }

        except httpx.HTTPStatusError as e:
            result = {
                "success": False,
                "match_id": match_id,
                "error": f"API error: {e.response.status_code} - {e.response.text}",
                "matches": [],
                "execution_time_ms": (datetime.now(UTC) - start_time).total_seconds()
                * 1000,
            }
        except httpx.HTTPError as e:
            result = {
                "success": False,
                "match_id": match_id,
                "error": f"HTTP error: {e}",
                "matches": [],
                "execution_time_ms": (datetime.now(UTC) - start_time).total_seconds()
                * 1000,
            }
        except FileNotFoundError:
            result = {
                "success": False,
                "match_id": match_id,
                "error": f"Template image not found: {template_path}",
                "matches": [],
                "execution_time_ms": (datetime.now(UTC) - start_time).total_seconds()
                * 1000,
            }
        except Exception as e:
            result = {
                "success": False,
                "match_id": match_id,
                "error": f"Pattern matching failed: {e}",
                "matches": [],
                "execution_time_ms": (datetime.now(UTC) - start_time).total_seconds()
                * 1000,
            }

        # Record match in history
        self._match_history.append(
            {
                "match_id": match_id,
                "template_path": template_path,
                "timestamp": start_time.isoformat(),
                "result": result,
            }
        )

        logger.debug(
            f"[{self.workflow_run_id}] Pattern match completed: "
            f"found={len(result.get('matches', []))} matches, "
            f"time={result.get('execution_time_ms', 0):.1f}ms"
        )

        return result

    def find_pattern(self, image_path: str) -> dict[str, Any]:
        """
        Find pattern on screen using template matching.

        NOTE: This is a synchronous wrapper. Prefer find_pattern_async in async contexts.

        Args:
            image_path: Path to template image

        Returns:
            Action result dictionary with match information
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                raise RuntimeError(
                    "Cannot use synchronous find_pattern() in async context. "
                    "Use await find_pattern_async() instead."
                )
            else:
                return loop.run_until_complete(self.find_pattern_async(image_path))
        except RuntimeError as e:
            if "no running event loop" in str(e):
                loop = asyncio.new_event_loop()
                try:
                    return loop.run_until_complete(self.find_pattern_async(image_path))
                finally:
                    loop.close()
            raise

    def get_match_history(self) -> list[dict[str, Any]]:
        """
        Get history of pattern matching operations.

        Returns:
            List of match result dictionaries
        """
        return self._match_history.copy()

    def clear_match_history(self) -> None:
        """Clear match history (internal use)."""
        self._match_history.clear()
