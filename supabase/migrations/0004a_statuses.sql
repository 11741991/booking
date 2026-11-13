-- Этап 4, часть 1: новые статусы (отдельным запросом — новые значения enum нельзя использовать в той же транзакции)
alter type public.booking_status add value if not exists 'confirmed' after 'scheduled';
alter type public.booking_status add value if not exists 'rescheduled' after 'no_show';
alter type public.booking_status add value if not exists 'not_counted' after 'rescheduled';
