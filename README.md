# Букинг встреч (хантеры → клоузеры)

Next.js 16 + Supabase (Postgres, вход через Google) + Vercel.

## Запуск локально
1. `cp .env.example .env.local`, заполнить ключи Supabase.
2. В Supabase → SQL Editor выполнить по порядку файлы из `supabase/migrations/`.
3. Supabase → Authentication → Providers → Google: включить, вставить Client ID / Secret.
4. Supabase → Authentication → URL Configuration: Site URL = адрес приложения, Redirect URLs = `<адрес>/auth/callback`.
5. `npm install && npm run dev`.

## Этапы
1. ✅ Вход через Google, пользователи и роли, экран админа
2. ✅ Слоты: сетка свободных окон, закрытие слотов (разово, диапазон, повтор), массовое закрытие
3. Бронирование
4. РОП: статусы, перенос, статистика
5. Google Календарь (запись броней)
6. Двусторонняя синхронизация с календарём
