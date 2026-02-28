"""End-to-end finder: search -> create accounts -> enqueue parse.

Outputs a dict suitable for JSON serialization.
"""
from __future__ import annotations

import logging
from dataclasses import asdict
from typing import List

from parser.finder.twitter_finder import FoundAccount, find_video_accounts
from parser.storage import db

logger = logging.getLogger(__name__)


async def run_finder(
    keyword: str,
    count: int = 5,
    platform: str = "twitter",
) -> dict:
    """Search for video accounts, create them in DB, enqueue parsing.

    Returns::

        {
            "keyword": "flowers",
            "platform": "twitter",
            "accounts_found": 5,
            "accounts": [
                {
                    "username": "...",
                    "display_name": "...",
                    "follower_count": ...,
                    "video_tweet_count": ...,
                    "total_engagement": ...,
                    "profile_image_url": ...,
                    "account_id": ...,
                    "job_id": ...,
                    "status": "created" | "existing" | "error",
                    "error": null | "..."
                }
            ]
        }
    """
    # Step 1: Search
    found: List[FoundAccount] = await find_video_accounts(keyword, count)

    results = []
    for acc in found:
        entry = asdict(acc)
        entry["account_id"] = None
        entry["job_id"] = None
        entry["status"] = "error"
        entry["error"] = None

        try:
            # Check if already exists
            existing = await db.get_account_by_username(platform, acc.username)
            if existing:
                account_id = existing["id"]
                entry["status"] = "existing"
            else:
                account_id = await db.create_account(
                    platform,
                    acc.username,
                    display_name=acc.display_name,
                    follower_count=acc.follower_count,
                    avatar_url=acc.profile_image_url,
                )
                entry["status"] = "created"

            entry["account_id"] = account_id

            # Enqueue parse job
            job_id = await db.enqueue_parse(account_id)
            entry["job_id"] = job_id

        except Exception as e:
            logger.error("Failed to create/enqueue @%s: %s", acc.username, e)
            entry["error"] = str(e)

        results.append(entry)

    await db.close_pool()

    return {
        "keyword": keyword,
        "platform": platform,
        "accounts_found": len(results),
        "accounts": results,
    }
