#!/bin/sh
# Записывает publishable (anon) ключ Supabase в app/.env. Ключ не показывается на экране.
cd "$(dirname "$0")/.." || exit 1
printf 'Вставь ключ sb_publishable_... и нажми Enter: '
stty -echo; read -r K; stty echo; echo
case "$K" in
  sb_secret_*) echo "❌ Это СЕКРЕТНЫЙ ключ, он не нужен. Нужен sb_publishable_..."; exit 1 ;;
  sb_publishable_*|eyJ*) ;;
  *) echo "❌ Не похоже на ключ Supabase. Попробуй ещё раз."; exit 1 ;;
esac
grep -v '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' .env 2>/dev/null > .env.tmp
printf 'EXPO_PUBLIC_SUPABASE_ANON_KEY=%s\n' "$K" >> .env.tmp && mv .env.tmp .env
echo "✅ Готово, ключ сохранён в app/.env"
