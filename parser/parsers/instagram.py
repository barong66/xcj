from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import shutil
import tempfile
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Union

import ffmpeg
import httpx
from PIL import Image
from yt_dlp import YoutubeDL

from parser.config.settings import settings
from parser.parsers.base import BaseParser, ParsedVideo, should_skip_video

try:
    from apify_client import ApifyClient
except ImportError:
    ApifyClient = None  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)

_REELS_URL = "https://www.instagram.com/{username}/reels/"
_POST_URL = "https://www.instagram.com/p/{shortcode}/"
_PROFILE_API_URL = "https://www.instagram.com/api/v1/users/web_profile_info/"
_GRAPHQL_URL = "https://www.instagram.com/graphql/query/"

# Query hash for user media — Instagram's internal GraphQL endpoint.
_USER_MEDIA_QUERY_HASH = "69cba40317214236af40e7efa697781d"

_MOBILE_USER_AGENT = (
    "Instagram 275.0.0.27.98 Android "
    "(33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)"
)

_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.4.1 Mobile/15E148 Safari/604.1"
)

# Exponential back-off parameters for rate-limit retries.
_MAX_RETRIES = 3
_BASE_BACKOFF_SEC = 5


# ─── Shared helpers (mirror twitter.py) ──────────────────────────

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


def _parse_upload_date(date_str: Optional[str]) -> Optional[datetime]:
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


# ─── yt-dlp helpers (Instagram-specific) ─────────────────────────

def _build_ytdlp_opts(tmp_dir: str, *, max_videos: int) -> dict:
    """Build yt-dlp option dict tuned for Instagram."""
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "extract_flat": False,
        "playlistend": max_videos,
        "outtmpl": os.path.join(tmp_dir, "%(id)s.%(ext)s"),
        "match_filter": "duration > 0",
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
        "socket_timeout": 30,
        "retries": 3,
        "file_access_retries": 3,
    }
    # Prefer Instagram session cookie if available.
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file

    # Proxy: prefer Instagram-specific proxy, fall back to global yt-dlp proxy.
    proxy = _pick_proxy() or settings.ytdlp_proxy
    if proxy:
        opts["proxy"] = proxy

    if settings.ytdlp_rate_limit:
        opts["ratelimit"] = settings.ytdlp_rate_limit

    # Inject session ID as cookie header if configured.
    if settings.instagram_session_id:
        opts.setdefault("http_headers", {})
        opts["http_headers"]["Cookie"] = f"sessionid={settings.instagram_session_id}"

    return opts


def _ytdlp_extract_info(username: str, tmp_dir: str, max_videos: int = 0) -> List[Dict]:
    """Run yt-dlp synchronously to extract video info from Instagram reels page."""
    url = _REELS_URL.format(username=username)
    effective = max_videos or settings.ytdlp_max_videos
    opts = _build_ytdlp_opts(tmp_dir, max_videos=effective)

    with YoutubeDL(opts) as ydl:
        result = ydl.extract_info(url, download=False)

    if result is None:
        return []

    entries = result.get("entries") or []
    flat: List[Dict] = []
    for entry in entries:
        if entry is None:
            continue
        if "entries" in entry:
            flat.extend(e for e in entry["entries"] if e is not None)
        else:
            flat.append(entry)
    return flat


def _ytdlp_download_video(video_url: str, tmp_dir: str, video_id: str) -> Optional[str]:
    """Download a single Instagram video and return the local file path."""
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

    proxy = _pick_proxy() or settings.ytdlp_proxy
    if proxy:
        opts["proxy"] = proxy

    if settings.ytdlp_rate_limit:
        opts["ratelimit"] = settings.ytdlp_rate_limit

    if settings.instagram_session_id:
        opts.setdefault("http_headers", {})
        opts["http_headers"]["Cookie"] = f"sessionid={settings.instagram_session_id}"

    with YoutubeDL(opts) as ydl:
        result = ydl.extract_info(video_url, download=True)

    if result is None:
        return None

    for ext in ("mp4", "webm", "mkv"):
        path = os.path.join(tmp_dir, f"{video_id}.{ext}")
        if os.path.isfile(path):
            return path

    for fname in os.listdir(tmp_dir):
        if fname.startswith(video_id) and not fname.endswith(".part"):
            return os.path.join(tmp_dir, fname)

    return None


