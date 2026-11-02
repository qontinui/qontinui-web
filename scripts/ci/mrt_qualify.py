#!/usr/bin/env python3
"""Qualify a PR's migration change set for ``Migration Reversal Tested`` --
conditions (a) and (b) -- exempting PROVEN non-executable edits to existing
revisions.

THE single home of this logic. One lane invokes this script:

  * ``.github/workflows/migration-reversal.yml``, job ``tested`` (check
    ``Migration Reversal Tested``), step "Qualify the PR's migration and switch
    to the base tree". That step writes
    ``git diff -z --name-status -M <base>...<head>`` to a file, hands it here,
    and appends ``--env-out`` to ``$GITHUB_ENV``.

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``,
Phase 1 (design decisions D8 and D9). The ``-z --name-status`` parser and the
``::error`` titles moved here from the inline heredoc the step used to carry.

Conditions decided here
-----------------------
(a) exactly one file under ``backend/alembic/versions/`` is ADDED, and it is a
    top-level ``.py`` migration file with a plain name. (The regular-file half
    of (a) -- the git mode at the head -- stays in the workflow step.)
(b) no file under that directory is deleted, renamed, copied or type-changed,
    and none is modified EXCEPT by a proven non-executable edit. (The other
    half of (b) -- the added path must not already exist at the base tip --
    stays in the workflow step.)

An ``M`` entry that IS a proven non-executable edit is dropped from the touched
set and printed as exempt. The isolated tree the workflow builds keeps that
file's base text, which is equivalent by proof. When every change is such an
edit and none is added, there is no migration to exercise: ``--env-out``
carries ``MRT_DOC_ONLY=1`` and the workflow concludes ``success`` with
``MRT_VERDICT ok non_executable_edits=<n> files=<...>`` -- a positive verdict
naming what was proven, never a skip (D9).

The non-executable-edit proof (D8)
----------------------------------
:func:`is_non_executable_edit` decides one ``M`` entry from its base-tip and
head blobs, read as RAW BYTES. It holds only when every clause holds, and each
refusal names its reason:

0. the path ends in ``.py`` (any case) -- ``not_py``; neither side is empty or
   whitespace-only, which coord reads as a failed read -- ``empty_side``;
1. whenever either side mentions ``coding`` in its first two physical lines,
   those lines are byte-identical -- ``encoding_cookie`` -- and every
   ``coding[:=]<name>`` spelling there names UTF-8 the way
   :func:`cookie_codecs_are_utf8` normalises it -- ``non_utf8_cookie``;
2. neither side holds a bare carriage return, which CPython reads as a line
   break even inside a literal -- ``bare_cr``;
3. both sides parse with :func:`ast.parse` applied to the raw bytes, so an
   encoding cookie is honoured exactly as the interpreter honours it --
   ``parse_error_base`` / ``parse_error_head``. Parsing runs no code. This is
   the well-formedness pre-check only; clause 6 decides equivalence;
4. neither tree holds an f-/t-string replacement field (``FormattedValue``, or
   ``Interpolation`` on 3.14+) -- ``fstring_field``. Text inside a field is
   code the lexer reads as literal, so a reader hidden there would be invisible;
5. no identifier anywhere in either tree is in :data:`SOURCE_READERS` --
   ``source_reader:<name>``. "Identifier" is every ``str``-valued field (and
   every ``str`` in a list-valued field) of every non-``Constant`` AST node,
   split on ``.``: ``Name.id``, ``Attribute.attr``, ``alias.name`` /
   ``asname``, ``ImportFrom.module``, ``keyword.arg`` (``metaclass=``),
   function and class names (``__init_subclass__``, ``__prepare__``),
   ``arg.arg``, ``Global`` / ``Nonlocal`` names and the ``Match*`` names;
6. the two sides' EXECUTABLE SKELETONS are equal -- ``executable_diff``. The
   skeleton (:func:`executable_skeleton`) is a port of coord's line skeleton,
   driven by the stdlib :mod:`tokenize` over the raw bytes: comments are
   dropped; a string that is by itself a whole expression statement
   (:func:`_is_statement_string`) becomes one fixed placeholder, so its text
   may change but a docstring may not be added or removed; trailing whitespace
   is stripped and blank lines are dropped; every other character is kept
   byte-for-byte per line, indentation and intra-line whitespace included.
   Building it also refuses, exactly where coord's skeleton does: a code
   character outside ASCII (Python NFKC-normalises identifiers, so
   a fullwidth letter can spell ``__doc__``) -- ``non_ascii_identifier``; a UTF-8
   byte-order mark, which is such a character -- ``bom``; a form feed outside
   a string literal, which Python reads as layout -- ``form_feed``; a one-line
   literal that a backslash continues over a CRLF line ending, which coord's
   lexer cannot delimit although Python accepts it --
   ``string_crlf_continuation``; and a line that ends in a ``\\``
   continuation, since stripping or joining around it could make a syntax
   error compare equal to valid code -- ``line_continuation``.

Clause 7 is the git mode, decided by :func:`exemption` around the text proof:
it must be unchanged -- ``mode_changed`` -- and a regular file, ``100644`` or
``100755`` -- ``not_regular_file``. A blob that cannot be read on either side
is never exempt -- ``absent_at_base`` / ``absent_at_head`` /
``unreadable_base`` / ``unreadable_head``.

So intra-line whitespace, indentation, a call re-wrapped over lines, a
statement string after ``;``, a parenthesised docstring and a quote-style change
do NOT pass; type annotations, every non-statement string (an ``op.execute``
literal), ``revision`` and ``down_revision`` stay executable. There is no
``>>>`` rule: coord has none and this repo collects no doctests from revisions.

Parity with coord
-----------------
This is a clause-for-clause port of qontinui-coord
``crates/coord/src/pr_merge/migration_classifier.rs`` --
``is_non_executable_edit``, ``cookie_codecs_are_utf8``, ``SOURCE_READERS``,
``executable_skeleton`` and ``is_statement_string`` (blob ``32bca598b3``, last
changed in ``17c7fc4f0``). coord's merge engine gates the same PR with that
function, so a rule here looser than coord's buys nothing and a stricter one
blocks a PR coord admits. ``backend/tests/test_mrt_qualify.py`` ports every
input pair of coord's ``ne2``-``ne20`` tests with coord's verdict and asserts
that this module agrees on every row. The skeleton is ported rather than
replaced by an AST comparison because an AST cannot see what coord's line
skeleton keeps -- intra-line whitespace, line wrapping, quote style, a
statement string after ``;`` -- so parity holds on every input, not only on
the tabulated rows.

Where this module is stricter, by design and only there: the ``ast.parse``
pre-check (a revision Python cannot parse cannot import, so ``reverse`` and
``Migration Reversal Gate`` fail it anyway; a t-string is therefore refused
below Python 3.14), the git-mode clause, and a fail-closed refusal
(``parse_error_*``) if the tokenizer's reported positions ever disagree with the
source text. Nothing here imports or executes the PR's files: blobs are read
with ``git cat-file`` and handed to the parser and the tokenizer as bytes.

Output
------
``--env-out`` receives ``KEY=VALUE`` lines for ``$GITHUB_ENV``, only on success:

* an added migration: ``MRT_DOC_ONLY=0`` and ``MRT_MIGRATION=<path>``;
* non-executable edits only: ``MRT_DOC_ONLY=1``,
  ``MRT_NON_EXECUTABLE_EDITS=<n>`` and ``MRT_NON_EXECUTABLE_FILES=<paths>``
  (comma-joined; any character that could break the one-line format is
  escaped).

Exit codes: 0 qualified (``--env-out`` written); 1 a condition failed or could
not be decided (an ``::error`` names the condition -- an undecidable input is
never a pass); 2 a usage error.
"""

