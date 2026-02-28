# Admin: CRUD категорий (create/edit/delete)

> ClickUp: https://app.clickup.com/t/869c7w7mu
> Страница: `/admin/categories`
> Статус: TODO

---

## Текущее состояние

### Что есть
- **Frontend:** Read-only таблица категорий (`web/src/app/admin/categories/page.tsx`) — отображает name, slug, video_count, is_active, sort_order
- **API:** `GET /admin/categories` — возвращает список всех категорий с количеством видео
- **Store:** `AdminStore.ListCategories()` — SELECT с LEFT JOIN video_categories для подсчёта видео
- **DB таблица `categories`:** id, slug (UNIQUE), name, parent_id (FK self), is_active, sort_order, created_at

### Чего нет
- Нет API эндпоинтов для Create / Update / Delete
- Нет формы создания категории на фронте
- Нет inline-редактирования или модалки для обновления
- Нет кнопки удаления
- Нет отображения иерархии (parent_id не используется в UI)

---

## Что нужно сделать

### 1. Go API — новые эндпоинты

#### `POST /api/v1/admin/categories` — Создание категории

**Request body:**
```json
{
  "name": "Blonde",
  "slug": "blonde",
  "parent_id": null,
  "is_active": true,
  "sort_order": 0
}
```

**Валидация:**
- `name` — обязательное, непустое, max 255 символов
- `slug` — обязательное, уникальное, lowercase, только `[a-z0-9-]`, max 128 символов. Если не передан — автогенерация из name (slugify: lowercase, пробелы→дефисы, убрать спецсимволы)
- `parent_id` — опционально, если передан — проверить что такая категория существует
- `sort_order` — по умолчанию 0

**Response:** `201 Created` — возвращает созданную категорию (полный объект как в ListCategories)

**Ошибки:**
- `400` — невалидные данные или дубликат slug
- `404` — parent_id не найден

#### `PUT /api/v1/admin/categories/{id}` — Обновление категории

**Request body (все поля опциональны):**
```json
{
  "name": "Updated Name",
  "slug": "updated-slug",
  "parent_id": 5,
  "is_active": false,
  "sort_order": 10
}
```

**Валидация:**
- Те же правила что и при создании
- `parent_id` не может быть равен собственному `id` (нельзя быть своим родителем)
- При смене slug — проверка уникальности
- Нельзя установить parent_id на своего потомка (циклическая иерархия)

**Response:** `200 OK` — обновлённая категория

**Ошибки:**
- `400` — невалидные данные
- `404` — категория не найдена

#### `DELETE /api/v1/admin/categories/{id}` — Удаление категории

**Логика:**
- Soft delete: `UPDATE categories SET is_active = false WHERE id = $1`
- Если есть дочерние категории (parent_id = id) — отвязать их (SET parent_id = NULL) или вернуть ошибку
- Связи в `video_categories` и `site_categories` НЕ удаляются (категория просто перестаёт показываться)

**Response:** `200 OK` — `{"status": "ok"}`

**Ошибки:**
- `404` — категория не найдена

### 2. Go Store — новые методы

Добавить в `admin_store.go`:

```go
type CreateCategoryInput struct {
    Name      string `json:"name"`
    Slug      string `json:"slug"`
    ParentID  *int64 `json:"parent_id,omitempty"`
    IsActive  *bool  `json:"is_active,omitempty"`
    SortOrder *int   `json:"sort_order,omitempty"`
}

type UpdateCategoryInput struct {
    Name      *string `json:"name,omitempty"`
    Slug      *string `json:"slug,omitempty"`
    ParentID  *int64  `json:"parent_id,omitempty"`  // -1 для сброса
    IsActive  *bool   `json:"is_active,omitempty"`
    SortOrder *int    `json:"sort_order,omitempty"`
}

func (s *AdminStore) CreateCategory(ctx, input) (*AdminCategory, error)
func (s *AdminStore) UpdateCategory(ctx, id, input) (*AdminCategory, error)
func (s *AdminStore) DeleteCategory(ctx, id) error
```

### 3. Router — регистрация эндпоинтов

В `router.go`, блок `// Categories`:
```go
r.Get("/categories", adminHandler.ListCategories)
r.Post("/categories", adminHandler.CreateCategory)
r.Put("/categories/{id}", adminHandler.UpdateCategory)
r.Delete("/categories/{id}", adminHandler.DeleteCategory)
```

### 4. Frontend API client — `admin-api.ts`

```typescript
export async function createAdminCategory(data: {
  name: string;
  slug?: string;
  parent_id?: number | null;
  is_active?: boolean;
  sort_order?: number;
}): Promise<AdminCategory> { ... }

export async function updateAdminCategory(
  id: number,
  data: {
    name?: string;
    slug?: string;
    parent_id?: number | null;
    is_active?: boolean;
    sort_order?: number;
  }
): Promise<AdminCategory> { ... }

export async function deleteAdminCategory(id: number): Promise<void> { ... }
```

### 5. Frontend — обновление страницы `/admin/categories`

#### Кнопка "Add Category" (header)
- Открывает модалку создания категории

#### Модалка создания/редактирования
Поля формы:
| Поле | Тип | Описание |
|------|-----|----------|
| Name | text input | Обязательное. Placeholder: "Category name" |
| Slug | text input | Авто-генерация из name (editable). Placeholder: "category-slug" |
| Parent | select/dropdown | Список существующих категорий + "None". Не показывать саму себя при редактировании |
| Sort Order | number input | Default: 0 |
| Active | toggle/checkbox | Default: true |

**Поведение:**
- При вводе Name — автоматически генерировать slug (если пользователь не менял slug вручную)
- При редактировании — заполнять все поля текущими значениями
- Submit → вызов API → закрытие модалки → обновление таблицы → toast "Category created/updated"

#### Действия в строке таблицы
Каждая строка получает колонку Actions:
- **Edit** (иконка карандаша) — открывает модалку редактирования
- **Toggle Active** — быстрое переключение is_active через API
- **Delete** — confirmation dialog → soft-delete через API → toast → убрать из таблицы

#### Отображение иерархии
- Категории с `parent_id` показываются с отступом (indentation) в таблице
- Или с указанием "Parent: <parent_name>" в дополнительной колонке

### 6. Стилистика

Использовать тот же дизайн-паттерн что в `/admin/accounts`:
- Тёмная тема (`bg-[#141414]`, `border-[#1e1e1e]`, `text-white`)
- Модалка с overlay
- Toast-уведомления при успехе/ошибке
- Hover-эффекты на строках таблицы

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `api/internal/store/admin_store.go` | + CreateCategory, UpdateCategory, DeleteCategory |
| `api/internal/handler/admin.go` | + CreateCategory, UpdateCategory, DeleteCategory handlers |
| `api/internal/handler/router.go` | + 3 новых маршрута в блоке Categories |
| `web/src/lib/admin-api.ts` | + createAdminCategory, updateAdminCategory, deleteAdminCategory |
| `web/src/app/admin/categories/page.tsx` | Полная переработка: + кнопка Add, + модалка, + Actions column |

---

## Приёмочные критерии

- [ ] Можно создать категорию через форму — она появляется в таблице
- [ ] Можно отредактировать name, slug, parent, sort_order, is_active
- [ ] Slug автоматически генерируется из name при создании
- [ ] Нельзя создать категорию с дублирующим slug (показывается ошибка)
- [ ] Можно деактивировать категорию (soft delete)
- [ ] Иерархия отображается (parent_id)
- [ ] Toast-уведомления работают
- [ ] Деактивированная категория не пропадает из admin-списка, но видна как "Inactive"
