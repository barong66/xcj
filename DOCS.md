# xxxaccounter — Документация

> Последнее обновление: 2026-03-08 (Per-account conversion prices / CPA for postbacks)
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
- Генерирует превью-картинку (тумбу) и 5-секундный превью-клип (для видео)
- Извлекает 4 кадра из видео на равных интервалах (для баннеров)
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

Страница `/model/[slug]` — профиль конкретного аккаунта:
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
- **Multi-frame:** из каждого видео создаётся до 5 вариантов баннера (1 из thumbnail + 4 из извлечённых фреймов). CTR-based selection автоматически выбирает лучший вариант
- **Image posts:** Instagram фото-посты, carousel-изображения и Twitter image tweets используются как дополнительные источники для баннеров
- Готовые баннеры доступны по URL `/b/{id}` (302 redirect на CDN), клик по баннеру `/b/{id}/click` ведёт на профиль модели
- Аналитика: banner_impression (показ) и banner_click (клик) в ClickHouse; Imprs/Clicks/CTR отображаются в админке

**Качество баннеров:**
- **OpenCV face-aware smart crop** — Haar cascade (frontal face → profile face → upper body) определяет лица и позиционирует кроп вокруг них. Fallback — center-crop с upper-third bias
- **Pillow ImageEnhance** — программное улучшение цвета после resize: contrast +35%, color saturation +40%, sharpness +50%, brightness +5%
- **Text overlay** — градиент внизу + @username + "Watch Now →" делает баннер кликабельным и узнаваемым
- Полный пайплайн: OpenCV smart crop → Pillow Lanczos resize → Pillow enhance → overlay → JPEG q=90

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
- Все шаблоны: CSS filters (contrast, saturate, brightness) для ярких, контрастных изображений; на hover ещё ярче. Минимальные градиенты (только снизу для читаемости)
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
```

Атрибуты:
- `data-size` — размер баннера (напр. `300x250`), по умолчанию `300x250`
- `data-style` — стиль баннера: `bold`, `elegant`, `minimalist`, `card` (по умолчанию: случайный)
- `data-src` — источник трафика (slug рекламной сети)
- `data-click-id` — ID клика рекламной сети для S2S постбеков

Скрипт кешируется 24 часа, работает на любом домене (CORS enabled).

**Деактивация баннеров:**
- На вкладке Promo каждого аккаунта — кнопка-корзинка на каждой карточке баннера
- Клик → диалог подтверждения → баннер деактивируется (is_active=false)
- **Массовые действия:** чекбоксы на каждой карточке + Select All toggle. Выбранные баннеры можно массово деактивировать или перегенерировать (batch deactivate / batch regenerate)
- Деактивированный баннер не участвует в ротации (/b/serve) и не показывается внешним сайтам
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
3. В шаблоне доступны плейсхолдеры: `{click_id}` (ID клика от сети), `{event}` (тип конверсии: social_click / content_click), `{cpa}` (CPA цена для данной модели и типа события)

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

Пример постбек-URL с CPA:
```
https://adnetwork.com/postback?click_id={click_id}&event={event}&payout={cpa}
```

При конверсии система автоматически определит, к какому аккаунту относится событие, найдёт CPA-цену для данного типа события и подставит её в URL. CPA-цена также сохраняется в записи постбека (`cpa_amount`) для аудита и корректного retry при повторных попытках.

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

Веб-панель для управления платформой:
- **Dashboard** -- общая статистика (видео, аккаунты, очередь парсинга)
- **Accounts** -- добавлять/удалять источники контента, запускать парсинг, фильтр по оплате (paid/free), включение/отключение промоушена. Страница аккаунта: табы Stats (по умолчанию), Fan Site Links, Promo. Promo tab: все баннеры без пагинации, mass selection с Select All, batch deactivate/regenerate, style preview (Static JPEG / Bold / Elegant / Minimalist / Card), re-grab, re-crop (ручной кроп через визуальный редактор), **Conversion Prices** — per-event-type CPA цены для S2S постбеков (`{cpa}` плейсхолдер). Удаление аккаунта -- **необратимое** (hard DELETE, каскадно удаляет все видео, баннеры, записи очередей)
- **Videos** -- просматривать, удалять, пере-категоризировать видео
- **Stats** — аналитика сайта с двумя вкладками: **Traffic Explorer** (по умолчанию) и **Video Stats** (тумбы с показами, кликами, CTR)
- **Queue** — статус очереди парсинга (pending/running/done/failed)
- **Promo** — все баннеры по всем paid-аккаунтам, управление размерами баннеров, embed-код для внешних сайтов. Четыре вкладки: Баннеры (список с hovers + source breakdown + embed-код через loader.js `<script>` тег с выбором стиля), Настройки (conversion tracker + ad sources), Статистика (воронка по источникам), Performance (overview cards, device breakdown, top referrers)
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
- Админские эндпоинты: управление аккаунтами (включая stats funnel per account), видео, очередью, статистика
- Middleware: определение сайта по домену, rate limiting, CORS, логирование
- Буфер аналитических событий → batch insert в ClickHouse
- Динамический сервинг баннеров (`/b/serve`) с Redis-кешем пулов и ротацией
- Embed-скрипт для контекстного таргетинга (`/b/loader.js`) -- извлекает ключевые слова со страницы издателя
- S3/R2 client (`api/internal/s3/client.go`) -- загрузка файлов из Go API (используется для re-crop баннеров)

### Python Parser
- Парсит Twitter (через yt-dlp) и Instagram (через API)
- Поддерживает видео и изображения: Instagram photo posts, carousels, Twitter image tweets (media_type: video/image)
- Генерирует тумбы (ffmpeg resize) и превью-клипы (5 сек)
- **Frame extraction:** извлекает 4 кадра из видео (ffmpeg) + сохраняет carousel/photo изображения → `video_frames`
- Загружает в S3
- AI категоризация через OpenAI GPT-4o Vision API (пачками по 50 видео)
- Работает как фоновый воркер, опрашивая очередь в PostgreSQL
- **Worker loop** запускает 3 корутины через `asyncio.gather`: parse_worker, banner_worker, categorizer_worker
- **Banner Worker** — генерирует баннеры из тумб + извлечённых фреймов для платных аккаунтов: до 5 вариантов на видео (1 thumbnail + 4 frames). OpenCV face-aware smart crop → Lanczos resize → Pillow ImageEnhance → gradient/text overlay → JPEG → R2. CTR-based selection выбирает лучший вариант
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
  → тумба + превью → S3
  → Frame extraction: 4 кадра из видео / изображения из carousel → video_frames → S3
  → запись в PostgreSQL (videos + video_frames)
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

## Banner Worker (Multi-Frame + OpenCV Smart Crop)

### Как работает
Banner Worker генерирует рекламные баннеры для платных аккаунтов. Использует два источника изображений:
1. **Thumbnail** — стандартный баннер из thumbnail видео (как раньше)
2. **Extracted frames** — до 4 дополнительных фреймов из видео (или изображений из carousel/photo posts)

Для каждого источника применяется OpenCV Haar cascade для face-aware кропа и Pillow ImageEnhance для улучшения цвета. В итоге на одно видео может быть до 5 вариантов баннера. CTR-based selection при показе автоматически выбирает лучший вариант.

### Пайплайн (на каждый источник изображения)
```
image (thumbnail / frame) → скачать → OpenCV face-aware smart crop → Pillow Lanczos resize → Pillow ImageEnhance (contrast 1.35, color 1.4, sharpness 1.5, brightness 1.05) → overlay (@username + "Watch Now →") → JPEG q=90 → R2
```

### Источники фреймов
- **Видео:** 4 кадра извлекаются ffmpeg на равных интервалах (configurable: `frame_extraction_count`)
- **Instagram photos:** изображение поста сохраняется как фрейм
- **Instagram carousels:** каждое изображение карусели — отдельный фрейм
- **Twitter image tweets:** изображение сохраняется как фрейм

### Разделение ответственности
- **OpenCV** — face-aware smart crop (Haar cascade: frontal face → profile face → upper body). Позиционирует кроп вокруг обнаруженных лиц. Fallback — center-crop с upper-third bias
- **Pillow** — resize (Lanczos) + color enhancement (ImageEnhance). Программные значения — стабильные и предсказуемые

### Стоимость
- Бесплатно (OpenCV — локальная библиотека, внешних API нет)

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
