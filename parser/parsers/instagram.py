from __future__ import annotations

import asyncio
import logging
import os
import random
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Dict, List, Optional, Union

import ffmpeg
import httpx
from PIL import Image

from parser.config.settings import settings
from parser.parsers.base import BaseParser, ParsedVideo, clean_bio, should_skip_video

try:
    from apify_client import ApifyClient
except ImportError:
    ApifyClient = None  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)

_POST_URL = "https://www.instagram.com/p/{shortcode}/"


# ─── Shared helpers ───────────────────────────────────────────────

def _download_thumbnail(thumb_url: str, dest_path: str) -> bool:
    """Download a thumbnail image via plain HTTP."""
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
    """Generate small and large thumbnails from a source image.

    Returns (sm_ok, lg_ok).  Never upscales beyond the source resolution.
    """
    try:
        with Image.open(src_path) as img:
            img = img.convert("RGB")

            if is_portrait:
                sm_w, sm_h = settings.thumbnail_sm_width, settings.thumbnail_sm_height
                lg_w, lg_h = settings.thumbnail_lg_width, settings.thumbnail_lg_height
            else:
                sm_w, sm_h = settings.thumbnail_sm_landscape_width, settings.thumbnail_sm_landscape_height
                lg_w, lg_h = settings.thumbnail_lg_landscape_width, settings.thumbnail_lg_landscape_height

            target_ratio = sm_w / sm_h  # same ratio for both sm and lg
            cropped = _crop_to_ratio(img, target_ratio)

            # Large thumbnail
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

            # Small thumbnail
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
                an=None,
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


def _parse_timestamp(ts: Union[int, float, None]) -> Optional[datetime]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (OSError, ValueError):
        return None


# ─── Proxy rotation ──────────────────────────────────────────────

def _get_proxies() -> List[str]:
    """Return a list of proxy URLs from settings (comma-separated)."""
    raw = settings.instagram_proxies
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def _pick_proxy() -> Optional[str]:
    """Choose a random proxy from the configured list (or None)."""
    proxies = _get_proxies()
    if not proxies:
        return None
    return random.choice(proxies)


# ─── Video download helper ───────────────────────────────────────

def _download_video(video_url: str, dest_path: str) -> bool:
    """Download a video file from a direct CDN URL."""
    try:
        proxy = _pick_proxy()
        kwargs: dict = {"timeout": 60, "follow_redirects": True}
        if proxy:
            kwargs["proxy"] = proxy
        with httpx.Client(**kwargs) as client:
            with client.stream("GET", video_url) as resp:
                resp.raise_for_status()
                with open(dest_path, "wb") as fh:
                    for chunk in resp.iter_bytes(chunk_size=65536):
                        fh.write(chunk)
        return os.path.isfile(dest_path) and os.path.getsize(dest_path) > 0
    except Exception:
        logger.warning("Failed to download video from %s", video_url, exc_info=True)
        return False


# ─── Apify actor integration ─────────────────────────────────────

def _apify_get_user_videos(username: str, max_videos: int = 0) -> List[Dict]:
    """Run apify/instagram-scraper to fetch recent video posts.

    This is a synchronous blocking call — run via ``run_in_executor``.
    Returns a list of dicts with keys: id, shortcode, video_url,
    thumbnail_src, caption, taken_at_timestamp, dimensions, duration.
    """
    if ApifyClient is None:
        raise RuntimeError("apify-client is not installed")

    token = settings.apify_token
    if not token:
        raise RuntimeError("APIFY_TOKEN is not set")

    effective_limit = max_videos or settings.apify_instagram_results_limit
    client = ApifyClient(token)

    run_input = {
        "directUrls": [f"https://www.instagram.com/{username}/"],
        "resultsType": "posts",
        "resultsLimit": effective_limit,
        "searchType": "user",
        "searchLimit": 1,
    }

    logger.info(
        "Starting Apify actor %s for @%s (limit=%d)",
        settings.apify_instagram_actor, username, effective_limit,
    )

    run = client.actor(settings.apify_instagram_actor).call(
        run_input=run_input,
        timeout_secs=settings.apify_run_timeout_sec,
        memory_mbytes=settings.apify_run_memory_mbytes,
    )

    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        logger.warning("Apify run returned no dataset for @%s", username)
        return []

    run_status = run.get("status")
    if run_status not in ("SUCCEEDED", None):
        logger.warning(
            "Apify run for @%s finished with status: %s", username, run_status,
        )

    items = list(client.dataset(dataset_id).iterate_items())
    logger.info("Apify returned %d item(s) for @%s", len(items), username)

    if not items:
        logger.warning(
            "Apify dataset for @%s is empty — profile may be private/restricted "
            "or the Apify actor encountered an issue.",
            username,
        )

    videos: List[Dict] = []
    for item in items:
        # Only keep video posts (Reels, IGTV, video posts).
        item_type = (item.get("type") or "").lower()
        if item_type not in ("video", "reel"):
            # Also check for videoUrl presence as a fallback indicator.
            if not item.get("videoUrl"):
                continue

        # Parse timestamp: Apify returns ISO 8601 string in "timestamp" field.
        taken_at: Optional[Union[int, float]] = None
        ts_raw = item.get("timestamp")
        if ts_raw:
            try:
                dt = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
                taken_at = dt.timestamp()
            except (ValueError, TypeError):
                pass

        shortcode = item.get("shortCode") or item.get("id") or ""
        post_id = item.get("id") or shortcode
        dims = item.get("dimensions") or {}

        videos.append({
            "id": str(post_id),
            "shortcode": shortcode,
            "video_url": item.get("videoUrl"),
            "thumbnail_src": (
                item.get("displayUrl")
                or item.get("previewUrl")
                or (item.get("images") or [None])[0]
            ),
            "caption": item.get("caption"),
            "taken_at_timestamp": taken_at,
            "dimensions": {
                "width": dims.get("width") or item.get("dimensionsWidth"),
                "height": dims.get("height") or item.get("dimensionsHeight"),
            },
            "duration": item.get("videoDuration"),
        })

    logger.info("Apify: %d video(s) after filtering for @%s", len(videos), username)
    return videos


