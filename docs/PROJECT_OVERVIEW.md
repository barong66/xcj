# XXCJ / xxxaccounter — Обзор проекта

> Дата: 2026-02-24
> Внутреннее название: **xcj** / **XXCJ**
> Публичный сайт: **xxxaccounter**
> Основная компания: **Traforama** (ASG group)

---

## 1. Что это

**xxxaccounter** — платформа для раскрутки аккаунтов в социальных сетях. Владельцы каналов покупают листинги, чтобы их контент показывался аудитории сайта. Сайт автоматически собирает видео с Twitter (X) и Instagram, категоризирует их через AI (Claude), и отображает на красивой витрине.

**xcj** — внутреннее название проекта и админ-панели.

### Ключевые возможности

- Автоматический парсинг видео с Twitter и Instagram
- AI-категоризация контента через Claude Vision API
- Мультисайт архитектура (один бэкенд — несколько доменов)
- Real-time аналитика (impressions, clicks, CTR) через ClickHouse
- Админ-панель для управления контентом, аккаунтами и статистикой
- Платные листинги и промо-видео

---

## 2. Технологический стек

| Слой | Технологии |
|------|-----------|
| **Frontend** | Next.js 14, React 18, TypeScript, Tailwind CSS, SSR |
| **Backend API** | Go 1.22, Chi router |
| **Основная БД** | PostgreSQL 16 |
| **Кеш** | Redis 7 |
| **Аналитика** | ClickHouse |
| **Парсер** | Python 3.9+, asyncio, yt-dlp, httpx, Apify |
| **AI** | Anthropic Claude API (Vision) |
| **Медиа** | ffmpeg, Pillow, S3/Cloudflare R2 |
| **Инфраструктура** | Docker Compose, Nginx, systemd |

---

## 3. Архитектура

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Next.js    │────▶│   Go API     │────▶│  PostgreSQL   │
│  (порт 3000)│     │  (порт 8080) │     │  (данные)     │
└─────────────┘     │              │────▶├───────────────┤
                    │              │     │  Redis (кеш)  │
                    │              │────▶├───────────────┤
                    └──────────────┘     │  ClickHouse   │
                                        │  (аналитика)  │
┌─────────────┐                         └───────────────┘
│  Python     │──▶ PostgreSQL (напрямую)
│  Парсер     │──▶ S3 (медиа-файлы)
└─────────────┘──▶ Claude API (категоризация)
```

### Компоненты

| Компонент | Назначение | Порт |
|-----------|-----------|------|
| **Go API** | HTTP-сервер, публичное и админ API | 8080 |
| **Python Parser** | Парсинг соцсетей, генерация превью, AI-категоризация | — |
| **Next.js Frontend** | SSR-рендеринг, витрина видео, админка | 3000 |
| **PostgreSQL** | Основные данные (видео, аккаунты, категории, сайты) | 5432 |
| **Redis** | Кеш API-ответов (TTL 60–300 сек) | 6379 |
| **ClickHouse** | Аналитические события (impressions, clicks) | 8123/9000 |

---

## 4. Бизнес-логика

### 4.1 Сбор контента

```
Админ добавляет аккаунт (@username, Twitter/Instagram)
  → Задача в очередь (parse_queue, status=pending)
  → Python Worker подхватывает задачу
  → Парсер скачивает видео (yt-dlp для Twitter, httpx/Apify для Instagram)
  → Для каждого видео:
    - Скачивает thumbnail, ресайзит до 480×270
    - Генерирует 5-сек превью (ffmpeg, 500k bitrate, 480p)
    - Загружает файлы в S3/R2
    - Записывает в PostgreSQL
  → AI категоризатор (Claude Vision, батчами по 50):
    - Анализирует thumbnail + metadata
    - Возвращает категории с confidence (0..1)
    - Записывает в video_categories
