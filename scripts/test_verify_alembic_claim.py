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


class SetDownRevisionTests(unittest.TestCase):
    """The reserve mode's write-back of coord's ASSIGNED down_revision."""

    def test_rewrites_typed_none_placeholder(self) -> None:
        text = 'revision: str = "abc"\ndown_revision: Union[str, None] = None\n'
        out = vac.set_down_revision(text, "assigned_head")
        self.assertIn('down_revision: Union[str, None] = "assigned_head"', out)
        # The revision line and its typing are untouched.
        self.assertIn('revision: str = "abc"', out)
        # The new value round-trips through the parser.
        _rev, down = (
            vac.REVISION_RE.search(out),
            vac.DOWN_REVISION_RE.search(out),
        )
        self.assertEqual(down.group("id"), "assigned_head")

    def test_rewrites_existing_string_value(self) -> None:
        text = 'revision = "abc"\ndown_revision = "old_head"\n'
        out = vac.set_down_revision(text, "new_head")
        self.assertIn('down_revision = "new_head"', out)
        self.assertNotIn("old_head", out)

    def test_raises_when_no_down_revision_line(self) -> None:
        with self.assertRaises(ValueError):
            vac.set_down_revision('revision = "abc"\n', "head")


class InterpretReserveResultTests(unittest.TestCase):
    def test_200_returns_assigned(self) -> None:
        resp = vac.HttpResponse(
            200, {"reservation_id": "r1", "down_revision": "headA", "position": 1}
        )
        ok, assigned = vac.interpret_reserve_result(PATH, "newrev", resp)
        self.assertTrue(ok)
        self.assertEqual(assigned, "headA")

    def test_409_duplicate_reuses_existing_assignment(self) -> None:
        resp = vac.HttpResponse(
            409,
            {
                "error": "duplicate_revision",
                "reservation": {"id": "r9", "down_revision": "headB"},
            },
        )
        ok, assigned = vac.interpret_reserve_result(PATH, "newrev", resp)
        self.assertTrue(ok)
        self.assertEqual(assigned, "headB")

    def test_503_fails(self) -> None:
        resp = vac.HttpResponse(503, {"error": "mirror_unavailable"})
        ok, assigned = vac.interpret_reserve_result(PATH, "newrev", resp)
        self.assertFalse(ok)
        self.assertIsNone(assigned)

    def test_multi_head_503_fails(self) -> None:
        resp = vac.HttpResponse(503, {"error": "multi_head", "heads": ["a", "b"]})
        ok, assigned = vac.interpret_reserve_result(PATH, "newrev", resp)
        self.assertFalse(ok)
        self.assertIsNone(assigned)


class ReserveFakeClient(vac.CoordClient):
    """CoordClient whose reserve transport is replaced by a canned response."""

    def __init__(self, reserve_response: vac.HttpResponse) -> None:
        super().__init__("http://fake")
        self._reserve_response = reserve_response
        self.reserve_calls: list[tuple[str, str, str]] = []

    def reserve(self, repo: str, revision: str, machine_id: str) -> vac.HttpResponse:
        self.reserve_calls.append((repo, revision, machine_id))
        return self._reserve_response


class ReserveFileTests(unittest.TestCase):
    def _write(self, content: str) -> Path:
        import tempfile

        f = tempfile.NamedTemporaryFile(
            "w", suffix=".py", delete=False, encoding="utf-8"
        )
        f.write(content)
        f.close()
        return Path(f.name)

    def test_reserve_writes_assigned_down_revision(self) -> None:
        path = self._write(
            'revision: str = "newrev"\ndown_revision: Union[str, None] = None\n'
        )
        client = ReserveFakeClient(
            vac.HttpResponse(
                200, {"reservation_id": "r1", "down_revision": "coord_head"}
            )
        )
        ok, msg = vac.reserve_file(client, path, "newrev", "machine-uuid")
        self.assertTrue(ok)
        self.assertEqual(client.reserve_calls, [(vac.REPO, "newrev", "machine-uuid")])
        # coord's assignment was written verbatim — never computed locally.
        _rev, down = vac.parse_revision_file(path)
        self.assertEqual(down, "coord_head")
        self.assertIn("coord_head", msg)

    def test_reserve_stacked_position_writes_in_flight_tail(self) -> None:
        # position > 1: coord assigns the in-flight queue tail, not the main
        # head — the client writes it verbatim regardless.
        path = self._write('revision = "stacked"\ndown_revision = "stale_local_head"\n')
        client = ReserveFakeClient(
            vac.HttpResponse(
                200,
                {
                    "reservation_id": "r2",
                    "down_revision": "inflight_tail",
                    "position": 3,
                },
            )
        )
        ok, _msg = vac.reserve_file(client, path, "stacked", "m")
        self.assertTrue(ok)
        _rev, down = vac.parse_revision_file(path)
        self.assertEqual(down, "inflight_tail")

    def test_reserve_already_chained_no_rewrite(self) -> None:
        path = self._write('revision = "newrev"\ndown_revision = "coord_head"\n')
        before = path.read_text(encoding="utf-8")
        client = ReserveFakeClient(
            vac.HttpResponse(200, {"down_revision": "coord_head"})
        )
        ok, msg = vac.reserve_file(client, path, "newrev", "m")
        self.assertTrue(ok)
        self.assertEqual(path.read_text(encoding="utf-8"), before)
        self.assertIn("no rewrite needed", msg)

    def test_reserve_failure_leaves_file_unchanged(self) -> None:
        path = self._write('revision = "newrev"\ndown_revision = None\n')
        before = path.read_text(encoding="utf-8")
        client = ReserveFakeClient(
            vac.HttpResponse(503, {"error": "mirror_unavailable"})
        )
        ok, msg = vac.reserve_file(client, path, "newrev", "m")
        self.assertFalse(ok)
        self.assertEqual(path.read_text(encoding="utf-8"), before)
        self.assertIn("reserve failed", msg)


if __name__ == "__main__":
    unittest.main()
