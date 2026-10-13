"""``app.services.image_sniff`` — an image is identified by its bytes alone.

Plan ``2026-10-13-image-generation-and-visual-judgment`` Phase 13. DB-free.
Every fixture image is made here with Pillow, so each test states exactly the
bytes it hands the sniffer.
"""

from __future__ import annotations

import io
import struct
import zlib

import pytest
from PIL import Image, features

from app.models.image_asset import IMAGE_MIME_TYPES
from app.services.image_sniff import (
    ACCEPTED_FORMATS,
    AVIF,
    GIF,
    JPEG,
    MAX_IMAGE_PIXELS,
    PNG,
    WEBP,
    ImageFormat,
    ImageRefused,
    format_from_signature,
    sniff_image,
)


def encode(fmt: str, size: tuple[int, int] = (7, 5), **params: object) -> bytes:
    """A real image of ``size`` encoded as Pillow format ``fmt``."""
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 40, 90)).save(buf, format=fmt, **params)
    return buf.getvalue()


def png_header_only(width: int, height: int) -> bytes:
    """A PNG whose IHDR declares ``width``×``height`` and whose IDAT holds
    almost nothing — a few hundred bytes that CLAIM a huge canvas."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        crc = zlib.crc32(kind + body) & 0xFFFFFFFF
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b"\x00"))
        + chunk(b"IEND", b"")
    )


@pytest.mark.parametrize(
    ("pillow_format", "expected", "params"),
    [
        ("PNG", PNG, {}),
        ("JPEG", JPEG, {}),
        ("GIF", GIF, {}),
        ("WEBP", WEBP, {}),
        ("AVIF", AVIF, {}),
    ],
    ids=["png", "jpeg", "gif", "webp", "avif"],
)
def test_each_accepted_format_is_identified_from_its_bytes(
    pillow_format: str, expected: ImageFormat, params: dict[str, object]
) -> None:
    sniffed = sniff_image(encode(pillow_format, (7, 5), **params))
    assert sniffed.format == expected
    assert sniffed.mime_type == expected.mime_type
    assert sniffed.extension == expected.extension
    assert (sniffed.width, sniffed.height) == (7, 5)


def test_this_pillow_build_reads_avif() -> None:
    """AVIF is an accepted format, so a Pillow without the AVIF codec would
    refuse every AVIF derivative as unreadable. Fail loudly here instead."""
    assert features.check("avif"), "this Pillow build cannot read AVIF"


def test_a_multi_picture_camera_jpeg_is_a_jpeg() -> None:
    """Pillow reports a CIPA MPO file as ``MPO``; its first picture is a JPEG."""
    buf = io.BytesIO()
    first = Image.new("RGB", (6, 4), (10, 20, 30))
    first.save(buf, format="MPO", save_all=True, append_images=[first.copy()])
    data = buf.getvalue()
    with Image.open(io.BytesIO(data)) as probe:
        assert probe.format == "MPO"  # the premise this test exists for
    sniffed = sniff_image(data)
    assert sniffed.format == JPEG
    assert (sniffed.width, sniffed.height) == (6, 4)


@pytest.mark.parametrize(
    "data",
    [
        b"<!doctype html><html><body>not an image</body></html>",
        b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        b"%PDF-1.7\n",
        b"BM" + b"\x00" * 64,  # a BMP: a real image format, not an accepted one
        b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic",  # HEIC, not AVIF
    ],
    ids=["html", "svg", "pdf", "bmp", "heic"],
)
def test_anything_else_is_refused_never_coerced(data: bytes) -> None:
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_unsupported_format"
    for mime in IMAGE_MIME_TYPES:
        assert mime in excinfo.value.message


def test_no_bytes_is_refused() -> None:
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(b"")
    assert excinfo.value.code == "image_empty"


@pytest.mark.parametrize(
    "data",
    [
        b"\x89PNG\r\n\x1a\n" + b"garbage, no IHDR",
        b"\xff\xd8\xff" + b"\x00" * 16,
        b"GIF89a",
        b"RIFF\x10\x00\x00\x00WEBPVP8 ",
    ],
    ids=["png", "jpeg", "gif", "webp"],
)
def test_a_signature_with_no_readable_header_is_unreadable(data: bytes) -> None:
    assert format_from_signature(data) is not None  # the signature matched…
    with pytest.raises(ImageRefused) as excinfo:  # …the header did not
        sniff_image(data)
    assert excinfo.value.code == "image_unreadable"


def test_a_truncated_image_keeps_its_header_and_is_accepted() -> None:
    """Nothing is decoded: a header-complete file reads as what it declares.
    (The bound that matters for a decode is the pixel count, below.)"""
    whole = encode("PNG", (9, 9))
    sniffed = sniff_image(whole[: len(whole) - 20])
    assert (sniffed.width, sniffed.height) == (9, 9)


def test_a_huge_canvas_in_a_tiny_file_is_refused() -> None:
    """A few hundred bytes that declare 10 000 × 10 000 pixels — above the
    bound, below Pillow's own hard error — are refused by the bound."""
    data = png_header_only(10_000, 10_000)
    assert len(data) < 1024
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_too_many_pixels"


def test_a_canvas_past_pillows_hard_limit_is_refused_by_name() -> None:
    """Above 2 × MAX_IMAGE_PIXELS Pillow raises DecompressionBombError at
    open; it is reported as the same named refusal, not as unreadable."""
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(png_header_only(30_000, 30_000))
    assert excinfo.value.code == "image_too_many_pixels"


def test_the_pixel_bound_is_inclusive() -> None:
    width = 9_473
    height = MAX_IMAGE_PIXELS // width
    assert width * height <= MAX_IMAGE_PIXELS
    sniffed = sniff_image(png_header_only(width, height))
    assert (sniffed.width, sniffed.height) == (width, height)
    with pytest.raises(ImageRefused):
        sniff_image(png_header_only(width, height + 1))


def test_avif_is_recognised_by_a_compatible_brand() -> None:
    """``mif1`` major brand with ``avif`` among the compatible brands is AVIF;
    the same box listing only ``heic`` is not."""
    avif_box = b"\x00\x00\x00\x1cftypmif1\x00\x00\x00\x00mif1avifmiaf"
    heic_box = b"\x00\x00\x00\x1cftypmif1\x00\x00\x00\x00mif1heicmiaf"
    assert format_from_signature(avif_box) == AVIF
    assert format_from_signature(heic_box) is None
    # A box size larger than the data, or too small to hold the brands, is
    # not trusted.
    assert format_from_signature(b"\x00\x00\x01\x00ftypavif\x00\x00\x00\x00") is None
    assert format_from_signature(b"\x00\x00\x00\x08ftypavif\x00\x00\x00\x00") is None


def test_the_accepted_formats_are_the_mime_types_the_table_allows() -> None:
    """The sniffer is the only writer of ``web.image_assets.mime_type``; the
    model's tuple (and the ``ck_image_assets_mime_type`` CHECK the migration
    test holds equal to it) must list exactly what the sniffer can produce."""
    assert tuple(fmt.mime_type for fmt in ACCEPTED_FORMATS) == IMAGE_MIME_TYPES
    assert len({fmt.extension for fmt in ACCEPTED_FORMATS}) == len(ACCEPTED_FORMATS)
