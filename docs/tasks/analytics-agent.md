# Analytics Agent (BI-аналитик)

> Статус: **Готово** (2026-03-14)

## Что сделано

Создан специализированный Claude Code агент для бизнес-аналитики. Агент знает полную схему ClickHouse и PostgreSQL, имеет 12 готовых SQL-шаблонов, и может отвечать на бизнес-вопросы о выручке, воронках, трафике, конверсиях, устройствах, географии и т.д.

## Изменённые файлы

| Файл | Действие | Описание |
|------|----------|----------|
| `.claude/agents/analytics.md` | Создан | Полная спецификация агента: схема БД, 12 SQL-шаблонов, guidelines |
| `.claude/agents/project-manager.md` | Изменён | Добавлен `analytics` в список делегирования |

## Функциональность агента

### Доступ к данным
- **ClickHouse** — через SSH + `docker exec traforama-clickhouse clickhouse-client`
- **PostgreSQL** — через SSH + `docker exec traforama-postgres psql`
- Только read-only (SELECT). Без MCP серверов — прямой SSH доступ

### Документированная схема
- ClickHouse: `events` (26 колонок), `mv_banner_daily`, `mv_banner_conversions`, `banner_perf`
- PostgreSQL: `accounts`, `videos`, `banners`, `banner_sizes`, `video_frames`, `categories`, `video_categories`, `sites`, `site_videos`, `ad_sources`, `conversion_postbacks`, `account_conversion_prices`, `account_source_event_ids`

### 12 SQL-шаблонов
1. Site Traffic Summary (daily)
2. Top Videos by CTR
3. Banner Funnel by Source
4. Account Profile Funnel
5. Device Breakdown
6. Geographic Distribution
7. UTM Campaign Analysis
8. Referrer Analysis
9. Revenue by Account (cross-DB)
10. Postback Status Report
11. Content Inventory
12. Category Performance (cross-DB)

### Cross-Database запросы
Некоторые вопросы требуют данных из обеих БД (например, выручка = конверсии из ClickHouse + CPA цены из PostgreSQL). Агент выполняет запросы последовательно и объединяет результаты в анализе.

## Использование

Вызвать агента: `/analytics` + бизнес-вопрос на естественном языке.

Примеры:
- "Какой CTR по источникам за последние 30 дней?"
- "Топ-10 моделей по конверсиям"
- "Выручка по аккаунтам за месяц"
- "Разбивка трафика по устройствам"

## Возможные улучшения

- Добавить MCP-серверы для прямого SQL-доступа (без SSH)
- Расширить шаблоны: retention, cohort analysis, LTV
- Автоматические дашборды (периодические отчёты)
- Алерты при аномалиях (резкое падение CTR, рост ошибок постбеков)
