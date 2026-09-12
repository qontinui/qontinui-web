#!/usr/bin/env python3
"""No two tracked paths — or TS/JS module stems — may differ only in case.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/path-case-collisions.yml``, step
    "Scan the index for case-colliding paths"
  * ``.qontinui/ci.toml``, step ``path-case-collisions``
  * ``.pre-commit-config.yaml``, hook ``path-case-collisions`` — catches it
    before the push, since a commit is what creates this state.

WHY THIS GATE EXISTS. ``8f053ba47`` (PR #1282) renamed
``frontend/src/components/sessions/TranscriptStores.tsx`` because the same
directory also tracked ``transcriptStores.ts``. Those are two distinct paths
even case-insensitively — the extensions differ — and that is the point: the
collision is at MODULE RESOLUTION, not on disk. ``import "./TranscriptStores"``
makes ``tsc`` probe ``TranscriptStores.ts`` BEFORE ``TranscriptStores.tsx``,
and on a case-INsensitive filesystem (Windows and macOS, i.e. most of this
fleet's workstations) that first probe finds ``transcriptStores.ts``. So the
component's exports were reported missing, and every ``.tsx`` commit on such a
box was refused by the ``tsc-typecheck`` pre-commit hook with
``TS2305``/``TS1149``/``TS1261`` — for ANY diff, including one touching neither
file. That is how it was found: a one-line dependency bump could not be
committed.

CI never saw it. GitHub's Linux runners are case-SENSITIVE, so the probe for
``TranscriptStores.ts`` correctly missed and resolution fell through to the
``.tsx``; the whole cost landed on local development, on the platform where
the bug is real and the toolchain that would report it cannot run. A gate that
only fails on Linux never fails, so this one does not depend on the filesystem
at all: it reads the INDEX and reasons about case itself.

TWO CLASSES ARE CHECKED, and #1282 is the second:

1. PATH collisions — two tracked path prefixes (a file, or a directory at any
   depth) that fold to the same string: ``Foo/a.ts`` beside ``foo/b.ts``, or
   ``Readme.md`` beside ``README.md``. On a case-insensitive checkout that is
   ONE path, so git can materialise only one of them and ``git mv`` between
   the two is a no-op. A colliding directory is reported once, as the
   directory, not once per file under it.

2. MODULE-STEM collisions — two TS/JS source files whose paths with the
   extension removed differ in spelling but fold to the same string:
   ``TranscriptStores.tsx`` beside ``transcriptStores.ts``. Neither the
   filesystem nor git objects; only ``import "./TranscriptStores"`` breaks,
   and only on a case-insensitive box. A directory holding an ``index.<ext>``
   is a module stem too, so ``Foo/index.ts`` beside ``foo.ts`` is the same
   defect. ``foo.ts`` beside ``foo.tsx`` is NOT reported: that is a same-case
   stem with two extensions, resolved identically on every platform by
   extension priority — a different smell, not this one.

WHY THE INDEX AND NOT THE TREE. ``git ls-files`` lists every tracked path as
git records it, on every platform — it is the one view of the repository that
is independent of what the checkout's filesystem could materialise. On a
case-insensitive box the working tree can only hold ONE of two path-colliding
files, so a directory walk finds no collision there; the index still lists
both. Reading the index is what makes this gate correct on exactly the
platform the defect bites, which a tree walk would get backwards.

THE FOLD is ``str.lower`` rather than ``str.casefold``: NTFS and APFS compare
names by per-character simple case mapping, which ``lower`` models, whereas
``casefold``'s full folding also equates ``ß`` with ``ss`` and would report a
pair those filesystems keep distinct. Which pairs a given filesystem merges is
ultimately its own table, so this is a model of it, not a copy.

Exit codes: 0 clean, 1 at least one colliding group, 2 the scan proved
nothing (empty index, or ``git`` itself errored) — vacuous, not a pass.
"""

from __future__ import annotations

import subprocess
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    EXIT_VIOLATION,
    REPO_ROOT,
    err,
    note,
    require_nonempty,
)

