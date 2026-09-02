"""Every response header this app emits is either CORS-published or listed here.

``app.main.CORS_EXPOSE_HEADERS`` carries the instruction *"Add a header here in
the same change that starts emitting it."* Until this file existed that was a
convention with no enforcement, and #1096 → #1177 is what it costs when it is
missed: the session-repository export shipped seven provenance headers that a
cross-origin browser could not read for three weeks, with no error anywhere,
because ``response.headers.get(name)`` returns ``None`` for a withheld header
and ``None`` for a header that was never sent.

So the rule is asserted mechanically. The scan is an **AST walk**, not a grep,
and that distinction is load-bearing rather than stylistic: ``app/config/
logging_config.py`` contains a ``CorrelationIDMiddleware`` that writes
``response.headers["X-Correlation-ID"]`` **inside a module docstring**. A grep
reports it as an emitted header and sends a reader off to publish a name
nothing sends; the parser knows it is prose.

WHAT THIS DOES NOT COVER, stated so the green is not read as more than it is:

* **Only literal names.** A ``**`` splice into a ``headers=`` dict —
  ``**_export_provenance(...)`` in the session-repository export — contributes
  no literal to parse. That route is covered instead by
  ``test_session_repository_export_headers.py``, which asserts the builder's
  own keys equal ``EXPORT_PROVENANCE_HEADERS`` and that the tuple is published.
  A route emitting a dynamic set is expected to carry that pair of guards;
  this file covers the literal case everywhere else.
* **One direction only.** It asserts emitted ⊆ published ∪ allow-list, never
  the reverse. A published name with no emitter in ``app/`` is not a defect:
  slowapi injects the ``X-RateLimit-*`` trio itself from
  ``middleware/rate_limit.py``'s ``Limiter(headers_enabled=True)``, so those
  names are real and appear in no route. Asserting the reverse direction would
  fail on correct code.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

from app.main import CORS_EXPOSE_HEADERS

APP_ROOT = pathlib.Path(__file__).resolve().parent.parent / "app"

#: The Fetch standard's CORS-safelisted response headers — readable
#: cross-origin without being named in ``Access-Control-Expose-Headers``.
#: https://fetch.spec.whatwg.org/#cors-safelisted-response-header-name
CORS_SAFELISTED = frozenset(
    {
        "cache-control",
        "content-language",
        "content-length",
        "content-type",
        "expires",
        "last-modified",
        "pragma",
    }
)

#: Response headers deliberately NOT published to browser JS, each with the
#: reason. An entry here is a decision on the record, not a suppression: to
#: publish one, delete its entry and add the name to ``CORS_EXPOSE_HEADERS``.
DELIBERATELY_UNPUBLISHED: dict[str, str] = {
    # Enforced by the browser itself. JS never reads these; exposing them
    # would widen what a page can introspect for no consumer.
    "content-security-policy": "browser-enforced; no JS reader",
    "strict-transport-security": "browser-enforced; no JS reader",
    "x-frame-options": "browser-enforced; no JS reader",
    "x-content-type-options": "browser-enforced; no JS reader",
    "x-xss-protection": "browser-enforced; no JS reader",
    "referrer-policy": "browser-enforced; no JS reader",
    "permissions-policy": "browser-enforced; no JS reader",
    # A directive to the reverse proxy, consumed before the response leaves
    # the edge. It is meaningless to a browser.
    "x-accel-buffering": "nginx directive, not a client-facing value",
    # Emitted only when ENVIRONMENT == 'development' (middleware/
    # database_timing.py), and dev serves the frontend same-origin through
    # Next, where every header reads without CORS exposure. Publishing them
    # would advertise query counts in deployments that never send them.
    "x-query-count": "development-only, and dev is same-origin",
    "x-query-time-ms": "development-only, and dev is same-origin",
    # Every JS caller composes its own download filename (see
    # `session-repository/api.ts` and `BodyPanel.download`), so nothing reads
    # the server's. Publish it if a caller ever needs the server's spelling.
    "content-disposition": "no JS reader; each caller names its own download",
    # Conditional-request plumbing on the two upsert routes. Their callers are
    # the runner and the archiver over plain HTTP, which are not subject to
    # CORS at all. A browser doing If-None-Match here would need this
    # published.
    "etag": "upsert routes; callers are non-browser (runner/archiver)",
    "x-session-unchanged": "runner-facing; the JSON body carries `changed`",
    "x-artifact-unchanged": "runner-facing; the JSON body carries `changed`",
    # RFC 8594 / RFC 8288 deprecation signalling. `APIVersionMiddleware` is
    # not registered in `app.main` and `add_deprecation_headers` has no
    # caller outside its own module's examples, so no response carries these
    # today. Wire that middleware and publish these in the same change —
    # a deprecation notice no client can read is not a deprecation notice.
    "api-version": "emitter (APIVersionMiddleware) is not registered",
    "deprecation": "emitter (APIVersionMiddleware) is not registered",
    "sunset": "emitter (APIVersionMiddleware) is not registered",
    "link": "emitter (APIVersionMiddleware) is not registered",
    "warning": "emitter (APIVersionMiddleware) is not registered",
}


def _callee_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


def _emitted_headers() -> dict[str, list[str]]:
    """Literal response-header names written anywhere under ``app/``.

    Two shapes, and only two, because a third would be guesswork:

    * ``<anything>.headers["Name"] = ...`` — a write onto a response object.
    * ``SomethingResponse(..., headers={"Name": ...})`` — the constructor
      arm, restricted to callees whose name ends in ``Response`` so that an
      OUTBOUND ``httpx.post(headers=...)`` is not mistaken for something this
      app serves. That restriction is why ``X-Coord-Admin-Secret`` — a
      credential the app SENDS to coord — does not appear here and must never
      be "fixed" by publishing it.
    """
    found: dict[str, list[str]] = {}
    for path in sorted(APP_ROOT.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:  # pragma: no cover - a parse failure is a lint job
            continue
        rel = path.relative_to(APP_ROOT.parent)
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if (
                        isinstance(target, ast.Subscript)
                        and isinstance(target.value, ast.Attribute)
                        and target.value.attr == "headers"
                        and isinstance(target.slice, ast.Constant)
                        and isinstance(target.slice.value, str)
                    ):
                        found.setdefault(target.slice.value.lower(), []).append(
                            f"{rel}:{node.lineno}"
                        )
            elif isinstance(node, ast.Call) and _callee_name(node).endswith("Response"):
                for kw in node.keywords:
                    if kw.arg == "headers" and isinstance(kw.value, ast.Dict):
                        for key in kw.value.keys:
                            if isinstance(key, ast.Constant) and isinstance(
                                key.value, str
                            ):
                                found.setdefault(key.value.lower(), []).append(
                                    f"{rel}:{node.lineno}"
                                )
    return found


def test_the_scan_finds_the_headers_it_is_supposed_to_find() -> None:
    """The scan must be able to fail. A silently-empty walk would pass everything.

    Anchored on names that exercise both collecting arms plus the two things
    that must NOT be collected: prose inside a module docstring
    (``logging_config.CorrelationIDMiddleware``) and an OUTBOUND request
    header.

    ``content-disposition`` is the constructor-arm anchor rather than one of
    the ``X-`` provenance names on purpose: those are all emitted through
    ``**`` splices now, which is exactly the blind spot this file documents.
    """
    emitted = _emitted_headers()

    assert "x-request-id" in emitted, "the `.headers[...] =` arm found nothing"
    assert "content-disposition" in emitted, (
        "the `Response(headers=)` arm found nothing"
    )
    assert "x-correlation-id" not in emitted, (
        "collected a header that only exists inside a module docstring — the "
        "scan is matching text rather than parsed code"
    )
    assert "x-coord-admin-secret" not in emitted, (
        "collected an OUTBOUND request header; the callee filter is not "
        "excluding httpx calls, and publishing a credential name would be the "
        "consequence"
    )


def test_every_emitted_header_is_published_or_deliberately_not() -> None:
    """The rule ``CORS_EXPOSE_HEADERS`` states in prose, enforced.

    A new header reaches a browser only if it is in ``CORS_EXPOSE_HEADERS``.
    If it genuinely has no browser reader, say so in
    ``DELIBERATELY_UNPUBLISHED`` with the reason — that is a decision on the
    record, and it is cheap to revisit. What must not happen is the third
    option: a header that is sent, is not published, and nobody decided which
    it was.
    """
    published = {name.lower() for name in CORS_EXPOSE_HEADERS}
    unaccounted = {
        name: sites
        for name, sites in _emitted_headers().items()
        if name not in published
        and name not in DELIBERATELY_UNPUBLISHED
        and name not in CORS_SAFELISTED
    }

    assert not unaccounted, (
        "These response headers are emitted but not readable by a cross-origin "
        "browser, and no decision is recorded for them:\n"
        + "\n".join(
            f"  {name} — {', '.join(sites)}"
            for name, sites in sorted(unaccounted.items())
        )
        + "\n\nAdd each to app.main.CORS_EXPOSE_HEADERS, or to "
        "DELIBERATELY_UNPUBLISHED in this file with the reason it has no "
        "browser reader."
    )


def test_the_allow_list_has_not_gone_stale() -> None:
    """An entry that names a header nothing emits is a stale claim, not a guard.

    Without this, a deleted route leaves its exemption behind and the next
    reader takes it for a live decision.
    """
    emitted = set(_emitted_headers())
    stale = sorted(name for name in DELIBERATELY_UNPUBLISHED if name not in emitted)

    assert not stale, (
        "DELIBERATELY_UNPUBLISHED names headers this app no longer emits: "
        f"{stale}. Delete the entries — an exemption for a header nothing "
        "sends reads as a decision that is still being made."
    )


def test_no_header_is_both_published_and_exempted() -> None:
    """The two lists must not disagree about the same name."""
    published = {name.lower() for name in CORS_EXPOSE_HEADERS}
    both = sorted(published & set(DELIBERATELY_UNPUBLISHED))

    assert not both, (
        f"{both} are in CORS_EXPOSE_HEADERS and in DELIBERATELY_UNPUBLISHED. "
        "One of the two is wrong; the header is either readable or it is not."
    )


def test_publishing_a_safelisted_name_would_be_a_no_op() -> None:
    """Nothing in ``CORS_EXPOSE_HEADERS`` should be a header browsers expose anyway.

    A safelisted name in that list is dead weight that also makes the list
    look like it is doing more than it is — the same vacuous-coverage trap
    ``test_the_exposure_is_load_bearing_not_a_restatement_of_the_default``
    guards for the export tuple, applied to the whole list.
    """
    redundant = sorted({n.lower() for n in CORS_EXPOSE_HEADERS} & CORS_SAFELISTED)

    assert not redundant, (
        f"{redundant} are CORS-safelisted and readable without being published; "
        "listing them adds nothing."
    )


@pytest.mark.parametrize("reason", DELIBERATELY_UNPUBLISHED.values())
def test_every_exemption_carries_a_reason(reason: str) -> None:
    """An empty reason is an exemption nobody can review."""
    assert reason.strip(), "an exemption must say why the header has no browser reader"
