# Admin: управление сайтами (CRUD)

> ClickUp: https://app.clickup.com/t/869c7w7p3
> Страница: `/admin/sites`
> Статус: TODO

---

## Текущее состояние

### Что есть
- **API:** `GET /admin/sites` — возвращает список сайтов с category_count и video_count
- **Store:** `AdminStore.ListSites()` — SELECT с подзапросами для подсчёта категорий и видео
- **Next.js proxy route:** `web/src/app/api/v1/admin/sites/route.ts` — проксирует к Go API
- **Типы:** `AdminSite` в `admin-api.ts` (id, slug, domain, name, is_active, created_at, category_count, video_count)
- **DB таблица `sites`:** id, slug (UNIQUE), domain (UNIQUE), name, config (JSONB), is_active, created_at, updated_at
- **Связанные таблицы:**
  - `site_categories` (site_id, category_id, sort_order) — какие категории на сайте
  - `site_videos` (site_id, video_id, is_featured, added_at) — какие видео на сайте
- **Навигация:** В AdminShell sidebar НЕТ пункта "Sites" (нужно добавить)

### Чего нет
- Нет страницы `/admin/sites` на фронтенде
- Нет API эндпоинтов для Create / Update / Delete сайтов
- Нет управления привязкой категорий к сайту (site_categories)
- Нет управления привязкой видео к сайту (site_videos)
- Нет пункта в навигации админки

---

## Что нужно сделать

### 1. Go API — новые эндпоинты

#### `POST /api/v1/admin/sites` — Создание сайта

**Request body:**
```json
{
  "name": "Blondes Tube",
  "slug": "blondes-tube",
  "domain": "blondestube.com",
  "is_active": true,
  "config": {}
}
```

**Валидация:**
- `name` — обязательное, max 255 символов
- `slug` — обязательное, уникальное, lowercase `[a-z0-9-]`, max 64 символов. Автогенерация из name если не передан
- `domain` — опционально, если передан — уникальный, max 255 символов
- `config` — опционально, JSONB, default `{}`
- `is_active` — default true

**Response:** `201 Created` — полный объект сайта

**Ошибки:**
- `400` — невалидные данные или дубликат slug/domain
- `409` — конфликт (slug или domain уже существует)

#### `PUT /api/v1/admin/sites/{id}` — Обновление сайта

**Request body (все поля опциональны):**
```json
{
  "name": "Updated Name",
  "slug": "updated-slug",
  "domain": "new-domain.com",
  "is_active": false,
  "config": {"theme": "dark"}
}
```

**Валидация:**
- При смене slug/domain — проверка уникальности
- domain может быть `null`/пустым для сброса

**Response:** `200 OK` — обновлённый сайт

#### `DELETE /api/v1/admin/sites/{id}` — Удаление сайта

**Логика:**
- Soft delete: `UPDATE sites SET is_active = false WHERE id = $1`
- НЕ удалять связи site_categories и site_videos (сайт просто перестаёт работать)

**Response:** `200 OK` — `{"status": "ok"}`

#### `GET /api/v1/admin/sites/{id}` — Детали сайта

**Response:** Полная информация о сайте + список привязанных категорий
```json
{
  "id": 1,
  "slug": "blondes-tube",
  "domain": "blondestube.com",
  "name": "Blondes Tube",
  "config": {},
  "is_active": true,
  "created_at": "...",
  "category_count": 5,
  "video_count": 120,
  "categories": [
    {"id": 1, "slug": "blonde", "name": "Blonde", "sort_order": 0},
    {"id": 3, "slug": "amateur", "name": "Amateur", "sort_order": 1}
  ]
}
```

#### `PUT /api/v1/admin/sites/{id}/categories` — Управление категориями сайта

**Request body:**
```json
{
  "category_ids": [1, 3, 7, 12]
}
```

**Логика:**
- Полная замена: удалить все текущие site_categories для сайта, вставить новые
- sort_order = порядок в массиве (0, 1, 2, ...)

**Response:** `200 OK` — `{"status": "ok", "count": 4}`

### 2. Go Store — новые методы

Добавить в `admin_store.go`:

```go
type CreateSiteInput struct {
    Name     string          `json:"name"`
    Slug     string          `json:"slug"`
    Domain   *string         `json:"domain,omitempty"`
    Config   json.RawMessage `json:"config,omitempty"`
    IsActive *bool           `json:"is_active,omitempty"`
}

type UpdateSiteInput struct {
    Name     *string         `json:"name,omitempty"`
    Slug     *string         `json:"slug,omitempty"`
    Domain   *string         `json:"domain,omitempty"`
    Config   json.RawMessage `json:"config,omitempty"`
    IsActive *bool           `json:"is_active,omitempty"`
}

type AdminSiteDetail struct {
    AdminSite
    Categories []SiteCategoryItem `json:"categories"`
}

type SiteCategoryItem struct {
    ID        int64  `json:"id"`
    Slug      string `json:"slug"`
    Name      string `json:"name"`
    SortOrder int    `json:"sort_order"`
}

func (s *AdminStore) CreateSite(ctx, input) (*AdminSite, error)
func (s *AdminStore) GetSite(ctx, id) (*AdminSiteDetail, error)
func (s *AdminStore) UpdateSite(ctx, id, input) (*AdminSite, error)
func (s *AdminStore) DeleteSite(ctx, id) error
func (s *AdminStore) UpdateSiteCategories(ctx, siteID, categoryIDs) error
```