#: Extensions TypeScript's and Node's resolvers try for a bare ``./stem``
#: import, in the order `tsc` probes them (`moduleResolution: bundler` /
#: `node16`). The ORDER is why #1282 happened — `.ts` is probed before `.tsx`,
#: so the lowercase `.ts` module shadowed the PascalCase `.tsx` component. Only
#: the SET matters to this gate; the order is recorded for the reader.
MODULE_EXTENSIONS: tuple[str, ...] = (
    ".ts",
    ".tsx",
    ".d.ts",
    ".js",
    ".jsx",
    ".mts",
    ".cts",
    ".d.mts",
    ".d.cts",
    ".mjs",
    ".cjs",
)

#: A directory is importable as ``./dir`` when it holds one of these.
INDEX_BASENAMES: frozenset[str] = frozenset(f"index{ext}" for ext in MODULE_EXTENSIONS)


def _git(args: list[str]) -> subprocess.CompletedProcess[str]:
    # `surrogateescape`, not `replace`: two DISTINCT undecodable names must not
    # both become U+FFFD… and then falsely collide with each other.
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="surrogateescape",
        check=False,
    )


def _module_stem(path: str) -> str | None:
    """``path`` with its module extension removed, or ``None`` if it has none.

    ``.d.ts`` (and ``.d.mts`` / ``.d.cts``) is stripped as a unit so
    ``foo.d.ts`` and ``foo.ts`` share the stem ``foo`` (they do resolve to the
    same specifier), rather than yielding the spurious stem ``foo.d``. Longest
    extension first for that reason. The extension is matched
    case-insensitively — a probe for ``Foo.ts`` hits ``foo.TS`` on the same
    filesystems this gate models — and a bare ``.ts`` with no basename is a
    dotfile, not a module.
    """
    folded = path.lower()
    for ext in sorted(MODULE_EXTENSIONS, key=len, reverse=True):
        if folded.endswith(ext):
            stem = path[: -len(ext)]
            if stem and not stem.endswith("/"):
                return stem
            return None
    return None


def path_collisions(tracked: list[str]) -> list[list[str]]:
    """Distinct tracked path prefixes that fold to one string.

    ``tracked`` is the index listing, one repo-relative path per element,
    ``/``-separated as ``git ls-files`` prints it. Each path contributes all of
    its prefixes (``a``, ``a/b``, ``a/b/c.ts``), so a directory that collides
    is reported once, as the directory, rather than once per file under it —
    and a leaf collision inside a non-colliding directory is reported as the
    two leaves. Groups come back sorted, each group sorted, so the report is
    stable across runs and platforms.
    """
    spellings: dict[str, set[str]] = defaultdict(set)
    for path in tracked:
        parts = path.split("/")
        for depth in range(1, len(parts) + 1):
            prefix = "/".join(parts[:depth])
            spellings[prefix.lower()].add(prefix)

    groups = [sorted(group) for group in spellings.values() if len(group) > 1]
    return _shallowest_only(groups)


def module_stem_collisions(tracked: list[str]) -> list[list[str]]:
    """Distinct TS/JS module stems that fold to one string.

    A stem is a source file's path minus its :data:`MODULE_EXTENSIONS` suffix,
    or a directory that holds an ``index.<ext>``. Two spellings of one folded
    stem are a collision; one spelling with several extensions is not (see the
    module docstring). Members are reported as the FILES that produced the
    stems, so the reader sees what to rename, and a directory stem is
    reported as the directory.
    """
    by_folded: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for path in tracked:
        stem = _module_stem(path)
        if stem is None:
            continue
        by_folded[stem.lower()][stem].add(path)
        # `dir/index.ts` also answers `import "./dir"`.
        parent, _, base = path.rpartition("/")
        if parent and base in INDEX_BASENAMES:
            by_folded[parent.lower()][parent].add(parent + "/")

    groups: list[list[str]] = []
    for spellings in by_folded.values():
        if len(spellings) > 1:
            groups.append(sorted(p for paths in spellings.values() for p in paths))
    return sorted(groups)


