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
orientation comes from the metadata the header carries. So a sniff costs about
the same on a 1×1 image as on a 9000×9000 one, the frame count is capped
before anything walks past the cap, and the pixel bound below is checked
before any consumer decodes anything.

What Pillow — or a codec beneath it — raises while it READS the file is the
file's fault: a refusal (``image_unreadable``), a 422, never a 500, and logged
so it can be counted. What this module's own code raises is not: only the
failure a helper documents (a GIF structure the walk refuses, an EXIF block
Pillow cannot parse) is caught, narrowly, and ``MemoryError`` /
``RecursionError`` always propagate — a server fault stays a 5xx.

Accepted: PNG, JPEG, GIF, WebP and AVIF — the raster formats the image
pipeline produces (generated candidates, AVIF/WebP derivatives, captures) and
an operator's own reference images arrive in. SVG is refused on purpose: it is
active content (script, external references) rather than an image a judge or
an embedding model can read, and no consumer of this store uploads one.
"""

from __future__ import annotations

import io
import re
import struct
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Final

import structlog
from PIL import Image

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

#: What Pillow raises for the malformed files it anticipates. Anything else it
#: raises while reading is still the file's refusal, but it is logged with its
#: traceback, so a defect in Pillow (or a codec) can be counted.
_ANTICIPATED_READ_ERRORS: Final = (SyntaxError, OSError, ValueError, EOFError)

#: A GIF block starts with one of these bytes (extension, image descriptor,
#: trailer). Pillow skips any other byte between blocks; so does the walk —
#: by search, not byte by byte.
_GIF_BLOCK_START: Final = re.compile(rb"[!,;]")

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
    except Image.DecompressionBombError as exc:
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


def _orientation(raw_exif: object, fmt: ImageFormat) -> int | None:
    """The EXIF orientation the file declares, from the metadata the header
    carried (``info["exif"]``) — never by loading the image, which a PNG's
    ``getexif()`` would do for an eXIf chunk after its pixel data. Pillow's
    AVIF reader folds the ``irot``/``imir`` transforms into this same value.
    None when there is no EXIF, it does not parse, or the value is not one of
    the eight orientations."""
    if not isinstance(raw_exif, bytes) or not raw_exif:
        return None
    exif = Image.Exif()
    try:
        exif.load(raw_exif)
        value = exif.get(_EXIF_ORIENTATION_TAG)
    except (struct.error, *_ANTICIPATED_READ_ERRORS) as exc:
        # Pillow's EXIF parser raises SyntaxError for a block that is not a
        # TIFF structure and struct.error for a value cut short (it handles
        # the rest itself). No orientation is known — not a refusal: the
        # image itself read fine.
        _log_refused_read("image_exif_unreadable", fmt, exc)
        return None
    return value if isinstance(value, int) and 1 <= value <= 8 else None


class _GifStructureRefused(ValueError):
    """A GIF block structure the walk will not count: cut off, or malformed
    where Pillow's own walk would raise or lose its place."""


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
    :class:`_GifStructureRefused` instead. Nothing is decoded.
    """
    if len(data) < 13:
        raise _GifStructureRefused("the GIF logical screen descriptor is cut off")
    width, height, flags = struct.unpack_from("<HHB", data, 6)
    end = len(data)
    pos = 13 + ((3 << ((flags & 7) + 1)) if flags & 0x80 else 0)

    def past_sub_blocks(at: int) -> int:
        while at < end:
            size = data[at]
            at += 1 + size
            if size == 0:
                break
        return at

    frames = 0
    while frames < stop_after:
        found = _GIF_BLOCK_START.search(data, pos)
        if found is None:
            break
        pos = found.start()
        introducer = data[pos]
        pos += 1
        if introducer == 0x3B:  # trailer
            break
        if introducer == 0x21:  # an extension: its label, then its sub-blocks
            if pos >= end:
                raise _GifStructureRefused(
                    "a GIF extension is cut off before its label"
                )
            label = data[pos]
            pos += 1
            first = data[pos] if pos < end else None
            if label != 0xFE and first == 0:
                # Pillow's walk then reads the next block's first byte as a
                # sub-block length, and parses a different file from here on.
                raise _GifStructureRefused(
                    "a GIF extension has an empty first sub-block"
                )
            if label == 0xF9 and first:  # graphic control: fields Pillow reads
                block = data[pos + 1 : pos + 1 + first]
                if len(block) < 3 or (block[0] & 1 and len(block) < 4):
                    raise _GifStructureRefused(
                        "a GIF graphic control block is too short"
                    )
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
                    raise _GifStructureRefused("a GIF NETSCAPE2.0 block is cut short")
            pos = past_sub_blocks(pos)
        else:  # 0x2C: a frame's image descriptor
            if pos + 9 > end:
                raise _GifStructureRefused("a GIF image descriptor is cut off")
            left, top, frame_w, frame_h, frame_flags = struct.unpack_from(
                "<HHHHB", data, pos
            )
            width, height = max(width, left + frame_w), max(height, top + frame_h)
            frames += 1
            pos += 9
            if frame_flags & 0x80:  # a local color table
                pos += 3 << ((frame_flags & 7) + 1)
            if pos >= end:
                raise _GifStructureRefused(
                    "a GIF frame is cut off before its LZW code size"
                )
            pos = past_sub_blocks(pos + 1)  # the code size, then the image data
    return frames, (width, height)


def _largest_picture(
    image: Image.Image, fmt: ImageFormat, width: int, height: int, pictures: int
) -> tuple[int, int]:
    """The largest width and the largest height among a multi-picture JPEG's
    pictures, each read from that picture's own header (Pillow's ``seek`` on
    an MPO parses the picture's JPEG markers; it decodes nothing). Stops once
    the bound is already exceeded."""
    for index in range(1, pictures):
        with _reading(fmt):
            image.seek(index)
            picture_w, picture_h = image.size
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
    ``image_too_many_pixels`` (above :data:`MAX_IMAGE_PIXELS`: canvas × frames).
    Any other exception is a fault of this server, and propagates.
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

    with warnings.catch_warnings():
        # The pixel bound is decided below, from the header, with a named
        # refusal; Pillow's own warning would only duplicate it.
        warnings.simplefilter("ignore", Image.DecompressionBombWarning)
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

            if raw_format == "GIF":
                # Not Pillow's ``n_frames``: it walks EVERY frame before the
                # cap could refuse. This walk stops one frame past the cap.
                try:
                    frames, canvas = _gif_structure(data, stop_after=MAX_FRAMES + 1)
                except _GifStructureRefused as exc:
                    _log_refused_read("image_unreadable", fmt, exc)
                    raise ImageRefused(
                        "image_unreadable",
                        f"The bytes carry a {fmt.mime_type} signature but no "
                        f"readable {fmt.pillow_name} structure: {exc}.",
                    ) from exc
            else:
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
                    f"The header declares a {width}×{height} image of {frames} "
                    "frame(s).",
                )
            # Read before any seek below: it is the first picture's.
            orientation = _orientation(raw_exif, fmt)
            if raw_format == "MPO" and frames > 1:
                canvas = _largest_picture(image, fmt, width, height, frames)

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
