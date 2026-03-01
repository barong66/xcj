from __future__ import annotations

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── PostgreSQL ───────────────────────────────────────────────
    database_url: str = "postgresql://traforama:traforama@localhost:5432/traforama"

    # ── S3 / Cloudflare R2 ───────────────────────────────────────
    s3_endpoint: str = "https://s3.amazonaws.com"
    s3_bucket: str = "traforama-media"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_region: str = "auto"
    s3_public_url: str = ""  # CDN / public base URL for uploaded files

    # ── Local media storage (dev) ─────────────────────────────────
    local_media_dir: str = ""   # e.g. "web/public/parsed" — empty = use S3
    local_media_url: str = "http://localhost:3000/parsed"  # URL base for local files

    # ── Worker ───────────────────────────────────────────────────
    parse_interval_sec: int = 30  # sleep between queue polls
    max_parse_errors: int = 5    # disable account after N consecutive errors

    # ── Media processing ─────────────────────────────────────────
    # Small thumbnails (feed / low bandwidth)
    thumbnail_sm_width: int = 360
    thumbnail_sm_height: int = 640
    thumbnail_sm_landscape_width: int = 640
    thumbnail_sm_landscape_height: int = 360
    thumbnail_sm_quality: int = 80
    # Large thumbnails (detail view / fullscreen)
    thumbnail_lg_width: int = 810
    thumbnail_lg_height: int = 1440
    thumbnail_lg_landscape_width: int = 1440
    thumbnail_lg_landscape_height: int = 810
    thumbnail_lg_quality: int = 92
    # Preview clip
    preview_duration_sec: int = 5
    preview_video_bitrate: str = "500k"
    preview_height: int = 480
    preview_portrait_height: int = 854

    # ── yt-dlp ───────────────────────────────────────────────────
    ytdlp_cookies_file: Optional[str] = None  # path to cookies.txt for auth
    ytdlp_proxy: Optional[str] = None
    ytdlp_rate_limit: Optional[str] = None    # e.g. "1M" for 1 MiB/s
    ytdlp_max_videos: int = 50             # max videos per account per parse

    # ── Instagram ─────────────────────────────────────────────────
    instagram_proxies: Optional[str] = None        # comma-separated proxy URLs for rotation
    instagram_rate_limit_sec: int = 5           # delay between requests (seconds)

    # ── Apify ──────────────────────────────────────────────────────
    apify_token: Optional[str] = None                          # enables Apify when set
    apify_instagram_actor: str = "apify/instagram-scraper"     # actor ID
    apify_instagram_results_limit: int = 50                    # max posts per run
    apify_run_timeout_sec: int = 300                           # actor run timeout
    apify_run_memory_mbytes: int = 2048                        # memory allocation

    # ── Video filters ──────────────────────────────────────────────
    min_video_duration_sec: int = 3          # skip videos shorter than N seconds
    max_video_duration_sec: int = 180        # skip videos longer than N seconds (0 = no limit)
    only_portrait: bool = False              # only keep vertical (9:16) videos
    min_video_height: int = 0                # minimum video height in px (0 = no limit)

    # ── Parse limits ──────────────────────────────────────────────
    initial_max_videos: int = 50             # first parse — fetch last N videos
    reparse_max_videos: int = 15             # subsequent parses — only check recent N

    # ── Auto-reparse ──────────────────────────────────────────────
    reparse_interval_hours: int = 24         # re-parse accounts every N hours (0 = disabled)

    # ── twscrape (Twitter search) ─────────────────────────────────
    twscrape_db_path: str = "twscrape_accounts.db"    # path to twscrape SQLite account pool
    twscrape_max_results: int = 100                     # max tweets to scan per search

    # ── Logging ──────────────────────────────────────────────────
    log_level: str = "INFO"


settings = Settings()
