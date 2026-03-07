# xxxaccounter — Документация

> Последнее обновление: 2026-03-06
> Админка: **xcj** | Публичный сайт: **xxxaccounter**

---

# Уровень 1: Продуктовая логика

## Что это

**xxxaccounter** — платформа для раскрутки аккаунтов в социальных сетях. Владельцы каналов покупают листинги, чтобы их контент показывался аудитории сайта. Сайт собирает видео с Twitter (X) и Instagram, красиво отображает их, и за счёт этого генерирует трафик, который монетизируется.

**xcj** — внутреннее название админ-панели для управления платформой.

## Как работает

### 1. Сбор контента

Админ добавляет аккаунт социальной сети (например `@SpaceX` на Twitter). Парсер автоматически:
- Скачивает список видео с аккаунта
- Генерирует превью-картинку (тумбу) и 5-секундный превью-клип
- Загружает файлы в облачное хранилище (S3)
- AI (OpenAI GPT-4o Vision) автоматически назначает категории каждому видео

### 2. Витрина

**Главная страница:**
- **Profile Stories** — горизонтальная лента аватаров моделей в стиле Instagram Stories (56px круги с gradient ring). Прокручивается горизонтально. Клик ведёт на профиль модели (/model/{slug}). Данные из API: GET /api/v1/accounts (аккаунты отсортированы по количеству видео)
- Сетка видео-карточек: тумба (картинка), при наведении — превью-видео. Название, автор, длительность. Клик → переход на оригинал (Twitter/Instagram) в новой вкладке

**Explore/Поиск (/search):**
- При отсутствии поискового запроса — режим Explore:
  - Строка поиска
  - Сетка категорий-pills (4x3 компактная раскладка, кнопка "More..." раскрывает все 32 категории)
  - Random video grid — 3-колоночная сетка тумб с infinite scroll
- При наличии запроса — результаты поиска

**Нижняя навигация:** 3 вкладки — Home, Search, Shuffle

Фильтрация: по категориям, по странам. Сортировка: новые, популярные, случайные.

### 2.1 Профиль модели

Страница `/model/[slug]` — профиль конкретного аккаунта:
- Шапка: аватар, имя, платформа, кол-во подписчиков
- Сетка видео-тумб аккаунта. Клик по тумбе открывает оригинальный URL (Instagram/Twitter) **напрямую в новой вкладке** (без промежуточной страницы `/video/{id}`). Каждый клик трекается как `profile_thumb_click` в аналитике
- **Similar Models** (только для бесплатных аккаунтов) — секция внизу страницы, показывающая модели из той же категории. 3-колоночная сетка с аватарами и ссылками на профили

### 3. Мультисайт

Один бэкенд обслуживает несколько сайтов с разными доменами. Каждый сайт:
- Имеет свой набор категорий и видео
- Определяется автоматически по домену
- Может иметь свою тему оформления

Это позволяет запускать нишевые сайты (спорт, развлечения, технологии) на одной инфраструктуре.

### 4. Аналитика

Сайт отслеживает собственную статистику:
- **Impressions** — сколько раз тумба видео была показана посетителю
- **Clicks** — сколько раз посетитель кликнул и ушёл на оригинальную платформу
- **CTR** — процент кликов от показов

Данные хранятся в быстрой аналитической базе (ClickHouse) и отображаются в админке. Это позволяет понять, какой контент работает лучше, и продавать листинги на основе данных.

### 5. Баннерная система (Promo)

Для платных моделей (is_paid=true) автоматически генерируются рекламные баннеры из тумб видео. Баннеры используются для закупки трафика через внешние рекламные сети (ExoClick, TrafficStars и др.).

**Как работает:**
- Админ включает Promotion для аккаунта → система автоматически генерирует баннеры из всех видео во всех настроенных размерах
- При парсинге новых видео у платного аккаунта → баннеры генерируются автоматически
- Готовые баннеры доступны по URL `/b/{id}` (302 redirect на CDN), клик по баннеру `/b/{id}/click` ведёт на профиль модели
- Аналитика: banner_impression (показ) и banner_click (клик) в ClickHouse; Imprs/Clicks/CTR отображаются в админке

