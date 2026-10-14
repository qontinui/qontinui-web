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
from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError, features

from app.models.image_asset import IMAGE_MIME_TYPES
from app.services.image_sniff import (
    ACCEPTED_FORMATS,
    AVIF,
    GIF,
    JPEG,
    MAX_FRAMES,
    MAX_GIF_BLOCKS,
    MAX_GIF_COMMENT_SUB_BLOCKS_PER_FRAME,
    MAX_GIF_EXTENSIONS_PER_FRAME,
    MAX_IMAGE_PIXELS,
    MAX_PICTURES,
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


# ── orientation: the stored size is the DISPLAYED size ──────────────────


def with_orientation(fmt: str, size: tuple[int, int], orientation: int) -> bytes:
    """A real ``size`` image encoded as ``fmt`` whose EXIF declares
    ``orientation`` (tag 0x0112)."""
    exif = Image.Exif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buf, format=fmt, exif=exif.tobytes())
    return buf.getvalue()


@pytest.mark.parametrize("fmt", ["JPEG", "WEBP", "AVIF"])
def test_a_quarter_turn_orientation_exchanges_width_and_height(fmt: str) -> None:
    """The review's case: a 40×20 JPEG tagged orientation 6 is shown 20×40
    by every browser, so 20×40 is what the store records."""
    data = with_orientation(fmt, (40, 20), 6)
    with Image.open(io.BytesIO(data)) as probe:
        shown = ImageOps.exif_transpose(probe).size
    sniffed = sniff_image(data)
    assert (sniffed.width, sniffed.height) == shown == (20, 40)
    assert sniffed.orientation == 6


@pytest.mark.parametrize(
    ("orientation", "size"),
    [
        (1, (40, 20)),
        (2, (40, 20)),
        (3, (40, 20)),
        (4, (40, 20)),
        (5, (20, 40)),
        (6, (20, 40)),
        (7, (20, 40)),
        (8, (20, 40)),
    ],
)
def test_every_orientation_maps_to_its_displayed_size(
    orientation: int, size: tuple[int, int]
) -> None:
    sniffed = sniff_image(with_orientation("JPEG", (40, 20), orientation))
    assert (sniffed.width, sniffed.height) == size
    assert sniffed.orientation == orientation


def test_no_orientation_and_an_impossible_one_are_both_none() -> None:
    plain = sniff_image(encode("JPEG", (40, 20)))
    assert plain.orientation is None and (plain.width, plain.height) == (40, 20)
    bogus = sniff_image(with_orientation("JPEG", (40, 20), 9))
    assert bogus.orientation is None and (bogus.width, bogus.height) == (40, 20)


def test_reading_the_orientation_decodes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Orientation comes from the metadata the header carried: no format's
    pixel decoder (``ImageFile.load``) runs, for a still image or a PNG whose
    ``getexif()`` would otherwise load the image to find a late eXIf chunk."""

    # Encoding the fixtures loads pixels; only the SNIFF must not.
    fixtures = {
        fmt: with_orientation(fmt, (40, 20), 6)
        for fmt in ("JPEG", "PNG", "WEBP", "AVIF")
    }

    def refuse_decode(self: Image.Image) -> None:
        raise AssertionError("the sniffer decoded pixels")

    monkeypatch.setattr(ImageFile.ImageFile, "load", refuse_decode)
    monkeypatch.setattr(Image.Image, "load", refuse_decode)
    for fmt, data in fixtures.items():
        assert sniff_image(data).orientation == 6, fmt


# ── the pixel bound counts every frame ──────────────────────────────────


def _animated_webp(frames: int, canvas: tuple[int, int]) -> bytes:
    """An animated WebP of ``frames`` 1×1 frames whose VP8X header DECLARES
    ``canvas`` — the review's construction: tiny on disk, huge to decode."""
    images = [
        Image.new("RGB", (1, 1), ((i * 7) % 256, (i * 13) % 256, (i * 29) % 256))
        for i in range(frames)
    ]
    buf = io.BytesIO()
    images[0].save(
        buf,
        format="WEBP",
        save_all=True,
        append_images=images[1:],
        lossless=True,
        duration=10,
    )
    data = bytearray(buf.getvalue())
    at = data.find(b"VP8X") + 8
    w, h = canvas
    data[at + 4 : at + 7] = (w - 1).to_bytes(3, "little")
    data[at + 7 : at + 10] = (h - 1).to_bytes(3, "little")
    return bytes(data)


def test_many_frames_each_under_the_bound_are_refused_in_total() -> None:
    """The round-1 review's construction, within the frame cap: a few dozen
    KB declaring MAX_FRAMES frames of 9,000 × 9,000 — 81 billion pixels to
    decode, every single frame under the bound. (Its own 3,000 frames now
    meet the frame cap first: test_frames_past_the_cap_are_refused_by_name.)"""
    data = _animated_webp(MAX_FRAMES, (9000, 9000))
    assert len(data) < 200_000
    assert 9000 * 9000 <= MAX_IMAGE_PIXELS  # each frame alone would pass
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_too_many_pixels"
    assert f"{MAX_FRAMES} frame" in excinfo.value.message


