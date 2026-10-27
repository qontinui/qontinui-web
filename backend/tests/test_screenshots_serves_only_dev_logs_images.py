"""``GET /api/v1/screenshots/{path}`` serves image files under ``.dev-logs`` only.

The route takes no credential. On a dev or co-located backend its
``_parent_dir()`` is the workspace root (``parents[6]`` of the module), which
holds every checkout, and it used to serve ANY regular file there: a caller with
no account read ``qontinui-web/backend/.env``, whose ``DATABASE_URL`` writes the
``project.apps`` build and start commands that the platform-admin gates on
``/fleet/apps`` protect (coord finding ``b27adf71-4de5-49bc-ad89-7a8acd372035``,
review round 4). Its runner arm forwarded the path to the co-located runner,
where ``list`` reached ``GET /screenshots/list`` (every screenshot's absolute
path) and only a ``..`` check stood between ``%2e%2e/apps`` and ``GET /apps``.

Every request here enters over real HTTP with no credential: a uvicorn server
on loopback serving ``app.main:app`` with all its middleware, so the
percent-decoding is uvicorn's own and each encoded variant arrives exactly as a
client's would. ``_parent_dir()`` points at a temporary workspace of stand-in
files (no real secret is read), and the runner arm at a stand-in runner that
records every request target it receives. What came back, and what the
stand-in received, are the evidence.
"""

from __future__ import annotations

import http.client
import json
import socket
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath

import httpx
import pytest

from app.api.v1.endpoints import screenshots
from app.api.v1.endpoints.screenshots import _parent_dir as real_parent_dir

PREFIX = "/api/v1/screenshots/"

#: A stand-in credential, written into the stand-in ``.env`` and logs. No
#: response may carry it.
SECRET = b"postgresql://stand-in:stand-in-password@db.invalid:5432/apps"

PNG = b"\x89PNG\r\n\x1a\nstand-in screenshot"
#: An image OUTSIDE ``.dev-logs``: an image, and still never served.
STRAY = b"\x89PNG\r\n\x1a\nstand-in image outside .dev-logs"
#: What the stand-in runner answers for an image it serves.
REMOTE = b"\x89PNG\r\n\x1a\nstand-in image from the runner"
#: What the runner's ``GET /screenshots/list`` discloses.
LISTED_PATH = "/home/operator/ws/.dev-logs/screenshots/shot.png"

#: Everything a response must never carry.
NEVER = (SECRET, STRAY, LISTED_PATH.encode(), b"buildCommand")


def _write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


