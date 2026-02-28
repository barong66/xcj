#!/usr/bin/env python3
"""Debug: dump raw Twitter API response."""
import sys, os, json, urllib.request, urllib.error, urllib.parse, hashlib

AUTH_TOKEN = os.environ.get("TWITTER_AUTH_TOKEN", "9a6ed770d5ee20da7e859fd6a18bf9302813821a")
BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"

def api_req(url):
    ct0 = hashlib.md5(AUTH_TOKEN.encode()).hexdigest()
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Authorization": "Bearer " + BEARER,
        "Cookie": f"auth_token={AUTH_TOKEN}; ct0={ct0}",
        "X-Csrf-Token": ct0,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Client-Language": "en",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:500]}")
        return None

# Get user media
user_id = "11348282"  # NASA
variables = json.dumps({"userId": user_id, "count": 5, "includePromotedContent": False, "withClientEventToken": False, "withBirdwatchNotes": False, "withVoice": True, "withV2Timeline": True})
features = json.dumps({"rweb_tipjar_consumption_enabled":True,"responsive_web_graphql_exclude_directive_enabled":True,"verified_phone_label_enabled":False,"creator_subscriptions_tweet_preview_api_enabled":True,"responsive_web_graphql_timeline_navigation_enabled":True,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":False,"communities_web_enable_tweet_community_results_fetch":True,"c9s_tweet_anatomy_moderator_badge_enabled":True,"articles_preview_enabled":True,"responsive_web_edit_tweet_api_enabled":True,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":True,"view_counts_everywhere_api_enabled":True,"longform_notetweets_consumption_enabled":True,"responsive_web_twitter_article_tweet_consumption_enabled":True,"tweet_awards_web_tipping_enabled":False,"creator_subscriptions_quote_tweet_preview_enabled":False,"freedom_of_speech_not_reach_fetch_enabled":True,"standardized_nudges_misinfo":True,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":True,"rweb_video_timestamps_enabled":True,"longform_notetweets_rich_text_read_enabled":True,"longform_notetweets_inline_media_enabled":True,"responsive_web_enhance_cards_enabled":False,"responsive_web_grok_share_attachment_enabled":True,"responsive_web_grok_analysis_button_from_backend":True,"premium_content_api_read_enabled":False,"responsive_web_grok_image_annotation_enabled":True,"profile_label_improvements_pcf_label_in_post_enabled":True,"responsive_web_grok_show_grok_translated_post":False,"rweb_video_screen_enabled":True,"responsive_web_grok_analyze_button_fetch_trends_enabled":True,"responsive_web_jetfuel_frame":False,"responsive_web_grok_analyze_post_followups_enabled":True})

url = "https://twitter.com/i/api/graphql/_2GcwbA3j-9aGeT9-s4JiA/UserMedia?variables=" + urllib.parse.quote(variables) + "&features=" + urllib.parse.quote(features)
data = api_req(url)

if data:
    # Print structure keys at each level
    print("TOP KEYS:", list(data.keys()))
    if "data" in data:
        print("data KEYS:", list(data["data"].keys()))
        if "user" in data["data"]:
            print("user KEYS:", list(data["data"]["user"].keys()))
            u = data["data"]["user"]
            if "result" in u:
                print("result KEYS:", list(u["result"].keys()))
                r = u["result"]
                if "timeline_v2" in r:
                    print("timeline_v2 KEYS:", list(r["timeline_v2"].keys()))
                    t = r["timeline_v2"]
                    if "timeline" in t:
                        print("timeline KEYS:", list(t["timeline"].keys()))
                        tl = t["timeline"]
                        if "instructions" in tl:
                            for inst in tl["instructions"]:
                                print(f"  instruction type: {inst.get('type')}")
                                if inst.get("type") == "TimelineAddEntries":
                                    entries = inst.get("entries", [])
                                    print(f"  entries count: {len(entries)}")
                                    if entries:
                                        print("  first entry keys:", json.dumps(entries[0], indent=2)[:1000])
                elif "timeline" in r:
                    t2 = r["timeline"]
                    print("DIRECT timeline KEYS:", list(t2.keys()))
                    if "timeline" in t2:
                        tl2 = t2["timeline"]
                        print("inner timeline KEYS:", list(tl2.keys()))
                        if "instructions" in tl2:
                            for inst in tl2["instructions"]:
                                print(f"  instruction type: {inst.get('type')}")
                                if inst.get("type") == "TimelineAddEntries":
                                    entries = inst.get("entries", [])
                                    print(f"  entries count: {len(entries)}")
                                    if entries:
                                        print("  first entry:", json.dumps(entries[0], indent=2)[:2000])
                else:
                    print("result dump:", json.dumps(r, indent=2)[:2000])
else:
    print("No data returned")
