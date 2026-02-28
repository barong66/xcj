"""Twitter video account finder using twscrape.

Searches Twitter for a keyword, filters for tweets with video,
extracts unique usernames, ranks by engagement, returns top N.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import List, Optional

from twscrape import API as TwscrapeAPI

from parser.config.settings import settings

logger = logging.getLogger(__name__)


@dataclass
class FoundAccount:
    """A Twitter account discovered through keyword search."""

    username: str
    display_name: str
    follower_count: int
    video_tweet_count: int
    total_engagement: int
    profile_image_url: Optional[str] = None


async def find_video_accounts(
    keyword: str,
    count: int = 5,
    max_results: int = 0,
) -> List[FoundAccount]:
    """Search Twitter for *keyword*, find accounts posting videos.

    Returns top *count* accounts ranked by total engagement
    (likes + retweets across matched tweets).

    Args:
        keyword: search term (e.g. "flowers")
        count: how many accounts to return (1-20)
        max_results: max tweets to scan (0 = use settings default)
    """
    if max_results <= 0:
        max_results = settings.twscrape_max_results

    api = TwscrapeAPI(settings.twscrape_db_path)

    # Build search query: keyword + video filter
    query = f"{keyword} filter:videos"

    # Collect tweets grouped by author
    account_data: dict[str, dict] = defaultdict(
        lambda: {
            "username": "",
            "display_name": "",
            "follower_count": 0,
            "video_tweet_count": 0,
            "total_engagement": 0,
            "profile_image_url": None,
        }
    )

    tweet_count = 0
    try:
        async for tweet in api.search(query, limit=max_results):
            tweet_count += 1
            user = tweet.user
            if user is None:
                continue

            username = user.username.lower()
            data = account_data[username]
            data["username"] = user.username
            data["display_name"] = user.displayname
            data["follower_count"] = max(
                data["follower_count"], user.followersCount
            )
            data["video_tweet_count"] += 1
            data["total_engagement"] += (tweet.likeCount or 0) + (
                tweet.retweetCount or 0
            )
            data["profile_image_url"] = user.profileImageUrl
    except Exception:
        logger.error("twscrape search failed for '%s'", keyword, exc_info=True)
        if tweet_count == 0:
            raise

    logger.info(
        "Scanned %d tweets for '%s', found %d unique accounts",
        tweet_count,
        keyword,
        len(account_data),
    )

    # Rank by engagement (more engagement = better content creator)
    ranked = sorted(
        account_data.values(),
        key=lambda d: d["total_engagement"],
        reverse=True,
    )[:count]

    return [
        FoundAccount(
            username=d["username"],
            display_name=d["display_name"],
            follower_count=d["follower_count"],
            video_tweet_count=d["video_tweet_count"],
            total_engagement=d["total_engagement"],
            profile_image_url=d["profile_image_url"],
        )
        for d in ranked
    ]
