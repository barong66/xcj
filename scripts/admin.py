#!/usr/bin/env python3
"""
Traforama Admin CLI — Management tool for the video aggregator.

Usage:
    python admin.py stats
    python admin.py accounts list [--platform twitter|instagram] [--active|--inactive] [--paid|--free]
    python admin.py accounts add <platform> <username>
    python admin.py accounts remove <username>
    python admin.py accounts reparse <username>
    python admin.py accounts reparse-all
    python admin.py videos list [--category <slug>] [--country <code>] [--uncategorized] [--limit N]
    python admin.py videos delete <id>
    python admin.py videos recategorize [--all | --id <video_id> | --account <username>]
    python admin.py queue status
    python admin.py queue clear-failed
    python admin.py queue retry-failed
    python admin.py sites list
    python admin.py sites create <slug> <domain> <name>
    python admin.py sites assign-categories <site-slug> --all
    python admin.py sync-counters
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from textwrap import shorten

import asyncpg
from tabulate import tabulate

# ---------------------------------------------------------------------------
# ANSI color helpers
# ---------------------------------------------------------------------------

_USE_COLOR = sys.stdout.isatty()


def _c(code: str, text: str) -> str:
    if not _USE_COLOR:
        return str(text)
    return f"\033[{code}m{text}\033[0m"


def green(text: str) -> str:
    return _c("32", text)


def red(text: str) -> str:
    return _c("31", text)


def yellow(text: str) -> str:
    return _c("33", text)


def cyan(text: str) -> str:
    return _c("36", text)


def bold(text: str) -> str:
    return _c("1", text)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://traforama:traforama@localhost:5432/traforama",
)
CLICKHOUSE_URL = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Parse ClickHouse URL into components for clickhouse-connect
_ch_host = "localhost"
_ch_port = 8123
_ch_user = os.environ.get("CLICKHOUSE_USER", "default")
_ch_password = os.environ.get("CLICKHOUSE_PASSWORD", "")
_ch_database = os.environ.get("CLICKHOUSE_DB", "traforama")

if CLICKHOUSE_URL:
    from urllib.parse import urlparse

    _parsed = urlparse(CLICKHOUSE_URL)
    if _parsed.hostname:
        _ch_host = _parsed.hostname
    if _parsed.port:
        _ch_port = _parsed.port
    if _parsed.username:
        _ch_user = _parsed.username
    if _parsed.password:
        _ch_password = _parsed.password
    if _parsed.path and _parsed.path.strip("/"):
        _ch_database = _parsed.path.strip("/")


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


async def get_conn() -> asyncpg.Connection:
    """Create a single connection (scripts don't need a pool)."""
    return await asyncpg.connect(DATABASE_URL)


def _fmt_ts(ts) -> str:
    """Format a timestamp for display, or return '-' for None."""
    if ts is None:
        return "-"
    if isinstance(ts, datetime):
        return ts.strftime("%Y-%m-%d %H:%M")
    return str(ts)


def _fmt_num(n) -> str:
    """Format a number with thousands separators."""
    if n is None:
        return "0"
    return f"{int(n):,}"


# ═══════════════════════════════════════════════════════════════════════════
# SUBCOMMANDS
# ═══════════════════════════════════════════════════════════════════════════


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------


async def cmd_stats(_args: argparse.Namespace) -> None:
    """Show system overview."""
    conn = await get_conn()
    try:
        # ── Videos ──────────────────────────────────────────
        total_videos = await conn.fetchval("SELECT COUNT(*) FROM videos")
        active_videos = await conn.fetchval(
            "SELECT COUNT(*) FROM videos WHERE is_active = true"
        )
        inactive_videos = total_videos - active_videos

        # ── Accounts ────────────────────────────────────────
        total_accounts = await conn.fetchval("SELECT COUNT(*) FROM accounts")
        active_accounts = await conn.fetchval(
            "SELECT COUNT(*) FROM accounts WHERE is_active = true"
        )
        inactive_accounts = total_accounts - active_accounts

        accounts_by_platform = await conn.fetch(
            """
            SELECT platform,
                   COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE is_active = true) AS active
            FROM accounts
            GROUP BY platform
            ORDER BY platform
            """
        )

        # ── Videos per category (top 20) ────────────────────
        top_categories = await conn.fetch(
            """
            SELECT c.name, COUNT(vc.video_id) AS cnt
            FROM video_categories vc
            JOIN categories c ON c.id = vc.category_id
            GROUP BY c.name
            ORDER BY cnt DESC
            LIMIT 20
            """
        )

        # ── Videos per country (top 20) ─────────────────────
        top_countries = await conn.fetch(
            """
            SELECT COALESCE(co.name, 'Unknown') AS country, COUNT(v.id) AS cnt
            FROM videos v
            LEFT JOIN countries co ON co.id = v.country_id
            GROUP BY co.name
            ORDER BY cnt DESC
            LIMIT 20
            """
        )

        # ── Parse queue status ──────────────────────────────
        queue_stats = await conn.fetch(
            """
            SELECT status, COUNT(*) AS cnt
            FROM parse_queue
            GROUP BY status
            ORDER BY status
            """
        )

        # ── Uncategorized videos ────────────────────────────
        uncategorized = await conn.fetchval(
            "SELECT COUNT(*) FROM videos WHERE ai_processed_at IS NULL AND is_active = true"
        )

        # ── Videos added today / this week ──────────────────
        today = await conn.fetchval(
            "SELECT COUNT(*) FROM videos WHERE created_at >= CURRENT_DATE"
        )
        this_week = await conn.fetchval(
            "SELECT COUNT(*) FROM videos WHERE created_at >= date_trunc('week', CURRENT_DATE)"
        )

        # ── Storage estimate ────────────────────────────────
        # Rough estimate: ~5 MB per video (thumbnail + preview)
        avg_size_mb = 5
        storage_gb = (total_videos * avg_size_mb) / 1024

        # ── Print everything ────────────────────────────────
        print(bold("\n=== Traforama System Stats ===\n"))

        print(bold("Videos"))
        print(
            tabulate(
                [
                    ["Total", _fmt_num(total_videos)],
                    ["Active", green(_fmt_num(active_videos))],
                    ["Inactive", red(_fmt_num(inactive_videos))],
                    ["Added today", cyan(_fmt_num(today))],
                    ["Added this week", cyan(_fmt_num(this_week))],
                    ["Uncategorized", yellow(_fmt_num(uncategorized))],
                    ["Est. storage", f"{storage_gb:.1f} GB"],
                ],
                tablefmt="simple",
            )
        )

        print(f"\n{bold('Accounts')}")
        print(
            tabulate(
                [
                    ["Total", _fmt_num(total_accounts)],
                    ["Active", green(_fmt_num(active_accounts))],
                    ["Inactive", red(_fmt_num(inactive_accounts))],
                ],
                tablefmt="simple",
            )
        )

        if accounts_by_platform:
            print(f"\n  {bold('By platform:')}")
            platform_table = [
                [row["platform"], _fmt_num(row["total"]), green(_fmt_num(row["active"]))]
                for row in accounts_by_platform
            ]
            print(
                tabulate(
                    platform_table,
                    headers=["Platform", "Total", "Active"],
                    tablefmt="simple",
                )
            )

        if top_categories:
            print(f"\n{bold('Top 20 Categories')}")
            cat_table = [[row["name"], _fmt_num(row["cnt"])] for row in top_categories]
            print(tabulate(cat_table, headers=["Category", "Videos"], tablefmt="simple"))

        if top_countries:
            print(f"\n{bold('Top 20 Countries')}")
            country_table = [
                [row["country"], _fmt_num(row["cnt"])] for row in top_countries
            ]
            print(
                tabulate(
                    country_table, headers=["Country", "Videos"], tablefmt="simple"
                )
            )

        print(f"\n{bold('Parse Queue')}")
        if queue_stats:
            q_table = [[row["status"], _fmt_num(row["cnt"])] for row in queue_stats]
            print(tabulate(q_table, headers=["Status", "Count"], tablefmt="simple"))
        else:
            print("  (empty)")

        print()
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# accounts
# ---------------------------------------------------------------------------


async def cmd_accounts_list(args: argparse.Namespace) -> None:
    """List all accounts with optional filters."""
    conn = await get_conn()
    try:
        conditions = []
        params = []
        idx = 1

        if args.platform:
            conditions.append(f"a.platform = ${idx}")
            params.append(args.platform)
            idx += 1

        if args.active:
            conditions.append("a.is_active = true")
        elif args.inactive:
            conditions.append("a.is_active = false")

        if args.paid:
            conditions.append("a.is_paid = true")
        elif args.free:
            conditions.append("a.is_paid = false")

        where = ""
        if conditions:
            where = "WHERE " + " AND ".join(conditions)

        rows = await conn.fetch(
            f"""
            SELECT
                a.id,
                a.username,
                a.platform,
                a.display_name,
                a.is_active,
                a.is_paid,
                a.paid_until,
                a.follower_count,
                a.last_parsed_at,
                a.parse_errors,
                COUNT(v.id) AS video_count
            FROM accounts a
            LEFT JOIN videos v ON v.account_id = a.id AND v.is_active = true
            {where}
            GROUP BY a.id
            ORDER BY a.platform, a.username
            """,
            *params,
        )

        if not rows:
            print(yellow("No accounts found matching filters."))
            return

        table = []
        for r in rows:
            status_parts = []
            if r["is_active"]:
                status_parts.append(green("active"))
            else:
                status_parts.append(red("inactive"))
            if r["is_paid"]:
                paid_str = yellow("paid")
                if r["paid_until"]:
                    paid_str += f" (until {_fmt_ts(r['paid_until'])})"
                status_parts.append(paid_str)

            table.append(
                [
                    r["id"],
                    r["username"],
                    r["platform"],
                    _fmt_num(r["video_count"]),
                    _fmt_num(r["follower_count"]),
                    _fmt_ts(r["last_parsed_at"]),
                    r["parse_errors"] if r["parse_errors"] > 0 else "-",
                    " | ".join(status_parts),
                ]
            )

        print(
            tabulate(
                table,
                headers=[
                    "ID",
                    "Username",
                    "Platform",
                    "Videos",
                    "Followers",
                    "Last Parsed",
                    "Errors",
                    "Status",
                ],
                tablefmt="simple",
            )
        )
        print(f"\n{len(rows)} account(s) total.")
    finally:
        await conn.close()


async def cmd_accounts_add(args: argparse.Namespace) -> None:
    """Add a new account and enqueue it for parsing."""
    platform = args.platform.lower()
    username = args.username.lstrip("@")

    if platform not in ("twitter", "instagram"):
        print(red(f"Error: unsupported platform '{platform}'. Use 'twitter' or 'instagram'."))
        sys.exit(1)

    conn = await get_conn()
    try:
        # Check if already exists
        existing = await conn.fetchrow(
            "SELECT id, is_active FROM accounts WHERE platform = $1 AND username = $2",
            platform,
            username,
        )

        if existing:
            if existing["is_active"]:
                print(
                    yellow(
                        f"Account @{username} ({platform}) already exists and is active (id={existing['id']})."
                    )
                )
                # Enqueue anyway
                job_id = await conn.fetchval(
                    "INSERT INTO parse_queue (account_id, status) VALUES ($1, 'pending') RETURNING id",
                    existing["id"],
                )
                print(green(f"Enqueued parse job #{job_id}."))
            else:
                # Reactivate
                await conn.execute(
                    "UPDATE accounts SET is_active = true, parse_errors = 0, updated_at = NOW() WHERE id = $1",
                    existing["id"],
                )
                job_id = await conn.fetchval(
                    "INSERT INTO parse_queue (account_id, status) VALUES ($1, 'pending') RETURNING id",
                    existing["id"],
                )
                print(
                    green(
                        f"Reactivated account @{username} ({platform}) (id={existing['id']}). "
                        f"Enqueued parse job #{job_id}."
                    )
                )
            return

        # Create new account
        account_id = await conn.fetchval(
            """
            INSERT INTO accounts (platform, username)
            VALUES ($1, $2)
            RETURNING id
            """,
            platform,
            username,
        )

        # Enqueue for parsing
        job_id = await conn.fetchval(
            "INSERT INTO parse_queue (account_id, status) VALUES ($1, 'pending') RETURNING id",
            account_id,
        )

        print(
            green(
                f"Created account @{username} ({platform}) with id={account_id}. "
                f"Enqueued parse job #{job_id}."
            )
        )
    finally:
        await conn.close()


async def cmd_accounts_remove(args: argparse.Namespace) -> None:
    """Soft-delete (deactivate) an account."""
    username = args.username.lstrip("@")

    conn = await get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT id, platform, is_active FROM accounts WHERE username = $1",
            username,
        )

        if not row:
            print(red(f"Error: account @{username} not found."))
            sys.exit(1)

        if not row["is_active"]:
            print(yellow(f"Account @{username} ({row['platform']}) is already inactive."))
            return

        await conn.execute(
            "UPDATE accounts SET is_active = false, updated_at = NOW() WHERE id = $1",
            row["id"],
        )
        print(green(f"Deactivated account @{username} ({row['platform']}) (id={row['id']})."))
    finally:
        await conn.close()


