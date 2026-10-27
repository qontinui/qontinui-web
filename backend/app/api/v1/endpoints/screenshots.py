"""
Verification screenshot images for the ai-tasks page.

The runner saves the screenshots its verification steps take under the
workspace's ``.dev-logs/`` (``screenshots/``, ``playwright-screenshots/``) and
records a path to each: ``screenshots/<file>.png``, the same with a
``.dev-logs/`` prefix, or an absolute path. The ai-tasks page asks for
``/api/v1/screenshots/<that path>`` with any leading ``.dev-logs/`` dropped
(``screenshotUrl`` in ``frontend/src/app/(app)/ai-tasks/[id]/_components/utils.ts``).

The route takes no credential, so it serves image files under ``.dev-logs/``
and nothing else. On a dev or co-located backend :func:`_parent_dir` is the
workspace root, which holds every checkout: a route that served any file below
it handed ``qontinui-web/backend/.env`` to anyone, and that file's
``DATABASE_URL`` writes the ``project.apps`` build and start commands directly.
Three rules keep it to images:

* The requested path must NAME an image file (:func:`_image_request`). Anything
  else is a 404 before the filesystem or the runner is touched.
* A local file is served only when it RESOLVES, symlinks followed, to a regular
  image file inside ``<workspace>/.dev-logs/`` (:func:`_local_image`).
* Otherwise the co-located runner is asked for ``GET /screenshots/<path>``
  (:func:`_runner_image`). The first rule is what keeps that GET on an image
  path. Without it, ``list``, ``list?x`` and ``./list`` reached the runner's
  ``GET /screenshots/list``, which answers every screenshot's absolute path,
  and ``%2e%2e/apps`` was one dot-segment check away from ``GET /apps``. The
  runner serves no image under ``/screenshots/`` as of qontinui-runner
  ``5dc3f37f`` (``/screenshots/list`` is its only route there), so this arm
  answers 404 until it does.

Every image goes out as the media type its suffix names, never as whatever the
runner labelled it.

The deployed image runs this module from ``/app/app/api/v1/endpoints/``
(``WORKDIR /app`` plus ``COPY . .``), which has six parents, so there
:func:`_parent_dir` is ``None`` and only the runner arm runs.
"""

import re
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from types import MappingProxyType

import httpx
import structlog
from fastapi import APIRouter
from fastapi.responses import FileResponse, Response

from app.core.refusal import (
    GlossaryTerm,
    NextActionKind,
    RefusalCode,
    RefusalHTTPException,
    refusal_error,
)

logger = structlog.get_logger(__name__)
router = APIRouter()

