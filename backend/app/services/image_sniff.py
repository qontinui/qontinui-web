"""Identify an uploaded image from its bytes alone.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``: the
content-addressed image store never trusts a client's filename, extension or
``Content-Type``. The format comes from the bytes' signature (an allow-list —
anything else is refused, never coerced to a default), and Pillow, restricted
to that one format's parser, must then read the same format's header and its
dimensions. A file whose signature claims a format its header does not bear
out is refused as unreadable.

Nothing here DECODES pixels: ``Image.open`` reads the header; the frame count
comes from the container (a GIF's from a walk of its block structure, which
skips the image data); a GIF's frame extents come from that same walk, and a
multi-picture JPEG's picture sizes from each picture's own header; the EXIF
orientation comes from the metadata the header carries. So a sniff's cost
does not grow with the pixels an image declares.

Nor does it grow with how finely the file is cut up. Pillow parses a header
in Python, one step per JPEG segment or stray byte, PNG chunk, or GIF block,
sub-block or stray byte (0.1-0.3 µs a step: 25 MiB of empty segments took it
seconds). So before Pillow opens a file, a capped walk of the structure
Pillow is about to parse refuses it, by the cap's own code, one step past
the cap: a JPEG's markers up to its first SOS (:data:`MAX_JPEG_SEGMENTS`,
:data:`MAX_JPEG_STRAY_BYTES`), a PNG's chunks up to its first IDAT
(:data:`MAX_PNG_CHUNKS_BEFORE_IMAGE_DATA`), a GIF's blocks (stopping one
frame past :data:`MAX_FRAMES`, and at the block, extension, sub-block and
stray-byte caps below). The walks skip what Pillow skips in bulk — a
segment's or chunk's body by its length, stray GIF bytes by search — so
their own cost is bounded by the same caps. A multi-picture JPEG holds at
most :data:`MAX_PICTURES` pictures, whose DECLARED byte ranges must be
disjoint and inside the file. Pillow parses the first picture's header from
the start of the file, not of its range, so it must end inside that range;
each later picture's header is walked and parsed from its own range alone.

Nor does it grow with what one piece of structure claims. Inside a JPEG
segment Pillow loops in Python over a frame header's components, a
quantization segment's tables and a Photoshop segment's resources, so each
of those is held to its standard length or a byte budget
(:data:`MAX_JPEG_FRAME_HEADERS`, :data:`MAX_JPEG_QUANTIZATION_SEGMENTS`,
:data:`MAX_JPEG_PHOTOSHOP_BYTES`); a PNG's compressed chunks before its image
data, each inflated to up to 1 MiB, are capped
(:data:`MAX_PNG_COMPRESSED_CHUNKS_BEFORE_IMAGE_DATA`). EXIF and a JPEG's
multi-picture index are TIFF directories, whose entries each point at a
value Pillow reads afresh — many entries at one large value multiply it — so
a directory is walked before Pillow reads it (a JPEG's in the header walk, an
AVIF's before Pillow's open, a PNG's or WebP's in place of Pillow's EXIF
reader): at most :data:`MAX_TIFF_ENTRIES` entries, whose values may not add
up to more than the block that holds them, behind at most
:data:`MAX_EXIF_HEADERS` ``Exif`` headers, in at most
:data:`MAX_JPEG_EXIF_SEGMENTS` JPEG segments. Pillow's AVIF open may
re-encode the whole block — IFD0 and the Exif, GPS and Interoperability
directories, every value joined on by ``+=`` — so an AVIF's block is at most
:data:`MAX_AVIF_EXIF_BYTES`, and all four directories share the one budget.

So, for each of at most MAX_PICTURES pictures, Pillow's header parse visits
at most the caps' worth of structure, does at most the caps' worth of Python
work inside it, and reads from a metadata block at most that block's own
length, plus a byte search over the file; its other reads are bulk copies of
at most the file. What is left grows with the file's length alone. The
pixel bound below is checked before any consumer decodes anything.

What Pillow — or a codec beneath it — raises while it READS the file is the
file's fault: a refusal (``image_unreadable``), a 422, never a 500, and logged
so it can be counted. What this module's own code raises is not: only the
failure a helper documents (a structure a walk refuses, by its cap's code or
as unreadable) is caught, narrowly, and ``MemoryError`` /
``RecursionError`` always propagate — a server fault stays a 5xx.

Accepted: PNG, JPEG, GIF, WebP and AVIF — the raster formats the image
pipeline produces (generated candidates, AVIF/WebP derivatives, captures) and
an operator's own reference images arrive in. SVG is refused on purpose: it is
active content (script, external references) rather than an image a judge or
an embedding model can read, and no consumer of this store uploads one.
"""

from __future__ import annotations

import io
import itertools
import re
import struct
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Final

import structlog
from PIL import (
    AvifImagePlugin,
    Image,
    JpegImagePlugin,
    MpoImagePlugin,
    TiffImagePlugin,
)

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class ImageFormat:
    """One accepted format: Pillow's name for it, its MIME type, its extension."""

    pillow_name: str
    mime_type: str
    extension: str


PNG: Final = ImageFormat("PNG", "image/png", ".png")
JPEG: Final = ImageFormat("JPEG", "image/jpeg", ".jpg")
GIF: Final = ImageFormat("GIF", "image/gif", ".gif")
WEBP: Final = ImageFormat("WEBP", "image/webp", ".webp")
AVIF: Final = ImageFormat("AVIF", "image/avif", ".avif")

#: Every format the store accepts. ``app.models.image_asset.IMAGE_MIME_TYPES``
#: (and the ``ck_image_assets_mime_type`` CHECK) list the same MIME types;
#: ``tests/test_image_sniff.py`` holds the two equal.
ACCEPTED_FORMATS: Final[tuple[ImageFormat, ...]] = (PNG, JPEG, GIF, WEBP, AVIF)

#: The largest number of pixels a decoder may have to produce: the CANVAS it
#: decodes onto × the number of frames, because a reader that decodes an
#: animation decodes every frame onto that canvas. The canvas is the declared
#: image size, except where a frame can be larger:
#:
#: * a GIF frame may overhang the logical screen, and a decoder (Pillow, a
#:   browser) grows its canvas to cover it — so a GIF's canvas is the screen
#:   grown to the largest extent, ``max(left + width)`` × ``max(top +
#:   height)``, over every frame;
#: * each picture of a multi-picture JPEG has its own size — so its canvas is
#:   the largest width × the largest height among them.
#:
#: (An APNG frame outside its canvas is refused by Pillow, and a WebP one by
#: libwebp's demuxer, so theirs is the declared size.) The value is Pillow's
#: default decompression-bomb threshold (``Image.MAX_IMAGE_PIXELS``). Neither
#: the byte cap nor a per-frame bound is enough: a few hundred bytes of PNG can
#: declare a 10 000 × 10 000 canvas; a 150 KB animated WebP can declare 3 000
#: frames of 9 000 × 9 000 — 243 billion pixels, each frame under a per-frame
#: bound; and a GIF with a 10 × 10 screen can carry a 12 000 × 12 000 frame.
MAX_IMAGE_PIXELS: Final = 89_478_485

#: The most frames an image may hold. The pipeline's producers (Phases 19-23)
#: emit stills and short loops; without a cap a GIF of 1×1 frames fits ~1.7
#: million of them in the 25 MB upload cap, and merely counting them costs
#: seconds of CPU. A GIF's frames are counted by a walk that stops one frame
#: past the cap, so the refusal costs no more than the cap does.
MAX_FRAMES: Final = 1000

