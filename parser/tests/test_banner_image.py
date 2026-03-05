"""Tests for banner image generation utilities."""
import os
import tempfile
from io import BytesIO
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from PIL import Image, ImageDraw

from parser.utils.image import (
    _fallback_crop,
    add_overlay,
    crop_to_ratio,
    gemini_crop_and_enhance,
    generate_banner,
    smart_crop,
)


# ── Helpers ──────────────────────────────────────────────────────

def _make_gemini_response(img: Image.Image):
    """Create a mock Gemini response containing an image."""
    buf = BytesIO()
    img.save(buf, format="PNG")
    raw_bytes = buf.getvalue()

    part = MagicMock()
    part.inline_data = MagicMock()
    part.inline_data.data = raw_bytes
    part.inline_data.mime_type = "image/png"
    part.text = None

    candidate = MagicMock()
    candidate.content.parts = [part]

    response = MagicMock()
    response.candidates = [candidate]
    return response


def _make_empty_gemini_response():
    """Gemini response with text only (no image)."""
    part = MagicMock()
    part.inline_data = None
    part.text = "I cannot process this image."

    candidate = MagicMock()
    candidate.content.parts = [part]

    response = MagicMock()
    response.candidates = [candidate]
    return response


# ── Fallback crop ────────────────────────────────────────────────

class TestFallbackCrop:
    def test_wider_image_crops_width(self):
        img = Image.new("RGB", (200, 100), "red")
        result = _fallback_crop(img, 100, 100)
        assert result.size == (100, 100)

    def test_taller_image_crops_height(self):
        img = Image.new("RGB", (100, 200), "blue")
        result = _fallback_crop(img, 100, 100)
        assert result.size == (100, 100)

    def test_exact_ratio_unchanged(self):
        img = Image.new("RGB", (300, 250), "green")
        result = _fallback_crop(img, 300, 250)
        assert result.size == (300, 250)

    def test_landscape_to_portrait(self):
        img = Image.new("RGB", (400, 200), "white")
        result = _fallback_crop(img, 9, 16)
        expected_w = int(200 * (9 / 16))
        assert result.size == (expected_w, 200)

    def test_portrait_to_landscape(self):
        img = Image.new("RGB", (810, 1440), "red")
        result = _fallback_crop(img, 300, 250)
        assert result.size == (810, 675)


# ── Gemini crop + enhance ───────────────────────────────────────

class TestGeminiCropAndEnhance:
    @patch("parser.utils.image._get_genai_client")
    def test_gemini_returns_image(self, mock_get_client):
        """When Gemini succeeds, returns the image from API."""
        # Prepare a 300x250 "enhanced" image that Gemini would return
        enhanced = Image.new("RGB", (300, 250), (255, 100, 50))
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _make_gemini_response(enhanced)
        mock_get_client.return_value = mock_client

        src = Image.new("RGB", (810, 1440), "gray")
        result = gemini_crop_and_enhance(src, 300, 250)

        assert result.mode == "RGB"
        # Gemini was called
        mock_client.models.generate_content.assert_called_once()

    @patch("parser.utils.image._get_genai_client")
    def test_gemini_no_image_falls_back(self, mock_get_client):
        """When Gemini returns text only, falls back to crop."""
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _make_empty_gemini_response()
        mock_get_client.return_value = mock_client

        src = Image.new("RGB", (810, 1440), "gray")
        result = gemini_crop_and_enhance(src, 300, 250)

        # Should still produce correct aspect ratio via fallback
        assert result.size == (810, 675)

    @patch("parser.utils.image._get_genai_client")
    def test_gemini_exception_falls_back(self, mock_get_client):
        """When Gemini raises, falls back to crop."""
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = RuntimeError("API error")
        mock_get_client.return_value = mock_client

        src = Image.new("RGB", (810, 1440), "gray")
        result = gemini_crop_and_enhance(src, 300, 250)

        assert result.size == (810, 675)

    @patch("parser.utils.image._get_genai_client")
    def test_no_api_key_falls_back(self, mock_get_client):
        """When no Gemini client, falls back to crop."""
        mock_get_client.return_value = None

        src = Image.new("RGB", (810, 1440), "gray")
        result = gemini_crop_and_enhance(src, 300, 250)

        assert result.size == (810, 675)


# ── crop_to_ratio (backward compat) ─────────────────────────────

class TestCropToRatio:
    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_wider_image_crops_width(self, _):
        img = Image.new("RGB", (200, 100), "red")
        result = crop_to_ratio(img, 1.0)
        assert result.size == (100, 100)

    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_taller_image_crops_height(self, _):
        img = Image.new("RGB", (100, 200), "blue")
        result = crop_to_ratio(img, 1.0)
        assert result.size == (100, 100)

    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_exact_ratio_unchanged(self, _):
        img = Image.new("RGB", (300, 250), "green")
        result = crop_to_ratio(img, 300 / 250)
        assert result.size == (300, 250)

    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_landscape_to_portrait(self, _):
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
    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_generates_jpeg(self, _):
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

    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_portrait_source(self, _):
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

    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_with_username_overlay(self, _):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.jpg")
            img = Image.new("RGB", (810, 1440), "teal")
            img.save(src, "JPEG")

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250, username="modelname")

            assert ok is True
            with Image.open(dest) as result:
                assert result.size == (300, 250)

    @patch("parser.utils.image._get_genai_client", return_value=None)
    def test_without_username_no_overlay(self, _):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.jpg")
            img = Image.new("RGB", (300, 250), (128, 128, 128))
            img.save(src, "JPEG")

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250, username="")
            assert ok is True

    @patch("parser.utils.image._get_genai_client")
    def test_with_gemini(self, mock_get_client):
        """Full pipeline with mocked Gemini returning an enhanced image."""
        enhanced = Image.new("RGB", (300, 250), (255, 200, 100))
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = _make_gemini_response(enhanced)
        mock_get_client.return_value = mock_client

        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "source.jpg")
            img = Image.new("RGB", (810, 1440), "gray")
            img.save(src, "JPEG")

            dest = os.path.join(tmp, "banner.jpg")
            ok = generate_banner(src, dest, 300, 250, username="star")

            assert ok is True
            with Image.open(dest) as result:
                assert result.size == (300, 250)
                assert result.format == "JPEG"
