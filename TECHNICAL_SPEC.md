# xxxaccounter — Full Technical Specification

> Last updated: 2026-03-08 (Per-account conversion prices / CPA for postbacks)
> Status: Production-ready (local dev environment)
> Админка: **xcj** | Публичный сайт: **xxxaccounter**

---

## 1. Overview

xxxaccounter — сайт для раскрутки аккаунтов социальных сетей. Собирает видео с Twitter/X и Instagram, категоризирует через AI (OpenAI GPT-4o Vision), раздаёт через мульти-теннантную архитектуру с разными брендированными доменами. Продаёт листинги для тех, кто хочет раскрутить свои каналы.

**Стек:**
- **Backend:** Go 1.22, Chi router, PostgreSQL 16, Redis 7, ClickHouse
- **Parser:** Python 3.9+, async/await, yt-dlp, OpenAI GPT-4o Vision (categorization), OpenCV (banner smart crop)
- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **Инфраструктура:** Docker Compose, S3/R2

---

## 2. Архитектура проекта

```
xcj/
├── api/                    # Go backend API
│   ├── cmd/server/main.go  # Entry point
│   └── internal/
│       ├── config/         # Конфигурация из ENV
│       ├── handler/        # HTTP handlers + роутер + banner HTML templates
│       ├── store/          # Data access layer (PostgreSQL)
│       ├── model/          # Структуры данных
│       ├── middleware/     # HTTP middleware
│       ├── s3/             # S3/R2 client for Go API uploads
│       ├── cache/          # Redis кеш
│       └── clickhouse/     # Аналитика (EventBuffer)
├── parser/                 # Python парсер + AI категоризатор
│   ├── __main__.py         # CLI entry
│   ├── config/settings.py  # Настройки из .env
│   ├── parsers/            # Twitter + Instagram парсеры
│   ├── tasks/              # Фоновый воркер
│   ├── categorizer/        # AI-категоризация через OpenAI GPT-4o
│   └── storage/            # PostgreSQL + S3 клиенты
├── web/                    # Next.js фронтенд
│   ├── src/app/            # App Router (страницы)
│   ├── src/components/     # React компоненты
│   ├── src/lib/            # API клиенты
│   └── src/types/          # TypeScript типы
├── scripts/migrations/     # SQL-миграции
├── docker-compose.dev.yml  # Локальный Docker
└── bin/                    # Скомпилированные бинарники
```

---

## 3. База данных PostgreSQL

### 3.1 Таблицы

#### `sites` — Мульти-теннант сайты
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| slug | TEXT UNIQUE | URL-идентификатор |
| domain | TEXT UNIQUE | Домен для определения сайта |
| name | TEXT | Название сайта |
| config | JSONB | Тема, настройки |
| is_active | BOOLEAN | Активен ли сайт |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | Триггер auto-update |

#### `accounts` — Источники видео (аккаунты Twitter/Instagram)
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| platform | TEXT | "twitter" или "instagram" |
| username | TEXT | @username (уникален внутри платформы) |
| platform_id | TEXT | ID аккаунта на платформе |
| display_name | TEXT NULL | Отображаемое имя |
| avatar_url | TEXT NULL | URL аватарки |
| follower_count | INTEGER NULL | Кол-во подписчиков |
| is_active | BOOLEAN DEFAULT true | Активен / отключён |
| is_paid | BOOLEAN DEFAULT false | Платный канал |
| paid_until | TIMESTAMPTZ NULL | Срок оплаты |
| parse_errors | INTEGER DEFAULT 0 | Счётчик ошибок парсинга |
| last_parsed_at | TIMESTAMPTZ NULL | Последний парсинг |
| max_parse_errors | INTEGER DEFAULT 5 | Порог отключения |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**UNIQUE INDEX:** (platform, username)

**Удаление:** `DELETE /admin/accounts/{id}` выполняет hard DELETE (не soft delete). CASCADE удаляет все связанные записи: videos, banners, parse_queue, banner_queue.

#### `videos` — Видео
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| account_id | BIGINT FK(accounts.id) | Источник |
| platform | TEXT | "twitter" / "instagram" |
| platform_id | TEXT | ID на платформе |
| original_url | TEXT | Ссылка на оригинал |
| title | TEXT NULL | Заголовок (AI или из поста) |
| description | TEXT NULL | Текст поста |
| duration_sec | INTEGER DEFAULT 0 | Длительность |
| thumbnail_url | TEXT NULL | URL тумбы (S3) |
| preview_url | TEXT NULL | URL превью-клипа (S3) |
| width | INTEGER DEFAULT 0 | |
| height | INTEGER DEFAULT 0 | |
| country_id | BIGINT NULL FK | Страна контента |
| ai_categories | JSONB | Кеш AI-категорий |
| ai_processed_at | TIMESTAMPTZ NULL | Когда AI обработал |
| view_count | BIGINT DEFAULT 0 | Кеш просмотров из ClickHouse |
| click_count | BIGINT DEFAULT 0 | Кеш кликов из ClickHouse |
| is_promoted | BOOLEAN DEFAULT false | Промо-видео |
| promoted_until | TIMESTAMPTZ NULL | Срок промо |
| promotion_weight | FLOAT DEFAULT 0 | Вес при сортировке |
| media_type | VARCHAR(8) DEFAULT 'video' | Тип контента: "video" или "image" |
| is_active | BOOLEAN DEFAULT true | Soft-delete |
| published_at | TIMESTAMPTZ NULL | Дата публикации на платформе |
| created_at | TIMESTAMPTZ | Когда добавлено в систему |
| updated_at | TIMESTAMPTZ | |

**UNIQUE INDEX:** (platform, platform_id)

#### `categories` — Категории видео
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| slug | TEXT UNIQUE | URL-идентификатор |
| name | TEXT | Название |
| parent_id | BIGINT NULL FK(self) | Иерархия |
| is_active | BOOLEAN DEFAULT true | |
| sort_order | INTEGER DEFAULT 0 | Порядок отображения |

#### `video_categories` — M2M: видео ↔ категории
| Поле | Тип | Описание |
|------|-----|----------|
| video_id | BIGINT FK | |
| category_id | BIGINT FK | |
| confidence | FLOAT | Уверенность AI (0..1) |

**PK:** (video_id, category_id)

#### `site_categories` — M2M: сайты ↔ категории
| Поле | Тип | Описание |
|------|-----|----------|
| site_id | BIGINT FK | |
| category_id | BIGINT FK | |
| sort_order | INTEGER DEFAULT 0 | Порядок на сайте |

**PK:** (site_id, category_id)

#### `site_videos` — M2M: сайты ↔ видео
| Поле | Тип | Описание |
|------|-----|----------|
| site_id | BIGINT FK | |
| video_id | BIGINT FK | |
| is_featured | BOOLEAN DEFAULT false | На главной |
| added_at | TIMESTAMPTZ | |

**PK:** (site_id, video_id)

#### `countries` — Страны
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| code | TEXT UNIQUE | ISO 3166-1 alpha-2 ("US") |
| name | TEXT | Название |

#### `parse_queue` — Очередь парсинга
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| account_id | BIGINT FK | |
| status | TEXT | "pending" / "running" / "done" / "failed" |
| started_at | TIMESTAMPTZ NULL | |
| finished_at | TIMESTAMPTZ NULL | |
| error | TEXT NULL | Текст ошибки |
| videos_found | INTEGER DEFAULT 0 | Сколько видео найдено |
| created_at | TIMESTAMPTZ | |

#### `banner_sizes` — Глобальные размеры баннеров
| Поле | Тип | Описание |
|------|-----|----------|
| id | SERIAL PK | |
| width | INT | Ширина в пикселях |
| height | INT | Высота в пикселях |
| label | VARCHAR(64) | Название (Medium Rectangle, Leaderboard, etc) |
| type | VARCHAR(16) DEFAULT 'image' | Тип промо: image (баннер) или video (preroll) |
| is_active | BOOLEAN DEFAULT true | Используется ли |
| created_at | TIMESTAMPTZ | |

**UNIQUE:** (width, height)

**Начальный размер:** 300x250 (Medium Rectangle, type=image)

#### `banners` — Сгенерированные баннеры
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| account_id | INT FK(accounts.id) | Аккаунт модели |
| video_id | BIGINT FK(videos.id) | Источник тумбы |
| banner_size_id | INT FK(banner_sizes.id) | Размер баннера |
| image_url | TEXT | URL на R2 |
| width | INT | Ширина |
| height | INT | Высота |
| is_active | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMPTZ | |

| video_frame_id | BIGINT NULL FK(video_frames.id) | Фрейм-источник (NULL = из thumbnail) |

**UNIQUE INDEXES (partial):**
- `uq_banners_thumb_size` — (video_id, banner_size_id) WHERE video_frame_id IS NULL — один баннер из thumbnail на видео на размер
- `uq_banners_frame_size` — (video_id, banner_size_id, video_frame_id) WHERE video_frame_id IS NOT NULL — один баннер на фрейм на размер

**INDEX:** idx_banners_account (account_id)

**InsertBanner upsert поведение:** При ON CONFLICT обновляет только image_url. НЕ сбрасывает is_active — если баннер был деактивирован вручную через админку, повторная генерация не реактивирует его.