#: The most extension blocks (graphic control, comment, application, …) a GIF
#: may carry before one frame — or before its trailer. An encoder writes one
#: graphic control block per frame, plus a loop block and perhaps a comment
#: or an XMP packet before the first; 64 is far past any of them. Without a
#: cap, 25 MB of empty three-byte comment blocks is 8.7 million blocks: 2.6 s
#: for this walk, and — before the first frame, where Pillow's own walk joins
#: the comments by concatenation — far longer for Pillow.
MAX_GIF_EXTENSIONS_PER_FRAME: Final = 64

#: The most blocks (extensions and image descriptors) the GIF walk visits in
#: all. With the per-frame cap this bounds the walk's block count even across
#: MAX_FRAMES frames: eight blocks per frame on average — a frame takes two
#: (its graphic control block and its descriptor) — leaves room for comments.
MAX_GIF_BLOCKS: Final = 8 * MAX_FRAMES

#: The most data sub-blocks a GIF frame's comment extensions may hold
#: together. Pillow joins them by ``bytes +=`` — each piece copies what came
#: before — so its cost is quadratic in the pieces: one comment of 2 MB in
#: one-byte sub-blocks took Pillow 8.6 s to open. 256 sub-blocks is up to
#: 64 KB of comment text in the 255-byte sub-blocks an encoder writes.
MAX_GIF_COMMENT_SUB_BLOCKS_PER_FRAME: Final = 256

#: The most data sub-blocks the GIF walk visits in all — image data and every
#: extension's. An encoder fills sub-blocks to 255 bytes, so the 25 MiB
#: upload cap holds about 103 000 of them; this cap still admits sub-blocks
#: averaging 100 bytes. Without it, 25 MiB of one-byte sub-blocks — in a
#: frame's image data, or in an application or plain-text extension, which
#: Pillow's own walk to the first frame then reads one by one — took 1.1-4 s.
#: One cap over all of them bounds both walks; a per-extension cap would
#: bound nothing more, and would refuse a large XMP packet (written raw, so
#: a walker reads its text as sub-block lengths — one per ~80 bytes).
MAX_GIF_SUB_BLOCKS: Final = 1 << 18

#: The most bytes before a GIF's first frame that start no block. Pillow
#: skips such a byte one Python step at a time on its walk to the first frame
#: (25 MiB of them took it 2 s) and accepts any number. An encoder writes
#: none; a stray terminator byte or two is the known defect; 256 is far past
#: it. (Stray bytes after the first frame cost the walk a search, not a step,
#: and Pillow's open never reaches them.)
MAX_GIF_STRAY_BYTES_BEFORE_FIRST_FRAME: Final = 256

#: The most markers a JPEG's header may hold before its first SOS (start of
#: scan), where Pillow's parse stops. A camera writes about a dozen (APP0/1/2
#: — EXIF, XMP, ICC and MPF —, DQT, SOF, DHT, DRI); a long ICC profile or an
#: extended-XMP packet (a depth map, an original kept beside an edit) is split
#: across 64 KiB segments, and the 25 MiB upload cap holds at most ~400 full
#: ones. 1024 admits any of those. Without a cap, 25 MiB of empty segments
#: took Pillow 3-9 s. This cap bounds Pillow's STEPS from segment to segment;
#: what it does INSIDE a segment is bounded by the per-kind caps below — SOF,
#: DQT, APP13 Photoshop, APP1 EXIF and APP2 MPF are the segments it parses in
#: Python; every other kind it takes with one bulk read and keeps whole.
MAX_JPEG_SEGMENTS: Final = 1024

#: The most frame headers (SOFn, and DHP, which Pillow parses the same way) a
#: JPEG's header may hold before its first SOS. An encoder writes one; a
#: hierarchical JPEG's further frames follow scans, past where Pillow stops.
#: Each is also held to its exact standard length (:func:`_jpeg_header_end`):
#: Pillow loops over a frame header's bytes three at a time, so without that
#: rule 399 maximum-length ones (8.7 million component triplets) were
#: accepted at 1.7 s and 830 MB.
MAX_JPEG_FRAME_HEADERS: Final = 4

#: The most quantization-table segments (DQT) before the first SOS. An encoder
#: writes one to four (a table per component, or all in one segment). Each is
#: also held to at most four tables of 16-bit precision, ``2 + 4·129`` bytes:
#: Pillow builds a 64-entry list per table in Python, and 25 MiB of tables
#: took it 0.75 s.
MAX_JPEG_QUANTIZATION_SEGMENTS: Final = 8
_MAX_DQT_LENGTH: Final = 2 + 4 * (1 + 2 * 64)

#: The most bytes of Photoshop resource blocks (APP13 ``Photoshop 3.0``) a
#: JPEG's header may hold. Pillow walks every 8BIM resource in Python — 25 MiB
#: of empty ones took it 0.74 s; 256 KiB (four full segments, far past the
#: IPTC, resolution and thumbnail resources an editor writes) costs it under
#: about 30 ms.
MAX_JPEG_PHOTOSHOP_BYTES: Final = 256 * 1024

#: The most APP1 EXIF segments a JPEG's header may hold. The EXIF standard
#: puts the whole block in ONE segment of at most 64 KiB; Pillow joins every
#: one it meets by ``+=`` (a copy of all before it, each time), and a writer
#: that repeats the block is the known defect. 8 bounds the joined block at
#: 512 KiB.
MAX_JPEG_EXIF_SEGMENTS: Final = 8

#: The most entries the first directory of a TIFF-structured metadata block
#: (EXIF, a JPEG's multi-picture index) may hold. Pillow reads every entry of
#: it, in Python, at open: IFD0 of a camera's EXIF holds 10-30 (the camera's
#: own tags live in sub-directories Pillow does not read at open), an MP index
#: 3-5. 512 is far past both; without a cap 65 535 entries are a quarter of a
#: second of Python per block.
MAX_TIFF_ENTRIES: Final = 512

#: The largest EXIF block an AVIF may carry. Pillow's AVIF open re-encodes the
#: block whenever the container's orientation (``irot``/``imir``) differs
#: from the block's own, joining every value onto the result by ``+=``: a
#: copy per value of all before it, across up to four directories of
#: :data:`MAX_TIFF_ENTRIES` entries. A 25 MiB block took it 0.5 s. A JPEG's
#: EXIF is at most 64 KiB, and a camera's or phone's AVIF/HEIF EXIF is the
#: same block; 128 KiB is twice that, and bounds the re-encode's copying at
#: a few hundred MB.
MAX_AVIF_EXIF_BYTES: Final = 128 * 1024

#: How many ``Exif\0\0`` headers may precede an EXIF block's TIFF structure.
#: Pillow strips them one slice (a copy of the rest) at a time, so 25 MiB of
#: them is quadratic. A JPEG's block carries one; a PNG ``eXIf`` chunk written
#: with the header inside it carries two once Pillow adds its own.
MAX_EXIF_HEADERS: Final = 2

#: The most bytes a JPEG's header may hold before its first SOS that are not
#: a segment: fill (0xFF repeated before a marker, which the standard
#: allows), a stuffed 0xFF00, and stray bytes between segments. Pillow skips
#: each one Python step at a time (25 MiB of fill took it 4 s); 64 KiB — one
#: segment's worth — costs it about 20 ms, and no encoder writes near it.
MAX_JPEG_STRAY_BYTES: Final = 64 * 1024

