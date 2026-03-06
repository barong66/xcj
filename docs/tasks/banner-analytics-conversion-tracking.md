# Banner Analytics & Conversion Tracking

> Status: PLANNED
> Module: api/internal/handler/banner.go, api/internal/handler/event.go, web/src/lib/analytics.ts, web/src/app/admin/promo/
> Created: 2026-03-06

---

## Overview

Полная воронка для баннерной рекламы: от показа до конверсии, с привязкой источника трафика (click_id, src) через всю цепочку + S2S постбек в рекламную сеть.

## Как работает воронка

```
Сторонний сайт (iframe): /b/serve?size=300x250&src=adnet1&click_id=abc123
  |
  +-- 1. ПОКАЗ --> запись banner_impression (source=adnet1, click_id=abc123)
  +-- 2. НАВЕДЕНИЕ --> JS mouseenter --> пиксель /b/{id}/hover --> banner_hover
  +-- 3. КЛИК --> /b/{id}/click?src=adnet1&click_id=abc123
       |
       +-- запись banner_click
       +-- редирект --> /model/{slug}?src=adnet1&click_id=abc123
            |
            +-- 4. ЛЕНДИНГ --> src + click_id сохраняются в sessionStorage
            +-- 5. КЛИК НА ФАНСАЙТ (OnlyFans) --> social_click --> постбек
            +-- 6. ПЕРВЫЙ КЛИК НА КОНТЕНТ (Instagram) --> content_click --> постбек
                   (один раз за сессию)
```

## Что записываем в ClickHouse

Для каждого баннера по каждому источнику:
- **Показы** (banner_impression) -- сколько раз показался
- **Наведения** (banner_hover) -- сколько раз навели мышкой
- **Клики** (banner_click) -- сколько раз кликнули
- **Конверсии** -- social_click (фансайт) и content_click (контент)
- **Источник** (source) -- откуда пришёл трафик

## Постбеки в рекламные сети

- Таблица `ad_sources` -- настройка URL-шаблона для каждой рекламной сети
- Шаблон: `https://adnetwork.com/postback?click_id={click_id}&event={event}`
- При конверсии (social_click, content_click) автоматически отстукиваем постбек
- Логирование всех постбеков в `conversion_postbacks` + автоматический retry

## Задачи

### Backend (Go API)

#### 1. [BE] ClickHouse migration: banner funnel views
- **Файл:** `scripts/migrations/010_clickhouse_banner_funnel.sql`
- Обновить mv_banner_daily: добавить hovers (countIf banner_hover), source dimension (JSONExtractString)
- Создать mv_banner_conversions: агрегация social_click/content_click по source и дате
- DROP старый mv_banner_daily + CREATE новый (SummingMergeTree, ORDER BY включает source)

#### 2. [BE] PostgreSQL migration: ad_sources + conversion_postbacks
- **Файл:** `scripts/migrations/010_ad_sources.sql`
- Таблица `ad_sources`: id, name (UNIQUE), display_name, postback_url (шаблон), is_active, created_at, updated_at
- Таблица `conversion_postbacks`: id, ad_source_id FK, click_id, event_type, status (pending/sent/failed), response_code, response_body, attempts, last_attempt_at, created_at
- Индекс: idx_conversion_postbacks_retry (status, last_attempt_at) WHERE status = 'failed'

#### 3. [BE] Banner hover endpoint
- **Файл:** `api/internal/handler/banner.go`
- GET /b/{id}/hover -- возвращает 1x1 прозрачный GIF (43 bytes hardcoded)
- Записывает banner_hover event в ClickHouse через EventBuffer
- Передаёт source и click_id из query params в extra JSON
- Cache headers: no-cache, no-store

#### 4. [BE] Source propagation through banner funnel
- **Файл:** `api/internal/handler/banner.go`
- `/b/serve`: принимать src и click_id query params, прокидывать в HTML:
  - `<a href="/b/{id}/click?src=X&click_id=Y">`
  - JS mouseenter: hover pixel URL включает src и click_id
  - banner_impression event включает source в extra JSON
