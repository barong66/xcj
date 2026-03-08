from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import asyncpg

from parser.config.settings import settings

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """Return (and lazily create) the global connection pool."""
    global _pool
    if _pool is None or _pool._closed:
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        logger.info("Database pool created")
    return _pool


async def close_pool() -> None:
    """Gracefully close the pool."""
    global _pool
    if _pool is not None and not _pool._closed:
        await _pool.close()
        _pool = None
        logger.info("Database pool closed")


# ─── Accounts ────────────────────────────────────────────────────

async def get_account_by_username(platform: str, username: str) -> Optional[asyncpg.Record]:
    pool = await get_pool()
    return await pool.fetchrow(
        "SELECT * FROM accounts WHERE platform = $1 AND username = $2",
        platform, username,
    )


async def create_account(
    platform: str,
    username: str,
    *,
    platform_id: Optional[str] = None,
    display_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    follower_count: Optional[int] = None,
    bio: Optional[str] = None,
    social_links: Optional[dict] = None,
) -> int:
    """Insert a new account row and return its ``id``."""
    import json as _json

    pool = await get_pool()
    sl_json = _json.dumps(social_links) if social_links else "{}"
    row = await pool.fetchrow(
        """
        INSERT INTO accounts (platform, username, slug, platform_id, display_name,
                              avatar_url, follower_count, bio, social_links)
        VALUES ($1, $2, LOWER($2), $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (platform, username) DO UPDATE
            SET platform_id    = COALESCE(EXCLUDED.platform_id,    accounts.platform_id),
                display_name   = COALESCE(EXCLUDED.display_name,   accounts.display_name),
                avatar_url     = COALESCE(EXCLUDED.avatar_url,     accounts.avatar_url),
                follower_count = COALESCE(EXCLUDED.follower_count, accounts.follower_count),
                bio            = COALESCE(EXCLUDED.bio,            accounts.bio),
                social_links   = CASE WHEN EXCLUDED.social_links != '{}'::jsonb
                                      THEN EXCLUDED.social_links
                                      ELSE accounts.social_links END,
                slug           = COALESCE(accounts.slug, LOWER(EXCLUDED.username)),
                updated_at     = NOW()
        RETURNING id
        """,
        platform, username, platform_id, display_name, avatar_url, follower_count,
        bio, sl_json,
    )
    return row["id"]


async def update_account_info(
    account_id: int,
    *,
    platform_id: Optional[str] = None,
    display_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    follower_count: Optional[int] = None,
    bio: Optional[str] = None,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE accounts
        SET platform_id    = COALESCE($2, platform_id),
            display_name   = COALESCE($3, display_name),
            avatar_url     = COALESCE($4, avatar_url),
            follower_count = COALESCE($5, follower_count),
            bio            = COALESCE($6, bio),
            slug           = COALESCE(slug, LOWER(username)),
            updated_at     = NOW()
        WHERE id = $1
        """,
        account_id, platform_id, display_name, avatar_url, follower_count, bio,
    )


async def update_account_parsed(account_id: int, *, reset_errors: bool = True) -> None:
    pool = await get_pool()
    if reset_errors:
        await pool.execute(
            "UPDATE accounts SET last_parsed_at = NOW(), parse_errors = 0 WHERE id = $1",
            account_id,
        )
    else:
        await pool.execute(
            "UPDATE accounts SET last_parsed_at = NOW() WHERE id = $1",
            account_id,
        )


async def increment_parse_errors(account_id: int) -> int:
    """Increment parse_errors and return the new value."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        UPDATE accounts
        SET parse_errors = parse_errors + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING parse_errors
        """,
        account_id,
    )
    return row["parse_errors"]


async def deactivate_account(account_id: int) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE accounts SET is_active = false, updated_at = NOW() WHERE id = $1",
        account_id,
    )


# ─── Videos ──────────────────────────────────────────────────────

async def video_exists(platform: str, platform_id: str) -> bool:
    pool = await get_pool()
    row = await pool.fetchval(
        "SELECT EXISTS(SELECT 1 FROM videos WHERE platform = $1 AND platform_id = $2)",
        platform, platform_id,
    )
    return row


async def insert_video(
    *,
    account_id: int,
    platform: str,
    platform_id: str,
    original_url: str,
    title: Optional[str],
    description: Optional[str],
    duration_sec: Optional[int],
    thumbnail_url: Optional[str],
    thumbnail_lg_url: Optional[str] = None,
    preview_url: Optional[str],
    width: Optional[int],
    height: Optional[int],
    published_at: Optional[datetime],
    country_id: Optional[int] = None,
    media_type: str = "video",
) -> int:
    """Insert a video row (skip on conflict) and return its ``id``."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO videos (
            account_id, platform, platform_id, original_url,
            title, description, duration_sec,
            thumbnail_url, thumbnail_lg_url, preview_url,
            width, height, country_id,
            published_at, media_type
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10,
            $11, $12, $13,
            $14, $15
        )
        ON CONFLICT (platform, platform_id) DO UPDATE
            SET thumbnail_url    = COALESCE(EXCLUDED.thumbnail_url,    videos.thumbnail_url),
                thumbnail_lg_url = COALESCE(EXCLUDED.thumbnail_lg_url, videos.thumbnail_lg_url),
                preview_url      = COALESCE(EXCLUDED.preview_url,      videos.preview_url),
                updated_at       = NOW()
        RETURNING id
        """,
        account_id, platform, platform_id, original_url,
        title, description, duration_sec,
        thumbnail_url, thumbnail_lg_url, preview_url,
        width, height, country_id,
        published_at, media_type,
    )
    return row["id"]


async def link_video_to_sites(video_id: int) -> None:
    """Add a video to every active site (idempotent)."""
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO site_videos (site_id, video_id)
        SELECT s.id, $1
        FROM sites s
        WHERE s.is_active = true
        ON CONFLICT DO NOTHING
        """,
        video_id,
    )