#: The most chunks a PNG may hold before its image data (the first IDAT),
#: IHDR included — where Pillow's parse stops. An encoder writes a handful
#: (PLTE, tRNS, gAMA/cHRM/sRGB/iCCP, pHYs, a few text chunks, eXIf, acTL and
#: the first fcTL); a chunk holds up to 2 GiB, so no amount of metadata needs
#: many. Without a cap, 25 MiB of empty chunks took Pillow 2.4-3.5 s.
MAX_PNG_CHUNKS_BEFORE_IMAGE_DATA: Final = 256

#: The most compressed chunks (iCCP, zTXt, and iTXt with its compression flag
#: set) a PNG may hold before its image data. Pillow inflates each at open, up
#: to 1 MiB apiece: 254 of them took it 0.57 s. An encoder writes one ICC
#: profile and a few compressed text chunks — ImageMagick's raw EXIF, IPTC,
#: XMP and 8BIM profiles are five; 16 costs Pillow about 40 ms.
MAX_PNG_COMPRESSED_CHUNKS_BEFORE_IMAGE_DATA: Final = 16

#: The most pictures a multi-picture JPEG (CIPA MPO) may hold. The files this
#: store expects carry two — a stereo pair from a 3D camera, or a primary
#: picture and its large preview (or an HDR gain map) — and eight leaves room
#: past them. CIPA's panorama and multi-angle types can hold more; they are
#: refused by name, not misread. Each picture's header is walked and parsed
#: from its own byte range, so the cap bounds the work per sniff.
MAX_PICTURES: Final = 8

#: What Pillow raises for the malformed files it anticipates. Anything else it
#: raises while reading is still the file's refusal, but it is logged with its
#: traceback, so a defect in Pillow (or a codec) can be counted.
_ANTICIPATED_READ_ERRORS: Final = (SyntaxError, OSError, ValueError, EOFError)

#: A GIF block starts with one of these bytes (extension, image descriptor,
#: trailer). Pillow skips any other byte between blocks; so does the walk —
#: by search, not byte by byte.
_GIF_BLOCK_START: Final = re.compile(rb"[!,;]")

#: What Pillow's JPEG parser skips between two markers, one byte per step:
#: any byte but 0xFF, a stuffed 0xFF00, and an 0xFF followed by another
#: (fill). Where it stops, an 0xFF and a marker byte follow — or the file ends.
_JPEG_SKIPPED: Final = re.compile(rb"(?:[^\xff]|\xff\x00|\xff(?=\xff))*")

#: The JPEG marker that ends Pillow's header parse: start of scan.
_JPEG_SOS: Final = 0xFFDA

#: The PNG chunks Pillow's header parse stops at.
_PNG_IMAGE_DATA: Final = frozenset({b"IDAT", b"fdAT", b"IEND"})

#: The PNG chunks Pillow always inflates at open (iTXt only when flagged).
_PNG_COMPRESSED: Final = frozenset({b"iCCP", b"zTXt"})

#: The headers Pillow's TIFF reader accepts, and the size of one value of
#: each entry type it reads (an entry of any other type it skips unread) —
#: Pillow's own tables, so the walk reads what Pillow reads.
_TIFF_PREFIXES: Final = tuple(TiffImagePlugin.PREFIXES)
_TIFF_TYPE_SIZES: Final = {
    entry_type: loader[0]
    for entry_type, loader in TiffImagePlugin.ImageFileDirectory_v2._load_dispatch.items()
}

#: An EXIF block's own header, before its TIFF structure.
_EXIF_HEADER: Final = b"Exif\x00\x00"

#: Brands of an ISO-BMFF ``ftyp`` box that make the file AVIF (still or
#: sequence). HEIC shares the container and carries none of them.
_AVIF_BRANDS: Final = frozenset({b"avif", b"avis"})

#: Pillow's JPEG parser reports a multi-picture camera JPEG (CIPA MPO) as
#: ``MPO``. Its first picture is an ordinary JPEG — what a browser renders —
#: so it is a JPEG for this store.
_PILLOW_FORMAT_ALIASES: Final = {"MPO": "JPEG"}

#: EXIF tag 0x0112. Values 1-8; 5-8 rotate by a quarter turn, so the image a
#: browser shows is the encoded one with width and height exchanged.
_EXIF_ORIENTATION_TAG: Final = 0x0112
_QUARTER_TURN_ORIENTATIONS: Final = frozenset({5, 6, 7, 8})


class ImageRefused(Exception):
    """The bytes are not an image this store accepts.

    ``code`` is the stable machine-readable reason the API answers with.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class SniffedImage:
    """What the bytes say about themselves.

    ``width`` × ``height`` is the image as DISPLAYED — what a browser renders,
    which applies the EXIF orientation: for orientations 5-8 the encoded
    dimensions are exchanged. ``orientation`` is that EXIF value (1-8), or
    None when the file declares none (or one outside 1-8, which no renderer
    applies). ``frames`` is how many frames the container declares.
    """

    format: ImageFormat
    width: int
    height: int
    orientation: int | None
    frames: int

    @property
    def mime_type(self) -> str:
        return self.format.mime_type

    @property
    def extension(self) -> str:
        return self.format.extension


def _is_avif(data: bytes) -> bool:
    """An ISO-BMFF file whose ``ftyp`` box names an AVIF brand.

    The box is ``size(4) 'ftyp' major_brand(4) minor_version(4)
    compatible_brands(4×n)``; the major brand OR any compatible brand may
    carry ``avif`` / ``avis`` (a ``mif1``-major file listing ``avif`` is
    AVIF).
    """
    if len(data) < 16 or data[4:8] != b"ftyp":
        return False
    box_size = int.from_bytes(data[0:4], "big")
    if box_size < 16 or box_size > len(data):
        return False
    brands = {data[8:12]}
    brands.update(data[i : i + 4] for i in range(16, box_size - 3, 4))
    return bool(brands & _AVIF_BRANDS)


def format_from_signature(data: bytes) -> ImageFormat | None:
    """The accepted format whose signature ``data`` starts with, or None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if data.startswith(b"\xff\xd8\xff"):
        return JPEG
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return GIF
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    if _is_avif(data):
        return AVIF
    return None


def _log_refused_read(event: str, fmt: ImageFormat, exc: BaseException) -> None:
    """A swallowed exception, counted: its type and message at warning, and
    its traceback when it is not one Pillow anticipates."""
    logger.warning(
        event,
        format=fmt.pillow_name,
        error_type=type(exc).__name__,
        error=str(exc)[:300],
        exc_info=None if isinstance(exc, _ANTICIPATED_READ_ERRORS) else exc,
    )


@contextmanager
def _reading(fmt: ImageFormat) -> Iterator[None]:
    """Around a call into Pillow that reads the upload — and only such a
    call: what Pillow raises there is the file's refusal. A decompression
    bomb is ``image_too_many_pixels``; ``MemoryError`` and ``RecursionError``
    are this server's, and propagate."""
    try:
        yield
    except (MemoryError, RecursionError, ImageRefused):
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageRefused(
            "image_too_many_pixels",
            f"The image declares more than {MAX_IMAGE_PIXELS} pixels.",
        ) from exc
    except Exception as exc:
        _log_refused_read("image_unreadable", fmt, exc)
        raise ImageRefused(
            "image_unreadable",
            f"The bytes carry a {fmt.mime_type} signature but no readable "
            f"{fmt.pillow_name} header.",
        ) from exc


