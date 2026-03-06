"""Image utilities for banner generation.

Uses OpenCV face detection for smart cropping that preserves faces,
with center-crop fallback. Text overlay (gradient + username + CTA)
is done via Pillow.
"""
from __future__ import annotations

import logging
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

logger = logging.getLogger(__name__)

# Lazy-loaded OpenCV cascades (frontal face → profile face → upper body)
_cascades: list[cv2.CascadeClassifier] | None = None


def _get_cascades() -> list[cv2.CascadeClassifier]:
    """Lazily load Haar cascades in priority order."""
    global _cascades
    if _cascades is None:
        base = cv2.data.haarcascades
        _cascades = [
            cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml"),
            cv2.CascadeClassifier(base + "haarcascade_profileface.xml"),
            cv2.CascadeClassifier(base + "haarcascade_upperbody.xml"),
        ]
    return _cascades


def _center_crop(img: Image.Image, width: int, height: int) -> Image.Image:
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


def _face_crop(img: Image.Image, width: int, height: int) -> Image.Image:
    """Crop image to target aspect ratio, keeping detected faces in frame.

    Uses OpenCV Haar cascade to find faces, then positions the crop
    window to include as many faces as possible (weighted by size).
    Falls back to center-crop if no faces are detected.
    """
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        return img

    # Detect faces/body on a downscaled grayscale image for speed
    scale = min(1.0, 640 / max(src_w, src_h))
    small = img.resize((int(src_w * scale), int(src_h * scale)), Image.BILINEAR)
    gray = cv2.cvtColor(np.array(small), cv2.COLOR_RGB2GRAY)

    # Try cascades in order: frontal face → profile face → upper body
    faces = np.empty((0, 4), dtype=np.int32)
    for cascade in _get_cascades():
        faces = cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=4, minSize=(20, 20),
        )
        if len(faces) > 0:
            break

    if len(faces) == 0:
        logger.debug("No faces/body detected, using center crop")
        return _center_crop(img, width, height)

    # Scale face coordinates back to original image size
    faces_orig = faces / scale  # (x, y, w, h) arrays

    # Compute the weighted center of all faces (bigger faces = more weight)
    face_areas = faces_orig[:, 2] * faces_orig[:, 3]
    total_area = face_areas.sum()
    cx = (faces_orig[:, 0] + faces_orig[:, 2] / 2) @ face_areas / total_area
    cy = (faces_orig[:, 1] + faces_orig[:, 3] / 2) @ face_areas / total_area

    # Determine crop dimensions
    if src_ratio > target_ratio:
        # Image is wider than target — crop width
        crop_w = int(src_h * target_ratio)
        crop_h = src_h
        # Position crop window horizontally centered on faces
        x0 = int(cx - crop_w / 2)
        x0 = max(0, min(x0, src_w - crop_w))
        return img.crop((x0, 0, x0 + crop_w, src_h))
    else:
        # Image is taller than target — crop height
        crop_w = src_w
        crop_h = int(src_w / target_ratio)
        # Position crop window vertically centered on faces
        y0 = int(cy - crop_h / 2)
        y0 = max(0, min(y0, src_h - crop_h))
        return img.crop((0, y0, src_w, y0 + crop_h))


def smart_crop(img: Image.Image, width: int, height: int) -> Image.Image:
    """Content-aware crop to target aspect ratio, preserving faces.

    Uses OpenCV face detection, falls back to center-crop.
    """
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        return img

    try:
        return _face_crop(img, width, height)
    except Exception:
        logger.warning("Face detection failed, using center crop", exc_info=True)
        return _center_crop(img, width, height)


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


def enhance_image(img: Image.Image) -> Image.Image:
    """Make the image punchy: boost contrast, saturation, and sharpness.

    Values > 1.0 increase the effect. Tuned for banner ads —
    should look vivid, crisp, and slightly retouched.
    """
    img = ImageEnhance.Contrast(img).enhance(1.35)
    img = ImageEnhance.Color(img).enhance(1.40)
    img = ImageEnhance.Sharpness(img).enhance(1.50)
    img = ImageEnhance.Brightness(img).enhance(1.05)
    return img


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
    2. Smart crop (face/body detection, or fallback center-crop)
    3. Resize to exact target dimensions (Lanczos)
    4. Add gradient + text overlay (if username provided)
    5. Save as JPEG

    Returns True on success, False on failure.
    """
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")
            cropped = smart_crop(img, width, height)
            resized = cropped.resize((width, height), Image.LANCZOS)
            resized = enhance_image(resized)
            if username:
                resized = add_overlay(resized, username)
            resized.save(dest_path, "JPEG", quality=quality)
            return True
    except Exception:
        logger.error("Failed to generate banner %dx%d from %s", width, height, src_path, exc_info=True)
        return False