**Деактивация:** `DELETE /admin/banners/{id}` ставит `is_active=false`. Деактивированные баннеры не участвуют в ротации (/b/serve) и не возвращаются по idx_banners_serve.

#### `video_frames` — Фреймы из видео (для баннеров)
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| video_id | BIGINT FK(videos.id) ON DELETE CASCADE | Видео-источник |
| frame_index | SMALLINT | Порядковый номер фрейма (0..N) |
| timestamp_ms | INT DEFAULT 0 | Таймстемп в миллисекундах (0 для image posts) |
| image_url | TEXT | URL на R2 |
| created_at | TIMESTAMPTZ | |

**UNIQUE:** (video_id, frame_index)
**INDEX:** idx_video_frames_video (video_id)

**Использование:** Хранит извлечённые фреймы из видео (4 кадра на равных интервалах) и изображения из Instagram carousel / image posts. Banner worker генерирует баннеры из этих фреймов в дополнение к thumbnail.

#### `banner_queue` — Очередь генерации баннеров
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| account_id | INT FK(accounts.id) | |
| video_id | BIGINT FK(videos.id) NULL | NULL = все видео аккаунта |
| status | VARCHAR(16) DEFAULT 'pending' | pending/running/done/failed |
| error | TEXT NULL | |
| created_at | TIMESTAMPTZ | |
| started_at | TIMESTAMPTZ NULL | |
| finished_at | TIMESTAMPTZ NULL | |

**INDEX:** idx_banner_queue_status (status, created_at)

### 3.2 Ключевые индексы
- `idx_videos_active` — (is_active, published_at DESC) WHERE is_active
- `idx_videos_popular` — (is_active, click_count DESC) WHERE is_active
- `idx_videos_promoted` — (is_promoted, promotion_weight DESC) WHERE is_promoted
- `idx_videos_platform_id` — (platform, platform_id)
- `idx_accounts_platform` — (platform)
- `idx_parse_queue_status` — (status, created_at)
- `idx_banners_account` — (account_id)
- `idx_banners_serve` — (width, height) WHERE is_active = true
- `idx_banner_queue_status` — (status, created_at)
- `idx_video_frames_video` — (video_id)
- `uq_banners_thumb_size` — (video_id, banner_size_id) WHERE video_frame_id IS NULL
- `uq_banners_frame_size` — (video_id, banner_size_id, video_frame_id) WHERE video_frame_id IS NOT NULL

---

## 4. ClickHouse — Аналитика

### 4.1 Таблица events (актуальная)
```sql
CREATE TABLE events (
    site_id     UInt64,
    video_id    UInt64,
    event_type  String,       -- 'impression', 'click', 'hover', 'view', 'profile_thumb_click', 'banner_impression', 'banner_click'
    session_id  String,
    user_agent  String,
    ip          String,
    referrer    String,
    extra       String,
    created_at  DateTime,
    -- Added in migration 012: device/browser/geo/UTM columns
    browser        LowCardinality(String) DEFAULT '',
    os             LowCardinality(String) DEFAULT '',
    device_type    LowCardinality(String) DEFAULT '',   -- 'desktop', 'mobile', 'tablet', 'bot'
    screen_width   UInt16 DEFAULT 0,
    screen_height  UInt16 DEFAULT 0,
    viewport_width  UInt16 DEFAULT 0,
    viewport_height UInt16 DEFAULT 0,
    language       LowCardinality(String) DEFAULT '',
    connection_type LowCardinality(String) DEFAULT '',  -- '4g', '3g', 'wifi', etc.
    page_url       String DEFAULT '',
    country        LowCardinality(String) DEFAULT '',
    utm_source     String DEFAULT '',
    utm_medium     String DEFAULT '',
    utm_campaign   String DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (site_id, created_at, event_type, video_id)
TTL created_at + INTERVAL 12 MONTH;
```

Данные пишутся через Go EventBuffer (batch INSERT каждые 1 сек или по 1000 событий).

Новые колонки заполняются через `enrichEvent()` в `banner.go` — серверный парсинг User-Agent (browser, OS, device_type) + клиентские данные из query params (screen, viewport, language, connection, UTM, page URL).

### 4.2 Materialized View: mv_banner_daily
```sql
CREATE MATERIALIZED VIEW mv_banner_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, video_id, account_id)
AS SELECT
    toDate(created_at) AS event_date,
    video_id, account_id,
    countIf(event_type = 'banner_impression') AS impressions,
    countIf(event_type = 'banner_click') AS clicks
FROM events
WHERE event_type IN ('banner_impression', 'banner_click')
GROUP BY event_date, video_id, account_id;
```

### 4.3 Таблица banner_perf (performance metrics)

```sql
CREATE TABLE banner_perf (
    banner_id UInt64,
    video_id UInt64,
    account_id UInt64,
    site_id UInt16,
    -- Performance timings
    image_load_ms UInt16,           -- Время загрузки изображения баннера
    render_ms UInt16,               -- Время рендеринга (DOMContentLoaded)
    time_to_visible_ms UInt32,      -- Время до видимости (IntersectionObserver)
    dwell_time_ms UInt32,           -- Общее время видимости баннера
    hover_duration_ms UInt16,       -- Длительность наведения мыши
    is_viewable UInt8,              -- IAB viewability: 50%+ видимо >= 1 сек
    -- User context
    browser LowCardinality(String),
    os LowCardinality(String),
    device_type LowCardinality(String),
    screen_width UInt16,
    screen_height UInt16,
    connection_type LowCardinality(String),
    country LowCardinality(String),
    -- Meta
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (site_id, banner_id, created_at)
TTL created_at + INTERVAL 6 MONTH;
```

Данные отправляются с клиента через `sendBeacon` на `/b/perf` при уходе посетителя со страницы (`beforeunload`/`visibilitychange`). Go API парсит JSON и записывает через `InsertPerfEvent()`.

### 4.4 Materialized View: mv_banner_perf_daily

```sql
CREATE MATERIALIZED VIEW mv_banner_perf_daily
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, banner_id, device_type)
TTL event_date + INTERVAL 12 MONTH
AS SELECT
    toDate(created_at) AS event_date,
    banner_id, device_type,
    countState() AS total_events,
    avgState(image_load_ms) AS avg_image_load_ms,
    avgState(render_ms) AS avg_render_ms,
    avgState(dwell_time_ms) AS avg_dwell_time_ms,
    quantileState(0.95)(image_load_ms) AS p95_image_load_ms,
    quantileState(0.95)(render_ms) AS p95_render_ms,
    sumState(toUInt64(is_viewable)) AS viewable_count
FROM banner_perf
GROUP BY event_date, banner_id, device_type;
```

### 4.5 Materialized View: mv_events_device_daily

```sql
CREATE MATERIALIZED VIEW mv_events_device_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_type, device_type, browser, os)
TTL event_date + INTERVAL 12 MONTH
AS SELECT
    toDate(created_at) AS event_date,
    event_type, device_type, browser, os,
    count() AS total_events
FROM events
GROUP BY event_date, event_type, device_type, browser, os;
```

### 4.6 Запросы для админ-статистики

Агрегация по видео:
```sql
SELECT video_id,
    countIf(event_type = 'impression') AS impressions,
    countIf(event_type = 'click') AS clicks,
    if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr
FROM events
WHERE event_type IN ('impression', 'click')
GROUP BY video_id
ORDER BY impressions DESC
```

Общие итоги сайта:
```sql
SELECT
    countIf(event_type = 'impression') AS total_impressions,
    countIf(event_type = 'click') AS total_clicks,
    if(total_impressions > 0, round(total_clicks * 100.0 / total_impressions, 2), 0) AS total_ctr
FROM events
WHERE event_type IN ('impression', 'click')
```

Воронка аккаунта (per-day funnel для GET /admin/accounts/{id}/stats):
```sql
SELECT
    toDate(created_at) AS event_date,
    countIf(event_type = 'impression') AS profile_views,
    countIf(event_type = 'click') AS ig_tw_clicks,
    countIf(event_type = 'social_click') AS paid_site_clicks,
    countIf(event_type = 'profile_thumb_click') AS video_clicks,
    uniqExact(session_id) AS sessions,
    avg(session_duration) AS avg_session_sec
FROM events
WHERE video_id IN (SELECT id FROM videos WHERE account_id = {account_id})
  AND created_at >= now() - INTERVAL {days} DAY
GROUP BY event_date
ORDER BY event_date DESC
```

Метрики воронки:
- **Profile Views** — показы профиля модели (impression events для видео аккаунта)
- **IG/Twitter Clicks** — клики на оригинальный контент (click events)
- **Paid Site Clicks** — клики на фансайт/OnlyFans (social_click events)
- **Video Clicks** — клики по тумбам на странице модели (profile_thumb_click events)
- **Sessions** — уникальные сессии
- **Avg Session Duration** — средняя длительность сессии

### 4.7 Traffic Explorer (динамическая аналитика)

Гибкий аналитический запрос с динамическим GROUP BY из whitelist-защищённых колонок.

