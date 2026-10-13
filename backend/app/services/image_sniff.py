"""Identify an uploaded image from its bytes alone.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``: the
content-addressed image store never trusts a client's filename, extension or
``Content-Type``. The format comes from the bytes' signature (an allow-list —
anything else is refused, never coerced to a default), and Pillow, restricted
to that one format's parser, must then read the same format's header and its
dimensions. A file whose signature claims a format its header does not bear
out is refused as unreadable.

Nothing here DECODES pixels: ``Image.open`` reads the header, the frame count
comes from the container (a GIF's is counted by walking its frame headers,
which skips the image data), and the EXIF orientation from the metadata the
header carries. So a sniff costs about the same on a 1×1 image as on a
9000×9000 one, and the pixel bound below is checked before any consumer
decodes anything.

Accepted: PNG, JPEG, GIF, WebP and AVIF — the raster formats the image
pipeline produces (generated candidates, AVIF/WebP derivatives, captures) and
an operator's own reference images arrive in. SVG is refused on purpose: it is
active content (script, external references) rather than an image a judge or
an embedding model can read, and no consumer of this store uploads one.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass
from typing import Final

from PIL import Image, UnidentifiedImageError


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

#: The largest TOTAL pixel count accepted: width × height summed over every
#: frame, because a reader that decodes an animated image decodes each frame.
#: The value is Pillow's default decompression-bomb threshold
#: (``Image.MAX_IMAGE_PIXELS``), so decoding every frame of an accepted image
#: produces at most this many pixels, and no single frame of it can trip a
#: default Pillow's DecompressionBombWarning. Neither the byte cap nor a
#: per-frame bound is enough: a few hundred bytes of PNG can declare a
#: 10 000 × 10 000 canvas, and a 150 KB animated WebP can declare 3 000 frames
#: of 9 000 × 9 000 — 243 billion pixels, each frame under a per-frame bound.
MAX_IMAGE_PIXELS: Final = 89_478_485

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


def _orientation(image: Image.Image) -> int | None:
    """The EXIF orientation the file declares, read from the metadata the
    header carried (``info["exif"]``) — never by loading the image, which a
    PNG's ``getexif()`` would do for an eXIf chunk after its pixel data.
    Pillow's AVIF reader folds the ``irot``/``imir`` transforms into this same
    value. None when there is no EXIF, it does not parse, or the value is not
    one of the eight orientations."""
    raw = image.info.get("exif")
    if not raw:
        return None
    try:
        exif = Image.Exif()
        exif.load(raw)
        value = exif.get(_EXIF_ORIENTATION_TAG)
    except Exception:
        # Malformed EXIF: no orientation is known. That is not a refusal —
        # the image itself read fine.
        return None
    return value if isinstance(value, int) and 1 <= value <= 8 else None


def sniff_image(data: bytes) -> SniffedImage:
    """Identify ``data`` as one accepted image, or raise :class:`ImageRefused`.

    Codes: ``image_empty``, ``image_unsupported_format`` (no accepted
    signature), ``image_unreadable`` (a signature its header does not bear
    out), ``image_too_many_pixels`` (above :data:`MAX_IMAGE_PIXELS` across
    all frames).
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

    try:
        with warnings.catch_warnings():
            # The pixel bound is decided below, from the header, with a named
            # refusal; Pillow's own warning would only duplicate it.
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=[fmt.pillow_name]) as image:
                pillow_format = _PILLOW_FORMAT_ALIASES.get(
                    image.format or "", image.format
                )
                width, height = image.size
                frames = int(getattr(image, "n_frames", 1))
                orientation = _orientation(image)
    except Image.DecompressionBombError as exc:
        raise ImageRefused(
            "image_too_many_pixels",
            f"The image declares more than {MAX_IMAGE_PIXELS} pixels.",
        ) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError) as exc:
        # Pillow raises SyntaxError for some malformed headers (a PNG chunk
        # it cannot parse), OSError / ValueError for truncated ones, and
        # EOFError for a frame table that ends early.
        raise ImageRefused(
            "image_unreadable",
            f"The bytes carry a {fmt.mime_type} signature but no readable "
            f"{fmt.pillow_name} header.",
        ) from exc

    if pillow_format != fmt.pillow_name:
        raise ImageRefused(
            "image_unreadable",
            f"The signature says {fmt.pillow_name} but the header reads as "
            f"{pillow_format}.",
        )
    if width <= 0 or height <= 0 or frames < 1:
        raise ImageRefused(
            "image_unreadable",
            f"The header declares a {width}×{height} image of {frames} frame(s).",
        )
    total = width * height * frames
    if total > MAX_IMAGE_PIXELS:
        raise ImageRefused(
            "image_too_many_pixels",
            f"The image is {width}×{height} × {frames} frame(s) ({total} pixels "
            f"to decode); at most {MAX_IMAGE_PIXELS} are accepted.",
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
