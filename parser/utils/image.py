"""Image utilities for banner generation."""
from __future__ import annotations

import logging

from PIL import Image

logger = logging.getLogger(__name__)


def crop_to_ratio(img: Image.Image, target_ratio: float) -> Image.Image:
    """Crop image to match *target_ratio* (width/height), centered."""
    src_w, src_h = img.size
    src_ratio = src_w / src_h
    if src_ratio > target_ratio:
        new_w = int(src_h * target_ratio)
        offset = (src_w - new_w) // 2
        return img.crop((offset, 0, offset + new_w, src_h))
    elif src_ratio < target_ratio:
        new_h = int(src_w / target_ratio)
        offset = (src_h - new_h) // 2
        return img.crop((0, offset, src_w, offset + new_h))
    return img


def generate_banner(
    src_path: str,
    dest_path: str,
    width: int,
    height: int,
    quality: int = 90,
) -> bool:
    """Generate a banner image from a source thumbnail.

    1. Open source image
    2. Crop to target aspect ratio (centered)
    3. Resize to target dimensions (Lanczos)
    4. Save as JPEG

    Returns True on success, False on failure.
    """
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")
            target_ratio = width / height
            cropped = crop_to_ratio(img, target_ratio)
            resized = cropped.resize((width, height), Image.LANCZOS)
            resized.save(dest_path, "JPEG", quality=quality)
            return True
    except Exception:
        logger.error("Failed to generate banner %dx%d from %s", width, height, src_path, exc_info=True)
        return False