class _StructureRefused(ValueError):
    """A structure a pre-Pillow walk refuses: past one of its caps, refused
    by that cap's own code — or, for a GIF, cut off or malformed where
    Pillow's own walk would raise or lose its place (``image_unreadable``)."""

    def __init__(self, message: str, code: str = "image_unreadable") -> None:
        super().__init__(message)
        self.code = code


@contextmanager
def _walking(fmt: ImageFormat) -> Iterator[None]:
    """Around a walk of the upload's structure: what the walk refuses is the
    file's refusal, by the walk's code, and logged so it can be counted."""
    try:
        yield
    except _StructureRefused as exc:
        _log_refused_read(exc.code, fmt, exc)
        raise ImageRefused(
            exc.code,
            f"The bytes carry a {fmt.mime_type} signature but no "
            f"readable {fmt.pillow_name} structure: {exc}."
            if exc.code == "image_unreadable"
            else f"The image is refused: {exc}.",
        ) from exc


@dataclass(frozen=True)
class _TiffEntry:
    """One entry of a TIFF directory: its tag, type and value count, and its
    four-byte value field — the value itself when it fits there."""

    tag: int
    entry_type: int
    count: int
    value: bytes


def _tiff_header(block: bytes) -> tuple[str, int] | None:
    """The byte order (``">"`` or ``"<"``) and first-directory offset of the
    TIFF structure ``block`` — or None where Pillow's TIFF reader accepts no
    header and reads no entry: a header it does not know, or BigTIFF (whose
    directory offset Pillow reads from bytes past the eight-byte header it is
    handed, and raises)."""
    if len(block) < 8 or not block.startswith(_TIFF_PREFIXES) or block[2] == 0x2B:
        return None
    endian = ">" if block.startswith(b"MM") else "<"
    (offset,) = struct.unpack_from(endian + "L", block, 4)
    return endian, offset