# ---------------------------------------------------------------------------
# The stand-ins
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A workspace root as ``parents[6]`` is on a dev box, stand-in files only."""
    root = tmp_path / "workspace"
    dev_logs = root / ".dev-logs"
    _write(root / "qontinui-web/backend/.env", b"DATABASE_URL=" + SECRET + b"\n")
    _write(root / "stray.png", STRAY)
    _write(root / "qontinui-web/docs/diagram.png", STRAY)
    _write(dev_logs / "backend.log", b"connected to " + SECRET + b"\n")
    _write(dev_logs / "screenshots/notes.txt", SECRET)
    for name in (
        "screenshots/shot.png",
        "screenshots/UPPER.PNG",
        "screenshots/photo.jpg",
        "screenshots/photo.jpeg",
        "screenshots/anim.gif",
        "screenshots/pic.webp",
        "playwright-screenshots/login page.png",
        "mobile/screenshots/tap.png",
    ):
        _write(dev_logs / name, PNG + name.encode())
    (dev_logs / "screenshots/dir.png").mkdir()
    monkeypatch.setattr(screenshots, "_parent_dir", lambda: root)
    return root


class _QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: object, client_address: object) -> None:
        """A client that timed out leaves a broken pipe: not a test failure."""


class StandInRunner:
    """A loopback HTTP server standing in for the co-located runner.

    It records every request target it receives. It answers
    ``/screenshots/list`` and ``/apps`` as the runner does (an absolute path; a
    build command), serves ``/screenshots/remote.png`` and
    ``/screenshots/remote%20shot.png`` with image bytes it LABELS
    ``text/html``, answers ``/screenshots/broken.png`` with a 500, sits on
    ``/screenshots/slow.png`` for two seconds, and 404s anything else.
    """

    def __init__(self) -> None:
        self.seen: list[str] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - the stdlib's name
                outer.seen.append(self.path)
                route = self.path.split("?", 1)[0]
                if route == "/screenshots/list":
                    body = {
                        "success": True,
                        "data": {"annotated": [{"path": LISTED_PATH}]},
                    }
                    self._answer(200, "application/json", json.dumps(body).encode())
                elif route == "/apps":
                    body = {
                        "apps": [{"appId": "acme-app", "buildCommand": "npm run build"}]
                    }
                    self._answer(200, "application/json", json.dumps(body).encode())
                elif route in (
                    "/screenshots/remote.png",
                    "/screenshots/remote%20shot.png",
                ):
                    self._answer(200, "text/html", REMOTE)
                elif route == "/screenshots/broken.png":
                    self._answer(500, "application/json", b'{"error": "boom"}')
                elif route == "/screenshots/slow.png":
                    time.sleep(2)
                    self._answer(200, "image/png", REMOTE)
                else:
                    self._answer(404, "application/json", b'{"error": "not found"}')

            def _answer(self, status: int, content_type: str, body: bytes) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: object) -> None:
                pass

        self.server = _QuietServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture(autouse=True)
def runner(monkeypatch: pytest.MonkeyPatch) -> Iterator[StandInRunner]:
    """Point the runner arm at a stand-in, in EVERY test: none may reach the
    real runner this box may be running on 9876."""
    stand_in = StandInRunner()
    monkeypatch.setattr(screenshots, "_RUNNER_HOST", "127.0.0.1")
    monkeypatch.setattr(screenshots, "_RUNNER_PORT", stand_in.port)
    try:
        yield stand_in
    finally:
        stand_in.close()


@pytest.fixture(scope="module")
def server_port() -> Iterator[int]:
    """``app.main:app`` behind a real uvicorn server on loopback."""
    import uvicorn

    from app.main import app

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        lifespan="off",
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 30
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            raise RuntimeError("the uvicorn server did not start")
        time.sleep(0.02)
    try:
        yield server.servers[0].sockets[0].getsockname()[1]
    finally:
        server.should_exit = True
        thread.join(timeout=30)


def _get(port: int, raw: str) -> tuple[int, str, bytes]:
    """GET ``PREFIX + raw`` with ``raw`` sent byte for byte, no credential.

    ``http.client`` normalizes nothing: a ``..`` or a ``%2e`` reaches uvicorn
    exactly as written, as from ``curl --path-as-is``.
    """
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    try:
        conn.request("GET", PREFIX + raw)
        resp = conn.getresponse()
        return resp.status, resp.getheader("content-type") or "", resp.read()
    finally:
        conn.close()


def _assert_discloses_nothing(body: bytes) -> None:
    for never in NEVER:
        assert never not in body, f"the response carried {never!r}: {body!r}"


# ---------------------------------------------------------------------------
# What is served
# ---------------------------------------------------------------------------

#: (the path asked for, the file under ``.dev-logs`` it names, its media type)
SERVED = [
    # What the ai-tasks page's ``screenshotUrl`` asks for.
    ("screenshots/shot.png", "screenshots/shot.png", "image/png"),
    (".dev-logs/screenshots/shot.png", "screenshots/shot.png", "image/png"),
    # A leading .dev-logs/ is dropped before the direct lookup. tap.png sits
    # in mobile/screenshots/, where no lookup by file name looks.
    (
        ".dev-logs/mobile/screenshots/tap.png",
        "mobile/screenshots/tap.png",
        "image/png",
    ),
    # Absolute paths a runner recorded, POSIX and (as a browser sends it)
    # Windows, found by file name in screenshots/ and playwright-screenshots/.
    (LISTED_PATH, "screenshots/shot.png", "image/png"),
    (
        "C:/Users/op/ws/.dev-logs/screenshots/shot.png",
        "screenshots/shot.png",
        "image/png",
    ),
    (
        "/home/operator/ws/.dev-logs/playwright-screenshots/login%20page.png",
        "playwright-screenshots/login page.png",
        "image/png",
    ),
    (
        "playwright-screenshots/login%20page.png",
        "playwright-screenshots/login page.png",
        "image/png",
    ),
    ("mobile/screenshots/tap.png", "mobile/screenshots/tap.png", "image/png"),
    ("screenshots/UPPER.PNG", "screenshots/UPPER.PNG", "image/png"),
    ("screenshots/photo.jpg", "screenshots/photo.jpg", "image/jpeg"),
    ("screenshots/photo.jpeg", "screenshots/photo.jpeg", "image/jpeg"),
    ("screenshots/anim.gif", "screenshots/anim.gif", "image/gif"),
    ("screenshots/pic.webp", "screenshots/pic.webp", "image/webp"),
]


@pytest.mark.parametrize(("raw", "name", "media_type"), SERVED)
def test_a_dev_logs_image_is_served_from_disk(
    server_port: int, runner: StandInRunner, raw: str, name: str, media_type: str
) -> None:
    status, content_type, body = _get(server_port, raw)

    assert status == 200, body
    assert body == PNG + name.encode()
    assert content_type == media_type
    assert runner.seen == [], f"a local file reached the runner: {runner.seen}"


# ---------------------------------------------------------------------------
# What is not
# ---------------------------------------------------------------------------

#: (the path asked for, what the runner arm may forward for it). A path that is
#: no image's never reaches the runner; an image path that resolves to nothing
#: servable here is asked of the runner as itself, and the stand-in 404s it.
NOT_SERVED = [
    # The finding's own file, and the other non-images under the workspace.
    ("qontinui-web/backend/.env", []),
    ("screenshots/notes.txt", []),
    # A non-image under .dev-logs: logs are not screenshots.
    (".dev-logs/backend.log", []),
    ("backend.log", []),
    # Images outside .dev-logs.
    ("stray.png", ["/screenshots/stray.png"]),
    ("qontinui-web/docs/diagram.png", ["/screenshots/qontinui-web/docs/diagram.png"]),
    # A directory named like an image.
    ("screenshots/dir.png", ["/screenshots/screenshots/dir.png"]),
    # Leading slashes are dropped, so these name the same files as above.
    ("/stray.png", ["/screenshots/stray.png"]),
    ("%2f%2fstray.png", ["/screenshots/stray.png"]),
    ("/qontinui-web/backend/.env", []),
]


@pytest.mark.parametrize(("raw", "forwarded"), NOT_SERVED)
def test_anything_but_an_image_inside_dev_logs_is_not_served(
    server_port: int, runner: StandInRunner, raw: str, forwarded: list[str]
) -> None:
    status, _content_type, body = _get(server_port, raw)

    assert status == 404, body
    _assert_discloses_nothing(body)
    assert runner.seen == forwarded


#: Symlinks under ``.dev-logs``, judged by where they land: (the link, its
#: target relative to the link's directory).
SYMLINKS = [
    # Out of .dev-logs, to the .env.
    ("screenshots/leak.png", "../../qontinui-web/backend/.env"),
    # Out of .dev-logs, to an image.
    ("screenshots/stray-link.png", "../../stray.png"),
    # Inside .dev-logs, to a log.
    ("screenshots/log.png", "../backend.log"),
]


@pytest.mark.parametrize(("link", "target"), SYMLINKS)
def test_a_symlink_is_judged_by_where_it_lands(
    server_port: int, runner: StandInRunner, workspace: Path, link: str, target: str
) -> None:
    try:
        (workspace / ".dev-logs" / link).symlink_to(target)
    except OSError as exc:  # e.g. Windows without the symlink privilege
        pytest.skip(f"this host cannot create a symlink: {exc}")

    status, _content_type, body = _get(server_port, link)

    assert status == 404, body
    _assert_discloses_nothing(body)
    # Nothing local was servable, so the runner was asked for the image path.
    assert runner.seen == [f"/screenshots/{link}"]


def test_a_dev_logs_that_is_itself_a_link_serves_where_it_resolves(
    server_port: int, runner: StandInRunner, workspace: Path, tmp_path: Path
) -> None:
    """``.dev-logs`` may be a link (to a larger disk, say). An image is judged
    against the directory the link resolves to: no resolved file is inside
    the link's own path."""
    target = tmp_path / "elsewhere" / "dev-logs"
    target.parent.mkdir()
    (workspace / ".dev-logs").rename(target)
    try:
        (workspace / ".dev-logs").symlink_to(target, target_is_directory=True)
    except OSError as exc:  # e.g. Windows without the symlink privilege
        pytest.skip(f"this host cannot create a symlink: {exc}")

    status, content_type, body = _get(server_port, "screenshots/shot.png")

    assert status == 200, body
    assert body == PNG + b"screenshots/shot.png"
    assert content_type == "image/png"
    assert runner.seen == [], f"a local file reached the runner: {runner.seen}"


