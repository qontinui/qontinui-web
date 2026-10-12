"""Fleet nouns in ``backend/app`` may not grow — an exact per-(file, class, token) ratchet.

A *fleet noun* is a word true on the Qontinui maintainers' machines and false
on every user's install: a sibling-repo checkout (``qontinui-dev-notes``,
``qontinui-root``), a dev-stack port (``localhost:8000``), the dev-only
supervisor (``:9875``), a fleet host or device id, the maintainers' tenant, an
operator's absolute path. The ONE vocabulary of them is
``qontinui-schemas/fleet-nouns.toml``; this module reads it at the commit
``fleet-nouns.pin.toml`` (repo root) pins, verifies its sha256, and scans every
text file under ``backend/app`` with it.

Plan ``2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists``,
phase A5 (the backend half).

Resolution of the vocabulary file — a missing or different file is a RED with
the reason, never a skip (an absent vocabulary is UNKNOWN, not "no fleet
nouns"):

* ``$QONTINUI_FLEET_NOUNS_FILE`` when set (CI sets it to a sparse checkout of
  qontinui-schemas at the pinned ref — ``.github/actions/fleet-nouns-vocab``);
* else ``<repo>/../qontinui-schemas/fleet-nouns.toml``, the sibling checkout.

Matching implements the vocabulary's consumer contract exactly: one line at a
time with its terminator stripped; every non-overlapping ``pattern`` match; a
match is DISCARDED only when its span overlaps an ``exclude`` match's span (so
an excluded phrase never hides a genuine hit elsewhere on the line).

The ratchet (``fleet_nouns_baseline.toml`` beside this file) is exact: for each
(file, class, token) the surviving-match count must EQUAL the baseline. More is
a new leak (named with file, line, class, and the vocabulary's
``next_action_for_author``); fewer, or a row with no hits left, is a stale
allowance that must be lowered or deleted in the same PR — so the baseline only
ever shrinks. ``QONTINUI_FLEET_NOUNS_REBASELINE=1`` rewrites it from the scan
(review the diff: a rebaseline that ADDS rows is adding leaks).

Product constants (``127.0.0.1:9876``, ``api.qontinui.io``, ``~/.qontinui/``,
…) are never flagged: the self-test below proves no class pattern matches any
of them under this engine.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tomllib
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND.parent
SCAN_ROOT = BACKEND / "app"
PIN_PATH = REPO_ROOT / "fleet-nouns.pin.toml"
BASELINE_PATH = Path(__file__).resolve().parent / "fleet_nouns_baseline.toml"
DEFAULT_VOCAB = REPO_ROOT.parent / "qontinui-schemas" / "fleet-nouns.toml"
ENV_FILE = "QONTINUI_FLEET_NOUNS_FILE"
ENV_REBASELINE = "QONTINUI_FLEET_NOUNS_REBASELINE"

SKIP_DIRS = {"__pycache__"}

# A match span includes its consuming guard character(s) (vocabulary: "A match
# SPAN INCLUDES ITS GUARD CHARACTER"), so `qontinui-dev-notes` arrives as
# ` qontinui-dev-notes/`, `(qontinui-dev-notes ` … The token is the span with
# separator/punctuation guards trimmed, so one noun is one baseline row.
# ONE trim set for both ends, so `../qontinui-web.`, `"qontinui-web"` and
# `(qontinui-web)` are all the token `qontinui-web`, and `$QONTINUI_ROOT` /
# `"QONTINUI_ROOT"` are both `QONTINUI_ROOT`.
_GUARD_TRIM = " \t\"'`()[]{}<>,;=|:*$#/\\.!?"


@dataclass(frozen=True)
class FleetClass:
    id: str
    pattern: re.Pattern[str]
    exclude: re.Pattern[str] | None
    examples: tuple[str, ...]
    next_action: str


@dataclass(frozen=True)
class Vocabulary:
    path: Path
    ref: str
    classes: tuple[FleetClass, ...]
    lookalikes: tuple[str, ...]
    product_constants: tuple[str, ...]


def _read_pin() -> dict[str, str]:
    if not PIN_PATH.is_file():
        pytest.fail(f"{PIN_PATH} is missing — the fleet-noun vocabulary pin.")
    pin = tomllib.loads(PIN_PATH.read_text(encoding="utf-8")).get("fleet_nouns", {})
    ref, sha = pin.get("ref", ""), pin.get("sha256", "")
    if not re.fullmatch(r"[0-9a-f]{40}", ref) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        pytest.fail(f"{PIN_PATH}: [fleet_nouns] needs ref (40 hex) and sha256 (64 hex)")
    return {"ref": ref, "sha256": sha}


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess[bytes] | None:
    """Run git in ``cwd``; None when git itself cannot run (not on PATH, …)."""
    try:
        return subprocess.run(
            ["git", "-C", str(cwd), *args], capture_output=True, check=False
        )
    except OSError:
        return None


def _read_vocabulary_bytes(pin: dict[str, str]) -> tuple[bytes, Path]:
    """The pinned vocabulary's bytes, and where they came from.

    An explicit ``$QONTINUI_FLEET_NOUNS_FILE``, and ANY run under CI
    (``$GITHUB_ACTIONS``), is strict: that file at the pinned digest, or red.
    Only the IMPLICIT local sibling gets a fallback (qontinui-claude-config
    check #71's): when ``../qontinui-schemas/fleet-nouns.toml`` is absent or at
    another commit, read ``git -C ../qontinui-schemas show <ref>:fleet-nouns.toml``
    — the pinned blob from the sibling's object store — and verify its digest.
    """
    from_env = os.environ.get(ENV_FILE)
    strict = bool(from_env) or bool(os.environ.get("GITHUB_ACTIONS"))
    path = Path(from_env) if from_env else DEFAULT_VOCAB
    why: list[str] = []
    if path.is_file():
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest == pin["sha256"]:
            return raw, path
        why.append(
            f"{path} has sha256 {digest}, but fleet-nouns.pin.toml pins {pin['sha256']} "
            f"(qontinui-schemas {pin['ref']})"
        )
    else:
        where = "$" + ENV_FILE if from_env else "the default sibling path"
        why.append(f"fleet-noun vocabulary not found at {path} ({where})")
    if not strict:
        sibling = DEFAULT_VOCAB.parent
        spec = f"{pin['ref']}:fleet-nouns.toml"
        proc = _git(sibling, "show", spec)
        if proc is None:  # no git on PATH, unreadable sibling, …
            why.append(f"git -C {sibling} show {spec} could not run (git unavailable)")
        elif proc.returncode == 0:
            digest = hashlib.sha256(proc.stdout).hexdigest()
            if digest == pin["sha256"]:
                return proc.stdout, sibling / f"<git {spec}>"
            why.append(
                f"git -C {sibling} show {spec} has sha256 {digest}, not the pinned {pin['sha256']}"
            )
        else:
            err = proc.stderr.decode("utf-8", "replace").strip()
            why.append(
                f"git -C {sibling} show {spec} failed ({err}) — fetch that commit into the sibling"
            )
    pytest.fail(
        "; ".join(why)
        + f". Check out qontinui-schemas at {pin['ref']} beside this repo, "
        f"or set {ENV_FILE}. An absent or different vocabulary is UNKNOWN, not 'no fleet "
        "nouns' — this is a red, never a skip. (Bumping the pin is a reviewed PR that "
        "also rebaselines.)"
    )


def load_vocabulary() -> Vocabulary:
    pin = _read_pin()
    raw, path = _read_vocabulary_bytes(pin)
    data = tomllib.loads(raw.decode("utf-8"))
    classes = tuple(
        FleetClass(
            id=c["id"],
            pattern=re.compile(c["pattern"]),
            exclude=re.compile(c["exclude"]) if c.get("exclude") else None,
            examples=tuple(c.get("examples", ())),
            next_action=c.get("next_action_for_author", ""),
        )
        for c in data.get("class", ())
    )
    if not classes:
        pytest.fail(
            f"{path}: no [[class]] entries — a vocabulary with no classes scans nothing."
        )
    return Vocabulary(
        path=path,
        ref=pin["ref"],
        classes=classes,
        lookalikes=tuple(data.get("lookalikes", ())),
        product_constants=tuple(pc["value"] for pc in data.get("product_constant", ())),
    )


def surviving_matches(cls: FleetClass, line: str) -> list[re.Match[str]]:
    """The class's pattern matches on one line that overlap no exclude span."""
    excluded = [m.span() for m in cls.exclude.finditer(line)] if cls.exclude else []
    return [
        m
        for m in cls.pattern.finditer(line)
        if not any(m.start() < end and start < m.end() for start, end in excluded)
    ]


def token_of(match: re.Match[str]) -> str:
    return match.group(0).strip(_GUARD_TRIM) or match.group(0)


Key = tuple[str, str, str]  # (file relative to backend/, class id, token)


@dataclass(frozen=True)
class ScanResult:
    counts: Counter[Key]
    where: dict[Key, list[int]]
    scanned: int
    unreadable: tuple[str, ...]
    source: str  # "git ls-files" or "os.walk"
    py_scanned: int  # readable .py files among those scanned


def _candidate_files(root: Path) -> tuple[list[Path], str]:
    """Files under ``root``: from ``git ls-files`` (tracked plus untracked,
    ignored files excluded) inside a work tree, else a filesystem walk (also
    when git itself cannot run)."""
    listing = _git(
        root,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--full-name",
        "--",
        ".",
    )
    top = _git(root, "rev-parse", "--show-toplevel")
    if listing and top and listing.returncode == 0 and top.returncode == 0:
        base = Path(top.stdout.decode("utf-8").strip())
        names = sorted({n for n in listing.stdout.decode("utf-8").split("\0") if n})
        # --cached lists a tracked file deleted in the work tree; skip those.
        files = [base / n for n in names if (base / n).is_file()]
        return files, "git ls-files"
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        files.extend(Path(dirpath) / name for name in sorted(filenames))
    return files, "os.walk"


def scan(vocab: Vocabulary, root: Path = SCAN_ROOT) -> ScanResult:
    """Count surviving matches per (file, class, token) under ``root``."""
    counts: Counter[Key] = Counter()
    where: dict[Key, list[int]] = {}
    scanned = 0
    unreadable: list[str] = []
    py_scanned = 0
    files, source = _candidate_files(root)
    for path in files:
        try:
            rel = path.resolve().relative_to(BACKEND).as_posix()
        except ValueError:
            rel = path.as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            unreadable.append(rel)
            continue
        scanned += 1
        py_scanned += path.suffix == ".py"
        # splitlines() also splits on \r, \x0b, U+2028 …; the contract says
        # strip the line TERMINATOR, so split on \n and drop a trailing \r.
        for lineno, line in enumerate(text.split("\n"), start=1):
            line = line.removesuffix("\r")
            for cls in vocab.classes:
                for m in surviving_matches(cls, line):
                    key = (rel, cls.id, token_of(m))
                    counts[key] += 1
                    where.setdefault(key, []).append(lineno)
    return ScanResult(counts, where, scanned, tuple(unreadable), source, py_scanned)


# --- baseline file ---------------------------------------------------------

_BASELINE_HEADER = """\
# The fleet-noun ratchet baseline for backend/app — GENERATED, then only ever
# lowered by hand. Read by backend/tests/test_fleet_nouns_ratchet.py.
#
# One table per (file, class); each key is a TOKEN (the matched noun, guard
# punctuation trimmed) and its value the EXACT number of matches allowed.
# More matches than allowed is a new leak; fewer (or a row with none left) is a
# stale allowance — lower or delete the row in the PR that removed the hit.
#
# Every row below was seeded 2026-09-29 from the day-one scan at the pinned
# vocabulary (qontinui-schemas {ref}): the census of fleet nouns already in
# backend/app, pending disposition under plan
# 2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists.
# A row is NOT an endorsement — it is debt that is not allowed to grow.
#
# Regenerate (review the diff; a new row is a new leak):
#   QONTINUI_FLEET_NOUNS_REBASELINE=1 poetry run pytest tests/test_fleet_nouns_ratchet.py
"""


def render_baseline(counts: Counter[Key], ref: str) -> str:
    grouped: dict[tuple[str, str], dict[str, int]] = {}
    for (rel, cls, token), n in counts.items():
        grouped.setdefault((rel, cls), {})[token] = n
    out = [_BASELINE_HEADER.format(ref=ref)]
    for rel, cls in sorted(grouped):
        out.append(f"\n[{json.dumps(rel)}.{cls}]")
        for token, n in sorted(grouped[(rel, cls)].items()):
            out.append(f"{json.dumps(token)} = {n}")
    return "\n".join(out) + "\n"


def load_baseline() -> Counter[Key]:
    if not BASELINE_PATH.is_file():
        pytest.fail(f"{BASELINE_PATH} is missing; generate it with {ENV_REBASELINE}=1.")
    data = tomllib.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    baseline: Counter[Key] = Counter()
    for rel, per_class in data.items():
        for cls, tokens in per_class.items():
            for token, n in tokens.items():
                if not isinstance(n, int) or n < 1:
                    pytest.fail(
                        f"{BASELINE_PATH}: [{rel}.{cls}] {token!r} = {n!r} — counts are integers >= 1"
                    )
                baseline[(rel, cls, token)] = n
    return baseline


# --- tests -----------------------------------------------------------------


@pytest.fixture(scope="module")
def vocab() -> Vocabulary:
    return load_vocabulary()


@pytest.fixture(scope="module")
def scanned(vocab: Vocabulary) -> ScanResult:
    return scan(vocab)


def test_engine_honours_the_vocabulary_contract(vocab: Vocabulary) -> None:
    """Every example hits its own class; no look-alike or product constant hits ANY class.

    This is what "product constants are never flagged" rests on: proven here,
    against this engine, for the pinned file — not assumed from the schemas CI.
    """
    problems: list[str] = []
    for cls in vocab.classes:
        if not cls.examples:
            problems.append(
                f"class {cls.id} has no examples — its hits cannot be proven"
            )
        for ex in cls.examples:
            if not surviving_matches(cls, ex):
                problems.append(f"class {cls.id} does not hit its own example {ex!r}")
    for text in (*vocab.lookalikes, *vocab.product_constants):
        for cls in vocab.classes:
            if surviving_matches(cls, text):
                problems.append(
                    f"{text!r} (look-alike / product constant) hits class {cls.id}"
                )
    assert vocab.product_constants, (
        "the pinned vocabulary declares no product constants"
    )
    assert not problems, "\n".join(problems)


def test_exclude_is_span_scoped_not_line_scoped(vocab: Vocabulary) -> None:
    """An excluded phrase must not hide a genuine hit elsewhere on the same line."""
    by_id = {c.id: c for c in vocab.classes}
    host = by_id["fleet_host_name"]
    assert not surviving_matches(host, "the spaceship operator <=>")
    assert (
        len(surviving_matches(host, "the spaceship operator <=> ran on spaceship")) == 1
    )


def test_scan_is_not_vacuous(scanned: ScanResult) -> None:
    assert scanned.scanned > 0, (
        f"scanned=0 under {SCAN_ROOT} ({scanned.source}) — a scan of nothing is a "
        "failure, not a pass"
    )
    unreadable_py = [u for u in scanned.unreadable if u.endswith(".py")]
    assert not unreadable_py, (
        f"unreadable (NOT scanned) Python modules: {unreadable_py}"
    )
    # Cross-check the walk against an independent count of the Python modules:
    # `git ls-files '*.py'` when the scan came from git (the same universe),
    # the filesystem otherwise. Fewer scanned than exist = a silent skip.
    if scanned.source == "git ls-files":
        listing = _git(
            SCAN_ROOT,
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            "*.py",
        )
        assert listing is not None and listing.returncode == 0, (
            "git ls-files '*.py' failed"
        )
        names = [n for n in listing.stdout.decode("utf-8").split("\0") if n]
        py = sum(1 for n in names if (SCAN_ROOT / n).is_file())
    else:
        py = sum(1 for p in SCAN_ROOT.rglob("*.py") if "__pycache__" not in p.parts)
    assert py > 0, f"no .py files under {SCAN_ROOT} ({scanned.source})"
    assert scanned.py_scanned == py, (
        f"scanned {scanned.py_scanned} .py file(s) via {scanned.source}, but {py} "
        f"exist under {SCAN_ROOT} — the walk skipped modules"
    )


def test_fleet_nouns_in_backend_app_do_not_grow(
    vocab: Vocabulary, scanned: ScanResult
) -> None:
    counts, where = scanned.counts, scanned.where
    if os.environ.get(ENV_REBASELINE) == "1":
        BASELINE_PATH.write_text(render_baseline(counts, vocab.ref), encoding="utf-8")
    baseline = load_baseline()
    next_action = {c.id: c.next_action for c in vocab.classes}

    new_leaks: list[str] = []
    stale: list[str] = []
    for key in sorted(set(counts) | set(baseline)):
        rel, cls, token = key
        have, allowed = counts.get(key, 0), baseline.get(key, 0)
        if have > allowed:
            lines = ", ".join(f"{rel}:{n}" for n in where[key])
            new_leaks.append(
                f"NEW LEAK {rel} class={cls} token={token!r}: {have} match(es), baseline allows "
                f"{allowed} [{lines}]\n    next action: {next_action.get(cls, '')}"
            )
        elif have < allowed:
            fix = f"lower it to {have}" if have else "delete the row"
            stale.append(
                f"STALE ALLOWANCE {rel} class={cls} token={token!r}: baseline allows {allowed}, "
                f"scan finds {have} — {fix} in {BASELINE_PATH.name} (the ratchet only shrinks)"
            )
    footer = [
        f"(scanned {scanned.scanned} file(s) via {scanned.source}; vocabulary {vocab.path})"
    ]
    if scanned.unreadable:
        footer.append(
            "UNREADABLE, NOT SCANNED (their counts are UNKNOWN): "
            + ", ".join(scanned.unreadable)
        )
    assert not (new_leaks or stale), "\n".join(new_leaks + stale + footer)
