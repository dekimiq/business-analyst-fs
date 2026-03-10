-- Расширения
CREATE EXTENSION IF NOT EXISTS vector;

-- Схемы
CREATE SCHEMA IF NOT EXISTS backend;
CREATE SCHEMA IF NOT EXISTS bot;
CREATE SCHEMA IF NOT EXISTS vectors;

-- Пользователи с изолированными правами
CREATE USER backend_user WITH PASSWORD 'secret_backend';
GRANT CONNECT ON DATABASE analytics TO backend_user;
GRANT USAGE, CREATE ON SCHEMA backend TO backend_user;

CREATE USER bot_user WITH PASSWORD 'secret_bot';
GRANT CONNECT ON DATABASE analytics TO bot_user;
GRANT USAGE, CREATE ON SCHEMA bot TO bot_user;

CREATE USER ai_user WITH PASSWORD 'secret_ai';
GRANT CONNECT ON DATABASE analytics TO ai_user;
GRANT USAGE, CREATE ON SCHEMA vectors TO ai_user;
GRANT USAGE ON SCHEMA backend TO ai_user;
GRANT SELECT ON ALL TABLES IN SCHEMA backend TO ai_user;

CREATE SCHEMA IF NOT EXISTS settings;

CREATE USER cron_user WITH PASSWORD 'secret_cron';
GRANT CONNECT ON DATABASE analytics TO cron_user;
GRANT USAGE ON SCHEMA settings TO cron_user;
GRANT SELECT ON ALL TABLES IN SCHEMA settings TO cron_user;

-- Create settings table and default values (owned by backend, readable by cron)
CREATE TABLE IF NOT EXISTS settings.schedules (
    name VARCHAR(50) PRIMARY KEY,
    time_hh_mm VARCHAR(5) NOT NULL,
    day_of_week INTEGER NULL
);

INSERT INTO settings.schedules (name, time_hh_mm, day_of_week) VALUES
('sync', '03:00', NULL),
('daily_report', '09:00', NULL),
('weekly_report', '10:00', 7)
ON CONFLICT (name) DO NOTHING;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA settings TO backend_user;

CREATE USER bot_notification_user WITH PASSWORD 'secret_notification';
GRANT CONNECT ON DATABASE analytics TO bot_notification_user;
GRANT USAGE ON SCHEMA bot TO bot_notification_user;

-- Create basic users table for Bot interaction in the bot schema
CREATE TABLE IF NOT EXISTS bot.users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL UNIQUE,
    username VARCHAR(100),
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Give the notification user select access to the specific new table
GRANT SELECT ON bot.users TO bot_notification_user;
GRANT SELECT ON ALL TABLES IN SCHEMA bot TO bot_notification_user;

-- Seed a dummy dev user for testing
INSERT INTO bot.users (user_id, username, role) VALUES ('123456789', 'admin', 'dev') ON CONFLICT (user_id) DO NOTHING;