### 3. Router — регистрация эндпоинтов

В `router.go`, блок `// Sites`:
```go
r.Get("/sites", adminHandler.ListSites)
r.Post("/sites", adminHandler.CreateSite)
r.Get("/sites/{id}", adminHandler.GetSite)
r.Put("/sites/{id}", adminHandler.UpdateSite)
r.Delete("/sites/{id}", adminHandler.DeleteSite)
r.Put("/sites/{id}/categories", adminHandler.UpdateSiteCategories)
```

### 4. Frontend API client — `admin-api.ts`

```typescript
export interface AdminSiteDetail extends AdminSite {
  categories: SiteCategoryItem[];
  config: Record<string, unknown>;
}

export interface SiteCategoryItem {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
}

export async function createAdminSite(data: {
  name: string;
  slug?: string;
  domain?: string;
  is_active?: boolean;
  config?: Record<string, unknown>;
}): Promise<AdminSite> { ... }

export async function getAdminSite(id: number): Promise<AdminSiteDetail> { ... }

export async function updateAdminSite(
  id: number,
  data: {
    name?: string;
    slug?: string;
    domain?: string;
    is_active?: boolean;
    config?: Record<string, unknown>;
  }
): Promise<AdminSite> { ... }

export async function deleteAdminSite(id: number): Promise<void> { ... }

export async function updateSiteCategories(
  siteId: number,
  categoryIds: number[]
): Promise<void> { ... }
```

### 5. Навигация — добавить пункт "Sites"

В `web/src/app/admin/AdminShell.tsx` добавить пункт меню:
```
Sites  (иконка Globe)  →  /admin/sites
```
Расположить после Categories в sidebar.

### 6. Frontend — страница `/admin/sites`

#### Список сайтов (таблица)

Колонки:
| Колонка | Описание |
|---------|----------|
| Name | Название сайта |
| Slug | URL-идентификатор (mono font) |
| Domain | Домен (если есть) или "—" |
| Categories | Количество привязанных категорий |
| Videos | Количество видео на сайте |
| Status | Active / Inactive badge |
| Actions | Edit, Delete |

Header: заголовок "Sites" + кнопка "Add Site"

#### Модалка создания/редактирования сайта

Поля формы:
| Поле | Тип | Описание |
|------|-----|----------|
| Name | text input | Обязательное. Placeholder: "Site name" |
| Slug | text input | Авто-генерация из name. Placeholder: "site-slug" |
| Domain | text input | Опционально. Placeholder: "example.com" |
| Active | toggle | Default: true |

**Поведение:**
- При вводе Name — автоматически генерировать slug
- Submit → API call → закрыть модалку → обновить таблицу → toast

#### Управление категориями сайта

При клике на строку сайта (или кнопку "Manage Categories"):
- Открывается второй вид / модалка / expand panel
- Показывает **все категории** системы в виде checkbox-списка
- Категории, привязанные к сайту, отмечены галочкой
- Drag-and-drop для изменения sort_order (или number input)
- Кнопка "Save" → `PUT /admin/sites/{id}/categories` → toast

Альтернативный вариант (проще): multi-select dropdown в модалке редактирования.

#### Действия в строке таблицы
- **Edit** — модалка редактирования
- **Categories** — управление категориями (expand/modal)
- **Toggle Active** — быстрое переключение is_active
- **Delete** — confirmation → soft-delete

### 7. Стилистика

Тот же паттерн что в `/admin/accounts` и `/admin/categories`:
- Тёмная тема
- Модалки с overlay
- Toast-уведомления
- Hover-эффекты

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | + CreateSite, GetSite, UpdateSite, DeleteSite, UpdateSiteCategories |
| `api/internal/handler/admin.go` | + CreateSite, GetSite, UpdateSite, DeleteSite, UpdateSiteCategories handlers |
| `api/internal/handler/router.go` | + 5 новых маршрутов в блоке Sites |
| `web/src/lib/admin-api.ts` | + createAdminSite, getAdminSite, updateAdminSite, deleteAdminSite, updateSiteCategories, SiteCategoryItem, AdminSiteDetail |
| `web/src/app/admin/AdminShell.tsx` | + пункт "Sites" в навигации |
| `web/src/app/admin/sites/page.tsx` | **Новый файл:** таблица сайтов + модалки CRUD + управление категориями |

---

## Приёмочные критерии

- [ ] Пункт "Sites" виден в sidebar навигации админки
- [ ] Таблица отображает все сайты с domain, category_count, video_count
- [ ] Можно создать сайт через форму — он появляется в таблице
- [ ] Slug автоматически генерируется из name
- [ ] Нельзя создать сайт с дублирующим slug или domain (ошибка)
- [ ] Можно редактировать name, slug, domain, is_active
- [ ] Можно привязать/отвязать категории к сайту
- [ ] Sort order категорий на сайте сохраняется
- [ ] Soft delete деактивирует сайт (остаётся в таблице как Inactive)
- [ ] Toast-уведомления работают
- [ ] Site detection middleware продолжает работать (не ломаем публичный API)
