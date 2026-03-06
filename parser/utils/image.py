"""Image utilities for banner generation.

Uses OpenCV face detection for smart cropping that preserves faces,
with center-crop fallback. Banner overlay is rendered via HTML template
+ headless Chromium (html2image), with Pillow fallback.
"""
from __future__ import annotations

import base64
import logging
import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

logger = logging.getLogger(__name__)

# Path to HTML banner templates (relative to this file)
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

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


def _render_html_banner(
    thumbnail_path: str, width: int, height: int,
) -> Image.Image | None:
    """Render HTML banner template to an image using headless Chromium.

    Embeds the thumbnail as a base64 data URI in the HTML template,
    then screenshots it with html2image. Returns None if rendering fails.
    """
    template_file = _TEMPLATES_DIR / "banner_bold_prod.html"
    if not template_file.exists():
        logger.warning("Banner template not found: %s", template_file)
        return None

    try:
        from html2image import Html2Image
    except ImportError:
        logger.warning("html2image not installed, skipping HTML rendering")
        return None

    # Embed thumbnail as base64 data URI to avoid network requests
    with open(thumbnail_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()
    data_uri = f"data:image/jpeg;base64,{img_b64}"

    html = template_file.read_text()
    html = html.replace("{{THUMBNAIL_URL}}", data_uri)
    html = html.replace("{{WIDTH}}", str(width))
    html = html.replace("{{HEIGHT}}", str(height))

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            hti = Html2Image(
                output_path=tmp_dir,
                custom_flags=[
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                    "--hide-scrollbars",
                    "--disable-remote-fonts",
                    "--run-all-compositor-stages-before-draw",
                ],
            )
            paths = hti.screenshot(
                html_str=html,
                save_as="banner.png",
                size=(width, height),
            )
            if paths:
                result = Image.open(paths[0]).convert("RGB")
                return result
    except Exception:
        logger.warning("HTML banner rendering failed", exc_info=True)

    return None


def _pillow_overlay(img: Image.Image) -> Image.Image:
    """Pillow fallback overlay when HTML rendering is unavailable."""
    w, h = img.size
    result = img.convert("RGBA")

    # Dark tint
    tint = Image.new("RGBA", (w, h), (0, 0, 0, 65))
    result = Image.alpha_composite(result, tint)

    # Bottom gradient
    gradient_h = int(h * 0.55)
    if gradient_h > 0:
        alpha_col = np.linspace(0, 220, gradient_h, dtype=np.uint8)
        grad_arr = np.zeros((gradient_h, w, 4), dtype=np.uint8)
        grad_arr[:, :, 3] = alpha_col[:, np.newaxis]
        gradient = Image.fromarray(grad_arr, "RGBA")
        result.paste(gradient, (0, h - gradient_h), gradient)

    # Pink border
    accent = (255, 45, 123)
    draw = ImageDraw.Draw(result)
    for rect in [
        [0, 0, w - 1, 2], [0, h - 3, w - 1, h - 1],
        [0, 0, 2, h - 1], [w - 3, 0, w - 1, h - 1],
    ]:
        draw.rectangle(rect, fill=(*accent, 200))

    # CTA pill
    cta = "WATCH ME NOW"
    font = _find_font(max(11, int(h * 0.055)))
    bbox = draw.textbbox((0, 0), cta, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    px, py = int(w * 0.08), int(h * 0.025)
    pw, ph = tw + px * 2, th + py * 2
    pill_x, pill_y = (w - pw) // 2, h - ph - int(h * 0.08)
    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pw, pill_y + ph],
        radius=ph // 2, fill=(*accent, 230),
    )
    draw.text(
        (pill_x + (pw - tw) // 2, pill_y + (ph - th) // 2),
        cta, fill=(255, 255, 255, 255), font=font,
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
    3. Resize + enhance
    4. Save processed thumbnail to temp file
    5. Render HTML template with Chromium (or Pillow fallback)
    6. Save as JPEG

    Returns True on success, False on failure.
    """
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")
            cropped = smart_crop(img, width, height)
            resized = cropped.resize((width, height), Image.LANCZOS)
            enhanced = enhance_image(resized)

            # Save processed thumbnail for HTML template
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                tmp_path = tmp.name
                enhanced.save(tmp_path, "JPEG", quality=95)

            try:
                # Try HTML rendering first
                result = _render_html_banner(tmp_path, width, height)
                if result is not None:
                    result.save(dest_path, "JPEG", quality=quality)
                    return True

                # Fallback to Pillow overlay
                logger.info("Using Pillow fallback for banner overlay")
                final = _pillow_overlay(enhanced)
                final.save(dest_path, "JPEG", quality=quality)
                return True
            finally:
                os.unlink(tmp_path)

    except Exception:
        logger.error("Failed to generate banner %dx%d from %s", width, height, src_path, exc_info=True)
        return False
