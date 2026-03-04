from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Dict, List, Optional, Union

import ffmpeg
import httpx
from PIL import Image
from yt_dlp import YoutubeDL

from parser.config.settings import settings
from parser.parsers.base import BaseParser, ParsedVideo, clean_bio, should_skip_video

logger = logging.getLogger(__name__)

# yt-dlp runs blocking I/O -- we push it to a thread pool.
_PROFILE_URL = "https://x.com/{username}"


def _build_ytdlp_opts(tmp_dir: str, *, max_videos: int) -> dict:
    """Build yt-dlp option dict. Works for both info extraction and download."""
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "extract_flat": False,
        "playlistend": max_videos,
        "outtmpl": os.path.join(tmp_dir, "%(id)s.%(ext)s"),
        # We only want entries that actually contain video.
        "match_filter": "duration > 0",
        # Prefer mp4 up to 720p to keep downloads small.
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
        "socket_timeout": 30,
        "retries": 3,
        "file_access_retries": 3,
    }
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file
    if settings.ytdlp_proxy:
        opts["proxy"] = settings.ytdlp_proxy
    if settings.ytdlp_rate_limit:
        opts["ratelimit"] = settings.ytdlp_rate_limit
    return opts


def _extract_info(username: str, tmp_dir: str, max_videos: int = 0) -> List[Dict]:
    """Run yt-dlp synchronously and return list of video info dicts."""
    url = _PROFILE_URL.format(username=username)
    effective = max_videos or settings.ytdlp_max_videos
    opts = _build_ytdlp_opts(tmp_dir, max_videos=effective)

    with YoutubeDL(opts) as ydl:
        result = ydl.extract_info(url, download=False)

    if result is None:
        return []

    # Profile pages come back as a playlist.
    entries = result.get("entries") or []
    # Flatten nested playlists (yt-dlp sometimes wraps in an extra layer).
    flat: List[Dict] = []
    for entry in entries:
        if entry is None:
            continue
        if "entries" in entry:
            flat.extend(e for e in entry["entries"] if e is not None)
        else:
            flat.append(entry)
    return flat


def _download_video(video_url: str, tmp_dir: str, video_id: str) -> Optional[str]:
    """Download a single video and return the local file path."""
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "outtmpl": os.path.join(tmp_dir, f"{video_id}.%(ext)s"),
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
        "socket_timeout": 30,
        "retries": 3,
    }
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file
    if settings.ytdlp_proxy:
        opts["proxy"] = settings.ytdlp_proxy
    if settings.ytdlp_rate_limit:
        opts["ratelimit"] = settings.ytdlp_rate_limit

    with YoutubeDL(opts) as ydl:
        result = ydl.extract_info(video_url, download=True)

    if result is None:
        return None

    # yt-dlp resolves the final filename after merging / remuxing.
    # Check common extensions.
    for ext in ("mp4", "webm", "mkv"):
        path = os.path.join(tmp_dir, f"{video_id}.{ext}")
        if os.path.isfile(path):
            return path

    # Fallback: look for any file whose name starts with the video id.
    for fname in os.listdir(tmp_dir):
        if fname.startswith(video_id) and not fname.endswith(".part"):
            return os.path.join(tmp_dir, fname)

    return None


def _download_thumbnail(thumb_url: str, dest_path: str) -> bool:
    """Download thumbnail image via plain HTTP."""
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            resp = client.get(thumb_url)
            resp.raise_for_status()
        with open(dest_path, "wb") as fh:
            fh.write(resp.content)
        return True
    except Exception:
        logger.warning("Failed to download thumbnail %s", thumb_url, exc_info=True)
        return False


def _crop_to_ratio(img: Image.Image, target_ratio: float) -> Image.Image:
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