async def cmd_accounts_reparse(args: argparse.Namespace) -> None:
    """Re-enqueue a specific account for parsing."""
    username = args.username.lstrip("@")

    conn = await get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT id, platform, is_active FROM accounts WHERE username = $1",
            username,
        )

        if not row:
            print(red(f"Error: account @{username} not found."))
            sys.exit(1)

        if not row["is_active"]:
            print(
                yellow(
                    f"Warning: account @{username} ({row['platform']}) is inactive. "
                    f"The parser worker will skip inactive accounts."
                )
            )

        job_id = await conn.fetchval(
            "INSERT INTO parse_queue (account_id, status) VALUES ($1, 'pending') RETURNING id",
            row["id"],
        )
        print(green(f"Enqueued parse job #{job_id} for @{username} ({row['platform']})."))
    finally:
        await conn.close()


async def cmd_accounts_reparse_all(_args: argparse.Namespace) -> None:
    """Enqueue all active accounts for parsing."""
    conn = await get_conn()
    try:
        rows = await conn.fetch(
            "SELECT id, username, platform FROM accounts WHERE is_active = true ORDER BY id"
        )

        if not rows:
            print(yellow("No active accounts found."))
            return

        count = 0
        for row in rows:
            await conn.execute(
                "INSERT INTO parse_queue (account_id, status) VALUES ($1, 'pending')",
                row["id"],
            )
            count += 1

        print(green(f"Enqueued {count} parse job(s) for all active accounts."))
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# videos
# ---------------------------------------------------------------------------