def test_the_total_bound_is_frames_times_canvas() -> None:
    """Two frames of 6,000² (72 M) pass; two of 7,000² (98 M) do not, though
    one 7,000² frame (49 M) is well under the bound."""
    ok = sniff_image(_animated_webp(2, (6000, 6000)))
    assert (ok.width, ok.height, ok.frames) == (6000, 6000, 2)
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(_animated_webp(2, (7000, 7000)))
    assert excinfo.value.code == "image_too_many_pixels"


def test_an_animation_within_the_bound_is_accepted() -> None:
    frames = [Image.new("RGB", (64, 48), (i * 40, 0, 0)) for i in range(5)]
    for fmt in ("GIF", "WEBP", "PNG"):
        buf = io.BytesIO()
        frames[0].save(
            buf, format=fmt, save_all=True, append_images=frames[1:], duration=50
        )
        sniffed = sniff_image(buf.getvalue())
        assert (sniffed.width, sniffed.height, sniffed.frames) == (64, 48, 5), fmt


# ── a GIF is bounded by its largest frame extent, not its screen ────────


def _lzw_one_pixel() -> bytes:
    """A frame's image data: LZW code size 2, then one sub-block holding the
    codes clear (4), 0, end (5) — one pixel, whatever size the frame claims."""
    codes = 4 | (0 << 3) | (5 << 6)
    return bytes([2, 2, codes & 0xFF, codes >> 8, 0])


#: The bytes before ``gif_with_frames``' first block: the 13-byte header and
#: logical screen descriptor, then its 2-color global color table.
_GIF_HEADER = 13 + 6


def gif_with_frames(
    screen: tuple[int, int], frames: list[tuple[int, int, int, int]]
) -> bytes:
    """A GIF whose logical screen is ``screen`` and whose frames are
    ``(left, top, width, height)`` — each frame's data one pixel, so a frame
    can CLAIM any extent in a few bytes."""
    out = bytearray(b"GIF89a" + struct.pack("<HHBBB", *screen, 0x80, 0, 0))
    out += b"\x00\x00\x00\xff\xff\xff"  # a 2-color global color table
    for left, top, width, height in frames:
        out += b"\x21\xf9\x04\x00\x0a\x00\x00\x00"  # graphic control extension
        out += b"\x2c" + struct.pack("<HHHHB", left, top, width, height, 0)
        out += _lzw_one_pixel()
    return bytes(out + b"\x3b")


def test_a_gif_frame_larger_than_the_screen_counts_at_its_extent() -> None:
    """The review's case: a 10×10 screen whose second frame is 12 000 ×
    12 000. Pillow grows its canvas to that frame (and so does a browser),
    so 2 × 144 M pixels are decoded; the screen alone would pass."""
    data = gif_with_frames((10, 10), [(0, 0, 1, 1), (0, 0, 12000, 12000)])
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_too_many_pixels"
    assert "12000×12000 canvas" in excinfo.value.message
    assert "2 frame" in excinfo.value.message


def test_a_gif_frame_offset_past_the_screen_counts_too() -> None:
    """The extent is left + width and top + height: a 10×10 frame placed at
    (9 990, 9 990) makes a 10 000 × 10 000 canvas."""
    data = gif_with_frames((10, 10), [(0, 0, 1, 1), (9990, 9990, 10, 10)])
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_too_many_pixels"
    assert "10000×10000 canvas" in excinfo.value.message


def test_an_overhang_within_the_bound_is_accepted_at_its_screen_size() -> None:
    """2 frames on a 6 000² canvas (72 M) pass, and the record keeps the size
    Pillow opens the file at — the screen — not the canvas."""
    data = gif_with_frames((10, 10), [(0, 0, 1, 1), (5990, 5990, 10, 10)])
    sniffed = sniff_image(data)
    assert (sniffed.width, sniffed.height, sniffed.frames) == (10, 10, 2)


