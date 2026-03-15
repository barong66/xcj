# xxxaccounter — Документация

> Last updated: 2026-03-15 (Profile Feed Composition System implemented — section 2.3)
> Админка: **xcj** | Публичный сайт: **xxxaccounter**

---

# Уровень 1: Продуктовая логика

## Что это

**xxxaccounter** — платформа для раскрутки аккаунтов в социальных сетях. Владельцы каналов покупают листинги, чтобы их контент показывался аудитории сайта. Сайт собирает видео с Twitter (X) и Instagram, красиво отображает их, и за счёт этого генерирует трафик, который монетизируется.

**xcj** — внутреннее название админ-панели для управления платформой.

## Как работает

### 1. Сбор контента

Админ добавляет аккаунт социальной сети (например `@SpaceX` на Twitter). Парсер автоматически:
- Скачивает список видео и изображений с аккаунта (видео, фото-посты, карусели)
- Генерирует 5-секундный превью-клип (для видео)
- Извлекает 10 кадров из видео на равных интервалах
- **AI-powered thumbnail selection (NeuroScore):** все 10 кадров оцениваются NeuroScore Score API, лучший кадр автоматически выбирается как превью-картинка (тумба). Fallback: первый кадр → платформенная тумба → NULL
- Instagram: фото-посты и carousel-изображения тоже парсятся как источники для баннеров
- Twitter: image tweets парсятся наравне с видео
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

Страница `/model/[slug]` — профиль конкретного аккаунта. URLs используют `slug` аккаунта, или `username` как fallback если `slug` не задан (Go API: `COALESCE(slug, username)`).
- Шапка: аватар, имя, платформа, кол-во подписчиков
- Сетка видео-тумб аккаунта. Клик по тумбе открывает оригинальный URL (Instagram/Twitter) **напрямую в новой вкладке** (без промежуточной страницы `/video/{id}`). Каждый клик трекается как `profile_thumb_click` в аналитике
- **Similar Models** (только для бесплатных аккаунтов) — секция внизу страницы, показывающая модели из той же категории. 3-колоночная сетка с аватарами и ссылками на профили

### 2.2 Sticky profile header с информацией о модели

Когда посетитель просматривает страницу модели (`/model/[slug]`) или страницу видео (`/video/[id]`), хедер сайта переключается в «profile mode»:
- **Слева:** аватар модели + display name (вместо логотипа сайта)
- **Справа:** синяя pill-кнопка **"Follow me"** с иконкой OnlyFans (если у модели есть OnlyFans в `social_links`)

На остальных страницах (главная, поиск, категории) хедер показывает стандартный логотип сайта.

**Как работает:**
- На страницах модели и видео хедер автоматически показывает аватар и имя текущей модели
- Кнопка "Follow me" отображается только при наличии OnlyFans ссылки у аккаунта
- Клик по кнопке открывает OnlyFans профиль модели в новой вкладке
- Клик трекается как `social_click` в аналитике (ClickHouse)
- При переходе на другую страницу (главная, поиск, другая модель) — хедер возвращается к логотипу или обновляется данными новой модели

**Техническая реализация:**
- React Context (`OnlyFansContext`) передаёт URL, displayName и avatarUrl из страницы в глобальный Header
- `SiteLayout` оборачивает приложение в `OnlyFansProvider`
- Компонент `OnlyFansHeaderSetter` на страницах модели/видео устанавливает URL, displayName и avatarUrl при маунте и очищает при анмаунте
- `Header.tsx` — условный рендеринг: при наличии displayName/avatarUrl в контексте показывает аватар+имя, иначе логотип
- Go API (`video_store.go`) включает `social_links` аккаунта в ответ для видео-эндпоинтов

### 2.3 Profile Feed Composition

The profile page layout (`/model/[slug]`) is configurable per site via a **Feed Rule Pipeline**. Instead of hard-coded sections, the page is described as a declarative list of `FeedRule[]` — open one file (`web/src/templates/default/feed-config.ts`) to see exactly what the page shows.

