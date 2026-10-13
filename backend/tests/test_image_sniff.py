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
from PIL import Image, ImageFile, ImageOps, features

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


def test_thousands_of_frames_each_under_the_bound_are_refused_in_total() -> None:
    """The review's case: 150 KB declaring 3,000 frames of 9,000 × 9,000 —
    243 billion pixels to decode, every single frame under the bound."""
    data = _animated_webp(3000, (9000, 9000))
    assert len(data) < 200_000
    assert 9000 * 9000 <= MAX_IMAGE_PIXELS  # each frame alone would pass
    with pytest.raises(ImageRefused) as excinfo:
        sniff_image(data)
    assert excinfo.value.code == "image_too_many_pixels"
    assert "3000 frame" in excinfo.value.message


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
    frame, ends on the canvas the walk computed. (Each frame here holds one
    pixel of data for a larger claimed extent, so Pillow is told to decode
    what is there.)"""
    from app.services.image_sniff import _gif_canvas

    monkeypatch.setattr(ImageFile, "LOAD_TRUNCATED_IMAGES", True)
    data = gif_with_frames(
        (10, 10), [(0, 0, 1, 1), (30, 2, 5, 5), (1, 40, 4, 3), (0, 0, 2, 2)]
    )
    with Image.open(io.BytesIO(data)) as image:
        for index in range(image.n_frames):
            image.seek(index)
            image.load()
        decoded = image.size
    assert _gif_canvas(data) == decoded == (35, 43)


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