from __future__ import annotations

import argparse
import ast
import io
import os
import re
import subprocess
import sys
import tokenize
import warnings
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple, Protocol

VERSIONS = "backend/alembic/versions/"

# A top-level migration module with a plain name. Anything else under
# versions/ (a subdirectory, a non-.py file, an odd spelling) is not a file
# alembic loads as a revision here, so it cannot be "the" tested migration --
# and the name is written to $GITHUB_ENV, so it must not be able to carry a
# newline either.
MIGRATION = re.compile(r"backend/alembic/versions/[A-Za-z0-9_][A-Za-z0-9_.-]*\.py")

ERROR_TITLE = "Migration Reversal Tested - condition ({cond}) failed"

REGULAR_FILE_MODES = frozenset({"100644", "100755"})

# Identifiers through which code could read its own docstrings or source text
# (directly, or by reflection) -- any one of them in code voids the proof.
# Copied VERBATIM, order and comments included, from qontinui-coord
# crates/coord/src/pr_merge/migration_classifier.rs `SOURCE_READERS`
# (blob 32bca598b3). Keep the two lists identical: a name added on one side
# only is a parity defect between this check and coord's merge engine.
SOURCE_READERS: frozenset[str] = frozenset(
    [
        "__doc__",
        "__file__",
        "__loader__",
        "__spec__",
        "__cached__",
        "__name__",
        "__module__",
        "__code__",
        "__dict__",
        "__globals__",
        "__builtins__",
        "__getattribute__",
        "__import__",
        "globals",
        "locals",
        "vars",
        "eval",
        "exec",
        "compile",
        "getattr",
        "setattr",
        "open",
        "io",
        "os",
        "sys",
        "pathlib",
        "Path",
        "inspect",
        "getdoc",
        "getsource",
        "getsourcelines",
        "get_source",
        "linecache",
        "tokenize",
        "ast",
        "importlib",
        "modules",
        "_getframe",
        "f_globals",
        "f_locals",
        "f_back",
        "attrgetter",
        "methodcaller",
        "read_text",
        "read_bytes",
        # String formatting can splice a dunder named INSIDE a literal
        # (`"{0.__doc__}".format(f)`), which `code_identifiers` never sees.
        "format",
        "format_map",
        # alembic's own API for a revision's docstring
        # (`context.script.get_revision(rev).longdoc`).
        "script",
        "get_revision",
        "longdoc",
        "doc",
        # Readers of source lines / files by other routes.
        "traceback",
        "extract_stack",
        "stack",
        "currentframe",
        "fileinput",
        "pkgutil",
        "get_data",
        "subprocess",
        "runpy",
        "codecs",
        # Runners of code WRITTEN in a docstring, and docstring renderers.
        "doctest",
        "run_docstring_examples",
        "testmod",
        "DocTestFinder",
        "pydoc",
        "render_doc",
        "help",
        "dis",
        # The rest of `forbid_unclassifiable_code`'s reflection list.
        "getmembers",
        "Operations",
        "MigrationContext",
        # Code-object / frame / GC routes to a function's constants.
        "co_consts",
        "f_code",
        "gi_code",
        "cr_code",
        "ag_code",
        "tb_frame",
        "__traceback__",
        "gc",
        "get_referents",
        "get_objects",
        "pickle",
        "marshal",
        "ctypes",
        # Line-number observers.
        "lineno",
        "f_lineno",
        "tb_lineno",
        "co_firstlineno",
        "co_lines",
        "co_positions",
        "catch_warnings",
        "showwarning",
        "findCaller",
        # Other formatting routes to a dunder named inside a literal.
        "vformat",
        "Formatter",
        "get_field",
        # Class-namespace hooks that see a class docstring.
        "metaclass",
        "__prepare__",
        "__init_subclass__",
    ]
)