#: The image types the route serves: file suffix, matched case-insensitively,
#: to the media type the file goes out as.
_IMAGE_MEDIA_TYPES: Mapping[str, str] = MappingProxyType(
    {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
)

#: Characters no screenshot path carries. A backslash is a separator on Windows,
#: so ``..\..\x.png`` would be one innocent-looking segment here and a
#: traversal there; ``%`` is an escape that a second decode reads; ``?`` and
#: ``#`` start a query or a fragment once the path is in a URL; and no file
#: name the runner writes holds a control character.
_FORBIDDEN_CHARS = re.compile(r"[\\%?#\x00-\x1f\x7f]")

#: The ``.dev-logs`` directories the runner saves screenshots in. An absolute
#: path it recorded is found here by file name.
_SCREENSHOT_DIRS = ("screenshots", "playwright-screenshots")

#: The co-located runner the route falls back to, and how long it waits for it.
#: Module attributes, so a test can point the arm at a stand-in.
_RUNNER_HOST = "localhost"
_RUNNER_PORT = 9876
_RUNNER_TIMEOUT_S = 10.0


# Resolved lazily — the cloud-deployed image runs this module from
# /app/app/api/v1/endpoints/, which has only six parents, while the dev tree
# has the layout qontinui-root/qontinui-web/backend/app/api/v1/endpoints/
# screenshots.py (parents[6] = qontinui-root). Resolving at import time
# crashed the FastAPI module-load on Fargate.
def _parent_dir() -> Path | None:
    parents = Path(__file__).resolve().parents
    if len(parents) <= 6:
        return None
    return parents[6]


def _image_request(path: str) -> PurePosixPath | None:
    """``path`` as the relative path of one image file, or ``None``.

    Leading slashes are dropped: the runner may record an absolute path, which
    :func:`_local_image` finds by file name. What remains must be
    ``/``-separated segments, none of them empty, ``.`` or ``..``, with no
    character :data:`_FORBIDDEN_CHARS` matches, the last one ending in a suffix
    :data:`_IMAGE_MEDIA_TYPES` lists.
    """
    relative = path.lstrip("/")
    if _FORBIDDEN_CHARS.search(relative):
        return None
    if any(segment in ("", ".", "..") for segment in relative.split("/")):
        return None
    request = PurePosixPath(relative)
    if request.suffix.lower() not in _IMAGE_MEDIA_TYPES:
        return None
    return request


def _local_image(request: PurePosixPath, parent_dir: Path) -> Path | None:
    """The image file ``request`` names under ``<parent_dir>/.dev-logs``, or ``None``.

    Looked up as ``.dev-logs/<request>`` (a leading ``.dev-logs`` segment
    dropped), then by file name in each of :data:`_SCREENSHOT_DIRS`. A
    candidate counts only through :func:`_image_inside`.
    """
    dev_logs = parent_dir / ".dev-logs"
    try:
        root = dev_logs.resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    parts = request.parts[1:] if request.parts[0] == ".dev-logs" else request.parts
    candidates = [dev_logs.joinpath(*parts)]
    candidates += [dev_logs / sub / request.name for sub in _SCREENSHOT_DIRS]
    for candidate in candidates:
        image = _image_inside(candidate, root)
        if image is not None:
            return image
    return None


def _image_inside(candidate: Path, root: Path) -> Path | None:
    """``candidate`` resolved, when that is a regular image file inside ``root``.

    Resolving follows every symlink first, so a link out of ``.dev-logs`` is
    judged by where it lands, and so is a link to a log inside it: the file
    that would be SERVED must itself be an image inside ``root``.
    """
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return None
    if not resolved.is_relative_to(root):
        return None
    if resolved.suffix.lower() not in _IMAGE_MEDIA_TYPES:
        return None
    return resolved if resolved.is_file() else None


def _media_type(image: PurePosixPath | Path) -> str:
    return _IMAGE_MEDIA_TYPES[image.suffix.lower()]


def _runner_url(request: PurePosixPath) -> httpx.URL:
    """The runner URL of ``request``, composed from its parts.

    Never an f-string, which reads a ``?`` or ``#`` in the path as the start of
    a query or a fragment (``list#.png`` asks for ``/screenshots/list``).
    Composed, httpx refuses such a path (``InvalidURL``) and percent-encodes
    the rest as a path. It still resolves ``.`` and ``..`` segments, which
    :func:`_image_request` has already refused, as it has ``?`` and ``#``.
    """
    return httpx.URL(
        scheme="http",
        host=_RUNNER_HOST,
        port=_RUNNER_PORT,
        path=f"/screenshots/{request}",
    )


def _screenshot_not_found() -> RefusalHTTPException:
    return refusal_error(
        404,
        RefusalCode.not_found,
        NextActionKind.none_terminal,
        "Screenshot not found: only image files (.png, .jpg, .jpeg, .webp, "
        ".gif) under the workspace's .dev-logs are served.",
        discriminator="screenshot_not_found",
    )


async def _runner_image(request: PurePosixPath) -> Response:
    """``request`` fetched from the co-located runner, or a refusal."""
    url = _runner_url(request)
    try:
        async with httpx.AsyncClient(timeout=_RUNNER_TIMEOUT_S) as client:
            response = await client.get(url)
    except httpx.ConnectError:
        logger.debug("screenshot_not_found", path=str(request))
        raise _screenshot_not_found() from None
    except httpx.TimeoutException:
        raise refusal_error(
            504,
            RefusalCode.upstream_timeout,
            NextActionKind.retry_later,
            "Timed out fetching the screenshot from the runner.",
            discriminator="runner_screenshot_timeout",
            glossary_terms=[GlossaryTerm.runner],
        ) from None
    if response.status_code == 404:
        raise _screenshot_not_found()
    if response.status_code != 200:
        raise refusal_error(
            502,
            RefusalCode.upstream_unavailable,
            NextActionKind.retry_later,
            f"The runner answered {response.status_code} for the screenshot.",
            discriminator="runner_screenshot_refused",
            glossary_terms=[GlossaryTerm.runner],
        )
    return Response(content=response.content, media_type=_media_type(request))


@router.get("/{path:path}", response_model=None)
async def get_screenshot(path: str) -> Response:
    """Serve one verification screenshot image.

    ``path`` is the image's path as the runner recorded it (a leading
    ``.dev-logs/`` is optional), ending in .png, .jpg, .jpeg, .webp or .gif.
    The file is served from the workspace's ``.dev-logs`` when this backend
    runs beside the runner, and fetched from the co-located runner otherwise.
    Anything that is not an image file under ``.dev-logs`` is a 404.
    """
    request = _image_request(path)
    if request is None:
        raise _screenshot_not_found()
    parent_dir = _parent_dir()
    if parent_dir is not None:
        image = _local_image(request, parent_dir)
        if image is not None:
            return FileResponse(path=image, media_type=_media_type(image))
    return await _runner_image(request)
