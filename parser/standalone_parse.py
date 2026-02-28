#!/usr/bin/env python3
"""
Standalone Twitter/X video parser with auth cookie.
Usage: python3 standalone_parse.py <twitter_username>
"""

import sys
import os
import json
import urllib.request
import urllib.error
import urllib.parse
import re
import hashlib
from datetime import datetime
from pathlib import Path

AUTH_TOKEN = os.environ.get("TWITTER_AUTH_TOKEN", "9a6ed770d5ee20da7e859fd6a18bf9302813821a")

WEB_DIR = Path(__file__).parent.parent / "web"
DATA_DIR = WEB_DIR / "public" / "parsed"
THUMB_DIR = DATA_DIR / "thumbnails"
VIDEOS_FILE = WEB_DIR / ".mock-videos.json"
ACCOUNTS_FILE = WEB_DIR / ".mock-accounts.json"

BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Authorization": "Bearer " + BEARER_TOKEN,
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Client-Language": "en",
}


def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)


def load_videos():
    if VIDEOS_FILE.exists():
        try:
            return json.loads(VIDEOS_FILE.read_text())
        except Exception:
            return []
    return []


def save_videos(videos):
    VIDEOS_FILE.write_text(json.dumps(videos, indent=2, default=str))


def load_accounts():
    if ACCOUNTS_FILE.exists():
        try:
            return json.loads(ACCOUNTS_FILE.read_text())
        except Exception:
            return []
    return []


def save_accounts(accounts):
    ACCOUNTS_FILE.write_text(json.dumps(accounts, indent=2, default=str))


def find_account_id(username):
    """Find account_id by username in mock-accounts.json. Returns None if not found."""
    accounts = load_accounts()
    for acc in accounts:
        if acc.get("username", "").lower() == username.lower():
            return acc.get("id")
    return None


def update_account_video_count(username, count):
    """Update video_count for an account."""
    accounts = load_accounts()
    for acc in accounts:
        if acc.get("username", "").lower() == username.lower():
            acc["video_count"] = count
            break
    save_accounts(accounts)


def get_guest_token():
    """Get a guest token from Twitter."""
    req = urllib.request.Request(
        "https://api.twitter.com/1.1/guest/activate.json",
        method="POST",
        headers={
            "Authorization": "Bearer " + BEARER_TOKEN,
            "User-Agent": HEADERS["User-Agent"],
        },
        data=b""
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            return data.get("guest_token")
    except Exception as e:
        print(f"  Guest token error: {e}")
        return None


def twitter_api_request(url):
    """Make an authenticated Twitter API request."""
    headers = dict(HEADERS)
    headers["Cookie"] = f"auth_token={AUTH_TOKEN}"

    ct0 = hashlib.md5(AUTH_TOKEN.encode()).hexdigest()
    headers["Cookie"] += f"; ct0={ct0}"
    headers["X-Csrf-Token"] = ct0

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"  API Error {e.code}: {body}")
        return None
    except Exception as e:
        print(f"  Request error: {e}")
        return None


def get_user_id(username):
    """Get Twitter user ID by username."""
    variables = json.dumps({"screen_name": username, "withSafetyModeUserFields": True})
    features = json.dumps({
        "hidden_profile_subscriptions_enabled": True,
        "hidden_profile_likes_enabled": True,
        "rweb_tipjar_consumption_enabled": True,
        "responsive_web_graphql_exclude_directive_enabled": True,
        "verified_phone_label_enabled": False,
        "subscriptions_verification_info_is_identity_verified_enabled": True,
        "subscriptions_verification_info_verified_since_enabled": True,
        "highlights_tweets_tab_ui_enabled": True,
        "responsive_web_twitter_article_notes_tab_enabled": True,
        "subscriptions_feature_can_gift_premium": True,
        "creator_subscriptions_tweet_preview_api_enabled": True,
        "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
        "responsive_web_graphql_timeline_navigation_enabled": True,
    })
    url = "https://twitter.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName?variables=" + urllib.parse.quote(variables) + "&features=" + urllib.parse.quote(features)

    data = twitter_api_request(url)
    if not data:
        return None, None

    try:
        user = data["data"]["user"]["result"]
        user_id = user["rest_id"]
        name = user.get("legacy", {}).get("name", username)
        return user_id, name
    except (KeyError, TypeError) as e:
        print(f"  Parse error getting user ID: {e}")
        return None, None