def _tiff_directory(
    block: bytes, endian: str, offset: int, name: str, code: str, read: int
) -> tuple[list[_TiffEntry], int]:
    """The entries Pillow's TIFF reader reads from the directory at ``offset``
    of the TIFF structure ``block`` — none where the offset leaves no room for
    its count — and ``read`` plus the bytes of value it reads for them.

    Pillow reads every entry, and each value too big for its entry (over four
    bytes) with a read of its own, from wherever the entry points: N entries
    pointing at one S-byte value cost it N×S — 20 000 entries at 23 MB took
    it 65 s, 60 at 20 MB took 2.5 GB. So the walk reads the entries the way
    Pillow does — an entry of a type Pillow skips is skipped, a read that
    comes up short ends the directory — and raises :class:`_StructureRefused`
    past :data:`MAX_TIFF_ENTRIES` entries (``<code>_too_many_entries``), or
    once the values read add up to more than the block
    (``<code>_values_reread``): some byte is then read twice. Distinct values
    fit in the block side by side, so an honest structure never trips it, and
    what Pillow reads is at most the block's own size."""
    if offset + 2 > len(block):
        return [], read
    (declared,) = struct.unpack_from(endian + "H", block, offset)
    pos = offset + 2
    present = min(declared, (len(block) - pos) // 12)
    if present > MAX_TIFF_ENTRIES:
        raise _StructureRefused(
            f"its {name} directory holds more than {MAX_TIFF_ENTRIES} entries",
            f"{code}_too_many_entries",
        )
    entries: list[_TiffEntry] = []
    for _ in range(present):
        tag, entry_type, count, value = struct.unpack_from(endian + "HHL4s", block, pos)
        pos += 12
        unit = _TIFF_TYPE_SIZES.get(entry_type)
        if unit is None:
            continue
        size = count * unit
        if size > 4:
            (at,) = struct.unpack_from(endian + "L", value)
            read += max(0, min(size, len(block) - at))
            if read > len(block):
                raise _StructureRefused(
                    f"its {name} directories' values add up to more than the "
                    f"{len(block)}-byte block that holds them",
                    f"{code}_values_reread",
                )
            if at + size > len(block):
                break  # Pillow's read comes up short, and it reads no further
        entries.append(_TiffEntry(tag, entry_type, count, value))
    return entries, read


def _tiff_first_directory(
    block: bytes, name: str, code: str
) -> tuple[str, list[_TiffEntry]] | None:
    """The byte order and the entries of the first directory (IFD0) of the
    TIFF structure ``block`` — an EXIF block, or a JPEG's multi-picture index
    — as Pillow's TIFF reader reads them (:func:`_tiff_directory`, which
    raises past the caps); None where it reads no directory
    (:func:`_tiff_header`)."""
    header = _tiff_header(block)
    if header is None:
        return None
    endian, offset = header
    entries, _ = _tiff_directory(block, endian, offset, name, code, 0)
    return endian, entries


def _exif_tiff(raw: bytes) -> bytes:
    """The EXIF block ``raw`` past its ``Exif\\0\\0`` headers, as Pillow's
    EXIF reader strips them. Refused (``image_exif_header_repeated``) past
    :data:`MAX_EXIF_HEADERS` headers — Pillow strips each with a copy of the
    rest."""
    start = 0
    while raw.startswith(_EXIF_HEADER, start):
        start += len(_EXIF_HEADER)
        if start > MAX_EXIF_HEADERS * len(_EXIF_HEADER):
            raise _StructureRefused(
                f"its EXIF block repeats its header more than {MAX_EXIF_HEADERS} times",
                "image_exif_header_repeated",
            )
    return raw[start:]


def _exif_directory(raw: bytes) -> tuple[str, list[_TiffEntry]] | None:
    """The first directory of the EXIF block ``raw`` (:func:`_exif_tiff`,
    :func:`_tiff_first_directory`)."""
    return _tiff_first_directory(_exif_tiff(raw), "EXIF", "image_exif")


#: The entry types Pillow reads as an integer, and the format of one value of
#: each; a tag Pillow knows to hold one value takes the first of its values.
_INTEGER_TYPES: Final = {3: "H", 4: "L", 6: "b", 8: "h", 9: "l", 13: "L", 16: "Q"}

#: The directories an EXIF block points at that Pillow's EXIF re-encoder
#: loads besides IFD0: the Exif and GPS directories, and the Exif
#: directory's Interoperability directory.
_EXIF_SUB_DIRECTORY: Final = 0x8769
_GPS_SUB_DIRECTORY: Final = 0x8825
_INTEROP_SUB_DIRECTORY: Final = 0xA005


def _directory_pointer(
    block: bytes, endian: str, entries: list[_TiffEntry], tag: int
) -> int | None:
    """Where the last ``tag`` entry of ``entries`` points, read as Pillow
    reads it (the first value of an integer type) — None where Pillow reads
    no offset there (no such entry, or a type that is not an integer)."""
    pointer: int | None = None
    for entry in entries:
        if entry.tag != tag:
            continue
        unpack = _INTEGER_TYPES.get(entry.entry_type)
        pointer = None
        if unpack is None or entry.count < 1:
            continue
        width = _TIFF_TYPE_SIZES[entry.entry_type]
        if entry.count * width <= 4:
            pointer = struct.unpack_from(endian + unpack, entry.value)[0]
        else:  # the walk kept the entry, so its value lies inside the block
            (at,) = struct.unpack_from(endian + "L", entry.value)
            pointer = struct.unpack_from(endian + unpack, block, at)[0]
    return pointer if pointer is not None and pointer >= 0 else None


def _avif_exif_directories(raw: bytes) -> None:
    """Walk what Pillow's AVIF open reads of the EXIF block ``raw``.

    When libavif's ``irot``/``imir`` orientation differs from the block's
    own, Pillow's open RE-ENCODES the block: it loads IFD0 and the Exif, GPS
    and Interoperability directories, decodes every value, and joins each one
    onto the result by ``+=`` — a copy of all before it, per value. So the
    block is held to :data:`MAX_AVIF_EXIF_BYTES` (``image_avif_exif_too_large``)
    and every directory Pillow loads is walked (:func:`_tiff_directory`) with
    one read budget, the block's length, across them all."""
    if len(raw) > MAX_AVIF_EXIF_BYTES:
        raise _StructureRefused(
            f"its EXIF block is over {MAX_AVIF_EXIF_BYTES} bytes",
            "image_avif_exif_too_large",
        )
    block = _exif_tiff(raw)
    header = _tiff_header(block)
    if header is None:
        return
    endian, offset = header
    entries, read = _tiff_directory(block, endian, offset, "EXIF", "image_exif", 0)
    for tag in (_EXIF_SUB_DIRECTORY, _GPS_SUB_DIRECTORY):
        at = _directory_pointer(block, endian, entries, tag)
        if at is None:
            continue
        sub, read = _tiff_directory(block, endian, at, "EXIF", "image_exif", read)
        interop = (
            _directory_pointer(block, endian, sub, _INTEROP_SUB_DIRECTORY)
            if tag == _EXIF_SUB_DIRECTORY
            else None
        )
        if interop is not None:
            _, read = _tiff_directory(
                block, endian, interop, "EXIF", "image_exif", read
            )


#: The entry types an orientation is written as — SHORT, as the EXIF standard
#: writes it, or LONG — and the format of one value of each.
_ORIENTATION_TYPES: Final = {3: "H", 4: "L"}


def _orientation(raw_exif: object) -> int | None:
    """The EXIF orientation the file declares, from the metadata the header
    carried (``info["exif"]``) — never by loading the image, which a PNG's
    ``getexif()`` would do for an eXIf chunk after its pixel data, and never
    with Pillow's EXIF reader, which reads every entry's value: tag 0x0112 is
    read from its own entry's value field. As in Pillow, the last such entry
    wins and its first value is the orientation; unlike Pillow, a value held
    outside the entry (three or more SHORTs — never written for a single
    number) is not read, and is no orientation. Pillow's AVIF reader folds
    the ``irot``/``imir`` transforms into this same block. None when there is
    no EXIF, no directory Pillow would read, or a value that is not one of
    the eight orientations.

    Raises :class:`_StructureRefused` where :func:`_exif_directory` does."""
    if not isinstance(raw_exif, bytes) or not raw_exif:
        return None
    directory = _exif_directory(raw_exif)
    if directory is None:
        return None
    endian, entries = directory
    value: int | None = None
    for entry in entries:
        if entry.tag == _EXIF_ORIENTATION_TAG:
            unpack = _ORIENTATION_TYPES.get(entry.entry_type)
            inline = (
                unpack is not None
                and 1 <= entry.count
                and entry.count * _TIFF_TYPE_SIZES[entry.entry_type] <= 4
            )
            value = (
                struct.unpack_from(endian + unpack, entry.value)[0]
                if inline and unpack is not None
                else None
            )
    return value if value is not None and 1 <= value <= 8 else None


def _avif_exif(data: bytes) -> bytes:
    """The EXIF block of the AVIF ``data``, as libavif hands it to Pillow's
    AVIF reader — which loads it with Pillow's EXIF reader at open, and
    re-encodes every entry when an ``irot``/``imir`` transform changes the
    orientation. Read the same way Pillow's open reads it (libavif's parse of
    the container, which decodes no pixels), so it can be walked first. Empty
    where this Pillow has no AVIF support: its open then refuses the file."""
    if not AvifImagePlugin.SUPPORTED:
        return b""
    decoder = AvifImagePlugin._avif.AvifDecoder(
        data, AvifImagePlugin.DECODE_CODEC_CHOICE, 1
    )
    exif = decoder.get_info()[4]
    return exif if isinstance(exif, bytes) else b""


class _JpegHeaderSegments:
    """What Pillow's JPEG header parse does INSIDE the segments it parses in
    Python, held to the per-kind caps as :func:`_jpeg_header_end` meets each
    segment, and — at the SOS, where the parse ends — the EXIF and
    multi-picture index blocks Pillow's open then reads
    (:func:`_tiff_first_directory`). Every other segment Pillow takes with one
    bulk read."""

    def __init__(self) -> None:
        self.frame_headers = 0
        self.quantization_segments = 0
        self.photoshop_bytes = 0
        self.exif: list[bytes] = []
        self.mp_index: bytes | None = None

    def segment(
        self, marker: int, length: int, data: bytes, start: int, stop: int
    ) -> None:
        """The segment ``marker`` whose length field reads ``length`` and
        whose body Pillow reads as ``data[start:stop]``."""
        handler = JpegImagePlugin.MARKER[marker][2]
        if handler is JpegImagePlugin.SOF:
            self.frame_headers += 1
            if self.frame_headers > MAX_JPEG_FRAME_HEADERS:
                raise _StructureRefused(
                    f"a JPEG header holds more than {MAX_JPEG_FRAME_HEADERS} "
                    "frame headers before its image data",
                    "image_too_many_frame_headers",
                )
            components = data[start + 5] if stop - start > 5 else 0
            if components not in (1, 3, 4) or length != 8 + 3 * components:
                raise _StructureRefused(
                    "a JPEG frame header is not 8 + 3 bytes per component long, "
                    "for 1, 3 or 4 components",
                    "image_frame_header_invalid",
                )
        elif handler is JpegImagePlugin.DQT:
            self.quantization_segments += 1
            if self.quantization_segments > MAX_JPEG_QUANTIZATION_SEGMENTS:
                raise _StructureRefused(
                    "a JPEG header holds more than "
                    f"{MAX_JPEG_QUANTIZATION_SEGMENTS} quantization-table segments",
                    "image_too_many_quantization_segments",
                )
            if length > _MAX_DQT_LENGTH:
                raise _StructureRefused(
                    "a JPEG quantization-table segment holds more than four tables",
                    "image_quantization_segment_too_long",
                )
        elif handler is JpegImagePlugin.APP:
            if marker == 0xFFE1 and data.startswith(_EXIF_HEADER, start, stop):
                if len(self.exif) == MAX_JPEG_EXIF_SEGMENTS:
                    raise _StructureRefused(
                        f"a JPEG header holds more than {MAX_JPEG_EXIF_SEGMENTS} "
                        "EXIF segments",
                        "image_too_many_exif_segments",
                    )
                # Pillow keeps the first whole and joins each later one's body.
                skip = len(_EXIF_HEADER) if self.exif else 0
                self.exif.append(data[start + skip : stop])
            elif marker == 0xFFED and data.startswith(
                b"Photoshop 3.0\x00", start, stop
            ):
                self.photoshop_bytes += stop - start
                if self.photoshop_bytes > MAX_JPEG_PHOTOSHOP_BYTES:
                    raise _StructureRefused(
                        f"a JPEG header holds more than {MAX_JPEG_PHOTOSHOP_BYTES} "
                        "bytes of Photoshop resources",
                        "image_too_much_photoshop_metadata",
                    )
            elif marker == 0xFFE2 and data.startswith(b"MPF\x00", start, stop):
                self.mp_index = data[start + 4 : stop]  # Pillow keeps the last

    def finish(self) -> None:
        """At the SOS: the blocks Pillow's open reads with its TIFF reader."""
        if self.exif:
            _exif_directory(b"".join(self.exif))
        if self.mp_index is not None:
            _tiff_first_directory(
                self.mp_index, "multi-picture index", "image_mp_index"
            )


def _jpeg_header_end(data: bytes, start: int, end: int) -> int | None:
    """Where Pillow's header parse of the JPEG at ``data[start:end]`` ends:
    just past its first SOS segment — or None where Pillow raises before it
    reaches one (a cut-off file, a byte after 0xFF that names no marker).

    The walk reads the markers the way Pillow's parser does — fill, stuffed
    0xFF00 and stray bytes skipped, a segment skipped by its length, a
    marker without one (RSTn, SOI, EOI, JPGn) taken alone — and raises
    :class:`_StructureRefused` past :data:`MAX_JPEG_SEGMENTS` markers or
    :data:`MAX_JPEG_STRAY_BYTES` skipped bytes, before Pillow parses them.
    Skipped bytes are matched in one bounded regex call, not a Python step
    each. Each segment's body is held to its kind's caps
    (:class:`_JpegHeaderSegments`) — and, on reaching the SOS, the EXIF and
    multi-picture index blocks Pillow's open goes on to read — refused by the
    cap's own code."""
    pos = start + 2  # past SOI; the signature puts an 0xFF at start + 2
    segments = 0
    skipped = 0
    parsed = _JpegHeaderSegments()
    while True:
        window = min(end, pos + MAX_JPEG_STRAY_BYTES - skipped + 1)
        run = _JPEG_SKIPPED.match(data, pos, window)
        assert run is not None  # the pattern matches the empty string
        skipped += run.end() - pos
        pos = run.end()
        # The match stops inside the window short of a marker only where the
        # window cut a run of fill or a stuffed 0xFF00: then the run is longer.
        cut_mid_run = pos + 1 < end and data[pos + 1] in (0x00, 0xFF)
        if skipped > MAX_JPEG_STRAY_BYTES or cut_mid_run:
            raise _StructureRefused(
                f"a JPEG header holds more than {MAX_JPEG_STRAY_BYTES} fill or "
                "stray bytes",
                "image_too_many_stray_bytes",
            )
        if pos + 1 >= end:  # cut off: Pillow reads past the end and raises
            return None
        marker = 0xFF00 | data[pos + 1]
        if marker not in JpegImagePlugin.MARKER:
            return None  # Pillow: "no marker found"
        segments += 1
        if segments > MAX_JPEG_SEGMENTS:
            raise _StructureRefused(
                f"a JPEG header holds more than {MAX_JPEG_SEGMENTS} markers "
                "before its image data",
                "image_too_many_segments",
            )
        pos += 2
        if JpegImagePlugin.MARKER[marker][2] is not None:  # a segment: a length
            if pos + 2 > end:
                return None
            length = int.from_bytes(data[pos : pos + 2], "big")
            body = pos + 2
            pos = body + max(0, length - 2)
            if pos > end:
                return None
            parsed.segment(marker, length, data, body, pos)
        if marker == _JPEG_SOS:
            parsed.finish()
            return pos


def _png_walk_to_image_data(data: bytes) -> None:
    """Count a PNG's chunks up to its image data the way Pillow's header
    parse reads them — each skipped by its length — and raise
    :class:`_StructureRefused` past :data:`MAX_PNG_CHUNKS_BEFORE_IMAGE_DATA`,
    or past :data:`MAX_PNG_COMPRESSED_CHUNKS_BEFORE_IMAGE_DATA` chunks Pillow
    inflates. A cut-off or malformed chunk ends the walk; Pillow then refuses
    it."""
    pos, end = 8, len(data)
    chunks = compressed = 0
    while pos + 8 <= end and data[pos + 4 : pos + 8] not in _PNG_IMAGE_DATA:
        chunks += 1
        if chunks > MAX_PNG_CHUNKS_BEFORE_IMAGE_DATA:
            raise _StructureRefused(
                f"a PNG holds more than {MAX_PNG_CHUNKS_BEFORE_IMAGE_DATA} chunks "
                "before its image data",
                "image_too_many_chunks",
            )
        kind = data[pos + 4 : pos + 8]
        length = int.from_bytes(data[pos : pos + 4], "big")
        if kind in _PNG_COMPRESSED or (
            kind == b"iTXt" and _itxt_is_compressed(data, pos + 8, pos + 8 + length)
        ):
            compressed += 1
            if compressed > MAX_PNG_COMPRESSED_CHUNKS_BEFORE_IMAGE_DATA:
                raise _StructureRefused(
                    "a PNG holds more than "
                    f"{MAX_PNG_COMPRESSED_CHUNKS_BEFORE_IMAGE_DATA} compressed "
                    "chunks before its image data",
                    "image_too_many_compressed_chunks",
                )
        pos += 12 + length


def _itxt_is_compressed(data: bytes, start: int, stop: int) -> bool:
    """Whether the iTXt chunk body ``data[start:stop]`` sets its compression
    flag — the byte after its keyword's NUL, followed by the method byte
    Pillow also reads before it inflates."""
    keyword_end = data.find(b"\x00", start, stop)
    return 0 <= keyword_end and keyword_end + 2 < stop and data[keyword_end + 1] != 0


def _gif_structure(data: bytes, stop_after: int) -> tuple[int, tuple[int, int]]:
    """``(frames, canvas)`` of a GIF, from its block structure alone.

    ``frames`` counts the frames (image descriptors), stopping at
    ``stop_after``; ``canvas`` is what a decoder allocates for them: the
    logical screen grown to cover every frame's extent (left + width, top +
    height) — what Pillow does, and what a browser does, when a frame
    overhangs the screen.

    The walk reads the structure the way Pillow's does — an extension or a
    frame's image data is skipped sub-block by sub-block, and any byte that
    starts no block is skipped (found by search) — so on every file it
    accepts, Pillow sees the same frames. Where Pillow's walk would raise (a
    cut-off descriptor, a missing label or LZW code size, a graphic control
    block too short for the fields it reads) or would lose its place (an
    extension whose first sub-block is empty, after which Pillow reads the
    next block's first byte as a length), it raises
    :class:`_StructureRefused` instead. It is refused, by the cap's own
    code, past :data:`MAX_GIF_EXTENSIONS_PER_FRAME`,
    :data:`MAX_GIF_COMMENT_SUB_BLOCKS_PER_FRAME`, :data:`MAX_GIF_BLOCKS`,
    :data:`MAX_GIF_SUB_BLOCKS` or :data:`MAX_GIF_STRAY_BYTES_BEFORE_FIRST_FRAME`.
    Nothing is decoded.
    """
    if len(data) < 13:
        raise _StructureRefused("the GIF logical screen descriptor is cut off")
    width, height, flags = struct.unpack_from("<HHB", data, 6)
    end = len(data)
    pos = 13 + ((3 << ((flags & 7) + 1)) if flags & 0x80 else 0)

    sub_blocks = 0  # that held data, in all

    def past_sub_blocks(at: int, budget: int | None = None) -> tuple[int, int]:
        """Past the sub-blocks at ``at``, and how many held data; refused once
        that count passes ``budget``, or the walk's passes its cap."""
        nonlocal sub_blocks
        pieces = 0
        while at < end:
            size = data[at]
            at += 1 + size
            if size == 0:
                break
            pieces += 1
            if budget is not None and pieces > budget:
                raise _StructureRefused(
                    f"a GIF frame's comments hold more than "
                    f"{MAX_GIF_COMMENT_SUB_BLOCKS_PER_FRAME} sub-blocks",
                    "image_too_many_comment_sub_blocks",
                )
            if sub_blocks + pieces > MAX_GIF_SUB_BLOCKS:
                raise _StructureRefused(
                    f"a GIF holds more than {MAX_GIF_SUB_BLOCKS} data sub-blocks",
                    "image_too_many_sub_blocks",
                )
        sub_blocks += pieces
        return at, pieces

    frames = 0
    blocks = 0
    extensions = 0  # before the next frame
    comment_pieces = 0  # in this frame's comments
    stray = 0  # bytes before the first frame that start no block
    while frames < stop_after:
        found = _GIF_BLOCK_START.search(data, pos)
        at = end if found is None else found.start()
        if frames == 0:  # Pillow's walk to the first frame steps over each
            stray += at - pos
            if stray > MAX_GIF_STRAY_BYTES_BEFORE_FIRST_FRAME:
                raise _StructureRefused(
                    "a GIF holds more than "
                    f"{MAX_GIF_STRAY_BYTES_BEFORE_FIRST_FRAME} bytes before its "
                    "first frame that start no block",
                    "image_too_many_stray_bytes",
                )
        if found is None:
            break
        pos = at
        introducer = data[pos]
        pos += 1
        if introducer == 0x3B:  # trailer
            break
        blocks += 1
        if blocks > MAX_GIF_BLOCKS:
            raise _StructureRefused(
                f"a GIF holds more than {MAX_GIF_BLOCKS} blocks",
                "image_too_many_blocks",
            )
        if introducer == 0x21:  # an extension: its label, then its sub-blocks
            extensions += 1
            if extensions > MAX_GIF_EXTENSIONS_PER_FRAME:
                raise _StructureRefused(
                    f"a GIF frame is preceded by more than "
                    f"{MAX_GIF_EXTENSIONS_PER_FRAME} extension blocks",
                    "image_too_many_extensions",
                )
            if pos >= end:
                raise _StructureRefused("a GIF extension is cut off before its label")
            label = data[pos]
            pos += 1
            first = data[pos] if pos < end else None
            if label != 0xFE and first == 0:
                # Pillow's walk then reads the next block's first byte as a
                # sub-block length, and parses a different file from here on.
                raise _StructureRefused("a GIF extension has an empty first sub-block")
            if label == 0xF9 and first:  # graphic control: fields Pillow reads
                block = data[pos + 1 : pos + 1 + first]
                if len(block) < 3 or (block[0] & 1 and len(block) < 4):
                    raise _StructureRefused("a GIF graphic control block is too short")
            if label == 0xFF and frames == 0 and first:
                block = data[pos + 1 : pos + 1 + first]
                after = pos + 1 + first
                if (
                    block.startswith(b"NETSCAPE2.0")
                    and after < end
                    and data[after] == 0
                ):
                    # Pillow reads the next sub-block for the loop count; an
                    # empty one makes it lose its place, as above.
                    raise _StructureRefused("a GIF NETSCAPE2.0 block is cut short")
            if label == 0xFE:  # comment: Pillow joins its pieces, see the cap
                pos, pieces = past_sub_blocks(
                    pos, MAX_GIF_COMMENT_SUB_BLOCKS_PER_FRAME - comment_pieces
                )
                comment_pieces += pieces
            else:
                pos, _ = past_sub_blocks(pos)
        else:  # 0x2C: a frame's image descriptor
            if pos + 9 > end:
                raise _StructureRefused("a GIF image descriptor is cut off")
            left, top, frame_w, frame_h, frame_flags = struct.unpack_from(
                "<HHHHB", data, pos
            )
            width, height = max(width, left + frame_w), max(height, top + frame_h)
            frames += 1
            extensions = comment_pieces = 0
            pos += 9
            if frame_flags & 0x80:  # a local color table
                pos += 3 << ((frame_flags & 7) + 1)
            if pos >= end:
                raise _StructureRefused(
                    "a GIF frame is cut off before its LZW code size"
                )
            pos, _ = past_sub_blocks(pos + 1)  # the code size, then the image data
    return frames, (width, height)


def _picture_ranges(
    image: Image.Image, data_length: int, first_header_end: int | None
) -> list[tuple[int, int]]:
    """Each picture's byte range ``[offset, offset + size)`` in a
    multi-picture JPEG, refused unless they are disjoint and inside the file,
    and unless the first picture's header — which Pillow's open parsed from
    the start of the FILE, up to ``first_header_end`` (from
    :func:`_jpeg_header_end`) — ends inside the first range.

    The offsets are the ones Pillow's ``seek`` uses (its MP index entries'
    ``DataOffset`` from the MP header, the first picture's forced to 0) — so
    the ranges checked are the ones a decoder reads; the sizes are the
    entries' ``Size``. Overlapping ranges are how a file makes every picture
    re-parse the same bytes: fifty entries naming one padded picture cost a
    reader fifty parses of it. A first range that stops short of the first
    picture's header is how a file makes that open parse a LATER picture's
    bytes too, before its own parse of them.

    Pillow's own MPO writer (12.x) records ``Size`` right for two pictures
    only: for the third and later it subtracts the previous entry's SIZE
    where it means its offset, so a third picture's range overruns the file
    by the whole first picture — and a Pillow-written MPO of three or more
    pictures is refused here, as its index declares.
    """
    if not isinstance(image, MpoImagePlugin.MpoImageFile):
        raise TypeError(f"expected Pillow's MPO reader, got {type(image).__name__}")
    # Pillow keeps the absolute offsets private (and drops the MP header's
    # position once it has computed them); they are what its seek reads.
    offsets = getattr(image, "_MpoImageFile__mpoffsets")  # noqa: B009 — private
    if image.mpinfo is None:  # Pillow refuses such a file at open
        raise TypeError("Pillow's MPO reader holds no MP index")
    entries = image.mpinfo[0xB002]
    ranges = [
        (int(offset), int(offset) + int(entry["Size"]))
        for offset, entry in zip(offsets, entries, strict=True)
    ]
    for index, (start, end) in enumerate(ranges):
        if end <= start or end > data_length:
            raise ImageRefused(
                "image_picture_index_invalid",
                f"Picture {index + 1} of the multi-picture JPEG is declared at "
                f"bytes {start}-{end}, outside the {data_length}-byte file.",
            )
    if first_header_end is None or first_header_end > ranges[0][1]:
        raise ImageRefused(
            "image_picture_index_invalid",
            "Picture 1 of the multi-picture JPEG is declared at bytes "
            f"0-{ranges[0][1]}, but its header runs on past them.",
        )
    ordered = sorted(ranges)
    for (_, end), (start, _) in itertools.pairwise(ordered):
        if start < end:
            raise ImageRefused(
                "image_picture_index_invalid",
                "Two pictures of the multi-picture JPEG are declared over the "
                f"same bytes (one ends at {end}, the next starts at {start}).",
            )
    return ranges


def _largest_picture(
    data: bytes,
    fmt: ImageFormat,
    ranges: list[tuple[int, int]],
    width: int,
    height: int,
) -> tuple[int, int]:
    """The largest width and the largest height among a multi-picture JPEG's
    pictures, each read from that picture's own header, parsed from its own
    byte range alone (``ranges``, disjoint, from :func:`_picture_ranges`):
    a header that runs past its range is unreadable. Each header is walked
    (:func:`_jpeg_header_end`, with its caps) before Pillow parses it. It
    decodes nothing, and stops once the bound is already exceeded."""
    pictures = len(ranges)
    for start, end in ranges[1:]:
        with _walking(fmt):
            _jpeg_header_end(data, start, end)
        with _reading(fmt):
            with JpegImagePlugin.JpegImageFile(io.BytesIO(data[start:end])) as picture:
                picture_w, picture_h = picture.size
        width, height = max(width, picture_w), max(height, picture_h)
        if width * height * pictures > MAX_IMAGE_PIXELS:
            break
    return width, height


def sniff_image(data: bytes) -> SniffedImage:
    """Identify ``data`` as one accepted image, or raise :class:`ImageRefused`.

    Codes: ``image_empty``, ``image_unsupported_format`` (no accepted
    signature), ``image_unreadable`` (a signature its header does not bear
    out, or a file that cannot be opened and its frames walked),
    ``image_too_many_frames`` (above :data:`MAX_FRAMES`),
    ``image_too_many_pixels`` (above :data:`MAX_IMAGE_PIXELS`: canvas × frames);
    the pre-Pillow walks' caps: for a JPEG ``image_too_many_segments``,
    ``image_too_many_stray_bytes``, ``image_too_many_frame_headers``,
    ``image_frame_header_invalid``, ``image_too_many_quantization_segments``,
    ``image_quantization_segment_too_long``,
    ``image_too_much_photoshop_metadata``, ``image_too_many_exif_segments``,
    ``image_mp_index_too_many_entries`` and ``image_mp_index_values_reread``;
    for a PNG ``image_too_many_chunks`` and
    ``image_too_many_compressed_chunks``; for EXIF in any format
    ``image_exif_header_repeated``, ``image_exif_too_many_entries`` and
    ``image_exif_values_reread``, and for an AVIF's
    ``image_avif_exif_too_large``; for a GIF ``image_too_many_extensions``,
    ``image_too_many_comment_sub_blocks``, ``image_too_many_blocks``,
    ``image_too_many_sub_blocks`` and ``image_too_many_stray_bytes``; for a
    multi-picture JPEG
    ``image_too_many_pictures`` (above :data:`MAX_PICTURES`) and
    ``image_picture_index_invalid`` (pictures over the same bytes, past the
    file's end, or a first picture whose header runs past its range).
    Any other exception is a fault of this server, and propagates.

    Pillow's ``DecompressionBombWarning`` (a header above
    :data:`MAX_IMAGE_PIXELS`, below twice it) is not suppressed: a
    ``warnings.catch_warnings`` block is not thread-safe, and sniffs run
    concurrently in worker threads; a process-wide filter would silence it
    for every other Pillow reader in this server. The refusal below is the
    named answer; where warnings are raised as errors, the warning is that
    same refusal.
    """
    if not data:
        raise ImageRefused("image_empty", "The upload holds no bytes.")

    fmt = format_from_signature(data)
    if fmt is None:
        accepted = ", ".join(f.mime_type for f in ACCEPTED_FORMATS)
        raise ImageRefused(
            "image_unsupported_format",
            f"The bytes are not an accepted image format; accepted: {accepted}.",
        )

    # Before Pillow opens it: Pillow's header parse is the one the walks'
    # caps protect. For a GIF, not Pillow's ``n_frames`` either: it walks
    # EVERY frame before the cap could refuse; this walk stops one past it.
    # An AVIF's EXIF is read by Pillow's open with Pillow's EXIF reader, so it
    # is walked first; WebP's and PNG's are read by :func:`_orientation` alone.
    jpeg_header_end: int | None = None
    avif_exif = b""
    if fmt is AVIF:
        with _reading(fmt):
            avif_exif = _avif_exif(data)
    with _walking(fmt):
        if fmt is GIF:
            frames, canvas = _gif_structure(data, stop_after=MAX_FRAMES + 1)
        elif fmt is JPEG:
            jpeg_header_end = _jpeg_header_end(data, 0, len(data))
        elif fmt is PNG:
            _png_walk_to_image_data(data)
        elif avif_exif:
            _avif_exif_directories(avif_exif)

    with _reading(fmt):
        opened = Image.open(io.BytesIO(data), formats=[fmt.pillow_name])
    with opened as image:
        with _reading(fmt):
            raw_format = image.format or ""
            width, height = image.size
            raw_exif = image.info.get("exif")
        pillow_format = _PILLOW_FORMAT_ALIASES.get(raw_format, raw_format)
        if pillow_format != fmt.pillow_name:
            raise ImageRefused(
                "image_unreadable",
                f"The signature says {fmt.pillow_name} but the header reads as "
                f"{pillow_format}.",
            )

        if fmt is not GIF:
            with _reading(fmt):
                frames = int(getattr(image, "n_frames", 1))
            canvas = (width, height)
        if frames > MAX_FRAMES:
            raise ImageRefused(
                "image_too_many_frames",
                f"The image holds more than {MAX_FRAMES} frames; at most "
                f"{MAX_FRAMES} are accepted.",
            )
        if width <= 0 or height <= 0 or frames < 1:
            raise ImageRefused(
                "image_unreadable",
                f"The header declares a {width}×{height} image of {frames} frame(s).",
            )
        with _walking(fmt):
            orientation = _orientation(raw_exif)
        if raw_format == "MPO" and frames > 1:
            if frames > MAX_PICTURES:
                raise ImageRefused(
                    "image_too_many_pictures",
                    f"The multi-picture JPEG holds {frames} pictures; at most "
                    f"{MAX_PICTURES} are accepted.",
                )
            ranges = _picture_ranges(image, len(data), jpeg_header_end)
            canvas = _largest_picture(data, fmt, ranges, width, height)

    canvas_w, canvas_h = max(canvas[0], width), max(canvas[1], height)
    total = canvas_w * canvas_h * frames
    if total > MAX_IMAGE_PIXELS:
        shape = f"{width}×{height}"
        if (canvas_w, canvas_h) != (width, height):
            shape += f", decoded onto a {canvas_w}×{canvas_h} canvas,"
        raise ImageRefused(
            "image_too_many_pixels",
            f"The image is {shape} × {frames} frame(s) ({total} pixels to "
            f"decode); at most {MAX_IMAGE_PIXELS} are accepted.",
        )
    if orientation in _QUARTER_TURN_ORIENTATIONS:
        width, height = height, width
    return SniffedImage(
        format=fmt,
        width=width,
        height=height,
        orientation=orientation,
        frames=frames,
    )
