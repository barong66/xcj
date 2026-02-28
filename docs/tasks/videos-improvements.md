# Admin: улучшения страницы управления видео

> Страница: `/admin/videos`
> Статус: TODO

---

## Текущее состояние

### Что есть

**Frontend** (`web/src/app/admin/videos/page.tsx`):
- Адаптивная сетка видео-карточек (2–5 колонок, responsive), `items-start` — карточки выравниваются по верху
- Aspect ratio карточек определяется по реальной ориентации видео (`width`/`height` из API):
  - Portrait (`height > width`) → `aspect-[9/16]`
  - Landscape → `aspect-video` (16:9)
- Карточка видео отображает:
  - Thumbnail в нативном соотношении сторон, `object-cover` (thumbnail уже нарезан парсером в правильном размере)
  - Badge длительности (MM:SS, правый нижний угол)
  - Badge платформы (Twitter — синий, Instagram — розовый, левый верхний угол)
  - Заголовок (line-clamp-2)
  - Username (`@username`)
  - Категории (до 3 шт.) или жёлтый badge "uncategorized"
  - Статистика: views, clicks, дата создания
- Действия на карточке:
  - **Recategorize** — сброс `ai_processed_at`, видео попадает в очередь AI-категоризации
  - **Delete** — soft delete (`is_active = false`), с confirmation dialog
  - **Open original** — ссылка на оригинальное видео (внешний URL)
- Фильтры:
  - **Category** — select dropdown, все категории с video_count
  - **Uncategorized only** — checkbox
- Пагинация: Previous/Next + "Page X of Y"

**API эндпоинты:**
| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | `/api/v1/admin/videos` | Список видео с пагинацией и фильтрами |
| DELETE | `/api/v1/admin/videos/{id}` | Soft delete видео |
| POST | `/api/v1/admin/videos/recategorize` | Рекатегоризация (по ID или all) |
| GET | `/api/v1/admin/videos/stats` | Аналитика из ClickHouse (отдельная страница /admin/stats) |

**Query параметры GET `/admin/videos`:**
| Параметр | Тип | Описание |
|----------|-----|----------|
| `category` | string | Slug категории для фильтрации |
| `uncategorized` | bool | `true` — только без AI-категоризации |
| `page` | int | Номер страницы (default: 1) |
| `per_page` | int | Видео на страницу (default: 20, max: 100) |

**Go Store** (`api/internal/store/admin_store.go`):
- `AdminStore.ListVideos()` — пагинированный список с JOIN на categories и accounts
- `AdminStore.DeleteVideo()` — soft delete (`is_active = false`)
- `AdminStore.RecategorizeVideos()` — сброс `ai_processed_at = NULL` по списку ID или для всех

**Модель данных AdminVideo:**
```go
type AdminVideo struct {
    ID           int64
    AccountID    int64
    Platform     string      // "twitter" | "instagram"
    PlatformID   string
    OriginalURL  string
    Title        string
    Description  string
    DurationSec  int
    ThumbnailURL string
    PreviewURL   string
    Width        int
    Height       int
    ViewCount    int64
    ClickCount   int64
    IsActive     bool
    PublishedAt  *time.Time
    CreatedAt    time.Time
    Username     string
    Categories   []AdminVideoCategory
}
```

### Чего нет

1. **Поиск** — нет текстового поиска по title/description
2. **Фильтр по платформе** — нельзя выбрать только Twitter или только Instagram
3. **Сортировка** — всегда `created_at DESC`, нет выбора (views, clicks, duration)
4. **Bulk actions** — нельзя выделить несколько видео для массового удаления/рекатегоризации
5. **Preview video** — нет hover-preview (preview_url не используется)
6. **Фильтр по аккаунту** — нельзя посмотреть видео конкретного аккаунта
7. **Детальный просмотр** — нет модалки/страницы с полной информацией о видео
8. **Редактирование** — нельзя менять title, description, категории вручную
9. **Ручная привязка категорий** — категории назначаются только через AI
10. **Per-page selector** — нет выбора количества видео на страницу (жёстко 20)

---

## Задачи на улучшение

### 1. Поиск видео по тексту