def _ytdlp_get_account_info(username: str) -> dict:
    """Extract basic Instagram profile metadata via yt-dlp."""
    url = _REELS_URL.format(username=username)
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "playlistend": 1,
        "socket_timeout": 30,
    }
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file

    proxy = _pick_proxy() or settings.ytdlp_proxy
    if proxy:
        opts["proxy"] = proxy

    if settings.instagram_session_id:
        opts.setdefault("http_headers", {})
        opts["http_headers"]["Cookie"] = f"sessionid={settings.instagram_session_id}"

    with YoutubeDL(opts) as ydl:
        result = ydl.extract_info(url, download=False)

    if result is None:
        return {}

    return {
        "platform_id": result.get("uploader_id") or result.get("channel_id") or username,
        "display_name": result.get("uploader") or result.get("channel") or username,
        "avatar_url": (
            result.get("thumbnails", [{}])[0].get("url")
            if result.get("thumbnails")
            else None
        ),
        "follower_count": result.get("channel_follower_count"),
    }


# ─── HTTP fallback scraper ───────────────────────────────────────

def _build_http_client() -> httpx.Client:
    """Create an httpx client with appropriate headers for Instagram."""
    proxy = _pick_proxy()
    kwargs: dict = {
        "timeout": 30,
        "follow_redirects": True,
        "headers": {
            "User-Agent": _BROWSER_USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "X-IG-App-ID": "936619743392459",  # Instagram web app ID
            "X-Requested-With": "XMLHttpRequest",
        },
    }
    if proxy:
        kwargs["proxy"] = proxy

    if settings.instagram_session_id:
        kwargs["headers"]["Cookie"] = f"sessionid={settings.instagram_session_id}"

    return httpx.Client(**kwargs)


def _http_get_profile_info(username: str) -> dict:
    """Fetch profile info via Instagram's web_profile_info API."""
    for attempt in range(_MAX_RETRIES):
        try:
            with _build_http_client() as client:
                resp = client.get(
                    _PROFILE_API_URL,
                    params={"username": username},
                )
                if resp.status_code == 429:
                    wait = _BASE_BACKOFF_SEC * (2 ** attempt) + random.uniform(0, 2)
                    logger.warning(
                        "Instagram rate limited (profile info), retry in %.1fs", wait,
                    )
                    time.sleep(wait)
                    continue

                if resp.status_code == 404:
                    logger.warning("Instagram user @%s not found", username)
                    return {}

                if resp.status_code in (401, 403):
                    logger.warning(
                        "Instagram login required for profile info @%s (status %d). "
                        "Consider setting INSTAGRAM_SESSION_ID in .env.",
                        username, resp.status_code,
                    )
                    return {}

                resp.raise_for_status()
                data = resp.json()

            user = data.get("data", {}).get("user", {})
            if not user:
                return {}

            return {
                "platform_id": str(user.get("id", "")),
                "display_name": user.get("full_name") or username,
                "avatar_url": user.get("profile_pic_url_hd") or user.get("profile_pic_url"),
                "follower_count": user.get("edge_followed_by", {}).get("count"),
            }

        except httpx.HTTPStatusError:
            logger.warning("HTTP error fetching Instagram profile @%s", username, exc_info=True)
        except Exception:
            logger.warning("Unexpected error fetching Instagram profile @%s", username, exc_info=True)

        if attempt < _MAX_RETRIES - 1:
            wait = _BASE_BACKOFF_SEC * (2 ** attempt)
            time.sleep(wait)

    return {}


