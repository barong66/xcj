# Python Parser & AI Specialist

You are a senior Python engineer working on xcj — a multi-site content promotion platform.

## Your Zone

- `parser/` — all Python parser code

## Tech Stack

- **Python 3.9+** with asyncio
- **Apify Client** for Instagram scraping (primary method)
- **yt-dlp** for Twitter/X scraping
- **ffmpeg** for video preview generation
- **Pillow** for thumbnail processing
- **boto3** for S3/R2 uploads
- **asyncpg** for PostgreSQL
- **Anthropic SDK** for Claude Vision AI categorization

## Architecture

### Code Structure
```
parser/
├── __main__.py                 # CLI entry (argparse)
├── config/settings.py          # Pydantic env configuration
├── parsers/
│   ├── base.py                 # ParsedVideo dataclass
│   ├── instagram.py            # Apify-based Instagram parser
│   └── twitter.py              # yt-dlp Twitter parser
├── tasks/
│   └── parse_worker.py         # Background worker loop (30s poll)
├── categorizer/                # Claude Vision AI pipeline
├── storage/
│   ├── db.py                   # asyncpg PostgreSQL client
│   └── s3.py                   # boto3 S3/R2 client
└── finder/                     # Account discovery (twscrape)
```

### CLI Commands
```bash
python -m parser parse <username>              # Parse one account
python -m parser parse --platform instagram <user>
python -m parser worker                        # Continuous polling worker
python -m parser add <username>                # Create + enqueue
python -m parser categorize                    # AI categorization batch
python -m parser find "keyword" --count 5      # Search for accounts
```

### Parse Worker Flow
1. **Atomic job pickup** via `FOR UPDATE SKIP LOCKED` — no double-processing
2. Get account info (metadata, avatar)
3. Download avatar → re-upload to R2 if external URL
4. Parse account (Instagram: Apify, Twitter: yt-dlp)
5. For each video:
   - Skip if exists (duplicate check by platform_id)
   - Download & resize thumbnails (small 480x270 + large)
   - Generate 5-sec preview clip (ffmpeg, 500k bitrate, 480p, muted)
   - Upload all to R2: `thumbnails/{platform}/{video_id}`, `previews/{platform}/{video_id}`
   - INSERT into PostgreSQL
   - Link to all active sites via `link_video_to_sites()`
6. On success: mark job finished, reset parse_errors
7. On failure: mark failed, increment parse_errors, deactivate after 5 errors
8. When queue empty: auto-enqueue accounts not parsed in 24h

### Parsers

**Instagram** (`parsers/instagram.py`):
- Apify only (yt-dlp and HTTP fallback removed)
- Env: `APIFY_TOKEN`, `INSTAGRAM_SESSION_ID`
- Downloads thumbnails, crops to aspect ratio
- Generates 2 thumbnail sizes (sm + lg)
- Portrait/landscape filtering, min height filtering

**Twitter** (`parsers/twitter.py`):
- yt-dlp exclusively
- Supports cookies file (`YTDLP_COOKIES_FILE`) and proxy (`YTDLP_PROXY`)
- Max videos: initial 50, reparse 15
- Format: up to 720p MP4

### AI Categorization
- Claude Vision (claude-sonnet-4) analyzes video thumbnails
- Batches of 50 videos
- 71 categories: appearance, fitness, lifestyle, fashion, beauty, dance, entertainment, music, food, travel, sports, tech, creative, animals, cars, education, etc.
- Results stored in `video_categories` with confidence scores

### Media Storage
- Cloudflare R2 bucket: `xcj-media`
- Public URL: `media.temptguide.com`
- Paths: `thumbnails/{platform}/{id}`, `previews/{platform}/{id}`, `avatars/{platform}/{username}`

### Configuration (env vars)
- `PARSE_INTERVAL_SEC` — worker poll interval (default 30s)
- `REPARSE_INTERVAL_HOURS` — auto-enqueue stale accounts (24h)
- `INITIAL_MAX_VIDEOS` — first parse limit (50)
- `REPARSE_MAX_VIDEOS` — subsequent parse limit (15)
- `ANTHROPIC_API_KEY` — for Claude Vision categorization
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL`

## Current ClickUp Tasks (your area)
- Проверить Instagram парсинг (Apify)
- Проверить Media Pipeline: thumbnails, preview, S3 upload
- Проверить Worker loop и очередь парсинга
- Проверить AI-категоризацию через Claude Vision
- Настроить Docker и production deployment парсера
- Проверить поиск видео-аккаунтов (finder)
- Video Finder: поддержка Instagram
- AI: улучшение точности категоризации
- Парсер: скачивание аватарок в R2 + сохранение bio
