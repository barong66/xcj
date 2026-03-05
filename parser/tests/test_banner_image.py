"""Tests for banner image generation utilities."""
import os
import tempfile

import pytest
from PIL import Image

from parser.utils.image import crop_to_ratio, generate_banner


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


class TestGenerateBanner:
    def test_generates_jpeg(self):
        """generate_banner should create a valid JPEG at the target size."""
        with tempfile.TemporaryDirectory() as tmp:
            # Create a source image.
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