def _http_get_user_videos(username: str, max_videos: int = 0) -> List[Dict]:
    """Fetch recent video posts via Instagram's GraphQL endpoint.

    Returns a list of simplified video dicts with keys:
    shortcode, video_url, thumbnail_src, caption, taken_at_timestamp,
    dimensions (dict with width/height), id, duration.
    """
    # Step 1: get user ID from web_profile_info.
    user_id: Optional[str] = None
    for attempt in range(_MAX_RETRIES):
        try:
            with _build_http_client() as client:
                resp = client.get(
                    _PROFILE_API_URL,
                    params={"username": username},
                )
                if resp.status_code == 429:
                    wait = _BASE_BACKOFF_SEC * (2 ** attempt) + random.uniform(0, 2)
                    logger.warning("Rate limited fetching user ID, retry in %.1fs", wait)
                    time.sleep(wait)
                    continue
                if resp.status_code in (401, 403):
                    logger.warning(
                        "Login required to fetch videos for @%s (status %d). "
                        "Consider setting INSTAGRAM_SESSION_ID in .env.",
                        username, resp.status_code,
                    )
                    return []
                resp.raise_for_status()
                data = resp.json()

            user = data.get("data", {}).get("user", {})
            user_id = str(user.get("id", ""))
            break
        except Exception:
            logger.warning("Error resolving Instagram user ID for @%s", username, exc_info=True)
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BASE_BACKOFF_SEC * (2 ** attempt))

    if not user_id:
        logger.error("Could not resolve Instagram user ID for @%s", username)
        return []

    # Rate-limit pause between requests.
    time.sleep(settings.instagram_rate_limit_sec)

    # Step 2: Fetch media edges via GraphQL.
    effective = max_videos or settings.ytdlp_max_videos
    variables = json.dumps({
        "id": user_id,
        "first": min(effective, 50),
    })

    videos: List[Dict] = []
    for attempt in range(_MAX_RETRIES):
        try:
            with _build_http_client() as client:
                resp = client.get(
                    _GRAPHQL_URL,
                    params={
                        "query_hash": _USER_MEDIA_QUERY_HASH,
                        "variables": variables,
                    },
                )
                if resp.status_code == 429:
                    wait = _BASE_BACKOFF_SEC * (2 ** attempt) + random.uniform(0, 2)
                    logger.warning("Rate limited on GraphQL, retry in %.1fs", wait)
                    time.sleep(wait)
                    continue
                if resp.status_code in (401, 403):
                    logger.warning(
                        "Login required for GraphQL media fetch @%s (status %d). "
                        "Consider setting INSTAGRAM_SESSION_ID in .env.",
                        username, resp.status_code,
                    )
                    return []
                resp.raise_for_status()
                gql_data = resp.json()

            edges = (
                gql_data
                .get("data", {})
                .get("user", {})
                .get("edge_owner_to_timeline_media", {})
                .get("edges", [])
            )

            for edge in edges:
                node = edge.get("node", {})
                if not node.get("is_video"):
                    continue

                caption_edges = node.get("edge_media_to_caption", {}).get("edges", [])
                caption_text = caption_edges[0]["node"]["text"] if caption_edges else None

                videos.append({
                    "id": str(node.get("id", "")),
                    "shortcode": node.get("shortcode", ""),
                    "video_url": node.get("video_url"),
                    "thumbnail_src": (
                        node.get("thumbnail_src")
                        or node.get("display_url")
                    ),
                    "caption": caption_text,
                    "taken_at_timestamp": node.get("taken_at_timestamp"),
                    "dimensions": node.get("dimensions", {}),
                    "duration": node.get("video_duration"),
                })
            break

        except Exception:
            logger.warning("Error fetching Instagram media for @%s", username, exc_info=True)
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BASE_BACKOFF_SEC * (2 ** attempt))

    return videos


def _http_download_video(video_url: str, dest_path: str) -> bool:
    """Download a video file from a direct Instagram CDN URL."""
    try:
        with _build_http_client() as client:
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
    Returns a list of dicts with the same shape as ``_http_get_user_videos``
    (id, shortcode, video_url, thumbnail_src, caption, taken_at_timestamp,
    dimensions, duration) so they can be processed by ``_process_http_entries``.
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


# ─── Parser class ────────────────────────────────────────────────

