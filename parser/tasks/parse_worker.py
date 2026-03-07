from __future__ import annotations

import asyncio
import logging
import shutil
import signal
import traceback
from datetime import datetime, timezone
from typing import Optional

from parser.config.settings import settings
from parser.parsers import get_parser
from parser.parsers.base import BaseParser, ParsedVideo
from parser.storage import db
from parser.storage import s3

logger = logging.getLogger(__name__)


def _get_parser(platform: str) -> BaseParser:
    return get_parser(platform)


async def _upload_avatar_to_r2(
    avatar_url: str,
    platform: str,
    username: str,
) -> Optional[str]:
    """Download an avatar image from a URL and upload it to R2.

    Returns the R2 public URL, or None on failure.
    """
    import tempfile

    import httpx

    loop = asyncio.get_running_loop()

    # Download to a temp file.
    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = tmp.name

        def _download() -> bool:
            with httpx.Client(timeout=20, follow_redirects=True) as client:
                resp = client.get(avatar_url)
                resp.raise_for_status()
                with open(tmp_path, "wb") as fh:
                    fh.write(resp.content)
            return True

        ok = await loop.run_in_executor(None, _download)
        if not ok:
            return None

        r2_url = await loop.run_in_executor(
            None, s3.upload_avatar, tmp_path, platform, username,
        )
        logger.info("Avatar uploaded to R2 for @%s: %s", username, r2_url)
        return r2_url
    finally:
        if tmp_path:
            import os
            try:
                os.remove(tmp_path)
            except OSError:
                pass


async def _upload_and_save(
    parsed: ParsedVideo,
    *,
    account_id: int,
    platform: str,
) -> Optional[int]:
    """Upload media to S3 and insert the video row.  Returns video DB id."""
    loop = asyncio.get_running_loop()

    # Upload small thumbnail.
    thumb_sm_url: Optional[str] = None
    if parsed.thumbnail_sm_path:
        try:
            thumb_sm_url = await loop.run_in_executor(
                None,
                s3.upload_thumbnail,
                parsed.thumbnail_sm_path,
                platform,
                parsed.platform_id + "_sm",
            )
        except Exception:
            logger.warning("S3 thumbnail_sm upload failed for %s", parsed.platform_id, exc_info=True)

    # Upload large thumbnail.
    thumb_lg_url: Optional[str] = None
    if parsed.thumbnail_lg_path:
        try:
            thumb_lg_url = await loop.run_in_executor(
                None,
                s3.upload_thumbnail,
                parsed.thumbnail_lg_path,
                platform,
                parsed.platform_id + "_lg",
            )
        except Exception:
            logger.warning("S3 thumbnail_lg upload failed for %s", parsed.platform_id, exc_info=True)

    # Upload preview clip.
    preview_url: Optional[str] = None
    if parsed.preview_path:
        try:
            preview_url = await loop.run_in_executor(
                None,
                s3.upload_preview,
                parsed.preview_path,
                platform,
                parsed.platform_id,
            )
        except Exception:
            logger.warning("S3 preview upload failed for %s", parsed.platform_id, exc_info=True)

    # Persist to DB.
    video_id = await db.insert_video(
        account_id=account_id,
        platform=platform,
        platform_id=parsed.platform_id,
        original_url=parsed.original_url,
        title=parsed.title,
        description=parsed.description,
        duration_sec=parsed.duration_sec,
        thumbnail_url=thumb_sm_url,
        thumbnail_lg_url=thumb_lg_url,
        preview_url=preview_url,
        width=parsed.width,
        height=parsed.height,
        published_at=parsed.published_at,
        media_type=parsed.media_type,
    )

    # Upload extracted frames to R2 and store in DB.
    for i, (frame_path, ts_ms) in enumerate(parsed.frame_paths):
        try:
            frame_url = await loop.run_in_executor(
                None,
                s3.upload_frame,
                frame_path,
                platform,
                parsed.platform_id,
                i,
            )
            await db.insert_video_frame(video_id, i, ts_ms, frame_url)
        except Exception:
            logger.warning("Failed to upload/store frame %d for %s", i, parsed.platform_id, exc_info=True)

    # Link the video to all active sites so it appears on the storefront.
    await db.link_video_to_sites(video_id)

    return video_id


