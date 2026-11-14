"use server";
import { revalidatePath } from "next/cache";
import { GRADES, QUALS, STATUSES, type BookingStatus } from "@/lib/labels";
import { requireRole, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { fetchAmoLead, parseAmoLink, syncAmoDone, type AmoData } from "@/lib/amo";

const ERRORS: Record<string, string> = {
  NO_FREE_CLOSER: "На это время свободных клоузеров уже нет. Выберите другое время.",
  SLOT_PAST: "Это время уже прошло.",
  SLOT_INVALID: "Такого слота нет в сетке. Обновите страницу.",
  NO_RIGHTS: "Нет прав на это действие.",
  TOO_LATE: "Встреча уже началась или закрыта — изменить нельзя.",
  NEED_LINK: "Для онлайн-встречи нужна ссылка на встречу.",
  NEED_CRM: "Нужна ссылка на сделку в CRM.",
  USE_RESCHEDULE: "Для переноса выберите новое время.",
  ALREADY_RESCHEDULED: "Встреча уже перенесена — меняйте статус у новой встречи.",
  NOT_STARTED: "Итог встречи можно поставить только после её начала.",
  CANT_RESCHEDULE: "Эту встречу перенести нельзя (она проведена, отменена или уже перенесена).",
  CLOSER_BUSY: "Клоузер занят в это время.",
  SLOT_TAKEN: "Время уже занято другой встречей.",
  NEED_QUAL_AFTER: "Укажите квал после встречи (A, B или C).",
  NEED_NOTE_AFTER: "Для «Эксперт не засчитал» примечание обязательно.",
};

function human(msg: string) {
  const code = Object.keys(ERRORS).find((k) => msg.includes(k));
  return code ? ERRORS[code] : msg;
}

export type LookupResult =
  | { ok: true; data: AmoData }
  | { ok: false; message: string | null };

/** Подтянуть данные сделки из amoCRM по ссылке */
export async function lookupAmoAction(url: string): Promise<LookupResult> {
  await requireUser();
  if (!url.trim()) return { ok: false, message: null };
  const r = await fetchAmoLead(url);
  if (r.ok) return { ok: true, data: r.data };
  if (r.reason === "not_configured") return { ok: false, message: null };
  if (r.reason === "bad_link")
    return parseAmoLink(url) ? { ok: false, message: "Ссылка из другого amoCRM-аккаунта" } : { ok: false, message: null };
  if (r.reason === "not_found") return { ok: false, message: "Сделка в amoCRM не найдена" };
  return { ok: false, message: "amoCRM не ответил — данные можно ввести вручную" };
}

export type CreateResult =
  | { ok: true; id: string; closerName: string; startsAt: string }
  | { ok: false; error: string; refresh?: boolean };

export async function createBookingAction(input: {
  start: string;
  format: "online" | "offline";
  meetingUrl: string;
  clientName: string;
  clientPhone: string;
  crmUrl: string;
  comment: string;
  grade: string;
  qual: string;
}): Promise<CreateResult> {
  await requireRole("hunter", "rop", "admin");

  const clientName = input.clientName.trim();
  const phone = normalizePhone(input.clientPhone);
  const crmUrl = input.crmUrl.trim();
  if (!clientName) return { ok: false, error: "Укажите имя клиента" };
  if (!phone) return { ok: false, error: "Телефон в формате +7 7XX XXX XX XX" };
  if (!/^https?:\/\/\S+$/i.test(crmUrl)) return { ok: false, error: "Ссылка на сделку должна начинаться с https://" };
  if (input.format !== "online" && input.format !== "offline") return { ok: false, error: "Выберите формат" };
  if (!GRADES.includes(input.grade)) return { ok: false, error: "Укажите класс обучения" };
  if (!(QUALS as readonly string[]).includes(input.qual)) return { ok: false, error: "Укажите степень квала" };
  if (input.format === "online" && !/^https?:\/\/\S+$/i.test(input.meetingUrl.trim()))
    return { ok: false, error: "Вставьте ссылку на онлайн-встречу (https://…)" };

  // amoCRM: снимок сделки (если интеграция подключена)
  const amo = await fetchAmoLead(crmUrl);
  const amoLeadId = amo.leadId;
  const amoData = amo.ok ? amo.data : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_booking", {
    p_start: input.start,
    p_format: input.format,
    p_meeting_url: input.meetingUrl,
    p_client_name: clientName,
    p_client_phone: phone,
    p_crm_url: crmUrl,
    p_comment: input.comment,
    p_grade: input.grade,
    p_qual: input.qual,
    p_amo_lead_id: amoLeadId,
    p_amo_data: amoData,
  });
  if (error) {
    revalidatePath("/slots");
    return { ok: false, error: human(error.message), refresh: /NO_FREE_CLOSER|SLOT_PAST/.test(error.message) };
  }
  const booking = (Array.isArray(data) ? data[0] : data) as { id: string; closer_id: string; starts_at: string };
  const { data: closer } = await supabase.from("users").select("name").eq("id", booking.closer_id).single();

  revalidatePath("/slots");
  revalidatePath("/schedule");
  revalidatePath("/meetings");
  return { ok: true, id: booking.id, closerName: closer?.name ?? "", startsAt: booking.starts_at };
}