class InstagramParser(BaseParser):
    """Scrapes Instagram video/reel posts.

    Priority chain:
      1. Apify actor (if APIFY_TOKEN configured and apify-client installed)
      2. yt-dlp (handles auth, cookies, format selection)
      3. HTTP GraphQL scraping (last-resort fallback)
    """

    @property
    def platform(self) -> str:
        return "instagram"

    # ── Account info ─────────────────────────────────────────────

    async def get_account_info(self, username: str) -> dict:
        loop = asyncio.get_running_loop()

        # Try yt-dlp first.
        try:
            info = await loop.run_in_executor(None, _ytdlp_get_account_info, username)
            if info and info.get("platform_id"):
                return info
        except Exception:
            logger.debug("yt-dlp account info failed for @%s, trying HTTP", username)

        # Fallback to HTTP scraping.
        info = await loop.run_in_executor(None, _http_get_profile_info, username)
        return info

    # ── Main parse ───────────────────────────────────────────────

    async def parse_account(
        self, username: str, *, max_videos: Optional[int] = None,
    ) -> List[ParsedVideo]:
        tmp_dir = tempfile.mkdtemp(prefix=f"traforama_ig_{username}_")
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

        # ── 1. Try Apify first (if configured) ───────────────────
        if settings.apify_token and ApifyClient is not None:
            try:
                apify_videos = await loop.run_in_executor(
                    None, _apify_get_user_videos, username, max_videos or 0,
                )
                logger.info(
                    "Instagram @%s: Apify returned %d video(s)", username, len(apify_videos),
                )
                if apify_videos:
                    return await self._process_http_entries(
                        apify_videos, tmp_dir, loop, username,
                    )
            except Exception:
                logger.warning(
                    "Apify failed for Instagram @%s, falling back to yt-dlp",
                    username,
                    exc_info=True,
                )

        # ── 2. Try yt-dlp ────────────────────────────────────────
        entries: List[Dict] = []
        try:
            entries = await loop.run_in_executor(
                None, _ytdlp_extract_info, username, tmp_dir, max_videos or 0,
            )
            logger.info("Instagram @%s: yt-dlp returned %d entries", username, len(entries))
        except Exception:
            logger.warning(
                "yt-dlp extraction failed for Instagram @%s, falling back to HTTP",
                username,
                exc_info=True,
            )

        if entries:
            return await self._process_ytdlp_entries(entries, tmp_dir, loop)

        # ── 3. Fallback: HTTP scraping ───────────────────────────
        logger.info("Using HTTP fallback for Instagram @%s", username)
        videos = await loop.run_in_executor(
            None, _http_get_user_videos, username, max_videos or 0,
        )
        logger.info("Instagram @%s: HTTP returned %d video(s)", username, len(videos))

        if not videos:
            raise RuntimeError(
                f"No videos found for @{username}. "
                "Profile may be private, restricted, or contain no video posts. "
                "Consider setting INSTAGRAM_SESSION_ID in .env for authenticated access."
            )

        return await self._process_http_entries(videos, tmp_dir, loop, username)

    # ── yt-dlp entry processing ──────────────────────────────────

    async def _process_ytdlp_entries(
        self,
        entries: List[Dict],
        tmp_dir: str,
        loop: asyncio.AbstractEventLoop,
    ) -> List[ParsedVideo]:
        parsed: List[ParsedVideo] = []
        for entry in entries:
            video_id = entry.get("id")
            if not video_id:
                continue

            duration = entry.get("duration")
            if duration is None or duration <= 0:
                continue

            try:
                pv = await self._process_ytdlp_entry(entry, tmp_dir, loop)
                if pv is not None:
                    parsed.append(pv)
            except Exception:
                logger.warning("Failed to process IG entry %s", video_id, exc_info=True)
                continue

            # Rate-limit pause between videos.
            await asyncio.sleep(settings.instagram_rate_limit_sec)

        logger.info("Instagram yt-dlp: produced %d parsed videos", len(parsed))
        return parsed

    async def _process_ytdlp_entry(
        self,
        entry: dict,
        tmp_dir: str,
        loop: asyncio.AbstractEventLoop,
    ) -> Optional[ParsedVideo]:
        video_id: str = entry["id"]
        webpage_url: str = (
            entry.get("webpage_url")
            or entry.get("url")
            or f"https://www.instagram.com/reel/{video_id}/"
        )

        # ── Filter ────────────────────────────────────────────────
        duration = entry.get("duration")
        duration_sec = int(duration) if duration and duration > 0 else None
        if should_skip_video(
            width=entry.get("width"),
            height=entry.get("height"),
            duration_sec=duration_sec,
            platform_id=video_id,
        ):
            return None

        # ── Thumbnail ────────────────────────────────────────────
        thumb_source_url: Optional[str] = None
        thumbnails = entry.get("thumbnails") or []
        if thumbnails:
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

        # ── Preview clip ─────────────────────────────────────────
        preview_path: Optional[str] = None
        video_url = entry.get("url")

        video_local = await loop.run_in_executor(
            None, _ytdlp_download_video, webpage_url, tmp_dir, video_id,
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

            try:
                os.remove(video_local)
            except OSError:
                pass

        # ── Timestamps ───────────────────────────────────────────
        published_at = (
            _parse_timestamp(entry.get("timestamp"))
            or _parse_upload_date(entry.get("upload_date"))
        )

        # ── Build result ─────────────────────────────────────────
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

    # ── HTTP fallback entry processing ───────────────────────────

    async def _process_http_entries(
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
                pv = await self._process_http_entry(vid, tmp_dir, loop, username)
                if pv is not None:
                    parsed.append(pv)
            except Exception:
                logger.warning("Failed to process IG HTTP entry %s", video_id, exc_info=True)
                continue

            # Rate-limit pause.
            await asyncio.sleep(settings.instagram_rate_limit_sec)

        logger.info("Instagram HTTP: produced %d parsed videos", len(parsed))
        return parsed

    async def _process_http_entry(
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
                None, _http_download_video, video_url, video_local,
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