async def run_parse_for_account(
    platform: str,
    username: str,
    account_id: int,
    max_videos: Optional[int] = None,
) -> int:
    """Parse a single account end-to-end.

    Args:
        max_videos: Per-account video limit. None = use global default.

    Returns the number of *new* videos saved.
    """
    parser = _get_parser(platform)

    # Refresh account metadata (including avatar upload to R2).
    try:
        info = await parser.get_account_info(username)
        if info:
            avatar_url = info.get("avatar_url")

            # If avatar is an external URL, download and re-upload to R2.
            if avatar_url and avatar_url.startswith("http"):
                try:
                    r2_url = await _upload_avatar_to_r2(
                        avatar_url, platform, username,
                    )
                    if r2_url:
                        avatar_url = r2_url
                except Exception:
                    logger.warning("Avatar R2 upload failed for @%s", username, exc_info=True)

            await db.update_account_info(
                account_id,
                platform_id=info.get("platform_id"),
                display_name=info.get("display_name"),
                avatar_url=avatar_url,
                follower_count=info.get("follower_count"),
                bio=info.get("bio"),
            )
    except Exception:
        logger.warning("Could not update account info for @%s", username, exc_info=True)

    # Run the actual parse.
    parsed_videos = await parser.parse_account(username, max_videos=max_videos)

    saved = 0
    for pv in parsed_videos:
        # Skip duplicates.
        exists = await db.video_exists(platform, pv.platform_id)
        if exists:
            logger.debug("Skipping existing video %s", pv.platform_id)
            # Still clean up temp files.
            _cleanup_parsed_video(pv)
            continue

        try:
            vid = await _upload_and_save(pv, account_id=account_id, platform=platform)
            if vid is not None:
                saved += 1
                logger.info("Saved video id=%d  platform_id=%s", vid, pv.platform_id)
        except Exception:
            logger.error("Failed to save video %s", pv.platform_id, exc_info=True)
        finally:
            _cleanup_parsed_video(pv)

    # Clean the temp directory created by the parser.
    # The parser creates a per-account temp dir; individual files are
    # already removed above but the dir itself may linger.

    return saved


def _cleanup_parsed_video(pv: ParsedVideo) -> None:
    """Remove local temp files for a single parsed video."""
    import os

    for path in (pv.thumbnail_sm_path, pv.thumbnail_lg_path, pv.preview_path):
        if path and os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass
    for frame_path, _ in pv.frame_paths:
        if frame_path and os.path.isfile(frame_path):
            try:
                os.remove(frame_path)
            except OSError:
                pass


def _resolve_max_videos(job) -> Optional[int]:
    """Determine max_videos based on account override, first-parse vs reparse."""
    # Per-account override takes priority.
    account_max = job.get("max_videos")
    if account_max is not None and account_max > 0:
        return account_max

    # First parse (never parsed) → initial limit; subsequent → reparse limit.
    last_parsed = job.get("last_parsed_at")
    if last_parsed is None:
        return settings.initial_max_videos
    return settings.reparse_max_videos


async def _process_job(job) -> None:
    """Handle one parse_queue job from pick to finish."""
    job_id: int = job["id"]
    account_id: int = job["account_id"]
    username: str = job["username"]
    platform: str = job["platform"]
    max_videos: Optional[int] = _resolve_max_videos(job)

    logger.info("Processing job %d: @%s [%s] max_videos=%s", job_id, username, platform, max_videos)

    try:
        count = await run_parse_for_account(platform, username, account_id, max_videos=max_videos)
        await db.finish_job(job_id, videos_found=count)
        await db.update_account_parsed(account_id, reset_errors=True)
        logger.info("Job %d done: %d new videos for @%s", job_id, count, username)

        # Auto-enqueue banner generation for paid accounts with new videos.
        if count > 0 and job.get("is_paid"):
            try:
                await db.enqueue_banner_generation(account_id)
                logger.info("Enqueued banner generation for paid account @%s", username)
            except Exception:
                logger.warning("Failed to enqueue banner generation for @%s", username, exc_info=True)

    except Exception as exc:
        tb = traceback.format_exc()
        error_msg = f"{type(exc).__name__}: {exc}"
        logger.error("Job %d failed: %s\n%s", job_id, error_msg, tb)

        await db.fail_job(job_id, error=error_msg)
        errors = await db.increment_parse_errors(account_id)

        if errors >= settings.max_parse_errors:
            logger.warning(
                "Account @%s reached %d errors — deactivating",
                username, errors,
            )
            await db.deactivate_account(account_id)


async def worker_loop() -> None:
    """Main worker loop.  Polls parse_queue, processes jobs, sleeps."""
    logger.info(
        "Worker started  interval=%ds  max_errors=%d",
        settings.parse_interval_sec,
        settings.max_parse_errors,
    )

    stop = asyncio.Event()

    def _handle_signal() -> None:
        logger.info("Received shutdown signal")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    try:
        while not stop.is_set():
            job = await db.pick_pending_job()
            if job is None:
                # Auto-enqueue stale accounts before sleeping.
                if settings.reparse_interval_hours > 0:
                    await db.enqueue_stale_accounts(settings.reparse_interval_hours)

                # Nothing to do -- wait before polling again.
                try:
                    await asyncio.wait_for(stop.wait(), timeout=settings.parse_interval_sec)
                except asyncio.TimeoutError:
                    pass
                continue

            await _process_job(job)

    finally:
        await db.close_pool()
        logger.info("Worker stopped")