async def cmd_videos_list(args: argparse.Namespace) -> None:
    """List videos with optional filters."""
    conn = await get_conn()
    try:
        conditions = ["v.is_active = true"]
        params = []
        idx = 1

        if args.category:
            conditions.append(
                f"""
                v.id IN (
                    SELECT vc.video_id
                    FROM video_categories vc
                    JOIN categories c ON c.id = vc.category_id
                    WHERE c.slug = ${idx}
                )
                """
            )
            params.append(args.category)
            idx += 1

        if args.country:
            conditions.append(
                f"v.country_id = (SELECT id FROM countries WHERE code = ${idx})"
            )
            params.append(args.country.upper())
            idx += 1

        if args.uncategorized:
            conditions.append("v.ai_processed_at IS NULL")

        where = "WHERE " + " AND ".join(conditions)
        limit = args.limit or 50

        rows = await conn.fetch(
            f"""
            SELECT
                v.id,
                v.title,
                v.platform,
                v.view_count,
                v.click_count,
                v.published_at,
                a.username,
                COALESCE(
                    (
                        SELECT string_agg(c.slug, ', ' ORDER BY vc.confidence DESC)
                        FROM video_categories vc
                        JOIN categories c ON c.id = vc.category_id
                        WHERE vc.video_id = v.id
                    ),
                    ''
                ) AS categories
            FROM videos v
            JOIN accounts a ON a.id = v.account_id
            {where}
            ORDER BY v.created_at DESC
            LIMIT {limit}
            """,
            *params,
        )

        if not rows:
            print(yellow("No videos found matching filters."))
            return

        table = []
        for r in rows:
            title = shorten(r["title"] or "(no title)", width=50, placeholder="...")
            table.append(
                [
                    r["id"],
                    title,
                    r["platform"],
                    r["username"],
                    r["categories"] or yellow("none"),
                    _fmt_num(r["view_count"]),
                    _fmt_num(r["click_count"]),
                    _fmt_ts(r["published_at"]),
                ]
            )

        print(
            tabulate(
                table,
                headers=[
                    "ID",
                    "Title",
                    "Platform",
                    "Account",
                    "Categories",
                    "Views",
                    "Clicks",
                    "Published",
                ],
                tablefmt="simple",
            )
        )
        print(f"\n{len(rows)} video(s) shown (limit={limit}).")
    finally:
        await conn.close()