def test_the_gif_canvas_is_the_one_pillow_grows_to(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The walk agrees with the decoder it bounds: Pillow, decoding every
    frame, counts the frames the walk counted and ends on the canvas the walk
    computed. (Each frame here holds one pixel of data for a larger claimed
    extent, so Pillow is told to decode what is there.)"""
    from app.services.image_sniff import _gif_structure

    monkeypatch.setattr(ImageFile, "LOAD_TRUNCATED_IMAGES", True)
    data = gif_with_frames(
        (10, 10), [(0, 0, 1, 1), (30, 2, 5, 5), (1, 40, 4, 3), (0, 0, 2, 2)]
    )
    with Image.open(io.BytesIO(data)) as image:
        counted = image.n_frames
        for index in range(counted):
            image.seek(index)
            image.load()
        decoded = image.size
    assert _gif_structure(data, stop_after=MAX_FRAMES + 1) == (counted, decoded)
    assert (counted, decoded) == (4, (35, 43))


# ── a multi-picture JPEG is bounded by its largest picture ──────────────


def mpo_claiming(second: tuple[int, int]) -> bytes:
    """A two-picture MPO whose first picture is 8×8 and whose second
    picture's header CLAIMS ``second`` (its SOF0 rewritten in place; the
    picture's data stays 8×8's)."""
    pictures = [Image.new("RGB", (8, 8), (i * 90, 30, 60)) for i in range(2)]
    buf = io.BytesIO()
    pictures[0].save(buf, format="MPO", save_all=True, append_images=pictures[1:])
    data = bytearray(buf.getvalue())
    first_sof = data.find(b"\xff\xc0")
    second_sof = data.find(b"\xff\xc0", first_sof + 2)
    assert first_sof > 0 and second_sof > first_sof, "expected one SOF0 per picture"
    width, height = second
    data[second_sof + 5 : second_sof + 9] = struct.pack(">HH", height, width)
    return bytes(data)


def test_a_multi_picture_jpeg_counts_its_largest_picture() -> None:
    """A browser shows the first picture, but a reader walking the frames
    decodes every picture at its own size: an 8×8 picture in front of a
    9 500 × 9 500 one (90 M pixels) is refused."""
    with Image.open(io.BytesIO(mpo_claiming((9500, 9500)))) as probe:
        probe.seek(1)
        assert probe.size == (9500, 9500)  # the claim reaches the decoder
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(mpo_claiming((9500, 9500)))
    assert excinfo.value.code == "image_too_many_pixels"
    assert "9500×9500 canvas" in excinfo.value.message
    accepted = sniff_image(mpo_claiming((6000, 6000)))  # 2 × 36 M = 72 M
    assert (accepted.format, accepted.width, accepted.height) == (JPEG, 8, 8)
    assert accepted.frames == 2


def test_walking_frames_for_the_bound_decodes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixtures = {
        "gif": gif_with_frames((10, 10), [(0, 0, 1, 1), (5990, 5990, 10, 10)]),
        "mpo": mpo_claiming((6000, 6000)),
    }

    def refuse_decode(self: Image.Image) -> None:
        raise AssertionError("the sniffer decoded pixels")

    monkeypatch.setattr(ImageFile.ImageFile, "load", refuse_decode)
    monkeypatch.setattr(Image.Image, "load", refuse_decode)
    for name, data in fixtures.items():
        assert sniff_image(data).frames == 2, name


# ── a malformed file is unreadable, whatever Pillow raises ──────────────


def _gif_animation(frames: int = 4) -> bytes:
    images = [
        Image.new("RGB", (16, 12), ((i * 40) % 256, 90, 160)) for i in range(frames)
    ]
    buf = io.BytesIO()
    images[0].save(
        buf, format="GIF", save_all=True, append_images=images[1:], duration=50, loop=0
    )
    return buf.getvalue()


def _second_frame_descriptor(data: bytes) -> int:
    """The offset of the second frame's image descriptor (its 0x2C byte),
    found by walking the blocks of a well-formed GIF."""
    flags = data[10]
    pos = 13 + ((3 << ((flags & 7) + 1)) if flags & 0x80 else 0)
    seen = 0
    while True:
        introducer = data[pos]
        if introducer == 0x2C:
            seen += 1
            if seen == 2:
                return pos
            frame_flags = data[pos + 9]
            pos += 10 + ((3 << ((frame_flags & 7) + 1)) if frame_flags & 0x80 else 0)
            pos += 1  # LZW code size
        else:  # an extension: introducer, label
            pos += 2
        while data[pos]:  # sub-blocks up to the terminator
            pos += 1 + data[pos]
        pos += 1


def test_a_gif_cut_inside_a_later_frame_descriptor_is_unreadable() -> None:
    """Pillow's own frame walk raises struct.error on this file — the round-2
    review measured that escape as a 500. It is a malformed upload: 422."""
    data = _gif_animation()
    cut = data[: _second_frame_descriptor(data) + 4]
    with Image.open(io.BytesIO(cut)) as image, pytest.raises(struct.error):
        image.n_frames  # noqa: B018 — the property walks the frames
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(cut)
    assert excinfo.value.code == "image_unreadable"


def test_a_gif_cut_before_a_later_frames_code_size_is_unreadable() -> None:
    """Here Pillow's walk raises IndexError — the other GIF escape."""
    data = _gif_animation()
    descriptor = _second_frame_descriptor(data)
    frame_flags = data[descriptor + 9]
    palette = (3 << ((frame_flags & 7) + 1)) if frame_flags & 0x80 else 0
    cut = data[: descriptor + 10 + palette]
    with Image.open(io.BytesIO(cut)) as image, pytest.raises(IndexError):
        image.n_frames  # noqa: B018 — the property walks the frames
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(cut)
    assert excinfo.value.code == "image_unreadable"


def test_an_avif_libavif_will_not_open_is_unreadable() -> None:
    """An AVIF whose ``pixi`` box gives its channels different bit depths:
    libavif answers "Not implemented", which Pillow raises as RuntimeError —
    the AVIF escape the round-2 review measured."""
    data = bytearray(encode("AVIF", (16, 12)))
    at = data.find(b"pixi")
    assert at > 0, "this encoder wrote no pixi box"
    # size(4) 'pixi'(4) | version+flags(4) | channel count(1) | depth per channel
    channels = data[at + 8]
    assert channels >= 2
    data[at + 10] = data[at + 9] + 2
    with pytest.raises(RuntimeError):
        Image.open(io.BytesIO(bytes(data)), formats=["AVIF"])
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(bytes(data))
    assert excinfo.value.code == "image_unreadable"