**Качество баннеров:**
- **Gemini AI smart crop** — Gemini Image Editing API (`gemini-2.5-flash-image`) выполняет только smart crop (composition/framing) под нужный aspect ratio (напр. "6:5"). Gemini НЕ делает color enhancement — только кадрирование (~$0.04 за изображение). Fallback при недоступности Gemini — center-crop
- **Pillow ImageEnhance** — программное улучшение цвета после resize: contrast +35%, color saturation +40%, sharpness +50%, brightness +5%
- **Text overlay** — градиент внизу + @username + "Watch Now →" делает баннер кликабельным и узнаваемым
- Полный пайплайн: Gemini crop → Pillow Lanczos resize → Pillow enhance → overlay → JPEG q=90

**Размеры (настраиваемые):**
- 300x250 (Medium Rectangle) — дефолтный
- Типы: image (баннер) и video (preroll, на будущее)
- Можно добавлять новые размеры через админку

**Динамический сервинг (iframe embed):**
- `GET /b/serve?size=300x250` — отдаёт HTML-страницу с лучшим баннером из пула (CTR-based selection), ротация при равном CTR
- Таргетинг: `&cat=slug` (категория), `&kw=category_slug` (категория, аналог cat), `&aid=123` (конкретный аккаунт)
- **CTR-based selection:** вместо случайного выбора — система выбирает баннер с наивысшим CTR из ClickHouse; при равном CTR — случайный fallback
- Redis-кеш пулов баннеров (TTL 60s): hot path < 2ms
- Click tracking: клик по баннеру → `/b/{id}/click` → redirect на `/model/{slug}` (абсолютный URL через SITE_BASE_URL)
- Impression tracking: автоматически при каждом показе через EventBuffer → ClickHouse
- Пустой пул → graceful degradation (пустая прозрачная страница)
- Embed-код генерируется в админке (Promo → Embed Code): выбор категории + keywords → копируемые iframe-сниппеты для каждого размера

**Управление:**
- Вкладка "Promo" на странице аккаунта — просмотр баннеров в оригинальном размере, ручная генерация
- Раздел "Promo" в sidebar — все баннеры по всем платным аккаунтам, добавление размеров, статистика (Imprs/Clicks/CTR), embed-код для внешних сайтов

### 5.1 Воронка конверсий баннеров (Banner Conversion Funnel)

Расширение баннерной системы: полная воронка от показа до конверсии с привязкой источника трафика и S2S постбеками в рекламные сети.

**Как работает воронка:**
1. **Показ** — iframe с баннером загружается на стороннем сайте. Параметры `src` (источник) и `click_id` (ID клика) передаются в URL: `/b/serve?size=300x250&src=exoclick&click_id=abc123`
2. **Наведение** — JavaScript в iframe отслеживает mouseenter и отправляет пиксель `/b/{id}/hover`
3. **Клик** — переход на `/b/{id}/click`, который редиректит на `/model/{slug}` с параметрами src и click_id
4. **Лендинг** — на странице модели компонент `AdLandingTracker` сохраняет src + click_id в sessionStorage
5. **Конверсия (social_click)** — посетитель кликает на ссылку фансайта (OnlyFans). Событие обогащается click_id из sessionStorage
6. **Конверсия (content_click)** — посетитель впервые за сессию кликает на контент (Instagram). Трекается один раз через sessionStorage flag

При каждой конверсии с привязанным source + click_id бэкенд автоматически отстукивает S2S постбек в рекламную сеть.

**Как настроить рекламную сеть (Ad Source):**
1. Перейти в админку: /admin/ad-sources (или Promo → Настройки → Ad Sources)
2. Создать новый источник:
   - **Name** — slug рекламной сети (напр. `exoclick`, `trafficstars`)
   - **Postback URL** — шаблон URL с плейсхолдерами: `https://adnetwork.com/postback?click_id={click_id}&event={event}`
   - **Active** — включить/выключить постбеки
