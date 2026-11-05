"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REASONS, type BlockReason } from "@/lib/labels";

type Result = { ok?: true; error?: string };

async function authorize(target: string) {
  const me = await requireRole("closer", "admin", "rop");
  const canAll = me.roles.includes("admin") || me.roles.includes("rop");
  if (!canAll && target !== me.id) return { error: "Можно менять только своё расписание" } as const;
  return { closerId: target === "all" ? null : target } as const;
}

function check(reason: string, comment: string): string | null {
  if (!REASONS.includes(reason as BlockReason)) return "Выберите причину";
  if (reason === "other" && !comment.trim()) return "Для «Другое» напишите комментарий";
  return null;
}

function humanError(msg: string) {
  if (/row-level security/i.test(msg)) return "Нет прав на это действие";
  const m = msg.match(/BOOKING_CONFLICT:(.*)\|(.*)/);
  if (m)
    return `На это время уже есть бронь (${m[1].trim()}, ${m[2].trim()}). Сначала РОП должен отменить или перенести встречу.`;
  return msg;
}

function done(): Result {
  revalidatePath("/schedule");
  revalidatePath("/slots");
  return { ok: true };
}

export async function closeSlotsAction(input: {
  target: string;
  date: string;
  minutes: number[];
  reason: string;
  comment: string;
}): Promise<Result> {
  const a = await authorize(input.target);
  if ("error" in a) return { error: a.error };
  const bad = check(input.reason, input.comment);
  if (bad) return { error: bad };
  if (!input.minutes.length) return { error: "Выберите хотя бы один слот" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("close_slots", {
    p_closer: a.closerId,
    p_date: input.date,
    p_start_minutes: input.minutes,
    p_reason: input.reason,
    p_comment: input.comment,
  });
  return error ? { error: humanError(error.message) } : done();
}

export async function closeRangeAction(input: {
  target: string;
  from: string;
  to: string;
  reason: string;
  comment: string;
}): Promise<Result> {
  const a = await authorize(input.target);
  if ("error" in a) return { error: a.error };
  const bad = check(input.reason, input.comment);
  if (bad) return { error: bad };
  if (!input.from || !input.to) return { error: "Укажите даты" };
  if (input.to < input.from) return { error: "Дата окончания раньше начала" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("close_range", {
    p_closer: a.closerId,
    p_from: input.from,
    p_to: input.to,
    p_reason: input.reason,
    p_comment: input.comment,
  });
  return error ? { error: humanError(error.message) } : done();
}

export async function closeRecurringAction(input: {
  target: string;
  weekdays: number[];
  startMinutes: number;
  endMinutes: number;
  from: string;
  until: string;
  reason: string;
  comment: string;
}): Promise<Result> {
  const a = await authorize(input.target);
  if ("error" in a) return { error: a.error };
  const bad = check(input.reason, input.comment);
  if (bad) return { error: bad };
  if (!input.weekdays.length) return { error: "Выберите дни недели" };
  if (input.endMinutes <= input.startMinutes) return { error: "Время окончания должно быть позже начала" };
  if (!input.from) return { error: "Укажите дату начала" };
  if (input.until && input.until < input.from) return { error: "Дата окончания раньше начала" };

  const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_recurring", {
    p_closer: a.closerId,
    p_weekdays: input.weekdays,
    p_start: t(input.startMinutes),
    p_end: t(input.endMinutes),
    p_from: input.from,
    p_until: input.until || null,
    p_reason: input.reason,
    p_comment: input.comment,
  });
  return error ? { error: humanError(error.message) } : done();
}

export async function deleteBlockAction(id: string): Promise<Result> {
  await requireRole("closer", "admin", "rop");
  const supabase = await createClient();
  const { data, error } = await supabase.from("slot_blocks").delete().eq("id", id).select("id");
  if (error) return { error: humanError(error.message) };
  if (!data?.length) return { error: "Нет прав на это действие" };
  return done();
}