async def cmd_videos_delete(args: argparse.Namespace) -> None:
    """Soft-delete a video by ID."""
    video_id = args.id

    conn = await get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT id, title, is_active FROM videos WHERE id = $1", video_id
        )

        if not row:
            print(red(f"Error: video #{video_id} not found."))
            sys.exit(1)

        if not row["is_active"]:
            print(yellow(f"Video #{video_id} is already inactive."))
            return

        await conn.execute(
            "UPDATE videos SET is_active = false, updated_at = NOW() WHERE id = $1",
            video_id,
        )
        title = shorten(row["title"] or "(no title)", width=60, placeholder="...")
        print(green(f"Deactivated video #{video_id}: {title}"))
    finally:
        await conn.close()


async def cmd_videos_recategorize(args: argparse.Namespace) -> None:
    """Reset ai_processed_at to NULL so videos get re-categorized."""
    conn = await get_conn()
    try:
        if args.all:
            result = await conn.execute(
                "UPDATE videos SET ai_processed_at = NULL, updated_at = NOW() WHERE is_active = true"
            )
            count = _extract_update_count(result)
            print(green(f"Reset ai_processed_at for {count} active video(s)."))

        elif args.id:
            result = await conn.execute(
                "UPDATE videos SET ai_processed_at = NULL, updated_at = NOW() WHERE id = $1",
                args.id,
            )
            count = _extract_update_count(result)
            if count == 0:
                print(red(f"Error: video #{args.id} not found."))
                sys.exit(1)
            print(green(f"Reset ai_processed_at for video #{args.id}."))

        elif args.account:
            username = args.account.lstrip("@")
            result = await conn.execute(
                """
                UPDATE videos SET ai_processed_at = NULL, updated_at = NOW()
                WHERE account_id = (SELECT id FROM accounts WHERE username = $1)
                  AND is_active = true
                """,
                username,
            )
            count = _extract_update_count(result)
            if count == 0:
                print(yellow(f"No active videos found for @{username}."))
            else:
                print(green(f"Reset ai_processed_at for {count} video(s) from @{username}."))
        else:
            print(red("Error: specify --all, --id <video_id>, or --account <username>."))
            sys.exit(1)
    finally:
        await conn.close()


