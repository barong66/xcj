# xcj Project Rules

## Workflow: всегда тестировать новый код

После написания или изменения функционала — **обязательно**:
1. Написать тесты для нового/изменённого кода
2. Прогнать все существующие тесты и убедиться что ничего не сломалось
3. Не коммитить если тесты падают

### Команды для тестов
- **Python parser:** `python3 -m pytest parser/tests/ -v`
- **Go API:** `cd api && go test ./...`
- **Next.js:** `cd web && npm test` (когда будет настроен)

### Где лежат тесты
- `parser/tests/` — Python тесты (pytest)
- `api/**/*_test.go` — Go тесты (рядом с исходниками)
- `web/**/*.test.ts` — TypeScript тесты (рядом с компонентами)

## Workflow: ClickUp

После завершения задачи — обновить ClickUp:
- Отметить задачу как done
- Добавить комментарий с описанием что сделано и какие файлы изменены
- Если обнаружены новые баги/TODO — создать задачу

ClickUp space: XXCJ (ID: 90126473643)

## Deploy

```bash
ssh traforama@37.27.189.122 "cd /opt/traforama/xcj && git pull origin main && docker compose -f deploy/docker/docker-compose.yml --env-file .env up -d --build"
```

## Важно

- Контейнеры называются `traforama-*` (не `xcj-*`)
- Docker Compose требует `--env-file .env`
- SSH пользователь: `traforama` (не root)
- Не регенерировать SSH ключи на сервере