# What a statement-position string literal is replaced with in the skeleton.
# It holds a NUL, and the skeleton refuses any source holding one, so no
# source line can spell it (coord's `DOCSTRING_PLACEHOLDER`).
DOCSTRING_PLACEHOLDER = "\x00<docstring>\x00"

# Rust's `char::is_whitespace` -- the Unicode White_Space property -- which is
# what coord's `str::trim` (the empty-side test) and its backwards walk over
# whitespace use. Python's `str.isspace` is a different set (it adds
# U+001C..U+001F), so the set is spelled out.
_RUST_WHITESPACE = frozenset(
    "\t\n\x0b\x0c\r \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)

_BARE_CR = re.compile(rb"\r(?!\n)")

# A literal's prefix is the run of letters before its first quote.
_LITERAL_PREFIX = re.compile(r"[A-Za-z]*")

# Token types that open and close an f-/t-string on Python 3.12+ (PEP 701;
# t-strings are PEP 750, 3.14+). Earlier versions emit one STRING token per
# f-string, and have none of these names.
_TEMPLATE_START = frozenset({"FSTRING_START", "TSTRING_START"})
_TEMPLATE_END = frozenset({"FSTRING_END", "TSTRING_END"})
_TEMPLATE_FIELD_NODES = frozenset({"FormattedValue", "Interpolation"})

# What one source character is part of (coord's `PyChar`).
_CODE, _STR, _COMMENT = 0, 1, 2


class Verdict(NamedTuple):
    """Whether one edit is a proven non-executable edit, and why not."""

    ok: bool
    reason: str


OK = Verdict(True, "ok")


def _refuse(reason: str) -> Verdict:
    return Verdict(False, reason)


# ---------------------------------------------------------------------------
# The non-executable-edit proof
# ---------------------------------------------------------------------------


def is_non_executable_edit(path: str, base: bytes, head: bytes) -> Verdict:
    """``ok`` iff ``base`` -> ``head`` provably changes only comments,
    statement-position plain string literals, blank lines and trailing
    whitespace (D8, clauses 0-6; see the module docstring); otherwise the
    refusal reason. Both sides are RAW blob bytes. Anything the proof cannot
    establish is a refusal, never a pass."""
    if not path.lower().endswith(".py"):
        return _refuse("not_py")
    # An empty side is a failed read, not an empty revision (coord: the
    # contents API answers a large file with no `content`, which decodes to "").
    if _is_blank(base) or _is_blank(head):
        return _refuse("empty_side")
    # PEP 263: an encoding cookie on physical line 1 or 2 changes how every
    # literal DECODES, and whether a `coding` comment is a cookie depends on
    # what else those lines hold. So if either side mentions `coding` there,
    # the two lines must be byte-identical AND every cookie spelling must name
    # UTF-8 -- under another codec a docstring edit can add bytes that codec
    # cannot decode, and the revision stops importing.
    base_two, head_two = _first_two_lines(base), _first_two_lines(head)
    if b"coding" in base_two or b"coding" in head_two:
        if base_two != head_two:
            return _refuse("encoding_cookie")
        if not cookie_codecs_are_utf8(base_two):
            return _refuse("non_utf8_cookie")
    # CPython reads a bare CR as a line break BEFORE tokenizing, even inside a
    # single-quoted literal (`"doc\rmore"` is unterminated). Refuse it anywhere.
    if _BARE_CR.search(base) or _BARE_CR.search(head):
        return _refuse("bare_cr")

    trees: list[ast.Module] = []
    for side, raw in (("base", base), ("head", head)):
        tree = _parse(raw)
        if tree is None:
            return _refuse(f"parse_error_{side}")
        trees.append(tree)

    for tree in trees:
        if _has_template_field(tree):
            return _refuse("fstring_field")
    for tree in trees:
        reader = _source_reader(tree)
        if reader is not None:
            return _refuse(f"source_reader:{reader}")

    skeletons: list[list[str]] = []
    for side, raw in (("base", base), ("head", head)):
        skeleton = executable_skeleton(raw)
        if isinstance(skeleton, SkeletonRefusal):
            return _refuse(skeleton.reason.format(side=side))
        skeletons.append(skeleton)
    if skeletons[0] != skeletons[1]:
        return _refuse("executable_diff")
    return OK


def cookie_codecs_are_utf8(lines: bytes) -> bool:
    """True iff every ``coding[:=]<name>`` spelling in ``lines`` names UTF-8
    the way CPython normalises it (``utf-8``, ``utf8``, ``utf_8``, ``utf-8-*``
    such as ``utf-8-sig``, any case -- but NOT ``utf8-*``, which CPython does
    not know). A ``coding`` NOT followed by ``:`` / ``=`` is not a cookie
    spelling and is ignored. Port of coord's ``cookie_codecs_are_utf8``."""
    rest = lines
    while (k := rest.find(b"coding")) >= 0:
        after = rest[k + len(b"coding") :]
        if after[:1] in (b":", b"="):
            tail = after[1:].lstrip(b" \t")
            match = re.match(rb"[A-Za-z0-9._-]*", tail)
            name = (match.group(0) if match else b"").decode("ascii")
            name = name.lower().replace("_", "-")
            if not (name in ("utf8", "utf-8") or name.startswith("utf-8-")):
                return False
        rest = after
    return True


def _is_blank(raw: bytes) -> bool:
    """coord's ``text.trim().is_empty()``. Bytes that are not UTF-8 hold a
    non-whitespace byte, so they are not blank (the parse refuses them)."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return all(ch in _RUST_WHITESPACE for ch in text)


def _first_two_lines(raw: bytes) -> bytes:
    return b"\n".join(raw.split(b"\n")[:2])


def _parse(raw: bytes) -> ast.Module | None:
    """``ast.parse`` over the raw bytes; ``None`` when Python cannot parse it.

    Bytes, never decoded text: the parser then honours the encoding cookie
    (and refuses bytes the cookie's codec cannot decode) exactly as the import
    would. ``RecursionError`` / ``MemoryError`` cover pathologically nested
    input, which is refused rather than allowed to abort the check.

    Compiler warnings (an invalid escape sequence is a ``SyntaxWarning``) are
    silenced: they are not part of coord's contract, and the verdict must not
    depend on the interpreter's ``-W`` flags.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return ast.parse(raw)
    except (SyntaxError, ValueError, RecursionError, MemoryError, OverflowError):
        return None


def _has_template_field(tree: ast.AST) -> bool:
    return any(type(n).__name__ in _TEMPLATE_FIELD_NODES for n in ast.walk(tree))


def _source_reader(tree: ast.AST) -> str | None:
    """The first :data:`SOURCE_READERS` name among the tree's identifiers."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant):
            continue
        for _field, value in ast.iter_fields(node):
            for ident in _identifier_strings(value):
                for part in ident.split("."):
                    if part in SOURCE_READERS:
                        return part
    return None


def _identifier_strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        yield from (item for item in value if isinstance(item, str))


# ---------------------------------------------------------------------------
# The executable skeleton (port of coord's `executable_skeleton`)
# ---------------------------------------------------------------------------


class SkeletonRefusal(NamedTuple):
    """Why a skeleton could not be built. ``{side}`` is filled by the caller."""

    reason: str


@dataclass(frozen=True)
class _Lexed:
    """Per-character classification plus the top-level string literals."""

    text: str
    kind: bytearray
    # (start, end) of every top-level literal in source order -- an f-/t-string
    # is ONE literal, its nested tokens excluded (coord's `PyLex.strings`).
    strings: list[tuple[int, int]]


def executable_skeleton(raw: bytes) -> list[str] | SkeletonRefusal:
    """The part of a Python source that can affect what it DOES, as lines.

    Port of coord's ``executable_skeleton``: comments are dropped; every
    statement-position plain string literal becomes
    :data:`DOCSTRING_PLACEHOLDER`; trailing whitespace is stripped and blank
    lines are dropped; everything else is kept byte-for-byte. The tokenizer,
    not a lexer of ours, decides where each literal and comment begins and
    ends. Assumes the caller's checks have run (the source parses, holds no
    bare CR, and any cookie names UTF-8).
    """
    parse_error = SkeletonRefusal("parse_error_{side}")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return parse_error
    if "\x00" in text:
        # Unreachable after `ast.parse`; kept so the placeholder stays
        # unspellable whatever the caller did.
        return parse_error
    if text.startswith("\ufeff"):
        # The tokenizer would strip it and shift every column on line 1;
        # coord reads it as a non-ASCII character in code.
        return SkeletonRefusal("bom")
    lexed = _lex(raw, text)
    if lexed is None:
        return parse_error
    kind = lexed.kind

    # coord's lexer cannot delimit a ONE-LINE literal that a backslash
    # continues over a CRLF line ending: its reader takes the `\r` as the
    # escaped character, then meets the `\n` inside a one-line literal and
    # rejects the whole file. Python translates CRLF before tokenizing and
    # accepts it, so this refusal exists for parity alone. A bare CR never
    # reaches here, so any CR inside a valid one-line literal is that shape.
    for start, end in lexed.strings:
        literal = text[start:end]
        if "\r" in literal and not _is_triple_quoted(literal):
            return SkeletonRefusal("string_crlf_continuation")

    # coord's lexer refuses a form feed outside a literal: Python reads it as
    # resetting the indent column, which the line logic below does not model.
    if "\x0c" in text and any(
        ch == "\x0c" and kind[i] != _STR for i, ch in enumerate(text)
    ):
        return SkeletonRefusal("form_feed")
    # Python NFKC-normalises identifiers, so a non-ASCII spelling can name any
    # SOURCE_READERS entry; refuse non-ASCII anywhere in code.
    if not text.isascii() and any(
        kind[i] == _CODE and ord(ch) > 0x7F for i, ch in enumerate(text)
    ):
        return SkeletonRefusal("non_ascii_identifier")

    # Bracket depth BEFORE each character, over code only.
    depth_before: list[int] = []
    depth = 0
    for i, ch in enumerate(text):
        depth_before.append(depth)
        if kind[i] == _CODE:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
                if depth < 0:
                    return parse_error

    statement_strings = {
        start: end
        for start, end in lexed.strings
        if _is_statement_string(lexed, start, end, depth_before)
    }

    lines: list[str] = []
    current: list[str] = []
    i, n = 0, len(text)
    while i < n:
        statement_end = statement_strings.get(i)
        if statement_end is not None:
            current.append(DOCSTRING_PLACEHOLDER)
            i = statement_end
            continue
        k = kind[i]
        if k == _STR:
            current.append(text[i])
        elif k == _CODE:
            if text[i] == "\n":
                if not _flush(current, lines):
                    return SkeletonRefusal("line_continuation")
            else:
                current.append(text[i])
        i += 1
    if not _flush(current, lines):
        return SkeletonRefusal("line_continuation")
    return lines


def _flush(current: list[str], lines: list[str]) -> bool:
    """End one physical line of the skeleton. False on a ``\\`` continuation:
    stripping whitespace after it, or dropping a line it joins, could make a
    syntax error compare equal to valid code."""
    line = "".join(current).rstrip(" \t\r")
    current.clear()
    if line.endswith("\\"):
        return False
    if line.lstrip(" \t"):
        lines.append(line)
    return True


def _lex(raw: bytes, text: str) -> _Lexed | None:
    """Classify every character of ``text`` as code, string or comment, from
    the stdlib tokenizer run over the raw bytes. ``None`` when the tokenizer
    fails or its positions disagree with the text (fail closed).

    Positions are (1-based row, character column); rows are physical lines
    split on ``\\n`` only, which is how ``readline`` splits the bytes. A
    comment runs to the end of its line (before the ``\\n``), as coord's lexer
    has it -- so the ``\\r`` of a CRLF line ending after a comment is comment.
    """
    line_starts = [0]
    line_starts.extend(i + 1 for i, ch in enumerate(text) if ch == "\n")

    def offset(position: tuple[int, int]) -> int:
        row, col = position
        if not 1 <= row <= len(line_starts) or col < 0:
            raise _PositionError(position)
        at = line_starts[row - 1] + col
        if at > len(text):
            raise _PositionError(position)
        return at

    strings: list[tuple[int, int]] = []
    comments: list[int] = []
    template_depth = 0
    template_open_at = 0
    template_open = ""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            tokens = list(tokenize.tokenize(io.BytesIO(raw).readline))
        for tok in tokens:
            name = tokenize.tok_name.get(tok.type, "")
            if name in _TEMPLATE_START:
                if template_depth == 0:
                    template_open_at = offset(tok.start)
                    template_open = tok.string
                template_depth += 1
            elif name in _TEMPLATE_END:
                template_depth -= 1
                if template_depth < 0:
                    return None
                if template_depth == 0:
                    end = offset(tok.end)
                    span = text[template_open_at:end]
                    if not (
                        span.startswith(template_open) and span.endswith(tok.string)
                    ):
                        return None
                    strings.append((template_open_at, end))
            elif template_depth:
                continue  # inside an f-/t-string: all of it is the one literal
            elif tok.type == tokenize.STRING:
                start, end = offset(tok.start), offset(tok.end)
                if _lf(text[start:end]) != _lf(tok.string):
                    return None
                strings.append((start, end))
            elif tok.type == tokenize.COMMENT:
                start = offset(tok.start)
                if not text.startswith("#", start):
                    return None
                comments.append(start)
    except (tokenize.TokenError, SyntaxError, ValueError, _PositionError):
        return None
    if template_depth:
        return None

    kind = bytearray(len(text))  # all _CODE
    previous_end = 0
    for start, end in strings:
        if start < previous_end or end <= start:
            return None
        kind[start:end] = bytes([_STR]) * (end - start)
        previous_end = end
    for start in comments:
        end = text.find("\n", start)
        end = len(text) if end < 0 else end
        if any(kind[start:end]):  # a comment never overlaps a literal
            return None
        kind[start:end] = bytes([_COMMENT]) * (end - start)
    return _Lexed(text=text, kind=kind, strings=strings)


class _PositionError(Exception):
    """A token position that does not land inside the source text."""


def _is_triple_quoted(literal: str) -> bool:
    prefix_match = _LITERAL_PREFIX.match(literal)
    q = prefix_match.end() if prefix_match else 0
    return literal[q : q + 1] in ("'", '"') and literal.startswith(literal[q] * 3, q)


def _lf(s: str) -> str:
    # 3.12+'s C tokenizer may translate CRLF inside a token; compare modulo
    # that (a bare CR never reaches here).
    return s.replace("\r\n", "\n")


def _is_statement_string(
    lexed: _Lexed, start: int, end: int, depth_before: Sequence[int]
) -> bool:
    """True iff the literal at ``[start, end)`` is, by itself, a whole
    expression STATEMENT that evaluates nothing -- port of coord's
    ``is_statement_string``:

    * its prefix has no ``f``/``t`` (an f-/t-string evaluates its fields) and
      no ``b`` (a bytes literal with a non-ASCII character is a syntax error);
    * it is raw, or holds no backslash -- a hidden ``\\N{BOGUS}`` or ``\\x4``
      escape is a SyntaxError the placeholder would mask;
    * it opens at bracket depth 0, with only whitespace before it on its line;
    * the previous significant character is not a ``\\`` continuation;
    * after it comes only whitespace and an optional comment, then a newline
      or the end of the file -- so it is not an operand (``"x".format()``,
      ``"a" "b"``, ``"a" + b``), and implicit concatenation never qualifies.
    """
    text, kind = lexed.text, lexed.kind
    literal = text[start:end]
    prefix_match = _LITERAL_PREFIX.match(literal)
    prefix = (prefix_match.group(0) if prefix_match else "").lower()
    if "f" in prefix or "t" in prefix or "b" in prefix:
        return False
    if "r" not in prefix and "\\" in literal[len(prefix) :]:
        return False
    if depth_before[start] != 0:
        return False
    # Only code whitespace between the line start and the literal.
    j = start
    while j > 0 and text[j - 1] != "\n":
        j -= 1
        if not (kind[j] == _CODE and text[j] in " \t"):
            return False
    if j > 0 and kind[j - 1] != _CODE:
        # The line break before it belongs to a literal: not a statement start.
        return False
    # The previous significant character must not be a `\` continuation.
    k = j
    while k > 0:
        k -= 1
        if kind[k] == _COMMENT or text[k] in _RUST_WHITESPACE:
            continue
        if text[k] == "\\" and kind[k] == _CODE:
            return False
        break
    # Only whitespace / a comment until the end of the line.
    e, n = end, len(text)
    while e < n and kind[e] == _CODE and text[e] in " \t\r":
        e += 1
    while e < n and kind[e] == _COMMENT:
        e += 1
    return e == n or (text[e] == "\n" and kind[e] == _CODE)


# ---------------------------------------------------------------------------
# Conditions (a) and (b)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Entry:
    """One ``git diff --name-status`` record: a status and one or two paths."""

    status: str
    paths: tuple[str, ...]

    @property
    def shown(self) -> str:
        return f"{self.status} {' -> '.join(_display(p) for p in self.paths)}"


@dataclass(frozen=True)
class Qualified:
    """A change set that satisfies (a) and (b).

    ``migration`` is the one added migration, or ``None`` when every change is
    a proven non-executable edit (the doc-only verdict, D9).
    """

    migration: str | None
    non_executable_edits: tuple[str, ...]

    def env_lines(self) -> list[str]:
        if self.migration is None:
            files = ",".join(_display(p) for p in self.non_executable_edits)
            return [
                "MRT_DOC_ONLY=1",
                f"MRT_NON_EXECUTABLE_EDITS={len(self.non_executable_edits)}",
                f"MRT_NON_EXECUTABLE_FILES={files}",
            ]
        return ["MRT_DOC_ONLY=0", f"MRT_MIGRATION={self.migration}"]


class ConditionError(Exception):
    """A condition does not hold, or could not be decided."""

    def __init__(self, cond: str, message: str) -> None:
        super().__init__(message)
        self.cond = cond
        self.message = message


class ObjectReader(Protocol):
    """What :func:`exemption` needs from git: a path's tree entry at a commit,
    and a blob's bytes."""

    def entry(self, sha: str, path: str) -> tuple[str, str, str] | None: ...

    def blob(self, oid: str) -> bytes: ...


class GitObjects:
    """Reads a path's git mode and blob at a commit, from the cwd's repo.

    Plumbing only: ``ls-tree`` for the mode and object id, ``cat-file blob``
    for the bytes, so no textconv or filter ever rewrites what is compared.
    """

    def entry(self, sha: str, path: str) -> tuple[str, str, str] | None:
        """``(mode, type, object id)`` of ``path`` at ``sha``; ``None`` when
        the path does not exist there. Raises :class:`GitReadError` when git
        cannot answer."""
        proc = subprocess.run(
            [
                "git",
                "--literal-pathspecs",
                "ls-tree",
                "-z",
                "--full-tree",
                sha,
                "--",
                path,
            ],
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise GitReadError(proc.stderr.decode("utf-8", "replace").strip())
        for record in proc.stdout.split(b"\0"):
            meta, sep, name = record.partition(b"\t")
            if sep and name == os.fsencode(path):
                mode, obj_type, oid = meta.decode("ascii").split(" ")
                return mode, obj_type, oid
        return None

    def blob(self, oid: str) -> bytes:
        proc = subprocess.run(
            ["git", "cat-file", "blob", oid], capture_output=True, check=False
        )
        if proc.returncode != 0:
            raise GitReadError(proc.stderr.decode("utf-8", "replace").strip())
        return proc.stdout


class GitReadError(Exception):
    """git could not answer a read; the answer is UNKNOWN, never absent."""


def parse_name_status(raw: bytes) -> list[Entry]:
    """Parse ``git diff -z --name-status -M`` output.

    NUL-separated output is parsed rather than whitespace-split, so no path
    spelling can smuggle a second entry past the count. ``R<score>`` /
    ``C<score>`` carry two paths (old, new); every other status carries one.
    """
    fields = raw.decode("utf-8", "surrogateescape").split("\0")
    if fields and fields[-1] == "":
        fields.pop()
    entries: list[Entry] = []
    i = 0
    while i < len(fields):
        status = fields[i]
        n = 2 if status[:1] in ("R", "C") else 1
        paths = tuple(fields[i + 1 : i + 1 + n])
        if not status or len(paths) != n:
            raise ConditionError(
                "b",
                "could not parse git diff --name-status output near "
                f"{status!r}; refusing to guess.",
            )
        entries.append(Entry(status, paths))
        i += 1 + n
    return entries


def exemption(path: str, base_sha: str, head_sha: str, git: ObjectReader) -> Verdict:
    """Is the ``M`` entry ``path`` a proven non-executable edit from the base
    tip ``base_sha`` to the head ``head_sha``? The base side is the land
    target's text -- the side coord compares against -- so an edit made on a
    base that has since moved is judged against what it will land on."""
    if not path.lower().endswith(".py"):
        return _refuse("not_py")  # before any read: nothing to fetch
    sides: list[bytes] = []
    modes: list[str] = []
    for side, sha in (("base", base_sha), ("head", head_sha)):
        try:
            found = git.entry(sha, path)
            if found is None:
                return _refuse(f"absent_at_{side}")
            mode, obj_type, oid = found
            if obj_type != "blob":
                return _refuse("not_regular_file")
            sides.append(git.blob(oid))
        except GitReadError:
            return _refuse(f"unreadable_{side}")
        modes.append(mode)
    if modes[0] != modes[1]:
        return _refuse("mode_changed")
    if modes[0] not in REGULAR_FILE_MODES:
        return _refuse("not_regular_file")
    return is_non_executable_edit(path, sides[0], sides[1])


def qualify(
    entries: Iterable[Entry],
    base_sha: str,
    head_sha: str,
    git: ObjectReader,
    say: Callable[[str], None] = print,
) -> Qualified:
    """Decide conditions (a) and (b) over the PR's changed set."""
    touched = [e for e in entries if any(p.startswith(VERSIONS) for p in e.paths)]
    for entry in touched:
        say(f"  {entry.status}\t{' -> '.join(_display(p) for p in entry.paths)}")

    added: list[Entry] = []
    exempt: list[str] = []
    refused: list[tuple[Entry, str | None]] = []
    for entry in touched:
        kind = entry.status[:1]
        if kind == "A":
            added.append(entry)
        elif kind == "M":
            (path,) = entry.paths
            verdict = exemption(path, base_sha, head_sha, git)
            if verdict.ok:
                exempt.append(path)
                say(
                    f"  exempt: {_display(path)} is a proven non-executable edit "
                    f"(base tip {base_sha[:12]} -> head {head_sha[:12]}): only "
                    "comments, statement-position string literals, blank lines "
                    "and trailing whitespace differ."
                )
            else:
                refused.append((entry, verdict.reason))
        else:
            refused.append((entry, None))

    # ONLY an addition qualifies, apart from a proven non-executable edit. Any
    # other edit (M) of an existing migration keeps that file's revision id --
    # an id the base already defines -- so it is not a new migration; D/R/T/C
    # would test a different revision graph from the one that lands.
    if refused:
        shown = "; ".join(
            entry.shown if reason is None else f"{entry.shown} (not exempt: {reason})"
            for entry, reason in refused
        )
        raise ConditionError(
            "b",
            f"a file under {VERSIONS} is modified, deleted, renamed or "
            f"type-changed against the base ({shown}). Only a newly ADDED "
            "migration file can be the tested migration: an edit keeps a "
            "revision id the base already defines, and a deletion or rename "
            "tests a different revision graph from the one that lands. An edit "
            "(M) to an existing revision is exempt only when its head text "
            f"differs from its text at the base tip {base_sha} in comments, "
            "statement-position string literals, blank lines and trailing "
            "whitespace alone, with an unchanged regular-file mode -- each "
            "refusal reason is named above (scripts/ci/mrt_qualify.py; if the "
            "base has moved since this PR branched, rebase first).",
        )

    if not added and exempt:
        return Qualified(migration=None, non_executable_edits=tuple(exempt))

    if len(added) != 1:
        raise ConditionError(
            "a",
            f"exactly one file under {VERSIONS} must be added; this PR adds "
            f"{len(added)}. Split the PR so each migration is tested on its own.",
        )

    entry = added[0]
    (path,) = entry.paths
    if not MIGRATION.fullmatch(path):
        raise ConditionError(
            "a",
            f"the one file added under {VERSIONS} ({path!r}) is not a "
            "top-level .py migration file.",
        )
    return Qualified(migration=path, non_executable_edits=tuple(exempt))


def _display(path: str) -> str:
    """``path`` safe to print on one log line and to write to ``$GITHUB_ENV``:
    a control character, a surrogate-escaped undecodable byte or a comma (the
    file-list separator) is escaped rather than printed raw. A plain path is
    returned unchanged."""
    if all(ch.isprintable() and ch != "," and not _is_surrogate(ch) for ch in path):
        return path
    return repr(path)[1:-1].replace(",", "\\x2c")


def _is_surrogate(ch: str) -> bool:
    return 0xD800 <= ord(ch) <= 0xDFFF


def _error(cond: str, message: str) -> str:
    return f"::error title={ERROR_TITLE.format(cond=cond)}::{message}"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Qualify a PR's migration change set for Migration Reversal "
        "Tested (conditions (a) and (b)), exempting proven non-executable edits."
    )
    parser.add_argument(
        "--diff",
        required=True,
        type=Path,
        help="file holding `git diff -z --name-status -M <base>...<head>`",
    )
    parser.add_argument("--base", required=True, help="the base TIP sha")
    parser.add_argument("--head", required=True, help="the PR head sha")
    parser.add_argument(
        "--env-out",
        required=True,
        type=Path,
        help="file to write KEY=VALUE lines to (for $GITHUB_ENV), on success only",
    )
    args = parser.parse_args(argv)

    try:
        raw = args.diff.read_bytes()
    except OSError as exc:
        print(
            _error(
                "b",
                f"could not read the changed-file list {args.diff}: {exc}. Whether "
                "this PR qualifies is UNKNOWN -- not passed.",
            )
        )
        return 1
    try:
        result = qualify(parse_name_status(raw), args.base, args.head, GitObjects())
    except ConditionError as failed:
        print(_error(failed.cond, failed.message))
        return 1

    try:
        args.env_out.write_text(
            "".join(f"{line}\n" for line in result.env_lines()), encoding="utf-8"
        )
    except OSError as exc:
        print(
            _error(
                "b",
                "the change set qualified, but the result could not be written to "
                f"{args.env_out}: {exc} -- not passed.",
            )
        )
        return 1
    if result.migration is None:
        print(
            "Conditions (a) and (b) hold with NO migration to exercise: every "
            f"change under {VERSIONS} is a proven non-executable edit to an "
            f"existing revision ({len(result.non_executable_edits)}: "
            f"{', '.join(_display(p) for p in result.non_executable_edits)})."
        )
    else:
        extra = ""
        if result.non_executable_edits:
            extra = (
                f" {len(result.non_executable_edits)} other change(s) under "
                f"{VERSIONS} are proven non-executable edits and keep their "
                "base text in the isolated tree."
            )
        print(
            "Conditions (a) and (b) hold: the one migration file is "
            f"{result.migration} (A).{extra}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
