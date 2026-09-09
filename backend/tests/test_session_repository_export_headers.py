"""``GET /session-repository/{id}/export``'s provenance headers must be READABLE.

Follow-up to qontinui-web#1096 (plan
``2026-08-26-claude-code-session-repository-in-qontinui-web``, Phase 4).

That PR gave the export route seven custom headers, three of which carry its
central honesty property: whether the served bytes match the recorded digest,
and whether that digest can be checked against the ORIGINAL transcript at all
(``X-Digest-Verifiable`` is ``false`` for a ``coord_redacted`` body even when
the digest matches, because a digest over redacted bytes proves nothing).

None of them was in ``expose_headers``. The CORS spec safelists exactly six
response headers and every other one is withheld from cross-origin ``fetch``,
so ``response.headers.get("X-Content-Sha256")`` returned ``None`` in the
deployed shape — the one ``ApiConfig.IS_REMOTE_BACKEND`` exists for, where
``NEXT_PUBLIC_API_URL`` names the API host. ``None`` is also what a browser
returns when the header was never sent, so the whole provenance set went
missing with nothing logged and nothing red, and only in production: local dev
proxies same-origin through Next and reads them fine.

Three assertions, in the order the failure travels:

1. the route's producer emits exactly the published names,
2. the app's CORS middleware really publishes them (asserted off a live
   response, not off the list that was passed in), and
3. none of them is safelisted — i.e. step 2 is doing work rather than
   restating a default.
"""

from collections.abc import Iterator

import pytest
from fastapi.responses import Response
from fastapi.testclient import TestClient

from app.api.v1.endpoints.session_repository import (
    EXPORT_PROVENANCE_HEADERS,
    _export_provenance,
)
from app.models.session_artifact import SessionArtifact

# The allowed test origin, per tests/conftest.py:
#   BACKEND_CORS_ORIGINS='["http://localhost:3000"]'
ALLOWED_ORIGIN = "http://localhost:3000"

_PROBE_PATH = "/_test/session-export-headers"

#: The CORS-safelisted response headers (Fetch Standard § "CORS-safelisted
#: response-header name"). A header on this list needs no ``expose_headers``
#: entry; anything else does.
_CORS_SAFELISTED = {
    "cache-control",
    "content-language",
    "content-length",
    "content-type",
    "expires",
    "last-modified",
    "pragma",
}


def _row() -> SessionArtifact:
    """A head row with a verifiable body — no DB, no flush, no defaults."""
    return SessionArtifact(
        claude_session_id="730de490-7632-4884-a42b-0cb9aedd6791",
        account_label=".claude-tiohorst",
        tenant_source="declared",
        body_source="disk_verbatim",
        content_sha256="a" * 64,
    )


def test_the_producer_emits_exactly_the_published_names() -> None:
    """One spelling of the header set, or the CORS list guards the wrong names.

    ``_export_provenance`` is the export route's SOLE header producer, so
    pinning its key set against the tuple is what makes the CORS assertion
    below a statement about the real response rather than about a list.
    """
    headers = _export_provenance(
        _row(),
        served_digest="a" * 64,
        stored_digest="a" * 64,
        matches=True,
    )
    assert set(headers) == set(EXPORT_PROVENANCE_HEADERS)
    assert len(EXPORT_PROVENANCE_HEADERS) == len(set(EXPORT_PROVENANCE_HEADERS))
    # Every value is a string: `Response(headers=...)` rejects None, and a row
    # with a NULL body_source / content_sha256 must still export.
    sparse = _export_provenance(
        SessionArtifact(claude_session_id="s", tenant_source="unknown"),
        served_digest="b" * 64,
        stored_digest="",
        matches=False,
    )
    assert all(isinstance(v, str) for v in sparse.values())
    assert sparse["X-Digest-Verifiable"] == "false"
    assert sparse["X-Body-Source"] == "unknown"


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """The REAL app — real middleware stack — plus one probe route.

    The probe returns the export's exact header set, so the assertion is made
    against a response that travelled the installed ``CORSMiddleware``. Reading
    ``app.user_middleware`` instead would pass even if the middleware were
    added with a different list.

    No ``with``-block: lifespan (DB init, scheduler) is not needed to exercise
    a middleware and must not run here.
    """
    from app.main import app

    async def _probe() -> Response:
        return Response(
            content=b"",
            headers=_export_provenance(
                _row(),
                served_digest="a" * 64,
                stored_digest="a" * 64,
                matches=True,
            ),
        )

    app.add_api_route(_PROBE_PATH, _probe, methods=["GET"])
    try:
        yield TestClient(app)
    finally:
        # The app object is shared session-wide — drop the probe route.
        app.router.routes[:] = [
            r for r in app.router.routes if getattr(r, "path", None) != _PROBE_PATH
        ]


def test_every_export_header_is_published_through_cors(client: TestClient) -> None:
    """The header is on the wire AND named in Access-Control-Expose-Headers.

    Both halves matter. Sending a header a browser may not read is the exact
    shape of the defect this test exists for: the server is honest, the client
    reads ``None``, and the two are indistinguishable from a server that said
    nothing.
    """
    response = client.get(_PROBE_PATH, headers={"Origin": ALLOWED_ORIGIN})
    assert response.status_code == 200

    exposed = {
        name.strip().lower()
        for name in response.headers.get("access-control-expose-headers", "").split(",")
        if name.strip()
    }
    assert exposed, (
        "The response carried no Access-Control-Expose-Headers at all, so every "
        "custom header on it is unreadable cross-origin."
    )
    for name in EXPORT_PROVENANCE_HEADERS:
        assert name.lower() in response.headers, f"{name} was not sent"
        assert name.lower() in exposed, (
            f"{name} is sent but not exposed — a cross-origin browser reads None "
            f"for it, which is the same answer as 'never sent'."
        )


def test_the_exposure_is_load_bearing_not_a_restatement_of_the_default() -> None:
    """None of these is CORS-safelisted, so omitting them really does hide them.

    Guards against the test above being quietly satisfied by a future header
    that browsers expose anyway — which would make it look like coverage while
    proving nothing.
    """
    assert not {n.lower() for n in EXPORT_PROVENANCE_HEADERS} & _CORS_SAFELISTED


def test_the_previously_published_headers_are_still_published() -> None:
    """The refactor into ``CORS_EXPOSE_HEADERS`` must not have dropped any.

    ``X-Total-Count`` and the rate-limit trio predate this change and have
    their own readers; extracting the inline list is only safe if it is a
    superset.
    """
    from app.main import CORS_EXPOSE_HEADERS

    assert {
        "X-Total-Count",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "X-Request-ID",
    } <= set(CORS_EXPOSE_HEADERS)
    assert set(EXPORT_PROVENANCE_HEADERS) <= set(CORS_EXPOSE_HEADERS)
