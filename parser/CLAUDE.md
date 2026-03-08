# Python Parser Worker

Python 3.11, async/await (asyncpg, aiohttp). Scrapes Twitter/Instagram, uploads to R2, categorizes via OpenAI.

## Structure

```
__main__.py                 CLI entry point
config/settings.py          Environment config (DB, S3, API keys)

parsers/
  base.py                   Abstract BaseParser (get_account_info, get_videos)
  twitter.py                yt-dlp-based Twitter scraper
  instagram.py              Apify-based Instagram scraper

tasks/
  parse_worker.py            Main polling loop (30s interval): queue → parse → save
  banner_worker.py           Banner generation from video frames

categorizer/
  vision.py                  OpenAI GPT-4o Vision API calls
  pipeline.py                Batch categorization (concurrency=5)
  categories.py              32 category definitions

storage/
  db.py                      PostgreSQL async client (accounts, videos, queue)
  s3.py                      S3/R2 upload/download

finder/
  runner.py                  Account discovery runner
  twitter_finder.py          Twitter search for video accounts

utils/
  image.py                   OpenCV smart crop (Haar cascade face detection) + Pillow enhancement

templates/                   Jinja2 banner HTML templates
tests/                       pytest tests
```

## CLI Commands

```bash
python -m parser worker                              # Start background polling loop
python -m parser parse <username> --platform twitter  # Parse single account
python -m parser categorize                           # AI categorize uncategorized videos
python -m parser find "keyword" --count 5             # Search for video accounts
python -m parser add <username> --platform twitter    # Add account + enqueue
```

## Patterns

**Parser pattern:** Class inheriting `BaseParser` with `get_account_info()` and `get_videos()` methods.

**Parse worker loop:**
1. Query PostgreSQL for pending queue items
2. Fetch account info + videos via parser
3. Download media → upload to S3/R2
4. Save to PostgreSQL, link to sites via `link_video_to_sites()`
5. Update queue status (done/failed)
6. Sleep 30s, repeat

**Banner generation:** Extract video frames → OpenCV face detection → smart crop → Pillow enhance (contrast +35%, saturation +40%, sharpness +50%) → text overlay → upload to R2.

## Testing

```bash
python3 -m pytest parser/tests/ -v
```

Tests: `test_banner_image.py` (smart crop), `test_clean_bio.py` (bio cleanup).

## Dependencies

asyncpg, boto3, yt-dlp, opencv-python, Pillow, openai, apify-client