def _resize_thumbnails(
    src_path: str,
    sm_path: str,
    lg_path: str,
    *,
    is_portrait: bool,
) -> tuple[bool, bool]:
    """Generate small and large thumbnails.  Returns (sm_ok, lg_ok)."""
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")

            if is_portrait:
                sm_w, sm_h = settings.thumbnail_sm_width, settings.thumbnail_sm_height
                lg_w, lg_h = settings.thumbnail_lg_width, settings.thumbnail_lg_height
            else:
                sm_w, sm_h = settings.thumbnail_sm_landscape_width, settings.thumbnail_sm_landscape_height
                lg_w, lg_h = settings.thumbnail_lg_landscape_width, settings.thumbnail_lg_landscape_height

            target_ratio = sm_w / sm_h
            cropped = _crop_to_ratio(img, target_ratio)

            lg_ok = False
            try:
                cur_w, cur_h = cropped.size
                if cur_w > lg_w or cur_h > lg_h:
                    lg_img = cropped.resize((lg_w, lg_h), Image.LANCZOS)
                else:
                    lg_img = cropped.copy()
                lg_img.save(lg_path, "JPEG", quality=settings.thumbnail_lg_quality)
                lg_ok = True
            except Exception:
                logger.warning("Failed to create lg thumbnail %s", src_path, exc_info=True)

            sm_ok = False
            try:
                cur_w, cur_h = cropped.size
                if cur_w > sm_w or cur_h > sm_h:
                    sm_img = cropped.resize((sm_w, sm_h), Image.LANCZOS)
                else:
                    sm_img = cropped.copy()
                sm_img.save(sm_path, "JPEG", quality=settings.thumbnail_sm_quality)
                sm_ok = True
            except Exception:
                logger.warning("Failed to create sm thumbnail %s", src_path, exc_info=True)

            return sm_ok, lg_ok
    except Exception:
        logger.warning("Failed to process thumbnail %s", src_path, exc_info=True)
        return False, False


def _generate_preview(
    video_path: str,
    output_path: str,
    *,
    duration: int,
    height: int,
    bitrate: str,
) -> bool:
    """Create a short, muted, low-bitrate preview clip using ffmpeg."""
    try:
        (
            ffmpeg
            .input(video_path, t=duration, ss=0)
            .output(
                output_path,
                vf=f"scale=-2:{height}",
                video_bitrate=bitrate,
                an=None,  # no audio
                movflags="+faststart",
                vcodec="libx264",
                preset="fast",
                format="mp4",
            )
            .overwrite_output()
            .run(quiet=True)
        )
        return os.path.isfile(output_path)
    except ffmpeg.Error:
        logger.warning("ffmpeg preview failed for %s", video_path, exc_info=True)
        return False


def _parse_upload_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse yt-dlp ``upload_date`` (``YYYYMMDD``) to aware datetime."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y%m%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _parse_timestamp(ts: Union[int, float, None]) -> Optional[datetime]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (OSError, ValueError):
        return None