def _extract_update_count(result: str) -> int:
    """Extract row count from asyncpg command result string like 'UPDATE 5'."""
    try:
        return int(result.split()[-1])
    except (ValueError, IndexError):
        return 0


# ---------------------------------------------------------------------------
# queue
# ---------------------------------------------------------------------------


async def cmd_queue_status(_args: argparse.Namespace) -> None:
    """Show parse queue state."""
    conn = await get_conn()
    try:
        rows = await conn.fetch(
            """
            SELECT
                pq.id,
                a.username,
                a.platform,
                pq.status,
                pq.videos_found,
                pq.error,
                pq.created_at,
                pq.started_at,
                pq.finished_at
            FROM parse_queue pq
            JOIN accounts a ON a.id = pq.account_id
            ORDER BY pq.created_at DESC
            LIMIT 50
            """
        )

        if not rows:
            print(yellow("Parse queue is empty."))
            return

        # Summary counts
        summary = await conn.fetch(
            "SELECT status, COUNT(*) AS cnt FROM parse_queue GROUP BY status ORDER BY status"
        )
        print(bold("Queue Summary:"))
        summary_table = []
        for s in summary:
            status = s["status"]
            cnt = _fmt_num(s["cnt"])
            if status == "pending":
                cnt = yellow(cnt)
            elif status == "running":
                cnt = cyan(cnt)
            elif status == "done":
                cnt = green(cnt)
            elif status == "failed":
                cnt = red(cnt)
            summary_table.append([status, cnt])
        print(tabulate(summary_table, headers=["Status", "Count"], tablefmt="simple"))

        print(f"\n{bold('Recent Jobs (last 50):')}")
        table = []
        for r in rows:
            status = r["status"]
            if status == "pending":
                status_str = yellow(status)
            elif status == "running":
                status_str = cyan(status)
            elif status == "done":
                status_str = green(status)
            elif status == "failed":
                status_str = red(status)
            else:
                status_str = status

            error = ""
            if r["error"]:
                error = shorten(r["error"], width=40, placeholder="...")

            table.append(
                [
                    r["id"],
                    r["username"],
                    r["platform"],
                    status_str,
                    r["videos_found"],
                    _fmt_ts(r["created_at"]),
                    _fmt_ts(r["started_at"]),
                    _fmt_ts(r["finished_at"]),
                    error,
                ]
            )

        print(
            tabulate(
                table,
                headers=[
                    "ID",
                    "Account",
                    "Platform",
                    "Status",
                    "Found",
                    "Created",
                    "Started",
                    "Finished",
                    "Error",
                ],
                tablefmt="simple",
            )
        )
    finally:
        await conn.close()


async def cmd_queue_clear_failed(_args: argparse.Namespace) -> None:
    """Delete all failed jobs from the parse queue."""
    conn = await get_conn()
    try:
        result = await conn.execute("DELETE FROM parse_queue WHERE status = 'failed'")
        count = _extract_update_count(result)
        if count == 0:
            print(yellow("No failed jobs to clear."))
        else:
            print(green(f"Deleted {count} failed job(s) from the queue."))
    finally:
        await conn.close()