# ─── Parse queue ─────────────────────────────────────────────────

async def enqueue_parse(account_id: int) -> int:
    """Create a pending parse job and return its ``id``."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO parse_queue (account_id, status)
        VALUES ($1, 'pending')
        RETURNING id
        """,
        account_id,
    )
    return row["id"]


async def pick_pending_job() -> Optional[asyncpg.Record]:
    """Atomically pick the oldest pending job and mark it running.

    Returns the ``parse_queue`` row joined with the account username
    and platform, or ``None`` if the queue is empty.
    """
    pool = await get_pool()
    return await pool.fetchrow(
        """
        UPDATE parse_queue
        SET status = 'running', started_at = NOW()
        WHERE id = (
            SELECT pq.id
            FROM parse_queue pq
            JOIN accounts a ON a.id = pq.account_id AND a.is_active = true
            WHERE pq.status = 'pending'
            ORDER BY pq.created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING
            parse_queue.*,
            (SELECT username FROM accounts WHERE id = parse_queue.account_id) AS username,
            (SELECT platform FROM accounts WHERE id = parse_queue.account_id) AS platform,
            (SELECT max_videos FROM accounts WHERE id = parse_queue.account_id) AS max_videos,
            (SELECT last_parsed_at FROM accounts WHERE id = parse_queue.account_id) AS last_parsed_at,
            (SELECT is_paid FROM accounts WHERE id = parse_queue.account_id) AS is_paid
        """,
    )


async def finish_job(job_id: int, *, videos_found: int) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE parse_queue
        SET status = 'done', finished_at = NOW(), videos_found = $2
        WHERE id = $1
        """,
        job_id, videos_found,
    )


async def fail_job(job_id: int, *, error: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE parse_queue
        SET status = 'failed', finished_at = NOW(), error = $2
        WHERE id = $1
        """,
        job_id, error,
    )