**Доступные измерения (allowedDimensions):**
| Dimension | SQL Expression |
|-----------|---------------|
| date | `toString(toDate(created_at))` |
| source | `source` |
| referrer | `domain(referrer)` |
| country | `country` |
| device_type | `device_type` |
| os | `os` |
| browser | `browser` |
| event_type | `event_type` |
| utm_source | `utm_source` |
| utm_medium | `utm_medium` |
| utm_campaign | `utm_campaign` |

**Метрики:**
```sql
count() AS total_events,
countIf(event_type IN ('feed_impression', 'profile_thumb_impression', 'banner_impression')) AS impressions,
countIf(event_type IN ('feed_click', 'click', 'profile_thumb_click', 'banner_click')) AS clicks,
countIf(event_type = 'profile_view') AS profile_views,
countIf(event_type IN ('social_click', 'content_click')) AS conversions,
uniq(session_id) AS unique_sessions,
if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr,
if(clicks > 0, round(conversions * 100.0 / clicks, 2), 0) AS conversion_rate
```

**Фильтры:** source, country, device_type, os, browser, event_type, utm_source, utm_medium, utm_campaign, referrer — каждый через whitelist `allowedFilterColumns`.

**Сортировка (allowedTrafficSorts):** total_events, impressions, clicks, profile_views, conversions, unique_sessions, ctr, conversion_rate, dimension1, dimension2.

**SQL injection protection:** Все динамические части SQL (GROUP BY, WHERE фильтры, ORDER BY) строятся исключительно из whitelist-maps. Значения фильтров передаются через параметризованные запросы ClickHouse.

