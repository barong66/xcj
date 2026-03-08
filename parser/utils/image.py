"""Image utilities for banner generation and frame extraction.

Uses MediaPipe face detection for smart cropping that preserves faces,
with center-crop fallback. Banner overlay rendered via Pillow (Bold style).
"""
from __future__ import annotations

import logging
import os
from typing import List, Tuple

import ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

logger = logging.getLogger(__name__)

# Lazy-loaded MediaPipe face detector
_face_detector = None

_MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models", "blaze_face_short_range.tflite")


def _get_face_detector():
    """Lazily initialise MediaPipe FaceDetector."""
    global _face_detector
    if _face_detector is None:
        import mediapipe as mp
        opts = mp.tasks.vision.FaceDetectorOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=_MODEL_PATH),
            min_detection_confidence=0.5,
        )
        _face_detector = mp.tasks.vision.FaceDetector.create_from_options(opts)
    return _face_detector


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

    Uses MediaPipe Face Detection to find faces, then positions the crop
    window to include as many faces as possible (weighted by size).
    Falls back to center-crop if no faces are detected.
    """
    src_w, src_h = img.size
    target_ratio = width / height
    src_ratio = src_w / src_h

    if abs(src_ratio - target_ratio) < 0.01:
        return img

    # MediaPipe expects mp.Image
    import mediapipe as mp
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.array(img))
    results = _get_face_detector().detect(mp_img)

    if not results.detections:
        logger.debug("No faces detected, using center crop")
        return _center_crop(img, width, height)

    # Extract bounding boxes as (x, y, w, h) in pixel coords
    faces = []
    for det in results.detections:
        bb = det.bounding_box
        faces.append((bb.origin_x, bb.origin_y, bb.width, bb.height))

    faces = np.array(faces)

    # Compute the weighted center of all faces (bigger faces = more weight)
    face_areas = faces[:, 2] * faces[:, 3]
    total_area = face_areas.sum()
    cx = (faces[:, 0] + faces[:, 2] / 2) @ face_areas / total_area
    cy = (faces[:, 1] + faces[:, 3] / 2) @ face_areas / total_area

    # Determine crop dimensions
    if src_ratio > target_ratio:
        # Image is wider than target — crop width
        crop_w = int(src_h * target_ratio)
        crop_h = src_h
        x0 = int(cx - crop_w / 2)
        x0 = max(0, min(x0, src_w - crop_w))
        return img.crop((x0, 0, x0 + crop_w, src_h))
    else:
        # Image is taller than target — crop height
        crop_w = src_w
        crop_h = int(src_w / target_ratio)
        y0 = int(cy - crop_h / 2)
        y0 = max(0, min(y0, src_h - crop_h))
        return img.crop((0, y0, src_w, y0 + crop_h))


def smart_crop(img: Image.Image, width: int, height: int) -> Image.Image:
    """Content-aware crop to target aspect ratio, preserving faces.

    Uses MediaPipe face detection, falls back to center-crop.
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