3. В шаблоне доступны плейсхолдеры: `{click_id}` (ID клика от сети), `{event}` (тип конверсии: social_click / content_click)

**Как использовать embed-код с трекингом источника:**
- Стандартный iframe: `<iframe src="https://temptguide.com/b/serve?size=300x250">`
- С привязкой источника: `<iframe src="https://temptguide.com/b/serve?size=300x250&src=exoclick&click_id={CLICK_ID}">`
- Рекламные сети подставляют свой макрос вместо `{CLICK_ID}` (например, ExoClick: `{clickid}`, TrafficStars: `{click_id}`)
- В embed-коде генераторе (Promo → Настройки) можно выбрать рекламную сеть — click_id макрос подставится автоматически

**Статистика воронки:**
- Раздел Promo → Статистика показывает полную воронку по каждому источнику:
  - Показы → Наведения → Клики → Конверсии
  - CTR (клики/показы), Conversion Rate (конверсии/клики)
  - Фильтр по дате (7/30/90 дней)
- Список баннеров дополнен колонкой Hovers и breakdown по источникам

### 6. Админка (xcj)

Веб-панель для управления платформой:
- **Dashboard** — общая статистика (видео, аккаунты, очередь парсинга)
- **Accounts** — добавлять/удалять источники контента, запускать парсинг, фильтр по оплате (paid/free), включение/отключение промоушена, вкладка Promo с баннерами
- **Videos** — просматривать, удалять, пере-категоризировать видео
- **Stats** — аналитика сайта: тумбы с показами, кликами, CTR
- **Queue** — статус очереди парсинга (pending/running/done/failed)
- **Promo** — все баннеры по всем paid-аккаунтам, управление размерами баннеров, embed-код для внешних сайтов. Три вкладки: Баннеры (список с hovers + source breakdown), Настройки (embed-коды + conversion tracker + ad sources), Статистика (воронка по источникам)
- **Ad Sources** — управление рекламными сетями (name, postback URL шаблон, active/inactive)
- **Categories** — управление категориями

## Монетизация

Два направления заработка:

**Для платформы:**
- Трафик (показы рекламы на сайте)
- Платные листинги — владельцы каналов платят за размещение и приоритетный показ своих видео

**Для владельцев каналов:**
- Их контент показывается целевой аудитории сайта
- Промо-размещение (promoted videos) — приоритетный показ в ленте
- Платные аккаунты — гарантированный приоритет на определённый срок

---

# Уровень 2: Архитектура

## Компоненты

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  Next.js    │────▶│   Go API     │────▶│  PostgreSQL   │
│  Фронтенд   │     │  (порт 8080) │     │  (основные    │
│  (порт 3000)│     │              │────▶│   данные)     │
└─────────────┘     │              │     └───────────────┘
                    │              │────▶┌───────────────┐
                    │              │     │  Redis        │
                    │              │     │  (кеш)        │
                    │              │     └───────────────┘
                    │              │────▶┌───────────────┐
                    └──────────────┘     │  ClickHouse   │
                                        │  (аналитика)  │