async def cmd_queue_retry_failed(_args: argparse.Namespace) -> None:
    """Re-enqueue all failed jobs as pending."""
    conn = await get_conn()
    try:
        result = await conn.execute(
            """
            UPDATE parse_queue
            SET status = 'pending',
                started_at = NULL,
                finished_at = NULL,
                error = NULL,
                videos_found = 0
            WHERE status = 'failed'
            """
        )
        count = _extract_update_count(result)
        if count == 0:
            print(yellow("No failed jobs to retry."))
        else:
            print(green(f"Reset {count} failed job(s) to pending."))
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# sites
# ---------------------------------------------------------------------------


async def cmd_sites_list(_args: argparse.Namespace) -> None:
    """List all sites."""
    conn = await get_conn()
    try:
        rows = await conn.fetch(
            """
            SELECT
                s.id,
                s.slug,
                s.domain,
                s.name,
                s.is_active,
                s.created_at,
                (SELECT COUNT(*) FROM site_categories sc WHERE sc.site_id = s.id) AS cat_count,
                (SELECT COUNT(*) FROM site_videos sv WHERE sv.site_id = s.id) AS video_count
            FROM sites s
            ORDER BY s.id
            """
        )

        if not rows:
            print(yellow("No sites found. Create one with: admin.py sites create <slug> <domain> <name>"))
            return

        table = []
        for r in rows:
            status = green("active") if r["is_active"] else red("inactive")
            table.append(
                [
                    r["id"],
                    r["slug"],
                    r["domain"] or "-",
                    r["name"],
                    _fmt_num(r["cat_count"]),
                    _fmt_num(r["video_count"]),
                    status,
                    _fmt_ts(r["created_at"]),
                ]
            )

        print(
            tabulate(
                table,
                headers=[
                    "ID",
                    "Slug",
                    "Domain",
                    "Name",
                    "Categories",
                    "Videos",
                    "Status",
                    "Created",
                ],
                tablefmt="simple",
            )
        )
    finally:
        await conn.close()


async def cmd_sites_create(args: argparse.Namespace) -> None:
    """Create a new site."""
    conn = await get_conn()
    try:
        # Check for conflicts
        existing = await conn.fetchrow(
            "SELECT id FROM sites WHERE slug = $1 OR domain = $2",
            args.slug,
            args.domain,
        )
        if existing:
            print(red(f"Error: a site with slug '{args.slug}' or domain '{args.domain}' already exists."))
            sys.exit(1)

        site_id = await conn.fetchval(
            """
            INSERT INTO sites (slug, domain, name)
            VALUES ($1, $2, $3)
            RETURNING id
            """,
            args.slug,
            args.domain,
            args.name,
        )
        print(green(f"Created site '{args.name}' (slug={args.slug}, domain={args.domain}, id={site_id})."))
    finally:
        await conn.close()


async def cmd_sites_assign_categories(args: argparse.Namespace) -> None:
    """Assign categories to a site."""
    conn = await get_conn()
    try:
        site = await conn.fetchrow(
            "SELECT id, name FROM sites WHERE slug = $1", args.site_slug
        )
        if not site:
            print(red(f"Error: site '{args.site_slug}' not found."))
            sys.exit(1)

        if args.all:
            categories = await conn.fetch(
                "SELECT id, slug FROM categories WHERE is_active = true ORDER BY sort_order, id"
            )

            if not categories:
                print(yellow("No active categories found in the database."))
                return

            inserted = 0
            for cat in categories:
                result = await conn.execute(
                    """
                    INSERT INTO site_categories (site_id, category_id, sort_order)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (site_id, category_id) DO NOTHING
                    """,
                    site["id"],
                    cat["id"],
                    inserted,
                )
                if "INSERT 0 1" in result:
                    inserted += 1

            print(
                green(
                    f"Assigned {inserted} new category/ies to site '{site['name']}' "
                    f"({len(categories)} total active categories)."
                )
            )
        else:
            print(red("Error: specify --all to assign all categories."))
            sys.exit(1)
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# sync-counters
# ---------------------------------------------------------------------------