def get_user_media(user_id, count=20):
    """Get media tweets for a user."""

    variables = json.dumps({
        "userId": user_id,
        "count": count,
        "includePromotedContent": False,
        "withClientEventToken": False,
        "withBirdwatchNotes": False,
        "withVoice": True,
        "withV2Timeline": True,
    })
    features = json.dumps({
        "rweb_tipjar_consumption_enabled": True,
        "responsive_web_graphql_exclude_directive_enabled": True,
        "verified_phone_label_enabled": False,
        "creator_subscriptions_tweet_preview_api_enabled": True,
        "responsive_web_graphql_timeline_navigation_enabled": True,
        "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
        "communities_web_enable_tweet_community_results_fetch": True,
        "c9s_tweet_anatomy_moderator_badge_enabled": True,
        "articles_preview_enabled": True,
        "responsive_web_edit_tweet_api_enabled": True,
        "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
        "view_counts_everywhere_api_enabled": True,
        "longform_notetweets_consumption_enabled": True,
        "responsive_web_twitter_article_tweet_consumption_enabled": True,
        "tweet_awards_web_tipping_enabled": False,
        "creator_subscriptions_quote_tweet_preview_enabled": False,
        "freedom_of_speech_not_reach_fetch_enabled": True,
        "standardized_nudges_misinfo": True,
        "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
        "rweb_video_timestamps_enabled": True,
        "longform_notetweets_rich_text_read_enabled": True,
        "longform_notetweets_inline_media_enabled": True,
        "responsive_web_enhance_cards_enabled": False,
        "responsive_web_grok_share_attachment_enabled": True,
        "responsive_web_grok_analysis_button_from_backend": True,
        "premium_content_api_read_enabled": False,
        "responsive_web_grok_image_annotation_enabled": True,
        "profile_label_improvements_pcf_label_in_post_enabled": True,
        "responsive_web_grok_show_grok_translated_post": False,
        "rweb_video_screen_enabled": True,
        "responsive_web_grok_analyze_button_fetch_trends_enabled": True,
        "responsive_web_jetfuel_frame": False,
        "responsive_web_grok_analyze_post_followups_enabled": True,
    })

    url = "https://twitter.com/i/api/graphql/_2GcwbA3j-9aGeT9-s4JiA/UserMedia?variables=" + urllib.parse.quote(variables) + "&features=" + urllib.parse.quote(features)

    return twitter_api_request(url)


def extract_videos_from_timeline(data, username):
    """Extract video entries from timeline API response."""
    videos = []

    if not data:
        return videos

    # Navigate the nested timeline structure
    # Twitter uses either timeline_v2.timeline or timeline.timeline
    try:
        user_result = data["data"]["user"]["result"]
        if "timeline_v2" in user_result:
            instructions = user_result["timeline_v2"]["timeline"]["instructions"]
        elif "timeline" in user_result:
            instructions = user_result["timeline"]["timeline"]["instructions"]
        else:
            print("  Could not find timeline in response")
            return videos
    except (KeyError, TypeError) as e:
        print(f"  Could not parse timeline structure: {e}")
        return videos

    # Collect all tweet items from entries (grid or list layout)
    tweet_items = []
    for instruction in instructions:
        if instruction.get("type") == "TimelineAddEntries":
            for entry in instruction.get("entries", []):
                content = entry.get("content", {})
                # Grid layout: content has "items" array
                if "items" in content:
                    for item in content["items"]:
                        ic = item.get("item", {}).get("itemContent")
                        if ic:
                            tweet_items.append(ic)
                # List layout: content has direct "itemContent"
                elif "itemContent" in content:
                    tweet_items.append(content["itemContent"])

    print(f"  Found {len(tweet_items)} tweet items in timeline")

    for item_content in tweet_items:
        try:
            tweet_results = item_content.get("tweet_results", {})
            result = tweet_results.get("result", {})

            # Handle tweets with __typename "TweetWithVisibilityResults"
            if result.get("__typename") == "TweetWithVisibilityResults":
                result = result.get("tweet", {})

            legacy = result.get("legacy", {})
            core = result.get("core", {})

            # Check for video in extended_entities
            extended = legacy.get("extended_entities", {})
            media_list = extended.get("media", [])

            for media in media_list:
                if media.get("type") != "video":
                    continue

                tweet_id = legacy.get("id_str", "")
                if not tweet_id:
                    continue

                # Video info
                video_info = media.get("video_info", {})
                duration_ms = video_info.get("duration_millis", 0)
                duration_sec = int(duration_ms / 1000) if duration_ms else 0

                # Best quality video URL
                variants = video_info.get("variants", [])
                mp4_variants = [v for v in variants if v.get("content_type") == "video/mp4"]
                if mp4_variants:
                    mp4_variants.sort(key=lambda v: v.get("bitrate", 0), reverse=True)

                # Thumbnail
                thumb_url = media.get("media_url_https", "")

                # Dimensions
                original_size = media.get("original_info", {})
                width = original_size.get("width", 1280)
                height = original_size.get("height", 720)

                # Tweet text
                text = legacy.get("full_text", "")
                # Remove t.co links from text for cleaner titles
                title = re.sub(r'https://t\.co/\S+', '', text).strip()[:150]
                if not title:
                    title = f"Video by @{username}"

                # Views
                views = result.get("views", {}).get("count", "0")
                try:
                    views = int(views)
                except (ValueError, TypeError):
                    views = 0

                # Date
                created_at = legacy.get("created_at", "")
                published_at = None
                if created_at:
                    try:
                        dt = datetime.strptime(created_at, "%a %b %d %H:%M:%S %z %Y")
                        published_at = dt.isoformat()
                    except ValueError:
                        pass

                videos.append({
                    "tweet_id": tweet_id,
                    "title": title,
                    "description": text[:500],
                    "duration_sec": duration_sec,
                    "thumb_url": thumb_url,
                    "width": width,
                    "height": height,
                    "views": views,
                    "published_at": published_at,
                    "original_url": f"https://x.com/{username}/status/{tweet_id}",
                })
                break  # One video per tweet

        except (KeyError, TypeError, IndexError):
            continue

    return videos