```

### 4.2 Витрина (публичная часть)

- Посетитель заходит на сайт → видит сетку видео-карточек
- При наведении на thumbnail — 5-секундное превью-видео
- Клик → переход на оригинал (Twitter/Instagram) в новой вкладке
- Фильтрация: по категориям, странам
- Сортировка: новые, популярные, случайные, промо
- Полнотекстовый поиск по названию

### 4.3 Мультисайт

Один бэкенд обслуживает несколько сайтов с разными доменами:
- Определение сайта по HTTP Host header или X-Site-Id
- Каждый сайт имеет свой набор категорий и видео
- Связь через таблицы `site_categories` и `site_videos`

### 4.4 Аналитика

```
Thumbnail видна в viewport (50%+) → sendBeacon → impression event
Клик по карточке → sendBeacon → click event
Go API → EventBuffer (in-memory, до 1000 событий или 1 сек)
  → Batch INSERT в ClickHouse
Админ → /admin/stats → агрегация из ClickHouse
```

Метрики: impressions, clicks, CTR, по видео и по сайту в целом.

### 4.5 Монетизация

| Для платформы | Для владельцев каналов |
|---------------|----------------------|
| Трафик (показы рекламы) | Контент показывается целевой аудитории |
| Платные листинги | Промо-размещение (promoted videos) |
| | Приоритетный показ на определённый срок |

---

## 5. Структура проекта

```
xcj/
├── api/                         # Go backend API
│   ├── cmd/server/main.go       # Entry point
│   └── internal/
│       ├── config/              # ENV-конфигурация
│       ├── handler/             # HTTP handlers + роутер
│       ├── store/               # Data access (PostgreSQL)
│       ├── model/               # Модели данных
│       ├── middleware/          # SiteDetection, AdminAuth, RateLimit
│       ├── cache/               # Redis клиент
│       └── clickhouse/          # EventBuffer + Reader
│
├── parser/                      # Python парсер + AI категоризатор
│   ├── __main__.py              # CLI (parse, worker, add, categorize, find)
│   ├── parsers/                 # Twitter (yt-dlp) + Instagram (httpx/Apify)
│   ├── tasks/                   # Фоновый воркер
│   ├── categorizer/             # Claude Vision API pipeline
│   └── storage/                 # PostgreSQL (asyncpg) + S3 (boto3)
│
├── web/                         # Next.js frontend
│   ├── src/app/                 # App Router (страницы)
│   ├── src/components/          # React компоненты
│   ├── src/lib/                 # API клиенты
│   └── src/types/               # TypeScript типы
│
├── scripts/migrations/          # SQL-миграции (PostgreSQL + ClickHouse)
├── deploy/                      # Docker, Nginx, systemd
├── docs/                        # Документация
├── docker-compose.dev.yml       # Локальный Docker (БД)
├── DOCS.md                      # Продуктовая документация
└── TECHNICAL_SPEC.md            # Полная техспецификация
```

---

## 6. База данных (PostgreSQL)

### Основные таблицы

| Таблица | Назначение | Ключевые поля |
|---------|-----------|---------------|
| `sites` | Мультисайт | slug, domain, name, config (JSONB) |
| `accounts` | Источники видео | platform, username, is_paid, paid_until, parse_errors |
| `videos` | Видео-контент | platform_id, original_url, thumbnail_url, preview_url, ai_categories |
| `categories` | Категории (иерархические) | slug, name, parent_id |
| `video_categories` | M2M: видео ↔ категории | video_id, category_id, confidence |
| `site_categories` | M2M: сайты ↔ категории | site_id, category_id |
| `site_videos` | M2M: сайты ↔ видео | site_id, video_id, is_featured |
| `countries` | Справочник стран | code (ISO), name |
| `parse_queue` | Очередь парсинга | account_id, status, error, videos_found |

### Ключевые индексы

- `idx_videos_active` — (is_active, published_at DESC)
- `idx_videos_popular` — (is_active, click_count DESC)
- `idx_videos_promoted` — (is_promoted, promotion_weight DESC)
- `idx_parse_queue_status` — (status, created_at)

---

## 7. API эндпоинты

### Публичные (определение сайта по Host)

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/v1/videos` | Список видео (sort, page, category_id, country_id) |
| GET | `/api/v1/videos/{id}` | Детали видео |
| GET | `/api/v1/search?q=` | Полнотекстовый поиск |
| GET | `/api/v1/categories` | Категории сайта |
| GET | `/api/v1/categories/{slug}` | Детали категории |
| GET | `/api/v1/accounts/{id}` | Аккаунт с видео |
| POST | `/api/v1/events` | Аналитическое событие |
| POST | `/api/v1/events/batch` | Пакет событий (до 100) |

