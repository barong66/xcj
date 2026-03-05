"""CLI entry point for the Traforama parser.

Usage:
    python -m parser parse <username>                    — parse a single account (default: twitter)
    python -m parser parse --platform instagram <user>   — parse an Instagram account
    python -m parser worker                              — start the background worker loop
    python -m parser add <username>                      — add a Twitter account and enqueue
    python -m parser add --platform instagram <user>     — add an Instagram account and enqueue
    python -m parser categorize                          — run AI categorization on uncategorized videos
    python -m parser find "keyword" --count 5            — search Twitter for video accounts by keyword
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from parser.config.settings import settings


def _setup_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stderr,
    )


# ─── Commands ────────────────────────────────────────────────────

async def cmd_parse(username: str, platform: str) -> None:
    """Parse a single account (no queue, direct run)."""
    from parser.storage import db
    from parser.tasks.parse_worker import run_parse_for_account

    account = await db.get_account_by_username(platform, username)
    if account is None:
        # Auto-create the account if it does not exist.
        logging.getLogger(__name__).info("Account @%s not found — creating", username)
        account_id = await db.create_account(platform, username)
    else:
        account_id = account["id"]

    try:
        count = await run_parse_for_account(platform, username, account_id)
        print(f"Done. {count} new video(s) saved for @{username}.")
    finally:
        await db.close_pool()


async def cmd_worker() -> None:
    """Start the worker loop (runs until SIGINT/SIGTERM).

    Runs parse worker, banner worker, and categorizer concurrently.
    """
    from parser.tasks.banner_worker import banner_worker_loop
    from parser.tasks.parse_worker import worker_loop

    tasks = [worker_loop(), banner_worker_loop()]

    # Start categorizer only if ANTHROPIC_API_KEY is configured
    import os
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        from parser.categorizer.pipeline import CategorizationPipeline, PipelineConfig
        logging.getLogger(__name__).info("Categorizer enabled (ANTHROPIC_API_KEY set)")
        config = PipelineConfig(
            database_url=os.environ.get("DATABASE_URL", "postgresql://xcj:xcj@localhost:5432/xcj"),
            anthropic_api_key=api_key,
            batch_size=int(os.environ.get("CATEGORIZER_BATCH_SIZE", "50")),
            concurrency=int(os.environ.get("CATEGORIZER_CONCURRENCY", "5")),
        )
        pipeline = CategorizationPipeline(config)
        interval = float(os.environ.get("CATEGORIZER_INTERVAL_SEC", "30"))
        tasks.append(pipeline.run_continuous(interval_sec=interval))
    else:
        logging.getLogger(__name__).warning("Categorizer disabled: ANTHROPIC_API_KEY not set")

    await asyncio.gather(*tasks)


async def cmd_categorize() -> None:
    """Run AI categorization on uncategorized videos."""
    from parser.categorizer.pipeline import run_categorize_once
    await run_categorize_once()


async def cmd_add(username: str, platform: str) -> None:
    """Add an account to the DB and enqueue a parse job."""
    from parser.parsers import get_parser
    from parser.storage import db

    # Try to grab account metadata before saving.
    parser = get_parser(platform)
    info: dict = {}
    try:
        info = await parser.get_account_info(username)
    except Exception:
        logging.getLogger(__name__).warning(
            "Could not fetch account info for @%s — saving with username only",
            username,
        )

    account_id = await db.create_account(
        platform,
        username,
        platform_id=info.get("platform_id"),
        display_name=info.get("display_name"),
        avatar_url=info.get("avatar_url"),
        follower_count=info.get("follower_count"),
    )

    job_id = await db.enqueue_parse(account_id)
    await db.close_pool()

    print(f"Account @{username} (id={account_id}) created.  Parse job queued (id={job_id}).")


async def cmd_find(keyword: str, count: int, platform: str) -> None:
    """Search for video accounts by keyword and create them."""
    import json

    from parser.finder.runner import run_finder

    result = await run_finder(keyword, count, platform)
    # Output JSON to stdout for programmatic consumption.
    print(json.dumps(result, indent=2))


# ─── Argument parser ─────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="parser",
        description="Traforama video parser CLI",
    )
    sub = ap.add_subparsers(dest="command", required=True)

    # parse
    p_parse = sub.add_parser("parse", help="Parse a single account")
    p_parse.add_argument("username", help="Account username (without @)")
    p_parse.add_argument(
        "--platform", default="twitter", choices=["twitter", "instagram"],
        help="Platform to parse (default: twitter)",
    )

    # worker
    sub.add_parser("worker", help="Start the parse worker loop")

    # add
    p_add = sub.add_parser("add", help="Add account to DB and enqueue")
    p_add.add_argument("username", help="Account username (without @)")
    p_add.add_argument(
        "--platform", default="twitter", choices=["twitter", "instagram"],
        help="Platform (default: twitter)",
    )

    # categorize
    sub.add_parser("categorize", help="Run AI categorization on uncategorized videos")

    # find
    p_find = sub.add_parser("find", help="Search for video accounts by keyword")
    p_find.add_argument("keyword", help="Search keyword (e.g. 'flowers')")
    p_find.add_argument(
        "--count", type=int, default=5,
        help="Number of accounts to find (default: 5, max: 20)",
    )
    p_find.add_argument(
        "--platform", default="twitter", choices=["twitter"],
        help="Platform to search (default: twitter)",
    )

    return ap


def main() -> None:
    _setup_logging()
    ap = build_parser()
    args = ap.parse_args()

    if args.command == "parse":
        asyncio.run(cmd_parse(args.username, args.platform))
    elif args.command == "worker":
        asyncio.run(cmd_worker())
    elif args.command == "add":
        asyncio.run(cmd_add(args.username, args.platform))
    elif args.command == "categorize":
        asyncio.run(cmd_categorize())
    elif args.command == "find":
        asyncio.run(cmd_find(args.keyword, min(args.count, 20), args.platform))
    else:
        ap.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