**Описание:** Добавить текстовый поиск по title и description видео.

**Backend:**
- Новый query-параметр `search` в `GET /admin/videos`
- SQL: `WHERE (v.title ILIKE '%' || $N || '%' OR v.description ILIKE '%' || $N || '%')`
- Поиск совмещается с существующими фильтрами (category, uncategorized)

**Frontend:**
- Input поле поиска с debounce (300ms) над сеткой видео
- При вводе — сброс на page=1, вызов API с параметром `search`
- Иконка лупы + кнопка очистки (X)

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | Добавить параметр `search` в `ListVideos()` |
| `api/internal/handler/admin.go` | Прокинуть `search` из query params |
| `web/src/lib/admin-api.ts` | Добавить `search` в параметры `getAdminVideos()` |
| `web/src/app/admin/videos/page.tsx` | Добавить input поиска + state + debounce |

---

### 2. Фильтр по платформе

**Описание:** Добавить возможность фильтровать видео по платформе (Twitter/Instagram/All).

**Backend:**
- Новый query-параметр `platform` в `GET /admin/videos`
- SQL: `AND v.platform = $N`

**Frontend:**
- Select dropdown или toggle-кнопки (All / Twitter / Instagram) рядом с фильтром категорий
- При смене — сброс page=1

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | Добавить `platform` filter в `ListVideos()` |
| `api/internal/handler/admin.go` | Прокинуть `platform` |
| `web/src/lib/admin-api.ts` | Добавить `platform` в `getAdminVideos()` |
| `web/src/app/admin/videos/page.tsx` | Добавить platform selector |

---

### 3. Сортировка видео

**Описание:** Позволить менять порядок видео: по дате, просмотрам, кликам, длительности.

**Backend:**
- Новые query-параметры `sort` и `dir` в `GET /admin/videos`
- Допустимые значения sort: `created_at` (default), `views`, `clicks`, `duration`
- dir: `asc` / `desc` (default: `desc`)

**Frontend:**
- Dropdown или кнопки сортировки рядом с фильтрами
- Индикатор текущей сортировки (стрелка вверх/вниз)

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | Добавить sort/dir в `ListVideos()` |
| `api/internal/handler/admin.go` | Прокинуть `sort`, `dir` |
| `web/src/lib/admin-api.ts` | Добавить `sort`, `dir` в `getAdminVideos()` |
| `web/src/app/admin/videos/page.tsx` | Добавить sort controls |

---

### 4. Bulk actions (массовые действия)

**Описание:** Возможность выделить несколько видео для массового удаления или рекатегоризации.

**Backend:**
- `POST /api/v1/admin/videos/bulk-delete` — массовое soft-delete
  - Request: `{ "video_ids": [1, 2, 3] }`
  - Response: `{ "deleted": 3 }`
- `POST /api/v1/admin/videos/recategorize` — уже поддерживает массив `video_ids`

**Frontend:**
- Checkbox на каждой карточке (появляется при hover или через кнопку "Select Mode")
- Toolbar при выделении: "N selected" + кнопки "Delete Selected", "Recategorize Selected"
- "Select All" / "Deselect All"

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | + `BulkDeleteVideos()` |
| `api/internal/handler/admin.go` | + `BulkDeleteVideos` handler |
| `api/internal/handler/router.go` | + маршрут `POST /videos/bulk-delete` |
| `web/src/lib/admin-api.ts` | + `bulkDeleteVideos()` |
| `web/src/app/admin/videos/page.tsx` | + selection state, checkboxes, toolbar |

---

### 5. Video preview на hover

**Описание:** При наведении на thumbnail — воспроизводить 5-секундный preview (preview_url уже есть в данных).

**Frontend:**
- При hover на thumbnail > 500ms — заменять `<img>` на `<video>` с `preview_url`
- Autoplay, muted, loop
- При уходе курсора — вернуть thumbnail
- Не загружать preview для видео без `preview_url`

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `web/src/app/admin/videos/page.tsx` | Добавить hover state + `<video>` элемент в карточке |

---

### 6. Фильтр по аккаунту

**Описание:** Фильтровать видео по конкретному аккаунту (username).