**API endpoints:**
- `GET /admin/traffic-stats` — параметры: `group_by` (обязательный), `group_by2` (опциональный), `days` (7/30/90), `sort_by`, `sort_dir` (asc/desc), + фильтры как query params (source, country, etc.)
- `GET /admin/traffic-stats/dimensions?days=N` — возвращает distinct значения для каждого фильтруемого измерения (для dropdown'ов в UI)

---

## 5. Go API — Эндпоинты

### 5.1 Публичные (с определением сайта)

Все требуют определения сайта через Host header или X-Site-Id.

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/v1/videos | Список видео (sort, page, per_page, category_id, country_id, category, exclude_account_id) |
| GET | /api/v1/videos/{id} | Детали видео (account включает social_links) |
| GET | /api/v1/search?q= | Полнотекстовый поиск |
| GET | /api/v1/categories | Категории сайта |
| GET | /api/v1/categories/{slug} | Детали категории |
| GET | /api/v1/accounts | Список аккаунтов с аватарами (AccountSummary, sorted by video count) |
| GET | /api/v1/accounts/{id} | Аккаунт с видео |
| POST | /api/v1/events | Одно аналитическое событие |
| POST | /api/v1/events/batch | Пакет событий (до 100) |

**Сортировка видео:** recent (по дате), popular (по просмотрам), random, promoted (по весу промо)

**Дополнительные параметры GET /api/v1/videos:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| `category` | string | Slug категории (резолвится в category_id внутри handler через CategoryStore) |
| `exclude_account_id` | int | Исключить видео конкретного аккаунта из результатов. Обходит Redis-кеш |

### 5.2 Админские (Bearer token auth)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /admin/stats | Общая статистика системы |
| GET | /admin/accounts | Список аккаунтов (фильтры: platform, status, paid) |
| POST | /admin/accounts | Создать аккаунт |
| PUT | /admin/accounts/{id} | Обновить (is_active, is_paid) |
| DELETE | /admin/accounts/{id} | Hard delete аккаунта (CASCADE: videos, banners, parse_queue, banner_queue) |
| POST | /admin/accounts/{id}/reparse | Парсинг одного аккаунта |
| POST | /admin/accounts/reparse-all | Парсинг всех аккаунтов |
| GET | /admin/queue | Очередь парсинга |
| POST | /admin/queue/retry-failed | Перезапуск упавших |
| DELETE | /admin/queue/failed | Очистка упавших |
| GET | /admin/videos | Список видео (category, uncategorized) |
| GET | /admin/videos/stats | Статистика видео (sort, dir, page) |
| DELETE | /admin/videos/{id} | Soft-delete видео |
| POST | /admin/videos/recategorize | AI пере-категоризация |
| GET | /admin/categories | Все категории |
| GET | /admin/sites | Все сайты |
| GET | /admin/banner-sizes | Список размеров баннеров |
| POST | /admin/banner-sizes | Добавить размер |
| PUT | /admin/banner-sizes/{id} | Вкл/выкл размер |
| GET | /admin/accounts/{id}/stats | Статистика воронки аккаунта (days=7/30/90) |
| GET | /admin/accounts/{id}/banners/summary | Кол-во баннеров по размерам |
| GET | /admin/accounts/{id}/banners | Список баннеров аккаунта (?size_id=) |
| POST | /admin/accounts/{id}/banners/generate | Ручной запуск генерации |
| POST | /admin/banners/{id}/recrop | Ручной re-crop баннера (body: {x, y, width, height} → crop + resize + upload → {image_url}) |
| DELETE | /admin/banners/{id} | Деактивация баннера (is_active=false) |
| POST | /admin/banners/batch-deactivate | Массовая деактивация баннеров (body: {ids: [...]}) |
| POST | /admin/banners/batch-regenerate | Массовая перегенерация баннеров (body: {ids: [...]}) |
| GET | /admin/banners | Все баннеры (Promo раздел) |
| GET | /admin/perf-summary | Сводка производительности баннеров (avg load time, viewability, dwell) за период |
| GET | /admin/device-breakdown | Разбивка по устройствам/браузерам/ОС за период |
| GET | /admin/referrer-stats | Топ источников трафика (referrer) за период |
| GET | /admin/accounts/{id}/conversion-prices | Список CPA цен для аккаунта |
| PUT | /admin/accounts/{id}/conversion-prices | Upsert CPA цены (body: {event_type, price}) |
| GET | /admin/traffic-stats | Traffic Explorer: гибкая аналитика с динамическим GROUP BY (group_by, group_by2, days, sort_by, sort_dir, фильтры) |
| GET | /admin/traffic-stats/dimensions | Distinct значения для фильтров Traffic Explorer (source, country, device_type, etc.) |

### 5.3 Публичные баннерные роуты (без авторизации)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /b/serve | Динамический сервинг: интерактивный HTML-баннер с hover-эффектами из пула (iframe embed) |
| GET | /b/loader.js | Embed-скрипт (~1.5KB) для контекстного таргетинга баннеров |
| GET | /b/{id} | 302 redirect на R2 URL + banner_impression в ClickHouse |
| GET | /b/{id}/preview | Admin preview: рендерит баннер в выбранном HTML-стиле (?style=bold/elegant/minimalist/card) |
| GET | /b/{id}/click | 302 redirect на /model/{slug} + banner_click в ClickHouse |
| POST | /b/perf | Performance beacon — принимает JSON с метриками производительности баннера (sendBeacon) |

**GET /b/serve** — параметры:
| Параметр | Тип | Описание |
|----------|-----|----------|
| `size` | string | Размер `WxH` (напр. `300x250`). Альтернативно: `w` + `h` отдельно |
| `cat` | string | Slug категории (опционально) |
| `kw` | string | Категория — treated as category slug, JOIN по video_categories (опционально) |
| `aid` | int | Account ID (опционально) |
| `style` | string | Стиль HTML-шаблона баннера: `bold`, `elegant`, `minimalist`, `card` (по умолчанию: случайный) |

Ответ — интерактивная HTML-страница с CSS hover-эффектами (scale, glow, opacity transitions).
Баннер использует raw thumbnail вместо статического JPEG, отображает @username и CTA-кнопку.
4 стиля шаблонов: **bold** (pink border + gradient CTA pill), **elegant** (gold accents + serif font + backdrop-filter blur), **minimalist** (clean overlay + subtle watermark), **card** (dark bottom bar + play button + red accent).
Пустой пул → пустая прозрачная страница (graceful degradation).
Headers: `Cache-Control: no-cache, no-store`, без `X-Frame-Options` (разрешён iframe).

**GET /b/loader.js** — embed-скрипт для контекстного таргетинга:

Лёгкий JS (~1.5KB), который издатель вставляет на свою страницу. Скрипт автоматически:
1. Читает контекст страницы: `<title>`, meta description, meta keywords, og:title, og:description, `<h1>`, URL path
2. Выполняет частотный анализ слов, отфильтровывая ~80 стоп-слов (a, the, is, and, etc.)
3. Извлекает top-5 ключевых слов
4. Динамически создаёт iframe, указывающий на `/b/serve?kw=keyword1,keyword2,...`
5. Реализует lazy loading через IntersectionObserver (rootMargin 200px) для баннеров ниже fold

Атрибуты на теге `<script>`:
| Атрибут | Тип | Описание |
|---------|-----|----------|
| `data-size` | string | Размер баннера `WxH` (напр. `300x250`). Default: `300x250` |
| `data-style` | string | Стиль баннера: `bold`, `elegant`, `minimalist`, `card`. Default: случайный |
| `data-src` | string | Источник трафика (напр. `adnet1`). Прокидывается как `src` параметр |
| `data-click-id` | string | Click ID рекламной сети. Прокидывается как `click_id` параметр |

Пример использования издателем:
```html
<script async src="https://api.temptguide.com/b/loader.js" data-size="300x250" data-src="adnet1"></script>

<!-- С выбором стиля -->
<script async src="https://api.temptguide.com/b/loader.js" data-size="300x250" data-style="bold"></script>
```

Headers: `Cache-Control: public, max-age=86400` (24h кеш), CORS `Access-Control-Allow-Origin: *`.
Не требует изменений в БД — использует существующий `/b/serve` эндпоинт и `kw` параметр.

### 5.4 Middleware

1. **Request ID** — трекинг запросов
2. **Real IP** — извлечение X-Forwarded-For
3. **Structured Logging** — JSON через slog
4. **Panic Recovery** — graceful ошибки
5. **CORS** — разрешены все origins
6. **Rate Limiter** — token bucket (100 RPS)
7. **Site Detection** — определение сайта по Host/X-Site-Id
8. **Admin Auth** — Bearer token проверка

### 5.5 Кеширование (Redis)

| Ключ | TTL | Содержание |
|------|-----|-----------|
| vl:{site}:{sort}:{cat}:{country}:{page} | 60s | Список видео |
| vd:{video_id} | 300s | Детали видео |
| cat:{site_id} | 60s | Категории сайта |
| catd:{site}:{slug} | 300s | Детали категории |
| acc:{account_id} | 300s | Аккаунт с видео |
| acl:{site_id} | 60s | Список аккаунтов (AccountSummary) |
| src:{site}:{query}:{page} | 60s | Результаты поиска |
| bp:{w}x{h} | 60s | Пул баннеров по размеру ([]ServableBanner: id, aid, vid, url, thumb, user, w, h) |
| bp:{w}x{h}:{cat} | 60s | Пул баннеров по размеру + категории |
| bp:{w}x{h}:a{aid} | 60s | Пул баннеров по размеру + аккаунту |

Кеш обходится для random сортировки и при `exclude_account_id`.

### 5.6 Banner Metrics & Analytics System

Комплексная система метрик и аналитики баннеров, включающая серверный парсинг User-Agent, клиентский сбор контекста, performance beacons и административный дашборд.

#### 5.6.1 User-Agent Parsing (ua.go)

Серверный парсинг User-Agent через библиотеку `mssola/useragent`. Модуль `api/internal/handler/ua.go`:

| Функция | Возвращает | Описание |
|---------|-----------|----------|
| `parseBrowser(ua)` | string | Название браузера: Chrome, Firefox, Safari, Edge, Opera, Samsung Browser, UC Browser, Other |
| `parseOS(ua)` | string | ОС: Windows, macOS, Linux, Android, iOS, Chrome OS, Other |
| `parseDeviceType(ua)` | string | Тип устройства: mobile, tablet, desktop, bot |

Определение типа устройства основано на:
- `ua.Mobile()` → mobile (если не tablet)
- Keywords в UA-строке: "iPad", "Tablet", "Tab" → tablet
- `ua.Bot()` → bot
- Fallback → desktop

#### 5.6.2 Event Enrichment (enrichEvent)

Функция `enrichEvent(e *model.Event, r *http.Request)` в `banner.go` обогащает каждое banner-событие:

**Серверная сторона (из HTTP request):**
- `browser`, `os`, `device_type` — из User-Agent (ua.go)
- `referrer` — из `Referer` header
- `ip` — из `X-Real-IP` / `X-Forwarded-For`

**Клиентская сторона (из query params, прокидываются через JS в loader.js):**
- `sw`, `sh` — screen width/height (`screen.width`, `screen.height`)
- `vw`, `vh` — viewport width/height (`innerWidth`, `innerHeight`)
- `lang` — navigator.language
- `conn` — navigator.connection.effectiveType (4g, 3g, wifi)
- `page` — page URL (encodeURIComponent)
- `utm_source`, `utm_medium`, `utm_campaign` — UTM параметры
- `ref` — referrer

#### 5.6.3 Performance Beacon (POST /b/perf)

Эндпоинт для сбора метрик производительности баннера. Вызывается клиентским JS через `navigator.sendBeacon` при `beforeunload` / `visibilitychange`.

**Структура PerfEvent (model/event.go):**
```go
type PerfEvent struct {
    BannerID        int64   `json:"banner_id"`
    VideoID         int64   `json:"video_id"`
    AccountID       int64   `json:"account_id"`
    ImageLoadMs     int     `json:"image_load_ms"`     // Время загрузки изображения
    RenderMs        int     `json:"render_ms"`         // Время рендеринга (DOMContentLoaded)
    TimeToVisibleMs int     `json:"ttv_ms"`            // IntersectionObserver: время до видимости
    DwellTimeMs     int     `json:"dwell_ms"`          // Общее время видимости
    HoverDurationMs int     `json:"hover_ms"`          // Длительность наведения мыши
    IsViewable      bool    `json:"viewable"`          // IAB viewability: >=50% видимо >= 1 сек
}
```

**Клиентский JS в banner templates:**
- IntersectionObserver с threshold 0.5 для IAB viewability (50%+ видимо >= 1 сек)
- `performance.now()` для render time
- Image `onload` событие для image load time
- `mouseenter`/`mouseleave` для hover duration
- `beforeunload` + `visibilitychange` → `sendBeacon` на `/b/perf`

#### 5.6.4 Admin Dashboard: Performance Tab

Вкладка **Performance** в разделе Promo (`web/src/app/admin/promo/page.tsx`):

**Overview Cards:**
- Avg Image Load Time (ms)
- Avg Render Time (ms)
- Viewability Rate (%)
- Avg Dwell Time (sec)

**Device/Browser Breakdown:**
- Таблица с разбивкой по device_type, browser, OS
- Показывает total events, avg load time, viewability

**Top Referrers:**
- Таблица с топ-источниками трафика (referrer URL → кол-во событий)

**Период:** переключатель 7 / 30 / 90 дней.

**API endpoints:**
| Метод | Путь | Описание |
|-------|------|----------|
| GET | /admin/perf-summary?days=N | Сводка: avg image_load_ms, avg render_ms, viewability %, avg dwell_time |
| GET | /admin/device-breakdown?days=N | Разбивка: [{device_type, browser, os, total_events}] |
| GET | /admin/referrer-stats?days=N | Топ referrers: [{referrer, total_events}] |

**ClickHouse queries (reader.go):**
- `GetPerfSummary(days)` — агрегация из `banner_perf`: AVG(image_load_ms), AVG(render_ms), AVG(dwell_time_ms), SUM(is_viewable)/COUNT(*)
- `GetDeviceBreakdown(days)` — агрегация из `events`: GROUP BY device_type, browser, os
- `GetReferrerStats(days)` — агрегация из `events`: GROUP BY referrer, TOP N

---

## 6. Python Parser

### 6.1 CLI команды

```bash
python -m parser parse <username>          # Парсить один аккаунт
python -m parser parse --platform instagram <username>
python -m parser worker                    # Фоновый воркер
python -m parser add <username>            # Добавить и поставить в очередь
python -m parser categorize                # Запустить AI-категоризацию
python -m parser find "keyword" --count 5  # Найти аккаунты по ключевому слову
```

**Worker** запускает одновременно parse_worker_loop, banner_worker_loop и categorizer_worker_loop через `asyncio.gather`.

### 6.2 Логика парсинга

1. Воркер забирает pending задачи из parse_queue
2. Вызывает парсер платформы (Twitter через yt-dlp, Instagram через httpx)
3. Для каждого видео/поста:
   - Определяет `media_type`: "video" или "image" (Instagram photos/carousels, Twitter image tweets)
   - Скачивает thumbnail, ресайзит до 480x270
   - Генерирует 5-сек превью через ffmpeg (500k bitrate, 480p) — только для video
   - **Frame extraction** (видео): извлекает 4 кадра на равных интервалах через ffmpeg → `video_frames`
   - **Image posts** (Instagram photos/carousels, Twitter images): изображения сохраняются как фреймы в `video_frames`
   - Загружает в S3: `thumbnails/`, `previews/`, `frames/{platform}/{platform_id}_f{index}.jpg`
   - Записывает в PostgreSQL (videos + video_frames)
4. Обновляет статус задачи (done/failed)
5. При ошибках увеличивает parse_errors; после 5 ошибок — отключает аккаунт

### 6.3 AI категоризация (parser/categorizer/)

**Архитектура:** Модуль `parser/categorizer/` содержит полный пайплайн AI-категоризации видео через OpenAI GPT-4o Vision.

**Компоненты:**
- `parser/categorizer/categories.py` — 67 категорий, захардкожены (slug + name)
- `parser/categorizer/vision.py` — основная логика: формирование промпта, вызов OpenAI GPT-4o Vision API, парсинг ответа
- `parser/categorizer/pipeline.py` — PipelineConfig с openai_api_key
- `parser/categorizer/worker.py` — `categorizer_worker_loop` — фоновый цикл, опрашивает БД

**Пайплайн:**
1. Забирает видео без `ai_processed_at` (WHERE ai_processed_at IS NULL AND is_active = true)
2. Батчами по N видео (CATEGORIZER_BATCH_SIZE, default 50) отправляет в OpenAI GPT-4o API
3. GPT-4o анализирует metadata (title, description) + thumbnail (vision) — изображение скачивается и передаётся как base64
4. Промпт содержит список из 67 допустимых категорий; GPT-4o выбирает 1-5 наиболее подходящих
5. Возвращает категории с confidence (0.0..1.0)
6. Категории автоматически создаются в таблице `categories` если ещё не существуют (INSERT ON CONFLICT DO NOTHING)
7. Записывает результат в `video_categories` (video_id, category_id, confidence)
8. Обновляет `videos.ai_processed_at` и `videos.ai_categories` (JSONB кеш)

**Таблицы:**
- `categories` — мастер-список категорий (auto-created из AI ответов)
- `video_categories` — связь видео↔категории с confidence (PK: video_id + category_id)
- `site_categories` — видимость категорий на конкретных сайтах (PK: site_id + category_id)

**Запуск:** Работает как часть parser-worker — `categorizer_worker_loop` запускается в `asyncio.gather` вместе с `parse_worker_loop` и `banner_worker_loop`. При отсутствии OPENAI_API_KEY — логирует предупреждение и не запускается (graceful skip).

**Ручной запуск:** `python -m parser categorize`

**Конфиг:**
| Параметр | Default | Описание |
|----------|---------|----------|
| OPENAI_API_KEY | — | Ключ API OpenAI (обязателен) |
| CATEGORIZER_BATCH_SIZE | 50 | Размер батча видео |
| CATEGORIZER_CONCURRENCY | 5 | Параллельные запросы к API |

**Статус (2026-03-05):** Код полностью готов и задеплоен. Switched from Anthropic Claude Sonnet to OpenAI GPT-4o. Результаты первого прогона: 370 видео обработано, 41 категория создана, 1649 связей video_categories.

### 6.4 Настройки парсера

| Параметр | Default | Описание |
|----------|---------|----------|
| parse_interval_sec | 30 | Интервал опроса очереди |
| max_parse_errors | 5 | Порог отключения аккаунта |
| thumbnail_width | 480 | Ширина тумбы |
| thumbnail_height | 270 | Высота тумбы |
| preview_duration_sec | 5 | Длительность превью |
| preview_video_bitrate | 500k | Битрейт превью |
| ytdlp_max_videos | 50 | Макс. видео за парсинг |
| instagram_rate_limit_sec | 5 | Задержка между запросами IG |
| banner_quality | 90 | JPEG quality баннеров |
| banner_poll_interval_sec | 10 | Интервал опроса banner_queue |
| frame_extraction_count | 4 | Кол-во фреймов извлекаемых из видео |
| frame_extraction_quality | 85 | JPEG quality извлечённых фреймов |
### 6.5 Извлечение фреймов (parser/utils/image.py)

**extract_frames(video_path, count=4, quality=85)** — извлекает N кадров из видео на равных интервалах:
1. Определяет длительность видео через ffprobe
2. Вычисляет таймстемпы: `[duration * i / (count+1) for i in 1..count]`
3. Извлекает каждый кадр через ffmpeg `-ss {timestamp} -frames:v 1`
4. Сохраняет как JPEG с заданным quality
5. Возвращает список `(path, timestamp_ms)`

Для image posts (Instagram photos, carousels, Twitter images) фреймы создаются напрямую из скачанных изображений без ffmpeg.

### 6.6 Генерация баннеров (parser/utils/image.py)

**Зависимости:** opencv-python-headless (OpenCV), numpy, Pillow, fonts-dejavu-core (Docker)

**Пайплайн:**
1. **smart_crop(img, width, height)** — face-aware crop через OpenCV Haar cascade:
   - Обнаружение лиц/тел: frontal face → profile face → upper body (приоритет)
   - Downscale до 640px для скорости, grayscale → detectMultiScale
   - Позиционирование кропа вокруг взвешенного центра обнаруженных лиц (больше лицо = больше вес)
   - Fallback: center-crop с upper-third bias (если лица не обнаружены)
   - Стоимость: бесплатно (локальная библиотека)
2. **Pillow Lanczos resize** — ресайз до целевого размера в пикселях после crop
3. **enhance_image(img)** — программное улучшение цвета через Pillow ImageEnhance:
   - Contrast: 1.35 (+35%)
   - Color saturation: 1.4 (+40%)
   - Sharpness: 1.5 (+50%)
   - Brightness: 1.05 (+5%)
4. **_pillow_overlay(img)** — Bold-style overlay:
   - Dark tint (30% чёрный) + bottom gradient (55% height, 85%→transparent)
   - Gradient CTA pill (pink→orange) "WATCH ME NOW"
   - Tagline "EXCLUSIVE CONTENT"
   - 3px pink border
5. **generate_banner(src, dest, w, h, quality, username)** — полный пайплайн: OpenCV smart crop → Pillow resize (Lanczos) → Pillow enhance → overlay → JPEG

---

## 7. Next.js Frontend

### 7.1 Публичные страницы

| URL | Файл | Описание |
|-----|------|----------|
| / | app/page.tsx | Главная — ProfileStories + сетка видео |
| /search?q= | app/search/page.tsx | Explore/Поиск (без запроса: категории + random grid; с запросом: результаты поиска) |
| /video/[id] | app/video/[id]/page.tsx | Страница видео |
| /category/[slug] | app/category/[slug]/page.tsx | Категория |
| /model/[slug] | app/model/[slug]/page.tsx | Профиль модели (видео + similar models) |

### 7.2 Админ-панель

| URL | Описание |
|-----|----------|
| /admin/login | Авторизация (токен в cookie) |
| /admin | Dashboard — статистика |
| /admin/accounts | Управление аккаунтами |
| /admin/queue | Очередь парсинга |
| /admin/videos | Управление видео |
| /admin/stats | Аналитика: табы Traffic Explorer (default) + Video Stats. Traffic Explorer — гибкая аналитика с group by, фильтрами, 8 метриками |
| /admin/categories | Категории |
| /admin/promo | Все баннеры + управление размерами |
| /admin/accounts/[id] | Профиль аккаунта (табы: Stats (default), Fan Site Links, Promo). Promo tab: все баннеры без пагинации, mass selection с Select All, batch deactivate/regenerate, style preview (iframe), re-grab. Promo tab также содержит секцию "Conversion Prices" — per-event-type CPA цены для постбеков |

**Авторизация:** cookie `admin_token` → Bearer token к Go API. Cookie `admin_authed=1` для фронтенд-проверки.

### 7.3 Ключевые компоненты

- **VideoGrid** — адаптивная сетка видео-карточек
- **VideoCard** — тумба + title + аккаунт + статистика. Принимает `priority` prop для eager-loading LCP-изображения (первая карточка в фиде). Responsive `sizes` для оптимальной загрузки
- **ViewTracker** — IntersectionObserver для трекинга просмотров
- **CategoryNav** — навигация по категориям (client component)
- **SortControls** — переключатель сортировки
- **SearchBar** — поиск
- **ProfileStories** — Instagram-style горизонтальная лента аватаров (56px круги с gradient ring); данные из GET /api/v1/accounts; ссылки на /model/{slug}; aria-labels и исправленный alt text для accessibility
- **ExploreGrid** — 3-колоночная сетка тумб с infinite scroll (useInfiniteScroll хук); показывает random видео на странице поиска при отсутствии запроса
- **CategoryGrid** — сетка категорий-pills (4x3); expandable с кнопкой "More..." (11 → 32 категории)
- **BottomNav** — нижняя навигация: Home, Search, Shuffle (3 вкладки). aria-labels на всех ссылках для accessibility
- **ProfileGrid** — сетка тумб на странице модели; клик открывает оригинальный URL (Instagram/Twitter) напрямую + трекает `profile_thumb_click`
- **SimilarModels** — секция «Similar Models» на странице профиля; 3-колоночная сетка с аватарами; показывается только для free (не paid) аккаунтов; загружает популярные видео из той же категории, исключая текущий аккаунт
- **OnlyFansContext** (`web/src/contexts/OnlyFansContext.tsx`) — React Context + Provider для передачи OnlyFans URL, displayName и avatarUrl из страниц (model profile, video detail) в глобальный Header. Компонент `OnlyFansHeaderSetter` вызывает `setOnlyFansUrl()`, `setDisplayName()`, `setAvatarUrl()` через useEffect при маунте страницы и очищает при анмаунте
- **Header (sticky profile mode)** (`web/src/components/Header.tsx`) — на страницах модели (`/model/[slug]`) и видео (`/video/[id]`), Header показывает аватар модели + display name слева (вместо логотипа сайта), и синюю pill-кнопку "Follow me" с иконкой OF справа (если есть OnlyFans ссылка). На остальных страницах (главная, поиск, категории) Header показывает стандартный логотип сайта. Клик по OF-кнопке открывает OnlyFans профиль в новой вкладке и трекает `social_click`
- **AdminShell** — layout админки (sidebar + header)

### 7.4 TypeScript типы

```typescript
interface Video {
  id: string; title: string; thumbnail_url: string; preview_url: string;
  original_url: string; platform: "twitter" | "instagram";
  duration_sec: number; view_count: number; click_count: number;
  account: Account; categories: Category[]; country: Country;
}

interface Account {
  username: string; avatar_url: string; platform: "twitter" | "instagram";
  social_links?: Record<string, string>; // e.g. { onlyfans: "https://onlyfans.com/model" }
}

interface Category { slug: string; name: string; video_count?: number; }

interface AccountSummary {
  id: string; username: string; slug: string;
  display_name: string; avatar_url: string;
}

interface VideoQueryParams {
  sort?: string; page?: number; per_page?: number;
  category_id?: number; country_id?: number;
  category?: string;           // slug — resolved to ID server-side
  exclude_account_id?: number; // exclude videos from this account
}

interface VideosResponse {
  videos: Video[]; total: number; page: number; per_page: number; pages: number;
}
```

### 7.5 SEO

#### Open Graph & Twitter Card Images

Динамическая генерация OG-изображений для ссылок в соцсетях:
- `web/src/app/opengraph-image.tsx` — генерирует 1200x630 PNG с тёмным градиентом и брендингом TemptGuide
- `web/src/app/twitter-image.tsx` — аналогичное изображение для Twitter Cards

#### Metadata Pattern (generateMetadata)

Все динамические страницы реализуют `generateMetadata()` с полным набором meta-тегов:

| Страница | Файл | Особенности metadata |
|----------|------|---------------------|
| / (homepage) | app/page.tsx | canonical URL |
| /video/[id] | app/video/[id]/page.tsx | Fallback для emoji-only заголовков → "Video by @username on Platform" |
| /model/[slug] | app/model/[slug]/page.tsx | Twitter card (summary_large_image), sanitized bio (strip newlines, max 155 chars) |
| /category/[slug] | app/category/[slug]/page.tsx | Twitter card metadata |
| /country/[code] | app/country/[code]/page.tsx | Twitter card metadata |
| /account/[platform]/[username] | app/account/[platform]/[username]/page.tsx | Twitter card metadata |
| /categories | app/categories/page.tsx | Improved description, canonical URL |

#### Sitemap (app/sitemap.ts)

Динамическая генерация sitemap.xml с покрытием:
- Homepage (`/`)
- `/categories` page
- Model profile pages (`/model/{slug}`) — через `getAccounts()` API
- Account pages (`/account/{platform}/{username}`) — через `getAccounts()` API
- 15 country pages (`/country/{code}`)
- Paginated videos — до 500 видео (5 страниц по 100)

#### robots.txt (app/robots.ts)

Disallow list:
- `/api/` — API эндпоинты
- `/search` — поисковая страница (дублирует контент)
- `/admin` — админ-панель

Sitemap URL: `https://temptguide.com/sitemap.xml`

#### Structured Data (JSON-LD)

Компонент `web/src/components/JsonLd.tsx` генерирует structured data:

| Тип | Страница | Поля |
|-----|----------|------|
| VideoObject | /video/[id] | name, description, thumbnailUrl, uploadDate (из video.published_at), duration, contentUrl |
| Person | /model/[slug] | name, url, image |
| BreadcrumbList | /video/[id], /model/[slug] | Навигационная цепочка |
| WebSite + SearchAction | / (layout) | Поисковый интент для Google Sitelinks |

#### Heading Hierarchy

Все публичные страницы используют правильную иерархию заголовков:
- Homepage: скрытый `<h1>` для SEO
- /categories: `<h1>` вместо `<p>` для "Browse Categories"
- /category/[slug]: `<h1>` для названия категории
- /account/[platform]/[username]: `<h1>` для username

#### Image Domain Restrictions & Formats (next.config.mjs)

Вместо wildcard `**` — ограниченный список CDN-доменов:
- `media.temptguide.com` (R2 CDN)
- `*.cdninstagram.com` (Instagram)
- `*.fbcdn.net` (Facebook CDN / Instagram)
- `pbs.twimg.com` (Twitter)
- `abs.twimg.com` (Twitter)

**Image formats:** AVIF и WebP включены в `images.formats` — Next.js автоматически отдаёт оптимальный формат по Accept header браузера. AVIF даёт ~50% экономию размера vs JPEG.

#### Lighthouse Scores (2026-03-07, updated)
| Метрика | До | После |
|---------|-----|-------|
| Performance | 76 | ~95+ |
| SEO | 100 | 100 |
| Best Practices | 96 | 100 |
| Accessibility | 79 | ~95+ |
| LCP (mobile) | 5.9s | ~2.5s |

**Оптимизации (2026-03-07):**
- **LCP fix:** `priority` prop на первой VideoCard (InfiniteVideoGrid передаёт priority=true для index 0), responsive `sizes` атрибут
- **Image formats:** AVIF/WebP включены в next.config.mjs (`images.formats: ['image/avif', 'image/webp']`)
- **Accessibility:** aria-labels на BottomNav, ProfileStories, share button; color contrast txt-muted #6b6b6b→#808080 (4.87:1 ratio); убран redundant alt на аватарах; увеличены touch targets на category links
- **Favicon:** заменён пустой favicon.ico на SVG icon (`web/src/app/icon.svg`)

---

## 8. Data Flow — Потоки данных

### 8.1 Добавление видео
```
Admin → POST /admin/accounts (создаёт аккаунт в PG)
     → POST /admin/accounts/{id}/reparse (ставит в очередь)
     → Parser Worker забирает задачу из parse_queue
     → Парсер скачивает видео/изображения с платформы (media_type: video/image)
     → Генерит тумбы + превью → S3
     → Извлекает фреймы: 4 кадра из видео (ffmpeg) / изображения из carousel → video_frames
     → INSERT в videos + video_frames + site_videos
     → AI Categorizer → GPT-4o Vision → video_categories
```

### 8.2 Отображение на фронте
```
User → GET localhost:3000
     → Next.js SSR → GET /api/v1/videos (Host→site detection)
     → Go API → Redis cache hit? → return cached
     → Cache miss → PostgreSQL query (JOIN site_videos, categories, accounts)
     → Cache result in Redis (60s) → JSON response
     → Next.js renders VideoGrid → HTML to browser
```

### 8.3 Аналитика
```
Посетитель видит тумбу (50%+ в viewport) → sendBeacon → POST /api/v1/events (type=impression)
Посетитель кликает → sendBeacon → POST /api/v1/events (type=click)
Go API → EventBuffer (in-memory, max 1000 или 1s)
       → Batch INSERT в ClickHouse events table
Админ → /admin/stats → Go API → агрегация из ClickHouse + метаданные из PG
```

### 8.4 Генерация баннеров (multi-frame)
```
Триггеры:
  - Новое видео у paid-аккаунта → parse_worker enqueue в banner_queue
  - Аккаунт стал paid (is_paid: false→true) → Go API enqueue в banner_queue (video_id=NULL)

Banner Worker забирает задачу из banner_queue
→ Получает active banner_sizes
→ Если video_id=NULL → все видео аккаунта, иначе конкретное видео
→ Для каждого video:
   1. Получает фреймы из video_frames (0..N extracted frames)
   2. Генерирует баннер из thumbnail (video_frame_id=NULL):
      → Скачать thumbnail_lg_url (810x1440 портрет)
      → OpenCV face-aware smart crop → Lanczos resize → ImageEnhance → overlay → JPEG q=90
      → R2: banners/{account_id}/{video_id}_{w}x{h}.jpg
      → INSERT banners (video_frame_id=NULL)
   3. Генерирует баннер из каждого фрейма (video_frame_id=frame.id):
      → Скачать frame image_url
      → OpenCV face-aware smart crop → Lanczos resize → ImageEnhance → overlay → JPEG q=90
      → R2: banners/{account_id}/{video_id}_f{frame_id}_{w}x{h}.jpg
      → INSERT banners (video_frame_id=frame.id)
→ Результат: до 5 вариантов баннера на видео (1 thumbnail + 4 frames) × N sizes
→ CTR-based selection естественно выбирает лучший вариант при показе
→ Обновить статус задачи (done/failed)
```

### 8.5 Ручной re-crop баннера (admin)
```
Админ → /admin/accounts/{id} → Promo tab → Crop icon на карточке баннера
→ Frontend: react-easy-crop modal с aspect-ratio-locked кропом + zoom controls
→ Пользователь выбирает область кропа → отправляет координаты
→ POST /api/v1/admin/banners/{id}/recrop (body: {x, y, width, height})
→ Go API RecropBanner handler:
  1. Lookup banner по ID → получить source_image_url (frame image_url или video thumbnail_lg_url)
  2. Скачать source image по URL (http.Get)
  3. image.Decode → SubImage(crop rect) → resize до banner dimensions (draw.CatmullRom)
  4. JPEG encode (quality 90)
  5. Upload в R2 через S3 client (api/internal/s3/client.go): banners/{account_id}/{video_id}_{w}x{h}.jpg
  6. UPDATE banners SET image_url = new_url WHERE id = {id}
  7. Response: { image_url: "https://media.temptguide.com/banners/..." }
→ Frontend обновляет карточку баннера с новым URL
```

**S3 client (api/internal/s3/client.go):**
- Использует `aws-sdk-go-v2` для загрузки файлов в R2 (S3-совместимый API)
- Инициализируется из ENV: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION, S3_PUBLIC_URL
- Метод `Upload(ctx, key, body, contentType)` → public URL
- Используется RecropBanner handler для загрузки перекропленных баннеров

**Source image resolution:**
- Если `video_frame_id IS NOT NULL` → source = `video_frames.image_url` (extracted frame)
- Если `video_frame_id IS NULL` → source = `videos.thumbnail_lg_url` (original thumbnail)
- Поле `source_image_url` добавлено в `AdminBanner` модель и API ответ

### 8.6 Serving баннеров (статический, по ID)
```
Рекламная сеть показывает IMG → GET /b/{id}
→ Go API: lookup banner по ID
→ Записать banner_impression в ClickHouse EventBuffer
→ 302 redirect на R2 URL (CDN отдаёт изображение)

Клик по баннеру → GET /b/{id}/click
→ Go API: lookup banner → account slug
→ Записать banner_click в ClickHouse EventBuffer
→ 302 redirect на SITE_BASE_URL/model/{slug}
```

### 8.7 Динамический сервинг баннеров (iframe embed)
```
Внешний сайт: <iframe src="temptguide.com/b/serve?size=300x250&cat=xxx&style=bold">
→ Next.js rewrite /b/* → Go API (http://api:8080)
→ Go API /b/serve:
  1. Парсит size (WxH), cat, kw, aid, style
  2. kw treated as category slug (same as cat) → Redis GET по ключу bp:{w}x{h}[:cat|:a{aid}]
  3. Cache miss → SQL (JOIN banners/videos/accounts, +categories если cat/kw) → Redis SET (TTL 60s)
  4. selectBestBanner(pool) → CTR-based selection:
     - Query ClickHouse GetBannerStats for each banner's CTR per video_id
     - Pick banner with highest CTR
     - Equal CTR → random fallback
  5. Push banner_impression event (source=serve) → EventBuffer → ClickHouse
  6. pickBannerStyle(style) → выбор HTML-шаблона (bold/elegant/minimalist/card, default: random)
  7. Рендер Go html/template с данными: ThumbnailURL, Username, ClickURL, HoverURL, Width, Height
  8. Ответ: интерактивный HTML с CSS hover-эффектами (scale, glow, opacity transitions)

HTML-шаблоны (banner_templates.go):
  - bold: pink border + gradient CTA pill "Watch Me Now" + "Exclusive Content" tagline
  - elegant: gold accents + serif font + diamond ornament + bottom gradient only
  - minimalist: clean overlay + subtle "TemptGuide" watermark + arrow CTA
  - card: dark bottom bar (25%) + photo area (75%) + play button + red accent line

Все шаблоны: CSS filters (contrast 1.15, saturate 1.2, brightness 1.05), на hover ярче.
Минимальные тёмные градиенты (только снизу для читаемости текста).
Каждый шаблон включает: mouseenter hover tracking (JS → 1x1 GIF pixel)

Hot path (cache hit): < 2ms
Cold path (cache miss): ~20ms (SQL + Redis SET), раз в 60 сек на ключ
Пустой пул → пустая HTML-страница (graceful degradation)
```

### 8.8 Контекстный таргетинг (loader.js)
```
Сайт издателя: <script async src="api.temptguide.com/b/loader.js" data-size="300x250" data-style="bold">
→ GET /b/loader.js (24h кеш) → JS ~1.5KB
→ JS на странице издателя:
  1. Читает data-style из <script> тега (bold/elegant/minimalist/card, по умолчанию: не передаётся → случайный)
  2. Читает <title>, meta description, meta keywords, og:*, <h1>, URL path
  3. Частотный анализ: tokenize → фильтр ~80 стоп-слов → top-5 ключевых слов
  4. IntersectionObserver (rootMargin 200px): ждёт пока placeholder приближается к viewport
  5. Lazy: создаёт <iframe src="/b/serve?size=300x250&kw=keyword1,keyword2&style=bold&src=...&click_id=...">
→ Дальше стандартный flow /b/serve (см. 8.6)
```

### 8.9 Banner Performance Metrics Collection
```
Баннер загружается в iframe на стороннем сайте:
→ loader.js собирает клиентский контекст: screen, viewport, language, connection, UTM, referrer, page URL
→ Прокидывает параметры в /b/serve?sw=1920&sh=1080&vw=800&vh=600&lang=en-US&conn=4g&...
→ Go API enrichEvent(): парсит User-Agent (browser, OS, device_type) + читает query params
→ Записывает обогащённое banner_impression событие в ClickHouse events (14 новых колонок)

Performance beacon (при уходе со страницы):
→ JS в HTML-шаблоне баннера собирает метрики:
  - image_load_ms (Image.onload)
  - render_ms (DOMContentLoaded)
  - time_to_visible_ms (IntersectionObserver с threshold 0.5)
  - dwell_time_ms (общее время видимости)
  - hover_duration_ms (mouseenter/mouseleave)
  - is_viewable (IAB standard: >=50% видимо >= 1 сек)
→ beforeunload / visibilitychange → sendBeacon → POST /b/perf (JSON)
→ Go API → InsertPerfEvent() → ClickHouse banner_perf table
→ Materialized views: mv_banner_perf_daily (AggregatingMergeTree), mv_events_device_daily (SummingMergeTree)

Админка → Promo → Performance tab:
→ GET /admin/perf-summary → overview cards (avg load, viewability, dwell)
→ GET /admin/device-breakdown → device/browser/OS breakdown
→ GET /admin/referrer-stats → top referrers
```

### 8.10 Мульти-сайт
```
Request Host: custom-domain.com
→ SiteDetection middleware → SELECT FROM sites WHERE domain = 'custom-domain.com'
→ Site injected в context
→ VideoStore.List() → WHERE site_videos.site_id = {site.id}
→ Каждый сайт видит только своё подмножество видео + категорий
```

---

## 9. Environment Variables

### Go API
```env
DATABASE_URL=postgres://traforama:traforama@localhost:5432/traforama?sslmode=disable
REDIS_URL=redis://localhost:6379/0
CLICKHOUSE_URL=clickhouse://default:traforama@localhost:9000/traforama
PORT=8080
ADMIN_TOKEN=xcj-admin-2024
CACHE_LIST_TTL=60s
CACHE_DETAIL_TTL=300s
EVENT_BUFFER_SIZE=1000
EVENT_FLUSH_INTERVAL=1s
RATE_LIMIT_RPS=100
SITE_BASE_URL=https://temptguide.com    # Абсолютный URL для баннерных redirect'ов (пусто → relative path)
S3_ENDPOINT=https://...                  # R2 endpoint (для Go API re-crop upload)
S3_BUCKET=xcj-media                      # R2 bucket name
S3_ACCESS_KEY=...                        # R2 access key
S3_SECRET_KEY=...                        # R2 secret key
S3_REGION=auto                           # R2 region
S3_PUBLIC_URL=https://media.temptguide.com  # Public CDN URL prefix
```

### Python Parser
```env
DATABASE_URL=postgresql://traforama:traforama@localhost:5432/traforama
S3_ENDPOINT=https://...
S3_BUCKET=xcj-media
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_REGION=auto
S3_PUBLIC_URL=https://cdn.example.com
OPENAI_API_KEY=...                    # OpenAI API key (для AI-категоризации через GPT-4o Vision)
PARSE_INTERVAL_SEC=30
MAX_PARSE_ERRORS=5
```

### Next.js
```env
API_URL=http://localhost:8080
NEXT_PUBLIC_API_URL=http://localhost:8080
```

---

## 10. Запуск

```bash
# 1. Docker — БД
docker-compose -f docker-compose.dev.yml up -d

# 2. Go API
cd api && go build -o ../bin/api ./cmd/server/ && \
  DATABASE_URL="..." REDIS_URL="..." CLICKHOUSE_URL="..." PORT=8080 ../bin/api

# 3. Python parser worker
cd parser && python -m parser worker

# 4. Next.js
cd web && npm run dev

# Результат:
# PostgreSQL :5432, Redis :6379, ClickHouse :8123/:9000
# Go API :8080
# Next.js :3000
```

### Пароли
- Admin UI (web): `xcj2024` → сохраняется в cookie `admin_token`
- Admin API (bearer): `xcj-admin-2024` → в заголовке Authorization
- PostgreSQL: user `traforama`, password `traforama`, db `traforama`
- ClickHouse: user `default`, password `traforama`, db `traforama`
- Redis: без пароля

---

## 11. Banner Analytics & Conversion Tracking

### 11.1 Архитектура воронки конверсий

Полная воронка для баннерной рекламы: от показа до конверсии, с привязкой источника трафика (src, click_id) через всю цепочку + S2S постбек в рекламную сеть.

```
Сторонний сайт (iframe): /b/serve?size=300x250&src=adnet1&click_id=abc123
  │
  ├─ 1. ПОКАЗ (banner_impression) → source=adnet1, click_id=abc123
  ├─ 2. НАВЕДЕНИЕ (banner_hover) → JS mouseenter → пиксель /b/{id}/hover
  └─ 3. КЛИК (banner_click) → /b/{id}/click?src=adnet1&click_id=abc123
       │
       └─ редирект → /model/{slug}?src=adnet1&click_id=abc123
            │
            ├─ 4. ЛЕНДИНГ → src + click_id → sessionStorage
            ├─ 5. social_click (клик на фансайт) → S2S постбек
            └─ 6. content_click (первый клик на контент за сессию) → S2S постбек
```

### 11.2 Типы событий (Event Types)

| Event Type | Описание | Источник | Триггер |
|------------|----------|----------|---------|
| banner_impression | Показ баннера | Go API (/b/serve, /b/{id}) | Загрузка iframe / IMG |
| banner_hover | Наведение мыши на баннер | Go API (/b/{id}/hover) | JS mouseenter в iframe → 1x1 GIF |
| banner_click | Клик по баннеру | Go API (/b/{id}/click) | Клик → redirect на /model/{slug} |
| social_click | Клик на внешний фансайт (OnlyFans и др.) | Frontend (analytics.ts) | Клик по ссылке на профиль |
| content_click | Первый клик на контент (Instagram) за сессию | Frontend (analytics.ts) | Клик на тумбу — один раз за сессию (sessionStorage flag) |

### 11.3 Source Attribution Flow

Параметры `src` (имя рекламной сети) и `click_id` (уникальный ID клика от рекламной сети) прокидываются через всю цепочку:

1. **Iframe embed** — `/b/serve?src=adnet1&click_id=abc123` → Go API записывает source в banner_impression
2. **JS mouseenter** — hover-пиксель включает src/click_id: `/b/{id}/hover?src=adnet1&click_id=abc123`
3. **Click redirect** — `/b/{id}/click?src=adnet1&click_id=abc123` → redirect с параметрами на `/model/{slug}?src=adnet1&click_id=abc123`
4. **Landing page** — `AdLandingTracker` компонент сохраняет src + click_id в `sessionStorage`
5. **Subsequent events** — `analytics.ts` обогащает все события click_id из sessionStorage
6. **Conversion** — при social_click или content_click с source + click_id → S2S постбек

### 11.4 S2S Postback Mechanism

При конверсии (social_click, content_click) с привязанным source + click_id:

1. Go API получает событие с click_id
2. Lookup `ad_sources` по name → получает postback_url шаблон
3. Lookup CPA из `account_conversion_prices` по account_id + event_type
4. Подставляет плейсхолдеры в URL шаблон: `https://adnetwork.com/postback?click_id={click_id}&event={event}&payout={cpa}`
5. HTTP GET к рекламной сети
6. Логирование результата в `conversion_postbacks` (включая cpa_amount для аудита)
7. Cron job (каждые 5 мин) — retry неудавшихся постбеков (использует сохранённый cpa_amount)

### 11.5 ClickHouse Schema (расширения)

#### Обновлённый mv_banner_daily (с source и hovers)
```sql
CREATE MATERIALIZED VIEW mv_banner_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, video_id, account_id, source)
AS SELECT
    toDate(created_at) AS event_date,
    video_id, account_id,
    JSONExtractString(extra, 'source') AS source,
    countIf(event_type = 'banner_impression') AS impressions,
    countIf(event_type = 'banner_hover') AS hovers,
    countIf(event_type = 'banner_click') AS clicks
FROM events
WHERE event_type IN ('banner_impression', 'banner_hover', 'banner_click')
GROUP BY event_date, video_id, account_id, source;
```

#### Новый mv_banner_conversions
```sql
CREATE MATERIALIZED VIEW mv_banner_conversions
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, source, event_type)
AS SELECT
    toDate(created_at) AS event_date,
    JSONExtractString(extra, 'source') AS source,
    event_type,
    count() AS conversions
FROM events
WHERE event_type IN ('social_click', 'content_click')
  AND JSONExtractString(extra, 'source') != ''
GROUP BY event_date, source, event_type;
```

### 11.6 PostgreSQL (новые таблицы)

#### `ad_sources` — Рекламные сети
| Поле | Тип | Описание |
|------|-----|----------|
| id | SERIAL PK | |
| name | VARCHAR(64) UNIQUE | Имя сети (slug, напр. "exoclick") |
| display_name | VARCHAR(128) | Отображаемое имя |
| postback_url | TEXT | URL шаблон с плейсхолдерами: `{click_id}`, `{event}`, `{cpa}` |
| is_active | BOOLEAN DEFAULT true | Активна ли |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `conversion_postbacks` — Лог постбеков
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| ad_source_id | INT FK(ad_sources.id) | Рекламная сеть |
| click_id | VARCHAR(256) | ID клика из рекламной сети |
| event_type | VARCHAR(32) | social_click / content_click |
| status | VARCHAR(16) DEFAULT 'pending' | pending / sent / failed |
| response_code | INT NULL | HTTP код ответа |
| response_body | TEXT NULL | Тело ответа (для дебага) |
| cpa_amount | NUMERIC(10,4) NULL | CPA цена на момент создания (для аудита и retry) |
| attempts | INT DEFAULT 0 | Кол-во попыток |
| last_attempt_at | TIMESTAMPTZ NULL | Время последней попытки |
| created_at | TIMESTAMPTZ | |

**INDEX:** idx_conversion_postbacks_retry (status, last_attempt_at) WHERE status = 'failed'

#### `account_conversion_prices` — Цены конверсий по аккаунтам (CPA)
| Поле | Тип | Описание |
|------|-----|----------|
| id | SERIAL PK | |
| account_id | INT FK(accounts.id) ON DELETE CASCADE | Аккаунт модели |
| event_type | VARCHAR(64) | Тип события: social_click / content_click |
| price | NUMERIC(10,4) DEFAULT 0 | CPA цена для постбека |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**UNIQUE:** (account_id, event_type)
**INDEX:** idx_acp_account_id (account_id)

**Связанная колонка:** `conversion_postbacks.cpa_amount` (NUMERIC(10,4) NULL) — хранит CPA на момент создания постбека для аудита и retry-консистентности.

### 11.7 Go API — Новые/обновлённые эндпоинты

#### Публичные баннерные роуты
| Метод | Путь | Описание |
|-------|------|----------|
| GET | /b/serve | Обновлён: принимает src, click_id; добавлен JS mouseenter трекер в iframe HTML |
| GET | /b/{id}/hover | Новый: возвращает 1x1 прозрачный GIF, пишет banner_hover в ClickHouse |
| GET | /b/{id}/preview | Admin preview: рендерит баннер в HTML-стиле (?style=bold/elegant/minimalist/card) для предпросмотра в админке |
| GET | /b/{id}/click | Обновлён: прокидывает src, click_id в redirect URL |

#### Админские эндпоинты
| Метод | Путь | Описание |
|-------|------|----------|
| GET | /admin/ad-sources | Список рекламных сетей |
| POST | /admin/ad-sources | Создать рекламную сеть |
| PUT | /admin/ad-sources/{id} | Обновить рекламную сеть |
| GET | /admin/accounts/{id}/conversion-prices | Список CPA цен для аккаунта по типам событий |
| PUT | /admin/accounts/{id}/conversion-prices | Upsert CPA цены для аккаунта (body: {event_type, price}) |
| GET | /admin/banners/funnel | Статистика воронки по source (из ClickHouse) |
| POST | /admin/banners/batch-deactivate | Массовая деактивация баннеров по списку ID |
| POST | /admin/banners/batch-regenerate | Массовая перегенерация баннеров по списку ID |

### 11.8 Frontend — Новые компоненты

- **AdLandingTracker** (`web/src/components/AdLandingTracker.tsx`) — сохраняет src + click_id из URL в sessionStorage
- **analytics.ts** (`web/src/lib/analytics.ts`) — обогащает события click_id из sessionStorage; новый event type `content_click` (первый клик за сессию)
- **Promo: Banners tab** (`web/src/app/admin/promo/page.tsx`) — embed-коды через loader.js `<script>` тег (вместо iframe) с выбором стиля (Bold/Elegant/Minimalist/Card/Random) и источника трафика; preview по-прежнему использует iframe для live-рендеринга
- **Promo: Settings tab** (`web/src/app/admin/promo/page.tsx`) — форма для conversion tracker
- **Promo: Statistics tab** (`web/src/app/admin/promo/page.tsx`) — воронка по источникам, таблица с CTR/конверсией
- **Ad Sources management** (`web/src/app/admin/ad-sources/page.tsx`) — CRUD для рекламных сетей

---

## 12. Известные ограничения

1. Нет retry при сбое batch insert в ClickHouse — события теряются
2. Admin token без ротации/expire
3. Парсеры требуют ручной настройки cookies (yt-dlp для Twitter, session_id для Instagram)
4. Нет Swagger/OpenAPI документации
5. view_count/click_count в PostgreSQL — кеш платформы (Twitter), НЕ наша статистика. Наша аналитика — в ClickHouse
6. sendBeacon не ставит Content-Type: application/json, но Go json.NewDecoder работает с любым Content-Type
7. Impression tracking: порог 50% видимости тумбы (IntersectionObserver threshold=0.5)
8. content_click трекается только один раз за сессию через sessionStorage — при очистке sessionStorage (закрытие вкладки) счётчик сбрасывается
9. Postback retry — максимальное число попыток и backoff стратегия зависят от реализации cron job
