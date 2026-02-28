# Парсер: Instagram + Twitter видео-скрейпер

> Директория: `parser/`
> Язык: Python 3.11
> Тип: Background worker + CLI

---

## Обзор

Парсер — это многоплатформенный видео-скрейпер и процессор для сбора видео-контента из соцсетей. Работает как фоновый воркер (poll-модель) или через CLI-команды. Является частью платформы Traforama.

**Основные возможности:**
- Скрейпинг видео из Instagram (Reels) и Twitter/X
- Генерация превью-клипов (5 сек, без звука)
- Ресайз и загрузка тамбнейлов
- AI-категоризация через Claude Vision
- Автопоиск видео-аккаунтов по ключевым словам
- Очередь задач с автоотключением проблемных аккаунтов

---

## Архитектура

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   CLI / Cron  │────▶│  Parse Queue  │────▶│   Worker     │
│              │     │  (PostgreSQL) │     │  (30s poll)  │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                     ┌────────────────────────────┼────────────────────────────┐
                     │                            │                            │
                     ▼                            ▼                            ▼
           ┌─────────────────┐         ┌──────────────────┐        ┌──────────────────┐
           │ Instagram Parser│         │  Twitter Parser   │        │  AI Categorizer   │
           │ (Apify/yt-dlp/  │         │  (yt-dlp)        │        │  (Claude Vision)  │
           │  HTTP GraphQL)  │         │                  │        │                  │
           └────────┬────────┘         └────────┬─────────┘        └────────┬─────────┘
                    │                           │                           │
                    ▼                           ▼                           ▼
           ┌─────────────────────────────────────────────────────────────────────────┐
           │                         Media Pipeline                                  │
           │  1. Скачать thumbnail → resize (Pillow)                                │
           │  2. Скачать видео → 5с preview (ffmpeg, 500k, muted)                   │
           │  3. Upload → S3/R2                                                      │
           │  4. Сохранить метаданные → PostgreSQL                                   │
           └─────────────────────────────────────────────────────────────────────────┘
```

---

## Структура файлов

```
parser/
├── __main__.py                 # CLI entry point (argparse)
├── __init__.py
├── config/
│   └── settings.py             # Pydantic BaseSettings — все переменные окружения
├── parsers/
│   ├── __init__.py             # Реестр парсеров, фабрика get_parser()
│   ├── base.py                 # BaseParser — абстрактный класс
│   ├── instagram.py            # Instagram: Apify → yt-dlp → HTTP GraphQL
│   └── twitter.py              # Twitter/X: yt-dlp
├── storage/
│   ├── db.py                   # PostgreSQL (asyncpg): CRUD videos, accounts, queue
│   └── s3.py                   # S3/R2: upload thumbnails, previews, avatars
├── tasks/
│   └── parse_worker.py         # Worker loop: poll queue → parse → update status
├── categorizer/
│   ├── pipeline.py             # AI-категоризация: batch обработка видео
│   ├── vision.py               # Claude Vision API: отправка thumbnail → JSON
│   └── categories.py           # 71 категория: валидация slug'ов
├── finder/
│   ├── runner.py               # Оркестрация поиска: search → rank → create accounts
│   └── twitter_finder.py       # twscrape: поиск видео-аккаунтов Twitter
├── pyproject.toml
└── Dockerfile
```

---

## CLI-команды

```bash
# Спарсить один аккаунт
python -m parser parse <username> [--platform instagram|twitter]

# Запустить фоновый воркер (бесконечный цикл, poll каждые 30с)
python -m parser worker

# Добавить аккаунт в БД и поставить в очередь
python -m parser add <username> [--platform instagram|twitter]

# AI-категоризация некатегоризированных видео
python -m parser categorize