def _damaged_corpus() -> dict[str, list[bytes]]:
    """A small deterministic corpus in the review's construction: animations
    in every multi-frame format, cut at many lengths and with a few bytes
    overwritten (seeded)."""
    import random

    def animated(fmt: str, **params: object) -> bytes:
        frames = [
            Image.new("RGB", (16, 12), ((i * 40) % 256, 90, 160)) for i in range(4)
        ]
        buf = io.BytesIO()
        frames[0].save(
            buf, format=fmt, save_all=True, append_images=frames[1:], **params
        )
        return buf.getvalue()

    seeds = {
        "GIF": animated("GIF", duration=50, loop=0),
        "APNG": animated("PNG", duration=50),
        "WEBP": animated("WEBP", lossless=True, duration=50),
        "MPO": animated("MPO"),
        # test_this_pillow_build_reads_avif holds the build to AVIF support.
        "AVIF": animated("AVIF", duration=50),
    }
    rng = random.Random(1234)
    corpus: dict[str, list[bytes]] = {}
    for name, data in seeds.items():
        cases = [data[:cut] for cut in range(1, len(data), 3)]
        for _ in range(250):
            damaged = bytearray(data)
            for _ in range(rng.randint(1, 4)):
                damaged[rng.randrange(6, len(damaged))] = rng.randrange(256)
            cases.append(bytes(damaged))
        corpus[name] = cases
    return corpus


def test_a_damaged_file_is_refused_never_raised() -> None:
    """Every case either sniffs or is refused by name — and the corpus is
    not vacuous: Pillow itself raises outside the exceptions it documents
    (SyntaxError / OSError / ValueError / EOFError) on some of the GIF cases,
    exactly the inputs that escaped as 500s before."""
    anticipated = (SyntaxError, OSError, ValueError, EOFError)
    escapes: list[str] = []
    pillow_raises_unanticipated = 0
    for name, cases in _damaged_corpus().items():
        for data in cases:
            try:
                sniff_image(data)
            except ImageRefused:
                pass
            except Exception as exc:  # noqa: BLE001 — the assertion's subject
                escapes.append(f"{name}: {type(exc).__name__}: {exc}")
            if name == "GIF":
                try:
                    with Image.open(io.BytesIO(data), formats=["GIF"]) as image:
                        image.n_frames  # noqa: B018
                except anticipated:
                    pass
                except Exception:  # noqa: BLE001
                    pillow_raises_unanticipated += 1
    assert escapes == []
    assert pillow_raises_unanticipated > 0


# ── at most MAX_FRAMES frames, refused by name, before anything walks them ──


def _one_pixel_frames(count: int) -> bytes:
    return gif_with_frames((1, 1), [(0, 0, 1, 1)] * count)


def _apng_declaring(frames: int) -> bytes:
    """A two-frame APNG whose acTL chunk DECLARES ``frames`` frames (its
    CRC recomputed, so Pillow reads the count as written)."""
    images = [Image.new("RGB", (4, 4), (i * 90, 0, 0)) for i in range(2)]
    buf = io.BytesIO()
    images[0].save(buf, format="PNG", save_all=True, append_images=images[1:])
    data = bytearray(buf.getvalue())
    at = data.find(b"acTL")
    assert at > 0, "expected an animated PNG"
    data[at + 4 : at + 8] = struct.pack(">I", frames)
    crc = zlib.crc32(bytes(data[at : at + 12])) & 0xFFFFFFFF
    data[at + 12 : at + 16] = struct.pack(">I", crc)
    return bytes(data)


def test_frames_up_to_the_cap_are_accepted() -> None:
    assert sniff_image(_one_pixel_frames(MAX_FRAMES)).frames == MAX_FRAMES
    assert sniff_image(_animated_webp(MAX_FRAMES, (4, 4))).frames == MAX_FRAMES


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(_one_pixel_frames(MAX_FRAMES + 1), id="gif"),
        pytest.param(_animated_webp(3000, (16, 16)), id="webp-3000"),
        pytest.param(_apng_declaring(MAX_FRAMES + 1), id="apng-declared"),
    ],
)
def test_frames_past_the_cap_are_refused_by_name(data: bytes) -> None:
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_too_many_frames"
    assert f"at most {MAX_FRAMES}" in excinfo.value.message


