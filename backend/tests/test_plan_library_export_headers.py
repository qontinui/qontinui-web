"""The plan-library exports' provenance headers are sent AND readable.

Companion to ``test_session_repository_export_headers.py``, which pins the
same contract for ``/session-repository/{id}/export``. Both routes build their
headers through a ``**`` splice, so no literal name survives for
``test_cors_expose_headers_cover_emitted.py``'s AST scan to check — the pair of
assertions here is what covers that gap, and a route emitting a dynamic header
set is expected to carry them.

WHY THIS FILE EXISTS AT ALL. #1177 published
``session_repository.EXPORT_PROVENANCE_HEADERS`` in
``Access-Control-Expose-Headers``, and that tuple happens to contain
``X-Content-Sha256`` — the same name this route sends. So the plan-library
export's digest became browser-readable as a **side effect**, while
``X-Artifact-Kind``, ``X-Artifact-Slug`` and ``X-Artifact-Version`` did not.
That half-state is worse than the original bug rather than better: a caller
could read a digest and could not read which artifact or which VERSION the
digest was over, with no signal that three of the four answers had been
withheld. Publishing a set by accident is what this file makes impossible.
"""

from __future__ import annotations

from app.api.v1.endpoints.plan_library import (
    ARTIFACT_EXPORT_HEADERS,
    CORPUS_EXPORT_HEADERS,
    _artifact_export_provenance,
    _corpus_export_provenance,
)
from app.main import CORS_EXPOSE_HEADERS
from tests.test_cors_expose_headers_cover_emitted import CORS_SAFELISTED


class _Row:
    """The two attributes the artifact producer reads. No DB, no model defaults."""

    kind = "plan"
    slug = "2026-08-26-claude-code-session-repository-in-qontinui-web"


def test_the_artifact_producer_emits_exactly_the_declared_names() -> None:
    """The tuple CORS publishes must be the set the route actually sends.

    Asserted in BOTH directions. A subset check would pass a producer that
    silently stopped sending a header, and a superset check would pass one
    that started sending an unpublished name — the very defect this pairing
    exists to catch.
    """
    sent = _artifact_export_provenance(
        _Row(),  # type: ignore[arg-type]
        digest="a" * 64,
        exported_version=3,
    )

    assert set(sent) == set(ARTIFACT_EXPORT_HEADERS)
    assert len(ARTIFACT_EXPORT_HEADERS) == len(set(ARTIFACT_EXPORT_HEADERS))


def test_the_corpus_producer_emits_exactly_the_declared_names() -> None:
    sent = _corpus_export_provenance(artifact_count=12, truncated=False)

    assert set(sent) == set(CORPUS_EXPORT_HEADERS)
    assert len(CORPUS_EXPORT_HEADERS) == len(set(CORPUS_EXPORT_HEADERS))


def test_the_truncation_signal_is_sent_on_both_branches() -> None:
    """Its absence must never be the answer.

    ``X-Export-Truncated`` is emitted whether or not the corpus was truncated
    so that a reader cannot take a missing header for "nothing was dropped".
    That reasoning only holds while the header is READABLE — which is what
    the publication test below is for.
    """
    assert _corpus_export_provenance(artifact_count=5000, truncated=True) == {
        "X-Export-Artifact-Count": "5000",
        "X-Export-Truncated": "true",
    }
    assert _corpus_export_provenance(artifact_count=7, truncated=False) == {
        "X-Export-Artifact-Count": "7",
        "X-Export-Truncated": "false",
    }


def test_every_declared_name_is_published_to_browsers() -> None:
    """Sent is not the same as readable — the whole lesson of #1177."""
    published = set(CORS_EXPOSE_HEADERS)

    assert set(ARTIFACT_EXPORT_HEADERS) <= published
    assert set(CORPUS_EXPORT_HEADERS) <= published


def test_the_publication_is_load_bearing_not_a_restatement_of_the_default() -> None:
    """None of these is CORS-safelisted, so publishing them really is what makes
    them readable.

    Without this the test above could go quietly vacuous on some future header
    browsers expose anyway, and look like coverage while proving nothing.
    """
    names = {n.lower() for n in (*ARTIFACT_EXPORT_HEADERS, *CORPUS_EXPORT_HEADERS)}

    assert not names & CORS_SAFELISTED


def test_the_shared_digest_header_is_published_once() -> None:
    """Both export routes send ``X-Content-Sha256``; the list must not repeat it.

    ``CORS_EXPOSE_HEADERS`` splices two tuples that overlap on this one name.
    Starlette would join a duplicate into the header value verbatim, which is
    harmless but reads as a mistake to anyone inspecting the response — and a
    de-duplication that silently dropped a DIFFERENT name would not be
    harmless, so the count is pinned.
    """
    assert CORS_EXPOSE_HEADERS.count("X-Content-Sha256") == 1
    assert len(CORS_EXPOSE_HEADERS) == len(set(CORS_EXPOSE_HEADERS))
