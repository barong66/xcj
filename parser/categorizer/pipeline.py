"""
Categorization pipeline: fetches uncategorized videos from PostgreSQL,
runs them through Claude Vision, and saves results back to the database.

CLI entry point: python -m parser categorize
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional

import asyncpg

from parser.categorizer.vision import VisionCategorizer, CategorizationResult

logger = logging.getLogger(__name__)


@dataclass
class PipelineConfig:
    """Configuration for the categorization pipeline."""
    database_url: str
    anthropic_api_key: str
    batch_size: int = 50
    concurrency: int = 5


@dataclass
class VideoRow:
    """Minimal video record for categorization."""
    id: int
    thumbnail_url: Optional[str]
    title: Optional[str]


class CategorizationPipeline:
    """
    End-to-end pipeline that:
      1. Fetches uncategorized videos from PostgreSQL
      2. Downloads thumbnails
      3. Runs Claude Vision categorizer
      4. Saves categories to video_categories and updates videos table
    """

    def __init__(self, config: PipelineConfig) -> None:
        self._config = config
        self._categorizer: Optional[VisionCategorizer] = None
        self._pool: Optional[asyncpg.Pool] = None

    async def _init(self) -> None:
        """Initialize DB pool and categorizer client."""
        self._pool = await asyncpg.create_pool(
            self._config.database_url,
            min_size=2,
            max_size=self._config.concurrency + 2,
        )
        self._categorizer = VisionCategorizer(api_key=self._config.anthropic_api_key)

    async def _close(self) -> None:
        """Tear down resources."""
        if self._categorizer:
            await self._categorizer.close()
        if self._pool:
            await self._pool.close()

    # ── Public API ────────────────────────────────────────────

    async def run(self) -> int:
        """
        Run one batch of categorizations.

        Returns:
            Number of videos successfully processed.
        """
        await self._init()
        try:
            return await self._process_batch()
        finally:
            await self._close()

    async def run_continuous(self, interval_sec: float = 30.0) -> None:
        """
        Run continuously, processing batches with a sleep interval.
        Used when the pipeline is run as a long-lived worker.
        """
        await self._init()
        try:
            while True:
                try:
                    processed = await self._process_batch()
                    if processed > 0:
                        logger.info("Processed %d videos", processed)
                    else:
                        logger.debug("No uncategorized videos found, sleeping...")
                except Exception:
                    logger.exception("Error in categorization batch")

                await asyncio.sleep(interval_sec)
        finally:
            await self._close()

    # ── Internal ──────────────────────────────────────────────

    async def _process_batch(self) -> int:
        """Fetch and process a batch of uncategorized videos."""
        assert self._pool is not None
        assert self._categorizer is not None

        videos = await self._fetch_uncategorized()
        if not videos:
            return 0

        logger.info("Found %d uncategorized videos to process", len(videos))

        # Process with concurrency limit
        semaphore = asyncio.Semaphore(self._config.concurrency)
        tasks = [self._process_one(semaphore, video) for video in videos]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        success_count = 0
        for video, result in zip(videos, results):
            if isinstance(result, Exception):
                logger.error(
                    "Failed to categorize video %d: %s",
                    video.id, result,
                )
            elif result:
                success_count += 1

        return success_count

    async def _fetch_uncategorized(self) -> List[VideoRow]:
        """Fetch videos that haven't been processed by AI yet."""
        assert self._pool is not None

        rows = await self._pool.fetch(
            """
            SELECT id, thumbnail_url, title
            FROM videos
            WHERE ai_processed_at IS NULL
              AND is_active = true
              AND thumbnail_url IS NOT NULL
            ORDER BY created_at ASC
            LIMIT $1
            """,
            self._config.batch_size,
        )

        return [
            VideoRow(
                id=row["id"],
                thumbnail_url=row["thumbnail_url"],
                title=row["title"],
            )
            for row in rows
        ]

    async def _process_one(
        self,
        semaphore: asyncio.Semaphore,
        video: VideoRow,
    ) -> bool:
        """Process a single video: categorize and save results."""
        async with semaphore:
            assert self._categorizer is not None

            if not video.thumbnail_url:
                logger.warning("Video %d has no thumbnail URL, skipping", video.id)
                return False

            logger.debug("Categorizing video %d: %s", video.id, video.thumbnail_url)

            try:
                result = await self._categorizer.categorize_url(video.thumbnail_url)
            except Exception:
                logger.exception("Vision API error for video %d", video.id)
                return False

            if not result.categories:
                logger.warning(
                    "No categories returned for video %d, marking as processed",
                    video.id,
                )
                # Still mark as processed to avoid re-processing
                await self._mark_processed(video.id, result)
                return True

            await self._save_result(video.id, result)
            return True

    async def _resolve_category_ids(
        self,
        conn: asyncpg.Connection,
        slugs: List[str],
    ) -> Dict[str, int]:
        """
        Resolve category slugs to database IDs.
        Creates categories that don't yet exist in the DB.
        """
        slug_to_id: Dict[str, int] = {}

        if not slugs:
            return slug_to_id

        # Fetch existing
        rows = await conn.fetch(
            """
            SELECT id, slug FROM categories
            WHERE slug = ANY($1::text[])
            """,
            slugs,
        )
        for row in rows:
            slug_to_id[row["slug"]] = row["id"]

        # Insert missing categories
        missing = [s for s in slugs if s not in slug_to_id]
        for slug in missing:
            from parser.categorizer.categories import get_display_name
            name = get_display_name(slug) or slug.replace("-", " ").title()
            row = await conn.fetchrow(
                """
                INSERT INTO categories (slug, name)
                VALUES ($1, $2)
                ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
                RETURNING id
                """,
                slug,
                name,
            )
            if row:
                slug_to_id[slug] = row["id"]

        return slug_to_id

    async def _save_result(
        self,
        video_id: int,
        result: CategorizationResult,
    ) -> None:
        """Save categorization result to DB within a transaction."""
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # Resolve category slugs to IDs
                slugs = [c.slug for c in result.categories]
                slug_to_id = await self._resolve_category_ids(conn, slugs)

                # Insert into video_categories
                for cat in result.categories:
                    cat_id = slug_to_id.get(cat.slug)
                    if cat_id is None:
                        continue

                    await conn.execute(
                        """
                        INSERT INTO video_categories (video_id, category_id, confidence)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (video_id, category_id)
                        DO UPDATE SET confidence = EXCLUDED.confidence
                        """,
                        video_id,
                        cat_id,
                        cat.confidence,
                    )

                # Update the video record
                ai_data = json.dumps(result.raw_response, ensure_ascii=False)

                # Optionally update title if video has none and AI suggested one
                await conn.execute(
                    """
                    UPDATE videos
                    SET ai_categories = $2::jsonb,
                        ai_processed_at = NOW(),
                        title = COALESCE(title, $3),
                        description = COALESCE(description, $4),
                        country_id = COALESCE(
                            country_id,
                            (SELECT id FROM countries WHERE code = $5 LIMIT 1)
                        )
                    WHERE id = $1
                    """,
                    video_id,
                    ai_data,
                    result.title,
                    result.description,
                    result.country,
                )

        logger.info(
            "Video %d categorized: %s (country=%s)",
            video_id,
            [c.slug for c in result.categories],
            result.country,
        )

    async def _mark_processed(
        self,
        video_id: int,
        result: CategorizationResult,
    ) -> None:
        """Mark a video as AI-processed even if no categories were found."""
        assert self._pool is not None

        ai_data = json.dumps(result.raw_response, ensure_ascii=False)

        await self._pool.execute(
            """
            UPDATE videos
            SET ai_categories = $2::jsonb,
                ai_processed_at = NOW(),
                title = COALESCE(title, $3),
                description = COALESCE(description, $4)
            WHERE id = $1
            """,
            video_id,
            ai_data,
            result.title,
            result.description,
        )


def _load_config() -> PipelineConfig:
    """Load pipeline config from environment variables."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable is required.", file=sys.stderr)
        sys.exit(1)

    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://traforama:traforama@localhost:5432/traforama",
    )

    batch_size = int(os.environ.get("CATEGORIZER_BATCH_SIZE", "50"))
    concurrency = int(os.environ.get("CATEGORIZER_CONCURRENCY", "5"))

    return PipelineConfig(
        database_url=database_url,
        anthropic_api_key=api_key,
        batch_size=batch_size,
        concurrency=concurrency,
    )


async def run_categorize_once() -> None:
    """Run a single batch of categorizations (CLI: python -m parser categorize)."""
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    )

    config = _load_config()
    pipeline = CategorizationPipeline(config)

    processed = await pipeline.run()
    print(f"Categorization complete. Processed {processed} videos.")


async def run_categorize_continuous() -> None:
    """Run categorization continuously (for worker mode)."""
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    )

    config = _load_config()
    pipeline = CategorizationPipeline(config)

    interval = float(os.environ.get("PARSE_INTERVAL_SEC", "30"))
    await pipeline.run_continuous(interval_sec=interval)


def main() -> None:
    """Synchronous entry point for CLI."""
    asyncio.run(run_categorize_once())
