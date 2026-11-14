"""The string scans shared by every allowlist that freezes text for a reader.

Two allowlists use them: the public build record
(:mod:`app.services.build_record_allowlist`, plan
``2026-10-09-factory-built-product-portfolio-and-launch-kit`` D3) and the
stakeholder report snapshot (:mod:`app.overview.report_snapshot_contract`,
plan ``2026-11-07-interactive-stakeholder-reports-in-the-project-overview``
D4). Each decides WHICH strings it scans and what a match means; this module
only says how a string is read.

* :func:`normalize_for_scan` — the STRIPPED form every content check reads:
  NFKD, marks and invisibles dropped, NFKC, the confusable skeleton, every dash
  as ``-``, lookalike slashes as ``/``, and the transparent characters around a
  slash removed. A character that renders as nothing, or as something it is
  not, therefore cannot split the token a check is looking for.
* :func:`has_hidden_characters` — a string carrying a format, control,
  unassigned, private-use or surrogate character, a default-ignorable code
  point, a combining overlay or a blank-rendering glyph. Each allowlist refuses
  such a string outright; the scans also run on the stripped form, so this is
  one layer, not the only one.
* :data:`UUID_RE` and :data:`EMAIL_RE` — a UUID (dashed, or the same 128 bits as
  a bare 32-hex run) and an email-shaped identity, matched against the stripped
  form.

Every regex here runs in linear time (anchored starts, possessive
quantifiers), so no input can make a scan slow; the build record's public
route runs these on every read. The module needs only the standard library,
because the build record's scanner-parity generator imports it in isolated
mode (``backend/scripts/gen_build_record_scan_vectors.py``).

A change to any table or rule here changes what the build record refuses, so
it needs a build-record ``ALLOWLIST_VERSION`` bump and a regenerated parity
fixture — and a report ``REPORT_ALLOWLIST_VERSION`` bump.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Final

from app.services.build_record_slash_confusables import TR39_SLASH_CONFUSABLES

#: A dashed UUID, or the same 128 bits as a bare 32-hex run. A 40-hex commit
#: sha is NOT matched (the run must be exactly 32 hex characters long).
UUID_RE: Final = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    r"|(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])"
)
#: ``user@host`` is enough — an internal host needs no dot to identify a person.
#: Starts only at the beginning of a local-part run (lookbehind) and never
#: backtracks into it (possessive), so a long run with no ``@`` is O(n), not
#: O(n²) — see the adversarial timing test in ``tests/test_build_records.py``.
EMAIL_RE: Final = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]++@[A-Za-z0-9-]")
#: Lookalikes TR39 does not list as slash confusables but that render as a
#: slash in common fonts, found in review: U+141F CANADIAN SYLLABICS FINAL
#: ACUTE (not in confusables.txt at all).
SLASH_LOOKALIKE_SUPPLEMENT: Final[tuple[int, ...]] = (0x141F,)
#: Characters that render as ``/`` but are not it, folded to ``/``: every code
#: point Unicode TR39 ``confusables.txt`` maps to U+002F (vendored, with its
#: version and date, in :mod:`app.services.build_record_slash_confusables` by
#: ``backend/scripts/vendor_slash_confusables.py`` — no hand-picking), plus
#: :data:`SLASH_LOOKALIKE_SUPPLEMENT`. Any OTHER non-ASCII math symbol or
#: "other punctuation" sitting between two ASCII alphanumerics is treated as a
#: slash too (:data:`_INFIX_SYMBOL_RE`).
LOOKALIKE_SLASHES: Final = dict.fromkeys(
    sorted({*TR39_SLASH_CONFUSABLES, *SLASH_LOOKALIKE_SUPPLEMENT}), "/"
)
#: A non-ASCII character between two ASCII alphanumerics (spaces allowed);
#: :func:`_infix_to_slash` keeps it only when it is ``Sm`` or ``Po``.
_INFIX_SYMBOL_RE: Final = re.compile(
    r"(?<=[A-Za-z0-9])\s*+([^\x00-\x7f])\s*+(?=[A-Za-z0-9])"
)

#: A compact confusable skeleton (in the spirit of Unicode TR39) for the
#: scripts whose letters are drawn like Latin ones: Cyrillic and Greek
#: lookalikes → the Latin letter they render as. No confusables library is a
#: dependency of this backend; this table covers the letters an attacker can
#: actually type to make ``acme/secret`` scan as something else. Applied to the
#: scan form only — a stored document is never rewritten.
_CONFUSABLES: Final = str.maketrans(
    {
        # Cyrillic lower
        "а": "a",
        "в": "b",
        "е": "e",
        "к": "k",
        "м": "m",
        "н": "h",
        "о": "o",
        "р": "p",
        "с": "c",
        "т": "t",
        "у": "y",
        "х": "x",
        "ѕ": "s",
        "і": "i",
        "ј": "j",
        "ґ": "r",
        "һ": "h",
        "ԁ": "d",
        "ԛ": "q",
        "ԝ": "w",
        "ѵ": "v",
        "ӏ": "l",
        "ɡ": "g",
        # Cyrillic upper
        "А": "A",
        "В": "B",
        "Е": "E",
        "К": "K",
        "М": "M",
        "Н": "H",
        "О": "O",
        "Р": "P",
        "С": "C",
        "Т": "T",
        "У": "Y",
        "Х": "X",
        "Ѕ": "S",
        "І": "I",
        "Ј": "J",
        "Ӏ": "I",
        "Ԛ": "Q",
        "Ԝ": "W",
        # Greek lower
        "α": "a",
        "β": "b",
        "ε": "e",
        "ι": "i",
        "κ": "k",
        "ν": "v",
        "ο": "o",
        "ρ": "p",
        "τ": "t",
        "υ": "u",
        "χ": "x",
        "γ": "y",
        # Greek upper
        "Α": "A",
        "Β": "B",
        "Ε": "E",
        "Ζ": "Z",
        "Η": "H",
        "Ι": "I",
        "Κ": "K",
        "Μ": "M",
        "Ν": "N",
        "Ο": "O",
        "Ρ": "P",
        "Τ": "T",
        "Υ": "Y",
        "Χ": "X",
        # Latin-script lookalikes outside ASCII
        "ı": "i",
        "ɩ": "i",
        "ǀ": "l",
    }
)
#: Every dash-punctuation (``Pd``) character, and U+2212 MINUS SIGN, scans as
#: ``-`` — so a UUID or repo name written with en dashes is still seen.
_EXTRA_DASHES: Final = frozenset("−")

#: Unicode ``Default_Ignorable_Code_Point`` — characters that render as
#: NOTHING, whatever their general category (U+3164 is ``Lo``, the variation
#: selectors are ``Mn``). As (first, last) inclusive ranges.
DEFAULT_IGNORABLE_RANGES: Final[tuple[tuple[int, int], ...]] = (
    (0x00AD, 0x00AD),
    (0x034F, 0x034F),
    (0x061C, 0x061C),
    (0x115F, 0x1160),
    (0x17B4, 0x17B5),
    (0x180B, 0x180F),
    (0x200B, 0x200F),
    (0x202A, 0x202E),
    (0x2060, 0x206F),
    (0x3164, 0x3164),
    (0xFE00, 0xFE0F),
    (0xFEFF, 0xFEFF),
    (0xFFA0, 0xFFA0),
    (0xFFF0, 0xFFF8),
    (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A),
    (0xE0000, 0xE0FFF),
)
#: Categories a string is REFUSED for carrying (with the default-ignorables
#: and the overlays): format, control, unassigned, private use, surrogate.
REFUSED_CATEGORIES: Final = frozenset({"Cf", "Cc", "Cn", "Co", "Cs"})
#: Categories dropped from the STRIPPED scan form (adds the combining marks,
#: which are not refused — an accent is legitimate — but must not split a
#: token: ``secrét`` scans as ``secret``).
STRIPPED_CATEGORIES: Final = frozenset({"Mn", "Me", "Cf", "Cc", "Cn", "Co", "Cs"})
#: Glyphs that render as blank space but are neither whitespace nor
#: default-ignorable, so they survive normalisation and split a token:
#: ``acme⠀/⠀secret`` (U+2800 BRAILLE PATTERN BLANK, category So)
#: renders as "acme / secret"; U+1D159 MUSICAL SYMBOL NULL NOTEHEAD likewise.
#: Refused as hidden characters — belt and braces: the structural fix is
#: :data:`SLASH_TRANSPARENT_CATEGORIES`, which makes ANY ``So``/``Sk`` symbol
#: or separator next to a slash unable to split a token. The other blank
#: fillers (U+115F, U+1160, U+17B4, U+17B5, U+3164, U+FFA0) are already
#: default-ignorable (:data:`DEFAULT_IGNORABLE_RANGES`), so are not repeated.
BLANK_RENDERING_GLYPHS: Final = frozenset("⠀\U0001d159")
#: Combining marks that draw a stroke THROUGH the previous character, so
#: ``a̸b`` can render like ``a/b`` while scanning as two letters.
OVERLAY_MARKS: Final = frozenset("̴̵̶̷̸⃒⃓⃥⃦")


def is_default_ignorable(ch: str) -> bool:
    code = ord(ch)
    return any(lo <= code <= hi for lo, hi in DEFAULT_IGNORABLE_RANGES)


def _infix_to_slash(match: re.Match[str]) -> str:
    ch = match.group(1)
    if ch == "/" or unicodedata.category(ch) in ("Sm", "Po"):
        return "/"
    return match.group(0)


#: Character categories that are TRANSPARENT at a slash: stripped from the
#: slash-adjacent edge of each piece by :func:`collapse_spaced_slashes`.
#: Separators (``Zs Zl Zp``), the symbol classes ``So`` (other symbol) and
#: ``Sk`` (modifier symbol), modifier letters ``Lm`` (``ʼ`` U+02BC, ``ː``
#: U+02D0) and spacing marks ``Mc`` (U+1D165), plus non-ASCII ``Po``
#: (:data:`SLASH_TRANSPARENT_NON_ASCII_CATEGORIES`) — none can be part of a
#: repo name, and some render as blank space in common fonts (U+2800, U+1D159). A
#: symbol next to a slash therefore cannot keep an ``owner / name`` apart:
#: the scan sees exactly what it would see had the symbol not been typed.
#: Letters, digits and punctuation (``(``, ``)``, ``,`` …) are NOT transparent:
#: they are what a reader sees ending a token, so ``(lint)/(test)`` stays two
#: bracketed words. Python whitespace (``str.isspace``) is transparent too.
SLASH_TRANSPARENT_CATEGORIES: Final = frozenset(
    {"Lm", "Mc", "Sk", "So", "Zl", "Zp", "Zs"}
)
#: Transparent at a slash only when NON-ASCII: ``Po`` (other punctuation) —
#: ``·`` U+00B7, ``‧`` U+2027 … — while ASCII ``Po`` (``. , : ; ! ? ' "`` …)
#: stays a visible token end.
SLASH_TRANSPARENT_NON_ASCII_CATEGORIES: Final = frozenset({"Po"})


def _slash_transparent(ch: str) -> bool:
    category = unicodedata.category(ch)
    return (
        ch.isspace()
        or category in SLASH_TRANSPARENT_CATEGORIES
        or (category in SLASH_TRANSPARENT_NON_ASCII_CATEGORIES and ord(ch) > 0x7F)
    )


def _strip_edge(piece: str, *, left: bool, right: bool) -> str:
    start, end = 0, len(piece)
    if left:
        while start < end and _slash_transparent(piece[start]):
            start += 1
    if right:
        while end > start and _slash_transparent(piece[end - 1]):
            end -= 1
    return piece[start:end]


def collapse_spaced_slashes(text: str) -> str:
    """Remove every slash-transparent character (whitespace and the
    :data:`SLASH_TRANSPARENT_CATEGORIES` symbols) on both sides of EVERY
    ``/`` — and nothing else.

    A split, not a regex: linear by construction, and each slash is handled on
    its own, so ``a / / b`` becomes ``a//b`` and ``acme\U0001d159/\U0001d159secret``
    becomes ``acme/secret``. This is the structural fix for blank-rendering
    symbols splitting an owner/name token: no list of individual glyphs.
    """
    pieces = text.split("/")
    if len(pieces) == 1:
        return text
    last = len(pieces) - 1
    return "/".join(
        _strip_edge(piece, left=i > 0, right=i < last) for i, piece in enumerate(pieces)
    )


def normalize_for_scan(text: str) -> str:
    """The STRIPPED form every content check reads.

    NFKD, then every combining mark (``Mn``/``Me``), format, control,
    unassigned, private-use and surrogate character and every
    default-ignorable code point is DROPPED, then NFKC (folds fullwidth and
    other compatibility forms to ASCII), then the confusable skeleton
    (Cyrillic/Greek lookalikes → Latin) and every ``Pd`` dash → ``-``.
    Lookalike slashes, and any non-ASCII
    ``Sm``/``Po`` between two ASCII alphanumerics, become ``/``; whitespace
    around ``/`` is removed. So ``acme ∕ secret``, ``acme⟋secret`` and
    ``secrét`` all scan as what they render as.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    kept = "".join(
        ch
        for ch in decomposed
        if unicodedata.category(ch) not in STRIPPED_CATEGORIES
        and not is_default_ignorable(ch)
    )
    folded = unicodedata.normalize("NFKC", kept).translate(_CONFUSABLES)
    folded = "".join(
        "-" if unicodedata.category(ch) == "Pd" or ch in _EXTRA_DASHES else ch
        for ch in folded
    ).translate(LOOKALIKE_SLASHES)
    folded = _INFIX_SYMBOL_RE.sub(_infix_to_slash, folded)
    return collapse_spaced_slashes(folded)


def has_hidden_characters(text: str, *, allowed: frozenset[str] = frozenset()) -> bool:
    """Characters that render as nothing (format ``Cf``, control ``Cc``, every
    default-ignorable code point whatever its category), that have no agreed
    rendering at all (unassigned ``Cn``, private use ``Co``, surrogates
    ``Cs``), or that draw a slash which is not one (overlay marks), or blank
    space that is not whitespace (:data:`BLANK_RENDERING_GLYPHS`).

    ``allowed`` names characters a caller's slot legitimately carries — the
    report contract lets multi-line text keep its newlines and tabs — and is
    empty for the build record, whose every scanned string is one line.
    """
    return any(
        ch not in allowed
        and (
            unicodedata.category(ch) in REFUSED_CATEGORIES
            or is_default_ignorable(ch)
            or ch in OVERLAY_MARKS
            or ch in BLANK_RENDERING_GLYPHS
        )
        for ch in text
    )
