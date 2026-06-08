#!/usr/bin/env python3
"""Focused unit tests for the migration reservation gate decision logic.

Stdlib-only (``unittest``) so it can run without installing anything — the
``verify-alembic-claim.yml`` workflow installs no test deps. Also discoverable
by pytest (``test_*`` names). The HTTP layer is faked: ``decide`` and
``interpret_bind_result`` are pure given their inputs, and the orchestration
test injects a fake ``CoordClient`` so no network is touched.

Run::

    python -m unittest scripts.test_verify_alembic_claim
    # or, from the scripts/ dir:
    python -m unittest test_verify_alembic_claim
    # or:
    python -m pytest scripts/test_verify_alembic_claim.py
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

# Load the sibling module by path so this works whether invoked as
# ``scripts.test_...`` or from inside scripts/. Register in sys.modules
# BEFORE exec so dataclass's ``cls.__module__`` lookup resolves.
_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "verify_alembic_claim", _HERE / "verify_alembic_claim.py"
)
assert _spec and _spec.loader
vac = importlib.util.module_from_spec(_spec)
sys.modules["verify_alembic_claim"] = vac
_spec.loader.exec_module(vac)


PATH = Path("backend/alembic/versions/0001_example.py")


def _res(**overrides: object) -> dict:
    base = {
        "id": "res-123",
        "repo": "qontinui-web",
        "revision": "newrev",
        "down_revision": "headA",
        "state": "queued",
        "pr_number": None,
    }
    base.update(overrides)
    return base


class FindReservationTests(unittest.TestCase):
    def test_matches_queued(self) -> None:
        q = [_res(revision="other"), _res(revision="newrev")]
        found = vac.find_reservation(q, "newrev")
        self.assertIsNotNone(found)
        self.assertEqual(found["revision"], "newrev")

    def test_ignores_terminal_states(self) -> None:
        q = [_res(revision="newrev", state="withdrawn")]
        self.assertIsNone(vac.find_reservation(q, "newrev"))

    def test_finds_pr_bound(self) -> None:
        q = [_res(revision="newrev", state="pr_bound", pr_number=42)]
        self.assertIsNotNone(vac.find_reservation(q, "newrev"))

    def test_not_found(self) -> None:
        self.assertIsNone(vac.find_reservation([], "newrev"))


class DecideTests(unittest.TestCase):
    def test_match_auto_bind(self) -> None:
        """queued + matching down_revision → bind."""
        res = _res(state="queued", down_revision="headA")
        d = vac.decide(PATH, "newrev", "headA", res, pr_number=7)
        self.assertEqual(d.action, "bind")
        self.assertEqual(d.reservation_id, "res-123")

    def test_idempotent_already_bound_to_this_pr(self) -> None:
        res = _res(state="pr_bound", down_revision="headA", pr_number=7)
        d = vac.decide(PATH, "newrev", "headA", res, pr_number=7)
        self.assertEqual(d.action, "pass")

    def test_bound_to_other_pr_same_revision_fails(self) -> None:
        res = _res(state="pr_bound", down_revision="headA", pr_number=99)
        d = vac.decide(PATH, "newrev", "headA", res, pr_number=7)
        self.assertEqual(d.action, "fail")
        self.assertIn("#99", d.message)

    def test_repointed_mismatch_fails(self) -> None:
        """File chains off headA but coord re-assigned headB → corrective."""
        res = _res(state="queued", down_revision="headB")
        d = vac.decide(PATH, "newrev", "headA", res, pr_number=7)
        self.assertEqual(d.action, "fail")
        self.assertIn("coord assigned down_revision='headB'", d.message)
        self.assertIn("your file has 'headA'", d.message)
        self.assertIn("re-binds automatically", d.message)

    def test_missing_reservation_fails(self) -> None:
        d = vac.decide(PATH, "newrev", "headA", None, pr_number=7)
        self.assertEqual(d.action, "fail")
        self.assertIn("no reservation for revision 'newrev'", d.message)
        self.assertIn("/coord/migrations/reserve", d.message)

    def test_mismatch_takes_priority_when_bound_elsewhere(self) -> None:
        """A pr_bound-to-other reservation whose assignment differs from the
        file still surfaces the rechain correction (mismatch checked first)."""
        res = _res(state="pr_bound", down_revision="headB", pr_number=99)
        d = vac.decide(PATH, "newrev", "headA", res, pr_number=7)
        self.assertEqual(d.action, "fail")
        self.assertIn("coord assigned down_revision='headB'", d.message)


class InterpretBindResultTests(unittest.TestCase):
    def test_200_pass(self) -> None:
        resp = vac.HttpResponse(200, {"state": "pr_bound"})
        ok, msg = vac.interpret_bind_result(PATH, resp)
        self.assertTrue(ok)
        self.assertIn("BOUND", msg)

    def test_409_file_mismatch(self) -> None:
        resp = vac.HttpResponse(
            409,
            {
                "error": "file_mismatch",
                "expected_down_revision": "headA",
                "found_down_revision": "headZ",
            },
        )
        ok, msg = vac.interpret_bind_result(PATH, resp)
        self.assertFalse(ok)
        self.assertIn("file_mismatch", msg)
        self.assertIn("headA", msg)
        self.assertIn("headZ", msg)

    def test_503_degraded_fail_closed(self) -> None:
        resp = vac.HttpResponse(503, {"error": "github_app_degraded"})
        ok, msg = vac.interpret_bind_result(PATH, resp)
        self.assertFalse(ok)
        self.assertIn("GitHub App", msg)
        self.assertIn("retry later", msg)

    def test_other_status_fails(self) -> None:
        resp = vac.HttpResponse(500, {"error": "boom"})
        ok, msg = vac.interpret_bind_result(PATH, resp)
        self.assertFalse(ok)
        self.assertIn("500", msg)


class FakeClient(vac.CoordClient):
    """CoordClient whose transport is replaced by canned responses."""

    def __init__(self, bind_response: vac.HttpResponse) -> None:
        super().__init__("http://fake")
        self._bind_response = bind_response
        self.bind_calls: list[tuple[str, str]] = []

    def bind_pr(self, reservation_id: str, pr_url: str) -> vac.HttpResponse:
        self.bind_calls.append((reservation_id, pr_url))
        return self._bind_response


class ProcessFileTests(unittest.TestCase):
    def test_auto_bind_happy_path_calls_bind_and_passes(self) -> None:
        client = FakeClient(vac.HttpResponse(200, {"state": "pr_bound"}))
        queue = [_res(state="queued", down_revision="headA")]
        ok, msg = vac.process_file(
            client,
            queue,
            PATH,
            "newrev",
            "headA",
            pr_url="https://github.com/org/qontinui-web/pull/7",
            pr_number=7,
        )
        self.assertTrue(ok)
        self.assertEqual(len(client.bind_calls), 1)
        self.assertEqual(
            client.bind_calls[0],
            ("res-123", "https://github.com/org/qontinui-web/pull/7"),
        )

    def test_degraded_bind_fails_closed_no_pass(self) -> None:
        client = FakeClient(vac.HttpResponse(503, {"error": "degraded"}))
        queue = [_res(state="queued", down_revision="headA")]
        ok, msg = vac.process_file(
            client,
            queue,
            PATH,
            "newrev",
            "headA",
            pr_url="https://x/pull/7",
            pr_number=7,
        )
        self.assertFalse(ok)
        self.assertIn("retry later", msg)

    def test_409_file_mismatch_from_coord_fails(self) -> None:
        client = FakeClient(
            vac.HttpResponse(
                409,
                {
                    "error": "file_mismatch",
                    "expected_down_revision": "headA",
                    "found_down_revision": "headZ",
                },
            )
        )
        queue = [_res(state="queued", down_revision="headA")]
        ok, msg = vac.process_file(
            client,
            queue,
            PATH,
            "newrev",
            "headA",
            pr_url="https://x/pull/7",
            pr_number=7,
        )
        self.assertFalse(ok)
        self.assertIn("file_mismatch", msg)

    def test_missing_reservation_no_bind_call(self) -> None:
        client = FakeClient(vac.HttpResponse(200, {}))
        ok, msg = vac.process_file(
            client,
            [],
            PATH,
            "newrev",
            "headA",
            pr_url="https://x/pull/7",
            pr_number=7,
        )
        self.assertFalse(ok)
        self.assertEqual(client.bind_calls, [])
        self.assertIn("no reservation", msg)

    def test_idempotent_rerun_no_bind_call(self) -> None:
        client = FakeClient(vac.HttpResponse(200, {}))
        queue = [_res(state="pr_bound", down_revision="headA", pr_number=7)]
        ok, msg = vac.process_file(
            client,
            queue,
            PATH,
            "newrev",
            "headA",
            pr_url="https://x/pull/7",
            pr_number=7,
        )
        self.assertTrue(ok)
        self.assertEqual(client.bind_calls, [])
        self.assertIn("re-run OK", msg)

    def test_bind_ready_but_no_pr_url_fails(self) -> None:
        client = FakeClient(vac.HttpResponse(200, {}))
        queue = [_res(state="queued", down_revision="headA")]
        ok, msg = vac.process_file(
            client,
            queue,
            PATH,
            "newrev",
            "headA",
            pr_url=None,
            pr_number=7,
        )
        self.assertFalse(ok)
        self.assertEqual(client.bind_calls, [])
        self.assertIn("no PR URL", msg)


class ParseTests(unittest.TestCase):
    """Confirm the preserved parse logic still works (regression guard)."""

    def test_parse_typed_and_untyped(self) -> None:
        import tempfile

        content = (
            'revision: str = "abc123"\ndown_revision: Union[str, None] = "def456"\n'
        )
        with tempfile.NamedTemporaryFile(
            "w", suffix=".py", delete=False, encoding="utf-8"
        ) as f:
            f.write(content)
            p = Path(f.name)
        rev, down = vac.parse_revision_file(p)
        self.assertEqual(rev, "abc123")
        self.assertEqual(down, "def456")


if __name__ == "__main__":
    unittest.main()
