"""Public endpoints that resolve the latest qontinui-runner release.

The qontinui-runner release pipeline (`.github/workflows/release.yml`) builds
platform installers and uploads them to GitHub Releases with version-stamped
filenames (e.g. ``qontinui-runner_1.0.0_x64.msi``). Because the version is baked
into every asset name, GitHub's own ``/releases/latest/download/<file>``
permalink cannot be used as a stable link.

These endpoints resolve "latest" dynamically against the GitHub Releases API so
the website never has to hardcode a version:

- ``GET /api/v1/releases/runner/latest``    -> JSON metadata + classified assets
- ``GET /api/v1/releases/runner/download``  -> 302 redirect to the best asset

The GitHub response is cached in-process (TTL) so the public download page does
not exhaust GitHub's 60-req/hr unauthenticated rate limit under traffic.
"""

import os
import time

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

logger = structlog.get_logger(__name__)

router = APIRouter()

GITHUB_REPO = "qontinui/qontinui-runner"
GITHUB_LATEST_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
RELEASES_PAGE_URL = f"https://github.com/{GITHUB_REPO}/releases/latest"

# Cache the GitHub response for this long. Keeps us well under GitHub's
# 60-req/hr unauthenticated limit even under sustained download-page traffic.
_CACHE_TTL_SECONDS = 300

# Default installer kind to hand out per platform when the caller doesn't
# specify one. Windows favours the MSI; macOS the DMG; Linux the AppImage.
_DEFAULT_KIND = {"windows": "msi", "macos": "dmg", "linux": "appimage"}


def _classify_asset(name: str) -> dict | None:
    """Map a release-asset filename to {platform, kind, arch}.

    Returns ``None`` for non-installer assets (checksums, update manifests,
    signatures) so they never surface as a download option.
    """
    lower = name.lower()

    # Skip non-installer artifacts uploaded alongside the binaries.
    if lower.endswith((".txt", ".json", ".sig", ".sha256")):
        return None

    if "aarch64" in lower or "arm64" in lower:
        arch = "arm64"
    elif "x64" in lower or "x86_64" in lower or "amd64" in lower:
        arch = "x64"
    else:
        arch = "unknown"

    if lower.endswith(".msi"):
        return {"platform": "windows", "kind": "msi", "arch": arch}
    if lower.endswith(".exe"):
        return {"platform": "windows", "kind": "exe", "arch": arch}
    if lower.endswith(".dmg"):
        return {"platform": "macos", "kind": "dmg", "arch": arch}
    if lower.endswith(".appimage"):
        return {"platform": "linux", "kind": "appimage", "arch": arch}
    if lower.endswith(".deb"):
        return {"platform": "linux", "kind": "deb", "arch": arch}

    return None


# Module-level cache: (expires_at_monotonic, payload).
_cache: tuple[float, dict] | None = None


async def _fetch_latest_release() -> dict:
    """Return the classified latest-release payload, using the TTL cache.

    Raises ``HTTPException`` if GitHub is unreachable and nothing is cached.
    """
    global _cache

    now = time.monotonic()
    if _cache is not None and _cache[0] > now:
        return _cache[1]

    headers = {"Accept": "application/vnd.github+json"}
    # Optional: a token lifts the rate limit from 60 to 5000 req/hr. The repo is
    # public, so this is purely a headroom optimization, never required.
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(GITHUB_LATEST_URL, headers=headers)
            resp.raise_for_status()
            release = resp.json()
    except Exception as e:
        logger.warning("github_latest_release_fetch_failed", error=str(e))
        # Serve stale cache if we have it rather than failing the page.
        if _cache is not None:
            return _cache[1]
        raise HTTPException(
            status_code=502,
            detail="Unable to resolve the latest runner release from GitHub.",
        ) from e

    assets: list[dict] = []
    for asset in release.get("assets", []):
        name = asset.get("name", "")
        classified = _classify_asset(name)
        if classified is None:
            continue
        assets.append(
            {
                "name": name,
                "url": asset.get("browser_download_url"),
                "size": asset.get("size"),
                "content_type": asset.get("content_type"),
                **classified,
            }
        )

    tag = release.get("tag_name", "")
    payload = {
        "version": tag[1:] if tag.startswith("v") else tag,
        "tag": tag,
        "name": release.get("name"),
        "published_at": release.get("published_at"),
        "html_url": release.get("html_url") or RELEASES_PAGE_URL,
        "prerelease": release.get("prerelease", False),
        "assets": assets,
    }

    _cache = (now + _CACHE_TTL_SECONDS, payload)
    return payload


def _select_asset(
    assets: list[dict], platform: str, kind: str | None, arch: str | None
) -> dict | None:
    """Pick the best asset for the requested platform/kind/arch."""
    candidates = [a for a in assets if a["platform"] == platform]
    if not candidates:
        return None

    wanted_kind = kind or _DEFAULT_KIND.get(platform)
    by_kind = [a for a in candidates if a["kind"] == wanted_kind] or candidates

    if arch:
        arch_match = [a for a in by_kind if a["arch"] == arch]
        if arch_match:
            return arch_match[0]

    # Prefer x64 when no arch was requested (the common desktop case), else
    # fall back to whatever the kind filter left us.
    x64 = [a for a in by_kind if a["arch"] == "x64"]
    return (x64 or by_kind)[0]


@router.get("/runner/latest")
async def get_latest_runner_release():
    """Return metadata + classified installer assets for the latest release.

    Public, no auth. The download page renders the version and per-platform
    buttons from this payload instead of hardcoding a version.
    """
    return await _fetch_latest_release()


@router.get("/runner/download")
async def download_latest_runner(
    platform: str = Query(..., regex="^(windows|macos|linux)$"),
    kind: str | None = Query(None, regex="^(msi|exe|dmg|appimage|deb)$"),
    arch: str | None = Query(None, regex="^(x64|arm64)$"),
):
    """302-redirect to the best matching installer in the latest release.

    Public, no auth. Used directly as the ``href`` for download buttons so the
    URL is permanent and version-free.
    """
    payload = await _fetch_latest_release()
    asset = _select_asset(payload["assets"], platform, kind, arch)

    if asset is None or not asset.get("url"):
        raise HTTPException(
            status_code=404,
            detail=(
                f"No installer available for platform={platform} "
                f"in release {payload.get('tag') or 'latest'}."
            ),
        )

    # 302 (not 301) so the redirect target follows future releases.
    return RedirectResponse(url=asset["url"], status_code=302)