#: Traversal and its encodings, ``.``/empty segments, and the characters that
#: escape a segment or a URL path. Each is refused before the filesystem or the
#: runner is consulted.
REFUSED = [
    "../qontinui-web/backend/.env",
    "../stray.png",
    "screenshots/../../stray.png",
    "screenshots/../../qontinui-web/backend/.env",
    "%2e%2e/stray.png",
    ".%2e/stray.png",
    "%2e./stray.png",
    "%2e%2e%2fstray.png",
    "screenshots%2f..%2f..%2fstray.png",
    "screenshots/%2e%2e/%2e%2e/qontinui-web/backend/.env",
    "..%5cstray.png",
    "screenshots%5c..%5c..%5cstray.png",
    "..%5c..%5cqontinui-web%5cbackend%5c.env",
    "%252e%252e/stray.png",
    "screenshots/%252e%252e%252f%252e%252e%252fstray.png",
    "./screenshots/shot.png",
    "screenshots/./shot.png",
    "screenshots//shot.png",
    "screenshots/shot.png/",
    "screenshots/shot.png%00",
    "screenshots/shot%00.png",
    "screenshots/shot.png%00.txt",
    "screenshots/shot%0a.png",
    "screenshots/shot.png%3F.txt",
    "screenshots/shot.png%23.txt",
    "",
]


