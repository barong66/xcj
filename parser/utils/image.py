"""Image utilities for banner generation.

Uses smartcrop for content-aware cropping (saliency detection:
skin tones, contrast, edges) and Pillow for gradient+text overlay.
"""
from __future__ import annotations

import logging
import os

import numpy as np
import smartcrop
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

_cropper: smartcrop.SmartCrop | None = None


def _get_cropper() -> smartcrop.SmartCrop:
    """Lazily init the SmartCrop instance."""
    global _cropper
    if _cropper is None:
        _cropper = smartcrop.SmartCrop()
    return _cropper


def smart_crop(img: Image.Image, width: int, height: int) -> Image.Image:
    """Content-aware crop to target dimensions using smartcrop.

    smartcrop.js algorithm analyzes skin regions, saturation,
    and edge detail to find the optimal crop region.
    """
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        return img

    # smartcrop needs the target crop dimensions in source-image scale
    if src_ratio > target_ratio:
        crop_h = src_h
        crop_w = int(src_h * target_ratio)
    else:
        crop_w = src_w
        crop_h = int(src_w / target_ratio)

    try:
        cropper = _get_cropper()
        result = cropper.crop(img, crop_w, crop_h)
        box = result["top_crop"]["box"]
        return img.crop((box["x"], box["y"],
                         box["x"] + box["width"],
                         box["y"] + box["height"]))
    except Exception:
        logger.debug("smartcrop failed, using upper-third fallback", exc_info=True)
        # Fallback: upper-third bias
        if src_ratio > target_ratio:
            offset = (src_w - crop_w) // 2
            return img.crop((offset, 0, offset + crop_w, src_h))
        else:
            offset = int((src_h - crop_h) * 0.25)
            return img.crop((0, offset, src_w, offset + crop_h))


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
    2. Content-aware smart crop (smartcrop saliency detection)
    3. Resize to target dimensions (Lanczos)
    4. Add gradient + text overlay (if username provided)
    5. Save as JPEG

    Returns True on success, False on failure.
    """
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")
            cropped = smart_crop(img, width, height)
            resized = cropped.resize((width, height), Image.LANCZOS)
            if username:
                resized = add_overlay(resized, username)
            resized.save(dest_path, "JPEG", quality=quality)
            return True
    except Exception:
        logger.error("Failed to generate banner %dx%d from %s", width, height, src_path, exc_info=True)
        return False