┌─────────────┐                         └───────────────┘
│  Python     │────▶ PostgreSQL (напрямую)
│  Парсер     │────▶ S3 (файлы)
└─────────────┘────▶ OpenAI API (AI)
```

### Go API (бэкенд)
- HTTP сервер на Chi router
- Публичные эндпоинты: видео (с фильтрами: category slug, exclude_account_id), аккаунты (AccountSummary), категории, поиск, аналитические события
- Админские эндпоинты: управление аккаунтами, видео, очередью, статистика
- Middleware: определение сайта по домену, rate limiting, CORS, логирование
- Буфер аналитических событий → batch insert в ClickHouse
- Динамический сервинг баннеров (`/b/serve`) с Redis-кешем пулов и ротацией

### Python Parser
- Парсит Twitter (через yt-dlp) и Instagram (через API)
- Генерирует тумбы (ffmpeg resize) и превью-клипы (5 сек)
- Загружает в S3
- AI категоризация через OpenAI GPT-4o Vision API (пачками по 50 видео)
- Работает как фоновый воркер, опрашивая очередь в PostgreSQL
- **Worker loop** запускает 3 корутины через `asyncio.gather`: parse_worker, banner_worker, categorizer_worker
- **Banner Worker** — генерирует баннеры из тумб видео для платных аккаунтов: Gemini AI smart crop (aspect ratio only, fallback: center-crop) → Lanczos resize → Pillow ImageEnhance (contrast/color/sharpness/brightness) → gradient/text overlay → JPEG → R2
- **Categorizer Worker** — фоновый цикл, берёт uncategorized видео, отправляет thumbnail в OpenAI GPT-4o Vision, сохраняет категории с confidence

### Next.js Frontend
- Server-side rendering для SEO
- Публичная часть: витрина видео с Profile Stories, Explore-страница (категории + random grid с infinite scroll), профили моделей
- Компоненты: ProfileStories (лента аватаров), ExploreGrid (random thumbnails), CategoryGrid (pills), BottomNav (3 вкладки)
- Админка (xcj): dashboard, управление аккаунтами/видео/очередью/аналитикой
- Трекинг: impression (IntersectionObserver), click → sendBeacon

## Потоки данных

### Добавление контента
```
Админ → Создаёт аккаунт → Нажимает "Parse"
→ Задача в очередь (parse_queue, status=pending)
→ Python Worker подхватывает → Парсит платформу
→ Для каждого видео: тумба + превью → S3 → запись в PostgreSQL
→ AI категоризатор → OpenAI GPT-4o → назначает категории
→ Видео появляется на витрине
```

### Просмотр витрины
```
Посетитель → xxxaccounter.com
→ Next.js → запрос к Go API → определение сайта по домену
→ Redis кеш hit? → вернуть кешированное
→ Cache miss → PostgreSQL → кешировать → ответ
→ Рендер сетки видео → HTML в браузер
```

### Аналитика
```
Тумба видна в viewport (50%+) → sendBeacon → impression event
Клик по тумбе → sendBeacon → click event
Go API → EventBuffer (in-memory)
→ каждую 1 сек или по 1000 событий → batch INSERT в ClickHouse
Админ → /admin/stats → Go API → SELECT из ClickHouse + metadata из PG
```

## Базы данных

### PostgreSQL — основные данные
- **sites** — мультисайт: домен, конфиг, тема
- **accounts** — источники контента (Twitter/Instagram аккаунты)
- **videos** — все видео с метаданными
- **categories** — иерархические категории
- **video_categories** — связь видео↔категории (M2M, с confidence от AI)
- **site_categories / site_videos** — какие видео/категории на каком сайте
- **parse_queue** — очередь парсинга
- **banner_sizes** — глобальные размеры баннеров (300x250 дефолтный, type: image/video)
- **banners** — сгенерированные баннеры (video → image URL на R2)
- **banner_queue** — очередь генерации баннеров

### ClickHouse — аналитика
- **events** — все события (impression, click, hover, view, banner_impression, banner_click)
- **mv_banner_daily** — materialized view с агрегацией banner impressions/clicks по дням
  - Партиционирование по месяцам, TTL 12 месяцев
  - Быстрые агрегации: countIf, GROUP BY

### Redis — кеш
- Списки видео (60 сек)
- Детали видео (5 мин)
- Категории (60 сек)
- Результаты поиска (60 сек)

## Авторизация

- Публичный API: без авторизации, определение сайта по домену
- Админ API: Bearer token в заголовке Authorization
- Админ UI: пароль → cookie `admin_token` → Bearer token к API

---

# Операционные заметки

## AI Categorizer (OpenAI GPT-4o Vision)

### Как работает
Categorizer — часть parser-worker. Автоматически берёт видео без `ai_processed_at`, отправляет thumbnail в OpenAI GPT-4o Vision, получает 1-5 категорий с confidence score, сохраняет в БД.

### Env-переменные
| Переменная | Описание |
|------------|----------|
| `OPENAI_API_KEY` | API ключ OpenAI (обязателен для работы categorizer) |
| `CATEGORIZER_BATCH_SIZE` | Размер батча (default: 50) |
| `CATEGORIZER_CONCURRENCY` | Параллельность запросов к API (default: 5) |

### Проверка статуса категоризации
```sql
-- Сколько видео категоризировано
SELECT count(*) FROM video_categories;

