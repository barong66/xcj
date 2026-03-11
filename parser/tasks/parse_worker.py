from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
import tempfile
import traceback
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

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


async def _score_frames(
    frame_urls: List[str],
) -> Tuple[Dict[str, float], Optional[int]]:
    """Score frame URLs via NeuroScore.

    Returns (url_to_score_dict, best_frame_index) or ({}, fallback) on failure.
    When NeuroScore is not configured, defaults to first frame.
    """
    from parser.services.neuroscore import NeuroScoreClient

    client = NeuroScoreClient()
    if not client.is_configured:
        logger.debug("NeuroScore not configured, using first frame as thumbnail")
        return {}, 0 if frame_urls else None

    loop = asyncio.get_running_loop()
    try:
        scores = await loop.run_in_executor(None, client.score_urls, frame_urls)

        url_to_score = {fs.url: fs.score for fs in scores}

        if scores:
            best_url = scores[0].url  # already sorted desc
            try:
                best_idx = frame_urls.index(best_url)
            except ValueError:
                best_idx = 0
            return url_to_score, best_idx

        return url_to_score, 0  # fallback to first frame

    except Exception:
        logger.warning("NeuroScore scoring failed, falling back to first frame", exc_info=True)
        return {}, 0 if frame_urls else None


async def _generate_thumbnails_from_frame(
    frame_path: str,
    platform: str,
    platform_id: str,
    is_portrait: bool,
) -> Tuple[Optional[str], Optional[str]]:
    """Generate SM/LG thumbnails from a frame image and upload to R2.

    Returns (thumb_sm_url, thumb_lg_url).
    """
    from parser.utils.image import resize_thumbnails

    loop = asyncio.get_running_loop()

    with tempfile.TemporaryDirectory() as tmp_dir:
        sm_path = os.path.join(tmp_dir, f"{platform_id}_thumb_sm.jpg")
        lg_path = os.path.join(tmp_dir, f"{platform_id}_thumb_lg.jpg")

        sm_ok, lg_ok = await loop.run_in_executor(
            None,
            lambda: resize_thumbnails(
                frame_path, sm_path, lg_path, is_portrait=is_portrait,
            ),
        )

        thumb_sm_url: Optional[str] = None
        thumb_lg_url: Optional[str] = None

        if sm_ok:
            try:
                thumb_sm_url = await loop.run_in_executor(
                    None, s3.upload_thumbnail, sm_path, platform, platform_id + "_sm",
                )
            except Exception:
                logger.warning("S3 thumbnail_sm upload failed for %s", platform_id, exc_info=True)

        if lg_ok:
            try:
                thumb_lg_url = await loop.run_in_executor(
                    None, s3.upload_thumbnail, lg_path, platform, platform_id + "_lg",
                )
            except Exception:
                logger.warning("S3 thumbnail_lg upload failed for %s", platform_id, exc_info=True)

        return thumb_sm_url, thumb_lg_url


async def _upload_and_save(
    parsed: ParsedVideo,
    *,
    account_id: int,
    platform: str,
) -> Optional[int]:
    """Upload media to S3 and insert the video row.  Returns video DB id."""
    loop = asyncio.get_running_loop()

    # ── Step 1: Upload platform thumbnails as fallback ────────────
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

    # ── Step 2: Upload preview clip ───────────────────────────────
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

    # ── Step 3: Upload frames to R2 (need public URLs for scoring) ─
    frame_records: List[Tuple[int, int, str, str]] = []  # (index, ts_ms, r2_url, local_path)
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
            frame_records.append((i, ts_ms, frame_url, frame_path))
        except Exception:
            logger.warning("Failed to upload frame %d for %s", i, parsed.platform_id, exc_info=True)

    # ── Step 4: Score frames via NeuroScore ───────────────────────
    frame_scores: Dict[str, float] = {}
    best_frame_idx: Optional[int] = None

    if frame_records:
        frame_urls = [r[2] for r in frame_records]
        frame_scores, best_frame_idx = await _score_frames(frame_urls)

    # ── Step 5: Generate thumbnails from best frame ───────────────
    if best_frame_idx is not None and best_frame_idx < len(frame_records):
        best_local_path = frame_records[best_frame_idx][3]
        if os.path.isfile(best_local_path):
            src_w = parsed.width or 0
            src_h = parsed.height or 0
            is_portrait = src_h > src_w and src_w > 0

            frame_sm, frame_lg = await _generate_thumbnails_from_frame(
                best_local_path, platform, parsed.platform_id, is_portrait,
            )
            # Overwrite platform thumbnails with frame-based ones
            if frame_sm:
                thumb_sm_url = frame_sm
            if frame_lg:
                thumb_lg_url = frame_lg

            logger.info(
                "Using frame %d (score=%.3f) as thumbnail for %s",
                best_frame_idx,
                frame_scores.get(frame_records[best_frame_idx][2], 0.0),
                parsed.platform_id,
            )

    # ── Step 6: Insert video row ──────────────────────────────────
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

    # ── Step 7: Insert frame rows with scores ─────────────────────
    best_frame_url = frame_records[best_frame_idx][2] if best_frame_idx is not None and best_frame_idx < len(frame_records) else None
    for i, ts_ms, frame_url, _ in frame_records:
        score = frame_scores.get(frame_url)
        is_selected = (frame_url == best_frame_url) if best_frame_url else False
        try:
            await db.insert_video_frame(
                video_id, i, ts_ms, frame_url,
                score=score, is_selected=is_selected,
            )
        except Exception:
            logger.warning("Failed to store frame %d for %s", i, parsed.platform_id, exc_info=True)

    # ── Step 8: Link to sites ─────────────────────────────────────
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
