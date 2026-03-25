# Пинок — семейный координатор задач

Telegram-бот для распределения домашних задач между членами семьи. Делает невидимый труд видимым.

## Установка

1. Клонируй репозиторий и установи зависимости:
```bash
npm install
```

2. Создай `.env` на основе `.env.example`:
```
BOT_TOKEN=          # от @BotFather
SUPABASE_URL=       # URL проекта Supabase
SUPABASE_ANON_KEY=  # Anon key из Supabase
OPENAI_API_KEY=    # для голосовых и парсинга задач
```

3. Создай таблицы в Supabase — выполни SQL из `db/schema.sql` в SQL Editor.

4. Запуск:
```bash
npm start
```

## Деплой на Railway

1. Подключи репозиторий к Railway
2. Добавь переменные окружения в Dashboard
3. Деплой произойдёт автоматически по `railway.json`

## Команды

- `/start` — онбординг
- `/add` — добавить задачу
- `/tasks` — мои задачи на сегодня
- `/family` — статус семьи
- `/stats` — герои семьи
- `/invite` — пригласить члена семьи
- `/settings` — настройки
