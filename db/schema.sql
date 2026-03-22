-- Семьи
CREATE TABLE families (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'family', 'family_plus')),
  trial_ends_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  voice_messages_used INT DEFAULT 0,
  timezone TEXT DEFAULT 'Europe/Moscow',
  digest_hour INT DEFAULT 21,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Пользователи
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  telegram_username TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'member', 'child')),
  family_id UUID REFERENCES families(id),
  request_template TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Задачи
CREATE TABLE tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to UUID REFERENCES users(id) NOT NULL,
  created_by UUID REFERENCES users(id) NOT NULL,
  family_id UUID REFERENCES families(id) NOT NULL,
  is_recurring BOOLEAN DEFAULT FALSE,
  frequency TEXT CHECK (frequency IN ('daily', 'weekly', 'every_2_days', 'custom', 'once')),
  reminder_times JSONB DEFAULT '[]',
  days_of_week JSONB DEFAULT '[]',
  due_date TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'discussion', 'rejected', 'done')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Выполнения задач
CREATE TABLE task_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES tasks(id) NOT NULL,
  completed_by UUID REFERENCES users(id) NOT NULL,
  original_assignee UUID REFERENCES users(id) NOT NULL,
  family_id UUID REFERENCES families(id),
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  date DATE DEFAULT CURRENT_DATE
);

-- Отправленные напоминания
CREATE TABLE reminders_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES tasks(id) NOT NULL,
  user_id UUID REFERENCES users(id) NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  snoozed_until TIMESTAMPTZ DEFAULT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'snoozed', 'completed'))
);

-- Обсуждения задач
CREATE TABLE task_discussions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES tasks(id) NOT NULL,
  initiated_by UUID REFERENCES users(id) NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Сессии бота (персистентные)
CREATE TABLE sessions (
  key TEXT PRIMARY KEY,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- МИГРАЦИЯ для существующей БД (выполни в Supabase SQL Editor):
-- =============================================================
-- ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_frequency_check;
-- ALTER TABLE tasks ADD CONSTRAINT tasks_frequency_check
--   CHECK (frequency IN ('daily', 'weekly', 'every_2_days', 'custom', 'once'));
--
-- ALTER TABLE reminders_log ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ DEFAULT NULL;
--
-- CREATE TABLE IF NOT EXISTS sessions (
--   key TEXT PRIMARY KEY,
--   data JSONB DEFAULT '{}',
--   updated_at TIMESTAMPTZ DEFAULT NOW()
-- );
