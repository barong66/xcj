"""Image utilities for banner generation.

Uses Gemini Image Editing API for content-aware cropping and enhancement,
with Pillow fallback for when Gemini is unavailable. Text overlay (gradient +
username + CTA) is always done via Pillow for reliability.
"""
from __future__ import annotations

import logging
import os
from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from parser.config.settings import settings

logger = logging.getLogger(__name__)

# Lazy-initialized Gemini client
_genai_client = None


def _get_genai_client():
    """Lazily init the Gemini client. Returns None if no API key."""
    global _genai_client
    if _genai_client is not None:
        return _genai_client

    api_key = settings.gemini_api_key
    if not api_key:
        return None

    try:
        from google import genai
        _genai_client = genai.Client(api_key=api_key)
        return _genai_client
    except Exception:
        logger.warning("Failed to initialize Gemini client", exc_info=True)
        return None


def _fallback_crop(img: Image.Image, width: int, height: int) -> Image.Image:
    """Simple center-crop with upper-third bias (no external deps)."""
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        return img

    if src_ratio > target_ratio:
        crop_h = src_h
        crop_w = int(src_h * target_ratio)
        offset = (src_w - crop_w) // 2
        return img.crop((offset, 0, offset + crop_w, src_h))
    else:
        crop_w = src_w
        crop_h = int(src_w / target_ratio)
        offset = int((src_h - crop_h) * 0.25)  # upper-third bias
        return img.crop((0, offset, src_w, offset + crop_h))


def gemini_crop_and_enhance(
    img: Image.Image, width: int, height: int,
) -> Image.Image:
    """Crop and enhance image using Gemini Image Editing API.

    Sends the source image to Gemini with a prompt to find the most
    attractive composition and enhance colors/contrast. Falls back
    to simple center-crop if Gemini is unavailable or fails.
    """
    client = _get_genai_client()
    if client is None:
        logger.debug("Gemini not configured, using fallback crop")
        return _fallback_crop(img, width, height)

    try:
        from google.genai import types

        prompt = (
            f"Crop this photo of a female model to a {width}x{height} banner. "
            "You are a professional photographer choosing the best frame. "
            "Apply rule of thirds, find the most flattering and seductive composition. "
            "Focus on face and body, keep the subject well-framed. "
            "Boost contrast and color saturation to make it vivid and eye-catching. "
            "Do not add any text, logos, or watermarks. "
            "Return only the cropped and enhanced image."
        )

        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=[prompt, img],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )

        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                result = Image.open(BytesIO(part.inline_data.data))
                return result.convert("RGB")

        logger.warning("Gemini returned no image data, using fallback crop")
        return _fallback_crop(img, width, height)

    except Exception:
        logger.warning("Gemini image editing failed, using fallback crop", exc_info=True)
        return _fallback_crop(img, width, height)


# Keep smart_crop as the main entry point (backward compat)
def smart_crop(img: Image.Image, width: int, height: int) -> Image.Image:
    """Content-aware crop to target dimensions.

    Routes to Gemini when available, otherwise uses fallback.
    """
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        return img

    return gemini_crop_and_enhance(img, width, height)


# Backward-compatible alias used by tests
def crop_to_ratio(img: Image.Image, target_ratio: float) -> Image.Image:
    """Crop image to match *target_ratio* (width/height)."""
    src_w, src_h = img.size
    if target_ratio >= src_w / src_h:
        crop_w = src_w
        crop_h = int(src_w / target_ratio)
    else:
        crop_h = src_h
        crop_w = int(src_h * target_ratio)
    return smart_crop(img, crop_w, crop_h)


def _find_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Find a usable TrueType font, falling back to Pillow default."""
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",   # Debian/Ubuntu
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",                     # macOS
        "/System/Library/Fonts/SFNSText.ttf",
    ]
    for path in font_paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    # Pillow >= 10.1 supports size param on load_default
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def add_overlay(img: Image.Image, username: str) -> Image.Image:
    """Add gradient overlay with @username and CTA text to the banner.

    Bottom 35% gets a transparent->black gradient, with @username
    on the left and "Watch Now" on the right.
    """
    w, h = img.size
    result = img.convert("RGBA")

    # --- Gradient (efficient via numpy) ---
    gradient_h = int(h * 0.35)
    if gradient_h > 0:
        alpha_col = np.linspace(0, 180, gradient_h, dtype=np.uint8)
        grad_arr = np.zeros((gradient_h, w, 4), dtype=np.uint8)
        grad_arr[:, :, 3] = alpha_col[:, np.newaxis]
        gradient = Image.fromarray(grad_arr, "RGBA")
        result.paste(gradient, (0, h - gradient_h), gradient)

    # --- Text ---
    draw = ImageDraw.Draw(result)
    font_size = max(12, int(h * 0.07))
    font = _find_font(font_size)
    small_font_size = max(10, int(h * 0.055))
    small_font = _find_font(small_font_size)

    pad = int(w * 0.04)
    text_y = h - pad - font_size

    # @username — white, left
    draw.text(
        (pad, text_y),
        f"@{username}",
        fill=(255, 255, 255, 230),
        font=font,
    )

    # CTA — accent red, right
    cta = "Watch Now \u2192"
    cta_bbox = draw.textbbox((0, 0), cta, font=small_font)
    cta_w = cta_bbox[2] - cta_bbox[0]
    draw.text(
        (w - pad - cta_w, text_y + (font_size - small_font_size) // 2),
        cta,
        fill=(234, 56, 76, 255),
        font=small_font,
    )

    return result.convert("RGB")


def generate_banner(
    src_path: str,
    dest_path: str,
    width: int,
    height: int,
    quality: int = 90,
    username: str = "",
) -> bool:
    """Generate a banner image from a source thumbnail.

    Pipeline:
    1. Open source image -> RGB
    2. Gemini crop + enhance (or fallback center-crop)
    3. Resize to exact target dimensions (Lanczos)
    4. Add gradient + text overlay (if username provided)
    5. Save as JPEG

    Returns True on success, False on failure.
    """
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")
            cropped = gemini_crop_and_enhance(img, width, height)
            resized = cropped.resize((width, height), Image.LANCZOS)
            if username:
                resized = add_overlay(resized, username)
            resized.save(dest_path, "JPEG", quality=quality)
            return True
    except Exception:
        logger.error("Failed to generate banner %dx%d from %s", width, height, src_path, exc_info=True)
        return False