- `/b/{id}/click`: читать src и click_id из query, включать в redirect URL (`/model/{slug}?src=X&click_id=Y`), писать в banner_click event extra
- Добавить JS mouseenter трекер в iframe HTML: `document.querySelector('a').addEventListener('mouseenter', function() { new Image().src = '/b/{id}/hover?src=X&click_id=Y'; }, {once: true})`

#### 5. [BE] Postback trigger on conversion
- **Файл:** `api/internal/handler/event.go`
- При получении social_click или content_click с непустым source + click_id:
  1. Lookup ad_source по name = source
  2. Подставить click_id и event_type в postback_url шаблон
  3. Асинхронный HTTP GET (goroutine, timeout 10s)
  4. INSERT в conversion_postbacks (status = sent/failed)
- Не блокировать основной event handler

#### 6. [BE] Ad sources CRUD endpoints
- **Файлы:** `api/internal/handler/admin.go`, `api/internal/store/admin_store.go`
- GET /api/v1/admin/ad-sources -- список всех
- POST /api/v1/admin/ad-sources -- создать (name, display_name, postback_url)
- PUT /api/v1/admin/ad-sources/{id} -- обновить (is_active, postback_url и др.)
- Store methods: ListAdSources, CreateAdSource, UpdateAdSource, GetAdSourceByName

#### 7. [BE] Banner funnel analytics queries
- **Файл:** `api/internal/clickhouse/reader.go`
- GetBannerFunnelStats(dateFrom, dateTo) -- воронка по source: impressions, hovers, clicks из mv_banner_daily + conversions из mv_banner_conversions
- Обновить GetBannerStats -- добавить hovers в результат
- Формат ответа: [{source, impressions, hovers, clicks, conversions, ctr, conv_rate}]

#### 8. [BE] Postback retry cron job
- **Файл:** `api/internal/cron/postback_retry.go`
- Cron каждые 5 мин: SELECT FROM conversion_postbacks WHERE status = 'failed' AND attempts < 5
- Для каждого: retry HTTP GET, обновить status/attempts/last_attempt_at/response
- Запускается в отдельной goroutine при старте сервера

### Frontend (Next.js)

#### 9. [FE] Click ID propagation via sessionStorage
- **Файлы:** `web/src/components/AdLandingTracker.tsx`, `web/src/lib/analytics.ts`
- AdLandingTracker: новый компонент, читает src и click_id из URL searchParams, сохраняет в sessionStorage
- analytics.ts: при отправке события проверяет sessionStorage на наличие click_id, обогащает event payload

#### 10. [FE] Content click tracking (first per session)
- **Файл:** `web/src/lib/analytics.ts`
- Новый event type `content_click`
- При клике на контент (Instagram тумба) проверяет sessionStorage флаг `content_clicked`
- Если флага нет -- отправляет content_click event и ставит флаг
- Если флаг есть -- ничего не делает (один раз за сессию)

#### 11. [FE] Model page: accept src/click_id params
- **Файл:** `web/src/app/model/[slug]/page.tsx`
- Страница принимает src и click_id из URL searchParams
- Рендерит AdLandingTracker с этими параметрами
- Параметры не влияют на рендер страницы (только на аналитику)

#### 12. [FE] Promo: Settings tab (embed codes + conversion tracker)
- **Файл:** `web/src/app/admin/promo/page.tsx`
- Новая вкладка "Настройки" в разделе Promo
- Генератор iframe-кодов с выбором рекламной сети (source) -- подставляет click_id макрос автоматически
- Форма для вставки conversion tracker URL
- Инструкция по настройке постбеков

#### 13. [FE] Promo: Statistics tab (funnel by source)
- **Файл:** `web/src/app/admin/promo/page.tsx`
- Новая вкладка "Статистика"
- Воронка по источникам: показы --> наведения --> клики --> конверсии (визуально: горизонтальные бары)
- Таблица: source | impressions | hovers | clicks | CTR | conversions | conv_rate
- Фильтр по дате: 7 / 30 / 90 дней
- Данные из GET /admin/banners/funnel