def test_a_gif_past_the_cap_is_refused_before_anything_walks_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The review's measurement: 25 MiB of 1×1 frames (~1.7 M) were all
    counted — 2.1 s of CPU — before anything could refuse them. The walk that
    counts a GIF's frames stops one past the cap, and Pillow's own walk of
    every frame (``n_frames``) is never started."""
    from PIL import GifImagePlugin

    from app.services.image_sniff import _gif_structure

    def walk_everything(self: object) -> int:
        raise AssertionError("Pillow walked every frame")

    data = _one_pixel_frames(200_000)
    assert _gif_structure(data, stop_after=MAX_FRAMES + 1)[0] == MAX_FRAMES + 1
    monkeypatch.setattr(
        GifImagePlugin.GifImageFile, "n_frames", property(walk_everything)
    )
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_too_many_frames"


def test_bytes_between_gif_blocks_are_skipped_as_pillow_skips_them() -> None:
    """Pillow skips any byte that starts no block; the walk does too — and
    finds the next block by search, so a megabyte of such bytes costs no
    per-byte Python. It counts what Pillow counts."""
    from app.services.image_sniff import _gif_structure

    frames = gif_with_frames((10, 10), [(0, 0, 1, 1), (2, 3, 4, 4)])
    second = frames.index(b"\x21\xf9", 30)  # the second frame's control block
    data = frames[:second] + b"\x00" * 1_000_000 + frames[second:]
    with Image.open(io.BytesIO(data)) as image:
        counted = image.n_frames
    assert _gif_structure(data, stop_after=MAX_FRAMES + 1) == (counted, (10, 10))
    assert sniff_image(data).frames == counted == 2


#: Where a damaged block goes: in place of the trailer, or between the global
#: color table and the first frame (Pillow reads a NETSCAPE2.0 loop count only
#: there — before frame 0).
_AT_THE_END, _BEFORE_THE_FIRST_FRAME = "end", "start"


def _netscape_hiding_a_frame() -> bytes:
    """A NETSCAPE2.0 block whose loop-count sub-block is empty, then a
    comment. Pillow, having read the empty sub-block as the loop count,
    skips the block's sub-blocks from the NEXT byte — the comment's ``!``,
    read as a length of 33 — and lands inside the comment's 64-byte text, on
    a 9000×9000 frame descriptor the comment holds. A walk that read the
    comment as a comment would never see that frame."""
    hidden = b"\x2c" + struct.pack("<HHHHB", 0, 0, 9000, 9000, 0) + _lzw_one_pixel()
    text = bytearray(64)
    text[32 : 32 + len(hidden)] = hidden  # text[31] = 0 ends Pillow's skip
    return b"\x21\xff\x0bNETSCAPE2.0\x00" + b"\x21\xfe\x40" + bytes(text) + b"\x00"


@pytest.mark.parametrize(
    ("damage", "at", "why"),
    [
        (
            b"\x21\xf9\x00\x3b",
            _AT_THE_END,
            "an extension whose first sub-block is empty",
        ),
        (
            b"\x21\xf9\x02\x00\x00\x00\x3b",
            _AT_THE_END,
            "a graphic control block too short",
        ),
        (
            b"\x21\xf9\x03\x01\x00\x00\x00\x3b",
            _AT_THE_END,
            "a graphic control block whose transparency flag is set but which "
            "is too short to hold the transparent index",
        ),
        (b"\x21", _AT_THE_END, "an extension cut off before its label"),
        (
            b"\x21\xff\x0bNETSCAPE2.0\x00",
            _BEFORE_THE_FIRST_FRAME,
            "a NETSCAPE2.0 block whose loop-count sub-block is empty",
        ),
        (
            _netscape_hiding_a_frame(),
            _BEFORE_THE_FIRST_FRAME,
            "an empty NETSCAPE2.0 loop count that hides a frame from the walk",
        ),
    ],
    ids=[
        "empty-first-sub-block",
        "short-control-block",
        "short-transparent-control-block",
        "cut-before-label",
        "empty-netscape-loop-count",
        "netscape-hiding-a-frame",
    ],
)
def test_a_gif_structure_pillow_would_lose_its_place_in_is_unreadable(
    damage: bytes, at: str, why: str
) -> None:
    """Where Pillow's own walk would raise, or read the next block's first
    byte as a length and parse a different file from there, the walk refuses
    instead — so a frame cannot be hidden from the bound by a structure the
    two read differently."""
    frames = gif_with_frames((10, 10), [(0, 0, 1, 1), (0, 0, 2, 2)])
    if at == _AT_THE_END:
        data = frames[:-1] + damage  # in place of the trailer
    else:
        data = frames[:_GIF_HEADER] + damage + frames[_GIF_HEADER:]
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_unreadable", why


def test_the_damaged_blocks_are_ones_pillow_misreads() -> None:
    """The two Pillow-parity refusals the walk adds beyond a cut-off file:
    Pillow raises on a short transparent graphic control block when it
    reaches that frame, and loses its place after an empty NETSCAPE2.0
    loop-count sub-block — reading the next block's ``!`` as a length, it
    cannot identify the file at all."""
    frames = gif_with_frames((10, 10), [(0, 0, 1, 1), (0, 0, 2, 2)])
    control = b"\x21\xf9\x04\x00\x0a\x00\x00\x00"
    second = frames.index(control, _GIF_HEADER + 1)
    short_control = (
        frames[:second]
        + b"\x21\xf9\x03\x01\x0a\x00\x00"
        + frames[second + len(control) :]
    )
    with Image.open(io.BytesIO(short_control)) as image:
        with pytest.raises(IndexError):
            image.seek(1)
    netscape = (
        frames[:_GIF_HEADER] + b"\x21\xff\x0bNETSCAPE2.0\x00" + frames[_GIF_HEADER:]
    )
    with pytest.raises(UnidentifiedImageError):  # it lost its place
        Image.open(io.BytesIO(netscape))
    hiding = frames[:_GIF_HEADER] + _netscape_hiding_a_frame() + frames[_GIF_HEADER:]
    with Image.open(io.BytesIO(hiding)) as image:  # a frame no walk would see
        assert (image.size, image.n_frames) == ((9000, 9000), 3)


# ── a GIF's walk is bounded by its blocks, not only its frames ──────────

#: The upload cap the review measured at (the route's MAX_IMAGE_BYTES).
_UPLOAD_CAP = 25 * 1024 * 1024


def _gif_with_blocks_before_each_frame(frames: int, blocks: bytes) -> bytes:
    """``frames`` 1×1 frames, each preceded by ``blocks``."""
    one = gif_with_frames((1, 1), [(0, 0, 1, 1)])
    frame = one[_GIF_HEADER:-1]  # its control block, descriptor and data
    return one[:_GIF_HEADER] + (blocks + frame) * frames + b"\x3b"


def _refused(data: bytes) -> str:
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    return excinfo.value.code


_EMPTY_COMMENT = b"\x21\xfe\x00"


def test_extensions_up_to_the_per_frame_cap_are_accepted() -> None:
    """Each frame of ``gif_with_frames`` already carries one graphic control
    block, so 63 more extensions make exactly the cap."""
    cap = MAX_GIF_EXTENSIONS_PER_FRAME
    data = _gif_with_blocks_before_each_frame(2, _EMPTY_COMMENT * (cap - 1))
    assert sniff_image(data).frames == 2
    tail = gif_with_frames((1, 1), [(0, 0, 1, 1)])[:-1] + _EMPTY_COMMENT * cap
    assert sniff_image(tail + b"\x3b").frames == 1  # before the trailer too


@pytest.mark.parametrize("where", ["before a frame", "before the trailer"])
def test_one_extension_past_the_per_frame_cap_is_refused(where: str) -> None:
    cap = MAX_GIF_EXTENSIONS_PER_FRAME
    if where == "before a frame":
        data = _gif_with_blocks_before_each_frame(2, _EMPTY_COMMENT * cap)
    else:
        one = gif_with_frames((1, 1), [(0, 0, 1, 1)])
        data = one[:-1] + _EMPTY_COMMENT * (cap + 1) + b"\x3b"
    assert _refused(data) == "image_too_many_extensions"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        pytest.param(
            _EMPTY_COMMENT * (_UPLOAD_CAP // 3),
            "image_too_many_extensions",
            id="empty-comments",
        ),
        pytest.param(
            b"\x21\xfe\x00\x00" * (_UPLOAD_CAP // 4),
            "image_too_many_extensions",
            id="comment-and-stray-byte-cycles",
        ),
        pytest.param(
            b"\x21\xfe" + b"\x01a" * (_UPLOAD_CAP // 2),
            "image_too_many_comment_sub_blocks",
            id="one-comment-of-one-byte-sub-blocks",
        ),
    ],
)
@pytest.mark.parametrize("where", ["after the first frame", "before it"])
def test_the_reviews_block_floods_are_refused_before_pillow_reads_them(
    monkeypatch: pytest.MonkeyPatch, body: bytes, code: str, where: str
) -> None:
    """The review's measurements: 25 MiB of empty comment blocks took the
    walk 2.6 s and was accepted (comment / stray-byte cycles 1.9 s). Placed
    BEFORE the first frame they are worse: Pillow's own walk to that frame
    joins the comments by concatenation — quadratic — and did not finish in
    ten minutes. Each is now refused by a cap, and Pillow never opens it."""

    def pillow_opened(*args: object, **kwargs: object) -> object:
        raise AssertionError("Pillow opened the file before the walk refused it")

    one = gif_with_frames((1, 1), [(0, 0, 1, 1)])
    if where == "before it":
        data = (one[:_GIF_HEADER] + body)[: _UPLOAD_CAP - len(one)] + one[_GIF_HEADER:]
    else:
        data = (one[:-1] + body)[: _UPLOAD_CAP - 1] + b"\x3b"
    monkeypatch.setattr(Image, "open", pillow_opened)
    assert _refused(data) == code


def test_comment_sub_blocks_up_to_the_per_frame_cap_are_accepted() -> None:
    """The cap counts every comment sub-block that holds data in one frame —
    across that frame's comments, since Pillow joins them all."""
    cap = MAX_GIF_COMMENT_SUB_BLOCKS_PER_FRAME
    half = b"\x21\xfe" + b"\x01a" * (cap // 2) + b"\x00"
    assert sniff_image(_gif_with_blocks_before_each_frame(3, half * 2)).frames == 3
    over = b"\x21\xfe" + b"\x01a" * (cap // 2 + 1) + b"\x00"
    data = _gif_with_blocks_before_each_frame(1, half + over)
    assert _refused(data) == "image_too_many_comment_sub_blocks"


def test_blocks_up_to_the_total_cap_are_accepted_and_one_more_is_refused() -> None:
    """MAX_FRAMES frames of eight blocks each (six comments, the graphic
    control block, the descriptor) is exactly MAX_GIF_BLOCKS; one comment
    more, before the trailer, is past it — with every frame and every
    frame's extensions inside their own caps."""
    per_frame = MAX_GIF_BLOCKS // MAX_FRAMES - 2
    assert per_frame + 1 <= MAX_GIF_EXTENSIONS_PER_FRAME
    data = _gif_with_blocks_before_each_frame(MAX_FRAMES, _EMPTY_COMMENT * per_frame)
    assert sniff_image(data).frames == MAX_FRAMES
    assert _refused(data[:-1] + _EMPTY_COMMENT + b"\x3b") == "image_too_many_blocks"


# ── a multi-picture JPEG parses each picture once, from its own bytes ───


def _jpeg(size: tuple[int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (40, 80, 120)).save(buf, format="JPEG")
    return buf.getvalue()


#: The MP header's position in a file ``_mpo`` builds: SOI (2), the APP2
#: marker and length (4), ``MPF\0`` (4). DataOffset counts from here.
_MP_HEADER_AT = 10


def _mpo(
    pictures: list[bytes],
    entries: list[tuple[int, int]] | None = None,
) -> bytes:
    """A CIPA multi-picture JPEG of ``pictures``, the first carrying the MP
    index. Each entry is ``(Size, DataOffset)``; by default the true ones —
    the first picture's own length at 0, the others where they follow it —
    and as many entries as there are pictures. Given ``entries``, the index
    holds exactly those, whatever bytes they name."""
    count = len(entries) if entries is not None else len(pictures)
    first_rest = pictures[0][2:]  # past its SOI

    def app2(table: list[tuple[int, int]]) -> bytes:
        index_at = 50  # header 8 + count 2 + three 12-byte tags + next-IFD 4
        tiff = b"II*\x00" + struct.pack("<L", 8) + struct.pack("<H", 3)
        tiff += struct.pack("<HHL4s", 0xB000, 7, 4, b"0100")
        tiff += struct.pack("<HHLL", 0xB001, 4, 1, count)
        tiff += struct.pack("<HHLL", 0xB002, 7, 16 * count, index_at)
        tiff += struct.pack("<L", 0)
        assert len(tiff) == index_at
        rows = b"".join(
            struct.pack("<LLLHH", 0x030000 if i == 0 else 0x020001, size, at, 0, 0)
            for i, (size, at) in enumerate(table)
        )
        payload = b"MPF\x00" + tiff + rows
        return b"\xff\xe2" + struct.pack(">H", len(payload) + 2) + payload

    first_length = 2 + len(app2([(0, 0)] * count)) + len(first_rest)
    if entries is None:
        entries = [(first_length, 0)]
        at = first_length
        for picture in pictures[1:]:
            entries.append((len(picture), at - _MP_HEADER_AT))
            at += len(picture)
    return b"\xff\xd8" + app2(entries) + first_rest + b"".join(pictures[1:])


def _true_entries(pictures: list[bytes]) -> list[tuple[int, int]]:
    data = _mpo(pictures)
    with Image.open(io.BytesIO(data)) as image:
        return [(e["Size"], e["DataOffset"]) for e in image.mpinfo[0xB002]]


def test_a_camera_layout_of_up_to_max_pictures_is_accepted() -> None:
    """Disjoint pictures inside the file, each read at its own size: the
    canvas is the largest of them."""
    pictures = [_jpeg((8, 6)), _jpeg((40, 30)), _jpeg((16, 64))]
    data = _mpo(pictures)
    with Image.open(io.BytesIO(data)) as probe:
        assert probe.format == "MPO" and probe.n_frames == 3
    accepted = sniff_image(data)
    assert (accepted.format, accepted.width, accepted.height) == (JPEG, 8, 6)
    assert accepted.frames == 3
    many = _mpo([_jpeg((4, 4))] * MAX_PICTURES)
    assert sniff_image(many).frames == MAX_PICTURES


def test_more_than_max_pictures_is_refused_by_name() -> None:
    data = _mpo([_jpeg((4, 4))] * (MAX_PICTURES + 1))
    assert _refused(data) == "image_too_many_pictures"


def _padded_picture(padding: int) -> bytes:
    """A 1×1 JPEG behind ``padding`` bytes of empty comment markers — the
    review's construction: cheap to store, slow to parse."""
    picture = _jpeg((1, 1))
    return b"\xff\xd8" + b"\xff\xfe\x00\x02" * (padding // 4) + picture[2:]


def test_pictures_sharing_one_padded_picture_are_refused_unparsed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The review's case: every MP index entry names one padded picture, so a
    reader seeking each picture re-parses it — 50 pictures over 4 MB took
    20.8 s and were accepted. Overlapping ranges are refused before any
    picture past the first is parsed: the JPEG parser runs exactly once (the
    open), and no seek happens."""
    from PIL import JpegImagePlugin, MpoImagePlugin

    padded = _padded_picture(4_000_000)
    first = _jpeg((1, 1))
    honest = _true_entries([first, padded])
    shared = [honest[0]] + [honest[1]] * (MAX_PICTURES - 1)
    data = _mpo([first, padded], shared)

    parses = 0
    real_open = JpegImagePlugin.JpegImageFile._open

    def counting_open(self: JpegImagePlugin.JpegImageFile) -> None:
        nonlocal parses
        parses += 1
        real_open(self)

    def seek(self: object, frame: int) -> None:
        raise AssertionError("the sniffer seeked a picture")

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "_open", counting_open)
    monkeypatch.setattr(MpoImagePlugin.MpoImageFile, "seek", seek)
    assert _refused(data) == "image_picture_index_invalid"
    assert parses == 1


def test_the_honest_padded_layout_parses_each_picture_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same padded picture named once: accepted, and parsed once — the
    open parses the first picture, one more parse reads the second."""
    from PIL import JpegImagePlugin

    data = _mpo([_jpeg((1, 1)), _padded_picture(400_000)])
    parses = 0
    real_open = JpegImagePlugin.JpegImageFile._open

    def counting_open(self: JpegImagePlugin.JpegImageFile) -> None:
        nonlocal parses
        parses += 1
        real_open(self)

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "_open", counting_open)
    assert sniff_image(data).frames == 2
    assert parses == 2


def _pictures_and_entries() -> tuple[list[bytes], list[tuple[int, int]]]:
    pictures = [_jpeg((8, 6)), _jpeg((12, 10)), _jpeg((20, 4))]
    return pictures, _true_entries(pictures)


def test_a_picture_inside_the_first_one_is_refused() -> None:
    pictures, entries = _pictures_and_entries()
    entries[2] = (entries[2][0], 0)  # at the MP header — inside picture 1
    assert _refused(_mpo(pictures, entries)) == "image_picture_index_invalid"


def test_two_overlapping_later_pictures_are_refused() -> None:
    pictures, entries = _pictures_and_entries()
    entries[2] = (entries[2][0], entries[1][1] + entries[1][0] - 1)
    assert _refused(_mpo(pictures, entries)) == "image_picture_index_invalid"


def test_a_picture_past_the_end_of_the_file_is_refused() -> None:
    pictures, entries = _pictures_and_entries()
    entries[2] = (entries[2][0] + 1, entries[2][1])
    assert _refused(_mpo(pictures, entries)) == "image_picture_index_invalid"


def test_a_picture_whose_header_runs_past_its_range_is_unreadable() -> None:
    """Each picture's header is parsed from its own range alone: a range too
    short to hold the header is a malformed index, not a reason to read on
    into the bytes after it."""
    pictures, entries = _pictures_and_entries()
    entries[1] = (4, entries[1][1])
    assert _refused(_mpo(pictures, entries)) == "image_unreadable"


# ── Pillow's bomb warning is left alone ─────────────────────────────────


def test_the_sniffer_leaves_the_warning_filters_alone() -> None:
    """``warnings.catch_warnings`` is not thread-safe, and sniffs run
    concurrently: the sniffer no longer installs a filter. Pillow's warning
    for a header above the bound reaches the caller's filters, and the sniff
    still refuses by name."""
    import warnings

    data = png_header_only(10_000, 10_000)
    before = list(warnings.filters)
    with pytest.warns(Image.DecompressionBombWarning):
        assert _refused(data) == "image_too_many_pixels"
    assert warnings.filters == before


def test_the_bomb_warning_raised_as_an_error_is_the_same_refusal() -> None:
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        assert _refused(png_header_only(10_000, 10_000)) == "image_too_many_pixels"


# ── a fault of this server is not a refusal ─────────────────────────────


class _RecordingLogger:
    """Stands in for the module logger (a structlog reconfigure would not
    reach a logger cached on first use)."""

    def __init__(self) -> None:
        self.warnings: list[dict[str, object]] = []

    def warning(self, event: str, **fields: object) -> None:
        self.warnings.append({"event": event, **fields})


@pytest.mark.parametrize(
    ("helper", "data"),
    [
        pytest.param(
            "_gif_structure", gif_with_frames((4, 4), [(0, 0, 1, 1)]), id="gif"
        ),
        pytest.param("_orientation", encode("PNG"), id="orientation"),
        pytest.param(
            "_largest_picture", mpo_claiming((16, 16)), id="multi-picture-jpeg"
        ),
    ],
)
def test_a_defect_in_a_helper_is_a_fault_not_a_refusal(
    monkeypatch: pytest.MonkeyPatch, helper: str, data: bytes
) -> None:
    """The review's case: a NameError in a helper turned every valid upload
    into a 422 image_unreadable, logged nowhere. It now propagates — the
    route answers 5xx and the server's handler logs it."""
    from app.services import image_sniff

    def defect(*args: object, **kwargs: object) -> object:
        raise NameError("name 'undefined' is not defined")

    sniff_image(data)  # valid as it stands
    monkeypatch.setattr(image_sniff, helper, defect)
    with pytest.raises(NameError):
        sniff_image(data)


@pytest.mark.parametrize("error", [MemoryError, RecursionError])
def test_memory_and_recursion_errors_from_pillow_are_not_refusals(
    monkeypatch: pytest.MonkeyPatch, error: type[BaseException]
) -> None:
    data = encode("PNG")

    def exhausted(*args: object, **kwargs: object) -> object:
        raise error()

    monkeypatch.setattr(Image, "open", exhausted)
    with pytest.raises(error):
        sniff_image(data)


def test_a_corrupt_file_is_still_refused_and_its_cause_logged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every swallowed exception is counted: a warning naming its type and
    message — with its traceback when Pillow did not anticipate it
    (RuntimeError from libavif), without one when it did."""
    from app.services import image_sniff

    recorder = _RecordingLogger()
    monkeypatch.setattr(image_sniff, "logger", recorder)

    avif = bytearray(encode("AVIF", (16, 12)))
    at = avif.find(b"pixi")
    avif[at + 10] = avif[at + 9] + 2  # channels of different bit depths
    gif = _gif_animation()
    cut_gif = gif[: _second_frame_descriptor(gif) + 4]
    for data in (bytes(avif), cut_gif, b"\x89PNG\r\n\x1a\n" + b"\x00" * 16):
        with pytest.raises(ImageRefused) as excinfo:
            sniff_image(data)
        assert excinfo.value.code == "image_unreadable"

    logged = {w["error_type"]: w for w in recorder.warnings}
    assert [w["event"] for w in recorder.warnings] == ["image_unreadable"] * 3
    assert isinstance(logged["RuntimeError"]["exc_info"], RuntimeError)
    assert logged["RuntimeError"]["format"] == "AVIF"
    assert "Not implemented" in str(logged["RuntimeError"]["error"])
    assert set(logged) == {
        "RuntimeError",
        "_GifStructureRefused",
        "UnidentifiedImageError",
    }
    assert logged["_GifStructureRefused"]["exc_info"] is None
    assert logged["UnidentifiedImageError"]["exc_info"] is None