async def cmd_sync_counters(_args: argparse.Namespace) -> None:
    """Sync view_count/click_count from ClickHouse to PostgreSQL."""
    try:
        import clickhouse_connect
    except ImportError:
        print(red("Error: clickhouse-connect is not installed."))
        print("Install it with: pip install clickhouse-connect")
        sys.exit(1)

    print("Connecting to ClickHouse...")
    try:
        ch = clickhouse_connect.get_client(
            host=_ch_host,
            port=_ch_port,
            username=_ch_user,
            password=_ch_password,
            database=_ch_database,
        )
    except Exception as e:
        print(red(f"Error connecting to ClickHouse: {e}"))
        sys.exit(1)

    print("Querying aggregated counters from ClickHouse...")
    try:
        result = ch.query(
            """
            SELECT
                video_id,
                sum(views) AS total_views,
                sum(clicks) AS total_clicks
            FROM mv_video_daily
            GROUP BY video_id
            HAVING total_views > 0 OR total_clicks > 0
            """
        )
    except Exception as e:
        print(red(f"Error querying ClickHouse: {e}"))
        sys.exit(1)

    rows = result.result_rows
    if not rows:
        print(yellow("No counter data found in ClickHouse."))
        return

    print(f"Found counters for {len(rows)} video(s). Syncing to PostgreSQL...")

    conn = await get_conn()
    try:
        updated = 0
        # Process in batches of 500
        batch_size = 500
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]

            async with conn.transaction():
                for video_id, views, clicks in batch:
                    result = await conn.execute(
                        """
                        UPDATE videos
                        SET view_count = $2,
                            click_count = $3,
                            updated_at = NOW()
                        WHERE id = $1
                          AND (view_count != $2 OR click_count != $3)
                        """,
                        int(video_id),
                        int(views),
                        int(clicks),
                    )
                    if _extract_update_count(result) > 0:
                        updated += 1

            processed = min(i + batch_size, len(rows))
            print(f"  Processed {processed}/{len(rows)}...")

        print(green(f"Done. Updated counters for {updated} video(s)."))
    finally:
        await conn.close()
        ch.close()


# ═══════════════════════════════════════════════════════════════════════════
# CLI ARGUMENT PARSER
# ═══════════════════════════════════════════════════════════════════════════


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="admin.py",
        description="Traforama Admin CLI — Manage the video aggregator system.",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # ── stats ───────────────────────────────────────────────
    subparsers.add_parser("stats", help="Show system overview")

    # ── accounts ────────────────────────────────────────────
    accounts_parser = subparsers.add_parser("accounts", help="Manage accounts")
    accounts_sub = accounts_parser.add_subparsers(dest="accounts_command")

    # accounts list
    acc_list = accounts_sub.add_parser("list", help="List accounts")
    acc_list.add_argument("--platform", choices=["twitter", "instagram"], help="Filter by platform")
    active_group = acc_list.add_mutually_exclusive_group()
    active_group.add_argument("--active", action="store_true", help="Show only active accounts")
    active_group.add_argument("--inactive", action="store_true", help="Show only inactive accounts")
    paid_group = acc_list.add_mutually_exclusive_group()
    paid_group.add_argument("--paid", action="store_true", help="Show only paid accounts")
    paid_group.add_argument("--free", action="store_true", help="Show only free accounts")

    # accounts add
    acc_add = accounts_sub.add_parser("add", help="Add a new account")
    acc_add.add_argument("platform", choices=["twitter", "instagram"], help="Platform")
    acc_add.add_argument("username", help="Username (with or without @)")

    # accounts remove
    acc_remove = accounts_sub.add_parser("remove", help="Deactivate an account (soft delete)")
    acc_remove.add_argument("username", help="Username to deactivate")

    # accounts reparse
    acc_reparse = accounts_sub.add_parser("reparse", help="Re-enqueue account for parsing")
    acc_reparse.add_argument("username", help="Username to reparse")

    # accounts reparse-all
    accounts_sub.add_parser("reparse-all", help="Enqueue all active accounts for parsing")

    # ── videos ──────────────────────────────────────────────
    videos_parser = subparsers.add_parser("videos", help="Manage videos")
    videos_sub = videos_parser.add_subparsers(dest="videos_command")

    # videos list
    vid_list = videos_sub.add_parser("list", help="List videos")
    vid_list.add_argument("--category", help="Filter by category slug")
    vid_list.add_argument("--country", help="Filter by country code (e.g. US)")
    vid_list.add_argument("--uncategorized", action="store_true", help="Show only uncategorized videos")
    vid_list.add_argument("--limit", type=int, default=50, help="Max results (default 50)")

    # videos delete
    vid_delete = videos_sub.add_parser("delete", help="Soft-delete a video")
    vid_delete.add_argument("id", type=int, help="Video ID")

    # videos recategorize
    vid_recat = videos_sub.add_parser("recategorize", help="Reset AI categorization for re-processing")
    recat_group = vid_recat.add_mutually_exclusive_group(required=True)
    recat_group.add_argument("--all", action="store_true", help="Reset all active videos")
    recat_group.add_argument("--id", type=int, help="Reset specific video by ID")
    recat_group.add_argument("--account", help="Reset all videos from an account")

    # ── queue ───────────────────────────────────────────────
    queue_parser = subparsers.add_parser("queue", help="Manage parse queue")
    queue_sub = queue_parser.add_subparsers(dest="queue_command")

    queue_sub.add_parser("status", help="Show parse queue state")
    queue_sub.add_parser("clear-failed", help="Delete failed jobs")
    queue_sub.add_parser("retry-failed", help="Re-enqueue failed jobs as pending")

    # ── sites ───────────────────────────────────────────────
    sites_parser = subparsers.add_parser("sites", help="Manage sites")
    sites_sub = sites_parser.add_subparsers(dest="sites_command")

    sites_sub.add_parser("list", help="List all sites")

    site_create = sites_sub.add_parser("create", help="Create a new site")
    site_create.add_argument("slug", help="Site slug (e.g. fitness-clips)")
    site_create.add_argument("domain", help="Site domain (e.g. fitness-clips.com)")
    site_create.add_argument("name", help="Display name")

    site_assign = sites_sub.add_parser(
        "assign-categories", help="Assign categories to a site"
    )
    site_assign.add_argument("site_slug", help="Site slug")
    site_assign.add_argument("--all", action="store_true", required=True, help="Assign all active categories")

    # ── sync-counters ───────────────────────────────────────
    subparsers.add_parser(
        "sync-counters",
        help="Sync view/click counters from ClickHouse to PostgreSQL",
    )

    return parser