class TwitterParser(BaseParser):
    """Scrapes Twitter/X video posts via yt-dlp."""

    @property
    def platform(self) -> str:
        return "twitter"

    async def get_account_info(self, username: str) -> dict:
        """Extract basic channel metadata.

        yt-dlp exposes uploader info in the playlist result when
        extracting a profile page.
        """
        def _extract() -> dict:
            url = _PROFILE_URL.format(username=username)
            opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": True,
                "playlistend": 1,
                "socket_timeout": 30,
            }
            if settings.ytdlp_cookies_file:
                opts["cookiefile"] = settings.ytdlp_cookies_file
            if settings.ytdlp_proxy:
                opts["proxy"] = settings.ytdlp_proxy

            with YoutubeDL(opts) as ydl:
                result = ydl.extract_info(url, download=False)

            if result is None:
                return {}

            return {
                "platform_id": result.get("uploader_id") or result.get("channel_id") or username,
                "display_name": result.get("uploader") or result.get("channel") or username,
                "avatar_url": result.get("thumbnails", [{}])[0].get("url") if result.get("thumbnails") else None,
                "follower_count": result.get("channel_follower_count"),
                "bio": clean_bio(result.get("description") or ""),
            }

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _extract)

    async def parse_account(
        self, username: str, *, max_videos: Optional[int] = None,
    ) -> List[ParsedVideo]:
        """Fetch recent videos for *username* and prepare media assets."""
        tmp_dir = tempfile.mkdtemp(prefix=f"traforama_{username}_")
        logger.info("Parsing @%s  tmp=%s  max_videos=%s", username, tmp_dir, max_videos)

        try:
            return await self._do_parse(username, tmp_dir, max_videos=max_videos)
        except Exception:
            # Clean up on unexpected failure.
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise

    async def _do_parse(
        self, username: str, tmp_dir: str, *, max_videos: Optional[int] = None,
    ) -> List[ParsedVideo]:
        loop = asyncio.get_running_loop()

        # Step 1 -- extract info for all videos (blocking, offloaded).
        entries = await loop.run_in_executor(
            None, _extract_info, username, tmp_dir, max_videos or 0,
        )
        logger.info("@%s: yt-dlp returned %d entries", username, len(entries))

        parsed: List[ParsedVideo] = []
        for entry in entries:
            video_id = entry.get("id")
            if not video_id:
                continue

            duration = entry.get("duration")
            if duration is None or duration <= 0:
                continue

            try:
                pv = await self._process_entry(entry, tmp_dir, loop)
                if pv is not None:
                    parsed.append(pv)
            except Exception:
                logger.warning("Failed to process entry %s", video_id, exc_info=True)
                continue

        logger.info("@%s: produced %d parsed videos", username, len(parsed))
        return parsed

    async def _process_entry(
        self,
        entry: dict,
        tmp_dir: str,
        loop: asyncio.AbstractEventLoop,
    ) -> Optional[ParsedVideo]:
        video_id: str = entry["id"]
        webpage_url: str = entry.get("webpage_url") or entry.get("url") or f"https://x.com/i/status/{video_id}"

        # ── Filter ───────────────────────────────────────────────
        duration = entry.get("duration")
        duration_sec = int(duration) if duration and duration > 0 else None
        if should_skip_video(
            width=entry.get("width"),
            height=entry.get("height"),
            duration_sec=duration_sec,
            platform_id=video_id,
        ):
            return None

        # ── Thumbnail ───────────────────────────────────────────
        thumb_source_url: Optional[str] = None
        thumbnails = entry.get("thumbnails") or []
        if thumbnails:
            # Pick the last one (usually highest resolution).
            thumb_source_url = thumbnails[-1].get("url")

        thumb_raw = os.path.join(tmp_dir, f"{video_id}_thumb_raw.jpg")
        thumb_sm = os.path.join(tmp_dir, f"{video_id}_thumb_sm.jpg")
        thumb_lg = os.path.join(tmp_dir, f"{video_id}_thumb_lg.jpg")
        sm_ok = lg_ok = False

        # Detect orientation from source dimensions
        src_width = entry.get("width") or 0
        src_height = entry.get("height") or 0
        is_portrait = src_height > src_width and src_width > 0

        if thumb_source_url:
            downloaded = await loop.run_in_executor(
                None, _download_thumbnail, thumb_source_url, thumb_raw,
            )
            if downloaded:
                sm_ok, lg_ok = await loop.run_in_executor(
                    None,
                    lambda: _resize_thumbnails(
                        thumb_raw, thumb_sm, thumb_lg, is_portrait=is_portrait,
                    ),
                )

        # ── Preview clip ────────────────────────────────────────
        preview_path: Optional[str] = None
        video_url = entry.get("url")  # direct video stream URL

        # We need to download the actual video to create a preview.
        video_local = await loop.run_in_executor(
            None, _download_video, webpage_url, tmp_dir, video_id,
        )

        if video_local and os.path.isfile(video_local):
            preview_dest = os.path.join(tmp_dir, f"{video_id}_preview.mp4")
            pv_height = settings.preview_portrait_height if is_portrait else settings.preview_height
            ok = await loop.run_in_executor(
                None,
                lambda: _generate_preview(
                    video_local,
                    preview_dest,
                    duration=settings.preview_duration_sec,
                    height=pv_height,
                    bitrate=settings.preview_video_bitrate,
                ),
            )
            if ok:
                preview_path = preview_dest

            # Remove the full video to save disk space.
            try:
                os.remove(video_local)
            except OSError:
                pass

        # ── Timestamps ──────────────────────────────────────────
        published_at = _parse_timestamp(entry.get("timestamp")) or _parse_upload_date(entry.get("upload_date"))

        # ── Build result ────────────────────────────────────────
        return ParsedVideo(
            platform_id=video_id,
            original_url=webpage_url,
            title=entry.get("title") or entry.get("fulltitle"),
            description=entry.get("description"),
            duration_sec=int(entry["duration"]) if entry.get("duration") else None,
            width=entry.get("width"),
            height=entry.get("height"),
            published_at=published_at,
            thumbnail_sm_path=thumb_sm if sm_ok else None,
            thumbnail_lg_path=thumb_lg if lg_ok else None,
            preview_path=preview_path,
            thumbnail_source_url=thumb_source_url,
            video_url=video_url,
        )