@pytest.mark.parametrize("raw", REFUSED)
def test_traversal_and_encoded_variants_are_refused(
    server_port: int, runner: StandInRunner, raw: str
) -> None:
    status, _content_type, body = _get(server_port, raw)

    assert status == 404, body
    _assert_discloses_nothing(body)
    assert PNG not in body
    assert runner.seen == [], f"the runner was asked: {runner.seen}"


def test_a_refused_path_gets_the_typed_not_found_refusal(server_port: int) -> None:
    status, _content_type, body = _get(server_port, "qontinui-web/backend/.env")

    assert status == 404
    refusal = json.loads(body)["refusal"]
    assert refusal["code"] == "not_found"
    assert refusal["discriminator"] == "screenshot_not_found"
    assert refusal["next_action"]["kind"] == "none_terminal"


# ---------------------------------------------------------------------------
# The runner arm
# ---------------------------------------------------------------------------

#: Paths that, forwarded as they were, reached the runner's
#: ``GET /screenshots/list`` (every screenshot's absolute path) or, but for one
#: ``..`` check, its ``GET /apps`` (every build command).
RUNNER_REWRITES = [
    "list",
    "list%3Fx",
    "list%23x",
    "./list",
    "%2e/list",
    "list%3Fx.png",
    "list%23.png",
    "%2e%2e/apps",
    "%2e%2e/apps.png",
    "%2e%2e%2fapps%23.png",
    "%252e%252e/apps.png",
]


