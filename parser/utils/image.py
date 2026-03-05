"""Image utilities for banner generation.

Provides face-aware smart cropping and gradient+text overlay
for generating clickable promotional banners.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

# OpenCV bundles Haar cascade XML files
_CASCADE_PATH = os.path.join(
    os.path.dirname(cv2.__file__),
    "data",
    "haarcascade_frontalface_default.xml",
)
_face_cascade: Optional[cv2.CascadeClassifier] = None


def _get_face_cascade() -> cv2.CascadeClassifier:
    """Lazily load the face detection cascade."""
    global _face_cascade
    if _face_cascade is None:
        _face_cascade = cv2.CascadeClassifier(_CASCADE_PATH)
    return _face_cascade


def detect_face(img: Image.Image) -> Optional[tuple[int, int, int, int]]:
    """Detect the largest face in a PIL image.

    Returns (x, y, w, h) of the largest face, or None if no face found.
    """
    try:
        arr = np.array(img)
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

        cascade = _get_face_cascade()
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(30, 30),
        )

        if len(faces) == 0:
            return None

        # Return the largest face by area
        largest = max(faces, key=lambda f: f[2] * f[3])
        return (int(largest[0]), int(largest[1]), int(largest[2]), int(largest[3]))
    except Exception:
        logger.debug("Face detection failed", exc_info=True)
        return None


def smart_crop(img: Image.Image, target_ratio: float) -> Image.Image:
    """Crop image to target aspect ratio with face-aware positioning.

    1. Detect face in the image
    2. If face found: position crop so face is in upper third
    3. If no face: use upper-third bias (better than center for portrait content)
    """
    src_w, src_h = img.size
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        return img

    if src_ratio > target_ratio:
        # Source is wider than target — crop horizontally
        new_w = int(src_h * target_ratio)
        face = detect_face(img)
        if face is not None:
            fx, _, fw, _ = face
            face_cx = fx + fw // 2
            offset = face_cx - new_w // 2
            offset = max(0, min(offset, src_w - new_w))
        else:
            offset = (src_w - new_w) // 2
        return img.crop((offset, 0, offset + new_w, src_h))
    else:
        # Source is taller than target — crop vertically (portrait → landscape)
        new_h = int(src_w / target_ratio)
        face = detect_face(img)
        if face is not None:
            _, fy, _, fh = face
            face_cy = fy + fh // 2
            # Place face in the upper 35% of the crop
            offset = face_cy - int(new_h * 0.35)
            offset = max(0, min(offset, src_h - new_h))
        else:
            # Upper-third bias: offset at 25% instead of center (50%)
            offset = int((src_h - new_h) * 0.25)
        return img.crop((0, offset, src_w, offset + new_h))


# Backward-compatible alias
def crop_to_ratio(img: Image.Image, target_ratio: float) -> Image.Image:
    """Crop image to match *target_ratio* (width/height).

    Uses smart face-aware cropping.
    """
    return smart_crop(img, target_ratio)


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

    Bottom 35% gets a transparent→black gradient, with @username
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
    1. Open source image → RGB
    2. Smart crop to target aspect ratio (face-aware)
    3. Resize to target dimensions (Lanczos)
    4. Add gradient + text overlay (if username provided)
    5. Save as JPEG

    Returns True on success, False on failure.
    """
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")
            target_ratio = width / height
            cropped = smart_crop(img, target_ratio)
            resized = cropped.resize((width, height), Image.LANCZOS)
            if username:
                resized = add_overlay(resized, username)
            resized.save(dest_path, "JPEG", quality=quality)
            return True
    except Exception:
        logger.error("Failed to generate banner %dx%d from %s", width, height, src_path, exc_info=True)
        return False