# ─── Profile info via Apify ───────────────────────────────────────

def _apify_get_profile_info(username: str) -> Optional[Dict]:
    """Fetch Instagram profile details (avatar, bio, followers) via Apify.

    This is a synchronous blocking call — run via ``run_in_executor``.
    """
    if ApifyClient is None:
        return None

    token = settings.apify_token
    if not token:
        return None

    client = ApifyClient(token)

    run_input = {
        "directUrls": [f"https://www.instagram.com/{username}/"],
        "resultsType": "details",
        "resultsLimit": 1,
        "searchType": "user",
        "searchLimit": 1,
    }

    logger.info("Fetching profile info for @%s via Apify", username)

    run = client.actor(settings.apify_instagram_actor).call(
        run_input=run_input,
        timeout_secs=120,
        memory_mbytes=settings.apify_run_memory_mbytes,
    )

    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        return None

    items = list(client.dataset(dataset_id).iterate_items())
    if not items:
        return None

    profile = items[0]
    avatar_url = (
        profile.get("profilePicUrlHD")
        or profile.get("profilePicUrl")
    )
    display_name = profile.get("fullName") or username
    bio = clean_bio(profile.get("biography") or "")
    follower_count = profile.get("followersCount")

    logger.info(
        "Profile @%s: display_name=%s followers=%s bio_len=%d avatar=%s",
        username, display_name, follower_count,
        len(bio) if bio else 0,
        bool(avatar_url),
    )

    return {
        "platform_id": username,
        "display_name": display_name,
        "avatar_url": avatar_url,
        "follower_count": follower_count,
        "bio": bio,
    }


# ─── Parser class ────────────────────────────────────────────────