**Default page layout (default template):**
1. One "trigger" video from the model (paid/promoted account's video comes first)
2. Five recent videos from the same model
3. Nine popular videos from similar models (same primary category)

**What admins can configure** (Admin panel → Websites → [site] → Display Settings → Profile Feed):
- **Model video count** (`profile_model_count`) — total count of the model's own videos
- **Similar count** (`profile_similar_count`) — how many similar-model videos to show
- **Similar sort** (`profile_similar_sort`) — ordering: `trigger_first` / `popular` / `random_popular`

**How similarity works:** V1 uses `SameCategoryStrategy` — similar models share the same primary category as the viewed model. Paid/promoted accounts are surfaced first. Future: LLM embeddings or external recommendation API.

**Technical note:** The feed is assembled server-side by `buildProfileFeed()` in `web/src/lib/profile-feed.ts`. `ProfileContent.tsx` is a pure presenter that only renders the resulting `FeedItem[]`. To change the default layout, edit `web/src/templates/default/feed-config.ts`. Per-site overrides are stored in `sites.config` JSONB and applied via `applyFeedOverrides()`.

### 3. Мультисайт

Один бэкенд обслуживает несколько сайтов с разными доменами. Каждый сайт:
- Имеет свой набор категорий и видео
- Определяется автоматически по домену
- Может иметь свою тему оформления (template)

Это позволяет запускать нишевые сайты (спорт, развлечения, технологии) на одной инфраструктуре.

### 3.1 Template System (UI kit per site)

Each site can have its own complete visual design (template) — a full UI kit that replaces all user-facing components (VideoCard, Header, navigation, profile pages, footer).

**How to activate a template:**
- In admin: Websites → select site → Display Settings → Template → choose from dropdown → Save
- The new template takes effect within **5 minutes** with no container rebuild required
- Template name is stored in `sites.config.template` (JSONB column)

**Built-in templates:**
- `default` — the standard TemptGuide dark theme

**Adding a new template:** create a folder under `web/src/templates/<name>/`, implement all required components, register in `registry.ts` and `page-registry.ts`, rebuild the web container once. After that, the template appears in the admin dropdown and can be switched at any time without rebuild.

**Technical details:**
- Template name is read from the database at request time via `GET /api/v1/config`
- `getSiteConfig()` uses React `cache()` for deduplication; TTL is 5 minutes
- CSS theme variables (colors, fonts) are injected server-side in `<head>` — no flash of unstyled content
- All visual components delegate to the active template via `useTemplate()` hook
- See `web/src/templates/_shared/` for the template contract (`types.ts`), registry, and React Context
- Full technical details: see section 7.6 in TECHNICAL_SPEC.md

### 4. Аналитика

Сайт отслеживает собственную статистику:
- **Impressions** — сколько раз тумба видео была показана посетителю
- **Clicks** — сколько раз посетитель кликнул и ушёл на оригинальную платформу
- **CTR** — процент кликов от показов

Данные хранятся в быстрой аналитической базе (ClickHouse) и отображаются в админке. Это позволяет понять, какой контент работает лучше, и продавать листинги на основе данных.

### 4.1 Account Stats (воронка аккаунта)

На странице каждого аккаунта в админке (`/admin/accounts/:id`) вкладка **Stats** отображается **по умолчанию** и показывает per-day funnel метрики:

| Метрика | Описание |
|---------|----------|
| Profile Views | Показы видео аккаунта (impression events) |
| IG/Twitter Clicks | Клики на оригинальный контент (click events) |
| Paid Site Clicks | Клики на фансайт/OnlyFans (social_click events) |
| Video Clicks | Клики по тумбам на странице модели (profile_thumb_click) |
| Sessions | Уникальные сессии посетителей |
| Avg Session | Средняя длительность сессии |

**Период:** переключатель 7 / 30 / 90 дней.

**Компоненты UI:**
- Summary cards — итоговые метрики за выбранный период
- Daily table — разбивка по дням с полной воронкой

**API endpoint:** `GET /api/v1/admin/accounts/{id}/stats?days=30`

Данные берутся из ClickHouse (таблица `events`), новых миграций не требуется.

### 4.2 Traffic Explorer

Гибкий аналитический инструмент на странице `/admin/stats` (вкладка **Traffic Explorer**, открывается по умолчанию). Позволяет анализировать весь трафик по любым измерениям.

**Возможности:**
- **Группировка** по 11 измерениям: дата, источник, реферер, страна, устройство, ОС, браузер, тип события, utm_source, utm_medium, utm_campaign
- **Вторичная группировка** — например, дата + источник, страна + устройство
- **Фильтры** — динамические dropdown'ы с реальными значениями из ClickHouse
- **Период** — переключатель 7 / 30 / 90 дней
- **8 метрик** — события, показы, клики, просмотры профилей, конверсии, сессии, CTR, Conversion Rate
- **Сортировка** — по любой метрике или измерению (asc/desc)
- **Summary cards** — итоговые значения за выбранный период

**Безопасность:** Динамический SQL строится исключительно из whitelist-maps (allowedDimensions, allowedFilterColumns, allowedTrafficSorts). Значения фильтров передаются через параметризованные запросы ClickHouse. SQL injection невозможна.

**API endpoints:**
- `GET /api/v1/admin/traffic-stats` — основной запрос с параметрами group_by, group_by2, days, sort_by, sort_dir, + фильтры
- `GET /api/v1/admin/traffic-stats/dimensions?days=N` — distinct значения для dropdown'ов

**UI:** Вторая вкладка "Video Stats" сохраняет прежнюю функциональность — тумбы видео с показами, кликами, CTR.

### 5. Баннерная система (Promo)

Для платных моделей (is_paid=true) автоматически генерируются рекламные баннеры из тумб видео. Баннеры используются для закупки трафика через внешние рекламные сети (ExoClick, TrafficStars и др.).

**Как работает:**
- Админ включает Promotion для аккаунта → система автоматически генерирует баннеры из всех видео во всех настроенных размерах
- При парсинге новых видео у платного аккаунта → баннеры генерируются автоматически
- **Multi-frame:** из каждого видео создаётся до 11 вариантов баннера (1 из thumbnail + до 10 из извлечённых фреймов). CTR-based selection автоматически выбирает лучший вариант
- **Image posts:** Instagram фото-посты, carousel-изображения и Twitter image tweets используются как дополнительные источники для баннеров
- Готовые баннеры доступны по URL `/b/{id}` (302 redirect на CDN), клик по баннеру `/b/{id}/click` ведёт на профиль модели
- Аналитика: banner_impression (показ) и banner_click (клик) в ClickHouse; Imprs/Clicks/CTR отображаются в админке

**Качество баннеров:**
- **MediaPipe face-aware smart crop** — Google MediaPipe BlazeFace модель (230KB, bundled) определяет лица и позиционирует кроп вокруг них. Fallback — center-crop с upper-third bias. Заменил OpenCV Haar cascades (2026-03-08) для лучшей точности детекции
- **Pillow ImageEnhance** — программное улучшение цвета после resize: contrast +35%, color saturation +40%, sharpness +50%, brightness +5%
- **HTML overlay** — градиент, @username и CTA ("Watch Me Now" и т.д.) рендерятся исключительно в HTML-шаблонах (не запекаются в изображение), что позволяет использовать hover-эффекты и интерактивность
- Полный пайплайн: MediaPipe smart crop → Pillow Lanczos resize → Pillow enhance → JPEG q=90 (чистое фото, без overlay)

**Размеры (настраиваемые):**
- 300x250 (Medium Rectangle) — дефолтный
- Типы: image (баннер) и video (preroll, на будущее)
- Можно добавлять новые размеры через админку

**Динамический сервинг (iframe embed):**
- `GET /b/serve?size=300x250` — отдаёт интерактивный HTML-баннер с hover-эффектами (CTR-based selection), ротация при равном CTR
- Таргетинг: `&cat=slug` (категория), `&kw=category_slug` (категория, аналог cat), `&aid=123` (конкретный аккаунт)
- **Стили баннеров (`&style=`):** 4 HTML+CSS шаблона с hover-эффектами (scale, glow, opacity transitions). По умолчанию — случайный стиль:
  - **bold** — яркий: розовая рамка, градиентная CTA-кнопка "Watch Me Now", "Exclusive Content"
  - **elegant** — утончённый: золотые акценты, serif шрифт, diamond-орнамент, нижний градиент
  - **minimalist** — чистый: лёгкий overlay, watermark "TemptGuide", стрелочный CTA
  - **card** — карточка: тёмная нижняя панель (25%) + фото (75%), кнопка play, красный акцент
- Все шаблоны: без CSS image filters (улучшение применяется Pillow при генерации); hover-эффекты (scale, glow, opacity). Overlay (текст, CTA, рамки) — исключительно в HTML/CSS. Минимальные градиенты (только снизу для читаемости)
- Баннеры используют raw thumbnail (thumbnail_lg_url) вместо статического JPEG, показывают @username
- **CTR-based selection:** вместо случайного выбора — система выбирает баннер с наивысшим CTR из ClickHouse; при равном CTR — случайный fallback
- Redis-кеш пулов баннеров (TTL 60s): hot path < 2ms
- Click tracking: клик по баннеру → `/b/{id}/click` → redirect на `/model/{slug}` (абсолютный URL через SITE_BASE_URL)
- Impression tracking: автоматически при каждом показе через EventBuffer → ClickHouse
- Hover tracking: JS mouseenter в HTML-шаблоне → 1x1 GIF pixel `/b/{id}/hover`
- Пустой пул → graceful degradation (пустая прозрачная страница)
- Embed-код генерируется в админке (Promo → Embed Code): `<script>` тег loader.js с выбором стиля (Bold/Elegant/Minimalist/Card/Random) и источника трафика → копируемые сниппеты для каждого размера. Preview по-прежнему использует iframe для live-рендеринга в админке

**Embed-скрипт для издателей (loader.js):**

Вместо ручной вставки iframe с фиксированными параметрами, издатель может использовать лёгкий JS-скрипт (~1.5KB), который автоматически определяет контекст страницы и подбирает релевантный баннер.

Как работает:
1. Издатель вставляет одну строку кода на страницу
2. Скрипт читает контекст страницы: заголовок, meta-теги (description, keywords, Open Graph), `<h1>`, URL
3. Выполняет частотный анализ слов, отфильтровывает стоп-слова, извлекает top-5 ключевых слов
4. Создаёт iframe с контекстным таргетингом: `/b/serve?kw=keyword1,keyword2,...`
5. Lazy loading: баннер загружается только когда приближается к видимой области (200px до viewport)

Использование:
```html
<!-- Простейший вариант -->
<script async src="https://api.temptguide.com/b/loader.js" data-size="300x250"></script>

<!-- С выбором стиля -->
<script async src="https://api.temptguide.com/b/loader.js" data-size="300x250" data-style="bold"></script>

<!-- С привязкой к рекламной сети -->
<script async src="https://api.temptguide.com/b/loader.js" data-size="300x250" data-src="adnet1" data-click-id="{CLICK_ID}"></script>

<!-- С полным набором ad network макросов (генерируется автоматически в админке) -->
<script async src="https://api.temptguide.com/b/loader.js" data-size="300x250" data-src="traforama" data-click-id="%ID%" data-ref-domain="%REFDOMAIN%" data-original-ref="%ORIGINALREF%" data-spot-id="%SPOTID%" data-node-id="%NODEID%" data-auction-price="%AUCTIONPRICE%" data-cpv-price="%CPVPRICE%" data-cpc="%CPC%" data-campaign-id="%CAMPAIGNID%" data-creative-id="%CREATIVEID%"></script>
```

Атрибуты:
- `data-size` — размер баннера (напр. `300x250`), по умолчанию `300x250`
- `data-style` — стиль баннера: `bold`, `elegant`, `minimalist`, `card` (по умолчанию: случайный)
- `data-src` — источник трафика (slug рекламной сети)
- `data-click-id` — ID клика рекламной сети для S2S постбеков
- `data-ref-domain` — домен реферера (макрос рекламной сети)
- `data-original-ref` — оригинальный реферер (макрос рекламной сети)
- `data-spot-id` — ID рекламного места (макрос рекламной сети)
- `data-node-id` — ID ноды (макрос рекламной сети)
- `data-auction-price` — цена аукциона (макрос рекламной сети)
- `data-cpv-price` — CPV цена (макрос рекламной сети)
- `data-cpc` — CPC цена (макрос рекламной сети)
- `data-campaign-id` — ID кампании (макрос рекламной сети)
- `data-creative-id` — ID креатива (макрос рекламной сети)

Все ad network macro параметры автоматически прокидываются через весь pipeline: banner serve → click → landing page → sessionStorage → events extra JSON. При выборе источника трафика (напр. "traforama") в админке, embed-код автоматически включает все макросы с плейсхолдерами сети.

Скрипт кешируется 24 часа, работает на любом домене (CORS enabled).

**Деактивация баннеров:**
- На вкладке Promo каждого аккаунта — кнопка-корзинка на каждой карточке баннера
- Клик → диалог подтверждения → баннер деактивируется (is_active=false)
- **Массовые действия:** чекбоксы на каждой карточке + Select All toggle. Выбранные баннеры можно массово деактивировать или перегенерировать (batch deactivate / batch regenerate)
- Деактивированный баннер не участвует в ротации (/b/serve), не показывается внешним сайтам, и не отображается в списке баннеров аккаунта в админке
- **Важно:** повторная генерация баннеров (re-crop) НЕ реактивирует вручную деактивированные баннеры — InsertBanner upsert обновляет только image_url, не трогая is_active

**Предпросмотр стилей (Style Preview):**
- На вкладке Promo аккаунта — выпадающий селектор стиля: Static JPEG / Bold / Elegant / Minimalist / Card
- **Static JPEG** — показывает оригинальное сгенерированное изображение баннера (по умолчанию)
- **Bold / Elegant / Minimalist / Card** — показывает баннер через iframe в соответствующем HTML-шаблоне (`/b/{id}/preview?style=X`)
- Позволяет админу сравнить, как баннер выглядит в разных стилях перед выбором стиля для embed-кода

**Re-grab (перегенерация):**
- Кнопка re-grab на каждой карточке баннера -- перезапускает генерацию конкретного баннера (re-crop + re-upload)
- Массовый re-grab через batch regenerate для выбранных баннеров

**Re-crop (ручной кроп):**
- Кнопка crop на карточке баннера открывает модальное окно с визуальным кропом
- Используется react-easy-crop: drag & zoom для выбора области, aspect ratio заблокирован под размер баннера
- Координаты кропа (x, y, width, height в пикселях source-изображения) отправляются на сервер
- Go API скачивает source-изображение (frame или thumbnail), кропит, ресайзит до размеров баннера, загружает в R2
- Source-изображение определяется автоматически: из video_frames (если баннер из extracted frame) или из videos.thumbnail_lg_url (если из thumbnail)
- Новый endpoint: `POST /api/v1/admin/banners/{id}/recrop`

**Управление:**
- Вкладка "Promo" на странице аккаунта — все баннеры без пагинации, mass selection (Select All), style preview, re-grab, batch deactivate/regenerate
- Раздел "Promo" в sidebar — все баннеры по всем платным аккаунтам, добавление размеров, статистика (Imprs/Clicks/CTR), embed-код для внешних сайтов

### 5.1 Воронка конверсий баннеров (Banner Conversion Funnel)

Расширение баннерной системы: полная воронка от показа до конверсии с привязкой источника трафика и S2S постбеками в рекламные сети.

**Как работает воронка:**
1. **Показ** — iframe с баннером загружается на стороннем сайте. Параметры `src` (источник), `click_id` (ID клика) и ad network macros (ref_domain, spot_id, campaign_id и др.) передаются в URL: `/b/serve?size=300x250&src=exoclick&click_id=abc123&ref_domain=...&spot_id=...`
2. **Наведение** — JavaScript в iframe отслеживает mouseenter и отправляет пиксель `/b/{id}/hover` с src, click_id и ad network params
3. **Клик** — переход на `/b/{id}/click` с всеми параметрами, редиректит на `/model/{slug}` с src, click_id и ad network params в URL
4. **Лендинг** — на странице модели компонент `AdLandingTracker` сохраняет src + click_id + ad network params (как `ad_params` JSON) в sessionStorage
5. **Конверсия (social_click)** — посетитель кликает на ссылку фансайта (OnlyFans). Событие обогащается click_id + ad_params из sessionStorage → extra JSON
6. **Конверсия (content_click)** — посетитель впервые за сессию кликает на контент (Instagram). Трекается один раз через sessionStorage flag, обогащается ad_params

При каждой конверсии с привязанным source + click_id бэкенд автоматически отстукивает S2S постбек в рекламную сеть.

**Как настроить рекламную сеть (Ad Source):**
1. Перейти в админку: Promo → Настройки → Ad Sources (/admin/promo → Settings tab)
2. Создать новый источник:
   - **Name** — slug рекламной сети (напр. `exoclick`, `trafficstars`)
   - **Postback URL** — шаблон URL с плейсхолдерами: `https://adnetwork.com/postback?click_id={click_id}&event={event}`
   - **Active** — включить/выключить постбеки
3. В шаблоне доступны плейсхолдеры: `{click_id}` (ID клика от сети), `{event}` (тип конверсии: social_click / content_click), `{cpa}` (CPA цена для данной модели и типа события), `{event_id}` (ID события для данной модели + рекламной сети + типа события, 1-9)

**Как использовать embed-код с трекингом источника:**
- Стандартный iframe: `<iframe src="https://temptguide.com/b/serve?size=300x250">`
- С привязкой источника: `<iframe src="https://temptguide.com/b/serve?size=300x250&src=exoclick&click_id={CLICK_ID}">`
- Рекламные сети подставляют свой макрос вместо `{CLICK_ID}` (например, ExoClick: `{clickid}`, TrafficStars: `{click_id}`)
- В embed-коде генераторе (Promo → Настройки) можно выбрать рекламную сеть — click_id макрос подставится автоматически

**Per-model Conversion Prices (CPA):**

Для каждой модели (аккаунта) можно задать индивидуальную CPA-цену для каждого типа конверсии. Эта цена автоматически подставляется в `{cpa}` плейсхолдер постбек-URL при отправке S2S постбека в рекламную сеть.

Как настроить:
1. Перейти на страницу аккаунта: /admin/accounts/{id}
2. Открыть вкладку **Promo**
3. В секции **Conversion Prices** указать цену для каждого типа события:
   - **social_click** — клик на фансайт (OnlyFans и др.)
   - **content_click** — первый клик на контент за сессию
4. Сохранить — цена применяется мгновенно ко всем новым постбекам

**Per-source Event IDs:**

Разные рекламные сети нумеруют свои конверсионные события по-разному (1-9). Event ID настраивается отдельно для каждой комбинации модель + рекламная сеть + тип события. Подставляется в `{event_id}` плейсхолдер постбек-URL.

Как настроить:
1. Перейти на страницу аккаунта: /admin/accounts/{id}
2. Открыть вкладку **Promo**
3. В секции **Event IDs per Source** — для каждой активной рекламной сети отображаются поля event_id для каждого типа конверсии
4. Указать нужный event_id (1-9) — значение автоматически сохраняется
5. По умолчанию event_id = 1, если не задано

Пример постбек-URL с CPA и Event ID:
```
https://adnetwork.com/postback?click_id={click_id}&event={event}&payout={cpa}&event_id={event_id}
```

При конверсии система автоматически определит, к какому аккаунту относится событие, найдёт CPA-цену для данного типа события и event_id для данной рекламной сети, и подставит оба значения в URL. CPA-цена и event_id также сохраняются в записи постбека для аудита и корректного retry при повторных попытках.

**Статистика воронки:**
- Раздел Promo → Статистика показывает полную воронку по каждому источнику:
  - Показы → Наведения → Клики → Конверсии
  - CTR (клики/показы), Conversion Rate (конверсии/клики)
  - Фильтр по дате (7/30/90 дней)
- Список баннеров дополнен колонкой Hovers и breakdown по источникам

### 5.2 Banner Metrics & Performance Analytics

Расширение баннерной аналитики: сбор метрик производительности, парсинг User-Agent, клиентский контекст (устройство, экран, соединение, UTM), performance beacons для каждого баннер-показа.

**Что собирается автоматически:**

*Серверная сторона (при каждом banner_impression):*
- **Browser** -- Chrome, Firefox, Safari, Edge, Opera, Samsung Browser, UC Browser, Other
- **OS** -- Windows, macOS, Linux, Android, iOS, Chrome OS, Other
- **Device Type** -- desktop, mobile, tablet, bot
- **IP, Referrer** -- из HTTP request headers

*Клиентская сторона (через loader.js):*
- **Screen/Viewport** -- разрешение экрана и размер viewport
- **Language** -- язык браузера (navigator.language)
- **Connection Type** -- тип соединения (4g, 3g, wifi via navigator.connection)
- **Page URL** -- URL страницы издателя
- **UTM параметры** -- utm_source, utm_medium, utm_campaign

*Performance beacon (при уходе со страницы):*
- **Image Load Time** -- время загрузки изображения баннера (ms)
- **Render Time** -- время рендеринга HTML (DOMContentLoaded, ms)
- **Time to Visible** -- время до попадания в видимую область (IntersectionObserver, ms)
- **Dwell Time** -- общее время видимости баннера (ms)
- **Hover Duration** -- длительность наведения мыши (ms)
- **Viewability** -- IAB стандарт: баннер считается "viewable" если >= 50% видимо >= 1 секунды

**Admin Dashboard (Promo -- Performance tab):**
- **Overview Cards** -- средние значения: image load time, render time, viewability %, dwell time
- **Device Breakdown** -- разбивка событий по device_type, browser, OS
- **Top Referrers** -- откуда приходит баннерный трафик
- **Period Selector** -- 7 / 30 / 90 дней

**Хранение:**
- Обогащённые события -- ClickHouse `events` (14 новых колонок: browser, os, device_type, screen/viewport, language, connection, page_url, country, UTM)
- Performance метрики -- ClickHouse `banner_perf` (отдельная таблица, TTL 6 месяцев)
- Materialized Views: `mv_banner_perf_daily` (AggregatingMergeTree), `mv_events_device_daily` (SummingMergeTree)

**Migration:** `scripts/migrations/012_clickhouse_banner_metrics.sql`

### 6. Админка (xcj)

Веб-панель для управления платформой. Сайдбар разбит на 6 тематических групп:

**Overview**
- **Dashboard** (`/admin`) — per-site карточки с метриками (видео, аккаунты, просмотры, клики за 7 дней). Alert bar вверху при наличии упавших задач в очереди парсинга

**Analytics**
- **Traffic** (`/admin/analytics/traffic`) — Traffic Explorer с site selector и 4 вкладками: Overview (гибкая аналитика с group by, 8 метриками, фильтрами), Source, Country, Device. Заменяет старый `/admin/stats`
- **Revenue** (`/admin/analytics/revenue`) — воронка баннерной конверсии по источникам + постбеки

**Content**
- **Accounts** — добавлять/удалять источники контента, запускать парсинг, фильтр по оплате (paid/free), включение/отключение промоушена. Страница аккаунта: табы Stats (по умолчанию), Fan Site Links, Promo. Promo tab: все баннеры без пагинации, mass selection с Select All, batch deactivate/regenerate, style preview (Static JPEG / Bold / Elegant / Minimalist / Card), re-grab, re-crop (ручной кроп через визуальный редактор), **Conversion Prices** — per-event-type CPA цены для S2S постбеков, **Event IDs per Source** — per-source event_id (1-9). Удаление аккаунта — **необратимое** (hard DELETE, каскадно удаляет все видео, баннеры, записи очередей)
- **Videos** — просматривать, удалять, пере-категоризировать видео
- **Content** — курирование фреймов видео: accordion-список всех видео с извлечёнными фреймами, выбор лучшего фрейма на видео, удаление лишних фреймов (по одному или массово). Фильтры по источнику (Instagram/Twitter) и aspect ratio. Карточки фреймов 202×360px с NeuroScore
- **Categories** — управление категориями

**Ads**
- **Promo** (`/admin/ads/promo`) — Banner gallery по всем paid-аккаунтам, embed-коды через loader.js `<script>` тег с выбором стиля. Заменяет старый `/admin/promo`
- **Sources** (`/admin/ads/sources`) — CRUD рекламных сетей (Ad Sources): name, postback URL шаблон, active/inactive + postback config

**Sites**
- **Websites** (`/admin/websites`) — список сайтов + колонка Traffic 7d. Страница сайта (`/admin/websites/[id]`): вкладки General + Content + Banners

**System**
- **Queue** — статус очереди парсинга (pending/running/done/failed). Автоматически открывает вкладку Failed при наличии ошибок
- **Health** — системный health-check

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
- Админские эндпоинты: управление аккаунтами (включая stats funnel per account), видео, очередью, статистика
- Middleware: определение сайта по домену, rate limiting, CORS, логирование
- Буфер аналитических событий → batch insert в ClickHouse
- Динамический сервинг баннеров (`/b/serve`) с Redis-кешем пулов и ротацией
- Embed-скрипт для контекстного таргетинга (`/b/loader.js`) -- извлекает ключевые слова со страницы издателя
- S3/R2 client (`api/internal/s3/client.go`) -- загрузка файлов из Go API (используется для re-crop баннеров)

### Python Parser
- Парсит Twitter (через yt-dlp) и Instagram (через API)
- Поддерживает видео и изображения: Instagram photo posts, carousels, Twitter image tweets (media_type: video/image)
- Генерирует превью-клипы (5 сек)
- **Frame extraction:** извлекает 10 кадров из видео (ffmpeg) + сохраняет carousel/photo изображения → `video_frames`
- **NeuroScore thumbnail selection:** scores all frames via NeuroScore Score API, selects the best-scoring frame as thumbnail (SM 480×270 + LG 810×1440). Fallback chain: best frame → first frame → platform thumbnail → NULL
- Загружает в S3
- AI категоризация через OpenAI GPT-4o Vision API (пачками по 50 видео)
- Работает как фоновый воркер, опрашивая очередь в PostgreSQL
- **Worker loop** запускает 3 корутины через `asyncio.gather`: parse_worker, banner_worker, categorizer_worker
- **Banner Worker** — генерирует баннеры из тумб + извлечённых фреймов для платных аккаунтов: до 5 вариантов на видео (1 thumbnail + 4 frames). MediaPipe face-aware smart crop → Lanczos resize → Pillow ImageEnhance → JPEG q=90 (clean photo, no overlay) → R2. Overlay рендерится исключительно в HTML-шаблонах. CTR-based selection выбирает лучший вариант
- **Categorizer Worker** — фоновый цикл, берёт uncategorized видео, отправляет thumbnail в OpenAI GPT-4o Vision, сохраняет категории с confidence

### Next.js Frontend
- Server-side rendering для SEO
- Публичная часть: витрина видео с Profile Stories, Explore-страница (категории + random grid с infinite scroll), профили моделей
- Компоненты: ProfileStories (лента аватаров), ExploreGrid (random thumbnails), CategoryGrid (pills), BottomNav (3 вкладки)
- Админка (xcj): dashboard, управление аккаунтами/видео/очередью/аналитикой
- Трекинг: impression (IntersectionObserver), click → sendBeacon

### SEO & Lighthouse (аудит и оптимизация, 2026-03-07)

Комплексный SEO-аудит и Lighthouse-оптимизация. Финальные результаты: **SEO 100**, **Performance ~95+**, **Best Practices 100**, **Accessibility ~95+**.

**SEO (100/100):**
- **OG/Twitter images** — динамическая генерация Open Graph (1200x630) и Twitter Card изображений с брендингом TemptGuide (`opengraph-image.tsx`, `twitter-image.tsx`)
- **Twitter Cards** — полные мета-теги twitter:card, twitter:title, twitter:description, twitter:images на всех динамических страницах (model, video, category, country, account)
- **Sitemap** — расширен: модели (через getAccounts), аккаунты, 15 стран, /categories, пагинированные видео (до 500)
- **robots.txt** — блокирует /api/, /search, /admin
- **Structured Data (JSON-LD)** — VideoObject (с правильным uploadDate из published_at), Person, BreadcrumbList, WebSite с SearchAction
- **Heading hierarchy** — исправлены `<p>` на `<h1>` на страницах категорий, аккаунтов, homepage
- **Emoji-only titles** — fallback для видео без текстового заголовка: "Video by @username on Platform"
- **Canonical URLs** — на homepage и /categories
- **Image domains** — ограничены в next.config.mjs: media.temptguide.com, *.cdninstagram.com, *.fbcdn.net, pbs.twimg.com, abs.twimg.com

**Performance (76 -> ~95+):**
- **LCP fix:** `priority` prop на первой VideoCard в InfiniteVideoGrid (index 0) — eager-loading LCP-изображения, LCP с 5.9s до ~2.5s
- **Image formats:** AVIF/WebP включены в next.config.mjs — Next.js автоматически отдаёт оптимальный формат по Accept header
- **Responsive sizes:** VideoCard использует responsive `sizes` атрибут для оптимальной загрузки изображений

**Accessibility (79 -> ~95+):**
- **aria-labels:** добавлены на BottomNav links, share button, ProfileStories links
- **Color contrast:** txt-muted цвет изменён с #6b6b6b на #808080 (ratio 4.87:1, WCAG AA compliant)
- **Alt text:** убран redundant alt на аватарах (decorative images рядом с текстовым label)
- **Touch targets:** увеличены touch targets на category links

**Best Practices (96 -> 100):**
- **Favicon:** заменён пустой 0-byte favicon.ico на полноценный SVG icon (`web/src/app/icon.svg`)

## Потоки данных

### Добавление контента
```
Админ → Создаёт аккаунт → Нажимает "Parse"
→ Задача в очередь (parse_queue, status=pending)
→ Python Worker подхватывает → Парсит платформу (видео + image posts)
→ Для каждого видео/поста:
  → превью → S3
  → Frame extraction: 10 кадров из видео / изображения из carousel → R2
  → NeuroScore API: scores frames → selects best (is_selected=true)
  → Best frame → SM + LG thumbnails → S3
  → запись в PostgreSQL (videos + video_frames with score + is_selected)
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
- **accounts** — источники контента (Twitter/Instagram аккаунты). Удаление — hard DELETE с CASCADE (видео, баннеры, очереди)
- **videos** — все видео с метаданными
- **categories** — иерархические категории
- **video_categories** — связь видео↔категории (M2M, с confidence от AI)
- **site_categories / site_videos** — какие видео/категории на каком сайте
- **parse_queue** — очередь парсинга
- **video_frames** — извлечённые фреймы из видео и изображения из carousel/photo posts (для мульти-баннеров)
- **banner_sizes** — глобальные размеры баннеров (300x250 дефолтный, type: image/video)
- **banners** — сгенерированные баннеры (video + optional frame → image URL на R2, несколько вариантов на видео)
- **banner_queue** — очередь генерации баннеров
- **ad_sources** — рекламные сети (name, postback URL шаблон)
- **conversion_postbacks** — лог S2S постбеков (с CPA и event_id)
- **account_conversion_prices** — CPA цены по аккаунтам и типам событий
- **account_source_event_ids** — event_id по аккаунтам, рекламным сетям и типам событий

### ClickHouse — аналитика
- **events** — все события (impression, click, hover, view, banner_impression, banner_click) + 14 колонок метрик (browser, os, device_type, screen/viewport, language, connection, page_url, country, UTM)
- **banner_perf** — метрики производительности баннеров (image load, render, dwell time, viewability, hover duration). TTL 6 месяцев
- **mv_banner_daily** — materialized view: агрегация banner impressions/clicks по дням
- **mv_banner_perf_daily** — materialized view: агрегация performance метрик по дням (AggregatingMergeTree)
- **mv_events_device_daily** — materialized view: разбивка событий по device/browser/OS по дням
  - Партиционирование по месяцам, TTL 12 месяцев
  - Быстрые агрегации: countIf, avgState, quantileState, GROUP BY

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

## Banner Worker (Multi-Frame + MediaPipe Smart Crop)

### Как работает
Banner Worker генерирует рекламные баннеры для платных аккаунтов. Использует два источника изображений:
1. **Thumbnail** — стандартный баннер из thumbnail видео (как раньше)
2. **Extracted frames** — до 4 дополнительных фреймов из видео (или изображений из carousel/photo posts)

Для каждого источника применяется MediaPipe BlazeFace для face-aware кропа и Pillow ImageEnhance для улучшения цвета. Overlay (gradient, text, CTA) не запекается в изображение — рендерится исключительно в HTML-шаблонах на Go API. В итоге на одно видео может быть до 5 вариантов баннера. CTR-based selection при показе автоматически выбирает лучший вариант.

### Пайплайн (на каждый источник изображения)
```
image (thumbnail / frame) → скачать → MediaPipe face-aware smart crop → Pillow Lanczos resize → Pillow ImageEnhance (contrast 1.35, color 1.4, sharpness 1.5, brightness 1.05) → JPEG q=90 (clean photo) → R2
```

### Источники фреймов
- **Видео:** 4 кадра извлекаются ffmpeg на равных интервалах (configurable: `frame_extraction_count`)
- **Instagram photos:** изображение поста сохраняется как фрейм
- **Instagram carousels:** каждое изображение карусели — отдельный фрейм
- **Twitter image tweets:** изображение сохраняется как фрейм

### Разделение ответственности
- **OpenCV** — face-aware smart crop (Haar cascade: frontal face → profile face → upper body). Позиционирует кроп вокруг обнаруженных лиц. Fallback — center-crop с upper-third bias
- **Pillow** — resize (Lanczos) + color enhancement (ImageEnhance). Программные значения — стабильные и предсказуемые. Overlay НЕ применяется — изображения сохраняются как чистые фото
- **Go HTML templates** — весь визуальный overlay (gradient, text, CTA, borders, hover-эффекты) рендерится в HTML/CSS при показе баннера

### Стоимость
- Бесплатно (OpenCV — локальная библиотека, внешних API нет)

---

## Система агентов (Claude Code)

Проект использует команду Claude Code агентов для разработки и операций. Каждый агент — специалист со своей областью ответственности.

### Агенты

| Агент | Специализация |
|-------|---------------|
| project-manager | Координация, задачи ClickUp, документация |
| go-backend | Go API, базы данных, кеш, middleware |
| nextjs-frontend | React, admin panel, публичный сайт |
| python-parser | Парсинг, медиа-обработка, AI категоризация |
| devops | Docker, деплой, мониторинг |
| tester | Тесты и регрессии |
| **analytics** | BI-аналитика, SQL-запросы, бизнес-отчёты |

### Analytics Agent (BI-аналитик)

Специализированный агент для ответов на бизнес-вопросы. Работает напрямую с production базами данных через SSH (read-only).

**Что умеет:**
- Анализ трафика и конверсий (daily summary, CTR, воронки)
- Эффективность баннеров по источникам (impressions → hovers → clicks → conversions)
- Выручка по моделям (cross-database: ClickHouse events + PostgreSQL CPA prices)
- Разбивка по устройствам, браузерам, ОС, географии
- Анализ UTM-кампаний и реферреров
- Статус постбеков (S2S) по рекламным сетям
- Инвентарь контента (аккаунты, видео, баннеры)
- Производительность по категориям

**12 готовых SQL-шаблонов:**
1. Дневной трафик сайта (events, impressions, clicks, conversions, sessions, CTR)
2. Топ видео по CTR
3. Воронка баннеров по источникам
4. Воронка профиля аккаунта
5. Разбивка по устройствам (device, OS, browser)
6. География трафика
7. Анализ UTM-кампаний
8. Анализ реферреров
9. Выручка по аккаунтам (cross-DB)
10. Статус постбеков
11. Инвентарь контента
12. Производительность категорий (cross-DB)

**Как использовать:** вызвать агента `/analytics` и задать вопрос на естественном языке. Агент сам составит SQL-запросы, выполнит их, и представит результат в виде читаемой таблицы с выводами.

**Файл:** `.claude/agents/analytics.md`

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
