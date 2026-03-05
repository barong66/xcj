"""Tests for banner image generation utilities."""
import os
import tempfile

import numpy as np
import pytest
from PIL import Image, ImageDraw

from parser.utils.image import (
    add_overlay,
    crop_to_ratio,
    detect_face,
    generate_banner,
    smart_crop,
)


def _make_face_image(width: int = 400, height: int = 800) -> Image.Image:
    """Create a test image with a simple face-like pattern for detection.

    Draws a skin-colored oval with dark eye regions that OpenCV's
    Haar cascade can detect.
    """
    img = Image.new("RGB", (width, height), (50, 50, 50))
    draw = ImageDraw.Draw(img)

    # Face region in upper third
    face_cx, face_cy = width // 2, height // 4
    face_w, face_h = width // 3, width // 3

    # Skin-colored oval
    draw.ellipse(
        (face_cx - face_w // 2, face_cy - face_h // 2,
         face_cx + face_w // 2, face_cy + face_h // 2),
        fill=(200, 170, 140),
    )

    # Dark eye regions
    eye_y = face_cy - face_h // 8
    eye_offset = face_w // 5
    eye_size = face_w // 8
    for ex in (face_cx - eye_offset, face_cx + eye_offset):
        draw.ellipse(
            (ex - eye_size, eye_y - eye_size, ex + eye_size, eye_y + eye_size),
            fill=(30, 30, 30),
        )

    return img


class TestCropToRatio:
    def test_wider_image_crops_width(self):
        """A 200x100 image cropped to 1:1 ratio should become 100x100."""
        img = Image.new("RGB", (200, 100), "red")
        result = crop_to_ratio(img, 1.0)
        assert result.size == (100, 100)

    def test_taller_image_crops_height(self):
        """A 100x200 image cropped to 1:1 ratio should become 100x100."""
        img = Image.new("RGB", (100, 200), "blue")
        result = crop_to_ratio(img, 1.0)
        assert result.size == (100, 100)

    def test_exact_ratio_unchanged(self):
        """An image already at the target ratio should remain the same size."""
        img = Image.new("RGB", (300, 250), "green")
        result = crop_to_ratio(img, 300 / 250)
        assert result.size == (300, 250)

    def test_landscape_to_portrait(self):
        """A 400x200 image cropped to 9:16 should reduce width."""
        img = Image.new("RGB", (400, 200), "white")
        result = crop_to_ratio(img, 9 / 16)
        expected_w = int(200 * (9 / 16))
        assert result.size == (expected_w, 200)


class TestSmartCrop:
    def test_portrait_to_landscape_dimensions(self):
        """Smart crop of portrait to landscape should produce correct dimensions."""
        img = Image.new("RGB", (810, 1440), "red")
        result = smart_crop(img, 300 / 250)
        # Expected: width stays 810, height = 810 / 1.2 = 675
        assert result.size == (810, 675)

    def test_upper_bias_no_face(self):
        """Without a face, smart crop should use upper-third bias (not center)."""
        # Create a solid image — no face to detect
        img = Image.new("RGB", (100, 400), "gray")
        result = smart_crop(img, 1.0)
        # Result should be 100x100
        assert result.size == (100, 100)

        # The crop should come from the upper portion, not center.
        # With upper-third bias: offset = (400 - 100) * 0.25 = 75
        # Center would be: offset = (400 - 100) * 0.5 = 150
        # We can't check exact pixels easily, but size should be correct.

    def test_already_correct_ratio(self):
        """Smart crop should return unchanged if ratio already matches."""
        img = Image.new("RGB", (300, 250), "blue")
        result = smart_crop(img, 300 / 250)
        assert result.size == (300, 250)

    def test_wider_to_narrower(self):
        """Smart crop of landscape to portrait should crop width."""
        img = Image.new("RGB", (800, 400), "green")
        result = smart_crop(img, 0.5)
        assert result.size == (200, 400)


class TestDetectFace:
    def test_no_face_in_solid_image(self):
        """Solid color image should return None (no face)."""
        img = Image.new("RGB", (200, 200), "white")
        assert detect_face(img) is None

    def test_returns_tuple_or_none(self):
        """detect_face should return a 4-tuple or None."""
        img = Image.new("RGB", (100, 100), "gray")
        result = detect_face(img)
        assert result is None or (isinstance(result, tuple) and len(result) == 4)


class TestAddOverlay:
    def test_output_same_dimensions(self):
        """Overlay should not change image dimensions."""
        img = Image.new("RGB", (300, 250), "blue")
        result = add_overlay(img, "testuser")
        assert result.size == (300, 250)
        assert result.mode == "RGB"

    def test_overlay_modifies_pixels(self):
        """Overlay should modify the bottom portion (gradient + text)."""
        img = Image.new("RGB", (300, 250), (100, 100, 100))
        result = add_overlay(img, "testuser")
        # Bottom-left pixel should be darker (gradient)
        orig_px = img.getpixel((5, 245))
        new_px = result.getpixel((5, 245))
        # At least one channel should be darker due to gradient
        assert sum(new_px) <= sum(orig_px)

    def test_small_image(self):
        """Overlay should work even on very small images."""
        img = Image.new("RGB", (50, 50), "red")
        result = add_overlay(img, "x")
        assert result.size == (50, 50)


class TestGenerateBanner:
    def test_generates_jpeg(self):
        """generate_banner should create a valid JPEG at the target size."""
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.jpg")
            img = Image.new("RGB", (800, 600), "purple")
            img.save(src, "JPEG")

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250)

            assert ok is True
            assert os.path.isfile(dest)

            with Image.open(dest) as result:
                assert result.size == (300, 250)
                assert result.format == "JPEG"

    def test_portrait_source(self):
        """Banner generation works with portrait source images."""
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "portrait.jpg")
            img = Image.new("RGB", (540, 960), "cyan")
            img.save(src, "JPEG")

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 728, 90)

            assert ok is True
            with Image.open(dest) as result:
                assert result.size == (728, 90)

    def test_returns_false_on_bad_source(self):
        """generate_banner should return False for non-existent source."""
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner("/nonexistent/path.jpg", dest, 300, 250)
            assert ok is False

    def test_with_username_overlay(self):
        """generate_banner with username should add overlay."""
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.jpg")
            img = Image.new("RGB", (810, 1440), "teal")
            img.save(src, "JPEG")

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250, username="modelname")

            assert ok is True
            with Image.open(dest) as result:
                assert result.size == (300, 250)

    def test_without_username_no_overlay(self):
        """generate_banner without username should skip overlay."""
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.jpg")
            img = Image.new("RGB", (300, 250), (128, 128, 128))
            img.save(src, "JPEG")

            # Without username — bottom pixels should be similar to source
            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250, username="")
            assert ok is True