export async function updateMyBookingAction(input: {
  id: string;
  meetingUrl: string;
  crmUrl: string;
  comment: string;
  grade: string;
  qual: string;
}): Promise<{ ok?: true; error?: string }> {
  await requireRole("hunter", "rop", "admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_booking", {
    p_id: input.id,
    p_meeting_url: input.meetingUrl,
    p_crm_url: input.crmUrl,
    p_comment: input.comment,
    p_grade: input.grade,
    p_qual: input.qual,
  });
  if (error) return { error: human(error.message) };

  const amo = await fetchAmoLead(input.crmUrl);
  if (amo.ok) await supabase.rpc("set_booking_amo", { p_id: input.id, p_lead_id: amo.leadId, p_data: amo.data });

  revalidatePath(`/bookings/${input.id}`);
  revalidatePath("/meetings");
  return { ok: true };
}

export async function refreshAmoAction(id: string, crmUrl: string): Promise<{ ok?: true; error?: string }> {
  await requireUser();
  const amo = await fetchAmoLead(crmUrl);
  if (!amo.ok) {
    return {
      error:
        amo.reason === "not_configured"
          ? "Интеграция с amoCRM ещё не подключена"
          : amo.reason === "not_found"
            ? "Сделка в amoCRM не найдена"
            : amo.reason === "bad_link"
              ? "Это не ссылка на сделку amoCRM"
              : "amoCRM не ответил, попробуйте позже",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_booking_amo", { p_id: id, p_lead_id: amo.leadId, p_data: amo.data });
  if (error) return { error: error.message };
  revalidatePath(`/bookings/${id}`);
  return { ok: true };
}

function revalidateAll(id?: string) {
  if (id) revalidatePath(`/bookings/${id}`);
  revalidatePath("/meetings");
  revalidatePath("/slots");
  revalidatePath("/schedule");
  revalidatePath("/stats");
}

type Simple = { ok?: true; error?: string };

type StatusResult = Simple & { amo?: string };

type SyncRow = {
  status: BookingStatus;
  crm_url: string;
  qual_after: string | null;
  note_after: string | null;
  closer: { name: string } | null;
};

/** Передать итог проведённой встречи в amoCRM и запомнить результат в карточке */
async function pushDoneToAmo(id: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select("status,crm_url,qual_after,note_after,closer:users!bookings_closer_id_fkey(name)")
    .eq("id", id)
    .maybeSingle();
  const b = data as unknown as SyncRow | null;
  if (!b || b.status !== "done") return "";
  const sync = await syncAmoDone({
    crmUrl: b.crm_url,
    closerName: b.closer?.name ?? "",
    qualAfter: b.qual_after,
    noteAfter: b.note_after,
  });
  await supabase.rpc("set_booking_amo_sync", { p_id: id, p_sync: sync });
  return sync.message;
}

export async function setStatusAction(
  id: string,
  status: BookingStatus,
  note = "",
  result?: { qualAfter: string; noteAfter: string },
): Promise<StatusResult> {
  await requireUser();
  if (!STATUSES.includes(status)) return { error: "Неизвестный статус" };
  if (result) {
    if (result.qualAfter && !(QUALS as readonly string[]).includes(result.qualAfter)) return { error: ERRORS.NEED_QUAL_AFTER };
    if ((status === "done" || status === "not_counted") && !result.qualAfter) return { error: ERRORS.NEED_QUAL_AFTER };
    if (status === "not_counted" && !result.noteAfter.trim()) return { error: ERRORS.NEED_NOTE_AFTER };
  }
  const supabase = await createClient();
  const { data: before } = await supabase.from("bookings").select("status").eq("id", id).maybeSingle();
  const { error } = await supabase.rpc("set_booking_status", {
    p_id: id,
    p_status: status,
    p_note: note || null,
    p_qual_after: result?.qualAfter || null,
    p_note_after: result?.noteAfter || null,
  });
  if (error) return { error: human(error.message) };

  let amo: string | undefined;
  if (status === "done" && before?.status !== "done") amo = await pushDoneToAmo(id);

  revalidateAll(id);
  return { ok: true, amo };
}

export async function retryAmoSyncAction(id: string): Promise<StatusResult> {
  await requireUser();
  const amo = await pushDoneToAmo(id);
  if (!amo) return { error: "Передавать в amoCRM можно только проведённые встречи" };
  revalidatePath(`/bookings/${id}`);
  return { ok: true, amo };
}

export async function setMeetingResultAction(id: string, qual: string, note: string): Promise<Simple> {
  await requireUser();
  if (qual && !(QUALS as readonly string[]).includes(qual)) return { error: ERRORS.NEED_QUAL_AFTER };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_meeting_result", { p_id: id, p_qual: qual, p_note: note });
  if (error) return { error: human(error.message) };
  revalidateAll(id);
  return { ok: true };
}

export type FreeStart = { start: string; date: string; label: string; free: number; closerIds: string[] };

/** Свободные времена начала встречи на горизонт брони (для переноса) */
export async function freeStartsAction(): Promise<{ starts: FreeStart[]; tz: string }> {
  await requireUser();
  const { getGrid } = await import("@/lib/schedule");
  const grid = await getGrid();
  const starts: FreeStart[] = Object.values(grid.slots)
    .filter((s) => !s.past)
    .map((s) => {
      const ids = s.cells.filter((c) => c.canBook).map((c) => c.closerId);
      return {
        start: s.start,
        date: s.date,
        label: `${String(Math.floor(s.minutes / 60)).padStart(2, "0")}:${String(s.minutes % 60).padStart(2, "0")}`,
        free: ids.length,
        closerIds: ids,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  return { starts, tz: grid.settings.timezone };
}

export async function rescheduleAction(id: string, newStart: string, closerId: string | null): Promise<CreateResult> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reschedule_booking", {
    p_id: id,
    p_new_start: newStart,
    p_closer: closerId,
  });
  if (error) return { ok: false, error: human(error.message), refresh: true };
  const nb = (Array.isArray(data) ? data[0] : data) as { id: string; closer_id: string; starts_at: string };
  const { data: closer } = await supabase.from("users").select("name").eq("id", nb.closer_id).single();
  revalidateAll(id);
  return { ok: true, id: nb.id, closerName: closer?.name ?? "", startsAt: nb.starts_at };
}

export async function freeClosersAction(id: string): Promise<{ id: string; name: string }[]> {
  await requireRole("rop", "admin");
  const supabase = await createClient();
  const { data } = await supabase.rpc("free_closers_for", { p_id: id });
  return (data ?? []) as { id: string; name: string }[];
}

export async function ropUpdateAction(input: {
  id: string;
  closerId: string;
  clientName: string;
  clientPhone: string;
  crmUrl: string;
  format: "online" | "offline";
  meetingUrl: string;
  comment: string;
  grade: string;
  qual: string;
}): Promise<Simple> {
  await requireRole("rop", "admin");
  const phone = normalizePhone(input.clientPhone);
  if (!input.clientName.trim()) return { error: "Укажите имя клиента" };
  if (!phone) return { error: "Телефон в формате +7 7XX XXX XX XX" };
  if (!/^https?:\/\/\S+$/i.test(input.crmUrl.trim())) return { error: "Ссылка на сделку должна начинаться с https://" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("rop_update_booking", {
    p_id: input.id,
    p_closer: input.closerId,
    p_client_name: input.clientName,
    p_client_phone: phone,
    p_crm_url: input.crmUrl,
    p_format: input.format,
    p_meeting_url: input.meetingUrl,
    p_comment: input.comment,
    p_grade: input.grade,
    p_qual: input.qual,
  });
  if (error) return { error: human(error.message) };
  revalidateAll(input.id);
  return { ok: true };
}