@pytest.mark.parametrize("raw", RUNNER_REWRITES)
def test_the_runner_listing_and_registry_are_out_of_reach(
    server_port: int, runner: StandInRunner, raw: str
) -> None:
    status, _content_type, body = _get(server_port, raw)

    assert status == 404, body
    _assert_discloses_nothing(body)
    assert runner.seen == [], f"the runner was asked: {runner.seen}"


@pytest.mark.parametrize(
    ("raw", "target"),
    [
        ("remote.png", "/screenshots/remote.png"),
        ("remote%20shot.png", "/screenshots/remote%20shot.png"),
    ],
)
def test_an_image_from_the_runner_goes_out_as_its_suffix_says(
    server_port: int, runner: StandInRunner, raw: str, target: str
) -> None:
    status, content_type, body = _get(server_port, raw)

    assert status == 200, body
    assert body == REMOTE
    # The stand-in labelled it text/html; the route serves what was asked for.
    assert content_type == "image/png"
    assert runner.seen == [target]


def test_a_runner_failure_is_a_bad_gateway(
    server_port: int, runner: StandInRunner
) -> None:
    status, _content_type, body = _get(server_port, "broken.png")

    assert status == 502, body
    assert json.loads(body)["refusal"]["discriminator"] == "runner_screenshot_refused"
    assert runner.seen == ["/screenshots/broken.png"]


def test_a_slow_runner_is_a_gateway_timeout(
    server_port: int, runner: StandInRunner, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(screenshots, "_RUNNER_TIMEOUT_S", 0.2)

    status, _content_type, body = _get(server_port, "slow.png")

    assert status == 504, body
    assert json.loads(body)["refusal"]["discriminator"] == "runner_screenshot_timeout"


def test_no_runner_is_not_found(
    server_port: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        closed_port = probe.getsockname()[1]
    monkeypatch.setattr(screenshots, "_RUNNER_PORT", closed_port)

    status, _content_type, body = _get(server_port, "remote.png")

    assert status == 404, body
    assert json.loads(body)["refusal"]["discriminator"] == "screenshot_not_found"


@pytest.mark.parametrize("name", ["list#.png", "list?x.png"])
def test_the_runner_url_never_reads_a_query_or_fragment_from_the_path(
    name: str,
) -> None:
    """Below the request shape: composed, a delimiter is refused, where an
    f-string URL read ``list#.png`` as ``/screenshots/list``."""
    with pytest.raises(httpx.InvalidURL):
        screenshots._runner_url(PurePosixPath(name))


def test_the_runner_url_keeps_the_path_a_path() -> None:
    url = screenshots._runner_url(PurePosixPath("C:/a b@[1].png"))

    assert url.host == "127.0.0.1"
    assert url.raw_path == b"/screenshots/C:/a%20b@[1].png"


# ---------------------------------------------------------------------------
# Where the local branch exists at all
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("module_file", "parent"),
    [
        # The deployed image: WORKDIR /app plus COPY . . — six parents, so no
        # local branch at all.
        ("/app/app/api/v1/endpoints/screenshots.py", None),
        # A checkout: parents[6] is the workspace root holding every checkout.
        (
            "/ws/qontinui-web/backend/app/api/v1/endpoints/screenshots.py",
            Path("/ws"),
        ),
    ],
)
def test_the_local_branch_exists_only_in_a_checkout(
    monkeypatch: pytest.MonkeyPatch, module_file: str, parent: Path | None
) -> None:
    monkeypatch.setattr(screenshots, "__file__", module_file)

    assert real_parent_dir() == parent