-- Сколько категорий создано
SELECT count(*) FROM categories;
SELECT * FROM categories ORDER BY slug;

-- Сколько видео ещё не обработано
SELECT count(*) FROM videos WHERE ai_processed_at IS NULL AND is_active = true;

-- Видео с категориями
SELECT v.id, v.title, c.name, vc.confidence
FROM video_categories vc
JOIN videos v ON v.id = vc.video_id
JOIN categories c ON c.id = vc.category_id
ORDER BY vc.confidence DESC
LIMIT 20;
```

### Ручной запуск
```bash
# Запустить категоризацию вручную (вне worker loop)
python -m parser categorize
```

### Пере-категоризация
```bash
# Через Admin API — сбросить ai_processed_at для всех видео
curl -X POST http://localhost:8080/api/v1/admin/videos/recategorize \
  -H "Authorization: Bearer xcj-admin-2024"
```
Это сбросит `ai_processed_at` у всех видео, и categorizer worker подхватит их при следующем цикле.

### Текущий статус (2026-03-05)
- Код: готов и задеплоен. Switched from Anthropic Claude Sonnet to OpenAI GPT-4o Vision
- Результаты первого прогона: 370 видео обработано, 41 категория создана, 1649 связей video_categories
- Мониторинг: ClickUp task https://app.clickup.com/t/869ccek1u

## Banner Worker (Gemini Image Editing)

### Как работает
Banner Worker генерирует рекламные баннеры из thumbnail видео для платных аккаунтов. Использует Gemini Image Editing API для интеллектуального кропа (composition/framing) и Pillow ImageEnhance для программного улучшения цвета.

### Пайплайн
```
thumbnail_lg_url → скачать → Gemini smart crop (aspect ratio, напр. "6:5") → Pillow Lanczos resize → Pillow ImageEnhance (contrast 1.35, color 1.4, sharpness 1.5, brightness 1.05) → overlay (@username + "Watch Now →") → JPEG q=90 → R2
```

**Разделение ответственности:**
- **Gemini** — только smart crop (composition, framing, rule of thirds). Промпт запрашивает aspect ratio, не пиксели, чтобы избежать сквоша
- **Pillow** — resize (Lanczos) + color enhancement (ImageEnhance). Программные значения — стабильные и предсказуемые

### Env-переменные
| Переменная | Описание |
|------------|----------|
| `GEMINI_API_KEY` | Google Gemini API key (обязателен для AI crop; без него — fallback на center-crop) |
| `GEMINI_MODEL` | Модель Gemini (default: `gemini-2.5-flash-image`) |

### Стоимость
- ~$0.04 за изображение (Gemini Image Editing API)
- При недоступности Gemini (нет ключа, ошибка API) — автоматический fallback на center-crop (бесплатно)

---

# Уровень 3: Техническая спецификация

> Полная техническая спецификация со всеми таблицами, полями, индексами, эндпоинтами, ENV-переменными и командами запуска находится в файле:
>
> **`TECHNICAL_SPEC.md`**

### Ключевые отличия от Уровня 2:

- Полные схемы всех таблиц PostgreSQL с типами данных и индексами
- Полная схема ClickHouse events table
- Полный список всех API эндпоинтов с параметрами
- Все middleware с описанием
- Полная структура Redis ключей и TTL
- Все ENV-переменные для каждого сервиса
- CLI команды парсера
- Настройки парсера (размеры тумб, битрейт превью, лимиты)
- Пароли и порты всех сервисов
- Известные ограничения и TODO