#### 14. [FE] Promo: Update banner list with hovers + source stats
- **Файл:** `web/src/app/admin/promo/page.tsx`
- Добавить колонку "Hovers" в таблицу баннеров
- Показать breakdown по sources в карточке каждого баннера (expand row)
- Обновить типы BannerStats для поддержки hovers

#### 15. [FE] Promo: Ad Sources management page
- **Файл:** `web/src/app/admin/ad-sources/page.tsx`
- CRUD интерфейс для рекламных сетей:
  - Список: name, postback URL, status (active/inactive)
  - Создание: форма с name, display_name, postback_url, примеры макросов
  - Редактирование: inline toggle active, edit postback URL
- API: GET/POST/PUT /api/v1/admin/ad-sources

### Testing

#### 16. [TEST] Banner analytics tests
- **Файлы:** `api/internal/handler/banner_test.go`, `api/internal/handler/event_test.go`
- Go unit tests:
  - Banner handler: hover endpoint (1x1 GIF response), source propagation в HTML, click redirect с параметрами
  - Event handler: postback trigger при social_click с source+click_id
  - Store: ad_source CRUD operations
- Покрытие: основные happy path + edge cases (missing source, empty click_id, inactive ad_source)

## Структура раздела Promo в админке

```
/admin/promo
  +-- Баннеры (существующее) -- список баннеров с CTR, кликами, hovers
  |   +-- колонка "Source breakdown" для каждого баннера
  +-- Настройки
  |   +-- Embed codes (iframe) -- генератор кода с выбором source
  |   +-- Conversion Tracker -- форма для вставки postback URL
  |   +-- Ad Sources -- управление рекламными сетями (CRUD)
  +-- Статистика
      +-- Воронка по источникам (impressions --> hovers --> clicks --> conversions)
      +-- Таблица: source | показы | наведения | клики | CTR | конверсии | conv_rate
      +-- Фильтр по дате (7/30/90 дней)
```

## Database Changes

### ClickHouse

**Updated mv_banner_daily:**
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

**New mv_banner_conversions:**
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

### PostgreSQL

**ad_sources:**
```sql
CREATE TABLE ad_sources (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(128),
    postback_url TEXT NOT NULL,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
```

**conversion_postbacks:**
```sql
CREATE TABLE conversion_postbacks (
    id              BIGSERIAL PRIMARY KEY,
    ad_source_id    INT REFERENCES ad_sources(id),
    click_id        VARCHAR(256) NOT NULL,
    event_type      VARCHAR(32) NOT NULL,
    status          VARCHAR(16) DEFAULT 'pending',
    response_code   INT,
    response_body   TEXT,
    attempts        INT DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conversion_postbacks_retry
    ON conversion_postbacks (status, last_attempt_at)
    WHERE status = 'failed';
```

## Implementation Order

Рекомендуемый порядок реализации:

1. **Миграции** (tasks 1, 2) -- создать таблицы и views
2. **Backend core** (tasks 3, 4, 5) -- hover endpoint, source propagation, postback trigger
3. **Backend CRUD + analytics** (tasks 6, 7) -- ad sources API, funnel queries
4. **Backend cron** (task 8) -- postback retry
5. **Frontend tracking** (tasks 9, 10, 11) -- click_id propagation, content_click, model page
6. **Frontend admin** (tasks 12, 13, 14, 15) -- Promo tabs, ad sources page
7. **Testing** (task 16) -- unit tests

## Related Files

- `api/internal/handler/banner.go` -- banner HTTP handlers
- `api/internal/handler/event.go` -- event ingestion handlers
- `api/internal/clickhouse/reader.go` -- ClickHouse read queries
- `api/internal/store/admin_store.go` -- PostgreSQL admin data access
- `web/src/lib/analytics.ts` -- frontend analytics
- `web/src/app/admin/promo/page.tsx` -- admin promo section
- `web/src/components/AdLandingTracker.tsx` -- click_id tracking component
- `scripts/migrations/010_*.sql` -- database migrations