async def enqueue_stale_accounts(interval_hours: int, limit: int = 5) -> int:
    """Find active accounts not parsed in *interval_hours* and enqueue them.

    Skips accounts that already have a pending or running job.
    Returns the number of newly enqueued jobs.
    """
    if interval_hours <= 0:
        return 0

    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT a.id
        FROM accounts a
        WHERE a.is_active = true
          AND (
              a.last_parsed_at IS NULL
              OR a.last_parsed_at < NOW() - make_interval(hours => $1)
          )
          AND NOT EXISTS (
              SELECT 1 FROM parse_queue pq
              WHERE pq.account_id = a.id
                AND pq.status IN ('pending', 'running')
          )
        ORDER BY a.last_parsed_at ASC NULLS FIRST
        LIMIT $2
        """,
        interval_hours, limit,
    )

    count = 0
    for row in rows:
        await pool.execute(
            "INSERT INTO parse_queue (account_id, status) VALUES ($1, 'pending')",
            row["id"],
        )
        count += 1

    if count > 0:
        logger.info("Auto-enqueued %d stale account(s) for re-parse", count)

    return count


# ─── Banner queue ─────────────────────────────────────────────────

async def pick_pending_banner_job() -> Optional[asyncpg.Record]:
    """Atomically pick the oldest pending banner job and mark it running."""
    pool = await get_pool()
    return await pool.fetchrow(
        """
        UPDATE banner_queue
        SET status = 'running', started_at = NOW()
        WHERE id = (
            SELECT bq.id
            FROM banner_queue bq
            WHERE bq.status = 'pending'
            ORDER BY bq.created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """,
    )


async def finish_banner_job(job_id: int) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE banner_queue SET status = 'done', finished_at = NOW() WHERE id = $1",
        job_id,
    )


async def fail_banner_job(job_id: int, *, error: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE banner_queue SET status = 'failed', finished_at = NOW(), error = $2 WHERE id = $1",
        job_id, error,
    )


async def get_banner_sizes() -> list[asyncpg.Record]:
    """Return all active banner sizes."""
    pool = await get_pool()
    return await pool.fetch(
        "SELECT id, width, height, label FROM banner_sizes WHERE is_active = true ORDER BY id",
    )


async def get_videos_for_banners(account_id: int, video_id: Optional[int] = None) -> list[asyncpg.Record]:
    """Return videos that need banners generated.

    If video_id is specified, return just that video.
    Otherwise return all active videos for the account.
    Includes account username for banner text overlay.
    """
    pool = await get_pool()
    if video_id:
        return await pool.fetch(
            """SELECT v.id, v.platform, v.platform_id,
                      COALESCE(v.thumbnail_lg_url, v.thumbnail_url) AS thumb_url,
                      a.username
               FROM videos v
               JOIN accounts a ON a.id = v.account_id
               WHERE v.id = $1 AND v.is_active = true""",
            video_id,
        )
    return await pool.fetch(
        """SELECT v.id, v.platform, v.platform_id,
                  COALESCE(v.thumbnail_lg_url, v.thumbnail_url) AS thumb_url,
                  a.username
           FROM videos v
           JOIN accounts a ON a.id = v.account_id
           WHERE v.account_id = $1 AND v.is_active = true""",
        account_id,
    )


async def insert_banner(
    account_id: int,
    video_id: int,
    banner_size_id: int,
    image_url: str,
    width: int,
    height: int,
    video_frame_id: Optional[int] = None,
) -> int:
    """Insert or update a banner row. Returns the banner id."""
    pool = await get_pool()
    if video_frame_id is not None:
        row = await pool.fetchrow(
            """
            INSERT INTO banners (account_id, video_id, banner_size_id, image_url, width, height, video_frame_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (video_id, banner_size_id, video_frame_id)
                WHERE video_frame_id IS NOT NULL
                DO UPDATE SET image_url = EXCLUDED.image_url
            RETURNING id
            """,
            account_id, video_id, banner_size_id, image_url, width, height, video_frame_id,
        )
    else:
        row = await pool.fetchrow(
            """
            INSERT INTO banners (account_id, video_id, banner_size_id, image_url, width, height)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (video_id, banner_size_id)
                WHERE video_frame_id IS NULL
                DO UPDATE SET image_url = EXCLUDED.image_url
            RETURNING id
            """,
            account_id, video_id, banner_size_id, image_url, width, height,
        )
    return row["id"]


async def insert_video_frame(
    video_id: int,
    frame_index: int,
    timestamp_ms: int,
    image_url: str,
) -> int:
    """Insert a video frame row. Returns the frame id."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO video_frames (video_id, frame_index, timestamp_ms, image_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (video_id, frame_index) DO UPDATE
            SET image_url = EXCLUDED.image_url
        RETURNING id
        """,
        video_id, frame_index, timestamp_ms, image_url,
    )
    return row["id"]


async def get_video_frames(video_id: int) -> list[asyncpg.Record]:
    """Return all frames for a video, ordered by frame_index."""
    pool = await get_pool()
    return await pool.fetch(
        "SELECT id, frame_index, timestamp_ms, image_url FROM video_frames WHERE video_id = $1 ORDER BY frame_index",
        video_id,
    )


async def enqueue_banner_generation(account_id: int, video_id: Optional[int] = None) -> int:
    """Enqueue a banner generation job. Returns the job id."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO banner_queue (account_id, video_id, status) VALUES ($1, $2, 'pending') RETURNING id",
        account_id, video_id,
    )
    return row["id"]