def download_file(url, path):
    """Download a file."""
    req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            with open(path, "wb") as f:
                f.write(resp.read())
        return True
    except Exception as e:
        print(f"    Download error: {e}")
        return False


def parse_twitter_account(username):
    """Parse a Twitter/X account for videos."""
    username = username.lstrip("@")

    print(f"\n{'='*60}")
    print(f"  Parsing Twitter/X: @{username}")
    print(f"{'='*60}\n")

    # Step 0: Check account exists in admin
    account_id = find_account_id(username)
    if account_id is None:
        print(f"  ERROR: Account @{username} not found in admin panel.")
        print(f"  Add it first at http://localhost:3000/admin/accounts")
        return []
    print(f"  Account found (id: {account_id})")

    # Step 1: Get user ID
    print("  [1/3] Getting user ID...")
    user_id, display_name = get_user_id(username)
    if not user_id:
        print("  ERROR: Could not get user ID. Check auth token.")
        return []
    print(f"  Found: {display_name} (ID: {user_id})")

    # Step 2: Get media timeline
    print("  [2/3] Fetching media timeline...")
    timeline_data = get_user_media(user_id, count=20)

    # Step 3: Extract videos
    print("  [3/3] Extracting videos...")
    raw_videos = extract_videos_from_timeline(timeline_data, username)
    print(f"  Found {len(raw_videos)} videos")

    if not raw_videos:
        print("  No videos found for this account")
        return []

    # Save to JSON
    existing = load_videos()
    existing_ids = {v.get("platform_id") for v in existing}
    next_id = max((v.get("id", 0) for v in existing), default=0) + 1

    new_videos = []
    for i, rv in enumerate(raw_videos):
        tweet_id = rv["tweet_id"]
        if tweet_id in existing_ids:
            print(f"  [{i+1}/{len(raw_videos)}] Skipping {tweet_id} (exists)")
            continue

        # Download thumbnail
        thumb_local = ""
        if rv["thumb_url"]:
            thumb_filename = f"{tweet_id}.jpg"
            thumb_path = THUMB_DIR / thumb_filename
            if download_file(rv["thumb_url"], str(thumb_path)):
                thumb_local = f"/parsed/thumbnails/{thumb_filename}"
                print(f"  [{i+1}/{len(raw_videos)}] {rv['title'][:50]}... ({rv['duration_sec']}s, {rv['views']} views) - thumbnail OK")
            else:
                thumb_local = rv["thumb_url"]
                print(f"  [{i+1}/{len(raw_videos)}] {rv['title'][:50]}... - thumbnail REMOTE")
        else:
            print(f"  [{i+1}/{len(raw_videos)}] {rv['title'][:50]}... - no thumbnail")

        video = {
            "id": next_id,
            "account_id": account_id,
            "platform": "twitter",
            "platform_id": tweet_id,
            "original_url": rv["original_url"],
            "title": rv["title"],
            "description": rv["description"],
            "duration_sec": rv["duration_sec"],
            "thumbnail_url": thumb_local or rv["thumb_url"],
            "preview_url": "",
            "width": rv["width"],
            "height": rv["height"],
            "view_count": rv["views"],
            "click_count": 0,
            "is_active": True,
            "published_at": rv["published_at"],
            "created_at": datetime.now().isoformat(),
            "username": username,
            "categories": []
        }

        new_videos.append(video)
        next_id += 1

    if new_videos:
        all_videos = existing + new_videos
        save_videos(all_videos)
        # Update account video count
        account_videos = [v for v in all_videos if v.get("account_id") == account_id]
        update_account_video_count(username, len(account_videos))
        print(f"\n{'='*60}")
        print(f"  Saved {len(new_videos)} new videos (total: {len(all_videos)})")
        print(f"  Updated @{username} video_count: {len(account_videos)}")
        print(f"{'='*60}")
    else:
        print("\n  No new videos to save")

    return new_videos


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 standalone_parse.py <twitter_username>")
        print("Example: python3 standalone_parse.py NASA")
        sys.exit(1)

    username = sys.argv[1]
    ensure_dirs()
    videos = parse_twitter_account(username)

    if videos:
        print(f"\nParsed {len(videos)} videos from @{username}:")
        for v in videos[:10]:
            print(f"  [{v['duration_sec']}s | {v['view_count']} views] {v['title'][:60]}")
            print(f"       {v['original_url']}")


if __name__ == "__main__":
    main()
