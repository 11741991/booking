import { createClient } from "@/lib/supabase/server";
import type { BlockReason } from "@/lib/labels";
import { minutesLabel, WEEKDAYS_SHORT } from "@/lib/labels";

export type Settings = {
  timezone: string;
  work_start_hour: number;
  work_end_hour: number;
  slot_minutes: number;
  booking_horizon_days: number;
  office_address: string;
};

export type Day = { date: string; weekday: string; dayNum: number; month: number; isToday: boolean };
export type Time = { minutes: number; label: string };

export type Cell = {
  closerId: string;
  blockId: string | null;
  blockKind: "once" | "recurring" | null;
  blockForAll: boolean;
  reason: BlockReason | null;
  comment: string | null;
};

export type GridSlot = {
  key: string; // `${date}|${minutes}`
  date: string;
  minutes: number;
  start: string;
  end: string;
  past: boolean;
  cells: Cell[];
};

export type Grid = {
  settings: Settings;
  days: Day[];
  times: Time[];
  closers: { id: string; name: string }[];
  slots: Record<string, GridSlot>;
};

export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase.from("settings").select("key,value");
  const s = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;
  return {
    timezone: String(s.timezone ?? "Asia/Almaty"),
    work_start_hour: Number(s.work_start_hour ?? 12),
    work_end_hour: Number(s.work_end_hour ?? 21),
    slot_minutes: Number(s.slot_minutes ?? 60),
    booking_horizon_days: Number(s.booking_horizon_days ?? 7),
    office_address: String(s.office_address ?? ""),
  };
}

/** Дата (YYYY-MM-DD) и минуты от полуночи в часовом поясе tz */
export function localParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function buildDays(today: string, count: number): Day[] {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(today, i);
    const [y, m, d] = date.split("-").map(Number);
    const iso = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = вс
    return {
      date,
      weekday: WEEKDAYS_SHORT[(iso + 6) % 7],
      dayNum: d,
      month: m,
      isToday: i === 0,
    };
  });
}

export function buildTimes(s: Settings): Time[] {
  const out: Time[] = [];
  for (let m = s.work_start_hour * 60; m + s.slot_minutes <= s.work_end_hour * 60; m += s.slot_minutes) {
    out.push({ minutes: m, label: minutesLabel(m) });
  }
  return out;
}

type Row = {
  slot_start: string;
  slot_end: string;
  closer_id: string;
  block_id: string | null;
  block_kind: "once" | "recurring" | null;
  block_closer_id: string | null;
  reason: BlockReason | null;
  comment: string | null;
};

export async function getGrid(): Promise<Grid> {
  const supabase = await createClient();
  const settings = await getSettings();
  const [{ data: rows, error }, { data: closers }] = await Promise.all([
    supabase.rpc("slot_availability"),
    supabase
      .from("users")
      .select("id,name,roles")
      .eq("is_active", true)
      .contains("roles", ["closer"])
      .order("name"),
  ]);
  if (error) throw new Error(error.message);

  const now = new Date();
  const today = localParts(now, settings.timezone).date;
  const days = buildDays(today, settings.booking_horizon_days);
  const times = buildTimes(settings);

  const slots: Record<string, GridSlot> = {};
  for (const r of (rows ?? []) as Row[]) {
    const { date, minutes } = localParts(new Date(r.slot_start), settings.timezone);
    const key = `${date}|${minutes}`;
    slots[key] ??= {
      key,
      date,
      minutes,
      start: r.slot_start,
      end: r.slot_end,
      past: new Date(r.slot_end) <= now,
      cells: [],
    };
    slots[key].cells.push({
      closerId: r.closer_id,
      blockId: r.block_id,
      blockKind: r.block_kind,
      blockForAll: r.block_id !== null && r.block_closer_id === null,
      reason: r.reason,
      comment: r.comment,
    });
  }

  return {
    settings,
    days,
    times,
    closers: (closers ?? []).map((c) => ({ id: c.id as string, name: c.name as string })),
    slots,
  };
}