**Backend:**
- Новый query-параметр `account_id` в `GET /admin/videos`
- SQL: `AND v.account_id = $N`

**Frontend:**
- Combobox / autocomplete с поиском по username
- Или параметр в URL при переходе со страницы аккаунтов ("View videos" → `/admin/videos?account_id=5`)

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | Добавить `account_id` filter в `ListVideos()` |
| `api/internal/handler/admin.go` | Прокинуть `account_id` |
| `web/src/lib/admin-api.ts` | Добавить `account_id` в `getAdminVideos()` |
| `web/src/app/admin/videos/page.tsx` | Добавить account filter UI |

---

### 7. Модалка детального просмотра видео

**Описание:** При клике на карточку — открывать модалку с полной информацией.

**Frontend:**
Модалка отображает:
| Поле | Описание |
|------|----------|
| Thumbnail / Preview | Большое изображение, клик → воспроизведение preview |
| Title | Полный заголовок |
| Description | Полное описание |
| Platform | Twitter / Instagram badge |
| Username | Ссылка на аккаунт в админке |
| Original URL | Ссылка на оригинал |
| Duration | Длительность |
| Resolution | Width x Height |
| Views / Clicks | Статистика |
| Categories | Все категории с confidence score |
| Published At | Дата публикации на платформе |
| Created At | Дата добавления в систему |

Действия в модалке:
- Recategorize
- Delete
- Open Original (external link)

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `web/src/app/admin/videos/page.tsx` | + компонент VideoDetailModal, обработчик клика |

---

### 8. Ручное редактирование категорий видео

**Описание:** Позволить администратору вручную назначать/убирать категории видео.

**Backend:**
- `PUT /api/v1/admin/videos/{id}/categories` — обновление категорий
  - Request: `{ "category_ids": [1, 5, 12] }`
  - Логика: полная замена записей в `video_categories` для данного видео
  - При ручном назначении: `confidence = 1.0`, устанавливать `ai_processed_at = NOW()`

**Frontend:**
- В модалке детального просмотра (задача 7): секция Categories с multi-select
- Dropdown со всеми категориями системы (чекбоксы)
- Кнопка Save → API call → toast

**Файлы:**
| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | + `UpdateVideoCategories()` |
| `api/internal/handler/admin.go` | + `UpdateVideoCategories` handler |
| `api/internal/handler/router.go` | + маршрут `PUT /videos/{id}/categories` |
| `web/src/lib/admin-api.ts` | + `updateVideoCategories()` |
| `web/src/app/admin/videos/page.tsx` | + категории editor в модалке |

---

## Приоритизация

| # | Задача | Приоритет | Сложность | Ценность |
|---|--------|-----------|-----------|----------|
| 1 | Поиск по тексту | High | Low | Быстрый поиск конкретного видео |
| 2 | Фильтр по платформе | High | Low | Базовый фильтр, лёгкая реализация |
| 3 | Сортировка | Medium | Low | Удобство навигации |
| 4 | Bulk actions | Medium | Medium | Массовые операции экономят время |
| 5 | Video preview | Low | Low | Nice-to-have, UX улучшение |
| 6 | Фильтр по аккаунту | Medium | Low | Удобно для анализа контента конкретного аккаунта |
| 7 | Детальный просмотр | Medium | Medium | Полная информация о видео |
| 8 | Ручное редактирование категорий | High | Medium | Коррекция ошибок AI |

---

## Текущие ограничения и технический долг

1. **Нет текстового поиска по ILIKE** — admin store использует только category slug и uncategorized флаг
2. **preview_url не используется** — данные есть в API response, но фронт их не рендерит
3. **Нет валидации per_page** — фронт жёстко 20, нет UI для изменения
4. **Description не отображается** — есть в API, но карточка его не показывает
5. **Confidence score скрыт** — категории показываются без confidence

## Выполнено

| Дата | Изменение |
|------|-----------|
| 2026-02-25 | Portrait mode: карточки теперь используют `aspect-[9/16]` для портретных видео и `aspect-video` для ландшафтных, ориентация определяется по `width`/`height` из API. Грид: 2–5 колонок с `items-start`. |