class InstagramParser(BaseParser):
    """Scrapes Instagram video/reel posts via Apify actor.

    Requires APIFY_TOKEN to be set and apify-client to be installed.
    """

    @property
    def platform(self) -> str:
        return "instagram"

    # ── Account info ─────────────────────────────────────────────

    async def get_account_info(self, username: str) -> dict:
        """Fetch profile metadata (avatar, bio, followers) via Apify details scrape."""
        loop = asyncio.get_running_loop()
        try:
            info = await loop.run_in_executor(None, _apify_get_profile_info, username)
            if info:
                return info
        except Exception:
            logger.warning("Apify profile fetch failed for @%s, using fallback", username, exc_info=True)

        return {
            "platform_id": username,
            "display_name": username,
            "avatar_url": None,
            "follower_count": None,
            "bio": None,
        }

    # ── Main parse ───────────────────────────────────────────────

    async def parse_account(
        self, username: str, *, max_videos: Optional[int] = None,
    ) -> List[ParsedVideo]:
        tmp_dir = tempfile.mkdtemp(prefix=f"ig_{username}_")
        logger.info("Parsing Instagram @%s  tmp=%s  max_videos=%s", username, tmp_dir, max_videos)

        try:
            return await self._do_parse(username, tmp_dir, max_videos=max_videos)
        except Exception:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise

    async def _do_parse(
        self, username: str, tmp_dir: str, *, max_videos: Optional[int] = None,
    ) -> List[ParsedVideo]:
        loop = asyncio.get_running_loop()

        if not settings.apify_token:
            raise RuntimeError(
                "APIFY_TOKEN is not configured. "
                "Set APIFY_TOKEN in .env to enable Instagram parsing via Apify."
            )
        if ApifyClient is None:
            raise RuntimeError(
                "apify-client package is not installed. "
                "Run: pip install apify-client"
            )

        apify_videos = await loop.run_in_executor(
            None, _apify_get_user_videos, username, max_videos or 0,
        )
        logger.info(
            "Instagram @%s: Apify returned %d video(s)", username, len(apify_videos),
        )

        if not apify_videos:
            raise RuntimeError(
                f"No videos found for @{username}. "
                "Profile may be private, restricted, or contain no video posts."
            )

        return await self._process_entries(
            apify_videos, tmp_dir, loop, username,
        )

    # ── Entry processing ─────────────────────────────────────────

    async def _process_entries(
        self,
        videos: List[Dict],
        tmp_dir: str,
        loop: asyncio.AbstractEventLoop,
        username: str,
    ) -> List[ParsedVideo]:
        parsed: List[ParsedVideo] = []
        for vid in videos:
            shortcode = vid.get("shortcode")
            video_id = vid.get("id") or shortcode
            if not video_id:
                continue

            try:
                pv = await self._process_entry(vid, tmp_dir, loop, username)
                if pv is not None:
                    parsed.append(pv)
            except Exception:
                logger.warning("Failed to process IG entry %s", video_id, exc_info=True)
                continue

            # Rate-limit pause.
            await asyncio.sleep(settings.instagram_rate_limit_sec)

        logger.info("Instagram: produced %d parsed videos", len(parsed))
        return parsed

    async def _process_entry(
        self,
        vid: dict,
        tmp_dir: str,
        loop: asyncio.AbstractEventLoop,
        username: str,
    ) -> Optional[ParsedVideo]:
        video_id: str = vid.get("id") or vid["shortcode"]
        shortcode: str = vid.get("shortcode", video_id)
        original_url = _POST_URL.format(shortcode=shortcode)
        video_url: Optional[str] = vid.get("video_url")
        thumb_source_url: Optional[str] = vid.get("thumbnail_src")
        dims = vid.get("dimensions", {})

        # Detect orientation from source dimensions
        src_width = dims.get("width") or 0
        src_height = dims.get("height") or 0
        is_portrait = src_height > src_width and src_width > 0

        # ── Filter ────────────────────────────────────────────────
        raw_duration = vid.get("duration")
        duration_sec_val: Optional[int] = int(raw_duration) if raw_duration and raw_duration > 0 else None
        if should_skip_video(
            width=dims.get("width"),
            height=dims.get("height"),
            duration_sec=duration_sec_val,
            platform_id=video_id,
        ):
            return None

        # ── Thumbnail ────────────────────────────────────────────
        thumb_raw = os.path.join(tmp_dir, f"{video_id}_thumb_raw.jpg")
        thumb_sm = os.path.join(tmp_dir, f"{video_id}_thumb_sm.jpg")
        thumb_lg = os.path.join(tmp_dir, f"{video_id}_thumb_lg.jpg")
        sm_ok = lg_ok = False

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

        # ── Preview clip ─────────────────────────────────────────
        preview_path: Optional[str] = None

        if video_url:
            video_local = os.path.join(tmp_dir, f"{video_id}.mp4")
            downloaded_vid = await loop.run_in_executor(
                None, _download_video, video_url, video_local,
            )

            if downloaded_vid:
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

                try:
                    os.remove(video_local)
                except OSError:
                    pass

        # ── Timestamps ───────────────────────────────────────────
        published_at = _parse_timestamp(vid.get("taken_at_timestamp"))

        # ── Duration ─────────────────────────────────────────────
        duration = vid.get("duration")
        duration_sec: Optional[int] = int(duration) if duration and duration > 0 else None

        # ── Caption as title ─────────────────────────────────────
        caption = vid.get("caption")
        title = caption[:120] if caption else None

        return ParsedVideo(
            platform_id=video_id,
            original_url=original_url,
            title=title,
            description=caption,
            duration_sec=duration_sec,
            width=dims.get("width"),
            height=dims.get("height"),
            published_at=published_at,
            thumbnail_sm_path=thumb_sm if sm_ok else None,
            thumbnail_lg_path=thumb_lg if lg_ok else None,
            preview_path=preview_path,
            thumbnail_source_url=thumb_source_url,
            video_url=video_url,
        )
