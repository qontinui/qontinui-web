"""The ``/uploads`` static mount, minus the tenant-scoped object prefixes.

With the local storage backend every object lands under ``uploads/`` — the
same directory the anonymous ``/uploads`` static mount serves avatars from.
The content-addressed stores (``design-refs/`` for the design reference
library, ``image-assets/`` for the image store) are tenant-scoped and served
only through their authenticated routes, so this mount answers 404 for any
path under their prefixes instead of serving the bytes to anyone with the key.
"""

from __future__ import annotations

import posixpath
from collections.abc import Iterable
from typing import Any, Final

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

#: The prefixes under ``uploads/`` the static mount never serves.
UPLOADS_DENIED_PREFIXES: Final = ("design-refs", "image-assets")


class PrefixDenyingStaticFiles(StaticFiles):
    """A :class:`StaticFiles` that 404s every path under a denied prefix."""

    def __init__(self, *, denied_prefixes: Iterable[str], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.denied_prefixes = tuple(p.strip("/").lower() for p in denied_prefixes)

    def is_denied(self, path: str) -> bool:
        # Normalise first: ``./design-refs/x``, ``a/../design-refs/x`` and
        # ``//design-refs/x`` all resolve under the prefix. Lower-cased for a
        # case-insensitive filesystem.
        normalised = (
            posixpath.normpath("/" + path.replace("\\", "/")).lstrip("/").lower()
        )
        return any(
            normalised == prefix or normalised.startswith(prefix + "/")
            for prefix in self.denied_prefixes
        )

    async def get_response(self, path: str, scope: Scope) -> Any:
        if self.is_denied(path):
            raise HTTPException(status_code=404)
        return await super().get_response(path, scope)
