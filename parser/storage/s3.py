from __future__ import annotations

import logging
import mimetypes
import os
import shutil
from functools import lru_cache

import boto3
from botocore.config import Config as BotoConfig

from parser.config.settings import settings

logger = logging.getLogger(__name__)


# ── Local storage (dev) ──────────────────────────────────────────

def _upload_file_local(local_path: str, key: str) -> str:
    """Copy file to local media dir and return its public URL."""
    dest = os.path.join(settings.local_media_dir, key)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(local_path, dest)
    logger.debug("Copied %s -> %s", local_path, dest)
    return f"{settings.local_media_url.rstrip('/')}/{key}"


# ── S3 / R2 ──────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _get_s3_client():
    """Lazy-init a shared boto3 S3 client."""
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=BotoConfig(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "adaptive"},
        ),
    )


def _content_type(path: str) -> str:
    ct, _ = mimetypes.guess_type(path)
    return ct or "application/octet-stream"


def _upload_file_s3(local_path: str, s3_key: str) -> str:
    """Upload to S3/R2 and return the public URL."""
    client = _get_s3_client()
    ct = _content_type(local_path)

    logger.debug("Uploading %s -> s3://%s/%s (%s)", local_path, settings.s3_bucket, s3_key, ct)

    client.upload_file(
        Filename=local_path,
        Bucket=settings.s3_bucket,
        Key=s3_key,
        ExtraArgs={
            "ContentType": ct,
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )

    if settings.s3_public_url:
        return f"{settings.s3_public_url.rstrip('/')}/{s3_key}"

    return f"{settings.s3_endpoint.rstrip('/')}/{settings.s3_bucket}/{s3_key}"


# ── Public API (auto-routes to local or S3) ───────────────────────

def upload_file(local_path: str, key: str) -> str:
    """Upload file and return its public URL. Uses local storage if LOCAL_MEDIA_DIR is set."""
    if settings.local_media_dir:
        return _upload_file_local(local_path, key)
    return _upload_file_s3(local_path, key)


def upload_thumbnail(local_path: str, platform: str, video_platform_id: str) -> str:
    """Upload a video thumbnail and return its public URL."""
    ext = os.path.splitext(local_path)[1] or ".jpg"
    s3_key = f"thumbnails/{platform}/{video_platform_id}{ext}"
    return upload_file(local_path, s3_key)


def upload_preview(local_path: str, platform: str, video_platform_id: str) -> str:
    """Upload a preview clip and return its public URL."""
    ext = os.path.splitext(local_path)[1] or ".mp4"
    s3_key = f"previews/{platform}/{video_platform_id}{ext}"
    return upload_file(local_path, s3_key)


def upload_avatar(local_path: str, platform: str, username: str) -> str:
    """Upload an account avatar and return its public URL."""
    ext = os.path.splitext(local_path)[1] or ".jpg"
    s3_key = f"avatars/{platform}/{username}{ext}"
    return upload_file(local_path, s3_key)


def upload_frame(local_path: str, platform: str, video_platform_id: str, frame_index: int) -> str:
    """Upload an extracted video frame and return its public URL."""
    ext = os.path.splitext(local_path)[1] or ".jpg"
    s3_key = f"frames/{platform}/{video_platform_id}_f{frame_index}{ext}"
    return upload_file(local_path, s3_key)


def upload_banner(
    local_path: str,
    account_id: int,
    video_id: int,
    width: int,
    height: int,
    frame_id: int | None = None,
) -> str:
    """Upload a banner image and return its public URL.

    Appends a cache-busting timestamp param so regenerated banners
    bypass CDN/browser cache (same S3 key, immutable headers).
    """
    import time
    if frame_id is not None:
        s3_key = f"banners/{account_id}/{video_id}_f{frame_id}_{width}x{height}.jpg"
    else:
        s3_key = f"banners/{account_id}/{video_id}_{width}x{height}.jpg"
    url = upload_file(local_path, s3_key)
    return f"{url}?v={int(time.time())}"