def _shallowest_only(groups: list[list[str]]) -> list[list[str]]:
    """Drop groups whose collision is entirely explained by a colliding ancestor.

    A colliding directory makes every prefix beneath it collide too
    (``Foo/x.ts`` vs ``foo/x.ts`` fold together only because ``Foo``/``foo``
    did), and renaming the directory fixes all of those at once — so they are
    not reported. A nested group whose members STILL differ below the ancestor
    (``Foo/Bar/…`` vs ``Foo/bar/…``) is a second defect the directory rename
    leaves behind, and is kept.
    """
    folded_roots = {group[0].lower() for group in groups}

    def explained_by_ancestor(group: list[str]) -> bool:
        folded = group[0].lower()
        for root in folded_roots:
            if root != folded and folded.startswith(root + "/"):
                tails = {member[len(root) + 1 :] for member in group}
                if len(tails) == 1:
                    return True
        return False

    return sorted(group for group in groups if not explained_by_ancestor(group))


def _outside(stems: list[list[str]], paths: list[list[str]]) -> list[list[str]]:
    """Stem groups not already explained by a colliding directory.

    ``Foo/x.ts`` vs ``foo/X.ts`` is a stem collision only because ``Foo``
    and ``foo`` collide as paths; renaming the directory fixes both, so
    reporting the stems as well would send the reader after a second defect
    that is not there. Likewise ``a/Foo.ts`` vs ``a/foo.ts`` is one finding,
    not one under each heading.
    """
    roots = [group[0].lower() + "/" for group in paths]
    as_paths = [set(group) for group in paths]
    return [
        group
        for group in stems
        if not any(group[0].lower().startswith(root) for root in roots)
        and not any(set(group) <= members for members in as_paths)
    ]


REMEDIATION = """
Resolution: rename one side so the two no longer fold to the same string.
Pick the spelling that matches its neighbours' convention (components here
are PascalCase and named for their primary export, which is how #1282
resolved TranscriptStores.tsx -> TranscriptStoresPanel.tsx; plain modules
are camelCase), update the import sites, and on a case-insensitive box do a
case-only rename in TWO steps or git will see no change:

    git mv Foo.tsx Foo.tsx.tmp && git mv Foo.tsx.tmp FooPanel.tsx

For a PATH collision a checkout on Windows or macOS holds only ONE of the
pair, so `git status` there is silent about the other — read the list from
the index, as this gate does, not from the directory. For a MODULE-STEM
collision both files are on disk and only `tsc` on such a box objects
(TS1149 / TS1261 / TS2305); Linux CI will never reproduce it.
"""


def main() -> int:
    # Non-vacuity: an empty index would make the collision scan trivially
    # clean. Prove the index has content before believing a no-match result.
    # `-z`: without it git C-quotes any path holding a byte >= 0x80, a quote,
    # a backslash or a control character (`core.quotePath`), and the gate would
    # then fold the LITERAL octal-escaped string (`"\303\204rger.ts"`) so
    # `Ärger.ts`/`ärger.ts` would pass, a directory collision under a quoted
    # name would pass (its first prefix becomes `"Foo`), and the verdict would
    # depend on a developer's git config. NUL-delimited output is never quoted.
    listing = _git(["ls-files", "--cached", "-z"])
    if listing.returncode != 0:
        err(
            f"`git ls-files` failed (exit {listing.returncode}): "
            f"{listing.stderr.strip()}"
        )
        err("The scan did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS
    tracked = [path for path in listing.stdout.split("\0") if path.strip()]
    require_nonempty(len(tracked), "tracked files", "the git index")

    paths = path_collisions(tracked)
    stems = _outside(module_stem_collisions(tracked), paths)

    if paths or stems:
        if paths:
            err(
                f"{len(paths)} group(s) of tracked paths differ only in case. On a "
                "case-insensitive checkout (Windows, macOS) each group is ONE "
                "path, so only one member can exist on disk."
            )
            for group in paths:
                print("  " + "  <->  ".join(group), file=sys.stderr)
        if stems:
            err(
                f"{len(stems)} group(s) of TS/JS module stems differ only in case. "
                'A bare `import "./stem"` resolves to the wrong file on a '
                "case-insensitive checkout (Windows, macOS); Linux CI cannot see "
                "this, which is why this gate reads the index instead."
            )
            for group in stems:
                print("  " + "  <->  ".join(group), file=sys.stderr)
        print(REMEDIATION, file=sys.stderr)
        return EXIT_VIOLATION

    note(
        "No tracked paths or TS/JS module stems collide case-insensitively - "
        f"scanned {len(tracked)} tracked file(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
