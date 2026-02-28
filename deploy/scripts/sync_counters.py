#!/usr/bin/env python3
"""
Traforama Counter Sync — ClickHouse -> PostgreSQL

Reads aggregated view/click counts from the ClickHouse mv_video_daily
materialized view and batch-updates the cached counters in PostgreSQL.
Designed to run via cron every 5 minutes.

Environment variables:
    DATABASE_URL     — PostgreSQL connection string
    CLICKHOUSE_URL   — ClickHouse HTTP URL (e.g. http://localhost:8123)
    CLICKHOUSE_DB    — ClickHouse database name (default: traforama)
    BATCH_SIZE       — Videos per UPDATE batch (default: 1000)
    LOOKBACK_DAYS    — Days of data to aggregate (default: 30)
    LOG_LEVEL        — Logging level (default: INFO)
"""
from __future__ import annotations

import logging
import os
import sys
import time
from typing import Any

import clickhouse_connect
import psycopg2
import psycopg2.extras

# ── Configuration ────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL")
CLICKHOUSE_URL = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")
CLICKHOUSE_DB = os.environ.get("CLICKHOUSE_DB", "traforama")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "1000"))
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "30"))
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stderr,
)
log = logging.getLogger("sync_counters")


def fetch_clickhouse_stats(ch_client: Any) -> list[tuple[int, int, int]]:
    """
    Query ClickHouse for aggregated video stats over the lookback window.
    Returns list of (video_id, total_views, total_clicks).
    """
    query = """
        SELECT
            video_id,
            sum(views) AS views,
            sum(clicks) AS clicks
        FROM mv_video_daily
        WHERE event_date >= today() - {lookback:UInt32}
        GROUP BY video_id
        HAVING views > 0 OR clicks > 0
    """
    result = ch_client.query(query, parameters={"lookback": LOOKBACK_DAYS})
    rows = [(int(row[0]), int(row[1]), int(row[2])) for row in result.result_rows]
    log.info("Fetched %d video stats from ClickHouse (lookback=%d days)", len(rows), LOOKBACK_DAYS)
    return rows


def batch_update_postgres(pg_conn: Any, stats: list[tuple[int, int, int]]) -> int:
    """
    Batch update PostgreSQL videos table with new counters.
    Only updates rows where the counts actually changed.
    Returns the number of rows updated.
    """
    total_updated = 0

    for i in range(0, len(stats), BATCH_SIZE):
        batch = stats[i : i + BATCH_SIZE]

        # Build a VALUES list for a single UPDATE using a CTE
        # This avoids N individual UPDATE statements
        values_list = []
        params: list[Any] = []
        for idx, (video_id, views, clicks) in enumerate(batch):
            offset = idx * 3
            values_list.append(f"(%s, %s, %s)")
            params.extend([video_id, views, clicks])

        values_sql = ", ".join(values_list)

        update_sql = f"""
            UPDATE videos AS v
            SET
                view_count = s.views,
                click_count = s.clicks,
                updated_at = NOW()
            FROM (VALUES {values_sql}) AS s(id, views, clicks)
            WHERE v.id = s.id
              AND (v.view_count != s.views OR v.click_count != s.clicks)
        """

        with pg_conn.cursor() as cur:
            cur.execute(update_sql, params)
            updated = cur.rowcount
            total_updated += updated

        pg_conn.commit()
        log.debug(
            "Batch %d-%d: %d rows updated",
            i,
            min(i + BATCH_SIZE, len(stats)),
            updated,
        )

    return total_updated


def main() -> None:
    if not DATABASE_URL:
        log.error("DATABASE_URL environment variable is required")
        sys.exit(1)

    start_time = time.monotonic()
    log.info("Starting counter sync")

    # Connect to ClickHouse
    ch_client = clickhouse_connect.get_client(
        host=CLICKHOUSE_URL.replace("http://", "").replace("https://", "").split(":")[0],
        port=int(CLICKHOUSE_URL.split(":")[-1]) if ":" in CLICKHOUSE_URL.split("//")[-1] else 8123,
        database=CLICKHOUSE_DB,
    )
    log.info("Connected to ClickHouse at %s/%s", CLICKHOUSE_URL, CLICKHOUSE_DB)

    # Connect to PostgreSQL
    pg_conn = psycopg2.connect(DATABASE_URL)
    log.info("Connected to PostgreSQL")

    try:
        # Fetch aggregated stats from ClickHouse
        stats = fetch_clickhouse_stats(ch_client)

        if not stats:
            log.info("No stats to sync — exiting")
            return

        # Batch update PostgreSQL
        updated = batch_update_postgres(pg_conn, stats)

        elapsed = time.monotonic() - start_time
        log.info(
            "Sync complete: %d videos checked, %d updated, %.2fs elapsed",
            len(stats),
            updated,
            elapsed,
        )

    except Exception:
        log.exception("Counter sync failed")
        sys.exit(1)

    finally:
        pg_conn.close()
        ch_client.close()


if __name__ == "__main__":
    main()