# Поиск видео-аккаунтов по ключевому слову
python -m parser find "keyword" [--count 5] [--platform twitter]
```

---

## Что парсит: собираемые данные

### Из Instagram

| Данные | Описание |
|--------|----------|
| `platform_id` | Уникальный ID медиа в Instagram |
| `original_url` | Ссылка на пост (instagram.com/p/...) |
| `title` / `description` | Подпись к посту (caption) |
| `duration_sec` | Длительность видео |
| `width` / `height` | Разрешение видео |
| `published_at` | Дата публикации |
| `thumbnail` | Обложка: скачивается, ресайзится до 270x480 (portrait) или 480x270 (landscape) |
| `preview` | 5-сек MP4 клип без звука, 500k bitrate |
| **Аккаунт:** | |
| `display_name` | Имя профиля |
| `avatar_url` | Аватар (скачивается и загружается в S3) |
| `follower_count` | Количество подписчиков |

### Из Twitter/X

Те же данные что и Instagram. Парсер использует единую структуру `ParsedVideo`.

### AI-категоризация (Claude Vision)

| Данные | Описание |
|--------|----------|
| `categories` | До 5 категорий из 71 доступных + confidence (0.0-1.0) |
| `country` | ISO 3166-1 alpha-2 код (определяется визуально) |
| `title` | Сгенерированный заголовок |
| `description` | Сгенерированное описание |

---

## Стратегии скрейпинга Instagram

Парсер пробует три метода **по приоритету** (fallback chain):

### 1. Apify Actor (облачный скрейпер)
- Включается при наличии `APIFY_TOKEN`
- Использует `apify/instagram-scraper`
- Лимит: 50 постов, timeout 300с, 2048MB RAM
- Самый надёжный, но платный

### 2. yt-dlp (open-source)
- Скачивает видео с `instagram.com/{username}/reels/`
- Поддерживает cookies (`YTDLP_COOKIES_FILE`) и proxy (`YTDLP_PROXY`)
- 3 попытки при ошибках
- Макс 50 видео за раз

### 3. HTTP GraphQL (прямой API)
- Endpoint: `instagram.com/api/v1/users/web_profile_info/`
- GraphQL query hash: `69cba40317214236af40e7efa697781d`
- Требует `INSTAGRAM_SESSION_ID` для приватных профилей
- Rate limit: 5 секунд между запросами
- Поддерживает ротацию proxy (`INSTAGRAM_PROXIES`)

---

## Media Pipeline

### Обработка thumbnail
1. Скачивание оригинала по URL с платформы
2. Center-crop до точных размеров (Pillow, JPEG quality 85):
   - Portrait (9:16): **270 x 480** px
   - Landscape (16:9): **480 x 270** px

### Генерация preview
1. Скачивание полного видео через yt-dlp
2. ffmpeg: обрезка до 5 секунд
   - Codec: libx264, preset: fast
   - Bitrate: 500k
   - Без звука (muted)
   - Portrait height: 854px / Landscape height: 480px
   - Формат: MP4
3. Удаление временных файлов после upload

### Загрузка в S3/R2
- Thumbnails: `s3://bucket/thumbnails/{platform}/{video_id}`
- Previews: `s3://bucket/previews/{platform}/{video_id}`
- Avatars: `s3://bucket/avatars/{platform}/{username}`
- Cache: `public, max-age=31536000, immutable` (1 год)

---

## Конфигурация (.env)

### База данных
```
DATABASE_URL=postgresql://traforama:traforama@localhost:5432/traforama
```

### S3 / Cloudflare R2
```
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=traforama-media
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=auto
S3_PUBLIC_URL=              # CDN base URL (опционально)
```

### Локальное хранилище (dev)
```
LOCAL_MEDIA_DIR=            # напр. web/public/parsed
LOCAL_MEDIA_URL=http://localhost:3000/parsed
```

### Worker
```
PARSE_INTERVAL_SEC=30       # Интервал опроса очереди
MAX_PARSE_ERRORS=5          # Деактивация аккаунта после N ошибок
```

### yt-dlp
```
YTDLP_COOKIES_FILE=         # Путь к cookies.txt
YTDLP_PROXY=                # Proxy URL
YTDLP_RATE_LIMIT=           # напр. 1M
YTDLP_MAX_VIDEOS=50         # Макс видео за один парс
```