### Админские (Bearer token)

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/admin/stats` | Общая статистика |
| GET/POST/PUT/DELETE | `/admin/accounts` | CRUD аккаунтов |
| POST | `/admin/accounts/{id}/reparse` | Парсинг аккаунта |
| POST | `/admin/accounts/reparse-all` | Парсинг всех |
| GET | `/admin/queue` | Очередь парсинга |
| POST | `/admin/queue/retry-failed` | Перезапуск упавших |
| GET/DELETE | `/admin/videos` | Управление видео |
| POST | `/admin/videos/recategorize` | AI пере-категоризация |
| GET | `/admin/categories` | Категории |
| GET | `/admin/sites` | Сайты |
| GET | `/admin/health` | Health check |

### Middleware

1. **SiteDetection** — определение сайта по Host/X-Site-Id
2. **AdminAuth** — Bearer token для `/admin/*`
3. **RateLimiter** — 100 RPS (token bucket)
4. **CORS** — разрешены все origins
5. **Logging** — JSON через slog
6. **Recovery** — graceful обработка паник

### Кеширование (Redis)

| Ключ | TTL | Что кешируется |
|------|-----|---------------|
| `vl:{site}:{sort}:{cat}:{country}:{page}` | 60s | Список видео |
| `vd:{video_id}` | 300s | Детали видео |
| `cat:{site_id}` | 60s | Категории сайта |
| `src:{site}:{query}:{page}` | 60s | Поиск |

---

## 8. Фронтенд страницы

### Публичные

| URL | Описание |
|-----|---------|
| `/` | Главная — сетка видео |
| `/search?q=` | Поиск |
| `/video/[id]` | Страница видео |
| `/category/[slug]` | Категория |
| `/account/[platform]/[username]` | Видео аккаунта |

### Админ-панель

| URL | Описание |
|-----|---------|
| `/admin/login` | Авторизация |
| `/admin` | Dashboard |
| `/admin/accounts` | Управление аккаунтами |
| `/admin/videos` | Управление видео |
| `/admin/queue` | Очередь парсинга |
| `/admin/stats` | Аналитика |
| `/admin/categories` | Категории |
| `/admin/health` | Здоровье системы |

### Ключевые компоненты

| Компонент | Назначение |
|-----------|-----------|
| VideoCard | Карточка видео с hover-preview |
| VideoGrid | Адаптивная сетка (1–4 колонки) |
| ViewTracker | Трекинг impressions (IntersectionObserver) |
| CategoryNav | Навигация по категориям |
| SortControls | Переключатель сортировки |
| SearchBar | Поисковая строка |
| AdminShell | Layout админки (sidebar + header) |

---

## 9. Python парсер

### CLI команды

```bash
python -m parser parse <username>              # Парсинг одного аккаунта
python -m parser parse --platform instagram    # Указать платформу
python -m parser worker                        # Фоновый воркер
python -m parser add <username>                # Добавить и поставить в очередь
python -m parser categorize                    # AI-категоризация
python -m parser find "keyword" --count 5      # Поиск аккаунтов
```

### Настройки

| Параметр | Default | Описание |
|----------|---------|---------|
| parse_interval_sec | 30 | Интервал опроса очереди |
| max_parse_errors | 5 | Порог отключения аккаунта |
| thumbnail_width/height | 480×270 | Размер тумбы |
| preview_duration_sec | 5 | Длительность превью |
| preview_video_bitrate | 500k | Битрейт превью |
| ytdlp_max_videos | 50 | Макс. видео за парсинг |

---

## 10. Задачи в ClickUp

### Проект: XXCJ (Space ID: 90126473643)

#### Структура

```
XXCJ/
├── Backend/
│   ├── API
│   ├── Database
│   └── Infrastructure
├── Parsers/
│   ├── Twitter Parser
│   ├── Instagram Parser
│   └── Video Finder
├── Frontend — Site/
│   ├── Pages & Components
│   ├── SEO
│   └── Design
├── Admin Panel/
│   └── Admin Features
├── Model Dashboard/
│   ├── Registration & Auth
│   ├── Content Management
│   └── Analytics & Stats
├── Content & Moderation/
│   ├── Moderation
│   └── Categorization
├── Payments & Billing/
│   ├── Payment Integration
│   └── Packages & Subscriptions
├── AI & Automation/
│   ├── AI Categorization
│   ├── Recommendations
│   └── Automated Agents
├── Business/
│   ├── Marketing
│   ├── Sales
│   └── Finance
├── Mobile App/
│   └── MVP
└── DevOps & Launch/
    ├── Deployment
    └── Monitoring
```

#### Активные задачи (status: todo)

**Admin Panel → Admin Features:**

| Задача | URL |
|--------|-----|
| Admin Videos: поиск видео по тексту | [869c8uvkm](https://app.clickup.com/t/869c8uvkm) |
| Admin Videos: фильтр по платформе (Twitter/Instagram) | [869c8uvm7](https://app.clickup.com/t/869c8uvm7) |
| Admin Videos: ручное редактирование категорий видео | [869c8uvn4](https://app.clickup.com/t/869c8uvn4) |
| Admin Videos: сортировка (views, clicks, date, duration) | [869c8uvnn](https://app.clickup.com/t/869c8uvnn) |
| Admin Videos: bulk actions (массовое удаление/рекатегоризация) | [869c8uvpg](https://app.clickup.com/t/869c8uvpg) |
| Admin Videos: фильтр по аккаунту | [869c8uvq4](https://app.clickup.com/t/869c8uvq4) |
| Admin Videos: модалка детального просмотра | [869c8uvr9](https://app.clickup.com/t/869c8uvr9) |
| Admin Videos: hover preview | [869c8uvrx](https://app.clickup.com/t/869c8uvrx) |
| Admin: управление сайтами (CRUD) | [869c7w7p3](https://app.clickup.com/t/869c7w7p3) |
| Admin: CRUD категорий (create/edit/delete) | [869c7w7mu](https://app.clickup.com/t/869c7w7mu) |

**Backend → API:**

| Задача | URL |
|--------|-----|
| Fix Instagram parser flow — "Load failed" error | [869c8at1f](https://app.clickup.com/t/869c8at1f) |

**Parsers → Instagram Parser:**

| Задача | URL |
|--------|-----|
| Настроить Docker и production deployment парсера | [869c8u21p](https://app.clickup.com/t/869c8u21p) |
| Проверить AI-категоризацию через Claude Vision | [869c8u1y3](https://app.clickup.com/t/869c8u1y3) |

**Model Dashboard → Registration & Auth:**

| Задача | URL |
|--------|-----|
| Регистрация модели / агентства | [869c7w7tj](https://app.clickup.com/t/869c7w7tj) |
| OAuth авторизация (Google, Twitter) | [869c7w7ux](https://app.clickup.com/t/869c7w7ux) |
| Профиль модели: настройки аккаунта | [869c7w7w0](https://app.clickup.com/t/869c7w7w0) |

**Payments & Billing → Packages & Subscriptions:**

| Задача | URL |
|--------|-----|
| Пакеты размещения (аукционная модель) | [869c7w8kg](https://app.clickup.com/t/869c7w8kg) |
| Подписки: автопродление и управление | [869c7w8ng](https://app.clickup.com/t/869c7w8ng) |

#### Задачи из проекта Traforama (основной)

| Задача | Статус | URL |
|--------|--------|-----|
| Fill Rate Traforama по дням | Open | [869c5kav3](https://app.clickup.com/t/869c5kav3) |
| Новый дашборд для новых пользователей | in development | [869b1jnfx](https://app.clickup.com/t/869b1jnfx) |

---

## 11. Авторизация

| Уровень | Механизм |
|---------|----------|
| Публичный API | Без авторизации, определение сайта по домену |
| Админ UI | Токен → cookie `admin_token` |
| Админ API | Bearer token в `Authorization` header |
| Rate limiting | 100 RPS на IP (token bucket) |

---

## 12. Внешние интеграции

| Сервис | Использование |
|--------|--------------|
| **Claude API** (Anthropic) | AI-категоризация видео (Vision, claude-sonnet-4) |
| **yt-dlp** | Парсинг Twitter/X видео |
| **Apify** | Парсинг Instagram (actor: instagram-scraper) |
| **S3 / Cloudflare R2** | Хранение thumbnails, previews, аватаров |
| **ffmpeg** | Генерация 5-сек preview клипов |

---

## 13. Запуск (локальная разработка)

```bash
# 1. Запустить БД
docker-compose -f docker-compose.dev.yml up -d

# 2. Go API
cd api && go build -o ../bin/api ./cmd/server/ && ../bin/api

# 3. Python Parser Worker
cd parser && python -m parser worker

# 4. Next.js Frontend
cd web && npm run dev

# Сервисы:
# PostgreSQL :5432 | Redis :6379 | ClickHouse :8123/:9000
# Go API :8080 | Next.js :3000
```

---

## 14. Техническая детализация: как всё работает

### 14.1 Как контент берётся из базы

#### Запрос списка видео (GET /api/v1/videos)

**Полный путь запроса:**

```
Браузер → Next.js SSR (server component) → Go API → Redis → PostgreSQL
```

1. **Next.js** делает `fetch()` на Go API при рендеринге страницы (SSR):
   ```typescript
   // web/src/app/page.tsx — async server component
   const data = await getVideos({ sort, page, per_page: 24 });
   ```
   URL: `GET http://localhost:8080/api/v1/videos?sort=recent&page=1&per_page=24`

2. **Go API** проходит цепочку middleware:
   - **SiteDetection** — определяет сайт по Host header (`SELECT * FROM sites WHERE domain = $1`), если не нашёл — по `X-Site-Id` header
   - **RateLimiter** — token bucket, 100 RPS на IP, burst 200
   - **Handler** проверяет Redis кеш

3. **Redis кеш** (ключ: `vl:{site_id}:{sort}:{category_id}:{country_id}:{page}`):
   - Hit → сразу JSON-ответ, без обращения к PostgreSQL
   - Miss → запрос в БД, результат кешируется
   - TTL: 60 сек для списков, 300 сек для деталей
   - **Random сортировка обходит кеш** (каждый раз новые результаты)

4. **PostgreSQL запрос** (при cache miss) — **3 последовательных запроса**:

   **Шаг 1: COUNT** — подсчёт общего числа для пагинации:
   ```sql
   SELECT COUNT(DISTINCT v.id)
   FROM videos v
   JOIN site_videos sv ON sv.video_id = v.id
   [JOIN video_categories vc ON vc.video_id = v.id]  -- только при фильтре по категории
   WHERE sv.site_id = $1 AND v.is_active = true
     [AND vc.category_id = $2]
     [AND v.country_id = $3]
   ```

   **Шаг 2: SELECT** — сами видео с пагинацией:
   ```sql
   SELECT DISTINCT v.id, v.account_id, v.platform, v.platform_id,
       v.original_url, COALESCE(v.title,''), COALESCE(v.description,''),
       v.duration_sec, COALESCE(v.thumbnail_url,''), COALESCE(v.preview_url,''),
       v.width, v.height, v.country_id, v.view_count, v.click_count,
       v.is_active, v.is_promoted, v.promoted_until, v.promotion_weight,
       v.published_at, v.created_at
   FROM videos v
   JOIN site_videos sv ON sv.video_id = v.id
   WHERE sv.site_id = $1 AND v.is_active = true
   ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC
   LIMIT 24 OFFSET 0
   ```

   **Варианты сортировки:**
   | sort | ORDER BY |
   |------|----------|
   | `recent` (default) | `v.published_at DESC NULLS LAST, v.created_at DESC` |
   | `popular` | `v.view_count DESC, v.id DESC` |
   | `random` | `RANDOM()` |
   | `promoted` | `v.is_promoted DESC, v.promotion_weight DESC, v.view_count DESC` |

   **Шаг 3: Batch-загрузка связанных данных** (2 дополнительных запроса):
   ```sql
   -- Категории всех видео одним запросом (ANY массив ID)
   SELECT vc.video_id, vc.category_id, c.slug, c.name, vc.confidence
   FROM video_categories vc
   JOIN categories c ON c.id = vc.category_id
   WHERE vc.video_id = ANY($1)
   ORDER BY vc.confidence DESC

   -- Аккаунты всех видео одним запросом
   SELECT id, platform, username, COALESCE(display_name,''),
          COALESCE(avatar_url,''), is_paid, created_at
   FROM accounts WHERE id = ANY($1)
   ```

   Итого: **4 SQL-запроса** на один API-вызов (при cache miss).

#### Полнотекстовый поиск

Используется PostgreSQL `tsvector` + `tsquery` с фолбэком на `ILIKE`:

```sql
WHERE (
    to_tsvector('english', v.title || ' ' || v.description) @@ to_tsquery('english', $2)
    OR v.title ILIKE '%' || $3 || '%'
)
```

Поисковый запрос `"hello world"` превращается в `"hello & world"` для tsquery.

---

### 14.2 Как контент показывается

#### SSR-рендеринг (Server-Side Rendering)

Главная страница — **async server component** Next.js 14:

```typescript
// web/src/app/page.tsx
export default async function HomePage({ searchParams }) {
  const data = await getVideos({ sort, page, per_page: 24 });
  return (
    <>
      <VideoGrid videos={data.videos} />
      <LoadMoreButton currentPage={data.page} totalPages={data.pages} />
    </>
  );
}
```

- Данные загружаются **на сервере** до рендеринга HTML
- Пользователь получает **готовый HTML** с видео (хорошо для SEO)
- API вызывается с server-side URL (`API_URL`), не с клиента

#### Сетка видео

```typescript
// web/src/components/VideoGrid.tsx
<div className="grid grid-cols-2 gap-3">
  {videos.map(video => <VideoCard key={video.id} video={video} />)}
</div>
```

- **2 колонки** с зазором 0.75rem
- По 24 видео на страницу

#### Карточка видео

```typescript
// web/src/components/VideoCard.tsx — client component ("use client")
<article>
  <div className="relative aspect-[9/16]" onClick={handleClick}>
    <Image src={video.thumbnail_url} fill sizes="50vw" loading="lazy" />
    <span>Duration badge</span>      <!-- правый нижний угол -->
    <span>Platform icon</span>       <!-- правый верхний угол -->
  </div>
  <h3>{video.title}</h3>
  <p>@{video.account.username}</p>
</article>
```

- **Thumbnail**: Next.js `<Image>` с lazy loading
- **Aspect ratio**: 9:16 (портретное видео)
- **Клик**: открывает `video.original_url` в новой вкладке (`window.open`)
- **Hover-preview**: не реализован в текущей версии (есть в задачах ClickUp)

---

### 14.3 Как считается статистика

#### Сбор событий (фронтенд)

```typescript
// web/src/lib/analytics.ts
function sendEvent(event) {
  // Приоритет: sendBeacon (надёжнее, работает при закрытии вкладки)
  if ("sendBeacon" in navigator) {
    navigator.sendBeacon(`${API_URL}/api/v1/events`, JSON.stringify(payload));
  } else {
    // Фолбэк: fetch с keepalive
    fetch(`${API_URL}/api/v1/events`, { method: "POST", keepalive: true, body: ... });
  }
}
```

**4 типа событий:**

| Событие | Когда срабатывает | Механизм |
|---------|------------------|----------|
| `impression` | Thumbnail видна 50%+ в viewport | `IntersectionObserver(threshold: 0.5)` в VideoCard |
| `click` | Клик по карточке видео | `onClick` handler |
| `view` | Открытие страницы видео `/video/[id]` | `useEffect` в ViewTracker |
| `hover` | Определён в коде, но **не используется** | — |

**Impression tracking** — один раз на карточку:
```typescript
// VideoCard.tsx
const hasTrackedImpression = useRef(false);
const observer = new IntersectionObserver((entries) => {
  if (entry.isIntersecting && !hasTrackedImpression.current) {
    trackImpression(video.id);
    hasTrackedImpression.current = true;
    observer.disconnect(); // Больше не отслеживаем
  }
}, { threshold: 0.5 });
```

#### Буферизация событий (Go API)

События не записываются в ClickHouse по одному — используется **in-memory буфер**:

```
POST /api/v1/events → EventBuffer.Push(event) → Buffer (in-memory)
                                                      ↓
                                           Flush trigger:
                                           - буфер >= 1000 событий
                                           - ИЛИ прошла 1 секунда (ticker)
                                                      ↓
                                           Batch INSERT в ClickHouse
```

**Логика flush:**
1. Мьютекс-блокировка → **atomic swap буфера** (старый буфер уходит на запись, новый пустой начинает принимать)
2. `PrepareBatch` → для каждого события `batch.Append(...)` → `batch.Send()`
3. Таймаут на batch: **10 секунд**
4. При ошибке — **события теряются** (нет retry)

#### Хранение в ClickHouse

```sql
CREATE TABLE events (
    site_id     UInt64,
    video_id    UInt64,
    event_type  String,       -- 'impression', 'click', 'hover', 'view'
    session_id  String,
    user_agent  String,
    ip          String,
    referrer    String,
    extra       String,
    created_at  DateTime
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)    -- Партиция по месяцам
ORDER BY (site_id, created_at, event_type, video_id)
TTL created_at + INTERVAL 12 MONTH;  -- Данные хранятся 12 месяцев
```

#### Чтение статистики (админка)

**По видео** (`GET /admin/videos/stats`):
```sql
SELECT
    video_id,
    countIf(event_type = 'impression') AS impressions,
    countIf(event_type = 'click') AS clicks,
    if(impressions > 0, round(clicks * 100.0 / impressions, 2), 0) AS ctr
FROM events
WHERE event_type IN ('impression', 'click')
GROUP BY video_id
ORDER BY impressions DESC
LIMIT 20 OFFSET 0
```

**Общая по сайту** (`GET /admin/stats`):
```sql
SELECT
    countIf(event_type = 'impression') AS total_impressions,
    countIf(event_type = 'click') AS total_clicks,
    if(total_impressions > 0, round(total_clicks * 100.0 / total_impressions, 2), 0) AS total_ctr,
    COUNT(DISTINCT video_id) AS unique_videos
FROM events
WHERE event_type IN ('impression', 'click')
```

Сортировка статистики: `impressions`, `clicks`, `ctr` (asc/desc).

---

### 14.4 Как часто сайт обновляется

#### Цикл обновления контента

| Этап | Частота | Описание |
|------|---------|---------|
| **Worker poll** | каждые **30 сек** | Проверяет `parse_queue` на pending задачи |
| **Auto-reparse** | каждые **24 часа** | Автоматически ставит в очередь аккаунты, не парсенные > 24ч |
| **Первый парсинг** | — | Скачивает до **50 видео** с аккаунта |
| **Повторный парсинг** | — | Проверяет только последние **15 видео** (дельта-обновление) |
| **AI категоризация** | после парсинга | Батчи по **50 видео**, до **5 параллельных** запросов к Claude |

**SQL для выбора задач (атомарный с FOR UPDATE SKIP LOCKED):**
```sql
UPDATE parse_queue
SET status = 'running', started_at = NOW()
WHERE id = (
    SELECT pq.id FROM parse_queue pq
    JOIN accounts a ON a.id = pq.account_id AND a.is_active = true
    WHERE pq.status = 'pending'
    ORDER BY pq.created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING ...
```

**Auto-enqueue stale accounts (при пустой очереди):**
```sql
SELECT a.id FROM accounts a
WHERE a.is_active = true
  AND (a.last_parsed_at IS NULL
       OR a.last_parsed_at < NOW() - make_interval(hours => 24))
  AND NOT EXISTS (
      SELECT 1 FROM parse_queue pq
      WHERE pq.account_id = a.id AND pq.status IN ('pending', 'running')
  )
ORDER BY a.last_parsed_at ASC NULLS FIRST
```

#### Цикл обновления кешей

| Кеш | TTL | Что означает |
|-----|-----|-------------|
| Список видео (`vl:*`) | **60 сек** | Новые видео появятся на сайте max через 1 мин после добавления в БД |
| Детали видео (`vd:*`) | **300 сек** | Изменения в видео (категории, название) — через 5 мин |
| Категории (`cat:*`) | **60 сек** | Новые категории — через 1 мин |
| Поиск (`src:*`) | **60 сек** | Результаты поиска обновляются каждую минуту |

**Инвалидация кеша:** паттерн `SCAN + DEL`:
```go
// Пример: инвалидировать все списки для сайта 1
cache.InvalidatePattern(ctx, "vl:1:*")
```

#### Цикл обновления статистики

| Этап | Задержка |
|------|----------|
| Событие в браузере → Go API | ~мгновенно (sendBeacon) |
| EventBuffer → ClickHouse | **1 сек** (или при 1000 событий) |
| ClickHouse → Админка | Запрос в реальном времени (без кеша) |

**Итого от парсинга до появления на сайте:**
```
Аккаунт добавлен → parse_queue (мгновенно)
  → Worker подхватит (до 30 сек)
  → Парсинг Twitter/Instagram (1-5 мин, зависит от количества видео)
  → Загрузка в S3 + запись в БД
  → Redis кеш истечёт (до 60 сек)
  → Видео появляется на витрине

Общее время: ~2-7 минут
```

---

### 14.5 Обработка ошибок парсинга

```
Парсинг упал → parse_queue.status = 'failed', error записана
            → accounts.parse_errors += 1
            → Если parse_errors >= 5 → accounts.is_active = false (аккаунт отключен)
            → Админ может: retry-failed (перезапуск) или посмотреть ошибку в /admin/queue
```

---

## 15. Известные ограничения

1. Нет retry при сбое batch insert в ClickHouse — события теряются
2. Admin token без ротации/expire
3. Парсеры требуют ручной настройки cookies (yt-dlp для Twitter, session_id для Instagram)
4. Нет Swagger/OpenAPI документации
5. view_count/click_count в PostgreSQL — кеш платформы, не наша аналитика
6. CORS разрешены все origins (нужно ограничить на production)
7. Hover preview не реализован (preview_url есть в данных, но фронт не использует)
8. Нет WebSocket/SSE — фронт не обновляется в реальном времени, только при перезагрузке страницы
