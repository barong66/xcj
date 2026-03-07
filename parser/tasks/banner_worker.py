"""Banner generation worker.

Polls banner_queue, downloads thumbnails/frames, generates banners
in all active sizes, uploads to R2, and records in the banners table.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import tempfile
import traceback
from typing import Optional

import httpx

from parser.config.settings import settings
from parser.storage import db
from parser.storage import s3
from parser.utils.image import generate_banner

logger = logging.getLogger(__name__)


async def _download_image(url: str, dest_path: str) -> bool:
    """Download an image to a local path."""
    loop = asyncio.get_running_loop()

    def _do_download() -> bool:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            with open(dest_path, "wb") as fh:
                fh.write(resp.content)
        return True

    try:
        return await loop.run_in_executor(None, _do_download)
    except Exception:
        logger.warning("Failed to download image %s", url, exc_info=True)
        return False


async def _generate_banners_from_source(
    loop: asyncio.AbstractEventLoop,
    source_url: str,
    video_id: int,
    account_id: int,
    username: str,
    sizes: list,
    *,
    video_frame_id: Optional[int] = None,
) -> int:
    """Download a source image and generate banners for all sizes.

    Returns the count of successfully generated banners.
    """
    generated = 0
    with tempfile.TemporaryDirectory() as tmp_dir:
        src_path = os.path.join(tmp_dir, "source.jpg")
        ok = await _download_image(source_url, src_path)
        if not ok:
            return 0

        for size in sizes:
            size_id = size["id"]
            w = size["width"]
            h = size["height"]

            banner_path = os.path.join(tmp_dir, f"banner_{w}x{h}.jpg")

            # Generate the banner image (face-aware crop + overlay).
            success = await loop.run_in_executor(
                None,
                lambda sp=src_path, bp=banner_path, bw=w, bh=h, u=username: generate_banner(
                    sp, bp, bw, bh,
                    quality=settings.banner_quality,
                    username=u,
                ),
            )
            if not success:
                continue

            # Upload to R2.
            try:
                image_url = await loop.run_in_executor(
                    None,
                    lambda bp=banner_path, aid=account_id, vid=video_id, bw=w, bh=h, fid=video_frame_id: s3.upload_banner(
                        bp, aid, vid, bw, bh, frame_id=fid,
                    ),
                )
            except Exception:
                logger.error(
                    "Failed to upload banner for video %d frame=%s size %dx%d",
                    video_id, video_frame_id, w, h, exc_info=True,
                )
                continue

            # Record in DB.
            await db.insert_banner(
                account_id, video_id, size_id, image_url, w, h,
                video_frame_id=video_frame_id,
            )
            generated += 1
            logger.debug(
                "Banner generated: video=%d frame=%s size=%dx%d",
                video_id, video_frame_id, w, h,
            )

    return generated


async def _process_banner_job(job) -> None:
    """Handle one banner_queue job."""
    job_id: int = job["id"]
    account_id: int = job["account_id"]
    video_id: Optional[int] = job["video_id"]

    logger.info("Banner job %d: account_id=%d video_id=%s", job_id, account_id, video_id)

    try:
        # Get active banner sizes.
        sizes = await db.get_banner_sizes()
        if not sizes:
            logger.info("No active banner sizes configured, skipping job %d", job_id)
            await db.finish_banner_job(job_id)
            return

        # Get videos to generate banners for.
        videos = await db.get_videos_for_banners(account_id, video_id)
        if not videos:
            logger.info("No videos found for banner job %d", job_id)
            await db.finish_banner_job(job_id)
            return

        loop = asyncio.get_running_loop()
        generated = 0

        for video in videos:
            vid_id = video["id"]
            thumb_url = video["thumb_url"]
            username = video.get("username", "")

            # 1. Generate banner from thumbnail (video_frame_id=NULL).
            if thumb_url:
                generated += await _generate_banners_from_source(
                    loop, thumb_url, vid_id, account_id, username, sizes,
                    video_frame_id=None,
                )

            # 2. Generate banners from each extracted frame.
            frames = await db.get_video_frames(vid_id)
            for frame in frames:
                generated += await _generate_banners_from_source(
                    loop, frame["image_url"], vid_id, account_id, username, sizes,
                    video_frame_id=frame["id"],
                )

        await db.finish_banner_job(job_id)
        logger.info("Banner job %d done: %d banners generated", job_id, generated)

    except Exception as exc:
        tb = traceback.format_exc()
        error_msg = f"{type(exc).__name__}: {exc}"
        logger.error("Banner job %d failed: %s\n%s", job_id, error_msg, tb)
        await db.fail_banner_job(job_id, error=error_msg)


async def banner_worker_loop() -> None:
    """Background loop that processes banner_queue jobs."""
    logger.info("Banner worker started  interval=%ds", settings.banner_poll_interval_sec)

    stop = asyncio.Event()

    def _handle_signal() -> None:
        logger.info("Banner worker received shutdown signal")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            pass  # Windows

    try:
        while not stop.is_set():
            job = await db.pick_pending_banner_job()
            if job is None:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=settings.banner_poll_interval_sec)
                except asyncio.TimeoutError:
                    pass
                continue

            await _process_banner_job(job)

    finally:
        logger.info("Banner worker stopped")