### Instagram
```
INSTAGRAM_PROXIES=           # Через запятую
INSTAGRAM_SESSION_ID=        # sessionid cookie
INSTAGRAM_RATE_LIMIT_SEC=5   # Задержка между запросами
```

### Apify (опционально)
```
APIFY_TOKEN=                            # Включает Apify
APIFY_INSTAGRAM_ACTOR=apify/instagram-scraper
APIFY_INSTAGRAM_RESULTS_LIMIT=50
APIFY_RUN_TIMEOUT_SEC=300
APIFY_RUN_MEMORY_MBYTES=2048
```

### Twitter Search (twscrape)
```
TWSCRAPE_DB_PATH=twscrape_accounts.db
TWSCRAPE_MAX_RESULTS=100
```

### Logging
```
LOG_LEVEL=INFO
```

---

## Зависимости

### Python-пакеты (pyproject.toml)
| Пакет | Версия | Назначение |
|-------|--------|------------|
| httpx | >= 0.27 | Async HTTP клиент |
| yt-dlp | >= 2024.1 | Загрузка видео из Instagram/Twitter |
| Pillow | >= 10.0 | Ресайз и crop изображений |
| ffmpeg-python | >= 0.2.0 | Генерация preview клипов |
| asyncpg | >= 0.29 | Async PostgreSQL драйвер |
| boto3 | >= 1.34 | S3 / Cloudflare R2 клиент |
| pydantic | >= 2.5 | Валидация данных |
| pydantic-settings | >= 2.1 | Конфигурация из .env |
| anthropic | >= 0.39 | Claude Vision API |
| twscrape | >= 0.12 | Twitter скрейпинг |
| apify-client | >= 1.6 | Apify cloud scraper |

### Системные зависимости (Dockerfile)
- Python 3.11-slim
- ffmpeg
- curl
- ca-certificates

---

## Обработка ошибок

| Ситуация | Поведение |
|----------|-----------|
| HTTP 429 (rate limit) | Exponential backoff: 5с → 10с → 20с → 40с |
| yt-dlp ошибка | 3 retry попытки |
| 5+ ошибок подряд | Аккаунт деактивируется автоматически |
| Дубликат видео | Проверка `(platform, platform_id)` uniqueness, пропуск |
| Partial failure | Temp файлы удаляются, ошибка логируется |
| Все job'ы записываются | В `parse_queue` с status и error message |

---

## Производительность

- **Async I/O** — все сетевые операции через asyncio
- **Connection pool** — asyncpg min 2, max 10 подключений
- **Batch processing** — категоризация: 50 видео за раз, 5 concurrent workers
- **Формат ограничен** — yt-dlp: MP4 ≤720p для экономии трафика
- **Cache 1 год** — S3 uploads с immutable cache headers
- **Muted previews** — без аудио для минимального размера
- **Lazy init** — S3 клиент кэшируется через lru_cache

---

## 71 поддерживаемая категория

**Внешность:** blonde, brunette, redhead, curly-hair, short-hair, long-hair

**Фитнес:** fitness, yoga, bodybuilding, weight-loss

**Lifestyle:** lifestyle, vlog, daily-routine, motivation, self-care

**Красота/Мода:** fashion, beauty, skincare, hairstyle, nails, outfit

**Танцы:** dance, choreography, twerk, pole-dance

**Развлечения:** comedy, prank, challenge, reaction, asmr, cosplay

**Музыка:** music, singing, dj

**Еда:** cooking, baking, food-review

**Путешествия:** travel, beach, nature, adventure

**Спорт:** sports, swimming, surfing, martial-arts

**Tech:** gaming, tech, streaming

**Творчество:** art, photography, diy

**Животные:** pets, dogs, cats

**Авто:** cars, motorcycle

**Образование:** education, language, science

---

## Docker

```dockerfile
FROM python:3.11-slim
# Устанавливает ffmpeg, curl, ca-certificates
# pip install без dev-зависимостей
# ENTRYPOINT: python -m parser worker
```

Запуск:
```bash
docker build -t traforama-parser ./parser
docker run --env-file .env traforama-parser
```
