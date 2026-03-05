"""Banner generation worker.

Polls banner_queue, downloads thumbnails, generates banners
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


async def _download_thumbnail(url: str, dest_path: str) -> bool:
    """Download a thumbnail image to a local path."""
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
        logger.warning("Failed to download thumbnail %s", url, exc_info=True)
        return False


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

            if not thumb_url:
                logger.warning("Video %d has no thumbnail, skipping", vid_id)
                continue

            # Download thumbnail to temp file.
            with tempfile.TemporaryDirectory() as tmp_dir:
                src_path = os.path.join(tmp_dir, "thumb.jpg")
                ok = await _download_thumbnail(thumb_url, src_path)
                if not ok:
                    continue

                # Generate banners for each size.
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
                            s3.upload_banner,
                            banner_path,
                            account_id,
                            vid_id,
                            w,
                            h,
                        )
                    except Exception:
                        logger.error("Failed to upload banner for video %d size %dx%d", vid_id, w, h, exc_info=True)
                        continue

                    # Record in DB.
                    await db.insert_banner(account_id, vid_id, size_id, image_url, w, h)
                    generated += 1
                    logger.debug("Banner generated: video=%d size=%dx%d url=%s", vid_id, w, h, image_url)

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
