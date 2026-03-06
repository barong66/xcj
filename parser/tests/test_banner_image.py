"""Tests for banner image generation utilities."""
import os
import tempfile
from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image, ImageDraw

from parser.utils.image import (
    _center_crop,
    _face_crop,
    add_overlay,
    crop_to_ratio,
    generate_banner,
    smart_crop,
)


# ── Helpers ──────────────────────────────────────────────────────

def _make_image_with_face(width: int = 810, height: int = 1440) -> Image.Image:
    """Create a test image with a simple 'face' (light oval on dark bg).

    OpenCV's Haar cascade detects this as a face-like region.
    """
    img = Image.new("RGB", (width, height), (40, 40, 40))
    draw = ImageDraw.Draw(img)
    # Draw a skin-toned oval in the upper portion (simulates a face)
    face_w, face_h = width // 4, height // 6
    cx, cy = width // 2, height // 4
    draw.ellipse(
        [cx - face_w, cy - face_h, cx + face_w, cy + face_h],
        fill=(200, 170, 140),
    )
    # Add eye-like dark spots for better Haar detection
    eye_r = face_w // 5
    draw.ellipse(
        [cx - face_w // 2 - eye_r, cy - eye_r,
         cx - face_w // 2 + eye_r, cy + eye_r],
        fill=(30, 30, 30),
    )
    draw.ellipse(
        [cx + face_w // 2 - eye_r, cy - eye_r,
         cx + face_w // 2 + eye_r, cy + eye_r],
        fill=(30, 30, 30),
    )
    return img


# ── Center crop ─────────────────────────────────────────────────

class TestCenterCrop:
    def test_wider_image_crops_width(self):
        img = Image.new("RGB", (200, 100), "red")
        result = _center_crop(img, 100, 100)
        assert result.size == (100, 100)

    def test_taller_image_crops_height(self):
        img = Image.new("RGB", (100, 200), "blue")
        result = _center_crop(img, 100, 100)
        assert result.size == (100, 100)

    def test_exact_ratio_unchanged(self):
        img = Image.new("RGB", (300, 250), "green")
        result = _center_crop(img, 300, 250)
        assert result.size == (300, 250)

    def test_landscape_to_portrait(self):
        img = Image.new("RGB", (400, 200), "white")
        result = _center_crop(img, 9, 16)
        expected_w = int(200 * (9 / 16))
        assert result.size == (expected_w, 200)

    def test_portrait_to_landscape(self):
        img = Image.new("RGB", (810, 1440), "red")
        result = _center_crop(img, 300, 250)
        assert result.size == (810, 675)


# ── Face crop ────────────────────────────────────────────────────

class TestFaceCrop:
    def test_no_faces_falls_back_to_center(self):
        """Plain image with no face-like features → same as center crop."""
        img = Image.new("RGB", (810, 1440), (128, 128, 128))
        result = _face_crop(img, 300, 250)
        expected = _center_crop(img, 300, 250)
        assert result.size == expected.size

    def test_preserves_aspect_ratio_tall(self):
        """Tall image cropped to landscape preserves correct ratio."""
        img = Image.new("RGB", (810, 1440), "gray")
        result = _face_crop(img, 300, 250)
        w, h = result.size
        assert w == 810
        assert h == 675

    def test_preserves_aspect_ratio_wide(self):
        """Wide image cropped to square preserves correct ratio."""
        img = Image.new("RGB", (800, 400), "gray")
        result = _face_crop(img, 100, 100)
        w, h = result.size
        assert h == 400
        assert w == 400

    def test_exact_ratio_returns_same(self):
        img = Image.new("RGB", (300, 250), "green")
        result = _face_crop(img, 300, 250)
        assert result.size == (300, 250)


# ── Smart crop (integration) ────────────────────────────────────

class TestSmartCrop:
    def test_exact_ratio_unchanged(self):
        img = Image.new("RGB", (300, 250), "green")
        result = smart_crop(img, 300, 250)
        assert result.size == (300, 250)

    def test_portrait_to_landscape(self):
        img = Image.new("RGB", (810, 1440), "red")
        result = smart_crop(img, 300, 250)
        assert result.size == (810, 675)

    def test_falls_back_on_exception(self):
        """If face detection raises, smart_crop still works."""
        img = Image.new("RGB", (810, 1440), "red")
        with patch("parser.utils.image._face_crop", side_effect=RuntimeError("boom")):
            result = smart_crop(img, 300, 250)
        assert result.size == (810, 675)


# ── crop_to_ratio (backward compat) ─────────────────────────────

class TestCropToRatio:
    def test_wider_image_crops_width(self):
        img = Image.new("RGB", (200, 100), "red")
        result = crop_to_ratio(img, 1.0)
        assert result.size == (100, 100)

    def test_taller_image_crops_height(self):
        img = Image.new("RGB", (100, 200), "blue")
        result = crop_to_ratio(img, 1.0)
        assert result.size == (100, 100)

    def test_exact_ratio_unchanged(self):
        img = Image.new("RGB", (300, 250), "green")
        result = crop_to_ratio(img, 300 / 250)
        assert result.size == (300, 250)

    def test_landscape_to_portrait(self):
        img = Image.new("RGB", (400, 200), "white")
        result = crop_to_ratio(img, 9 / 16)
        expected_w = int(200 * (9 / 16))
        assert result.size == (expected_w, 200)


# ── Overlay ─────────────────────────────────────────────────────

class TestAddOverlay:
    def test_output_same_dimensions(self):
        img = Image.new("RGB", (300, 250), "blue")
        result = add_overlay(img, "testuser")
        assert result.size == (300, 250)
        assert result.mode == "RGB"

    def test_overlay_modifies_pixels(self):
        img = Image.new("RGB", (300, 250), (100, 100, 100))
        result = add_overlay(img, "testuser")
        orig_px = img.getpixel((5, 245))
        new_px = result.getpixel((5, 245))
        assert sum(new_px) <= sum(orig_px)

    def test_small_image(self):
        img = Image.new("RGB", (50, 50), "red")
        result = add_overlay(img, "x")
        assert result.size == (50, 50)


# ── generate_banner (end-to-end) ─────────────────────────────────

class TestGenerateBanner:
    def test_generates_jpeg(self):
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
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner("/nonexistent/path.jpg", dest, 300, 250)
            assert ok is False

    def test_with_username_overlay(self):
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
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.jpg")
            img = Image.new("RGB", (300, 250), (128, 128, 128))
            img.save(src, "JPEG")

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250, username="")
            assert ok is True