# ═══════════════════════════════════════════════════════════════════════════
# DISPATCH
# ═══════════════════════════════════════════════════════════════════════════

DISPATCH = {
    "stats": cmd_stats,
    "sync-counters": cmd_sync_counters,
}

ACCOUNTS_DISPATCH = {
    "list": cmd_accounts_list,
    "add": cmd_accounts_add,
    "remove": cmd_accounts_remove,
    "reparse": cmd_accounts_reparse,
    "reparse-all": cmd_accounts_reparse_all,
}

VIDEOS_DISPATCH = {
    "list": cmd_videos_list,
    "delete": cmd_videos_delete,
    "recategorize": cmd_videos_recategorize,
}

QUEUE_DISPATCH = {
    "status": cmd_queue_status,
    "clear-failed": cmd_queue_clear_failed,
    "retry-failed": cmd_queue_retry_failed,
}

SITES_DISPATCH = {
    "list": cmd_sites_list,
    "create": cmd_sites_create,
    "assign-categories": cmd_sites_assign_categories,
}


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    handler = None

    if args.command in DISPATCH:
        handler = DISPATCH[args.command]

    elif args.command == "accounts":
        sub = getattr(args, "accounts_command", None)
        if sub is None:
            parser.parse_args(["accounts", "--help"])
            sys.exit(1)
        handler = ACCOUNTS_DISPATCH.get(sub)

    elif args.command == "videos":
        sub = getattr(args, "videos_command", None)
        if sub is None:
            parser.parse_args(["videos", "--help"])
            sys.exit(1)
        handler = VIDEOS_DISPATCH.get(sub)

    elif args.command == "queue":
        sub = getattr(args, "queue_command", None)
        if sub is None:
            parser.parse_args(["queue", "--help"])
            sys.exit(1)
        handler = QUEUE_DISPATCH.get(sub)

    elif args.command == "sites":
        sub = getattr(args, "sites_command", None)
        if sub is None:
            parser.parse_args(["sites", "--help"])
            sys.exit(1)
        handler = SITES_DISPATCH.get(sub)

    if handler is None:
        parser.print_help()
        sys.exit(1)

    try:
        asyncio.run(handler(args))
    except KeyboardInterrupt:
        print(yellow("\nInterrupted."))
        sys.exit(130)
    except asyncpg.PostgresError as e:
        print(red(f"\nDatabase error: {e}"))
        sys.exit(1)
    except ConnectionRefusedError:
        print(red("\nError: Could not connect to the database. Is PostgreSQL running?"))
        sys.exit(1)


if __name__ == "__main__":
    main()