def _pillow_overlay(img: Image.Image) -> Image.Image:
    """Bold-style banner overlay matching the production HTML template.

    Renders: dark tint, bottom gradient, gradient CTA pill,
    tagline text, 3px pink border.
    """
    w, h = img.size
    result = img.convert("RGBA")

    # Dark tint (30% black, matching CSS rgba(0,0,0,0.3))
    tint = Image.new("RGBA", (w, h), (0, 0, 0, 77))
    result = Image.alpha_composite(result, tint)

    # Bottom gradient (55% height, black 85% → 40% → transparent)
    gradient_h = int(h * 0.55)
    if gradient_h > 0:
        alpha_col = np.linspace(0, 217, gradient_h, dtype=np.uint8)
        grad_arr = np.zeros((gradient_h, w, 4), dtype=np.uint8)
        grad_arr[:, :, 3] = alpha_col[:, np.newaxis]
        gradient = Image.fromarray(grad_arr, "RGBA")
        result.paste(gradient, (0, h - gradient_h), gradient)

    draw = ImageDraw.Draw(result)

    # CTA pill with pink→orange gradient
    accent_pink = (255, 45, 123)
    accent_orange = (255, 107, 53)
    cta = "WATCH ME NOW"
    cta_font = _find_font(max(11, int(h * 0.052)))
    bbox = draw.textbbox((0, 0), cta, font=cta_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    px, py = int(w * 0.10), int(h * 0.04)
    pw, ph = tw + px * 2, th + py * 2
    pill_x = (w - pw) // 2
    pill_y = h - ph - int(h * 0.08)

    # Draw gradient pill (horizontal pink → orange)
    pill_img = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    pill_draw = ImageDraw.Draw(pill_img)
    pill_draw.rounded_rectangle(
        [0, 0, pw - 1, ph - 1], radius=ph // 2, fill=(255, 255, 255, 255),
    )
    pill_mask = pill_img.split()[3]
    # Create gradient colors
    grad_pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    for x in range(pw):
        t = x / max(pw - 1, 1)
        r = int(accent_pink[0] + (accent_orange[0] - accent_pink[0]) * t)
        g = int(accent_pink[1] + (accent_orange[1] - accent_pink[1]) * t)
        b = int(accent_pink[2] + (accent_orange[2] - accent_pink[2]) * t)
        for y in range(ph):
            if pill_mask.getpixel((x, y)) > 128:
                grad_pill.putpixel((x, y), (r, g, b, 230))
    result.paste(grad_pill, (pill_x, pill_y), grad_pill)

    # CTA text
    draw = ImageDraw.Draw(result)
    draw.text(
        (pill_x + (pw - tw) // 2, pill_y + (ph - th) // 2),
        cta, fill=(255, 255, 255, 255), font=cta_font,
    )

    # Tagline above CTA
    tagline = "EXCLUSIVE CONTENT"
    tag_font = _find_font(max(8, int(h * 0.04)))
    tag_bbox = draw.textbbox((0, 0), tagline, font=tag_font)
    tag_tw = tag_bbox[2] - tag_bbox[0]
    tag_x = (w - tag_tw) // 2
    tag_y = pill_y - int(h * 0.06)
    draw.text((tag_x, tag_y), tagline, fill=(255, 255, 255, 180), font=tag_font)

    # 3px pink border
    for rect in [
        [0, 0, w - 1, 2], [0, h - 3, w - 1, h - 1],
        [0, 0, 2, h - 1], [w - 3, 0, w - 1, h - 1],
    ]:
        draw.rectangle(rect, fill=(*accent_pink, 255))

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
            final = enhanced
            final.save(dest_path, "JPEG", quality=quality)
            return True

    except Exception:
        logger.error("Failed to generate banner %dx%d from %s", width, height, src_path, exc_info=True)
        return False


def extract_frames(
    video_path: str,
    output_dir: str,
    video_id: str,
    duration_sec: int,
    *,
    num_frames: int = 4,
    quality: int = 92,
) -> List[Tuple[str, int]]:
    """Extract evenly-spaced frames from a video file.

    Skips first/last 10% of duration to avoid intros/outros.
    Returns list of (local_path, timestamp_ms) for successfully extracted frames.
    """
    if duration_sec < 3:
        timestamps = [duration_sec // 2]
    elif duration_sec < 6:
        timestamps = [int(duration_sec * 0.25), int(duration_sec * 0.75)]
    else:
        n = max(1, num_frames)
        timestamps = [
            int(duration_sec * (0.1 + 0.8 * i / max(n - 1, 1)))
            for i in range(n)
        ]

    frames: List[Tuple[str, int]] = []
    for i, ts_sec in enumerate(timestamps):
        frame_path = os.path.join(output_dir, f"{video_id}_frame_{i}.jpg")
        try:
            (
                ffmpeg
                .input(video_path, ss=ts_sec)
                .output(frame_path, vframes=1, format="image2", **{"q:v": 2})
                .overwrite_output()
                .run(quiet=True)
            )
            if os.path.isfile(frame_path) and os.path.getsize(frame_path) > 0:
                frames.append((frame_path, ts_sec * 1000))
        except ffmpeg.Error:
            logger.warning("Failed to extract frame %d at %ds from %s", i, ts_sec, video_path)

    logger.debug("Extracted %d/%d frames from %s", len(frames), len(timestamps), video_id)
    return frames
