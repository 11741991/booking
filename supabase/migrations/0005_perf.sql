-- Ускорение сетки: block_covers как встраиваемая SQL-функция (без чтения настроек на каждый вызов).
-- Часовой пояс единый для всей системы (ТЗ): Asia/Almaty.
create or replace function public.block_covers(b public.slot_blocks, s timestamptz, e timestamptz)
returns boolean
language sql immutable as $$
  select case
    when b.kind = 'once' then b.starts_at < e and b.ends_at > s
    else
      extract(isodow from (s at time zone 'Asia/Almaty'))::smallint = any(b.weekdays)
      and (s at time zone 'Asia/Almaty')::date >= b.valid_from
      and (b.valid_until is null or (s at time zone 'Asia/Almaty')::date <= b.valid_until)
      and b.start_time < (case when (e at time zone 'Asia/Almaty')::date > (s at time zone 'Asia/Almaty')::date
                               then time '24:00' else (e at time zone 'Asia/Almaty')::time end)
      and b.end_time > (s at time zone 'Asia/Almaty')::time
  end
$$;
