"""Tests for banner image generation utilities."""
import os
import tempfile

import numpy as np
import pytest
from PIL import Image, ImageDraw

from parser.utils.image import (
    add_overlay,
    crop_to_ratio,
    generate_banner,
    smart_crop,
)


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
        result = smart_crop(img, 300, 250)
        # Width stays 810, height = 810 / 1.2 = 675
        assert result.size == (810, 675)

    def test_solid_image(self):
        """Smart crop on a solid image should still produce correct dimensions."""
        img = Image.new("RGB", (100, 400), "gray")
        result = smart_crop(img, 100, 100)
        assert result.size == (100, 100)

    def test_already_correct_ratio(self):
        """Smart crop should return unchanged if ratio already matches."""
        img = Image.new("RGB", (300, 250), "blue")
        result = smart_crop(img, 300, 250)
        assert result.size == (300, 250)

    def test_wider_to_narrower(self):
        """Smart crop of landscape to portrait should crop width."""
        img = Image.new("RGB", (800, 400), "green")
        result = smart_crop(img, 200, 400)
        assert result.size == (200, 400)

    def test_with_detailed_image(self):
        """Smart crop should find interesting region in a non-uniform image."""
        img = Image.new("RGB", (400, 800), (50, 50, 50))
        draw = ImageDraw.Draw(img)
        # Draw a bright region in upper portion (simulates subject)
        draw.rectangle((100, 50, 300, 250), fill=(255, 200, 150))
        result = smart_crop(img, 300, 250)
        assert result.size[0] == 400  # full width
        assert result.size[1] > 0


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

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250, username="")
            assert ok is True
